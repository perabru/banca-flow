const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../assets/weighted-model.js');
const workbench = require('../assets/weighted-workbench.js');

const copy = value => JSON.parse(JSON.stringify(value));
const evaluator = (uid, grade, values = {}) => ({ uid, name: 'Prof. ' + uid, presentation: grade, practice: grade, code: grade, time: grade, mean: grade, ...values });
const student = (id, grade, delivery = grade, values = {}) => ({ id, name: id, evaluators: [evaluator('t1', grade), evaluator('t2', grade)], result: { banca: grade, entrega: delivery, final: 99 }, ...values });
const board = (id, students, values = {}) => ({ id, label: id, courseName: 'Informática', className: '2A', project: 'Projeto Árvore', advisorName: 'Prof. Áurea', sealed: false, archived: false, students, ...values });
const fixture = () => [
  board('b1', [student('Ana', 8, 9, { evaluators: [evaluator('t1', 8, { presentation: 10, practice: 8, code: 6 }), evaluator('t2', 6)] }), student('Zero', 0), student('Pendente', 7, null)]),
  board('b2', [student('Bia', 9)], { courseName: 'Administração', className: '3B', sealed: true, archived: true }),
  board('sem-banca:g3', [{ id: 'Caio', name: 'Caio', evaluators: [], status: 'Sem banca', result: { banca: null, entrega: null, final: null } }], { unassigned: true, className: '2C' })
];
const configured = () => ({ ...engine.defaults(), name: 'Modelo da coordenação', boardWeight: 75, monographWeight: 25,
  criteriaWeights: { presentation: 50, practice: 25, code: 25, time: 0 }, evaluatorWeights: { t1: 3, t2: 1 }, decimals: 3 });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

class TestFormData {
  constructor(form) { this.values = form.values || {}; }
  get(key) { return Object.hasOwn(this.values, key) ? this.values[key] : null; }
}
function formFor(model, extraEvaluators = {}) {
  const values = { name: model.name, title: model.title, boardWeight: String(model.boardWeight), monographWeight: String(model.monographWeight), decimals: String(model.decimals) };
  for (const [key, value] of Object.entries(model.criteriaWeights)) values['criteria.' + key] = String(value);
  const inputs = Object.entries({ ...model.evaluatorWeights, ...extraEvaluators }).map(([uid, value]) => ({ dataset: { weightedEvaluator: uid }, value: String(value) }));
  return { id: 'weighted-model-form', values, querySelectorAll: () => inputs };
}
function harness(overrides = {}) {
  const memory = new Map(), downloads = [], builds = [], notices = [], changes = [];
  const state = { actor: { uid: 'coord', role: 'coordinator', active: true, revision: 1 }, boards: fixture(), users: { t1: { name: 'Prof. t1', role: 'teacher', active: true }, t2: { name: 'Prof. t2', role: 'teacher', active: true } }, reads: 0, refreshes: 0, unsaved: false };
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const controller = workbench.createController({ engine, ui: { render: value => value }, FormData: TestFormData, storage,
    getSession: () => ({ ...state.actor }), getBoards: () => { state.reads++; return state.boards; }, getUsers: () => state.users,
    refreshData: async () => { state.refreshes++; }, assertSaved: () => { if (state.unsaved) throw Error('Salve as notas em edição.'); },
    buildPdf: (boards, options) => { builds.push({ boards: copy(boards), options: copy(options) }); return new Blob(['%PDF-test']); },
    download: (blob, filename) => downloads.push({ blob, filename }), now: () => new Date('2026-10-20T12:00:00Z'),
    onChange: () => changes.push(true), onNotice: message => notices.push(message), ...overrides
  });
  return { controller, state, memory, storage, downloads, builds, notices, changes };
}
const jsonFile = (model, envelope = {}) => { const text = JSON.stringify({ format: 'bancaflow-weighted-model', version: 1, model, ...envelope }); return { size: Buffer.byteLength(text), text: async () => text }; };

