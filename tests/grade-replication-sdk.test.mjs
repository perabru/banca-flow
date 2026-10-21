/** Atomic grade replication through the real Firebase SDK and local rules.
 * Every account is fictitious and each scenario uses a separate demo namespace.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(process.env.BANCAFLOW_RULES_DEPS
  ? join(process.env.BANCAFLOW_RULES_DEPS, 'package.json')
  : import.meta.url);
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, set, update, get } = require('firebase/database');
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rules = JSON.parse(await readFile(join(rootDir, 'database.rules.json'), 'utf8'));
const [host = '127.0.0.1', port = '9000'] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[key];
}
const scores = (presentation = 8, practice = 9, code = 7, time = 8) => ({ presentation, practice, code, time });
const replicated = scores(0, 10, 6.5, 0);
const clone = value => JSON.parse(JSON.stringify(value));
const fixture = (count = 3) => {
  const students = Object.fromEntries(Array.from({ length: count }, (_, index) => ['s' + (index + 1), ['Ana', 'Bruno', 'Carla'][index]]));
  return {
    users: {
      teacher1: { name: 'Professor Um', role: 'teacher', active: true },
      teacher2: { name: 'Professora Dois', role: 'teacher', active: true },
      coord: { name: 'Alberson', role: 'coordinator', key: 'alberson', active: true },
      outsider: { name: 'Outro Professor', role: 'teacher', active: true },
      disabled: { name: 'Professor Desativado', role: 'teacher', active: false }
    },
    groups: { g1: { id: 'g1', name: 'Grupo de teste', students, active: true } },
    boards: { b1: { groupId: 'g1', members: { teacher1: true, teacher2: true, coord: true, disabled: true } } },
    grades: { b1: {
      teacher1: Object.fromEntries(Object.keys(students).map((sid, index) => [sid, scores(index + 1, index + 2, index + 3, index + 4)])),
      teacher2: Object.fromEntries(Object.keys(students).map(sid => [sid, scores(9, 8, 7, 6)])),
      coord: Object.fromEntries(Object.keys(students).map(sid => [sid, scores(1, 2, 3, 4)]))
    } },
    deliveries: { b1: Object.fromEntries(Object.keys(students).map((sid, index) => [sid, index === 0 ? 0 : 9])) },
    timers: { b1: { elapsedMs: 900001, startedAt: 0, revision: 1 } }
  };
};
const batch = students => Object.fromEntries(Object.keys(students).map(sid => [sid, { ...replicated }]));
async function environment(t, name, count = 3) {
  const env = await initializeTestEnvironment({ projectId: `demo-banca-flow-replicate-${name}`, database: { host, port: Number(port), rules: JSON.stringify(rules) } });
  t.after(() => env.cleanup());
  await env.clearDatabase();
  await bypass(env, '', fixture(count));
  return env;
}
async function bypass(env, path, value) {
  await env.withSecurityRulesDisabled(context => set(path ? ref(context.database(), path) : ref(context.database()), value));
}
async function privileged(env, path = '') {
  let value;
  await env.withSecurityRulesDisabled(async context => { value = (await get(path ? ref(context.database(), path) : ref(context.database()))).val(); });
  return value;
}
const connection = (env, uid) => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();

for (const count of [2, 3]) {
  test(`teacher atomically replicates all four scores including zero to ${count} students without changing another evaluator or monograph`, async t => {
    const env = await environment(t, 'accepted-' + count, count), before = await privileged(env);
    const copied = batch(before.groups.g1.students);
    await assertSucceeds(update(ref(connection(env, 'teacher1'), 'grades/b1/teacher1'), copied));
    const after = await privileged(env);
    assert.deepEqual(after.grades.b1.teacher1, copied);
    before.grades.b1.teacher1 = copied;
    assert.deepEqual(after, before, 'only the intended author/student scores may change');
  });
}

test('assigned coordinator replicates own evaluations with the same restrictions as another evaluator', async t => {
  const env = await environment(t, 'coordinator'), before = await privileged(env), copied = batch(before.groups.g1.students);
  await assertSucceeds(update(ref(connection(env, 'coord'), 'grades/b1/coord'), copied));
  const after = await privileged(env);
  before.grades.b1.coord = copied;
  assert.deepEqual(after, before);
  await assertFails(update(ref(connection(env, 'coord'), 'grades/b1/teacher1'), copied));
  assert.deepEqual(await privileged(env), after);
});

test('concurrent saves by another evaluator and monograph coordinator are preserved during replication', async t => {
  const env = await environment(t, 'concurrent-authors'), before = await privileged(env), copied = batch(before.groups.g1.students);
  const otherScores = scores(2, 4, 6, 8);
  await Promise.all([
    assertSucceeds(update(ref(connection(env, 'teacher1'), 'grades/b1/teacher1'), copied)),
    assertSucceeds(set(ref(connection(env, 'teacher2'), 'grades/b1/teacher2/s2'), otherScores)),
    assertSucceeds(set(ref(connection(env, 'coord'), 'deliveries/b1/s3'), 7.5))
  ]);
  before.grades.b1.teacher1 = copied;
  before.grades.b1.teacher2.s2 = otherScores;
  before.deliveries.b1.s3 = 7.5;
  assert.deepEqual(await privileged(env), before);
});

test('one invalid student or score rejects the complete replication and leaves every saved score unchanged', async t => {
  const env = await environment(t, 'invalid-child'), before = await privileged(env), copied = batch(before.groups.g1.students);
  const variants = [
    { ...copied, foreignStudent: { ...replicated } },
    { ...copied, s3: { ...replicated, presentation: 11 } },
    { ...copied, s2: { ...replicated, practice: '10' } },
    { ...copied, s2: { presentation: 0, practice: 10, code: 6.5 } },
    { ...copied, s3: { ...replicated, injected: true } },
    { ...copied, s2: null }
  ];
  for (const candidate of variants) {
    await assertFails(update(ref(connection(env, 'teacher1'), 'grades/b1/teacher1'), candidate));
    assert.deepEqual(await privileged(env), before, 'a rejected batch must not partially update valid students');
  }
});

test('a replication cannot target another author or mix own scores with another author or monograph values', async t => {
  const env = await environment(t, 'other-author'), before = await privileged(env), copied = batch(before.groups.g1.students);
  await assertFails(update(ref(connection(env, 'teacher1'), 'grades/b1/teacher2'), copied));
  assert.deepEqual(await privileged(env), before);
  await assertFails(update(ref(connection(env, 'teacher1')), {
    'grades/b1/teacher1/s1': { ...replicated },
    'grades/b1/teacher1/s2': { ...replicated },
    'grades/b1/teacher2/s3': { ...replicated }
  }));
  assert.deepEqual(await privileged(env), before);
  await assertFails(update(ref(connection(env, 'teacher1')), {
    'grades/b1/teacher1/s1': { ...replicated },
    'grades/b1/teacher1/s2': { ...replicated },
    'deliveries/b1/s3': 10
  }));
  assert.deepEqual(await privileged(env), before);
});

test('closed, archived or no-longer-assigned banks reject a prepared batch atomically', async t => {
  const env = await environment(t, 'authorization-changed');
  const variants = [
    ['seals/b1', { by: 'teacher2', at: Date.now() }],
    ['groups/g1/active', false],
    ['boards/b1/members/teacher1', null],
    ['users/teacher1/active', false],
    ['users/teacher1/role', 'invalid']
  ];
  for (const [path, value] of variants) {
    await bypass(env, '', fixture());
    const copied = batch((await privileged(env, 'groups/g1')).students);
    await bypass(env, path, value);
    const beforeWrite = await privileged(env);
    await assertFails(update(ref(connection(env, 'teacher1'), 'grades/b1/teacher1'), copied));
    assert.deepEqual(await privileged(env), beforeWrite, 'fresh server permissions apply to every student in the batch');
  }
});

test('unassigned, disabled and anonymous clients cannot replicate any own or assigned teacher evaluation', async t => {
  const env = await environment(t, 'rejected-identities'), before = await privileged(env), copied = batch(before.groups.g1.students);
  for (const uid of ['outsider', 'disabled', null]) {
    await assertFails(update(ref(connection(env, uid), `grades/b1/${uid || 'anonymous'}`), clone(copied)));
    await assertFails(update(ref(connection(env, uid), 'grades/b1/teacher1'), clone(copied)));
    assert.deepEqual(await privileged(env), before);
  }
});
