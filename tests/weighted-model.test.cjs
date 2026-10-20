const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../assets/weighted-model.js');
const analytics = require('../assets/analytics.js');

const evaluator = (uid, grade, extra = {}) => ({ uid, name: `Professor ${uid}`, presentation: grade, practice: grade, code: grade, time: grade, mean: grade, ...extra });
const student = (name, evaluators, entrega, extra = {}) => ({ id: name, name, evaluators, result: { banca: 99, entrega, final: 99 }, ...extra });
const board = (id, students, extra = {}) => ({ id, label: id, courseName: 'ADS', className: '3A', students, ...extra });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

function parseCsv(value) {
  const rows = [], row = []; let field = '', quoted = false;
  for (let index = 1; index < value.length; index++) {
    const char = value[index];
    if (char === '"') { if (quoted && value[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (char === ';' && !quoted) { row.push(field); field = ''; }
    else if (char === '\r' && value[index + 1] === '\n' && !quoted) { row.push(field); rows.push(row.splice(0)); field = ''; index++; }
    else field += char;
  }
  return rows;
}

test('default model reproduces the original equal-criteria and 60/40 calculation with zero valid', () => {
  const calculated = model.calculateStudent(student('Ana', [evaluator('a', 6), evaluator('b', 10)], 6));
  assert.equal(calculated.result.banca, 8); assert.equal(calculated.result.entrega, 6);
  approx(calculated.result.parcelaBanca, 4.8); approx(calculated.result.parcelaEntrega, 2.4); approx(calculated.result.final, 7.2);
  assert.equal(calculated.status, 'Personalizado'); assert.equal(calculated.complete, true); assert.deepEqual(calculated.pending, []);
  const zero = model.calculateStudent(student('Bia', [evaluator('a', 0), evaluator('b', 0)], 0));
  assert.deepEqual(zero.result, { banca: 0, entrega: 0, parcelaBanca: 0, parcelaEntrega: 0, final: 0 });
});

test('criteria percentages, relative evaluator weights and stage weights produce an exact unrounded result', () => {
  const configured = { ...model.defaults(), boardWeight: 70, monographWeight: 30, criteriaWeights: { presentation: 10, practice: 20, code: 50, time: 20 }, evaluatorWeights: { a: 1, b: 3 }, decimals: 0 };
  const source = student('Ana', [evaluator('a', 0, { presentation: 6, practice: 8, code: 9, time: 7 }), evaluator('b', 0, { presentation: 9, practice: 10, code: 7, time: 8 })], 9);
  const calculated = model.calculateStudent(source, configured, { sealed: true });
  approx(calculated.evaluators[0].weightedMean, 8.1); approx(calculated.evaluators[1].weightedMean, 8);
  approx(calculated.result.banca, 8.025); approx(calculated.result.final, 8.3175);
  assert.equal(model.formatGrade(calculated.result.final, configured), '8'); assert.equal(calculated.status, 'Personalizado');
  assert.equal(source.result.final, 99, 'calculation never rewrites the stored/previous result');
});

test('missing positive-weight criteria remain pending while zero-weight criteria and evaluators are excluded explicitly', () => {
  const configured = { ...model.defaults(), criteriaWeights: { presentation: 50, practice: 50, code: 0, time: 0 }, evaluatorWeights: { excluded: 0 } };
  const source = student('Ana', [evaluator('a', null, { presentation: 8, practice: 6 }), evaluator('excluded', null)], 8);
  const complete = model.calculateStudent(source, configured);
  assert.equal(complete.result.banca, 7); approx(complete.result.final, 7.4); assert.deepEqual(complete.pending, []);
  assert.equal(complete.evaluators[1].included, false); assert.equal(complete.evaluators[1].weightedMean, null);
  source.evaluators[0].practice = undefined;
  const missing = model.calculateStudent(source, configured);
  assert.equal(missing.result.banca, null); assert.equal(missing.result.final, null); assert.match(missing.pending.join(' '), /Parte prática/);
});

test('a zero stage weight ignores its unavailable data without inventing a raw grade', () => {
  const boardOnly = { ...model.defaults(), boardWeight: 100, monographWeight: 0 };
  const first = model.calculateStudent(student('A', [evaluator('a', 7)], null), boardOnly);
  assert.deepEqual(first.result, { banca: 7, entrega: null, parcelaBanca: 7, parcelaEntrega: 0, final: 7 }); assert.deepEqual(first.pending, []);
  const monoOnly = { ...model.defaults(), boardWeight: 0, monographWeight: 100, evaluatorWeights: { a: 0 } };
  const second = model.calculateStudent(student('B', [], 9), monoOnly);
  assert.deepEqual(second.result, { banca: null, entrega: 9, parcelaBanca: 0, parcelaEntrega: 9, final: 9 }); assert.deepEqual(second.pending, []);
  const unassigned = model.calculateStudent(student('C', [], 9), monoOnly, { unassigned: true });
  assert.equal(unassigned.result.final, null); assert.equal(unassigned.status, 'Sem banca');
});

test('all excluded evaluators, duplicate evaluators and malformed numeric grades cannot fabricate a final result', () => {
  const source = student('A', [evaluator('a', 8)], 8);
  assert.equal(model.calculateStudent(source, { ...model.defaults(), evaluatorWeights: { a: 0 } }).result.final, null);
  assert.equal(model.calculateStudent({ ...source, evaluators: [evaluator('a', 8), evaluator('a', 9)] }).result.final, null);
  for (const invalid of ['8', '', null, undefined, NaN, Infinity, -1, 11]) {
    const result = model.calculateStudent(student('A', [evaluator('a', 8, { code: invalid })], 8));
    assert.equal(result.result.final, null); assert.equal(result.status, 'Pendente');
  }
});

test('normalization rejects invalid percentages, sums, relative weights and display settings', () => {
  for (const invalid of [[], 'model', 1, { version: 2 }, { name: '' }, { title: '' }, { name: 123 }, { title: 123 }, { name: 'x'.repeat(81) }, { title: 'x'.repeat(141) }, { boardWeight: '60' }, { boardWeight: -1 }, { monographWeight: NaN }, { boardWeight: 50 }, { criteriaWeights: [] }, { criteriaWeights: { presentation: 0, practice: 0, code: 0, time: 0 } }, { criteriaWeights: { unknown: 100 } }, { evaluatorWeights: [] }, { evaluatorWeights: { a: -1 } }, { evaluatorWeights: { a: '1' } }, { evaluatorWeights: { a: 101 } }, { evaluatorWeights: JSON.parse('{"__proto__":1}') }, { evaluatorWeights: { prototype: 1 } }, { evaluatorWeights: { constructor: 1 } }, { evaluatorWeights: Object.fromEntries(Array.from({ length: 301 }, (_, i) => [String(i), 1])) }, { decimals: 2.5 }, { decimals: -1 }, { decimals: 5 }]) assert.throws(() => model.normalize(invalid));
  assert.equal(Object.keys(model.normalize({ evaluatorWeights: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(i), 1])) }).evaluatorWeights).length, 300);
  const one = model.defaults(); one.criteriaWeights.code = 0; assert.equal(model.defaults().criteriaWeights.code, 25);
  const normalized = model.normalize({ boardWeight: 70.1, monographWeight: 29.9, criteriaWeights: { presentation: 10.1, practice: 20.2, code: 30.3, time: 39.4 } });
  approx(normalized.boardWeight + normalized.monographWeight, 100); approx(Object.values(normalized.criteriaWeights).reduce((a, b) => a + b), 100);
});

