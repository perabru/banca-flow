/**
 * Native Firebase Auth + Realtime Database account lifecycle regression.
 * All identities are fictional and all traffic is restricted to local emulators.
 * Auth Emulator 14.22 does not model OOB expiration; invalid and consumed codes
 * are tested here, while expired-action feedback belongs to controller tests.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';

const require = createRequire(process.env.BANCAFLOW_RULES_DEPS
  ? join(process.env.BANCAFLOW_RULES_DEPS, 'package.json') : import.meta.url);
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { initializeApp, deleteApp } = require('firebase/app');
const authSdk = require('firebase/auth');
const dbSdk = require('firebase/database');
const projectId = 'demo-banca-flow-account';
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rules = await readFile(join(rootDir, 'database.rules.json'), 'utf8');
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
for (const target of [authHost, databaseHost]) {
  assert.match(target, /^(?:127\.0\.0\.1|localhost):\d+$/, 'Account tests must use local emulators.');
}
for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[key];
const [databaseAddress, databasePort] = databaseHost.split(':');
const password = 'Original!Account935';
const nextPassword = 'Changed!Account684';
let env, serial = 0;

before(async () => {
  env = await initializeTestEnvironment({ projectId,
    database: { host: databaseAddress, port: Number(databasePort), rules } });
  await env.clearDatabase();
}, { timeout: 15000 });
after(async () => { await env?.cleanup(); });

async function privileged(path = '') {
  let value;
  await env.withSecurityRulesDisabled(async ctx => {
    value = (await dbSdk.get(dbSdk.ref(ctx.database(), path))).val();
  });
  return value;
}

function nativeClient(t, label) {
  const app = initializeApp({ apiKey: 'demo-banca-flow-account-key', projectId,
    authDomain: `${projectId}.firebaseapp.com`, databaseURL: `https://${projectId}.firebaseio.com` },
  `${label}-${++serial}`);
  const auth = authSdk.getAuth(app);
  authSdk.connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const database = dbSdk.getDatabase(app);
  dbSdk.connectDatabaseEmulator(database, databaseAddress, Number(databasePort));
  t.after(async () => { await authSdk.signOut(auth); dbSdk.goOffline(database); await deleteApp(app); });
  return { app, auth, database };
}

async function account(t, label, { primary = false } = {}) {
  const client = nativeClient(t, label), email = `${label}-${serial}@example.test`;
  const { user } = await authSdk.createUserWithEmailAndPassword(client.auth, email, password);
  const uid = user.uid, boardId = `b-${uid}`, groupId = `g-${uid}`;
  const academic = {
    groups: { [groupId]: { id: groupId, name: 'Grupo histórico', className: '2A', title: 'Projeto preservado', advisorUid: uid, students: { student: 'Aluna fictícia' } } },
    boards: { [boardId]: { groupId, advisorUid: uid, members: { [uid]: true }, memberNames: { [uid]: 'Professor fictício' }, startAt: 1792537200000 } },
    grades: { [boardId]: { [uid]: { student: { presentation: 8, practice: 9, code: 7, time: 0 } } } },
    deliveries: { [boardId]: { student: 9 } },
    timers: { [boardId]: { elapsedMs: 900010, startedAt: 0, revision: 2 } },
    seals: { [boardId]: { by: uid, at: 1792538100010 } }
  };
  await env.withSecurityRulesDisabled(async ctx => {
    const changes = { [`users/${uid}`]: { name: 'Professor fictício', email,
      role: primary ? 'coordinator' : 'teacher', key: primary ? 'alberson' : `p-${uid}`, active: true } };
    for (const [path, rows] of Object.entries(academic)) for (const [id, value] of Object.entries(rows)) changes[`${path}/${id}`] = value;
    await dbSdk.update(dbSdk.ref(ctx.database()), changes);
  });
  const preserved = async () => {
    for (const [path, rows] of Object.entries(academic)) for (const [id, expected] of Object.entries(rows)) {
      assert.deepEqual(await privileged(`${path}/${id}`), expected, `${path}/${id} must survive account changes`);
    }
  };
  return { ...client, user, uid, email, preserved };
}

async function outOfBand(email, requestType) {
  const response = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/oobCodes`);
  assert.equal(response.status, 200);
  const { oobCodes = [] } = await response.json();
  const code = oobCodes.filter(row => row.email === email && row.requestType === requestType).at(-1);
  assert.ok(code?.oobCode, `${requestType} must exist only in the local emulator`);
  return code;
}

test('native password reset verifies a one-use code and keeps UID, membership, zero grades and history', { timeout: 20000 }, async t => {
  const first = await account(t, 'password-reset');
  await authSdk.sendPasswordResetEmail(first.auth, first.email);
  const code = await outOfBand(first.email, 'PASSWORD_RESET');
  assert.equal(await authSdk.verifyPasswordResetCode(first.auth, code.oobCode), first.email);
  await authSdk.confirmPasswordReset(first.auth, code.oobCode, nextPassword);
  await assert.rejects(authSdk.verifyPasswordResetCode(first.auth, code.oobCode), { code: 'auth/invalid-action-code' });
  await authSdk.signOut(first.auth);
  await assert.rejects(authSdk.signInWithEmailAndPassword(first.auth, first.email, password), error =>
    ['auth/wrong-password', 'auth/invalid-credential'].includes(error.code));
  const signed = await authSdk.signInWithEmailAndPassword(first.auth, first.email, nextPassword);
  assert.equal(signed.user.uid, first.uid);
  assert.equal((await dbSdk.get(dbSdk.ref(first.database, `users/${first.uid}`))).val().email, first.email);
  await first.preserved();
});

test('verified e-mail change keeps the old login until confirmation, then preserves UID and synchronizes the canonical token e-mail', { timeout: 20000 }, async t => {
  const first = await account(t, 'email-change'), other = nativeClient(t, 'email-check');
  const nextEmail = `verified-${first.uid}@example.test`.toLowerCase();
  await authSdk.reauthenticateWithCredential(first.user, authSdk.EmailAuthProvider.credential(first.email, password));
  await authSdk.verifyBeforeUpdateEmail(first.user, nextEmail);
  assert.equal(first.user.email, first.email);
  assert.equal((await authSdk.signInWithEmailAndPassword(other.auth, first.email, password)).user.uid, first.uid);
  await assert.rejects(authSdk.signInWithEmailAndPassword(other.auth, nextEmail, password), error =>
    ['auth/user-not-found', 'auth/invalid-credential'].includes(error.code));
  assert.equal(await privileged(`users/${first.uid}/email`), first.email);
  await assertFails(dbSdk.set(dbSdk.ref(first.database, `users/${first.uid}/email`), nextEmail));
  const code = await outOfBand(first.email, 'VERIFY_AND_CHANGE_EMAIL');
  const info = await authSdk.checkActionCode(other.auth, code.oobCode);
  assert.equal(info.operation, 'VERIFY_AND_CHANGE_EMAIL');
  assert.equal(code.newEmail, nextEmail);
  await authSdk.applyActionCode(other.auth, code.oobCode);
  await authSdk.signOut(other.auth);
  await assert.rejects(authSdk.signInWithEmailAndPassword(other.auth, first.email, password), error =>
    ['auth/user-not-found', 'auth/invalid-credential'].includes(error.code));
  const signed = await authSdk.signInWithEmailAndPassword(other.auth, nextEmail, password);
  assert.equal(signed.user.uid, first.uid);
  const token = await authSdk.getIdTokenResult(signed.user, true);
  assert.equal(token.claims.email, nextEmail);
  assert.equal(token.claims.email_verified, true);
  await dbSdk.set(dbSdk.ref(other.database, `users/${first.uid}/email`), nextEmail);
  assert.equal(await privileged(`users/${first.uid}/email`), nextEmail);
  await assertFails(dbSdk.set(dbSdk.ref(other.database, `users/${first.uid}/email`), 'unverified-impostor@example.test'));
  await assertFails(dbSdk.set(dbSdk.ref(other.database, `users/${first.uid}/role`), 'coordinator'));
  await assert.rejects(authSdk.applyActionCode(other.auth, code.oobCode), { code: 'auth/invalid-action-code' });
  await first.preserved();
});

test('the primary coordinator can synchronize a verified e-mail without changing key, role, UID or academic records', { timeout: 20000 }, async t => {
  const first = await account(t, 'primary-email', { primary: true });
  const nextEmail = `primary-${first.uid}@example.test`.toLowerCase();
  await authSdk.verifyBeforeUpdateEmail(first.user, nextEmail);
  const code = await outOfBand(first.email, 'VERIFY_AND_CHANGE_EMAIL');
  await authSdk.applyActionCode(first.auth, code.oobCode);
  await authSdk.signOut(first.auth);
  const { user } = await authSdk.signInWithEmailAndPassword(first.auth, nextEmail, password);
  await authSdk.getIdToken(user, true);
  await dbSdk.set(dbSdk.ref(first.database, `users/${first.uid}/email`), nextEmail);
  assert.deepEqual(await privileged(`users/${first.uid}`), { name: 'Professor fictício', email: nextEmail,
    key: 'alberson', role: 'coordinator', active: true });
  assert.equal(user.uid, first.uid);
  await first.preserved();
});

test('invalid native action codes reject every account action and leave existing access and data intact', { timeout: 20000 }, async t => {
  const first = await account(t, 'invalid-actions');
  await assert.rejects(authSdk.verifyPasswordResetCode(first.auth, 'invalid-fictional-oob'), { code: 'auth/invalid-action-code' });
  await assert.rejects(authSdk.confirmPasswordReset(first.auth, 'invalid-fictional-oob', nextPassword), { code: 'auth/invalid-action-code' });
  await assert.rejects(authSdk.checkActionCode(first.auth, 'invalid-fictional-oob'), { code: 'auth/invalid-action-code' });
  await assert.rejects(authSdk.applyActionCode(first.auth, 'invalid-fictional-oob'), { code: 'auth/invalid-action-code' });
  await authSdk.signOut(first.auth);
  assert.equal((await authSdk.signInWithEmailAndPassword(first.auth, first.email, password)).user.uid, first.uid);
  assert.equal(await privileged(`users/${first.uid}/email`), first.email);
  await first.preserved();
});
