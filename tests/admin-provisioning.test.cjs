const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { PROJECT_ID, ADMIN_EMAIL, ProvisioningError, safeError, identitiesOf, planProvisioning, publicPlan, provisionAdministrators, parseArguments, resolveDatabaseUrl, helpText, runCli } = require('../scripts/provision-administrators.cjs');

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const validPassword = 'Ficticia-Pw-88';
const fixture = () => ({
  users: {
    albersonUid: { name: 'Alberson', email: 'alberson@example.test', role: 'coordinator', key: 'alberson', active: true, createdAt: 12 },
    wagnerUid: { name: 'Wagner', email: 'wagner@example.test', role: 'teacher', key: 'wagner', active: true, contactEmail: 'contato@example.test', createdAt: 9 },
    anotherUid: { name: 'Outra pessoa', email: 'another@example.test', role: 'teacher', key: 'another', active: true }
  },
  boards: { bankA: { members: { wagnerUid: true, anotherUid: true }, memberNames: { wagnerUid: 'Wagner', anotherUid: 'Outra pessoa' }, groupId: 'groupA' } },
  grades: { bankA: { wagnerUid: { studentA: { presentation: 0, practice: 8, code: 6, time: 10 } } } },
  deliveries: { bankA: { studentA: 9 } }, groups: { groupA: { students: { studentA: 'Ana' } } },
  seals: { bankOld: { by: 'wagnerUid', at: 3 } }, timers: { bankA: { elapsedMs: 910000 } }, chatMessages: { geral: { msgA: { uid: 'wagnerUid', text: 'Mensagem anterior' } } }
});
const existingAdmin = () => ({ name: 'Administrador existente', email: ADMIN_EMAIL, role: 'coordinator', key: 'admin', active: true, createdBy: 'albersonUid', createdAt: 2, contactEmail: 'contato-admin@example.test' });
function harness(options = {}) {
  const data = fixture(), calls = { reads: [], refs: [], creates: [], deletes: [], transactions: [], progress: [] };
  const accounts = new Map(Object.entries(data.users).map(([uid, value]) => [uid, { uid, email: value.email, disabled: false }]));
  if (options.adminAuth) accounts.set(options.adminAuth.uid, copy(options.adminAuth));
  if (options.adminProfile) data.users[options.adminAuth?.uid || 'adminUid'] = copy(options.adminProfile);
  const notFound = () => Object.assign(Error('Fictional account not found'), { code: 'auth/user-not-found' });
  const auth = {
    async getUser(uid) { if (!accounts.has(uid)) throw notFound(); return copy(accounts.get(uid)); },
    async getUserByEmail(email) { for (const user of accounts.values()) if (user.email?.toLowerCase() === email.toLowerCase()) return copy(user); throw notFound(); },
    async createUser(values) { calls.creates.push(copy(values)); if (options.createError) throw options.createError; const created = { uid: 'newAdminUid', email: values.email, displayName: values.displayName, disabled: false }; accounts.set(created.uid, created); return copy(created); },
    async deleteUser(uid) { calls.deletes.push(uid); if (options.deleteError) throw options.deleteError; accounts.delete(uid); }
  };
  const valueAt = path => path.split('/').reduce((value, key) => value?.[key], data);
  const reference = path => ({
    child: child => reference(path + '/' + child),
    async get() { calls.reads.push(path); if (options.failRollbackRead && path === 'users/newAdminUid') throw Error('read unavailable'); await options.beforeGet?.(path, data, accounts); return { val: () => copy(valueAt(path) ?? null) }; },
    async transaction(update) {
      calls.transactions.push(path); assert.equal(path, 'users');
      await options.beforeTransaction?.(data, accounts);
      if (options.transactionError && !options.errorAfterCommit) throw options.transactionError;
      let next = update(copy(data.users));
      if (options.retryTransaction) { await options.retryTransaction(data, accounts); next = update(copy(data.users)); }
      if (next !== undefined) data.users = next;
      if (options.errorAfterCommit) throw options.transactionError || Error('acknowledgement interrupted');
      return { committed: next !== undefined, snapshot: { val: () => copy(data.users) } };
    }
  });
  const database = { ref(path) { calls.refs.push(path); assert.equal(path, 'users'); return reference(path); } };
  const run = extra => provisionAdministrators({ auth, database, password: validPassword, now: () => 1800000000000, onProgress: text => calls.progress.push(text), ...extra });
  return { data, calls, auth, accounts, database, run };
}
function preservedHistory(data) { const { users, ...history } = copy(data); return history; }

