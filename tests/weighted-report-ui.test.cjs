const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ui = require('../assets/weighted-report-ui.js');

const model = { name: 'Modelo 2026', title: 'Avaliações finais', boardWeight: 60, monographWeight: 40, criteriaWeights: { presentation: 25, practice: 25, code: 25, time: 25 }, evaluatorWeights: { alberson: 2, bruno: 0 }, decimals: 2 };
const boards = [{ id: 'b1', label: 'Grupo 1', courseName: 'Informática', className: '3A', sealed: true, students: [{ id: 's1', name: 'Ana', status: 'Encerrada', result: { banca: 0, entrega: 9, final: 3.6 }, evaluators: [{ uid: 'alberson', name: 'Alberson', presentation: 0, practice: 0, code: 0, time: 0, mean: 0 }, { uid: 'bruno', name: 'Bruno', presentation: null, practice: null, code: null, time: null, mean: null }] }, { id: 's2', name: 'Bia', result: { banca: null, entrega: null, final: null }, evaluators: [] }] }];
const fixture = extra => ({ model, boards, previewBoards: boards, users: { alberson: { role: 'coordinator', name: 'Alberson' }, bruno: { role: 'teacher', name: 'Bruno' } }, ...extra });
const tag = (html, pattern) => html.match(pattern)?.[0] || '';

test('coordinator workspace provides editable model controls and portable local-model actions', () => {
  const html = ui.render(fixture({ models: [{ id: 'saved', name: 'Meu modelo', model }], selectedModelId: 'saved' }));
  assert.match(html, /Relatórios personalizados/);
  assert.match(html, /Use as notas salvas para calcular o resultado com este modelo/);
  assert.match(html, /id="weighted-model-form"/);
  assert.match(html, /name="name" maxlength="80" value="Modelo 2026"/);
  assert.match(html, /name="title" maxlength="140" value="Avaliações finais"/);
  assert.match(html, /name="boardWeight"[^>]*value="60"/);
  assert.match(html, /name="monographWeight"[^>]*value="40"/);
  for (const key of ['presentation', 'practice', 'code', 'time']) assert.match(html, new RegExp(`name="criteria\\.${key}"[^>]*value="25"`));
  assert.match(html, /name="evaluator.alberson"[^>]*value="2" data-weighted-evaluator="alberson"/);
  assert.match(html, /name="evaluator.bruno"[^>]*value="0" data-weighted-evaluator="bruno"/);
  assert.match(html, /value="saved" selected>Meu modelo/);
  assert.match(html, /Salvar neste dispositivo/);
  for (const action of ['new', 'delete', 'save', 'reset', 'export-model']) assert.match(html, new RegExp(`type="button"[^>]*data-weighted-${action}`));
  assert.match(html, /id="weighted-model-import" type="file" accept="application\/json,.json"/);
  assert.match(html, /Coordenadores também participam como avaliadores/);
  assert.match(html, /Os modelos salvos ficam vinculados à sua conta neste navegador/);
});

test('filter and export controls retain submitted selection and content preferences', () => {
  const html = ui.render(fixture({ filters: { course: 'Informática', className: '3A', board: 'b1', status: 'pendentes', search: 'Ana', sort: 'grade-desc' }, report: { includeSummary: false, includeDetails: true, includeCharts: false, notes: 'Revisão da coordenação' } }));
  for (const name of ['course', 'class', 'status', 'board', 'sort', 'search']) assert.match(html, new RegExp(`id="weighted-${name}"`));
  assert.match(html, /id="weighted-filter-form"/);
  assert.match(html, /value="Informática" selected/);
  assert.match(html, /value="3A" selected/);
  assert.match(html, /value="b1" selected/);
  assert.match(html, /value="pendentes" selected/);
  assert.match(html, /value="grade-desc" selected/);
  assert.match(html, /Ordenar alunos em cada grupo/);
  assert.match(html, /type="search" name="search" value="Ana"/);
  assert.doesNotMatch(tag(html, /<input id="weighted-summary"[^>]*>/), /checked/);
  assert.match(tag(html, /<input id="weighted-details"[^>]*>/), /checked/);
  assert.doesNotMatch(tag(html, /<input id="weighted-charts"[^>]*>/), /checked/);
  assert.match(html, />Revisão da coordenação<\/textarea>/);
  assert.match(html, /id="weighted-report-notes"[^>]*maxlength="2000"/);
  for (const kind of ['pdf', 'csv', 'charts']) assert.doesNotMatch(tag(html, new RegExp(`<button[^>]*data-weighted-export="${kind}"[^>]*>`)), /disabled/);
  assert.match(html, /<caption>Resultados por aluno/);
  assert.match(html, /Notas individuais dos avaliadores/);
  assert.match(html, /id="weighted-charts-options" class="weighted-options"/);
});

