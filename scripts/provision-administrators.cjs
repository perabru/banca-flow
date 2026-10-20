#!/usr/bin/env node
'use strict';

// Operação administrativa pontual. Não é carregada pelo site e não altera notas.
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const PROJECT_ID = 'avaliadortcc';
const ADMIN_EMAIL = 'admin@univap.br';
const ADMIN_NAME = 'Administração Univap';
const ADMIN_KEY = 'admin';
const ROLES = new Set(['teacher', 'coordinator']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validUid = uid => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(uid) && !/[.#$\[\]\/\s\u0000-\u001f\u007f]/.test(uid);

class ProvisioningError extends Error {
  constructor(code, message) { super(message); this.name = 'ProvisioningError'; this.code = code; }
}
function stop(code, message) { throw new ProvisioningError(code, message); }
function safeError(error) {
  if (error instanceof ProvisioningError) return error.message;
  const code = typeof error?.code === 'string' && /^[a-z0-9/_-]{1,100}$/i.test(error.code) ? ` (${error.code})` : '';
  return `A operação administrativa não foi concluída${code}. Confira a conexão e a autorização da conta administrativa.`;
}
function selectByKey(users, key, label) {
  const matches = Object.entries(users).filter(([, profile]) => profile?.key === key);
  if (matches.length !== 1) stop('ambiguous-identity', `${label}: deve existir exatamente um cadastro com o identificador ${key}. Nenhum cadastro foi modificado.`);
  const [uid, profile] = matches[0];
  if (!validUid(uid) || !object(profile) || !ROLES.has(profile.role) || profile.active === false) stop('invalid-identity', `${label}: o cadastro deve estar ativo e ter uma função válida.`);
  return { uid, profile };
}
function assertAuthIdentity(identity, record, label) {
  if (!record || record.uid !== identity.uid || record.disabled === true) stop('auth-identity', `${label}: a conta de autenticação não corresponde ao cadastro ativo.`);
  // Perfis legados sem email não são reescritos. O UID verificado continua sendo a identidade.
  if (identity.profile.email !== undefined && email(identity.profile.email) !== email(record.email)) stop('auth-email', `${label}: o e-mail do perfil difere do e-mail da conta de autenticação.`);
}
function identitiesOf(users, { wagnerUid } = {}) {
  if (!object(users)) stop('invalid-directory', 'O catálogo de usuários não está disponível. Nenhum cadastro foi modificado.');
  let wagner;
  if (wagnerUid !== undefined) {
    const profile = own(users, wagnerUid) ? users[wagnerUid] : null;
    if (!validUid(wagnerUid) || !object(profile) || !ROLES.has(profile.role) || profile.active === false || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(profile.email))) stop('invalid-wagner-uid', 'O UID informado para Wagner precisa corresponder a um perfil ativo existente com e-mail de acesso.');
    const canonical = Object.entries(users).filter(([, user]) => user?.key === 'wagner');
    if (canonical.length && (canonical.length !== 1 || canonical[0][0] !== wagnerUid)) stop('wagner-uid-conflict', 'O UID informado para Wagner diverge do cadastro com o identificador wagner. Confira a identidade antes de continuar.');
    wagner = { uid: wagnerUid, profile };
  } else wagner = selectByKey(users, 'wagner', 'Wagner');
  const alberson = selectByKey(users, 'alberson', 'Alberson');
  if (alberson.profile.role !== 'coordinator') stop('invalid-owner', 'O cadastro principal do Alberson precisa ter a função de coordenador.');
  if (wagner.uid === alberson.uid) stop('ambiguous-identity', 'Os cadastros de Wagner e Alberson precisam ter UIDs distintos.');
  return { wagner, alberson };
}
function planProvisioning(users, { wagnerAuth, albersonAuth, adminAuth = null, wagnerUid, now = Date.now() } = {}) {
  const { wagner, alberson } = identitiesOf(users, { wagnerUid });
  assertAuthIdentity(wagner, wagnerAuth, 'Wagner');
  assertAuthIdentity(alberson, albersonAuth, 'Alberson');
  if (!Number.isFinite(now) || now <= 0) stop('invalid-time', 'A data da operação administrativa é inválida.');
  const claims = Object.entries(users).filter(([, profile]) => profile?.key === ADMIN_KEY || email(profile?.email) === ADMIN_EMAIL);
  if (claims.length > 1) stop('admin-conflict', 'Há mais de um cadastro associado ao administrador. Confira os UIDs antes de continuar.');
  if (adminAuth) {
    if (!validUid(adminAuth.uid) || email(adminAuth.email) !== ADMIN_EMAIL || adminAuth.disabled === true || [wagner.uid, alberson.uid].includes(adminAuth.uid)) stop('admin-auth-conflict', 'A conta de autenticação do administrador está desabilitada ou tem uma identidade incompatível.');
    if (claims.some(([uid]) => uid !== adminAuth.uid)) stop('admin-conflict', 'O cadastro do administrador e o e-mail de autenticação apontam para UIDs diferentes.');
  } else if (claims.length) stop('admin-conflict', 'Existe um perfil de administrador sem a conta de autenticação correspondente. Confira esse cadastro antes de continuar.');
  const administrator = adminAuth && own(users, adminAuth.uid) ? users[adminAuth.uid] : undefined;
  if (administrator && (!object(administrator) || administrator.key !== ADMIN_KEY || email(administrator.email) !== ADMIN_EMAIL || !ROLES.has(administrator.role) || administrator.active === false)) stop('admin-profile-conflict', 'O perfil da conta administrativa é incompatível ou está desabilitado. Nenhuma identidade será substituída.');
  const updates = Object.create(null);
  if (wagner.profile.role !== 'coordinator') updates[wagner.uid] = { ...clone(wagner.profile), role: 'coordinator' };
  if (adminAuth && !administrator) updates[adminAuth.uid] = { name: ADMIN_NAME, email: ADMIN_EMAIL, key: ADMIN_KEY, role: 'coordinator', active: true, createdBy: alberson.uid, createdAt: now };
  else if (administrator?.role !== 'coordinator' && administrator) updates[adminAuth.uid] = { ...clone(administrator), role: 'coordinator' };
  return {
    wagner: { uid: wagner.uid, action: wagner.profile.role === 'coordinator' ? 'unchanged' : 'promote' },
    administrator: { uid: adminAuth?.uid || null, email: ADMIN_EMAIL, action: !adminAuth ? 'create-auth-and-profile' : !administrator ? 'create-profile' : administrator.role !== 'coordinator' ? 'promote' : 'unchanged', password: adminAuth ? 'unchanged' : 'new-account-only' },
    updates,
    createAuth: !adminAuth,
    createdBy: alberson.uid
  };
}
function publicPlan(plan, status) {
  return {
    status, projectId: PROJECT_ID,
    wagner: clone(plan.wagner), administrator: clone(plan.administrator),
    changedProfiles: Object.keys(plan.updates).length + (plan.createAuth ? 1 : 0),
    pendingProfileCreation: plan.createAuth,
    changedPaths: Object.keys(plan.updates).map(uid => `users/${uid}`)
  };
}
async function getOptionalAdmin(auth) {
  try { return await auth.getUserByEmail(ADMIN_EMAIL); }
  catch (error) { if (error?.code === 'auth/user-not-found') return null; throw error; }
}
async function authRecords(auth, users, adminAuth, wagnerUid) {
  const identities = identitiesOf(users, { wagnerUid });
  const [wagnerAuth, albersonAuth, currentAdminAuth] = await Promise.all([auth.getUser(identities.wagner.uid), auth.getUser(identities.alberson.uid), adminAuth ? auth.getUser(adminAuth.uid) : null]);
  return { wagnerAuth, albersonAuth, adminAuth: currentAdminAuth, wagnerUid };
}
async function rollbackNewAuth(auth, usersRef, created) {
  // Um erro de rede pode ocorrer depois de o servidor confirmar a transação.
  // Nunca exclua a conta se o perfil existir ou se não for possível conferir.
  let persisted;
  try { persisted = (await usersRef.child(created.uid).get()).val(); }
  catch { stop('rollback-unverified', 'A gravação não foi confirmada e não foi possível conferir o perfil administrativo. A conta nova foi preservada para revisão no Firebase Authentication.'); }
  if (persisted !== null && persisted !== undefined) return;
  try { await auth.deleteUser(created.uid); }
  catch { stop('rollback-failed', 'O perfil não foi gravado e a conta nova não pôde ser desfeita. Confira o acesso administrativo no Firebase Authentication antes de repetir.'); }
}
async function provisionAdministrators({ auth, database, apply = false, password, wagnerUid, now = () => Date.now(), onProgress = () => {} } = {}) {
  if (!auth || !database || typeof auth.getUser !== 'function' || typeof auth.getUserByEmail !== 'function' || typeof database.ref !== 'function') stop('missing-services', 'Forneça uma conexão administrativa autorizada com o Firebase.');
  const usersRef = database.ref('users');
  onProgress('Conferindo as identidades cadastradas no Firebase.');
  const users = (await usersRef.get()).val();
  let adminAuth = await getOptionalAdmin(auth);
  let records = await authRecords(auth, users, adminAuth, wagnerUid);
  const firstPlan = planProvisioning(users, { ...records, now: now() });
  if (apply !== true) return publicPlan(firstPlan, 'dry-run');
  if (firstPlan.createAuth && (typeof password !== 'string' || password.length < 8 || password.length > 128)) stop('missing-password', 'Defina BANCAFLOW_ADMIN_PASSWORD com uma senha inicial de 8 a 128 caracteres antes de aplicar a criação da conta.');
  let created = null, finalPlan = firstPlan;
  try {
    if (firstPlan.createAuth) {
      onProgress('Criando a conta administrativa solicitada, sem alterar os logins existentes.');
      created = await auth.createUser({ email: ADMIN_EMAIL, password, displayName: ADMIN_NAME });
      adminAuth = created;
    }
    // Confira novamente os UIDs depois da eventual criação da conta.
    const latest = (await usersRef.get()).val();
    records = await authRecords(auth, latest, adminAuth, wagnerUid);
    planProvisioning(latest, { ...records, now: now() });
    onProgress('Aplicando somente os perfis administrativos em uma transação.');
    const issuedAt = now();
    const result = await usersRef.transaction(current => {
      finalPlan = planProvisioning(current, { ...records, now: issuedAt });
      if (!Object.keys(finalPlan.updates).length) return undefined;
      return { ...current, ...finalPlan.updates };
    }, undefined, false);
    if (!result.committed && Object.keys(finalPlan.updates).length) stop('transaction-cancelled', 'O catálogo mudou e a alteração administrativa não foi confirmada. Confira os cadastros e repita a simulação.');
    const resultPlan = created ? { ...finalPlan, administrator: { ...finalPlan.administrator, action: 'create-auth-and-profile', password: 'new-account-only' } } : finalPlan;
    return publicPlan(resultPlan, result.committed ? 'applied' : 'unchanged');
  } catch (error) {
    if (created) await rollbackNewAuth(auth, usersRef, created);
    throw error;
  }
}
function parseArguments(args) {
  let projectId, wagnerUid, apply = false, help = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--project') { if (projectId !== undefined) stop('arguments', 'Informe --project uma única vez.'); projectId = args[++index]; }
    else if (value === '--wagner-uid') { if (wagnerUid !== undefined) stop('arguments', 'Informe --wagner-uid uma única vez.'); wagnerUid = args[++index]; if (!validUid(wagnerUid) || wagnerUid.startsWith('--')) stop('arguments', 'Informe um UID válido para --wagner-uid.'); }
    else if (value === '--apply') apply = true;
    else if (value === '--help' || value === '-h') help = true;
    else stop('arguments', 'Argumento desconhecido. Use --help para consultar o modo de execução.');
  }
  if (!help && projectId !== PROJECT_ID) stop('project-required', `Informe explicitamente --project ${PROJECT_ID}. Nenhum outro projeto é aceito por este script.`);
  return { projectId, apply, help, ...(wagnerUid !== undefined ? { wagnerUid } : {}) };
}
function resolveDatabaseUrl(environment, htmlPath = join(__dirname, '..', 'index.html')) {
  let value = environment.BANCAFLOW_DATABASE_URL;
  if (!value) value = readFileSync(htmlPath, 'utf8').match(/\bdatabaseURL:\s*['"]([^'"]+)['"]/)?.[1];
  let parsed; try { parsed = new URL(value); } catch { stop('database-url', 'Não foi possível identificar o endereço do Realtime Database deste projeto.'); }
  const allowed = `${PROJECT_ID}-default-rtdb.firebaseio.com`;
  if (parsed.protocol !== 'https:' || parsed.hostname !== allowed || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) stop('database-url', 'O endereço do banco não corresponde ao Realtime Database autorizado do projeto avaliadortcc.');
  return parsed.origin;
}
function helpText() {
  return [
    'Provisionamento administrativo pontual do BancaFlow.',
    `Simular: node scripts/provision-administrators.cjs --project ${PROJECT_ID}`,
    `Aplicar: node scripts/provision-administrators.cjs --project ${PROJECT_ID} --apply`,
    'Requer Firebase Admin SDK e credencial administrativa padrão autorizada.',
    'Para criar uma conta nova, informe a senha em BANCAFLOW_ADMIN_PASSWORD.',
    'BANCAFLOW_ADMIN_DEPS pode apontar para o diretório onde firebase-admin está instalado.',
    '--wagner-uid UID permite selecionar explicitamente um perfil legado sem identificador.',
    'Contas existentes nunca têm a senha redefinida. Nenhuma banca ou nota é alterada.'
  ].join('\n');
}
async function runCli(args = process.argv.slice(2), environment = process.env, output = console.log) {
  const options = parseArguments(args);
  if (options.help) { output(helpText()); return; }
  if (environment.FIREBASE_AUTH_EMULATOR_HOST || environment.FIREBASE_DATABASE_EMULATOR_HOST) stop('emulator-environment', 'Remova as variáveis de emulador antes de operar o projeto administrativo explícito.');
  const databaseURL = resolveDatabaseUrl(environment);
  const requireSdk = environment.BANCAFLOW_ADMIN_DEPS ? createRequire(join(resolve(environment.BANCAFLOW_ADMIN_DEPS), 'package.json')) : require;
  let appSdk, authSdk, databaseSdk;
  try { appSdk = requireSdk('firebase-admin/app'); authSdk = requireSdk('firebase-admin/auth'); databaseSdk = requireSdk('firebase-admin/database'); }
  catch { stop('missing-sdk', 'Instale firebase-admin em um ambiente administrativo ou informe seu diretório em BANCAFLOW_ADMIN_DEPS.'); }
  let app;
  try {
    app = appSdk.initializeApp({ credential: appSdk.applicationDefault(), projectId: PROJECT_ID, databaseURL }, 'bancaflow-provision-' + randomUUID());
    const result = await provisionAdministrators({ auth: authSdk.getAuth(app), database: databaseSdk.getDatabase(app), apply: options.apply, password: environment.BANCAFLOW_ADMIN_PASSWORD, wagnerUid: options.wagnerUid, onProgress: output });
    output(JSON.stringify(result, null, 2));
    if (result.status === 'dry-run') output('Simulação concluída. Nenhuma conta ou perfil foi alterado.');
    else output('Operação concluída. Bancas, alunos, notas, entregas e conversas permanecem preservados.');
    return result;
  } finally { if (app) await appSdk.deleteApp(app).catch(() => {}); }
}

module.exports = Object.freeze({ PROJECT_ID, ADMIN_EMAIL, ProvisioningError, safeError, identitiesOf, planProvisioning, publicPlan, provisionAdministrators, parseArguments, resolveDatabaseUrl, helpText, runCli });
if (require.main === module) runCli().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