test('default execution is a read-only plan and never creates an account or changes academic data', async () => {
  const h = harness(), before = copy(h.data);
  const result = await h.run();
  assert.equal(result.status, 'dry-run'); assert.equal(result.wagner.uid, 'wagnerUid'); assert.equal(result.wagner.action, 'promote');
  assert.equal(result.administrator.action, 'create-auth-and-profile'); assert.equal(result.administrator.password, 'new-account-only');
  assert.equal(result.changedProfiles, 2); assert.equal(result.pendingProfileCreation, true);
  assert.deepEqual(h.data, before); assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.transactions.length, 0);
  assert.ok(h.calls.reads.every(path => path === 'users')); assert.ok(!JSON.stringify(result).includes(validPassword));
});

test('apply promotes the existing Wagner UID and creates only the requested administrator profile', async () => {
  const h = harness(), before = copy(h.data), history = preservedHistory(h.data);
  const result = await h.run({ apply: true });
  assert.equal(result.status, 'applied'); assert.equal(result.wagner.uid, 'wagnerUid');
  assert.deepEqual(h.data.users.wagnerUid, { ...before.users.wagnerUid, role: 'coordinator' });
  assert.deepEqual(h.data.users.albersonUid, before.users.albersonUid); assert.deepEqual(h.data.users.anotherUid, before.users.anotherUid);
  assert.deepEqual(preservedHistory(h.data), history);
  assert.deepEqual(h.data.users.newAdminUid, { name: 'Administração Univap', email: ADMIN_EMAIL, key: 'admin', role: 'coordinator', active: true, createdBy: 'albersonUid', createdAt: 1800000000000 });
  assert.deepEqual(h.calls.creates, [{ email: ADMIN_EMAIL, password: validPassword, displayName: 'Administração Univap' }]);
  assert.deepEqual(h.calls.transactions, ['users']); assert.deepEqual(h.calls.deletes, []);
  assert.equal(result.administrator.action, 'create-auth-and-profile'); assert.equal(result.administrator.password, 'new-account-only'); assert.equal(result.pendingProfileCreation, false);
  assert.ok(result.changedPaths.every(path => path.startsWith('users/'))); assert.equal(result.changedProfiles, 2);
  assert.ok(!JSON.stringify([result, h.calls.progress]).includes(validPassword)); assert.ok(!JSON.stringify(h.data).includes(validPassword));
});

test('existing administrator authentication is linked without creating or resetting its password', async () => {
  const h = harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false } });
  const result = await h.run({ apply: true, password: undefined });
  assert.equal(result.administrator.action, 'create-profile'); assert.equal(result.administrator.password, 'unchanged');
  assert.equal(h.data.users.adminUid.role, 'coordinator'); assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.deletes.length, 0);
  assert.ok(!('updateUser' in h.auth), 'no password reset capability is supplied or needed');
});

test('an existing administrative teacher is promoted in place; an already configured operation is idempotent', async () => {
  const profile = { ...existingAdmin(), role: 'teacher' };
  const h = harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false }, adminProfile: profile });
  await h.run({ apply: true, password: undefined });
  assert.deepEqual(h.data.users.adminUid, { ...profile, role: 'coordinator' });
  const before = copy(h.data); const result = await h.run({ apply: true, password: undefined });
  assert.equal(result.status, 'unchanged'); assert.equal(result.changedProfiles, 0); assert.deepEqual(h.data, before); assert.equal(h.calls.creates.length, 0);
});

test('Wagner and the principal coordinator are selected by unique stable identifiers with Auth UID/email checks', async () => {
  for (const mutate of [
    h => delete h.data.users.wagnerUid,
    h => { h.data.users.extra = { ...h.data.users.wagnerUid }; },
    h => { h.data.users.wagnerUid.active = false; },
    h => { h.data.users.wagnerUid.role = 'unknown'; },
    h => { h.data.users.albersonUid.role = 'teacher'; },
    h => { h.accounts.get('wagnerUid').email = 'wrong@example.test'; },
    h => { h.accounts.get('wagnerUid').disabled = true; },
    h => { h.accounts.get('albersonUid').disabled = true; }
  ]) {
    const h = harness(); mutate(h); const before = copy(h.data);
    await assert.rejects(h.run({ apply: true }), error => error instanceof ProvisioningError || error.code === 'auth/user-not-found');
    assert.deepEqual(h.data, before); assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.transactions.length, 0);
  }
});

test('legacy Wagner records without an email are promoted without adding or replacing fields', async () => {
  const h = harness(); delete h.data.users.wagnerUid.email; delete h.data.users.wagnerUid.active;
  const before = copy(h.data.users.wagnerUid); await h.run({ apply: true });
  assert.deepEqual(h.data.users.wagnerUid, { ...before, role: 'coordinator' });
});

