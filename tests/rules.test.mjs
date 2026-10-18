/**
 * Integration tests for the exact Realtime Database rules embedded in index.html.
 * Runs against the local Firebase Database emulator, never the production DB.
 * Dependencies: firebase, @firebase/rules-unit-testing (and firebase-tools to start
 * the emulator). Set BANCAFLOW_RULES_DEPS to an external npm prefix if desired.
 */
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
const rules = JSON.parse(html.match(/<script[^>]*id="firebase-rules"[^>]*>([\s\S]*?)<\/script>/)[1]);
const [host = '127.0.0.1', port = '9000'] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
// The Node RTDB WebSocket SDK ignores NO_PROXY. Local emulator requests must
// remain on loopback even when a development environment configures a proxy.
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[key];
}
let env;
const now = () => Date.now();
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
  grades: { b1: { teacher1: { s1: grade, s2: grade }, teacher2: { s1: grade, s2: grade } } },
  deliveries: { b1: { s1: 9, s2: 8 } }
});
const db = uid => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
const timer = (uid = 'teacher1', revision = 1, extra = {}) => ({ elapsedMs: 12345, startedAt: 0, updatedAt: now(), updatedBy: uid, revision, ...extra });
const seal = (uid = 'teacher1') => ({ by: uid, at: now() });
const bypass = async (path, value) => env.withSecurityRulesDisabled(async ctx => set(ref(ctx.database(), path), value));

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-banca-flow', database: { host, port: Number(port), rules: JSON.stringify(rules) } });
}, { timeout: 15000 });
beforeEach(async () => { await env.clearDatabase(); await bypass('/', fixture()); }, { timeout: 15000 });
after(async () => { await env?.cleanup(); });

test('professor reads only own grades; coordinator reads all grades', async () => {
  await assertSucceeds(get(ref(db('teacher1'), 'grades/b1/teacher1')));
  await assertFails(get(ref(db('teacher1'), 'grades/b1/teacher2')));
  await assertFails(get(ref(db('teacher1'), 'grades/b1')));
  await assertSucceeds(get(ref(db('coord'), 'grades')));
});

test('only coordinator reads or writes delivery grades', async () => {
  await assertFails(get(ref(db('teacher1'), 'deliveries/b1')));
  await assertFails(set(ref(db('teacher1'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 11));
});

test('assigned professor closes; another assigned professor reopens without deleting grades', async () => {
  await assertSucceeds(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(remove(ref(db('teacher2'), 'seals/b1')));
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertSucceeds(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(get(ref(db('coord'), 'grades/b1/teacher2/s2')));
});

test('coordinator closes and reopens even when not a board evaluator', async () => {
  await assertSucceeds(set(ref(db('coord'), 'seals/b1'), seal('coord')));
  await assertSucceeds(remove(ref(db('coord'), 'seals/b1')));
});

test('unassigned, disabled and unauthenticated accounts cannot close or reopen', async () => {
  for (const uid of ['outsider', 'disabled', null]) await assertFails(set(ref(db(uid), 'seals/b1'), seal(uid || 'anonymous')));
  await bypass('seals/b1', seal());
  for (const uid of ['outsider', 'disabled', null]) await assertFails(remove(ref(db(uid), 'seals/b1')));
});

test('seal cannot target nonexistent board or impersonate a different teacher', async () => {
  await assertFails(set(ref(db('teacher1'), 'seals/missing'), seal()));
  await assertFails(set(ref(db('teacher1'), 'seals/b1'), seal('teacher2')));
  await assertFails(set(ref(db('teacher1'), 'seals/b1'), { ...seal(), extra: true }));
});

test('closing with delivery grades pending is allowed and legacy by/at seals reopen', async () => {
  await bypass('deliveries/b1', null);
  await assertSucceeds(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertSucceeds(remove(ref(db('coord'), 'seals/b1')));
});

test('timer uses a separate branch; professor cannot mutate a board or its membership', async () => {
  await assertSucceeds(set(ref(db('teacher1'), 'timers/b1'), timer()));
  await assertFails(set(ref(db('teacher1'), 'boards/b1/members/outsider'), true));
  await assertFails(set(ref(db('teacher1'), 'boards/b1/timer'), timer()));
  await assertFails(set(ref(db('teacher1'), 'boards/b1'), fixture().boards.b1));
  await assertFails(remove(ref(db('teacher1'), 'boards/b1')));
});

test('timer is available only to active members or coordinator', async () => {
  await bypass('timers/b1', timer());
  await assertSucceeds(get(ref(db('teacher2'), 'timers/b1')));
  await assertSucceeds(get(ref(db('coord'), 'timers/b1')));
  for (const uid of ['outsider', 'disabled', null]) {
    await assertFails(get(ref(db(uid), 'timers/b1')));
    await assertFails(set(ref(db(uid), 'timers/b1'), timer(uid, 2)));
  }
  await assertFails(set(ref(db('teacher1'), 'timers/missing'), timer()));
});

test('timer validation rejects malformed, fractional and stale updates', async () => {
  await assertSucceeds(set(ref(db('teacher1'), 'timers/b1'), timer()));
  for (const change of [
    { revision: 1 }, { revision: 3 }, { elapsedMs: -1 }, { elapsedMs: 1.5 },
    { startedAt: now() + 120000 }, { updatedAt: now() + 120000 },
    { updatedBy: 'teacher2' }, { extra: true }
  ]) await assertFails(set(ref(db('teacher1'), 'timers/b1'), timer('teacher1', 2, change)));
  await assertSucceeds(set(ref(db('teacher2'), 'timers/b1'), timer('teacher2', 2)));
  await assertFails(remove(ref(db('teacher2'), 'timers/b1')));
});

test('running timer closes atomically with a frozen elapsed value', async () => {
  await bypass('timers/b1', timer('teacher1', 1, { startedAt: now() - 1000 }));
  await assertFails(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertSucceeds(update(ref(db('teacher1')), {
    'seals/b1': seal(),
    'timers/b1': timer('teacher1', 2, { elapsedMs: 13345 })
  }));
  await assertFails(set(ref(db('teacher2'), 'timers/b1'), timer('teacher2', 3)));
  await assertSucceeds(update(ref(db('teacher2')), {
    'seals/b1': null,
    'timers/b1': timer('teacher2', 3, { elapsedMs: 13345 })
  }));
});

test('stale atomic close is rejected entirely, preserving open seal and current timer', async () => {
  await bypass('timers/b1', timer('teacher1', 2));
  await assertFails(update(ref(db('teacher2')), {
    'seals/b1': seal('teacher2'),
    'timers/b1': timer('teacher2', 2)
  }));
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
});