test('zero grades remain numeric while missing grades are explicitly pending', () => {
  const html = ui.render(fixture({ report: { includeCharts: false } }));
  assert.match(html, /class="weighted-number">0,00<\/td>/);
  assert.match(html, /class="weighted-number weighted-final">3,60<\/td>/);
  assert.match(html, /<span class="weighted-pending">Pendente<\/span>/);
  assert.match(html, /Desconsiderado neste modelo/);
  assert.match(html, /Nenhuma avaliação registrada para este aluno/);
  assert.match(html, /Resultados pendentes<\/span><strong>1/);
  assert.match(html, /Média dos resultados<\/span><strong>3,60/);
  assert.match(html, /<details class="weighted-student">/);
  assert.match(html, /<th scope="col">Monografia e entregas<\/th>/);
});

test('draft retains invalid values for correction and display precision affects only formatting', () => {
  const draft = { ...model, name: 'Em edição', boardWeight: '', monographWeight: -1, decimals: 4, criteriaWeights: { ...model.criteriaWeights, code: '' } };
  const html = ui.render(fixture({ draft }));
  assert.match(html, /name="name" maxlength="80" value="Em edição"/);
  assert.match(html, /name="boardWeight"[^>]*value=""/);
  assert.match(html, /name="monographWeight"[^>]*value="-1"/);
  assert.match(html, /name="criteria.code"[^>]*value=""/);
  assert.match(html, /value="4" selected>4 casas decimais/);
  assert.match(html, /class="weighted-number weighted-final">3,60</);
  assert.doesNotMatch(html, /class="weighted-number weighted-final">3,6000/);
  assert.equal(boards[0].students[0].result.final, 3.6);
});

test('all text and form attributes are escaped without accepting chart HTML strings', () => {
  const attack = '\"></textarea><img src=x onerror=alert(1)><script>run()</script>';
  const html = ui.render(fixture({ model: { ...model, name: attack, title: attack, evaluatorWeights: { [attack]: 3 } }, users: { [attack]: { role: 'coordinator', name: attack } }, boards: [{ id: attack, label: attack, className: attack, courseName: attack, students: [{ name: attack, status: attack, result: { final: null }, evaluators: [{ uid: attack, name: attack }] }] }], previewBoards: [{ label: attack, students: [{ name: attack, result: { final: null }, pending: [attack], evaluators: [] }] }], models: [{ id: attack, name: attack }], filters: { search: attack }, report: { notes: attack }, error: attack, storageMessage: attack, formula: attack, chartHtml: attack }));
  assert.doesNotMatch(html, /<img|<script>|<\/textarea><img|value="" on/);
  assert.match(html, /&quot;&gt;&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-weighted-evaluator="&quot;&gt;/);
  assert.match(html, /id="weighted-report-error"[^>]*role="alert"/);
  assert.match(html, /id="weighted-storage-status"[^>]*role="status" aria-live="polite"/);
});

test('empty and busy states disable unavailable actions and keep explanatory content', () => {
  const html = ui.render({ busy: true, boards: [] });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Nenhum aluno nesta consulta/);
  assert.match(html, /Ajuste os filtros/);
  for (const kind of ['pdf', 'csv', 'charts']) assert.match(tag(html, new RegExp(`<button[^>]*data-weighted-export="${kind}"[^>]*>`)), /disabled/);
  assert.match(tag(html, /<button[^>]*data-weighted-delete[^>]*>/), /disabled/);
  assert.match(tag(html, /<button class="btn primary" type="submit"[^>]*>/), /disabled/);
  assert.match(html, /Nenhum avaliador cadastrado/);
  assert.match(ui.render({}), /name="boardWeight"[^>]*value="60"/);
});