test('an explicit legacy Wagner UID is verified against Auth without guessing names or replacing login identifiers', async () => {
  const h = harness(); delete h.data.users.wagnerUid.key;
  const before = copy(h.data.users.wagnerUid);
  await assert.rejects(h.run(), /identificador wagner/);
  await h.run({ apply: true, wagnerUid: 'wagnerUid' });
  assert.deepEqual(h.data.users.wagnerUid, { ...before, role: 'coordinator' });
  const wrong = harness();
  await assert.rejects(wrong.run({ apply: true, wagnerUid: 'anotherUid' }), /diverge/); assert.equal(wrong.calls.creates.length, 0);
  const noEmail = harness(); delete noEmail.data.users.wagnerUid.key; delete noEmail.data.users.wagnerUid.email;
  await assert.rejects(noEmail.run({ apply: true, wagnerUid: 'wagnerUid' }), /e-mail de acesso/);
  const mismatch = harness(); delete mismatch.data.users.wagnerUid.key; mismatch.accounts.get('wagnerUid').email = 'outro@example.test';
  await assert.rejects(mismatch.run({ apply: true, wagnerUid: 'wagnerUid' }), /difere/); assert.equal(mismatch.calls.creates.length, 0);
});

test('administrator identity conflicts and disabled accounts are never overwritten or reactivated implicitly', async () => {
  for (const setup of [
    () => harness({ adminProfile: existingAdmin() }),
    () => harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: true } }),
    () => harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false }, adminProfile: { ...existingAdmin(), active: false } }),
    () => harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false }, adminProfile: { ...existingAdmin(), key: 'another-identity' } }),
    () => { const h = harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false } }); h.data.users.other = existingAdmin(); return h; },
    () => { const h = harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false }, adminProfile: existingAdmin() }); h.data.users.other = { ...existingAdmin(), email: 'duplicate@example.test' }; return h; }
  ]) {
    const h = setup(), before = copy(h.data);
    await assert.rejects(h.run({ apply: true }), error => error instanceof ProvisioningError);
    assert.deepEqual(h.data, before); assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.transactions.length, 0);
  }
});

test('creating an administrator requires a runtime password, while a dry run never requires one', async () => {
  for (const password of [undefined, '', 'short', 'a'.repeat(129)]) {
    const h = harness(); await assert.rejects(h.run({ apply: true, password }), /BANCAFLOW_ADMIN_PASSWORD/); assert.equal(h.calls.creates.length, 0);
  }
  assert.equal((await harness().run({ password: undefined })).status, 'dry-run');
  const implicit = harness(); assert.equal((await implicit.run({ apply: 'false' })).status, 'dry-run'); assert.equal(implicit.calls.creates.length, 0);
});

test('reserved UID property names never alter a prototype or silently skip a requested promotion', () => {
  for (const uid of ['__proto__', 'constructor', 'prototype']) {
    const users = fixture().users;
    Object.defineProperty(users, uid, { enumerable: true, value: users.wagnerUid }); delete users.wagnerUid;
    assert.throws(() => planProvisioning(users, { wagnerAuth: { uid, email: 'wagner@example.test' }, albersonAuth: { uid: 'albersonUid', email: 'alberson@example.test' } }), /cadastro deve estar ativo/);
  }
});

test('transaction retries preserve concurrent users and fields and reject changed identities before any profile write', async () => {
  const h = harness({ retryTransaction(data) { data.users.concurrent = { name: 'Cadastro paralelo', role: 'teacher', key: 'parallel' }; data.users.wagnerUid.contactEmail = 'concurrent@example.test'; } });
  await h.run({ apply: true });
  assert.equal(h.data.users.concurrent.name, 'Cadastro paralelo'); assert.equal(h.data.users.wagnerUid.contactEmail, 'concurrent@example.test');
  const failed = harness({ beforeTransaction(data) { data.users.wagnerUid.key = 'changed'; } });
  await assert.rejects(failed.run({ apply: true }), /Wagner/);
  assert.equal(failed.data.users.wagnerUid.role, 'teacher'); assert.equal(failed.data.users.newAdminUid, undefined); assert.deepEqual(failed.calls.deletes, ['newAdminUid']);
});

test('a failed profile transaction rolls back only a newly created unpersisted Auth account', async () => {
  const h = harness({ transactionError: Error('fictitious database error') }), before = copy(h.data);
  await assert.rejects(h.run({ apply: true }), /fictitious database error/);
  assert.deepEqual(h.data, before); assert.deepEqual(h.calls.deletes, ['newAdminUid']); assert.equal(h.accounts.has('newAdminUid'), false);
  const existing = harness({ adminAuth: { uid: 'adminUid', email: ADMIN_EMAIL, disabled: false }, transactionError: Error('database unavailable') });
  await assert.rejects(existing.run({ apply: true })); assert.deepEqual(existing.calls.deletes, []); assert.equal(existing.accounts.has('adminUid'), true);
});

