const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const report = require('../assets/coordinator-report.js');
const analytics = require('../assets/analytics.js');

const student = (name, result = null, extra = {}) => ({ id: name, name, result, evaluators: [], ...extra });
const board = (label, students, extra = {}) => ({ id: label, label, courseName: 'ADS', className: '3A', students, ...extra });
const result = final => ({ banca: final, entrega: final, parcelaBanca: final * .6, parcelaEntrega: final * .4, final });

function parseCsv(value) {
  const rows = [], row = [];
  let field = '', quoted = false;
  for (let index = 1; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      if (quoted && value[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) { row.push(field); field = ''; }
    else if (char === '\r' && value[index + 1] === '\n' && !quoted) {
      row.push(field); rows.push(row.splice(0)); field = ''; index++;
    } else field += char;
  }
  return rows;
}

test('summary covers archived, provisional, pending and unassigned students without averaging boards', () => {
  const source = [
    board('A', [student('Ana', result(10)), student('Bia', result(8))], { sealed: true, elapsedMs: 0 }),
    board('B', [student('Carla', result(0)), student('Davi')], { archived: true, elapsedMs: 120000 }),
    board('Sem banca', [student('Eva')], { unassigned: true, elapsedMs: 900000 })
  ];
  assert.deepEqual(report.summary(source), {
    boardCount: 2, studentCount: 5, pendingCount: 2, officialCount: 2, provisionalCount: 1,
    unassignedCount: 1, meanFinal: 6, meanBanca: 6, meanMonografia: 6, timedCount: 2, meanElapsedMs: 60000
  });
});

test('independent banca and monografia remain available while incomplete final and zero are distinct', () => {
  const source = [board('A', [student('Parcial', { banca: 0, entrega: 8, parcelaBanca: 0, parcelaEntrega: 3.2 }), student('Sem notas')])];
  const summary = report.summary(source), spec = report.charts(source)[0];
  assert.equal(summary.meanBanca, 0);
  assert.equal(summary.meanMonografia, 8);
  assert.equal(summary.meanFinal, null);
  assert.equal(summary.pendingCount, 2);
  assert.deepEqual(spec.rows.map(row => row.values), [[0, 8, null], [null, null, null]]);
  assert.match(spec.rows[0].label, /Pendente/);
  const csv = parseCsv(report.csv(source));
  assert.deepEqual(csv[1].slice(14, 20), ['0,00', '8,00', '0,00', '3,20', '', 'Pendente']);
  assert.deepEqual(csv[2].slice(9, 19), Array(10).fill(''));
});

test('criteria means use the explicit available saved-grade denominator including incomplete evaluations', () => {
  const source = [board('A', [student('Ana', null, { evaluators: [
    { presentation: 0, practice: 8, code: 9, time: 10, mean: 6.75 },
    { presentation: 10, practice: null, code: undefined, time: '', mean: null }
  ] }), student('Bia', null, { evaluators: [{ presentation: 5, practice: 11, code: NaN, time: -1 }] })])];
  const spec = report.charts(source)[1];
  assert.deepEqual(spec.rows.map(row => row.values[0]), [5, 8, 9, 10]);
  assert.deepEqual(spec.rows.map(row => row.label.match(/\d+/)[0]), ['3', '1', '1', '1']);
  assert.match(spec.subtitle, /somente as notas salvas válidas/);
  assert.match(spec.subtitle, /avaliação incompleta/);
});

test('duration charts preserve every real board including archived and zero but exclude unassigned placeholders', () => {
  const spec = report.charts([
    board('A', [], { elapsedMs: 0, plannedMs: 1200000 }),
    board('B', [], { archived: true, elapsedMs: 3700000, plannedMs: 900000 }),
    board('C', [], { elapsedMs: undefined, plannedMs: null }),
    board('Sem banca', [], { unassigned: true, elapsedMs: 99999999 })
  ])[2];
  assert.equal(spec.rows.length, 3);
  assert.deepEqual(spec.rows.map(row => row.values), [[0, 1200000], [3700000, 900000], [null, null]]);
  assert.equal(spec.max, 3700000);
  assert.equal(spec.unit, 'duration');
  assert.match(spec.subtitle, /arguição e transição/);
});

test('all student names and results survive chart specs, SVG pagination and individual evaluator CSV rows', () => {
  const name = 'Aluno com sobrenome ' + 'W'.repeat(180);
  const source = Array.from({ length: 25 }, (_, index) => board(`Grupo ${index}`, [student(`${name} ${index}`, result(index % 11), { status: index % 2 ? 'Encerrada' : 'Provisório', evaluators: [{ uid: 'p1', name: 'Alberson', presentation: 0 }, { uid: 'p2', name: 'Professora', presentation: 10 }] })], { archived: index > 19 }));
  const specs = report.charts(source);
  assert.equal(specs[0].rows.length, 25);
  assert.ok(specs[0].rows.every((row, index) => row.label.includes(`${name} ${index}`)));
  const html = analytics.renderChart(specs[0]);
  assert.equal((html.match(/<th scope="row">/g) || []).length, 25);
  assert.match(html, /Parte 4 de 4/);
  assert.match(html, /Monografia e entregas/);
  assert.match(html, /Provisório/);
  assert.match(html, /Encerrada/);
  const csv = parseCsv(report.csv(source));
  assert.equal(csv.length, 51);
  assert.equal(csv[1][6], name + ' 0');
  assert.equal(csv[50][6], name + ' 24');
  assert.equal(csv[50][24], 'Sim');
});

test('CSV preserves unassigned students and exports metadata and precise scores without fabricating evaluator data', () => {
  const source = [board('Grupo 1', [student('Ana', { banca: 7.12345, entrega: 9.5, parcelaBanca: 4.27407, parcelaEntrega: 3.8, final: 8.07407 }, { evaluators: [{ uid: 'coord', name: 'Alberson', presentation: 7.12345, practice: 9, code: 10, time: 8, mean: 8.5308625 }] })], { project: 'Monografia', startLabel: '20/10/2026 18:00', room: 'Sala 1', advisorName: 'Orientador', sealed: true, elapsedMs: 123456, plannedMs: 1200000 }), board('Alunos sem banca', [student('Bia')], { unassigned: true })];
  const text = report.csv(source), rows = parseCsv(text);
  assert.equal(text.charCodeAt(0), 0xFEFF);
  assert.ok(text.endsWith('\r\n'));
  assert.equal(rows[1][9], '7,1235');
  assert.equal(rows[1][13], '8,5309');
  assert.equal(rows[1][18], '8,0741');
  assert.deepEqual(rows[1].slice(20), ['20/10/2026 18:00', 'Sala 1', 'Orientador', 'Sim', 'Não', 'Não', '123456', '1200000', '']);
  assert.equal(rows[2][4], '');
  assert.equal(rows[2][6], 'Bia');
  assert.deepEqual(rows[2].slice(7, 19), Array(12).fill(''));
  assert.equal(rows[2][19], 'Sem banca');
  assert.equal(rows[2][25], 'Sim');
  assert.equal(rows[2].length, rows[0].length);
});

test('multi-year exports and charts identify repeated group names by academic year without shifting original CSV columns', () => {
  const source = [board('Grupo 01', [student('Ana', result(8))], { academicYear: 2030 }), board('Grupo 01', [student('Bia', result(9))], { academicYear: 2031 })];
  const rows = parseCsv(report.csv(source));
  assert.equal(rows[0][0], 'Curso'); assert.equal(rows[0][6], 'Aluno');
  assert.equal(rows[0].at(-1), 'Ano letivo');
  assert.equal(rows[1].at(-1), '2030'); assert.equal(rows[2].at(-1), '2031');
  const charts = report.charts(source);
  assert.match(charts[0].rows[0].label, /Ano 2030/); assert.match(charts[0].rows[1].label, /Ano 2031/);
  assert.match(charts[2].rows[0].label, /Ano 2030/); assert.match(charts[2].rows[1].label, /Ano 2031/);
});

test('CSV quotes delimiters and line breaks and neutralizes every textual formula prefix', () => {
  const attacks = ['=SUM(1;2)', ' +cmd', '\t@evil()', '-1+2', '\uFEFF=HYPERLINK("evil")'];
  const source = attacks.map((attack, index) => board(attack, [student(attack + ';"\r\nAluno', null, { evaluators: [{ uid: attack, name: attack }] })], { id: attack, courseName: attack, className: attack, project: attack, room: attack, advisorName: attack, startLabel: attack }));
  const rows = parseCsv(report.csv(source));
  assert.equal(rows.length, 6);
  attacks.forEach((attack, index) => {
    const row = rows[index + 1];
    assert.ok(row[0].startsWith("'"));
    assert.ok(row[2].startsWith("'"));
    assert.equal(row[6], "'" + attack.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() + ';" Aluno');
    assert.equal(row[8], "'" + attack);
    assert.equal(row.length, rows[0].length);
  });
});

test('invalid grades are absent, source remains unchanged and empty/browser module APIs behave consistently', () => {
  const source = [board('A', [student('Invalid', { banca: '', entrega: 11, final: Infinity }, { evaluators: [{ presentation: '0', practice: -1, code: NaN, time: null }] })], { elapsedMs: -1, plannedMs: '0' })];
  const before = JSON.stringify(source);
  assert.deepEqual(report.charts(source)[0].rows[0].values, [null, null, null]);
  assert.deepEqual(report.charts(source)[2].rows[0].values, [null, null]);
  assert.equal(report.summary(source).meanFinal, null);
  assert.equal(JSON.stringify(source), before);
  assert.equal(report.summary(null).studentCount, 0);
  assert.equal(report.summary([]).meanFinal, null);
  assert.equal(parseCsv(report.csv([])).length, 1);
  assert.equal(report.charts([])[0].rows.length, 0);
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/coordinator-report.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.BancaCoordinatorReport.csv, 'function');
  assert.equal(sandbox.BancaCoordinatorReport.summary([]).meanFinal, null);
});
