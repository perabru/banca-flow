const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const academic = require('../assets/academic-years.js');
const at = value => Date.parse(value);
const clone = value => JSON.parse(JSON.stringify(value));

test('UMD exposes the same immutable API without app or Firebase dependencies', () => {
  const context = vm.createContext({ Intl, Date });
  vm.runInContext(readFileSync(join(__dirname, '..', 'assets/academic-years.js'), 'utf8'), context);
  assert.equal(typeof context.BancaAcademicYears.yearOfGroup, 'function');
  assert.equal(context.BancaAcademicYears.LEGACY_YEAR, 2026);
  assert.equal(Object.isFrozen(academic), true);
});

test('year parsing accepts only integers and exact four-digit strings in the durable range', () => {
  for (const value of [2000, 2026, 2047, 9999, '2000', '2047', '9999']) assert.equal(academic.parseYear(value), Number(value));
  for (const value of [undefined, null, true, false, {}, [], '', 'todos', ' 2026', '2026 ', '+2026', '02026', '2026.0', '2.026e3', '２０２６', NaN, Infinity, -Infinity, 1999, 10000, 2026.5]) assert.equal(academic.parseYear(value), null);
});

test('calendar boundaries consistently use the São Paulo year rather than UTC or browser time zone', () => {
  assert.equal(academic.calendarYear(at('2030-01-01T02:59:59.999Z')), 2029);
  assert.equal(academic.calendarYear(at('2030-01-01T03:00:00.000Z')), 2030);
  assert.equal(academic.calendarYear(new Date('2031-07-01T00:00:00Z')), 2031);
  assert.equal(academic.calendarYear(0), 2026);
  assert.equal(academic.calendarYear('2030-01-01'), 2026);
  assert.equal(academic.calendarYear(NaN), 2026);
});

test('explicit academic year wins over presentation date and group creation date', () => {
  const group = { id: 'g1', academicYear: 2030, createdAt: at('2028-06-01T12:00:00Z') };
  const board = { groupId: 'g1', startAt: at('2031-02-01T12:00:00Z') };
  assert.equal(academic.yearOfGroup(group, { b1: board }), 2030);
  assert.equal(academic.yearOfBoard(board, group), 2030);
  assert.equal(academic.yearOfGroup({ ...group, academicYear: '2030' }, { b1: board }), 2030);
});

test('legacy group year uses its matching bank date and never an unrelated bank', () => {
  const group = { id: 'g1', createdAt: at('2027-04-12T12:00:00Z') };
  const boards = { unrelated: { groupId: 'g2', startAt: at('2032-04-01T12:00:00Z') }, own: { groupId: 'g1', startAt: at('2030-01-01T01:00:00Z') } };
  assert.equal(academic.yearOfGroup(group, boards), 2029);
  assert.equal(academic.yearOfBoard(boards.own, group), 2029);
  delete boards.own;
  assert.equal(academic.yearOfGroup(group, boards), 2027);
});

test('undated legacy groups retain the original 2026 year without being moved on every new year', () => {
  for (const group of [undefined, null, {}, { id: 'old' }, { id: 'old', academicYear: 'invalid', createdAt: 0 }, { id: 'old', createdAt: NaN }]) assert.equal(academic.yearOfGroup(group), 2026);
  assert.equal(academic.yearOfBoard(null, null), 2026);
  assert.equal(academic.yearOfBoard({ startAt: '1792321200000' }, {}), 2026);
  assert.equal(academic.yearOfBoard({ startAt: 1e30 }, {}), 2026);
});

test('multiple historical bank links use their earliest valid date deterministically', () => {
  const group = { id: 'g1' }, older = { groupId: 'g1', startAt: at('2028-06-01T12:00:00Z') }, newer = { groupId: 'g1', startAt: at('2030-06-01T12:00:00Z') };
  assert.equal(academic.yearOfGroup(group, { newer, bad: { groupId: 'g1', startAt: 0 }, older }), 2028);
  assert.equal(academic.yearOfGroup(group, { older, newer }), 2028);
});

test('year catalog includes current, archived, unassigned and orphan bank histories without mutation', () => {
  const groups = { old: { id: 'old', active: false }, future: { id: 'future', academicYear: 2040 }, inferred: { createdAt: at('2028-06-01T12:00:00Z') }, linked: { academicYear: 2033 } };
  const boards = { old: { groupId: 'old', startAt: at('2027-06-01T12:00:00Z') }, orphan: { groupId: 'missing', startAt: at('2035-06-01T12:00:00Z') }, linked: { groupId: 'linked', startAt: at('2034-06-01T12:00:00Z') }, invalid: null };
  const before = clone({ groups, boards });
  assert.deepEqual(academic.years(groups, boards, at('2030-07-01T12:00:00Z')), [2040, 2035, 2033, 2030, 2028, 2027]);
  assert.deepEqual({ groups, boards }, before);
  assert.deepEqual(academic.years(null, null, at('2031-07-01T12:00:00Z')), [2031]);
});