test('only active coordinators can read grades, configure or export; newly created coordinators need no name whitelist', async () => {
  const h = harness();
  for (const actor of [{ uid: 'teacher', role: 'teacher', active: true, revision: 1 }, { uid: 'coord', role: 'coordinator', active: false, revision: 1 }, {}]) {
    h.state.actor = actor;
    assert.throws(() => h.controller.viewData(), /exclusivos da coordenação/);
    assert.throws(() => h.controller.setDraft(configured()), /exclusivos da coordenação/);
    assert.throws(() => h.controller.save(), /exclusivos da coordenação/);
    await assert.rejects(h.controller.exportReport('csv'), /exclusivos da coordenação/);
  }
  assert.equal(h.state.reads, 0); assert.equal(h.downloads.length, 0); assert.equal(h.memory.size, 0);
  h.state.actor = { uid: 'new-coordinator', role: 'coordinator', active: true, revision: 1 };
  h.controller.setDraft(configured()); h.controller.apply();
  assert.equal(h.controller.viewData().summary.studentCount, 5);
  await h.controller.exportReport('pdf'); assert.equal(h.downloads.length, 1);
});

test('configured preview keeps full precision, zero and pending distinct and never mutates saved official grades', () => {
  const h = harness(), before = JSON.stringify(h.state.boards);
  h.controller.setDraft(configured()); h.controller.apply();
  const view = h.controller.viewData(), ana = view.previewBoards[0].students.find(row => row.id === 'Ana');
  approx(ana.result.final, 8.15625); assert.equal(engine.formatGrade(ana.result.final, view.model), '8,156');
  assert.equal(view.previewBoards[0].students.find(row => row.id === 'Zero').result.final, 0);
  assert.equal(view.previewBoards[0].students.find(row => row.id === 'Pendente').result.final, null);
  assert.equal(view.summary.finalCount, 3); assert.equal(view.summary.pendingCount, 2);
  assert.equal(JSON.stringify(h.state.boards), before); assert.equal(ana.originalResult.final, 99);
});

test('form strings accept decimal comma and reject empty, invalid sums and invalid relative weights', () => {
  const h = harness(), model = configured(), form = formFor(model);
  form.values.boardWeight = '70,5'; form.values.monographWeight = '29,5';
  h.controller.apply(form); assert.equal(h.controller.viewData().model.boardWeight, 70.5);
  form.values.boardWeight = ''; assert.throws(() => h.controller.apply(form), /entre 0 e 100/);
  form.values.boardWeight = '70'; form.values.monographWeight = '20'; assert.throws(() => h.controller.apply(form), /somar 100/);
  form.values.boardWeight = '70,5'; form.values.monographWeight = '29,5'; form.values['criteria.code'] = '24'; assert.throws(() => h.controller.apply(form), /somar 100/);
  h.controller.setDraft({ ...model, evaluatorWeights: { t1: '' } }); assert.throws(() => h.controller.apply(), /peso relativo/);
  h.controller.setDraft({ ...model, evaluatorWeights: { t1: 0, t2: 1 } }); h.controller.apply();
  assert.equal(h.controller.viewData().model.evaluatorWeights.t1, 0);
});

test('rendered default evaluator fields do not create a dirty model or block an unchanged export', async () => {
  const h = harness(); h.controller.viewData();
  const form = formFor(engine.defaults(), { t1: 1, t2: 1, newlyRegistered: 1 });
  h.controller.capture({ querySelector: selector => selector === '#weighted-model-form' ? form : null });
  assert.equal(h.controller.viewData().dirty, false);
  await h.controller.exportReport('csv'); assert.equal(h.downloads.length, 1);
});

test('model preferences contain no students or grades and are isolated per coordinator and session revision', () => {
  const h = harness(); h.controller.setDraft(configured()); const saved = h.controller.save();
  assert.equal(h.memory.size, 1); const serialized = [...h.memory.values()][0];
  assert.doesNotMatch(serialized, /Ana|Bia|Pendente|Projeto Árvore|originalResult|evaluators/);
  assert.match(serialized, /Modelo da coordenação/);
  h.state.actor.uid = 'another-coord'; let view = h.controller.viewData(); assert.equal(view.models.length, 0); assert.equal(view.model.boardWeight, 60);
  h.controller.setDraft({ ...engine.defaults(), name: 'Outro modelo' }); h.controller.save(); assert.equal(h.memory.size, 2);
  h.state.actor.uid = 'coord'; view = h.controller.viewData(); assert.equal(view.models.length, 1); assert.equal(view.models[0].id, saved.id);
  h.controller.selectModel(saved.id); assert.equal(h.controller.viewData().model.boardWeight, 75);
  h.controller.setDraft({ ...configured(), name: 'Rascunho' }); h.state.actor.revision++;
  view = h.controller.viewData(); assert.equal(view.draft.name, engine.defaults().name); assert.equal(view.models.length, 1);
});

