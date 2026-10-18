/**
 * Regression tests for the ORIGINAL, UNCHANGED Realtime Database permissions.
 * Uses an isolated local emulator and fictional data. The pinned hash is from
 * the firebase-rules script in the original HEAD:index.html.
 * Dependencies: firebase, @firebase/rules-unit-testing, firebase-tools@14.22.0.
 * BANCAFLOW_RULES_DEPS may point to an external npm installation prefix.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';

const require = createRequire(process.env.BANCAFLOW_RULES_DEPS
  ? join(process.env.BANCAFLOW_RULES_DEPS, 'package.json')
  : import.meta.url);
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, set, get, update, remove } = require('firebase/database');
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(rootDir, 'index.html'), 'utf8');
const embedded = html.match(/<script[^>]*id="firebase-rules"[^>]*>([\s\S]*?)<\/script>/)[1];
const ORIGINAL_RULES_SHA256 = 'c7d4435f72c0c99c805dafdd4204bbbe75a64ff24cab633932bcdef5a6486347';
assert.equal(createHash('sha256').update(embedded).digest('hex'), ORIGINAL_RULES_SHA256,
  'The embedded Firebase rules must remain byte-for-byte identical to the original rules.');
const legacyHtml = await readFile(join(rootDir, 'BancaFlow_TCC_2026_Unico.html'), 'utf8');
const legacyEmbedded = legacyHtml.match(/<script[^>]*id="firebase-rules"[^>]*>([\s\S]*?)<\/script>/)[1];
const ORIGINAL_LEGACY_RULES_SHA256 = '4645e05401fe881dc2bd06d661128c2f4f4f66f7124765876bfee96f29536d30';
assert.equal(createHash('sha256').update(legacyEmbedded).digest('hex'), ORIGINAL_LEGACY_RULES_SHA256,
  'The legacy HTML must preserve its own original embedded Firebase rules byte-for-byte.');
const rules = JSON.parse(embedded);
const [host = '127.0.0.1', port = '9000'] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
// The Node RTDB WebSocket SDK ignores NO_PROXY. Keep emulator requests local.
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[key];
}
let env;
const grade = { presentation: 8, practice: 9, code: 7, time: 8 };
const fixture = () => ({
  users: {
    coord: { name: 'Coordenação', email: 'coord@example.test', role: 'coordinator', key: 'alberson', active: true },
    teacher1: { name: 'Professor 1', email: 'one@example.test', role: 'teacher', key: 'one', active: true },
    teacher2: { name: 'Professor 2', email: 'two@example.test', role: 'teacher', key: 'two', active: true },
    outsider: { name: 'Outro professor', email: 'other@example.test', role: 'teacher', key: 'other', active: true },
    disabled: { name: 'Desativado', email: 'off@example.test', role: 'teacher', key: 'off', active: false }
  },
  groups: { g1: { id: 'g1', name: 'Grupo 1', className: '2A', title: 'Projeto', advisorUid: 'teacher1', students: { s1: 'Aluno 1', s2: 'Aluno 2' } } },
  boards: { b1: { groupId: 'g1', advisorUid: 'teacher1', advisorName: 'Professor 1', members: { teacher1: true, teacher2: true, disabled: true }, memberNames: { teacher1: 'Professor 1', teacher2: 'Professor 2', disabled: 'Desativado' }, startAt: 900000, durationMin: 30, room: 'Laboratório', createdBy: 'coord', createdAt: 1 } },
  groupBoards: { g1: 'b1' },
  locks: { slice: { teacher1: 'b1', teacher2: 'b1' } },
  roomLocks: { slice: { room1: 'b1' } },
  grades: { b1: { teacher1: { s1: grade, s2: grade }, teacher2: { s1: grade, s2: grade } } },
  deliveries: { b1: { s1: 9, s2: 8 } }
});
const db = uid => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
const seal = (uid = 'coord') => ({ by: uid, at: Date.now() });
const bypass = async (path, value) => env.withSecurityRulesDisabled(async ctx => set(ref(ctx.database(), path), value));
const readPrivileged = async path => {
  let value;
  await env.withSecurityRulesDisabled(async ctx => { value = (await get(ref(ctx.database(), path))).val(); });
  return value;
};

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-banca-flow', database: { host, port: Number(port), rules: embedded } });
}, { timeout: 15000 });
beforeEach(async () => { await env.clearDatabase(); await bypass('/', fixture()); }, { timeout: 15000 });
after(async () => { await env?.cleanup(); });

test('original rules preserve exactly the original application data branches', () => {
  assert.deepEqual(Object.keys(rules.rules).filter(key => !key.startsWith('.')).sort(),
    ['users', 'groups', 'boards', 'groupBoards', 'locks', 'roomLocks', 'grades', 'deliveries', 'seals'].sort());
  assert.equal(rules.rules['.read'], false);
  assert.equal(rules.rules['.write'], false);
  assert.equal(rules.rules.timers, undefined);
});

test('professor reads and updates only own individual grades while board is open', async () => {
  await assertSucceeds(get(ref(db('teacher1'), 'grades/b1/teacher1')));
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), { ...grade, presentation: 0 }));
  await assertFails(get(ref(db('teacher1'), 'grades/b1/teacher2')));
  await assertFails(get(ref(db('teacher1'), 'grades/b1')));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher2/s1'), grade));
  await assertSucceeds(get(ref(db('coord'), 'grades')));
});

test('only coordinator reads or writes delivery grades', async () => {
  await assertFails(get(ref(db('teacher1'), 'deliveries/b1')));
  await assertFails(set(ref(db('teacher1'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 11));
});

test('original policy denies official closure by a professor, including assigned evaluators', async () => {
  for (const uid of ['teacher1', 'teacher2', 'outsider', 'disabled', null]) {
    await assertFails(set(ref(db(uid), 'seals/b1'), seal(uid || 'anonymous')));
  }
  assert.equal(await readPrivileged('seals/b1'), null);
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
});

test('coordinator can officially close a board once, locking grades and deliveries', async () => {
  await assertSucceeds(set(ref(db('coord'), 'seals/b1'), seal()));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertFails(set(ref(db('coord'), 'seals/b1'), seal()));
});

test('original policy denies reopening to professors and coordinator without changing saved data', async () => {
  const savedSeal = seal();
  await bypass('seals/b1', savedSeal);
  const beforeData = await readPrivileged('/');
  for (const uid of ['coord', 'teacher1', 'teacher2', 'outsider', 'disabled', null]) {
    await assertFails(remove(ref(db(uid), 'seals/b1')));
  }
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

test('original policy denies any timer database writes or reads, including coordinator', async () => {
  const timer = { elapsedMs: 12345, startedAt: 0, updatedBy: 'coord', updatedAt: Date.now(), revision: 1 };
  for (const uid of ['coord', 'teacher1', 'teacher2', 'outsider', null]) {
    await assertFails(set(ref(db(uid), 'timers/b1'), timer));
    await assertFails(get(ref(db(uid), 'timers/b1')));
  }
  assert.equal(await readPrivileged('timers'), null);
});

test('no lifecycle or timer metadata can be hidden inside existing board or grades', async () => {
  const beforeData = await readPrivileged('/');
  await assertFails(set(ref(db('teacher1'), 'boards/b1/members/outsider'), true));
  await assertFails(set(ref(db('teacher1'), 'boards/b1/timer'), { elapsedMs: 12345 }));
  await assertFails(set(ref(db('coord'), 'boards/b1/timer'), { elapsedMs: 12345 }));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), { ...grade, closed: true }));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), { grade: 9, elapsedMs: 12345 }));
  await assertFails(remove(ref(db('teacher1'), 'boards/b1')));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

test('unauthorized multipath operation is atomic and preserves the original records', async () => {
  const beforeData = await readPrivileged('/');
  await assertFails(update(ref(db('teacher1')), {
    'grades/b1/teacher1/s1': { ...grade, presentation: 10 },
    'seals/b1': seal('teacher1')
  }));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

test('coordinator closure rejects nonexistent board and seal impersonation', async () => {
  await assertFails(set(ref(db('coord'), 'seals/missing'), seal()));
  await assertFails(set(ref(db('coord'), 'seals/b1'), seal('teacher1')));
});