test('busy prevents edits to every model, filter, content and notes control', () => {
  const busy = ui.render(fixture({ busy: true }));
  const controls = [...busy.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map(match => match[0]);
  assert.ok(controls.length >= 22);
  for (const control of controls) assert.match(control, /\sdisabled(?:\s|>)/, control);
  const ready = ui.render(fixture({ busy: false }));
  for (const control of ready.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) assert.doesNotMatch(control[0], /\sdisabled(?:\s|>)/);
});

test('dirty draft shows a pending preview notice while the initial and applied states do not', () => {
  const initial = ui.render(fixture());
  assert.doesNotMatch(initial, /class="weighted-dirty"/);
  const dirty = ui.render(fixture({ dirty: true, draft: { ...model, boardWeight: 70 } }));
  assert.match(dirty, /class="weighted-dirty" role="status" aria-live="polite">Pesos alterados\. Atualize a prévia antes de baixar\./);
  assert.match(dirty, /name="boardWeight"[^>]*value="70"/);
  assert.match(dirty, /Fórmula do modelo aplicado · Modelo 2026/);
  assert.doesNotMatch(ui.render(fixture({ dirty: false })), /class="weighted-dirty"/);
});

test('browser UMD uses the calculation formula and trusted accessible chart renderer', () => {
  const calls = [];
  const context = { BancaWeightedModel: { defaults: () => model, formula: value => `Modelo: ${value.name} <texto>` }, BancaAnalytics: { renderChart: spec => { calls.push(spec); return '<figure class="ba-chart">Gráfico seguro</figure>'; } } };
  vm.runInNewContext(readFileSync(join(__dirname, '../assets/weighted-report-ui.js'), 'utf8'), context);
  const specs = [{ id: 'custom-results', rows: [] }];
  const html = context.BancaWeightedReportUI.render(fixture({ charts: specs }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], specs[0]);
  assert.match(html, /Modelo: Modelo 2026 &lt;texto&gt;/);
  assert.match(html, /<figure class="ba-chart">Gráfico seguro/);
  assert.match(html, /class="weighted-chart-grid"/);
  assert.ok(Object.isFrozen(context.BancaWeightedReportUI));
});

test('historical evaluators remain configurable even when their registration is inactive or absent', () => {
  const html = ui.render(fixture({ users: { alberson: { role: 'coordinator', name: 'Alberson', active: false }, ignored: { role: 'student', name: 'Aluno' } }, model: { ...model, evaluatorWeights: { retired: 0.5 } } }));
  assert.match(html, /Alberson · cadastro inativo/);
  assert.match(html, /data-weighted-evaluator="bruno"/);
  assert.match(html, /data-weighted-evaluator="retired"/);
  assert.doesNotMatch(html, /data-weighted-evaluator="ignored"/);
  const before = JSON.stringify({ model, boards });
  ui.render(fixture());
  assert.equal(JSON.stringify({ model, boards }), before);
});

test('simple flow keeps selection, applied average, all downloads and results available while advanced panels start closed', () => {
  const html = ui.render(fixture());
  const headings = ['Escolha os alunos', 'Confira a média', 'Baixe o arquivo'];
  assert.ok(html.indexOf(headings[0]) < html.indexOf(headings[1]));
  assert.ok(html.indexOf(headings[1]) < html.indexOf(headings[2]));
  for (const id of ['weighted-filters-options', 'weighted-model-options', 'weighted-evaluator-options', 'weighted-content-options', 'weighted-individual-options', 'weighted-charts-options', 'weighted-formula-options']) {
    const element = tag(html, new RegExp(`<details id="${id}"[^>]*>`));
    assert.ok(element, id); assert.doesNotMatch(element, /\sopen(?:\s|>)/);
  }
  assert.match(html, /class="weighted-composition" aria-label="Composição do resultado aplicado"/);
  assert.match(html, /<strong>60<small>%/);
  assert.match(html, /<strong>40<small>%/);
  assert.match(html, /Os resultados oficiais permanecem preservados/);
  for (const kind of ['pdf', 'csv', 'charts']) assert.ok(html.indexOf(`data-weighted-export="${kind}"`) < html.indexOf('id="weighted-content-options"'));
  assert.match(html, /id="weighted-model-form"[^>]*novalidate/);
});

test('advanced panel state is explicit and preserved independently from chosen PDF sections', () => {
  const ids = ['weighted-model-options', 'weighted-evaluator-options', 'weighted-individual-options', 'weighted-formula-options'];
  const html = ui.render(fixture({ uiOpen: Object.fromEntries(ids.map(id => [id, true])), report: { includeSummary: false, includeDetails: false, includeCharts: false } }));
  for (const id of ids) assert.match(tag(html, new RegExp(`<details id="${id}"[^>]*>`)), /\sopen>/);
  assert.doesNotMatch(tag(html, /<details id="weighted-charts-options"[^>]*>/), /\sopen(?:\s|>)/);
  assert.match(html, /<caption>Resultados por aluno/);
  assert.match(html, /Notas individuais dos avaliadores/);
  assert.match(html, /Selecione o conteúdo do PDF abaixo/);
});

test('unapplied search text remains in its input and model errors are shown before downloads', () => {
  const html = ui.render(fixture({ searchDraft: 'Bia <pendente>', filters: { search: 'Ana' }, error: 'Os pesos devem somar 100%.' }));
  assert.match(html, /name="search" value="Bia &lt;pendente&gt;"/);
  assert.ok(html.indexOf('id="weighted-report-error"') < html.indexOf('data-weighted-export="pdf"'));
  assert.match(html, /Os pesos devem somar 100%\./);
});
