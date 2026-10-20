/**
 * Tests the exact Firebase rules embedded in index.html against a local emulator.
 * All accounts and grades are fictional. No production project is accessed.
 * Dependencies: firebase, @firebase/rules-unit-testing, firebase-tools@14.22.0.
 * BANCAFLOW_RULES_DEPS may point to an external npm installation prefix.
 */
import assert from 'node:assert/strict';
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
const rules = JSON.parse(await readFile(join(rootDir, 'database.rules.json'), 'utf8'));
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
    otherCoord: { name: 'Outra coordenação', email: 'othercoord@example.test', role: 'coordinator', key: 'another', active: true },
    teacher1: { name: 'Professor 1', email: 'one@example.test', role: 'teacher', key: 'one', active: true },
    teacher2: { name: 'Professor 2', email: 'two@example.test', role: 'teacher', key: 'two', active: true },
    outsider: { name: 'Outro professor', email: 'other@example.test', role: 'teacher', key: 'other', active: true },
    disabled: { name: 'Desativado', email: 'off@example.test', role: 'teacher', key: 'off', active: false }
  },
  groups: {
    g1: { id: 'g1', name: 'Grupo 1', className: '2A', title: 'Projeto', advisorUid: 'teacher1', students: { s1: 'Aluno 1', s2: 'Aluno 2' } },
    g2: { id: 'g2', name: 'Grupo 2', className: '2B', title: 'Novo projeto', advisorUid: 'teacher1', students: { s3: 'Aluno 3', s4: 'Aluno 4' } }
  },
  boards: { b1: { groupId: 'g1', advisorUid: 'teacher1', advisorName: 'Professor 1', members: { teacher1: true, teacher2: true, disabled: true }, memberNames: { teacher1: 'Professor 1', teacher2: 'Professor 2', disabled: 'Desativado' }, startAt: 900000, durationMin: 30, room: 'Laboratório', createdBy: 'coord', createdAt: 1 } },
  groupBoards: { g1: 'b1' },
  locks: { slice: { teacher1: 'b1', teacher2: 'b1' } },
  roomLocks: { slice: { room1: 'b1' } },
  grades: { b1: { teacher1: { s1: grade, s2: grade }, teacher2: { s1: grade, s2: grade } } },
  deliveries: { b1: { s1: 9, s2: 8 } }
});
const db = uid => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
const timer = (uid = 'teacher1', revision = 1, extra = {}) => ({ elapsedMs: 12345, startedAt: 0, updatedAt: Date.now(), updatedBy: uid, revision, ...extra });
const seal = (uid = 'teacher1') => ({ by: uid, at: Date.now() });
const bypass = async (path, value) => env.withSecurityRulesDisabled(async ctx => set(ref(ctx.database(), path), value));
const readPrivileged = async path => {
  let value;
  await env.withSecurityRulesDisabled(async ctx => { value = (await get(ref(ctx.database(), path))).val(); });
  return value;
};

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-banca-flow', database: { host, port: Number(port), rules: JSON.stringify(rules) } });
}, { timeout: 15000 });
beforeEach(async () => { await env.clearDatabase(); await bypass('/', fixture()); }, { timeout: 15000 });
after(async () => { await env?.cleanup(); });

