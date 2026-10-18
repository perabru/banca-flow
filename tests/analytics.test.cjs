const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const analytics = require('../assets/analytics.js');

const student = (name, final, extras = {}) => ({
  id: name, name, evaluators: [],
  result: final === null ? null : { banca: final, entrega: final, parcelaBanca: final * .6, parcelaEntrega: final * .4, final },
  ...extras
});
const board = (label, students, extra = {}) => ({ id: label, label, courseName: 'ADS', className: '3A', students, plannedMs: 1200000, elapsedMs: null, ...extra });

test('summary averages individual students, rather than averaging differently sized boards', () => {
  const boards = [board('A', [student('Ana', 10), student('Bruno', 8)], { elapsedMs: 0 }), board('B', [student('Carla', 2)], { elapsedMs: 60000 }), board('C', [student('Pendente', null)])];
  const result = analytics.summary(boards);
  assert.equal(result.boardCount, 3);
  assert.equal(result.studentCount, 4);
  assert.equal(result.meanFinal, 20 / 3);
  assert.equal(result.timedCount, 2);
  assert.equal(result.meanElapsedMs, 30000);
});

test('empty or missing records are absent, while zero grades and zero recorded time remain real data', () => {
  assert.deepEqual(analytics.summary([]), { boardCount: 0, studentCount: 0, meanFinal: null, meanElapsedMs: null, timedCount: 0 });
  const source = [board('A', [student('Zero', 0), student('Ausente', null)], { elapsedMs: 0 })];
  const result = analytics.summary(source);
  assert.equal(result.meanFinal, 0);
  assert.equal(result.meanElapsedMs, 0);
  assert.equal(result.timedCount, 1);
  const specs = analytics.overview(source);
  assert.deepEqual(specs[0].rows[0].values, [0, 0, 0]);
  assert.deepEqual(specs[1].rows[0].values, [0, 1200000]);
  assert.deepEqual(specs[2].rows.map(row => row.values), [[0, 0], [null, null]]);
});

test('overview preserves weighted components and a shared 0–10 grade scale', () => {
  const boards = [board('Projeto 1', [student('Ana', 8.8, { result: { banca: 8, entrega: 10, parcelaBanca: 4.8, parcelaEntrega: 4, final: 8.8 } }), student('Bia', 6.2, { result: { banca: 7, entrega: 5, parcelaBanca: 4.2, parcelaEntrega: 2, final: 6.2 } })])];
  const specs = analytics.overview(boards);
  assert.equal(specs.length, 3);
  assert.deepEqual(specs[0].rows[0].values, [7.5, 7.5, 7.5]);
  assert.equal(specs[0].max, 10);
  assert.equal(specs[2].max, 10);
  assert.equal(specs[2].mode, 'stacked');
  assert.deepEqual(specs[2].rows.map(row => row.values), [[4.8, 4], [4.2, 2]]);
  assert.match(specs[2].rows[0].label, /Ana.*Projeto 1.*ADS/);
});

test('duration scale contains both overrun recordings and the entire reserved agenda slot', () => {
  const boards = [board('Longa', [], { elapsedMs: 3700000, plannedMs: 1200000 }), board('Reserva maior', [], { elapsedMs: 100000, plannedMs: 4200000 })];
  const spec = analytics.overview(boards)[1];
  assert.equal(spec.unit, 'duration');
  assert.ok(spec.max >= 4200000);
  assert.deepEqual(spec.rows.map(row => row.values), [[3700000, 1200000], [100000, 4200000]]);
  assert.match(spec.subtitle, /horário completo.*arguição.*transição/);
});

test('detail charts preserve individual evaluators and every criterion including zero or missing', () => {
  const source = board('TCC', [student('Ana', null, { evaluators: [
    { id: 'p1', name: 'Prof. João', presentation: 0, practice: 7, code: 8, time: 9, mean: 6 },
    { id: 'p2', name: 'Profa. Maria', presentation: 10, practice: null, code: 9, time: 8, mean: null }
  ] }), student('Bia', 8)]);
  const specs = analytics.details(source);
  assert.equal(specs.length, 3);
  assert.equal(specs[0].rows[0].values[2], null);
  assert.deepEqual(specs[1].series.map(series => series.label), ['Prof. João', 'Profa. Maria']);
  assert.deepEqual(specs[1].rows.map(row => row.values), [[0, 10], [7, null], [8, 9], [9, 8]]);
  assert.ok(specs.every(spec => spec.max === 10));
  assert.deepEqual(analytics.details(null), []);
});