test('filters select by academic year and default to all history for missing or invalid scope', () => {
  const group = { id: 'g', academicYear: 2040 }, board = { groupId: 'g', startAt: at('2041-07-01T12:00:00Z') }, boards = { b: board };
  for (const selected of ['todos', undefined, '', 'invalid']) { assert.equal(academic.matchesGroup(group, boards, selected), true); assert.equal(academic.matchesBoard(board, group, selected), true); }
  assert.equal(academic.matchesGroup(group, boards, '2040'), true);
  assert.equal(academic.matchesBoard(board, group, 2040), true);
  assert.equal(academic.matchesGroup(group, boards, 2041), false);
  assert.equal(academic.matchesBoard(board, group, '2041'), false);
});

test('new groups use explicit selected year or current local year when viewing all history', () => {
  const now = at('2030-01-01T02:00:00Z');
  assert.equal(academic.newGroupYear('todos', now), 2029);
  assert.equal(academic.newGroupYear('2032', now), 2032);
  assert.equal(academic.newGroupYear(undefined, now), 2029);
  assert.equal(academic.newGroupYear('bad', now), 2029);
});

test('selector is labeled, describes history preservation and includes next year for continued use', () => {
  const html = academic.renderYearSelector({ selected: 'todos', years: [2026, 2029, 2029, null, '<script>'], currentYear: 2030 });
  assert.match(html, /label for="academic-year-filter">Ano letivo/);
  assert.match(html, /select id="academic-year-filter"[^>]+aria-describedby="academic-year-help"/);
  assert.match(html, /value="todos" selected>Todos os anos/);
  assert.match(html, /value="2031"/);
  assert.match(html, /Todo o histórico disponível/);
  assert.match(html, /registros dos outros anos permanecem salvos/);
  assert.equal((html.match(/value="2029"/g) || []).length, 1);
  assert.ok(html.indexOf('value="2031"') < html.indexOf('value="2030"'));
  assert.doesNotMatch(html, /<script>|value="null"/);
});

test('selector retains an explicitly selected distant year and never produces an out-of-range next year', () => {
  const selected = academic.renderYearSelector({ selected: 2080, years: [2026], currentYear: 2030 });
  assert.match(selected, /value="2080" selected>2080/);
  assert.match(selected, /Consultando o ano letivo de 2080/);
  const last = academic.renderYearSelector({ selected: '<img src=x>', currentYear: 9999, years: [10000] });
  assert.doesNotMatch(last, /10000|<img/);
  assert.match(last, /value="todos" selected/);
});

test('old-rule fallback strips only newly introduced and exactly inferable academic years without changing data', () => {
  const candidate = { id: 'new', academicYear: 2030, name: 'Grupo', createdAt: { '.sv': 'timestamp' }, students: { s1: 'Ana' } };
  const before = clone(candidate), now = at('2030-06-20T12:00:00Z');
  assert.deepEqual(academic.legacyGroupWrite(candidate, { serverTime: now }), { id: 'new', name: 'Grupo', createdAt: { '.sv': 'timestamp' }, students: { s1: 'Ana' } });
  assert.deepEqual(candidate, before);
  assert.equal(academic.legacyGroupWrite({ ...candidate, academicYear: 2031 }, { serverTime: now }), null);
  assert.equal(academic.legacyGroupWrite(candidate, { serverTime: now, previous: { id: 'new', academicYear: 2030 } }), null);
  assert.equal(academic.legacyGroupWrite(candidate, { serverTime: now, previous: { id: 'new', academicYear: null } }), null);
});

test('old-rule fallback keeps historical inferred years and refuses misclassification at a year boundary', () => {
  const candidate = { id: 'legacy', academicYear: 2026, name: 'Original' };
  assert.deepEqual(academic.legacyGroupWrite(candidate), { id: 'legacy', name: 'Original' });
  assert.equal(academic.legacyGroupWrite({ ...candidate, academicYear: 2030 }), null);
  const dated = { ...candidate, academicYear: 2029, createdAt: at('2028-06-20T12:00:00Z') };
  const boards = { b: { groupId: 'legacy', startAt: at('2029-06-20T12:00:00Z') } };
  assert.deepEqual(academic.legacyGroupWrite(dated, { previous: { ...dated, academicYear: undefined }, boards }), null);
  assert.deepEqual(academic.legacyGroupWrite(dated, { previous: { id: 'legacy' }, boards }), { id: 'legacy', name: 'Original', createdAt: dated.createdAt });
  for (const now of ['2030-01-01T04:00:00Z', '2030-12-31T22:00:00Z']) assert.equal(academic.legacyGroupWrite({ ...candidate, academicYear: 2030, createdAt: { '.sv': 'timestamp' } }, { serverTime: at(now) }), null);
});