test('published JSON matches embedded rules and individual evaluation privacy remains explicit', () => {
  assert.deepEqual(JSON.parse(embedded), rules);
  assert.equal(rules.rules['.read'], false);
  assert.equal(rules.rules['.write'], false);
  assert.match(rules.rules.grades['$bid']['$uid']['.read'], /auth\.uid === \$uid/);
  assert.match(rules.rules.deliveries['.read'], /role'\)\.val\(\) === 'coordinator'/);
});

test('teacher reads only own evaluations before and after closure; coordinator reads all', async () => {
  for (const closed of [false, true]) {
    if (closed) await bypass('seals/b1', seal());
    await assertSucceeds(get(ref(db('teacher1'), 'grades/b1/teacher1')));
    await assertFails(get(ref(db('teacher1'), 'grades/b1/teacher2')));
    await assertFails(get(ref(db('teacher1'), 'grades/b1')));
    await assertFails(get(ref(db('teacher1'), 'deliveries/b1')));
    await assertSucceeds(get(ref(db('coord'), 'grades')));
  }
});

test('only coordinator reads and writes delivery grades; zero remains valid', async () => {
  await assertFails(get(ref(db('teacher1'), 'deliveries/b1')));
  await assertFails(set(ref(db('teacher1'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(set(ref(db('coord'), 'deliveries/b1/s1'), 0));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 11));
});

test('assigned teacher closes and another reopens, preserving every existing record', async () => {
  const beforeData = await readPrivileged('/');
  await assertSucceeds(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(remove(ref(db('teacher2'), 'seals/b1')));
  assert.deepEqual(await readPrivileged('/'), beforeData);
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertSucceeds(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
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

test('seal validates board, author, current timestamp and exact schema; cannot overwrite closure', async () => {
  await assertFails(set(ref(db('teacher1'), 'seals/missing'), seal()));
  await assertFails(set(ref(db('teacher1'), 'seals/b1'), seal('teacher2')));
  for (const change of [{ at: 1 }, { at: Date.now() + 120000 }, { at: Date.now() + 0.5 }, { extra: true }]) {
    await assertFails(set(ref(db('teacher1'), 'seals/b1'), { ...seal(), ...change }));
  }
  await assertSucceeds(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertFails(set(ref(db('teacher2'), 'seals/b1'), seal('teacher2')));
});

test('closure may precede deliveries and legacy by/at seals still reopen', async () => {
  await bypass('deliveries/b1', null);
  await assertSucceeds(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertSucceeds(remove(ref(db('coord'), 'seals/b1')));
  await bypass('seals/b1', { by: 'coord', at: 1 });
  await assertSucceeds(remove(ref(db('teacher2'), 'seals/b1')));
});

test('timer branch does not grant teacher writes to board, membership or other grades', async () => {
  await assertSucceeds(set(ref(db('teacher1'), 'timers/b1'), timer()));
  await assertFails(set(ref(db('teacher1'), 'boards/b1/members/outsider'), true));
  await assertFails(set(ref(db('teacher1'), 'boards/b1/timer'), timer()));
  await assertFails(set(ref(db('teacher1'), 'boards/b1'), fixture().boards.b1));
  await assertFails(remove(ref(db('teacher1'), 'boards/b1')));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher2/s1'), grade));
});

test('timer is shared only with active board members or coordinator', async () => {
  await bypass('timers/b1', timer());
  await assertSucceeds(get(ref(db('teacher2'), 'timers/b1')));
  await assertSucceeds(get(ref(db('coord'), 'timers/b1')));
  for (const uid of ['outsider', 'disabled', null]) {
    await assertFails(get(ref(db(uid), 'timers/b1')));
    await assertFails(set(ref(db(uid), 'timers/b1'), timer(uid, 2)));
  }
  await assertFails(set(ref(db('teacher1'), 'timers/missing'), timer()));
});

test('timer rejects malformed, fractional, oversized and stale updates', async () => {
  await assertSucceeds(set(ref(db('teacher1'), 'timers/b1'), timer()));
  for (const change of [
    { revision: 1 }, { revision: 3 }, { elapsedMs: -1 }, { elapsedMs: 1.5 },
    { elapsedMs: 31536000001 }, { startedAt: Date.now() + 120000 },
    { updatedAt: Date.now() + 120000 }, { updatedBy: 'teacher2' }, { extra: true }
  ]) await assertFails(set(ref(db('teacher1'), 'timers/b1'), timer('teacher1', 2, change)));
  await assertSucceeds(set(ref(db('teacher2'), 'timers/b1'), timer('teacher2', 2)));
  await assertFails(remove(ref(db('teacher2'), 'timers/b1')));
});

test('running timer closes atomically frozen and reopens without losing elapsed time', async () => {
  await bypass('timers/b1', timer('teacher1', 1, { startedAt: Date.now() - 1000 }));
  await assertFails(set(ref(db('teacher1'), 'seals/b1'), seal()));
  await assertSucceeds(update(ref(db('teacher1')), {
    'seals/b1': seal(), 'timers/b1': timer('teacher1', 2, { elapsedMs: 13345 })
  }));
  await assertFails(set(ref(db('teacher2'), 'timers/b1'), timer('teacher2', 3)));
  await assertSucceeds(update(ref(db('teacher2')), {
    'seals/b1': null, 'timers/b1': timer('teacher2', 3, { elapsedMs: 13345 })
  }));
  assert.equal((await readPrivileged('timers/b1')).elapsedMs, 13345);
});

test('stale atomic close is rejected entirely, preserving current timer and open board', async () => {
  await bypass('timers/b1', timer('teacher1', 2));
  const beforeData = await readPrivileged('/');
  await assertFails(update(ref(db('teacher2')), {
    'seals/b1': seal('teacher2'), 'timers/b1': timer('teacher2', 2)
  }));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

const newBoard = () => ({
  groupId: 'g2', advisorUid: 'teacher1', advisorName: 'Professor 1',
  members: { teacher1: true, teacher2: true }, memberNames: { teacher1: 'Professor 1', teacher2: 'Professor 2' },
  startAt: Math.ceil((Date.now() + 60000) / 900000) * 900000,
  durationMin: 30, room: 'Laboratório 2', createdBy: 'coord', createdAt: Date.now()
});

test('Alberson edits teacher name/contact, preserving login mapping and roles', async () => {
  await assertSucceeds(update(ref(db('coord'), 'users/teacher1'), { name: 'Professor atualizado', contactEmail: 'contato@example.test' }));
  const edited = await readPrivileged('users/teacher1');
  assert.equal(edited.email, 'one@example.test');
  assert.equal(edited.key, 'one');
  assert.equal(edited.role, 'teacher');
  for (const change of [{ email: 'changed@example.test' }, { key: 'changed' }, { role: 'coordinator' }, { contactEmail: 42 }, { contactEmail: 'x'.repeat(255) }]) {
    await assertFails(update(ref(db('coord'), 'users/teacher1'), change));
  }
  await assertSucceeds(update(ref(db('coord'), 'users/teacher1'), { contactEmail: null }));
});

test('profile management remains exclusive to Alberson and cannot affect his own profile', async () => {
  for (const uid of ['teacher1', 'teacher2', 'otherCoord', null]) await assertFails(update(ref(db(uid), 'users/teacher1'), { name: 'Alterado' }));
  await assertFails(update(ref(db('coord'), 'users/coord'), { name: 'Alterado' }));
  await assertSucceeds(update(ref(db('coord'), 'users/otherCoord'), { name: 'Coordenação atualizada' }));
  await assertFails(remove(ref(db('coord'), 'users/teacher1')));
  await assertSucceeds(update(ref(db('coord'), 'users/teacher1'), { active: false, disabledBy: 'coord', disabledAt: Date.now() }));
  await assertSucceeds(update(ref(db('coord'), 'users/teacher1'), { active: true, disabledBy: null, disabledAt: null }));
});

test('Alberson creates and edits an unscheduled catalog group with course and stable identifiers', async () => {
  const group = { ...fixture().groups.g2, id: 'g3', courseName: 'Análise e Desenvolvimento de Sistemas', active: true, createdBy: 'coord', createdAt: Date.now() };
  await assertSucceeds(set(ref(db('coord'), 'groups/g3'), group));
  await assertSucceeds(update(ref(db('coord'), 'groups/g3'), {
    name: 'Grupo atualizado', className: 'Turma com identificação ampliada até oitenta caracteres', title: 'Título atualizado',
    courseName: 'Engenharia da Computação', advisorUid: 'teacher2', students: { a: 'Aluna A', b: 'Aluno B' },
    updatedBy: 'coord', updatedAt: Date.now()
  }));
  assert.deepEqual((await readPrivileged('groups/g3')).students, { a: 'Aluna A', b: 'Aluno B' });
  await assertFails(update(ref(db('coord'), 'groups/g3'), { id: 'changed' }));
  await assertFails(update(ref(db('coord'), 'groups/g3'), { createdBy: 'teacher1' }));
  await assertFails(update(ref(db('coord'), 'groups/g3'), { createdAt: null }));
  await assertFails(update(ref(db('coord'), 'groups/g3'), { className: 'x'.repeat(81) }));
  await assertFails(update(ref(db('coord'), 'groups/g3'), { courseName: 'x'.repeat(121) }));
  await assertFails(set(ref(db('coord'), 'groups/g3/students'), {}));
});

test('teachers and anonymous clients cannot create or alter catalog groups', async () => {
  for (const uid of ['teacher1', 'teacher2', null]) {
    await assertFails(set(ref(db(uid), 'groups/g3'), { ...fixture().groups.g2, id: 'g3' }));
    await assertFails(update(ref(db(uid), 'groups/g2'), { title: 'Alterado' }));
    await assertFails(update(ref(db(uid), 'groups/g2'), { active: false }));
  }
  await assertFails(set(ref(db('coord'), 'groups/missing/active'), true));
  await assertFails(remove(ref(db('coord'), 'groups/g2')));
});

test('scheduled academic fields and student map reject scalar, nested, deletion and whole-group mutations', async () => {
  const beforeGroup = await readPrivileged('groups/g1');
  for (const [path, value] of [
    ['name', 'Alterado'], ['className', 'Outra turma'], ['title', 'Outro título'], ['advisorUid', 'teacher2'],
    ['courseName', 'Outro curso'], ['students/s1', 'Outro nome'], ['students/new', 'Novo aluno'], ['students/s1', null]
  ]) await assertFails(set(ref(db('coord'), `groups/g1/${path}`), value));
  await assertFails(set(ref(db('coord'), 'groups/g1'), { ...beforeGroup, active: true }));
  assert.deepEqual(await readPrivileged('groups/g1'), beforeGroup);
});

test('scheduled open groups cannot be archived; closed archive and restore preserve all academic records', async () => {
  const beforeGroup = await readPrivileged('groups/g1');
  const beforeGrades = await readPrivileged('grades/b1');
  await assertFails(update(ref(db('coord'), 'groups/g1'), { active: false, archivedBy: 'coord', archivedAt: Date.now() }));
  await bypass('seals/b1', seal());
  await assertSucceeds(update(ref(db('coord'), 'groups/g1'), { active: false, archivedBy: 'coord', archivedAt: Date.now(), updatedBy: 'coord', updatedAt: Date.now() }));
  const archived = await readPrivileged('groups/g1');
  for (const key of ['id', 'name', 'className', 'title', 'advisorUid', 'students']) assert.deepEqual(archived[key], beforeGroup[key]);
  await assertSucceeds(update(ref(db('coord'), 'groups/g1'), { active: true, archivedBy: null, archivedAt: null, updatedBy: 'coord', updatedAt: Date.now() }));
  assert.deepEqual(await readPrivileged('grades/b1'), beforeGrades);
});

test('lifecycle metadata is validated and does not create a bypass to academic fields', async () => {
  await assertSucceeds(update(ref(db('coord'), 'groups/g1'), { updatedBy: 'coord', updatedAt: Date.now() }));
  for (const change of [{ updatedBy: 'teacher1' }, { archivedBy: 'teacher1' }, { updatedAt: Date.now() + 120000 }, { archivedAt: 'today' }, { active: null }, { active: 'false' }]) {
    await assertFails(update(ref(db('coord'), 'groups/g1'), change));
  }
  await assertFails(update(ref(db('coord'), 'groups/g1'), { title: 'Tentativa', updatedBy: 'coord' }));
});

test('reciprocal board and group mapping validation permits the existing atomic scheduling shape', async () => {
  const board = newBoard();
  await assertFails(set(ref(db('coord'), 'boards/b2'), board));
  await assertFails(set(ref(db('coord'), 'groupBoards/g2'), 'b2'));
  await assertSucceeds(update(ref(db('coord')), { 'boards/b2': board, 'groupBoards/g2': 'b2' }));
  await assertFails(update(ref(db('coord'), 'groups/g2'), { title: 'Alteração posterior' }));
});

test('academic edit plus new scheduling in one commit is rejected atomically', async () => {
  const beforeData = await readPrivileged('/');
  await assertFails(update(ref(db('coord')), {
    'groups/g2/title': 'Título adulterado', 'boards/b2': newBoard(), 'groupBoards/g2': 'b2'
  }));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

test('archiving plus new scheduling in one commit is rejected atomically', async () => {
  const beforeData = await readPrivileged('/');
  await assertFails(update(ref(db('coord')), {
    'groups/g2/active': false, 'boards/b2': newBoard(), 'groupBoards/g2': 'b2'
  }));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

test('archived groups cannot receive new boards or grades until explicitly restored', async () => {
  await assertSucceeds(update(ref(db('coord'), 'groups/g2'), { active: false }));
  await assertFails(update(ref(db('coord')), { 'boards/b2': newBoard(), 'groupBoards/g2': 'b2' }));
  await bypass('seals/b1', seal());
  await assertSucceeds(update(ref(db('coord'), 'groups/g1'), { active: false }));
  await assertSucceeds(remove(ref(db('coord'), 'seals/b1')));
  await assertFails(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
  await assertFails(set(ref(db('coord'), 'deliveries/b1/s1'), 10));
  await assertSucceeds(update(ref(db('coord'), 'groups/g1'), { active: true }));
  await assertSucceeds(set(ref(db('teacher1'), 'grades/b1/teacher1/s1'), grade));
});

test('closing and archiving an existing board in one atomic commit is supported', async () => {
  const beforeGroup = await readPrivileged('groups/g1');
  await assertSucceeds(update(ref(db('coord')), {
    'seals/b1': seal('coord'), 'groups/g1/active': false,
    'groups/g1/archivedBy': 'coord', 'groups/g1/archivedAt': Date.now()
  }));
  const afterGroup = await readPrivileged('groups/g1');
  assert.equal(afterGroup.active, false);
  assert.deepEqual(afterGroup.students, beforeGroup.students);
  await assertFails(update(ref(db('coord'), 'groups/g1'), { title: 'Histórico alterado' }));
});

test('reopening and archiving together cannot bypass the post-write seal requirement', async () => {
  await bypass('seals/b1', seal());
  const beforeData = await readPrivileged('/');
  await assertFails(update(ref(db('coord')), { 'seals/b1': null, 'groups/g1/active': false }));
  assert.deepEqual(await readPrivileged('/'), beforeData);
});

// Chat records are isolated from evaluation records; production is never contacted.
const chatMessage = (uid='teacher1', extra={}) => ({ uid, name:fixture().users[uid].name, text:'Mensagem da banca\nSegunda linha.', at:Date.now(), ...extra });
const chatPresence = (uid='teacher1', extra={}) => ({ name:fixture().users[uid].name, role:fixture().users[uid].role, at:Date.now(), ...extra });

test('all active professors and coordinators use the common room without opening parent or grade reads', async () => {
  for (const uid of ['teacher1','teacher2','outsider','coord','otherCoord']) {
    await assertSucceeds(set(ref(db(uid), `chatMessages/geral/${uid}`), chatMessage(uid)));
    await assertSucceeds(get(ref(db(uid), 'chatMessages/geral')));
  }
  await assertFails(get(ref(db('teacher1'), 'chatMessages')));
  await assertFails(get(ref(db('teacher1'), 'grades/b1/teacher2')));
  for (const uid of ['disabled',null]) {
    await assertFails(get(ref(db(uid), 'chatMessages/geral')));
    await assertFails(set(ref(db(uid), 'chatMessages/geral/not-allowed'), chatMessage('teacher1')));
  }
});

test('legacy registered teacher needs no active flag, key, bank assignment or chat allowlist for general messages and presence', async () => {
  const uid='legacyTeacher',profile={name:'Professor já cadastrado',role:'teacher'};
  await bypass(`users/${uid}`,profile);
  const before=await readPrivileged('/');
  await assertSucceeds(get(ref(db(uid),'chatMessages/geral')));
  await assertSucceeds(get(ref(db(uid),'chatPresence')));
  await assertSucceeds(set(ref(db(uid),`chatMessages/geral/${uid}`),{uid,name:profile.name,text:'Participando sem banca.',at:Date.now()}));
  await assertSucceeds(set(ref(db(uid),`chatPresence/${uid}/first-tab`),{name:profile.name,role:'teacher',at:Date.now()}));
  await assertFails(get(ref(db(uid),'chatMessages/b1')));
  await assertFails(get(ref(db(uid),'grades/b1/teacher1')));
  await assertFails(set(ref(db(uid),`chatMessages/geral/${uid}-forged`),{uid,name:'Outra pessoa',text:'Nome falso',at:Date.now()}));
  const after=await readPrivileged('/');
  for(const root of ['users','boards','groups','grades','deliveries'])assert.deepEqual(after[root],before[root],root);
});

test('new teacher profile created by Alberson immediately authorizes general chat and presence without bank membership', async () => {
  const uid='newChatTeacher',profile=profileDraft('teacher',{name:'Nova professora',email:'nova-chat@example.test',key:'nova-chat'});
  await assertSucceeds(set(ref(db('coord'),`users/${uid}`),profile));
  await assertSucceeds(get(ref(db(uid),'chatMessages/geral')));
  await assertSucceeds(get(ref(db(uid),'chatPresence')));
  await assertSucceeds(set(ref(db(uid),`chatMessages/geral/${uid}`),{uid,name:profile.name,text:'Primeiro acesso.',at:Date.now()}));
  await assertSucceeds(set(ref(db(uid),`chatPresence/${uid}/first-tab`),{name:profile.name,role:'teacher',at:Date.now()}));
  assert.equal((await readPrivileged('boards/b1/members'))[uid],undefined);
  assert.deepEqual(await readPrivileged(`users/${uid}`),profile,'access follows the saved teacher role without extra profile fields');
  await assertFails(get(ref(db(uid),'chatMessages/b1')));
  await bypass(`users/${uid}/active`,false);
  for(const blocked of [uid,'authenticated-without-profile',null]){
    await assertFails(get(ref(db(blocked),'chatMessages/geral')));
    await assertFails(get(ref(db(blocked),'chatPresence')));
    await assertFails(set(ref(db(blocked),'chatMessages/geral/blocked'),{uid:blocked||uid,name:profile.name,text:'Sem acesso',at:Date.now()}));
    await assertFails(set(ref(db(blocked),`chatPresence/${uid}/blocked`),{name:profile.name,role:'teacher',at:Date.now()}));
  }
});

test('bank conversations are private to active bank members and coordinators even after closure and archival', async () => {
  for (const uid of ['teacher1','teacher2','coord','otherCoord']) {
    await assertSucceeds(set(ref(db(uid), `chatMessages/b1/open-${uid}`), chatMessage(uid)));
    await assertSucceeds(get(ref(db(uid), 'chatMessages/b1')));
  }
  await bypass('seals/b1',seal());await bypass('groups/g1/active',false);
  await assertSucceeds(set(ref(db('teacher1'),'chatMessages/b1/after-close'),chatMessage()));
  for (const uid of ['outsider','disabled',null]) {
    await assertFails(get(ref(db(uid),'chatMessages/b1')));
    await assertFails(set(ref(db(uid),'chatMessages/b1/rejected'),chatMessage('teacher1')));
  }
  for (const uid of ['teacher1','coord']) {
    await assertFails(get(ref(db(uid),'chatMessages/missing-bank')));
    await assertFails(set(ref(db(uid),'chatMessages/missing-bank/rejected'),chatMessage(uid)));
  }
});

test('messages enforce canonical author, bounded nonblank text, recent timestamp and exact shape', async () => {
  const invalid=[
    {uid:'teacher2'}, {name:'Another person'}, {text:''}, {text:' \n\t\r'}, {text:'\u00a0\u2000\u3000'}, {text:'x'.repeat(2001)},
    {text:10}, {at:Date.now()-120000}, {at:Date.now()+120000}, {at:'today'}, {at:Date.now()+.5},
    {extra:'rejected'}, {uid:null}, {name:null}, {text:null}, {at:null}
  ];
  for(const[index,change]of invalid.entries()) await assertFails(set(ref(db('teacher1'),`chatMessages/b1/invalid-${index}`),chatMessage('teacher1',change)));
  await assertSucceeds(set(ref(db('teacher1'),'chatMessages/b1/max-length'),chatMessage('teacher1',{text:'x'.repeat(2000)})));
  await assertSucceeds(set(ref(db('teacher1'),'chatMessages/b1/unicode'),chatMessage('teacher1',{text:'🙂 Avaliação: 0,00\nTudo certo.'})));
});

test('saved messages cannot be edited, deleted or replaced by their author or a coordinator', async () => {
  const saved=chatMessage();await assertSucceeds(set(ref(db('teacher1'),'chatMessages/b1/fixed'),saved));
  for(const uid of ['teacher1','teacher2','coord']) {
    await assertFails(update(ref(db(uid),'chatMessages/b1/fixed'),{text:'Changed'}));
    await assertFails(remove(ref(db(uid),'chatMessages/b1/fixed')));
    await assertFails(set(ref(db(uid),'chatMessages/b1/fixed'),chatMessage(uid)));
  }
  await assertFails(set(ref(db('teacher1'),'chatMessages/b1'),{replacement:chatMessage()}));
  assert.deepEqual(await readPrivileged('chatMessages/b1/fixed'),saved);
});

test('presence is visible to active professors and isolated per owner and browser connection', async () => {
  await assertSucceeds(set(ref(db('teacher1'),'chatPresence/teacher1/tab-one'),chatPresence()));
  await assertSucceeds(set(ref(db('teacher1'),'chatPresence/teacher1/tab-two'),chatPresence()));
  await assertSucceeds(set(ref(db('coord'),'chatPresence/coord/coord-tab'),chatPresence('coord')));
  for(const uid of ['teacher1','teacher2','outsider','coord'])await assertSucceeds(get(ref(db(uid),'chatPresence')));
  await assertFails(set(ref(db('teacher2'),'chatPresence/teacher1/spoof'),chatPresence('teacher1')));
  await assertFails(remove(ref(db('teacher2'),'chatPresence/teacher1/tab-one')));
  await assertFails(remove(ref(db('coord'),'chatPresence/teacher1/tab-one')));
  await assertSucceeds(remove(ref(db('teacher1'),'chatPresence/teacher1/tab-one')));
  assert.ok(await readPrivileged('chatPresence/teacher1/tab-two'));
  for(const uid of ['disabled',null]) {
    await assertFails(get(ref(db(uid),'chatPresence')));
    await assertFails(set(ref(db(uid),'chatPresence/disabled/no-access'),chatPresence('disabled')));
  }
});

test('presence validates canonical identity, current heartbeat and permitted fields, allowing revoked-owner cleanup only', async () => {
  for(const[index,change]of [
    {name:'Fake name'},{role:'coordinator'},{at:'now'},{at:Date.now()-120000},{at:Date.now()+120000},
    {at:Date.now()+.5},{extra:true},{name:null},{role:null},{at:null}
  ].entries()) await assertFails(set(ref(db('teacher1'),`chatPresence/teacher1/invalid-${index}`),chatPresence('teacher1',change)));
  await assertSucceeds(set(ref(db('teacher1'),'chatPresence/teacher1/own'),chatPresence()));
  await bypass('users/teacher1/active',false);
  await assertFails(set(ref(db('teacher1'),'chatPresence/teacher1/new'),chatPresence()));
  await assertFails(update(ref(db('teacher1'),'chatPresence/teacher1/own'),{at:Date.now()}));
  await assertSucceeds(remove(ref(db('teacher1'),'chatPresence/teacher1/own')));
  await assertFails(set(ref(db('teacher1'),'chatPresence'),{teacher2:{fake:chatPresence('teacher2')}}));
});

// Additional coordinators share academic operations; only Alberson manages identities.
const profileDraft = (role='coordinator', extra={}) => ({
  name:'Nova coordenação', email:'nova@example.test', key:'nova-coordenacao', role, active:true,
  createdBy:'coord', createdAt:Date.now(), ...extra
});

test('Alberson creates teacher and coordinator profiles without permitting reserved or unknown roles', async () => {
  await assertSucceeds(set(ref(db('coord'),'users/newCoordinator'),profileDraft()));
  await assertSucceeds(set(ref(db('coord'),'users/newTeacher'),profileDraft('teacher',{email:'docente@example.test',key:'docente'})));
  assert.equal((await readPrivileged('users/newCoordinator')).role,'coordinator');
  await assertSucceeds(get(ref(db('newCoordinator'),'users')));
  for(const change of [{role:'admin'},{role:''},{key:'alberson'},{createdBy:'teacher1'},{active:'true'},{extra:true}]) {
    await assertFails(set(ref(db('coord'),'users/invalidCoordinator'),profileDraft('coordinator',change)));
  }
});

test('only Alberson manages additional coordinators and existing role, key and login remain immutable', async () => {
  for(const uid of ['otherCoord','teacher1','disabled',null]) {
    await assertFails(set(ref(db(uid),'users/newCoordinator'),profileDraft()));
    await assertFails(update(ref(db(uid),'users/otherCoord'),{active:false}));
  }
  await assertSucceeds(update(ref(db('coord'),'users/otherCoord'),{name:'Coordenadora atualizada',contactEmail:'contato.coord@example.test'}));
  for(const change of [{role:'teacher'},{email:'newlogin@example.test'},{key:'new-key'},{key:'alberson'}]) {
    await assertFails(update(ref(db('coord'),'users/otherCoord'),change));
  }
  await assertFails(update(ref(db('coord'),'users/teacher1'),{role:'coordinator'}));
  await assertSucceeds(update(ref(db('coord'),'users/otherCoord'),{active:false,disabledBy:'coord',disabledAt:Date.now()}));
  await assertFails(get(ref(db('otherCoord'),'users')));
  await assertFails(set(ref(db('otherCoord'),'groups/g3'),{...fixture().groups.g2,id:'g3'}));
  await assertSucceeds(update(ref(db('coord'),'users/otherCoord'),{active:true,disabledBy:null,disabledAt:null}));
  const restored=await readPrivileged('users/otherCoord');
  assert.equal(restored.role,'coordinator');assert.equal(restored.key,'another');assert.equal(restored.email,'othercoord@example.test');
  await assertSucceeds(get(ref(db('otherCoord'),'users')));
});

test('Alberson identity is protected by its reserved key at any UID and no identity can be deleted', async () => {
  await bypass('users/protectedAlberson',{...fixture().users.coord,email:'protected@example.test'});
  for(const uid of ['coord','otherCoord']) {
    for(const target of ['coord','protectedAlberson']) {
      await assertFails(update(ref(db(uid),`users/${target}`),{name:'Não permitido'}));
      await assertFails(update(ref(db(uid),`users/${target}`),{active:false}));
      await assertFails(remove(ref(db(uid),`users/${target}`)));
    }
  }
  await assertFails(remove(ref(db('coord'),'users/otherCoord')));
  await assertFails(update(ref(db('coord'),'users/coord'),{key:'liberar-protecao'}));
});

test('additional coordinators create, edit, archive and restore unscheduled groups with canonical administration fields', async () => {
  const group={...fixture().groups.g2,id:'g3',courseName:'ADS',active:true,createdBy:'otherCoord',createdAt:Date.now()};
  await assertSucceeds(set(ref(db('otherCoord'),'groups/g3'),group));
  await assertSucceeds(update(ref(db('otherCoord'),'groups/g3'),{title:'Projeto atualizado',students:{a:'Aluna A'},updatedBy:'otherCoord',updatedAt:Date.now()}));
  await assertSucceeds(update(ref(db('otherCoord'),'groups/g3'),{active:false,archivedBy:'otherCoord',archivedAt:Date.now()}));
  await assertSucceeds(update(ref(db('otherCoord'),'groups/g3'),{active:true,archivedBy:null,archivedAt:null,updatedBy:'otherCoord',updatedAt:Date.now()}));
  await assertFails(update(ref(db('otherCoord'),'groups/g3'),{createdBy:'coord'}));
  await assertFails(update(ref(db('otherCoord'),'groups/g3'),{updatedBy:'coord'}));
  await assertFails(remove(ref(db('otherCoord'),'groups/g3')));
  assert.deepEqual((await readPrivileged('groups/g3')).students,{a:'Aluna A'});
});

test('additional coordinators preserve scheduled student identities and grades while managing group access', async () => {
  const original=await readPrivileged('/');
  await assertFails(update(ref(db('otherCoord'),'groups/g1'),{students:{s1:'Nome alterado'}}));
  await assertFails(update(ref(db('otherCoord'),'groups/g1'),{title:'Título alterado'}));
  await assertFails(update(ref(db('otherCoord'),'groups/g1'),{active:false,archivedBy:'otherCoord',archivedAt:Date.now()}));
  await assertSucceeds(set(ref(db('otherCoord'),'seals/b1'),seal('otherCoord')));
  await assertSucceeds(update(ref(db('otherCoord'),'groups/g1'),{active:false,archivedBy:'otherCoord',archivedAt:Date.now()}));
  await assertSucceeds(update(ref(db('otherCoord'),'groups/g1'),{active:true,archivedBy:null,archivedAt:null}));
  assert.deepEqual((await readPrivileged('groups/g1')).students,original.groups.g1.students);
  assert.deepEqual(await readPrivileged('grades'),original.grades);
  assert.deepEqual(await readPrivileged('deliveries'),original.deliveries);
});

test('additional coordinators schedule a batch of banks and professor/room reservations atomically', async () => {
  await assertSucceeds(set(ref(db('otherCoord'),'groups/g3'),{...fixture().groups.g2,id:'g3',students:{s5:'Aluna 5'}}));
  const first={...newBoard(),createdBy:'otherCoord'},second={...newBoard(),groupId:'g3',startAt:newBoard().startAt+1800000,createdBy:'otherCoord'};
  await assertSucceeds(update(ref(db('otherCoord')),{
    'boards/b2':first,'groupBoards/g2':'b2','locks/new-slot-1/teacher1':'b2','locks/new-slot-1/teacher2':'b2','roomLocks/new-slot-1/room-2':'b2',
    'boards/b3':second,'groupBoards/g3':'b3','locks/new-slot-2/teacher1':'b3','locks/new-slot-2/teacher2':'b3','roomLocks/new-slot-2/room-2':'b3'
  }));
  assert.equal((await readPrivileged('boards/b2')).createdBy,'otherCoord');
  assert.equal(await readPrivileged('locks/new-slot-2/teacher1'),'b3');
  const original=await readPrivileged('/');
  await assertFails(update(ref(db('otherCoord')),{'locks/new-slot-1/teacher1':'b3','groups/g2/title':'Tentativa'}));
  assert.deepEqual(await readPrivileged('/'),original);
  for(const uid of ['teacher1','disabled',null]) {
    await assertFails(update(ref(db(uid)),{'boards/forbidden':{...newBoard(),createdBy:uid||'anonymous'},'groupBoards/forbidden':'forbidden'}));
  }
});