test('a lost transaction acknowledgement never deletes an Auth account whose profile was actually committed', async () => {
  const h = harness({ errorAfterCommit: true });
  await assert.rejects(h.run({ apply: true }), /acknowledgement interrupted/);
  assert.equal(h.data.users.newAdminUid.role, 'coordinator'); assert.equal(h.accounts.has('newAdminUid'), true); assert.deepEqual(h.calls.deletes, []);
});

test('uncertain rollback reads and cleanup failures preserve diagnosable state without leaking credentials', async () => {
  const uncertain = harness({ transactionError: Error('private-data-sentinel'), failRollbackRead: true });
  await assert.rejects(uncertain.run({ apply: true }), error => error.code === 'rollback-unverified');
  assert.deepEqual(uncertain.calls.deletes, []); assert.equal(uncertain.accounts.has('newAdminUid'), true);
  const cleanup = harness({ transactionError: Error('private-data-sentinel'), deleteError: Error('credential-sentinel') });
  await assert.rejects(cleanup.run({ apply: true }), error => error.code === 'rollback-failed' && !error.message.includes('credential-sentinel'));
  assert.ok(!safeError(Error('private-key-sentinel')).includes('private-key-sentinel'));
  assert.match(safeError(Object.assign(Error('private-token-sentinel'), { code: 'auth/insufficient-permission' })), /auth\/insufficient-permission/);
});

test('authentication creation errors never modify existing users or attempt to remove an account not created here', async () => {
  const h = harness({ createError: Object.assign(Error('existing account'), { code: 'auth/email-already-exists' }) }), before = copy(h.data);
  await assert.rejects(h.run({ apply: true }), error => error.code === 'auth/email-already-exists');
  assert.deepEqual(h.data, before); assert.deepEqual(h.calls.deletes, []); assert.equal(h.calls.transactions.length, 0);
});

test('CLI requires the explicit project and approved database, has a read-only default and never embeds a password', async () => {
  assert.deepEqual(parseArguments(['--project', PROJECT_ID]), { projectId: PROJECT_ID, apply: false, help: false });
  assert.equal(parseArguments(['--apply', '--project', PROJECT_ID]).apply, true); assert.equal(parseArguments(['--help']).help, true);
  assert.equal(parseArguments(['--project', PROJECT_ID, '--wagner-uid', 'known-uid']).wagnerUid, 'known-uid');
  for (const args of [[], ['--apply'], ['--project', 'other-project'], ['--project', PROJECT_ID, '--unknown'], ['--project', PROJECT_ID, '--project', PROJECT_ID]]) assert.throws(() => parseArguments(args), ProvisioningError);
  for (const value of ['', '__proto__', 'invalid/path', '--apply']) assert.throws(() => parseArguments(['--project', PROJECT_ID, '--wagner-uid', value]), ProvisioningError);
  const approved = 'https://avaliadortcc-default-rtdb.firebaseio.com';
  assert.equal(resolveDatabaseUrl({ BANCAFLOW_DATABASE_URL: approved }), approved); assert.equal(resolveDatabaseUrl({}), approved);
  for (const value of ['http://avaliadortcc-default-rtdb.firebaseio.com', approved + '/users', approved + '?token=sentinel', 'https://another-default-rtdb.firebaseio.com', 'https://username:secret@avaliadortcc-default-rtdb.firebaseio.com']) assert.throws(() => resolveDatabaseUrl({ BANCAFLOW_DATABASE_URL: value }), ProvisioningError);
  await assert.rejects(runCli(['--project', PROJECT_ID], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }), /emulador/);
  const output = []; await runCli(['--help'], {}, line => output.push(line)); assert.match(output[0], /Simular/); assert.match(helpText(), /BANCAFLOW_ADMIN_PASSWORD/);
  const source = readFileSync(join(__dirname, '..', 'scripts/provision-administrators.cjs'), 'utf8');
  assert.doesNotMatch(source, /createUser\(\{[^}]*password\s*:\s*['"][^'"]+['"]/); assert.doesNotMatch(source, /updateUser\s*\(/);
  assert.doesNotMatch(JSON.stringify(publicPlan(planProvisioning(fixture().users, { wagnerAuth: { uid: 'wagnerUid', email: 'wagner@example.test' }, albersonAuth: { uid: 'albersonUid', email: 'alberson@example.test' }, now: 1800000000000 }), 'dry-run')), /contactEmail|createdAt|passwordHash|private_key/);
});