test('save updates a selected model while reset/new and delete preserve the current calculation', () => {
  const h = harness(); h.controller.setDraft(configured()); const saved = h.controller.save();
  h.controller.setDraft({ ...configured(), name: 'Revisado' }); h.controller.save();
  assert.equal(h.controller.viewData().models.length, 1); assert.equal(h.controller.viewData().models[0].name, 'Revisado');
  h.controller.resetModel(); assert.equal(h.controller.viewData().model.boardWeight, 60);
  h.controller.selectModel(saved.id); h.controller.deleteModel();
  assert.equal(h.controller.viewData().models.length, 0); assert.equal(h.controller.viewData().model.boardWeight, 75);
  assert.throws(() => h.controller.selectModel(saved.id), /não está disponível/);
});

test('unavailable or corrupt storage does not prevent editing or portable model exports', async () => {
  const unavailable = harness({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } } });
  assert.match(unavailable.controller.viewData().storageMessage, /Não foi possível ler/);
  unavailable.controller.setDraft(configured()); unavailable.controller.save();
  assert.match(unavailable.controller.viewData().storageMessage, /não permitiu salvar/);
  unavailable.controller.exportModel(); assert.equal(unavailable.downloads.length, 1);
  const json = JSON.parse(await unavailable.downloads[0].blob.text()); assert.equal(json.model.boardWeight, 75);
  const corrupt = harness(); corrupt.memory.set('bancaflow:weighted-models:v1:coord', '{broken');
  assert.match(corrupt.controller.viewData().storageMessage, /Não foi possível ler/);
  assert.equal(corrupt.controller.viewData().models.length, 0);
});

test('storage load skips invalid, duplicate and excessive model records', () => {
  const h = harness(), valid = configured();
  h.memory.set('bancaflow:weighted-models:v1:coord', JSON.stringify({ version: 1, models: [
    { id: 'good', model: valid }, { id: 'good', model: valid }, { id: 'invalid/path', model: valid },
    { id: 'bad', model: { ...valid, boardWeight: 1 } }, ...Array.from({ length: 30 }, (_, i) => ({ id: 'model_' + i, model: valid }))
  ] }));
  const view = h.controller.viewData(); assert.equal(view.models.length, 17); assert.equal(view.models[0].id, 'good');
});

test('portable model import validates version, size, unsafe UIDs and untrusted JSON without writing grades', async () => {
  const h = harness();
  const imported = await h.controller.importModel(jsonFile(configured())); assert.equal(imported.boardWeight, 75);
  assert.equal(h.controller.viewData().selectedModelId, ''); assert.equal(h.controller.viewData().models.length, 0); assert.equal(h.memory.size, 0);
  await assert.rejects(h.controller.importModel({ size: 100001, text: async () => { throw Error('must not read'); } }), /100 KB/);
  await assert.rejects(h.controller.importModel({ size: 1, text: async () => 'x'.repeat(100001) }), /100 KB/);
  await assert.rejects(h.controller.importModel({ size: 1, text: async () => '{bad' }), /JSON válido/);
  await assert.rejects(h.controller.importModel(jsonFile(configured(), { version: 2 })), /exportado pelo BancaFlow/);
  await assert.rejects(h.controller.importModel(jsonFile({ ...configured(), version: 2 })), /versão/);
  await assert.rejects(h.controller.importModel(jsonFile({ ...configured(), evaluatorWeights: JSON.parse('{"__proto__":1}') })), /identificador/);
  h.controller.exportModel(); const encoded = JSON.parse(await h.downloads[0].blob.text());
  assert.equal(encoded.format, 'bancaflow-weighted-model'); assert.equal(encoded.model.boardWeight, 75);
});

