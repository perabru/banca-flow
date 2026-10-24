/* Preferências locais e relatórios personalizados. As notas oficiais não são alteradas. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaWeightedWorkbench = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(key);
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const numeric = value => typeof value === 'number' ? value : String(value ?? '').trim() === '' ? NaN : Number(String(value).trim().replace(',', '.'));
  const filterDefaults = () => ({ course: 'todas', className: 'todas', status: 'todas', board: 'todas', search: '', sort: 'name' });
  const reportDefaults = () => ({ includeSummary: true, includeDetails: true, includeCharts: true, notes: '' });
  const filtersById = { 'weighted-course': 'course', 'weighted-class': 'className', 'weighted-status': 'status', 'weighted-board': 'board', 'weighted-search': 'search', 'weighted-sort': 'sort' };
  const panelIds = new Set(['weighted-filters-options', 'weighted-model-options', 'weighted-content-options', 'weighted-individual-options', 'weighted-charts-options', 'weighted-formula-options', 'weighted-evaluator-options']);

  function createController(options = {}) {
    const engine = options.engine || root.BancaWeightedModel, ui = options.ui || root.BancaWeightedReportUI;
    if (!engine || !ui) throw Error('Os relatórios personalizados não carregaram. Recarregue a página.');
    let owner = '', revision, models = [], selectedModelId = '', applied = engine.defaults(), draft = clone(applied);
    let filters = filterDefaults(), report = reportDefaults(), error = '', storageMessage = '', busy = false, sequence = 0, skipCapture = false;
    let uiOpen = {}, forcedOpen = {}, searchDraft = '', focusSnapshot = null;
    const storage = () => options.storage === undefined ? root.localStorage : options.storage;
    const session = () => options.getSession?.() || {};
    function requireCoordinator() {
      const actor = session();
      if (!actor.uid || actor.role !== 'coordinator' || actor.active === false) throw Error('Os relatórios personalizados são exclusivos da coordenação.');
      return actor;
    }
    function sameActor(actor) {
      const current = requireCoordinator();
      if (current.uid !== actor.uid || current.revision !== actor.revision) throw Error('A sessão mudou. Abra o relatório novamente.');
    }
    const key = () => 'bancaflow:weighted-models:v1:' + encodeURIComponent(owner);
    function load() {
      models = []; storageMessage = '';
      try {
        const saved = storage()?.getItem(key());
        if (!saved) return;
        if (saved.length > 500000) throw Error('Dados locais inválidos.');
        const parsed = JSON.parse(saved);
        if (parsed?.version !== 1 || !Array.isArray(parsed.models)) throw Error('Dados locais inválidos.');
        const ids = new Set();
        for (const item of parsed.models.slice(0, 20)) {
          try {
            if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) continue;
            const model = engine.normalize(item.model);
            models.push({ id: item.id, name: model.name, model }); ids.add(item.id);
          } catch { /* Um modelo corrompido não impede o uso da área. */ }
        }
      } catch { storageMessage = 'Não foi possível ler os modelos deste dispositivo. Você pode continuar e exportar um modelo em JSON.'; }
    }
    function sync() {
      const actor = requireCoordinator();
      if (owner !== actor.uid || revision !== actor.revision) {
        reset(); owner = actor.uid; revision = actor.revision; load();
      }
      return actor;
    }
    function reset() {
      owner = ''; revision = undefined; models = []; selectedModelId = ''; applied = engine.defaults(); draft = clone(applied);
      filters = filterDefaults(); report = reportDefaults(); error = ''; storageMessage = ''; busy = false; skipCapture = false; sequence++;
      uiOpen = {}; forcedOpen = {}; searchDraft = ''; focusSnapshot = null;
    }
    function changed() { skipCapture = true; options.onChange?.(); }
    function persist() {
      try {
        const target = storage();
        if (!target?.setItem) throw Error('Armazenamento indisponível.');
        target.setItem(key(), JSON.stringify({ version: 1, models }));
        storageMessage = 'Modelo salvo neste dispositivo para esta conta. Use Exportar modelo para levá-lo a outro computador.';
        return true;
      } catch {
        storageMessage = 'O navegador não permitiu salvar neste dispositivo. Exporte o modelo em JSON para guardar sua configuração.';
        return false;
      }
    }
    function readDraft(form) {
      const data = new (options.FormData || root.FormData)(form), next = clone(draft);
      for (const field of ['name', 'title', 'boardWeight', 'monographWeight', 'decimals']) {
        const value = data.get(field); if (value !== null) next[field] = String(value);
      }
      next.criteriaWeights ||= {};
      for (const [criterion] of engine.CRITERIA) {
        const value = data.get('criteria.' + criterion); if (value !== null) next.criteriaWeights[criterion] = String(value);
      }
      next.evaluatorWeights ||= {};
      for (const field of form.querySelectorAll?.('[data-weighted-evaluator]') || []) {
        const uid = field.dataset?.weightedEvaluator;
        if (uid && !forbidden(uid)) next.evaluatorWeights[uid] = String(field.value ?? '');
      }
      draft = next;
    }
    function readReport(target) {
      for (const [suffix, field] of [['summary', 'includeSummary'], ['details', 'includeDetails'], ['charts', 'includeCharts']]) {
        const input = target?.querySelector?.('#weighted-' + suffix); if (input) report[field] = !!input.checked;
      }
      const notes = target?.querySelector?.('#weighted-report-notes');
      if (notes) report.notes = String(notes.value || '').slice(0, 2000);
    }
    function captureUi(target) {
      for (const panel of target?.querySelectorAll?.('details[id]') || []) if (panelIds.has(panel.id)) uiOpen[panel.id] = panel.open === true;
      const active = (target?.ownerDocument || options.document || root.document)?.activeElement;
      focusSnapshot = null;
      if (!active || !target?.contains?.(active) || !active.closest?.('.weighted-report')) return;
      if (active.tagName === 'SUMMARY' && panelIds.has(active.parentElement?.id)) focusSnapshot = { panel: active.parentElement.id };
      else if (active.id?.startsWith('weighted-') || active.name?.startsWith('evaluator.')) {
        focusSnapshot = { id: active.id, name: active.name, start: active.selectionStart, end: active.selectionEnd };
      }
    }
    function restoreUi(target) {
      if (!owner || session().uid !== owner || session().revision !== revision || session().role !== 'coordinator' || session().active === false || !focusSnapshot) return;
      let field;
      if (focusSnapshot.panel) field = Array.from(target?.querySelectorAll?.('details[id]') || []).find(panel => panel.id === focusSnapshot.panel)?.querySelector?.('summary');
      else {
        const candidates = Array.from(target?.querySelectorAll?.('input,select,textarea,button') || []);
        field = focusSnapshot.name?.startsWith('evaluator.') ? candidates.find(input => input.name === focusSnapshot.name) : candidates.find(input => input.id === focusSnapshot.id);
      }
      if (!field || field.disabled) return;
      field.focus?.({ preventScroll: true });
      if (Number.isInteger(focusSnapshot.start) && Number.isInteger(focusSnapshot.end)) {
        try { field.setSelectionRange?.(focusSnapshot.start, focusSnapshot.end); } catch { /* Campos numéricos não têm seleção de texto. */ }
      }
    }
    function setUiOpen(id, open) {
      sync();
      if (!panelIds.has(id)) return;
      uiOpen[id] = open === true; delete forcedOpen[id];
    }
    function capture(target) {
      if (!owner || session().uid !== owner || session().role !== 'coordinator' || session().active === false) return;
      captureUi(target);
      if (skipCapture) { skipCapture = false; return; }
      const form = target?.querySelector?.('#weighted-model-form'); if (form) readDraft(form);
      readReport(target);
      const search = target?.querySelector?.('#weighted-search'); if (search) searchDraft = String(search.value || '').slice(0, 180);
    }
    function normalizedDraft() {
      const next = clone(draft);
      for (const field of ['boardWeight', 'monographWeight', 'decimals']) next[field] = numeric(next[field]);
      next.criteriaWeights = Object.fromEntries(engine.CRITERIA.map(([key]) => [key, numeric(next.criteriaWeights?.[key])]));
      next.evaluatorWeights = Object.fromEntries(Object.entries(next.evaluatorWeights || {}).map(([uid, weight]) => {
        if (forbidden(uid)) throw Error('O modelo contém um identificador de avaliador inválido.');
        return [uid, numeric(weight)];
      }));
      return engine.normalize(next);
    }
    function signature(model) {
      const normalized = engine.normalize(model);
      normalized.evaluatorWeights = Object.fromEntries(Object.entries(normalized.evaluatorWeights).filter(([, weight]) => weight !== 1).sort(([a], [b]) => a.localeCompare(b)));
      return JSON.stringify(normalized);
    }
    function dirty() { try { return signature(normalizedDraft()) !== signature(applied); } catch { return true; } }
    function apply(form) {
      sync(); if (busy) return;
      if (form) readDraft(form);
      applied = normalizedDraft(); draft = clone(applied); error = ''; sequence++; changed(); return clone(applied);
    }
    function setDraft(value) { sync(); if (busy) return; draft = clone(value); error = ''; sequence++; }
    function save(form) {
      sync(); if (busy) return;
      if (form) readDraft(form);
      const normalized = normalizedDraft();
      if (!selectedModelId && models.length >= 20) throw Error('Você já tem 20 modelos neste dispositivo. Exclua um deles ou exporte o modelo em JSON.');
      applied = normalized; draft = clone(applied);
      if (!selectedModelId) selectedModelId = 'model_' + Date.now().toString(36) + '_' + (++sequence).toString(36);
      const item = { id: selectedModelId, name: applied.name, model: clone(applied) }, index = models.findIndex(model => model.id === selectedModelId);
      if (index < 0) models.push(item); else models[index] = item;
      error = ''; sequence++; persist(); changed(); return clone(item);
    }
    function selectModel(id) {
      sync(); if (busy) return;
      const item = models.find(model => model.id === id);
      if (id && !item) throw Error('O modelo selecionado não está disponível neste dispositivo.');
      selectedModelId = item?.id || ''; applied = item ? engine.normalize(item.model) : engine.defaults();
      draft = clone(applied); error = ''; sequence++; changed();
    }
    function deleteModel() {
      sync(); if (busy || !selectedModelId) return;
      models = models.filter(model => model.id !== selectedModelId); selectedModelId = '';
      if (persist()) storageMessage = 'Modelo removido deste dispositivo. A configuração atual continua disponível na prévia.';
      error = ''; sequence++; changed();
    }
    function resetModel() { sync(); if (busy) return; selectedModelId = ''; applied = engine.defaults(); draft = clone(applied); error = ''; sequence++; changed(); }
    function setFilter(field, value) {
      sync(); if (busy) return;
      if (!own(filters, field)) throw Error('Filtro de relatório inválido.');
      value = String(value ?? '');
      if (field === 'status' && !['todas', 'abertas', 'encerradas', 'pendentes', 'completas', 'sem-banca'].includes(value)) value = 'todas';
      if (field === 'sort' && !['name', 'grade-desc', 'grade-asc'].includes(value)) value = 'name';
      filters[field] = value.slice(0, field === 'search' ? 180 : 300);
      if (field === 'search') searchDraft = filters.search;
      if (field === 'course') { filters.className = 'todas'; filters.board = 'todas'; }
      if (field === 'className') filters.board = 'todas';
      error = ''; sequence++; changed();
    }
    function setReport(value) {
      sync(); if (busy) return;
      for (const field of ['includeSummary', 'includeDetails', 'includeCharts']) if (own(value, field)) report[field] = value[field] === true;
      if (own(value, 'notes')) report.notes = String(value.notes || '').slice(0, 2000);
      error = ''; sequence++;
    }
    function filtered(raw, model = applied, chosen = filters) {
      const query = fold(chosen.search).trim();
      return engine.applyModel(raw, model).filter(board =>
        (chosen.course === 'todas' || board.courseName === chosen.course) &&
        (chosen.className === 'todas' || board.className === chosen.className) &&
        (chosen.board === 'todas' || board.id === chosen.board) &&
        (chosen.status !== 'abertas' || (!board.sealed && !board.unassigned)) &&
        (chosen.status !== 'encerradas' || (board.sealed && !board.unassigned)) &&
        (chosen.status !== 'sem-banca' || board.unassigned)
      ).map(board => {
        const students = (board.students || []).filter(student =>
          (chosen.status !== 'pendentes' || student.result?.final === null) &&
          (chosen.status !== 'completas' || student.result?.final !== null) &&
          (!query || fold([board.label, board.project, board.courseName, board.className, board.advisorName, student.name, ...(student.evaluators || []).map(evaluator => evaluator.name)].join(' ')).includes(query))
        );
        students.sort((a, b) => {
          if (chosen.sort !== 'name') {
            const av = a.result?.final, bv = b.result?.final;
            if (av === null && bv !== null) return 1; if (bv === null && av !== null) return -1;
            if (av !== null && bv !== null && av !== bv) return chosen.sort === 'grade-desc' ? bv - av : av - bv;
          }
          return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
        });
        return { ...board, students };
      }).filter(board => board.students.length);
    }
    function scopeLabel(chosen = filters) {
      const labels = { abertas: 'bancas abertas', encerradas: 'bancas encerradas', pendentes: 'resultados pendentes', completas: 'resultados completos', 'sem-banca': 'alunos sem banca' };
      return ['Seleção: ' + (chosen.course === 'todas' ? 'todos os cursos' : chosen.course), chosen.className === 'todas' ? 'todas as turmas' : 'turma ' + chosen.className,
        chosen.status === 'todas' ? 'todas as situações' : labels[chosen.status], chosen.board === 'todas' ? 'todos os grupos' : 'grupo selecionado',
        chosen.search ? 'busca: ' + chosen.search : '', 'Inclui turmas arquivadas quando correspondem aos filtros.'].filter(Boolean).join(' · ');
    }
    function viewData() {
      sync();
      const boards = options.getBoards?.() || [], previewBoards = filtered(boards);
      return { model: clone(applied), draft: clone(draft), boards, users: options.getUsers?.() || {}, models: clone(models), selectedModelId,
        filters: clone(filters), searchDraft, uiOpen: { ...uiOpen, ...forcedOpen }, report: clone(report), previewBoards, summary: engine.summary(previewBoards), charts: engine.charts(previewBoards, applied),
        error, storageMessage, busy, dirty: dirty(), scopeLabel: scopeLabel() };
    }
    function view() { return ui.render(viewData()); }
    function download(blob, filename) {
      if (typeof options.download !== 'function') throw Error('O download não está disponível. Recarregue a página.');
      options.download(blob, filename);
    }
    function exportModel(form) {
      sync(); if (busy) return;
      if (form) readDraft(form);
      const model = normalizedDraft();
      download(new (options.Blob || root.Blob)([JSON.stringify({ format: 'bancaflow-weighted-model', version: 1, model }, null, 2)], { type: 'application/json;charset=utf-8' }), 'modelo_ponderado_bancaflow.json');
    }
    async function importModel(file) {
      const actor = sync(); if (busy || !file) return;
      if (file.size > 100000) throw Error('O arquivo de modelo deve ter no máximo 100 KB.');
      const token = ++sequence, text = await file.text(); sameActor(actor);
      if (token !== sequence) throw Error('A configuração mudou durante a leitura. Importe o modelo novamente.');
      if (text.length > 100000) throw Error('O arquivo de modelo deve ter no máximo 100 KB.');
      let parsed; try { parsed = JSON.parse(text); } catch { throw Error('O arquivo não contém um JSON válido.'); }
      if (!plain(parsed) || parsed.format !== 'bancaflow-weighted-model' || parsed.version !== 1 || !plain(parsed.model)) throw Error('Selecione um modelo JSON exportado pelo BancaFlow.');
      const model = engine.normalize(parsed.model);
      selectedModelId = ''; applied = model; draft = clone(model); error = ''; sequence++; storageMessage = 'Modelo importado para a prévia. Use Salvar neste dispositivo para guardá-lo.'; changed();
      return clone(model);
    }
    async function exportReport(kind) {
      const actor = sync(); if (busy) return;
      if (!['pdf', 'csv', 'charts'].includes(kind)) throw Error('Formato de relatório inválido.');
      if (dirty()) throw Error('Atualize a prévia para aplicar as alterações do modelo antes de gerar o arquivo.');
      if (kind === 'pdf' && !report.includeSummary && !report.includeDetails && !report.includeCharts) throw Error('Selecione pelo menos uma seção para o PDF.');
      options.assertSaved?.();
      const token = sequence, model = clone(applied), chosen = clone(filters), sections = clone(report);
      busy = true; error = ''; changed();
      const finishLoading = options.beginLoading?.('Gerando relatório…');
      try {
        await options.waitForLoadingPaint?.(); sameActor(actor);
        await options.refreshData?.(actor); sameActor(actor);
        if (sequence !== token) throw Error('A configuração mudou. Confira a prévia e gere o arquivo novamente.');
        options.assertSaved?.();
        const boards = filtered(options.getBoards?.() || [], model, chosen), summary = engine.summary(boards);
        if (!summary.studentCount) throw Error('Nenhum aluno corresponde aos filtros do relatório.');
        const stamp = (options.now?.() || new Date()).toISOString().slice(0, 10);
        let blob;
        if (kind === 'csv') blob = new (options.Blob || root.Blob)([engine.csv(boards, model)], { type: 'text/csv;charset=utf-8' });
        else {
          if (typeof options.buildPdf !== 'function') throw Error('O gerador de PDF não carregou. Recarregue a página.');
          blob = options.buildPdf(boards, { ...sections, ...(kind === 'charts' ? { includeCharts: true } : {}), model, chartsOnly: kind === 'charts', charts: engine.charts(boards, model), scopeLabel: scopeLabel(chosen) });
        }
        sameActor(actor); if (sequence !== token) throw Error('A configuração mudou. Confira a prévia e gere o arquivo novamente.');
        download(blob, `${kind === 'charts' ? 'graficos' : 'relatorio'}_personalizado_${stamp}.${kind === 'csv' ? 'csv' : 'pdf'}`);
        options.onNotice?.('Arquivo gerado com as notas salvas e o modelo da prévia.');
        return { boards, model, summary };
      } finally {
        finishLoading?.();
        if (session().uid === actor.uid && session().revision === actor.revision) { busy = false; changed(); }
      }
    }
    function run(action) {
      try { Promise.resolve(action()).catch(fail); } catch (err) { fail(err); }
    }
    function fail(err) {
      if (!owner || session().uid !== owner || session().revision !== revision || session().role !== 'coordinator' || session().active === false) return;
      if (dirty()) forcedOpen['weighted-model-options'] = true;
      if (/pelo menos uma seção/.test(err?.message || '')) forcedOpen['weighted-content-options'] = true;
      error = err?.message || 'Não foi possível concluir esta ação.'; changed();
    }
    function handle(event, target) {
      const element = event.target;
      if (!element) return false;
      if (event.type === 'toggle' && panelIds.has(element.id)) { run(() => setUiOpen(element.id, element.open)); return true; }
      if (event.type === 'click') {
        const summary = element.closest?.('summary');
        if (summary && panelIds.has(summary.parentElement?.id)) { run(() => setUiOpen(summary.parentElement.id, !summary.parentElement.open)); return true; }
        const button = element.closest?.('button'); if (!button || button.disabled) return false;
        const data = button.dataset || {};
        const action = own(data, 'weightedSave') ? () => { capture(target); save(); }
          : own(data, 'weightedNew') || own(data, 'weightedReset') ? resetModel
          : own(data, 'weightedDelete') ? deleteModel
          : own(data, 'weightedExportModel') ? () => { capture(target); exportModel(); }
          : own(data, 'weightedExport') ? () => { capture(target); return exportReport(data.weightedExport); } : null;
        if (!action) return false;
        event.preventDefault?.(); run(action); return true;
      }
      if (event.type === 'submit') {
        if (element.id === 'weighted-model-form') { event.preventDefault?.(); run(() => { readReport(target); apply(element); }); return true; }
        if (element.id === 'weighted-filter-form') { event.preventDefault?.(); run(() => { const input = target.querySelector('#weighted-search'); setFilter('search', input?.value || ''); }); return true; }
      }
      if (event.type === 'input') {
        if (element.id === 'weighted-search') { run(() => { sync(); if (!busy) searchDraft = String(element.value || '').slice(0, 180); }); return true; }
        if (element.closest?.('#weighted-model-form')) { sync(); if (!busy) { readDraft(element.closest('#weighted-model-form')); sequence++; } return true; }
        if (element.id === 'weighted-report-notes') { run(() => setReport({ notes: element.value })); return true; }
      }
      if (event.type === 'change') {
        if (own(filtersById, element.id)) { run(() => { capture(target); setFilter(filtersById[element.id], element.value); }); return true; }
        if (element.id === 'weighted-model-select') { run(() => selectModel(element.value)); return true; }
        if (element.id === 'weighted-model-import') { run(() => importModel(element.files?.[0])); return true; }
        if (['weighted-summary', 'weighted-details', 'weighted-charts'].includes(element.id)) { run(() => { sync(); readReport(target); sequence++; changed(); }); return true; }
      }
      return false;
    }
    function bind(target) {
      for (const type of ['click', 'submit', 'change', 'input', 'toggle']) target.addEventListener(type, event => {
        if (handle(event, target)) event.stopImmediatePropagation?.();
      }, type === 'toggle');
    }
    return Object.freeze({ view, viewData, capture, restoreUi, setUiOpen, bind, handle, reset, apply, save, selectModel, deleteModel, resetModel,
      setDraft, setFilter, setReport, exportModel, importModel, exportReport, scopeLabel });
  }
  return Object.freeze({ createController });
});
