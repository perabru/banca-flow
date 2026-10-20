/* Cálculos puros dos modelos de relatório da coordenação. Não grava notas. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaWeightedModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CRITERIA = Object.freeze([
    ['presentation', 'Apresentação'], ['practice', 'Parte prática'],
    ['code', 'Domínio do código'], ['time', 'Domínio do tempo']
  ].map(item => Object.freeze(item)));
  const COLORS = Object.freeze(['#174B8E', '#087F8C', '#B4223B', '#7356A6', '#A76A10', '#407B50']);
  const EPSILON = 1e-8;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const list = value => Array.isArray(value) ? value : [];
  const clean = value => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const grade = value => nonnegative(value) !== null && value <= 10 ? value : null;
  const boundedResult = value => typeof value === 'number' && Number.isFinite(value) && value >= -EPSILON && value <= 10 + EPSILON ? Math.max(0, Math.min(10, value)) : null;
  const mean = values => { const available = values.filter(value => grade(value) !== null); return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null; };
  const numberLabel = value => value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 8 });
  const boardLabel = (board, index) => clean(board?.label) || (board?.unassigned ? 'Sem banca' : `Banca ${index + 1}`);
  const studentLabel = (student, index) => clean(student?.name) || `Aluno(a) ${index + 1}`;

  function defaults() {
    return {
      version: 1, name: 'Modelo de avaliação', title: 'Relatório personalizado de avaliações',
      boardWeight: 60, monographWeight: 40,
      criteriaWeights: { presentation: 25, practice: 25, code: 25, time: 25 },
      evaluatorWeights: {}, decimals: 2
    };
  }
  function percent(value, label) {
    if (nonnegative(value) === null || value > 100) throw new Error(`${label}: informe um número entre 0 e 100.`);
    return value;
  }
  function normalize(input) {
    if (input === undefined || input === null) return defaults();
    if (!object(input)) throw new Error('O modelo de avaliação deve ser um objeto válido.');
    const base = defaults();
    if (own(input, 'version') && input.version !== 1) throw new Error('A versão do modelo de avaliação não é compatível.');
    const name = own(input, 'name') ? clean(input.name) : base.name;
    const title = own(input, 'title') ? clean(input.title) : base.title;
    if (typeof (input.name ?? name) !== 'string' || !name || name.length > 80) throw new Error('Informe um nome de modelo com até 80 caracteres.');
    if (typeof (input.title ?? title) !== 'string' || !title || title.length > 140) throw new Error('Informe um título de relatório com até 140 caracteres.');
    const boardWeight = percent(own(input, 'boardWeight') ? input.boardWeight : base.boardWeight, 'Peso da banca');
    let monographWeight = percent(own(input, 'monographWeight') ? input.monographWeight : base.monographWeight, 'Peso da monografia');
    if (Math.abs(boardWeight + monographWeight - 100) > EPSILON) throw new Error('Os pesos da banca e da monografia devem somar 100%.');
    // Corrige somente o ruído binário de uma soma já validada como 100%.
    monographWeight = 100 - boardWeight;
    if (own(input, 'criteriaWeights') && !object(input.criteriaWeights)) throw new Error('Informe os quatro pesos dos critérios.');
    const suppliedCriteria = input.criteriaWeights || {};
    if (Object.keys(suppliedCriteria).some(key => !CRITERIA.some(([known]) => known === key))) throw new Error('O modelo contém um critério desconhecido.');
    const criteriaWeights = Object.fromEntries(CRITERIA.map(([key, label]) => [key, percent(own(suppliedCriteria, key) ? suppliedCriteria[key] : base.criteriaWeights[key], `Peso de ${label}`)]));
    const criteriaTotal = Object.values(criteriaWeights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(criteriaTotal - 100) > EPSILON) throw new Error('Os pesos dos quatro critérios devem somar 100%.');
    const largestCriterion = CRITERIA.map(([key]) => key).reduce((largest, key) => criteriaWeights[key] > criteriaWeights[largest] ? key : largest, CRITERIA[0][0]);
    criteriaWeights[largestCriterion] += 100 - criteriaTotal;
    if (own(input, 'evaluatorWeights') && !object(input.evaluatorWeights)) throw new Error('Os pesos dos avaliadores devem ser identificados pelo UID.');
    const weightEntries = Object.entries(input.evaluatorWeights || {});
    if (weightEntries.length > 300) throw new Error('O modelo pode conter pesos para até 300 avaliadores.');
    const evaluatorWeights = Object.fromEntries(weightEntries.map(([uid, value]) => {
      if (!uid.trim() || uid.length > 200 || ['__proto__', 'prototype', 'constructor'].includes(uid) || /[\u0000-\u001F\u007F]/.test(uid)) throw new Error('Há um identificador de avaliador inválido no modelo.');
      if (nonnegative(value) === null || value > 100) throw new Error('O peso relativo de cada avaliador deve ser um número entre 0 e 100.');
      return [uid, value];
    }));
    const decimals = own(input, 'decimals') ? input.decimals : base.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) throw new Error('Escolha de 0 a 4 casas decimais para a exibição.');
    return { version: 1, name, title, boardWeight, monographWeight, criteriaWeights, evaluatorWeights, decimals };
  }

  function formula(input) {
    const model = normalize(input);
    const criteria = CRITERIA.filter(([key]) => model.criteriaWeights[key] > 0).map(([key, label]) => `${label} × ${numberLabel(model.criteriaWeights[key])}%`).join(' + ');
    return `Média do avaliador = ${criteria}. Média da banca = soma das médias dos avaliadores multiplicadas pelos respectivos pesos relativos, dividida pela soma desses pesos. Resultado = média da banca × ${numberLabel(model.boardWeight)}% + monografia e entregas × ${numberLabel(model.monographWeight)}%.`;
  }
  function formatGrade(value, input) {
    const model = normalize(input), valid = grade(value);
    return valid === null ? 'Pendente' : valid.toLocaleString('pt-BR', { minimumFractionDigits: model.decimals, maximumFractionDigits: model.decimals });
  }
  function deliveryOf(student) {
    for (const key of ['delivery', 'monograph', 'entrega']) if (own(student, key)) return grade(student[key]);
    return grade(student?.result?.entrega);
  }
  function calculateNormalized(student, model, board = {}) {
    const source = object(student) ? student : {}, pending = [], identifiers = new Set();
    const evaluators = list(source.evaluators).map((evaluator, index) => {
      const row = object(evaluator) ? evaluator : {}, uid = typeof row.uid === 'string' ? row.uid : '';
      const name = clean(row.name) || `Avaliador ${index + 1}`;
      const evaluatorWeight = uid && own(model.evaluatorWeights, uid) ? model.evaluatorWeights[uid] : 1;
      const scores = Object.fromEntries(CRITERIA.map(([key]) => [key, grade(own(row, key) ? row[key] : row.scores?.[key])]));
      const missing = CRITERIA.filter(([key]) => model.criteriaWeights[key] > 0 && scores[key] === null);
      const duplicate = uid && identifiers.has(uid);
      if (uid) identifiers.add(uid);
      const weightedMean = missing.length || duplicate ? null : boundedResult(CRITERIA.reduce((sum, [key]) => sum + (scores[key] ?? 0) * model.criteriaWeights[key] / 100, 0));
      if (model.boardWeight > 0 && evaluatorWeight > 0) {
        if (duplicate) pending.push(`${name}: avaliador repetido no cadastro da banca.`);
        for (const [, label] of missing) pending.push(`${name}: ${label} pendente.`);
      }
      return { ...row, ...scores, uid, name, originalMean: own(row, 'originalMean') ? row.originalMean : grade(row.mean), mean: weightedMean, weightedMean, evaluatorWeight, included: evaluatorWeight > 0, missingCriteria: missing.map(([key]) => key) };
    });
    const included = evaluators.filter(evaluator => evaluator.evaluatorWeight > 0), totalWeight = included.reduce((sum, evaluator) => sum + evaluator.evaluatorWeight, 0);
    let banca = included.length && totalWeight > 0 && included.every(evaluator => evaluator.weightedMean !== null)
      ? boundedResult(included.reduce((sum, evaluator) => sum + evaluator.weightedMean * evaluator.evaluatorWeight, 0) / totalWeight) : null;
    const entrega = deliveryOf(source);
    if (model.boardWeight > 0 && !included.length) pending.push('A banca precisa de pelo menos um avaliador com peso maior que zero.');
    if (model.monographWeight > 0 && entrega === null) pending.push('Monografia e entregas pendentes.');
    const unassigned = board?.unassigned === true || source.status === 'Sem banca';
    if (unassigned) { banca = null; pending.push('Aluno sem banca agendada.'); }
    const parcelaBanca = model.boardWeight === 0 ? 0 : banca === null ? null : banca * model.boardWeight / 100;
    const parcelaEntrega = model.monographWeight === 0 ? 0 : entrega === null ? null : entrega * model.monographWeight / 100;
    const final = !unassigned && parcelaBanca !== null && parcelaEntrega !== null ? boundedResult(parcelaBanca + parcelaEntrega) : null;
    const status = unassigned ? 'Sem banca' : final === null ? 'Pendente' : 'Personalizado';
    return { evaluators, result: { banca, entrega, parcelaBanca, parcelaEntrega, final }, pending, complete: final !== null, status };
  }
  function calculateStudent(student, input, board) { return calculateNormalized(student, normalize(input), board); }
  function applyModel(boards, input) {
    const model = normalize(input);
    return list(boards).filter(object).map(board => ({ ...board, weightedModel: normalize(model), students: list(board.students).map(student => {
      const source = object(student) ? student : {}, calculation = calculateNormalized(source, model, board);
      const originalResult = own(source, 'originalResult') ? source.originalResult : source.result;
      return { ...source, originalResult: object(originalResult) ? { ...originalResult } : originalResult ?? null,
        ...calculation, modelResult: { ...calculation.result }, modelPending: calculation.pending.slice() };
    }) }));
  }
  const recordsOf = boards => list(boards).flatMap(board => list(board?.students).map(student => ({ board, student })));
  // Recalcula sempre a partir dos critérios e da entrega salvos; valores antigos
  // de média/final nunca substituem os cálculos do modelo selecionado.
  const prepared = (boards, input) => applyModel(boards, modelOf(boards, input));
  function summary(boards, input) {
    const source = prepared(boards, input), records = recordsOf(source), actual = source.filter(board => !board?.unassigned);
    const times = actual.map(board => nonnegative(board.elapsedMs)).filter(value => value !== null);
    const finals = records.map(({ student }) => grade(student?.result?.final));
    return {
      boardCount: actual.length, studentCount: records.length,
      finalCount: finals.filter(value => value !== null).length,
      pendingCount: finals.filter(value => value === null).length,
      personalizedCount: finals.filter(value => value !== null).length,
      sealedCompleteCount: records.filter(({ board, student }) => board.sealed && grade(student?.result?.final) !== null).length,
      openCompleteCount: records.filter(({ board, student }) => !board.sealed && grade(student?.result?.final) !== null).length,
      unassignedCount: records.filter(({ board, student }) => board.unassigned || student.status === 'Sem banca').length,
      openCount: actual.filter(board => !board.sealed).length, sealedCount: actual.filter(board => board.sealed).length,
      archivedCount: actual.filter(board => board.archived).length,
      meanFinal: mean(finals), meanBanca: mean(records.map(({ student }) => grade(student?.result?.banca))),
      meanMonografia: mean(records.map(({ student }) => grade(student?.result?.entrega))),
      timedCount: times.length, meanElapsedMs: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null
    };
  }
  function modelOf(boards, input) { return normalize(input === undefined ? list(boards).find(board => board?.weightedModel)?.weightedModel : input); }
  function charts(boards, input) {
    const source = prepared(boards, input), model = modelOf(source, input), records = recordsOf(source);
    const label = ({ board, student }, index) => [studentLabel(student, index), boardLabel(board, index), clean(board.className), clean(board.courseName), student.status || (grade(student.result?.final) === null ? 'Pendente' : 'Personalizado')].filter(Boolean).join(' · ');
    const durations = source.filter(board => !board.unassigned).map((board, index) => ({ label: [boardLabel(board, index), clean(board.className), clean(board.courseName)].filter(Boolean).join(' · '), values: [nonnegative(board.elapsedMs), nonnegative(board.plannedMs)] }));
    return [
      { id: 'weighted-results', title: 'Resultados por aluno · ' + model.name,
        subtitle: `Resultado do modelo: banca × ${numberLabel(model.boardWeight)}% + monografia e entregas × ${numberLabel(model.monographWeight)}%. A média de cada avaliador usa os pesos dos critérios; a banca considera os pesos relativos dos avaliadores. Notas ausentes permanecem pendentes.`,
        max: 10, unit: 'grade', mode: 'grouped', decimals: model.decimals,
        series: [{ label: 'Média ponderada da banca', color: COLORS[0] }, { label: 'Monografia e entregas', color: COLORS[1] }, { label: 'Resultado do modelo', color: COLORS[2] }],
        rows: records.map((record, index) => ({ label: label(record, index), values: ['banca', 'entrega', 'final'].map(key => grade(record.student.result?.[key])) })) },
      { id: 'weighted-composition', title: 'Composição do resultado por aluno',
        subtitle: `As parcelas somam o resultado do modelo. Banca: ${numberLabel(model.boardWeight)}%; monografia e entregas: ${numberLabel(model.monographWeight)}%. Os cálculos usam precisão completa; a exibição usa ${model.decimals} casa(s) decimal(is).`,
        max: 10, unit: 'grade', mode: 'stacked', decimals: model.decimals,
        series: [{ label: `Banca × ${numberLabel(model.boardWeight)}%`, color: COLORS[0] }, { label: `Monografia × ${numberLabel(model.monographWeight)}%`, color: COLORS[1] }],
        rows: records.map((record, index) => ({ label: label(record, index), values: ['parcelaBanca', 'parcelaEntrega'].map(key => grade(record.student.result?.[key])) })) },
      { id: 'weighted-saved-criteria', title: 'Notas registradas por critério',
        subtitle: 'Médias das notas válidas salvas de todos os alunos e avaliadores, inclusive critérios sem participação no resultado. O peso no modelo e a quantidade de notas constam no rótulo. Estas médias descritivas não substituem o cálculo individual ponderado.',
        max: 10, unit: 'grade', mode: 'grouped', decimals: model.decimals, series: [{ label: 'Média das notas salvas', color: COLORS[0] }],
        rows: CRITERIA.map(([key, title]) => { const values = records.flatMap(({ student }) => list(student.evaluators).map(evaluator => grade(evaluator[key]))).filter(value => value !== null); return { label: `${title} · peso ${numberLabel(model.criteriaWeights[key])}% · ${values.length} nota(s)`, values: [mean(values)] }; }) },
      { id: 'weighted-duration', title: 'Tempo de apresentação por banca',
        subtitle: 'Tempo registrado no cronômetro e intervalo reservado na agenda. Bancas sem tempo registrado permanecem sem valor; zero é um registro válido. O intervalo pode abranger arguição e transição.',
        max: durations.flatMap(row => row.values).reduce((largest, value) => value === null ? largest : Math.max(largest, value), 60000), unit: 'duration', mode: 'grouped',
        series: [{ label: 'Tempo registrado', color: COLORS[0] }, { label: 'Intervalo reservado', color: COLORS[1] }], rows: durations }
    ];
  }
  function details(board, input) {
    const model = modelOf([board], input), preparedBoard = applyModel([board], model)[0];
    if (!preparedBoard) return [];
    return list(preparedBoard.students).map((student, index) => ({
      id: `weighted-${clean(board.id) || 'board'}-${clean(student.id) || index}-criteria`,
      title: `Notas por avaliador · ${studentLabel(student, index)}`,
      subtitle: `Critérios e pesos do modelo ${model.name}. O peso relativo de cada avaliador consta na legenda; peso zero indica participação excluída do resultado. Notas individuais preservam os valores registrados.`,
      max: 10, unit: 'grade', mode: 'grouped', decimals: model.decimals,
      series: list(student.evaluators).map((evaluator, evaluatorIndex) => ({ label: `${evaluator.name} · peso ${numberLabel(evaluator.evaluatorWeight)}`, color: COLORS[evaluatorIndex % COLORS.length] })),
      rows: CRITERIA.map(([key, title]) => ({ label: `${title} · ${numberLabel(model.criteriaWeights[key])}%`, values: list(student.evaluators).map(evaluator => grade(evaluator[key])) }))
    }));
  }
  function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001F\u007F\uFEFF]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvNumber(value) { return nonnegative(value) === null ? '' : String(value).replace('.', ','); }
  function csv(boards, input) {
    const source = prepared(boards, input), model = modelOf(source, input);
    const rows = [[
      'Modelo', 'Título do relatório', 'Curso', 'Turma', 'Grupo', 'Projeto', 'ID da banca', 'ID do aluno', 'Aluno',
      'UID do avaliador', 'Avaliador', 'Peso relativo do avaliador', ...CRITERIA.map(([, title]) => title), 'Média ponderada do avaliador',
      'Média ponderada da banca', 'Monografia e entregas', `Parcela da banca (${numberLabel(model.boardWeight)}%)`, `Parcela da monografia (${numberLabel(model.monographWeight)}%)`,
      'Resultado do modelo (precisão completa)', 'Resultado exibido', 'Situação', 'Pendências',
      ...CRITERIA.map(([, title]) => `Peso de ${title} (%)`), 'Peso da banca (%)', 'Peso da monografia (%)', 'Casas decimais',
      'Data e horário', 'Sala', 'Orientador', 'Banca encerrada', 'Turma arquivada', 'Sem banca', 'Tempo registrado (ms)', 'Intervalo reservado (ms)'
    ]];
    source.forEach((board, boardIndex) => list(board.students).forEach((student, studentIndex) => {
      const evaluators = list(student.evaluators), result = student.result || {};
      (evaluators.length ? evaluators : [null]).forEach(evaluator => rows.push([
        model.name, model.title, board.courseName, board.className, boardLabel(board, boardIndex), board.project,
        board.unassigned ? '' : board.id, student.id, studentLabel(student, studentIndex), evaluator?.uid, evaluator?.name,
        csvNumber(evaluator?.evaluatorWeight), ...CRITERIA.map(([key]) => csvNumber(grade(evaluator?.[key]))), csvNumber(grade(evaluator?.weightedMean ?? evaluator?.mean)),
        csvNumber(grade(result.banca)), csvNumber(grade(result.entrega)), csvNumber(grade(result.parcelaBanca)), csvNumber(grade(result.parcelaEntrega)), csvNumber(grade(result.final)),
        grade(result.final) === null ? '' : formatGrade(result.final, model), student.status || (board.unassigned ? 'Sem banca' : grade(result.final) === null ? 'Pendente' : 'Personalizado'),
        list(student.modelPending || student.pending).join(' | '), ...CRITERIA.map(([key]) => csvNumber(model.criteriaWeights[key])), csvNumber(model.boardWeight), csvNumber(model.monographWeight), model.decimals,
        board.startLabel, board.room, board.advisorName, board.unassigned ? '' : board.sealed ? 'Sim' : 'Não', board.archived ? 'Sim' : 'Não', board.unassigned ? 'Sim' : 'Não',
        board.unassigned ? '' : csvNumber(board.elapsedMs), board.unassigned ? '' : csvNumber(board.plannedMs)
      ]));
    }));
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }
  return Object.freeze({ CRITERIA, defaults, normalize, formula, formatGrade, calculateStudent, applyModel, summary, charts, details, csv });
});