test('invalid data is not coerced into grades or durations and source input remains unmodified', () => {
  const boards = [board('A', [student('Inválido', null, { result: { banca: '', entrega: 11, final: NaN, parcelaBanca: -1, parcelaEntrega: '4' } })], { elapsedMs: -1, plannedMs: Infinity })];
  const before = JSON.stringify(boards);
  assert.deepEqual(analytics.overview(boards)[0].rows[0].values, [null, null, null]);
  assert.deepEqual(analytics.overview(boards)[1].rows[0].values, [null, null]);
  assert.equal(analytics.summary(boards).meanFinal, null);
  assert.equal(JSON.stringify(boards), before);
});

test('centisecond formatting keeps zero and hour rollover exact without rounding upward', () => {
  assert.equal(analytics.formatDuration(0), '00:00,00');
  assert.equal(analytics.formatDuration(123459), '02:03,45');
  assert.equal(analytics.formatDuration(3599999), '59:59,99');
  assert.equal(analytics.formatDuration(3600000), '01:00:00,00');
  assert.equal(analytics.formatDuration(null), 'Não registrado');
});

test('SVG rendering provides accessible titles, exact data, legends and explicit missing values', () => {
  const source = [board('A', [student('Zero', 0), student('Pendente', null)], { elapsedMs: 0 })];
  const gradeHtml = analytics.renderChart(analytics.overview(source)[2]);
  const timeHtml = analytics.renderChart(analytics.overview(source)[1]);
  assert.match(gradeHtml, /role="img" aria-labelledby="ba-/);
  assert.match(gradeHtml, /<title id=/);
  assert.match(gradeHtml, /<desc id=/);
  assert.match(gradeHtml, /<table><caption>/);
  assert.match(gradeHtml, /scope="row">Zero/);
  assert.match(gradeHtml, /0,00/);
  assert.match(gradeHtml, /Pendente/);
  assert.match(gradeHtml, /Não disponível/);
  assert.match(timeHtml, /00:00,00/);
  assert.match(timeHtml, /20:00,00/);
  assert.match(timeHtml, /Intervalo reservado/);
});

test('untrusted names, captions, colors and identifiers cannot introduce HTML or SVG attributes', () => {
  const attack = '<script>alert("x")</script><svg onload="evil()">&';
  const html = analytics.renderChart({ id: '" onmouseover="evil()', title: attack, subtitle: attack, unit: 'grade', max: 10, mode: 'grouped', series: [{ label: attack, color: 'red" onload="evil()' }], rows: [{ label: attack, values: [8] }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<svg onload='));
  assert.ok(!html.includes('fill="red'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /fill="#174B8E"/);
  assert.ok(!/id="[^"]*" onmouseover=/.test(html));
});

test('large cohorts are chunked into bounded charts with every exact row retained and names wrapped', () => {
  const source = Array.from({ length: 19 }, (_, index) => board(`Banca ${index}`, [student(`${index}: ${'W'.repeat(160)}`, index % 10)]));
  const html = analytics.renderChart(analytics.overview(source)[2]);
  assert.equal((html.match(/<figure /g) || []).length, 3);
  assert.equal((html.match(/<th scope="row">/g) || []).length, 19);
  assert.match(html, /Parte 1 de 3/);
  assert.match(html, /Parte 3 de 3/);
  assert.ok(!/<text[^>]*>W{30}/.test(html));
  const ids = [...html.matchAll(/<title id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, 3);
});

test('empty charts render an explanatory state and browser UMD has the same API', () => {
  const html = analytics.renderChart(analytics.overview([])[0]);
  assert.match(html, /Sem dados disponíveis/);
  assert.ok(!html.includes('NaN'));
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/analytics.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.BancaAnalytics.summary, 'function');
  assert.equal(sandbox.BancaAnalytics.summary([]).meanFinal, null);
});
