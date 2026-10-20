const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const assignment = require('../assets/board-assignment.js');
const clone = value => JSON.parse(JSON.stringify(value));
const start = 1792522800000;
const profile = (name, role = 'teacher', extra = {}) => ({ name, role, active: true, ...extra });
function fixture() {
  return {
    actorUid: 'coord', boardId: 'b1', memberUids: ['t1', 't3'],
    users: { coord: profile('Alberson', 'coordinator'), admin: profile('Administração Univap', 'coordinator', { key: 'admin' }), wagner: profile('Wagner', 'coordinator'), t1: profile('Professor Um'), t2: profile('Professora Dois'), t3: profile('Professora Três'), off: profile('Acesso inativo', 'teacher', { active: false }) },
    groups: { g1: { id: 'g1', name: 'Grupo Árvore', active: true }, g2: { id: 'g2', name: 'Outro grupo', active: false } },
    boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Nome histórico do Professor Um', t2: 'Professora Dois' }, startAt: start, durationMin: 30, room: 'Laboratório', createdBy: 'coord', createdAt: start - 60000 } },
    grades: { b1: { t1: { s1: { presentation: 0, practice: 8, code: 9, time: 8 } } } }, seals: {},
    locks: { [start]: { t1: 'b1', t2: 'b1' }, [start + 900000]: { t1: 'b1', t2: 'b1' } }
  };
}

test('replacement creates only individual composition and teacher-lock writes and preserves source history', () => {
  const input = fixture(), before = clone(input), result = assignment.plan(input);
  assert.deepEqual(result.members, { t1: true, t3: true }); assert.deepEqual(result.added, ['t3']); assert.deepEqual(result.removed, ['t2']); assert.deepEqual(result.unchanged, ['t1']);
  assert.deepEqual(result.changes, {
    'boards/b1/members/t3': true, 'boards/b1/memberNames/t3': 'Professora Três', [`locks/${start}/t3`]: 'b1', [`locks/${start + 900000}/t3`]: 'b1',
    'boards/b1/members/t2': null, 'boards/b1/memberNames/t2': null, [`locks/${start}/t2`]: null, [`locks/${start + 900000}/t2`]: null,
    'boards/b1/assignmentRevision': 1
  });
  assert.deepEqual(input, before); assert.ok(!Object.keys(result.changes).some(path => /grades|deliveries|timers|seals|roomLocks|advisor|startAt|durationMin/.test(path)));
  assert.ok(!Object.keys(result.changes).some(path => path.includes('/t1')), 'unchanged historical evaluator name and reservations are preserved');
});

test('all active coordinators including Wagner and the admin account can assign, but teachers, inactive and unknown actors cannot', () => {
  for (const actorUid of ['coord', 'wagner', 'admin']) assert.deepEqual(assignment.plan({ ...fixture(), actorUid }).added, ['t3']);
  for (const actorUid of ['t1', 'off', 'missing']) assert.throws(() => assignment.plan({ ...fixture(), actorUid }), /coordenação ativa/);
  const input = fixture(); input.users.coord.active = false; assert.throws(() => assignment.plan(input), /coordenação ativa/);
  input.users.coord = { name: 'Outro papel', role: 'admin' }; assert.throws(() => assignment.plan(input), /coordenação ativa/);
});

test('an added coordinator and a legacy teacher without an active flag are eligible evaluator accounts', () => {
  const input = fixture(); delete input.users.t3.active;
  assert.deepEqual(assignment.plan(input).members, { t1: true, t3: true });
  input.memberUids = ['t1', 'admin']; assert.deepEqual(assignment.plan(input).added, ['admin']);
});