test('applyModel preserves raw scores and original official results through repeated model previews', () => {
  const source = [board('G1', [student('Ana', [evaluator('a', 8)], 4)])], before = JSON.stringify(source);
  const first = model.applyModel(source, model.defaults());
  const second = model.applyModel(first, { ...model.defaults(), boardWeight: 0, monographWeight: 100 });
  assert.equal(JSON.stringify(source), before);
  assert.equal(first[0].students[0].originalResult.final, 99); assert.equal(second[0].students[0].originalResult.final, 99);
  assert.equal(first[0].students[0].evaluators[0].originalMean, 8); assert.equal(second[0].students[0].evaluators[0].presentation, 8);
  approx(first[0].students[0].result.final, 6.4); assert.equal(second[0].students[0].result.final, 4);
  assert.notEqual(first[0].weightedModel, first[0].students[0].modelResult);
  const noPrevious = model.applyModel([board('G2', [{ id: 'Bia', name: 'Bia', evaluators: [] }])]);
  assert.equal(model.applyModel(noPrevious)[0].students[0].originalResult, null);
});

test('summary keeps student denominators, archived/closed/incomplete banks and unassigned pupils', () => {
  const source = [board('G1', [student('A', [evaluator('a', 10)], 10), student('B', [evaluator('a', 8)], 8)], { sealed: true, elapsedMs: 0 }), board('G2', [student('C', [evaluator('a', 0)], 0), student('D', [evaluator('a', null)], 8)], { archived: true, elapsedMs: 120000 }), board('G3', [student('E', [], null)], { unassigned: true })];
  const calculated = model.applyModel(source);
  assert.deepEqual(model.summary(calculated), { boardCount: 2, studentCount: 5, finalCount: 3, pendingCount: 2, personalizedCount: 3, sealedCompleteCount: 2, openCompleteCount: 1, unassignedCount: 1, openCount: 1, sealedCount: 1, archivedCount: 1, meanFinal: 6, meanBanca: 6, meanMonografia: 6.5, timedCount: 2, meanElapsedMs: 60000 });
  assert.deepEqual(model.summary(source), model.summary(calculated), 'raw input never reuses its old final/mean fields');
});