test('import in flight cannot overwrite a changed model or cross an account change', async () => {
  const h = harness(), first = deferred();
  const pending = h.controller.importModel({ size: 1, text: () => first.promise });
  h.controller.setDraft(configured()); first.resolve(JSON.stringify({ format: 'bancaflow-weighted-model', version: 1, model: configured() }));
  await assert.rejects(pending, /configuração mudou/);
  const second = deferred(), pendingAgain = h.controller.importModel({ size: 1, text: () => second.promise });
  h.state.actor.uid = 'other'; second.resolve('{}'); await assert.rejects(pendingAgain, /sessão mudou/);
});

test('course, class, board, status and accent-insensitive search filter the preview; zero sorts before pending', () => {
  const h = harness();
  h.controller.setFilter('sort', 'grade-asc'); assert.deepEqual(h.controller.viewData().previewBoards[0].students.map(row => row.id), ['Zero', 'Ana', 'Pendente']);
  h.controller.setFilter('sort', 'grade-desc'); assert.deepEqual(h.controller.viewData().previewBoards[0].students.map(row => row.id), ['Ana', 'Zero', 'Pendente']);
  h.controller.setFilter('status', 'completas'); assert.equal(h.controller.viewData().summary.studentCount, 3);
  h.controller.setFilter('status', 'pendentes'); assert.equal(h.controller.viewData().summary.studentCount, 2);
  h.controller.setFilter('status', 'sem-banca'); assert.equal(h.controller.viewData().summary.studentCount, 1); assert.equal(h.controller.viewData().previewBoards[0].students[0].name, 'Caio');
  h.controller.setFilter('status', 'encerradas'); assert.equal(h.controller.viewData().previewBoards[0].id, 'b2');
  h.controller.setFilter('status', 'abertas'); assert.equal(h.controller.viewData().summary.studentCount, 3);
  h.controller.setFilter('status', 'todas'); h.controller.setFilter('search', 'aurea'); assert.equal(h.controller.viewData().summary.studentCount, 5);
  h.controller.setFilter('search', 'ana'); assert.equal(h.controller.viewData().summary.studentCount, 1);
  h.controller.setFilter('search', ''); h.controller.setFilter('course', 'Administração'); assert.equal(h.controller.viewData().summary.studentCount, 1);
  h.controller.setFilter('className', '3B'); h.controller.setFilter('board', 'b2'); assert.equal(h.controller.viewData().summary.studentCount, 1);
  h.controller.setFilter('course', 'Informática'); assert.equal(h.controller.viewData().filters.className, 'todas'); assert.equal(h.controller.viewData().filters.board, 'todas');
  assert.throws(() => h.controller.setFilter('unknown', 'x'), /Filtro/);
});

test('export refreshes data first and honors filtered precision, model, report sections and notes', async () => {
  let h; h = harness({ refreshData: async () => { h.state.refreshes++; h.state.boards[0].students[0].result.entrega = 10; } });
  h.controller.setDraft(configured()); h.controller.apply(); h.controller.setFilter('search', 'Ana');
  h.controller.setReport({ includeSummary: false, includeDetails: true, includeCharts: false, notes: 'Ata e observações.' });
  const exported = await h.controller.exportReport('pdf'); assert.equal(h.state.refreshes, 1); assert.equal(h.builds.length, 1); assert.equal(h.downloads.length, 1);
  approx(exported.boards[0].students[0].result.final, 8.40625);
  assert.equal(h.builds[0].options.includeSummary, false); assert.equal(h.builds[0].options.includeDetails, true); assert.equal(h.builds[0].options.includeCharts, false);
  assert.equal(h.builds[0].options.notes, 'Ata e observações.'); assert.match(h.builds[0].options.scopeLabel, /busca: Ana/);
  assert.match(h.downloads[0].filename, /relatorio_personalizado_2026-10-20\.pdf/);
  await h.controller.exportReport('csv'); const csv = await h.downloads[1].blob.text();
  assert.match(csv, /8,40625/); assert.doesNotMatch(csv, /"Zero"|"Bia"|"Caio"/);
  await h.controller.exportReport('charts'); assert.equal(h.builds[1].options.chartsOnly, true); assert.equal(h.builds[1].options.charts[0].rows.length, 1);
  assert.equal(h.controller.viewData().busy, false);
});

