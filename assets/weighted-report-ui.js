/* BancaFlow: coordinator controls and previews for custom weighted reports. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaWeightedReportUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const CRITERIA = Object.freeze([
    ['presentation', 'Apresentação'], ['practice', 'Parte prática'],
    ['code', 'Domínio do código'], ['time', 'Domínio do tempo']
  ]);
  const FALLBACK = Object.freeze({ name: 'Modelo personalizado', title: 'Relatório de avaliações', boardWeight: 60, monographWeight: 40, criteriaWeights: { presentation: 25, practice: 25, code: 25, time: 25 }, evaluatorWeights: {}, decimals: 2 });
  const list = value => Array.isArray(value) ? value : [];
  const clean = value => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const validGrade = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
  const disabled = value => value ? ' disabled' : '';
  const selected = (value, expected) => String(value) === String(expected) ? ' selected' : '';
  const checked = value => value ? ' checked' : '';
  const sortText = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });

  function currentModel(options) {
    let defaults = FALLBACK;
    if (typeof root.BancaWeightedModel?.defaults === 'function') defaults = root.BancaWeightedModel.defaults();
    const source = options.draft || options.model || defaults;
    return { ...defaults, ...source, criteriaWeights: { ...defaults.criteriaWeights, ...source?.criteriaWeights }, evaluatorWeights: { ...source?.evaluatorWeights } };
  }

  function formatGrade(value, model) {
    if (!validGrade(value)) return '<span class="weighted-pending">Pendente</span>';
    const decimals = Number.isInteger(Number(model.decimals)) && Number(model.decimals) >= 0 && Number(model.decimals) <= 4 ? Number(model.decimals) : 2;
    return esc(value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }

  function peopleOf(users, boards, model) {
    const people = new Map();
    const entries = Array.isArray(users) ? users.map((user, index) => [user?.uid || user?.id || String(index), user]) : Object.entries(users || {});
    for (const [uid, user] of entries) {
      if (!user || !['teacher', 'coordinator'].includes(user.role)) continue;
      people.set(String(uid), { uid: String(uid), name: clean(user.name) || String(uid), inactive: user.active === false });
    }
    for (const board of list(boards)) for (const student of list(board?.students)) for (const evaluator of list(student?.evaluators)) {
      if (evaluator?.uid == null || evaluator.uid === '') continue;
      const uid = String(evaluator.uid);
      if (!people.has(uid)) people.set(uid, { uid, name: clean(evaluator.name) || uid, inactive: false });
    }
    for (const uid of Object.keys(model.evaluatorWeights || {})) if (!people.has(uid)) people.set(uid, { uid, name: uid, inactive: true });
    return [...people.values()].sort((a, b) => sortText(a.name, b.name) || sortText(a.uid, b.uid));
  }

  function weightField(id, name, label, value, extra = '', busy = false) {
    return `<div class="weighted-field"><label for="${id}">${esc(label)}</label><input id="${id}" name="${esc(name)}" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(value)}"${extra}${disabled(busy)} required></div>`;
  }

  function option(value, label, current) {
    return `<option value="${esc(value)}"${selected(current, value)}>${esc(label)}</option>`;
  }

  function filterSelect(id, name, label, values, current, all, busy) {
    return `<div class="weighted-field"><label for="${id}">${label}</label><select id="${id}" name="${name}"${disabled(busy)}>${option('todas', all, current)}${values.map(([value, text]) => option(value, text, current)).join('')}</select></div>`;
  }

  function filterControls(boards, filters, busy) {
    const unique = key => [...new Set(boards.map(board => clean(board?.[key])).filter(Boolean))].sort(sortText).map(value => [value, value]);
    const boardValues = boards.map((board, index) => [String(board?.id ?? index), clean(board?.label) || (board?.unassigned ? 'Sem banca' : `Banca ${index + 1}`)]);
    const uniqueBoards = [...new Map(boardValues.map(entry => [entry[0], entry])).values()];
    return `<form id="weighted-filter-form" class="weighted-filters" aria-label="Filtrar relatório personalizado">
      ${filterSelect('weighted-course', 'course', 'Curso', unique('courseName'), filters.course, 'Todos os cursos', busy)}
      ${filterSelect('weighted-class', 'className', 'Turma', unique('className'), filters.className, 'Todas as turmas', busy)}
      ${filterSelect('weighted-status', 'status', 'Situação', [['abertas', 'Bancas abertas'], ['encerradas', 'Bancas encerradas'], ['pendentes', 'Resultados pendentes'], ['completas', 'Resultados completos'], ['sem-banca', 'Alunos sem banca']], filters.status, 'Todas as situações', busy)}
      ${filterSelect('weighted-board', 'board', 'Banca', uniqueBoards, filters.board, 'Todas as bancas', busy)}
      <div class="weighted-field weighted-search"><label for="weighted-search">Buscar aluno, projeto ou avaliador</label><input id="weighted-search" type="search" name="search" value="${esc(filters.search || '')}" placeholder="Digite um nome ou projeto" maxlength="200"${disabled(busy)}></div>
      <div class="weighted-field"><label for="weighted-sort">Ordenar alunos em cada grupo</label><select id="weighted-sort" name="sort"${disabled(busy)}>${[['name', 'Nome do aluno'], ['grade-desc', 'Maior resultado'], ['grade-asc', 'Menor resultado']].map(([value, label]) => option(value, label, filters.sort || 'name')).join('')}</select></div>
      <button type="submit" class="btn soft weighted-filter-submit"${disabled(busy)}>Aplicar filtros</button>
    </form>`;
  }

  function formulaOf(options, model) {
    if (options.formula != null) return clean(options.formula);
    if (typeof root.BancaWeightedModel?.formula === 'function') {
      try { return clean(root.BancaWeightedModel.formula(model)); } catch (_) { /* Keep invalid draft editable. */ }
    }
    return 'Resultado = média ponderada da banca × percentual da banca + monografia e entregas × percentual da monografia. A média da banca considera os pesos relativos dos avaliadores.';
  }

  function resultOf(student) { return student?.modelResult || student?.result || {}; }

  function statusOf(board, student) {
    if (board?.unassigned || student?.status === 'Sem banca') return 'Sem banca';
    if (!validGrade(resultOf(student).final)) return 'Pendente';
    return clean(student?.status) || (board?.sealed ? 'Encerrada' : 'Provisório');
  }

  function summaryOf(boards, supplied) {
    const students = boards.flatMap(board => list(board?.students));
    const grades = students.map(student => resultOf(student).final).filter(validGrade);
    return {
      studentCount: students.length,
      boardCount: boards.filter(board => !board?.unassigned).length,
      pendingCount: students.length - grades.length,
      meanFinal: grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null,
      ...supplied
    };
  }

  function summaryCards(summary, model) {
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('pt-BR') : '0';
    return `<div class="weighted-stats" aria-label="Resumo da prévia">
      <div><span>Alunos na consulta</span><strong>${count(summary.studentCount)}</strong></div>
      <div><span>Bancas na consulta</span><strong>${count(summary.boardCount)}</strong></div>
      <div><span>Média dos resultados</span><strong>${formatGrade(summary.meanFinal, model)}</strong></div>
      <div><span>Resultados pendentes</span><strong>${count(summary.pendingCount)}</strong></div>
    </div>`;
  }

  function studentTable(boards, model) {
    const rows = boards.flatMap((board, bi) => list(board?.students).map((student, si) => {
      const result = resultOf(student), status = statusOf(board, student);
      return `<tr><th scope="row"><strong>${esc(clean(student?.name) || `Aluno(a) ${si + 1}`)}</strong><small>${esc([board?.className, board?.courseName].map(clean).filter(Boolean).join(' · ') || 'Turma não informada')}</small></th><td>${esc(clean(board?.label) || (board?.unassigned ? 'Sem banca' : `Banca ${bi + 1}`))}</td><td class="weighted-number">${formatGrade(result.banca, model)}</td><td class="weighted-number">${formatGrade(result.entrega, model)}</td><td class="weighted-number weighted-final">${formatGrade(result.final, model)}</td><td><span class="weighted-status${status === 'Pendente' || status === 'Sem banca' ? ' is-pending' : ''}">${esc(status)}</span></td></tr>`;
    })).join('');
    return `<div class="weighted-table-scroll" tabindex="0" role="region" aria-label="Resultados por aluno, tabela rolável"><table class="weighted-table"><caption>Resultados por aluno com este modelo</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Banca</th><th scope="col">Média da banca</th><th scope="col">Monografia e entregas</th><th scope="col">Resultado</th><th scope="col">Situação</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function detailedRows(boards, model) {
    return `<div class="weighted-details">${boards.flatMap((board, bi) => list(board?.students).map((student, si) => {
      const name = clean(student?.name) || `Aluno(a) ${si + 1}`, evaluators = list(student?.evaluators);
      const pending = list(student?.pending || student?.modelResult?.pending).map(item => typeof item === 'string' ? item : item?.message || item?.label || '').filter(Boolean);
      return `<details class="weighted-student"><summary><span>${esc(name)}<small>${esc(clean(board?.label) || `Banca ${bi + 1}`)}</small></span><span class="weighted-detail-grade">Resultado: ${formatGrade(resultOf(student).final, model)}</span></summary><div class="weighted-student-body">
        ${pending.length ? `<p class="weighted-pending-note">${esc(pending.join(' · '))}</p>` : ''}
        ${evaluators.length ? `<div class="weighted-table-scroll" tabindex="0" role="region" aria-label="Notas dos avaliadores de ${esc(name)}"><table class="weighted-table weighted-evaluator-table"><caption>Notas salvas e pesos dos avaliadores</caption><thead><tr><th scope="col">Avaliador</th><th scope="col">Peso</th>${CRITERIA.map(([, label]) => `<th scope="col">${label}</th>`).join('')}<th scope="col">Média ponderada</th></tr></thead><tbody>${evaluators.map((evaluator, ei) => {
          const weight = own(model.evaluatorWeights, evaluator?.uid) ? model.evaluatorWeights[evaluator.uid] : 1;
          const excluded = Number(weight) === 0;
          return `<tr${excluded ? ' class="weighted-excluded"' : ''}><th scope="row">${esc(clean(evaluator?.name) || `Avaliador ${ei + 1}`)}${excluded ? '<small>Desconsiderado neste modelo</small>' : ''}</th><td class="weighted-number">${esc(weight)}</td>${CRITERIA.map(([key]) => `<td class="weighted-number">${formatGrade(evaluator?.[key], model)}</td>`).join('')}<td class="weighted-number">${formatGrade(evaluator?.mean, model)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="weighted-empty-inline">Nenhuma avaliação registrada para este aluno.</p>'}
      </div></details>`;
    })).join('')}</div>`;
  }

  function renderCharts(options) {
    const specs = list(options.charts);
    if (!specs.length) return '<p class="weighted-empty-inline">Os gráficos ficam disponíveis quando houver dados na consulta.</p>';
    const renderChart = typeof options.renderChart === 'function' ? options.renderChart : root.BancaAnalytics?.renderChart;
    if (typeof renderChart !== 'function') return '<p class="weighted-empty-inline">Os dados permanecem disponíveis nas tabelas. Recarregue a página para carregar os gráficos.</p>';
    return `<div class="weighted-chart-grid">${specs.map(spec => renderChart(spec)).join('')}</div>`;
  }

  function render(options = {}) {
    const model = currentModel(options), previewModel = currentModel({ model: options.model }), boards = list(options.boards), preview = Array.isArray(options.previewBoards) ? options.previewBoards : boards;
    const models = list(options.models), busy = !!options.busy, people = peopleOf(options.users, boards, model);
    const filters = { course: 'todas', className: 'todas', status: 'todas', board: 'todas', search: '', sort: 'name', ...options.filters };
    const report = { includeSummary: true, includeDetails: true, includeCharts: true, notes: '', ...options.report };
    const summary = summaryOf(preview, options.summary), hasStudents = preview.some(board => list(board?.students).length > 0);
    return `<section class="weighted-report" aria-labelledby="weighted-report-title"${busy ? ' aria-busy="true"' : ''}>
      <div class="weighted-heading"><div><p class="weighted-eyebrow">COORDENAÇÃO</p><h2 id="weighted-report-title">Relatórios personalizados</h2><p>Use as notas salvas para calcular o resultado com este modelo. A fórmula é incluída nos arquivos.</p></div><span class="weighted-label">Modelo de cálculo</span></div>
      <div class="weighted-workspace">
        <div class="weighted-model-panel">
          <div class="weighted-section-title"><span class="weighted-step">01</span><div><h3>Defina o modelo</h3><p>Escolha a composição das notas e os pesos dos avaliadores.</p></div></div>
          <div class="weighted-model-library"><div class="weighted-field"><label for="weighted-model-select">Modelos salvos neste dispositivo</label><select id="weighted-model-select"${disabled(busy)}>${option('', 'Modelo em edição', options.selectedModelId || '')}${models.map(saved => option(saved.id, saved.name || saved.model?.name || 'Modelo sem nome', options.selectedModelId)).join('')}</select></div><div class="weighted-library-actions"><button type="button" class="btn soft" data-weighted-new${disabled(busy)}>Novo</button><button type="button" class="btn soft" data-weighted-delete${disabled(busy || !options.selectedModelId)}>Excluir</button></div></div>
          <form id="weighted-model-form" class="weighted-model-form">
            <div class="weighted-field"><label for="weighted-model-name">Nome do modelo</label><input id="weighted-model-name" name="name" maxlength="80" value="${esc(model.name)}" placeholder="Ex.: Avaliação final 2026"${disabled(busy)} required></div>
            <div class="weighted-field"><label for="weighted-report-title-input">Título do relatório</label><input id="weighted-report-title-input" name="title" maxlength="140" value="${esc(model.title)}"${disabled(busy)} required></div>
            <fieldset class="weighted-fieldset"><legend>Composição do resultado (%)</legend><div class="weighted-two-fields">${weightField('weighted-board-weight', 'boardWeight', 'Peso da banca', model.boardWeight, '', busy)}${weightField('weighted-monograph-weight', 'monographWeight', 'Peso da monografia e entregas', model.monographWeight, '', busy)}</div></fieldset>
            <fieldset class="weighted-fieldset"><legend>Critérios da avaliação (%)</legend><div class="weighted-two-fields">${CRITERIA.map(([key, label]) => weightField(`weighted-criterion-${key}`, `criteria.${key}`, label, model.criteriaWeights?.[key], '', busy)).join('')}</div></fieldset>
            <p class="weighted-help">A composição do resultado e os quatro critérios devem somar 100% em cada conjunto. Peso 0 desconsidera o item neste modelo.</p>
            <details class="weighted-evaluators"><summary>Pesos dos avaliadores <span>${people.length}</span></summary><p class="weighted-help">O peso padrão é 1. Coordenadores também participam como avaliadores. Alterações valem para todas as notas do professor nesta consulta.</p><div class="weighted-evaluator-fields">${people.length ? people.map((person, index) => weightField(`weighted-evaluator-${index}`, `evaluator.${person.uid}`, `${person.name}${person.inactive ? ' · cadastro inativo' : ''}`, own(model.evaluatorWeights, person.uid) ? model.evaluatorWeights[person.uid] : 1, ` data-weighted-evaluator="${esc(person.uid)}"`, busy)).join('') : '<p class="weighted-empty-inline">Nenhum avaliador cadastrado.</p>'}</div></details>
            <div class="weighted-field weighted-decimals"><label for="weighted-decimals">Casas decimais nos arquivos</label><select id="weighted-decimals" name="decimals"${disabled(busy)}>${[0, 1, 2, 3, 4].map(value => option(value, `${value} ${value === 1 ? 'casa decimal' : 'casas decimais'}`, model.decimals)).join('')}</select><small>O cálculo mantém a precisão; o arredondamento ocorre apenas na exibição.</small></div>
            <div class="weighted-model-actions"><button class="btn primary" type="submit"${disabled(busy)}>Gerar prévia</button><button class="btn soft" type="button" data-weighted-save${disabled(busy)}>Salvar neste dispositivo</button><button class="btn soft" type="button" data-weighted-reset${disabled(busy)}>Restaurar padrão</button></div>
            ${options.dirty ? '<p class="weighted-dirty" role="status" aria-live="polite">Há alterações no modelo. Gere a prévia para aplicar os novos pesos.</p>' : ''}
            <div class="weighted-portable"><button type="button" class="weighted-text-button" data-weighted-export-model${disabled(busy)}>Exportar modelo JSON</button><label class="weighted-file-label" for="weighted-model-import">Importar modelo JSON<input id="weighted-model-import" type="file" accept="application/json,.json"${disabled(busy)}></label></div>
          </form>
          <p class="weighted-storage" id="weighted-storage-status" role="status" aria-live="polite">${esc(options.storageMessage || 'Os modelos salvos ficam vinculados à sua conta neste navegador. Exporte o JSON para usar em outro dispositivo.')}</p>
        </div>
        <div class="weighted-preview-panel">
          <div class="weighted-section-title"><span class="weighted-step">02</span><div><h3>Prepare o relatório</h3><p>Filtre a consulta e escolha o conteúdo dos arquivos.</p></div></div>
          ${filterControls(boards, filters, busy)}
          <fieldset class="weighted-content-options"><legend>Conteúdo do relatório</legend><label><input id="weighted-summary" type="checkbox" name="summary"${checked(report.includeSummary)}${disabled(busy)}> Resumo e resultados</label><label><input id="weighted-details" type="checkbox" name="details"${checked(report.includeDetails)}${disabled(busy)}> Notas individuais</label><label><input id="weighted-charts" type="checkbox" name="charts"${checked(report.includeCharts)}${disabled(busy)}> Gráficos</label></fieldset>
          <div class="weighted-field weighted-notes"><label for="weighted-report-notes">Observações da coordenação <span>(opcional)</span></label><textarea id="weighted-report-notes" name="notes" rows="3" maxlength="2000" placeholder="Informações que devem acompanhar o relatório"${disabled(busy)}>${esc(report.notes)}</textarea></div>
          ${options.error ? `<p id="weighted-report-error" class="weighted-error" role="alert">${esc(options.error)}</p>` : ''}
          <div class="weighted-export-actions"><button type="button" class="btn primary" data-weighted-export="pdf"${disabled(busy || !hasStudents)}>Emitir relatório PDF</button><button type="button" class="btn soft" data-weighted-export="csv"${disabled(busy || !hasStudents)}>Exportar notas CSV</button><button type="button" class="btn soft" data-weighted-export="charts"${disabled(busy || !hasStudents)}>Exportar gráficos PDF</button></div>
          <div class="weighted-formula"><strong>Fórmula do modelo aplicado · ${esc(previewModel.name)}</strong><p>${esc(formulaOf(options, previewModel))}</p></div>
          <div class="weighted-preview-heading"><h3>Prévia da consulta</h3><span>Notas de 0 a 10</span></div>
          ${options.scopeLabel ? `<p class="weighted-scope">${esc(options.scopeLabel)}</p>` : ''}
          ${hasStudents ? `${summaryCards(summary, previewModel)}${report.includeSummary ? studentTable(preview, previewModel) : ''}${report.includeDetails ? `<h4 class="weighted-subheading">Notas individuais dos avaliadores</h4>${detailedRows(preview, previewModel)}` : ''}${report.includeCharts ? `<h4 class="weighted-subheading">Gráficos da consulta</h4>${renderCharts(options)}` : ''}${!report.includeSummary && !report.includeDetails && !report.includeCharts ? '<p class="weighted-empty-inline">Selecione ao menos um conteúdo para compor o relatório.</p>' : ''}` : '<div class="weighted-empty"><h4>Nenhum aluno nesta consulta</h4><p>Ajuste os filtros para visualizar as notas e emitir o relatório.</p></div>'}
        </div>
      </div>
    </section>`;
  }

  return Object.freeze({ render });
});