test('charts describe the selected weights and keep exact zero, missing and duration values for every row', () => {
  const configured = { ...model.defaults(), name: 'Modelo 75/25', boardWeight: 75, monographWeight: 25, criteriaWeights: { presentation: 10, practice: 20, code: 30, time: 40 } };
  const source = [board('G1', [student('Zero', [evaluator('a', 0)], 0), student('Pendente', [evaluator('a', null)], 8)], { elapsedMs: 0, plannedMs: 900000 }), board('G2', [student('Sem banca', [], null)], { unassigned: true })];
  const charts = model.charts(source, configured);
  assert.equal(charts.length, 4); assert.equal(charts[0].rows.length, 3); assert.deepEqual(charts[0].rows[0].values, [0, 0, 0]); assert.deepEqual(charts[0].rows[1].values, [null, 8, null]);
  assert.match(charts[0].subtitle, /75%.*25%/); assert.doesNotMatch(charts[1].subtitle, /60%|40%/);
  assert.deepEqual(charts[1].rows[0].values, [0, 0]); assert.match(charts[2].rows[3].label, /40%/); assert.deepEqual(charts[3].rows[0].values, [0, 900000]); assert.equal(charts[3].rows.length, 1);
  const html = charts.map(spec => analytics.renderChart(spec)).join(''); assert.match(html, /Zero/); assert.match(html, /Sem banca/); assert.match(html, /Pendente/);
});

test('individual detail charts include every evaluator, original criterion and selected relative weights', () => {
  const source = board('G1', [student('Ana', [evaluator('a', 4), evaluator('b', 9)], 8)]);
  const chart = model.details(source, { ...model.defaults(), evaluatorWeights: { a: 0, b: 2 } })[0];
  assert.match(chart.series[0].label, /peso 0/); assert.match(chart.series[1].label, /peso 2/);
  assert.deepEqual(chart.rows.map(row => row.values), [[4, 9], [4, 9], [4, 9], [4, 9]]);
});

test('CSV exports precise model calculations, configured formatting, all criteria and full model metadata', () => {
  const configured = { ...model.defaults(), name: 'Meu modelo', title: 'Relatório completo', boardWeight: 70, monographWeight: 30, evaluatorWeights: { a: 1, b: 2 }, decimals: 3 };
  const source = [board('G1', [student('Ana', [evaluator('a', 8), evaluator('b', 9)], 9)], { sealed: true, archived: true, elapsedMs: 123456, plannedMs: 1800000 }), board('G2', [student('Bia', [], null)], { unassigned: true })];
  const csv = model.csv(source, configured), rows = parseCsv(csv), header = rows[0];
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.equal(rows.length, 4); assert.ok(rows.every(row => row.length === header.length));
  const at = label => header.indexOf(label);
  assert.equal(rows[1][at('Modelo')], 'Meu modelo'); assert.equal(rows[1][at('Peso relativo do avaliador')], '1'); assert.equal(rows[2][at('Peso relativo do avaliador')], '2');
  approx(Number(rows[1][at('Resultado do modelo (precisão completa)')].replace(',', '.')), (8 + 18) / 3 * .7 + 9 * .3);
  assert.equal(rows[1][at('Resultado exibido')], '8,767'); assert.equal(rows[3][at('Resultado exibido')], ''); assert.equal(rows[3][at('Sem banca')], 'Sim');
  assert.equal(rows[1][at('Turma arquivada')], 'Sim'); assert.equal(rows[1][at('Peso da banca (%)')], '70'); assert.equal(rows[1][at('Peso da monografia (%)')], '30');
});

test('CSV neutralizes formula prefixes in every metadata field and quotes delimiters/linebreaks', () => {
  const attack = ' \t=HYPERLINK("x");\r\nPessoa';
  const source = [board(attack, [student(attack, [evaluator(attack, 7, { name: attack })], 8)], { id: attack, courseName: attack, className: attack, project: attack, startLabel: attack, room: attack, advisorName: attack })];
  const rows = parseCsv(model.csv(source, { ...model.defaults(), name: '=Modelo', title: '+Relatório' }));
  assert.equal(rows.length, 2); assert.equal(rows[1].length, rows[0].length);
  for (const label of ['Modelo', 'Título do relatório', 'Curso', 'Turma', 'Grupo', 'Projeto', 'ID da banca', 'ID do aluno', 'Aluno', 'UID do avaliador', 'Avaliador', 'Data e horário', 'Sala', 'Orientador']) assert.ok(rows[1][rows[0].indexOf(label)].startsWith("'"), label);
});

test('empty input and browser UMD expose the same pure API without inventing grades', () => {
  assert.equal(model.summary([]).studentCount, 0); assert.equal(model.summary([]).meanFinal, null); assert.equal(model.charts([]).length, 4); assert.equal(parseCsv(model.csv([])).length, 1);
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../assets/weighted-model.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.BancaWeightedModel).sort(), Object.keys(model).sort()); assert.equal(context.BancaWeightedModel.defaults().boardWeight, 60);
});