test('unsaved grades, an unapplied model, empty selections and empty PDF sections block export', async () => {
  const h = harness(); h.state.unsaved = true;
  await assert.rejects(h.controller.exportReport('pdf'), /Salve as notas/); assert.equal(h.state.refreshes, 0);
  h.state.unsaved = false; h.controller.setDraft(configured());
  await assert.rejects(h.controller.exportReport('csv'), /Atualize a prévia/); assert.equal(h.state.refreshes, 0);
  h.controller.apply(); h.controller.setFilter('search', 'nobody'); await assert.rejects(h.controller.exportReport('csv'), /Nenhum aluno/);
  h.controller.setFilter('search', ''); h.controller.setReport({ includeSummary: false, includeDetails: false, includeCharts: false });
  await assert.rejects(h.controller.exportReport('pdf'), /pelo menos uma seção/);
  await h.controller.exportReport('charts'); assert.equal(h.downloads.length, 1);
  await assert.rejects(h.controller.exportReport('exe'), /Formato/);
});

test('role, active status, UID and revision revocation during refresh prevent every download', async () => {
  for (const change of [state => { state.actor.role = 'teacher'; }, state => { state.actor.active = false; }, state => { state.actor.uid = 'new-coord'; }, state => { state.actor.revision++; }]) {
    const wait = deferred(), h = harness({ refreshData: () => wait.promise });
    const pending = h.controller.exportReport('csv'); change(h.state); wait.resolve();
    await assert.rejects(pending, /coordenação|sessão mudou/); assert.equal(h.downloads.length, 0);
  }
});

test('an export snapshot ignores duplicate export clicks and rechecks unsaved drafts after refresh', async () => {
  const wait = deferred(), h = harness({ refreshData: () => wait.promise });
  const pending = h.controller.exportReport('pdf'); assert.equal(h.controller.viewData().busy, true);
  assert.equal(await h.controller.exportReport('pdf'), undefined);
  h.controller.setFilter('search', 'Ana'); assert.equal(h.controller.viewData().filters.search, '', 'disabled settings cannot change export selection');
  h.state.unsaved = true; wait.resolve(); await assert.rejects(pending, /Salve as notas/);
  assert.equal(h.downloads.length, 0); assert.equal(h.controller.viewData().busy, false);
});

test('UI event errors become an inline error and unrelated events remain untouched', async () => {
  const h = harness(), form = formFor(configured()); form.values.boardWeight = '1';
  let prevented = false; const target = { querySelector: () => null };
  assert.equal(h.controller.handle({ type: 'submit', target: form, preventDefault() { prevented = true; } }, target), true);
  assert.equal(prevented, true); assert.match(h.controller.viewData().error, /somar 100/);
  assert.equal(h.controller.handle({ type: 'click', target: { closest: () => ({ dataset: { route: 'bancas' } }) } }, target), false);
  await Promise.resolve();
});

test('synchronous rerender cannot capture the previous form over a selected, reset or imported model', async () => {
  let h, rendered = engine.defaults(), target;
  target = { querySelector: selector => selector === '#weighted-model-form' ? formFor(rendered, { t1: 1, t2: 1 }) : null };
  h = harness({ onChange: () => {
    h.controller.capture(target);
    rendered = h.controller.viewData().draft;
  } });
  h.controller.viewData();
  h.controller.setDraft(configured()); const saved = h.controller.save();
  assert.equal(h.controller.viewData().draft.boardWeight, 75);
  h.controller.resetModel(); assert.equal(h.controller.viewData().draft.boardWeight, 60);
  h.controller.selectModel(saved.id); assert.equal(h.controller.viewData().draft.boardWeight, 75);
  const imported = { ...configured(), name: 'Modelo importado', boardWeight: 80, monographWeight: 20 };
  await h.controller.importModel(jsonFile(imported)); assert.equal(h.controller.viewData().draft.boardWeight, 80);
  // A normal live-data render still preserves text typed into the current form.
  rendered = { ...rendered, name: 'Rascunho preservado', boardWeight: '70,5', monographWeight: '29,5' };
  h.controller.capture(target);
  assert.equal(h.controller.viewData().draft.name, 'Rascunho preservado');
  assert.equal(h.controller.viewData().draft.boardWeight, '70,5');
});