test('retaining an inactive graded evaluator allows adding an active coordinator without changing history or granting access', () => {
  const input = fixture(); input.users.t1.active = false; input.memberUids = ['t1', 't2', 'admin'];
  const before = clone(input), result = assignment.plan(input);
  assert.deepEqual(result.members, { t1: true, t2: true, admin: true }); assert.deepEqual(result.added, ['admin']); assert.deepEqual(result.removed, []);
  assert.deepEqual(result.unchanged, ['t1', 't2']); assert.ok(!Object.keys(result.changes).some(path => path.includes('/t1')));
  assert.equal(result.changes['boards/b1/memberNames/admin'], 'Administração Univap'); assert.deepEqual(input, before);
  input.memberUids = ['t2', 'admin']; assert.throws(() => assignment.plan(input), /já possui notas/, 'disabled evaluators with grades still cannot be removed');
});

test('an evaluator with a missing profile can be retained only with a valid historical board name', () => {
  const input = fixture(); delete input.users.t1; input.memberUids = ['t1', 't2', 'wagner'];
  const result = assignment.plan(input); assert.deepEqual(result.added, ['wagner']); assert.deepEqual(result.unchanged, ['t1', 't2']);
  assert.equal(result.changes['boards/b1/memberNames/t1'], undefined); assert.equal(result.changes['boards/b1/members/t1'], undefined);
  for (const value of [undefined, '', '   ', 'Nome\nInválido', 'x'.repeat(121)]) {
    input.boards.b1.memberNames.t1 = value; assert.throws(() => assignment.plan(input), /nome histórico/);
  }
  const newUnknown = fixture(); newUnknown.memberUids = ['t1', 'unknown']; newUnknown.boards.b1.memberNames.unknown = 'Nome sem participação anterior';
  assert.throws(() => assignment.plan(newUnknown), /cadastro ativo/, 'an old name alone cannot create a new membership');
});

test('missing, archived or sealed boards and malformed schedules cannot produce an update plan', () => {
  const cases = [
    input => { delete input.boards.b1; }, input => { delete input.groups.g1; }, input => { input.groups.g1.active = false; },
    input => { input.seals.b1 = { at: start, by: 'coord' }; }, input => { input.boards.b1.startAt = Infinity; },
    input => { input.boards.b1.startAt++; }, input => { input.boards.b1.durationMin = 0; }, input => { input.boards.b1.durationMin = 20; },
    input => { input.boards.b1.members.t2 = false; }
  ];
  for (const change of cases) { const input = fixture(); change(input); assert.throws(() => assignment.plan(input)); }
  assert.deepEqual(assignment.plan({ ...fixture(), now: start + 86400000 }).added, ['t3'], 'an existing open board can be assigned after its scheduled time');
});

test('selection requires exactly two or three unique valid active evaluators and rejects path injection', () => {
  for (const memberUids of [[], ['t1'], ['t1', 't2', 't3', 'admin'], ['t1', 't1'], ['t1', 'off'], ['t1', 'unknown'], ['t1', ''], ['t1', 't3/grades'], ['t1', 'a.b'], ['t1', '__proto__'], ['t1', 1], 't1,t3']) assert.throws(() => assignment.plan({ ...fixture(), memberUids }), JSON.stringify(memberUids));
  for (const boardId of ['b1/grades', '__proto__', '', null]) assert.throws(() => assignment.plan({ ...fixture(), boardId }));
  const input = fixture(); input.users.t3.name = ''; assert.throws(() => assignment.plan(input), /nome/);
});

test('removing any persisted grade is blocked including zero, incomplete and malformed historical values', () => {
  const grades = [{ s1: { presentation: 0 } }, { s1: { practice: 8 } }, { s1: 0 }, 0, false, 'registro histórico'];
  for (const notes of grades) { const input = fixture(); input.grades.b1.t2 = notes; assert.throws(() => assignment.plan(input), /já possui notas/); }
  for (const notes of [undefined, null, {}, { s1: { presentation: null } }]) { const input = fixture(); input.grades.b1.t2 = notes; assert.deepEqual(assignment.plan(input).removed, ['t2']); }
  const input = fixture(); input.memberUids = ['t1', 't2', 't3']; input.grades.b1.t2 = { s1: { presentation: 0 } };
  assert.deepEqual(assignment.plan(input).added, ['t3'], 'adding a third evaluator preserves every existing assessment');
});