test('advanced panel choices preserve the compact default without changing calculations or an export in progress', async () => {
  const wait = deferred(), h = harness({ refreshData: () => wait.promise });
  assert.deepEqual(h.controller.viewData().uiOpen, {});
  h.controller.setUiOpen('weighted-model-options', true); h.controller.setUiOpen('weighted-evaluator-options', true);
  assert.equal(h.controller.viewData().uiOpen['weighted-model-options'], true);
  const pending = h.controller.exportReport('pdf');
  const beforeChanges = h.changes.length;
  assert.equal(h.controller.handle({ type: 'toggle', target: { id: 'weighted-charts-options', open: true } }, {}), true);
  assert.equal(h.changes.length, beforeChanges, 'opening a panel does not redraw a form or cancel an export');
  h.controller.setUiOpen('weighted-model-options', false);
  wait.resolve(); await pending;
  assert.equal(h.downloads.length, 1); assert.equal(h.builds[0].options.model.boardWeight, 60);
  assert.equal(h.controller.viewData().uiOpen['weighted-model-options'], false);
  assert.equal(h.controller.viewData().uiOpen['weighted-charts-options'], true);
  assert.equal(h.controller.handle({ type: 'toggle', target: { id: 'unrelated-details', open: true } }, {}), false);
});

test('panel capture and typed search survive data renders while an invalid hidden model opens for correction', () => {
  const h = harness(); h.controller.viewData();
  const panels = [{ id: 'weighted-filters-options', open: true }, { id: 'weighted-model-options', open: false }];
  const search = { id: 'weighted-search', value: 'Árvore sem aplicar' };
  const target = { querySelectorAll: () => panels, querySelector: selector => selector === '#weighted-search' ? search : null };
  h.controller.handle({ type: 'input', target: search }, target); h.controller.capture(target);
  let view = h.controller.viewData();
  assert.equal(view.searchDraft, 'Árvore sem aplicar'); assert.equal(view.filters.search, '');
  assert.equal(view.previewBoards.flatMap(board => board.students).length, 5);
  assert.equal(view.uiOpen['weighted-filters-options'], true);
  const invalid = formFor({ ...configured(), boardWeight: 1 });
  h.controller.handle({ type: 'submit', target: invalid, preventDefault() {} }, target);
  h.controller.capture(target); view = h.controller.viewData();
  assert.match(view.error, /somar 100/); assert.equal(view.uiOpen['weighted-model-options'], true, 'validation exposes the settings that need correction');
  assert.equal(view.draft.boardWeight, '1', 'the invalid draft remains editable');
  h.controller.setUiOpen('weighted-model-options', false); assert.equal(h.controller.viewData().uiOpen['weighted-model-options'], false, 'a coordinator can explicitly close the panel after reading the error');
});

test('panel and unsubmitted search preferences are cleared on account or session changes', () => {
  const h = harness(); h.controller.viewData();
  h.controller.setUiOpen('weighted-content-options', true);
  h.controller.handle({ type: 'input', target: { id: 'weighted-search', value: 'Ana' } }, {});
  h.state.actor.uid = 'another-coordinator';
  let view = h.controller.viewData(); assert.deepEqual(view.uiOpen, {}); assert.equal(view.searchDraft, '');
  h.controller.setUiOpen('weighted-model-options', true); h.state.actor.revision++;
  view = h.controller.viewData(); assert.deepEqual(view.uiOpen, {});
  h.state.actor.role = 'teacher'; assert.throws(() => h.controller.setUiOpen('weighted-model-options', true), /coordenação/);
});

test('explicit chart export includes all charts when the complete-PDF chart section is disabled', async () => {
  const h = harness();
  h.controller.setReport({ includeSummary: false, includeDetails: false, includeCharts: false });
  await h.controller.exportReport('charts');
  assert.equal(h.downloads.length, 1); assert.equal(h.builds[0].options.chartsOnly, true);
  assert.equal(h.builds[0].options.includeCharts, true); assert.equal(h.builds[0].options.charts.length, 4);
  assert.equal(h.controller.viewData().report.includeCharts, false, 'the separate chart download does not overwrite the full-PDF preference');
  await assert.rejects(h.controller.exportReport('pdf'), /pelo menos uma seção/);
});