test('added evaluators cannot overlap another board even with missing locks or a closed archived group', () => {
  for (const offset of [-900000, 0, 900000]) {
    const input = fixture(); input.boards.b2 = { ...clone(input.boards.b1), groupId: 'g2', members: { t3: true }, startAt: start + offset };
    input.seals.b2 = { at: start - 1000 }; assert.throws(() => assignment.plan(input), /outra banca neste horário/);
  }
  for (const offset of [-1800000, 1800000]) {
    const input = fixture(); input.boards.b2 = { ...clone(input.boards.b1), members: { t3: true }, startAt: start + offset };
    assert.deepEqual(assignment.plan(input).added, ['t3'], 'adjacent board intervals do not overlap');
  }
});

test('lock conflicts prevent additions; existing own locks are preserved and foreign removal locks never get deleted', () => {
  const conflict = fixture(); conflict.locks[start].t3 = 'another-board'; assert.throws(() => assignment.plan(conflict), /reserva de horário/);
  const input = fixture(); input.locks[start].t3 = 'b1'; input.locks[start].t2 = 'another-board'; delete input.locks[start + 900000].t2;
  const result = assignment.plan(input);
  assert.equal(result.changes[`locks/${start}/t3`], undefined);
  assert.equal(result.changes[`locks/${start}/t2`], undefined); assert.equal(result.changes[`locks/${start + 900000}/t2`], undefined);
  assert.equal(result.changes[`locks/${start + 900000}/t3`], 'b1'); assert.equal(result.changes['boards/b1/members/t2'], null);
});

test('a selection with unchanged members is a no-op and does not rename historical membership', () => {
  const input = fixture(); input.memberUids = ['t2', 't1'];
  const result = assignment.plan(input); assert.deepEqual(result.changes, {}); assert.deepEqual(result.added, []); assert.deepEqual(result.removed, []); assert.deepEqual(result.unchanged, ['t2', 't1']);
});

test('composition edits increment the saved revision once for atomic stale-plan protection', () => {
  const initial = fixture(); assert.equal(assignment.plan(initial).changes['boards/b1/assignmentRevision'], 1);
  initial.boards.b1.assignmentRevision = 7; assert.equal(assignment.plan(initial).changes['boards/b1/assignmentRevision'], 8);
  initial.memberUids = ['t1', 't2']; assert.equal(assignment.plan(initial).changes['boards/b1/assignmentRevision'], undefined);
  for (const revision of [-1, 0.5, NaN, Infinity, '7', null, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.boards.b1.assignmentRevision = revision; assert.throws(() => assignment.plan(input), /revisão/);
  }
  const limited = fixture(); limited.boards.b1.assignmentRevision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => assignment.plan(limited), /limite/);
});

test('every reserved quarter-hour matches the existing app schedule convention for supported durations', () => {
  for (const durationMin of [30, 45, 60, 90]) {
    const input = fixture(); input.boards.b1.durationMin = durationMin;
    const result = assignment.plan(input), keys = Object.keys(result.changes).filter(path => path.startsWith('locks/') && path.endsWith('/t3'));
    assert.deepEqual(keys, Array.from({ length: durationMin / 15 }, (_, index) => `locks/${start + index * 900000}/t3`));
  }
});

test('the browser UMD exposes the same planning API without Firebase or DOM dependencies', () => {
  const context = vm.createContext({}); vm.runInContext(readFileSync(join(__dirname, '../assets/board-assignment.js'), 'utf8'), context);
  assert.equal(typeof context.BancaBoardAssignment.plan, 'function');
  assert.deepEqual(clone(context.BancaBoardAssignment.plan(fixture())), assignment.plan(fixture()));
});
