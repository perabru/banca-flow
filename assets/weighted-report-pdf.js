/* Relatórios personalizados de consulta. Não altera o cálculo oficial das bancas. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaWeightedReportPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const BLUE = '#014996', INK = '#17365C', MUTED = '#60738A';
  const CRITERIA = [ ['presentation', 'Apresentação'], ['practice', 'Prática'], ['code', 'Código'], ['time', 'Tempo'] ];
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
  const clean = (value, fallback = 'Não informado', maximum = 12000) => {
    if (value === null || value === undefined) return fallback;
    const result = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return result ? result.slice(0, maximum) : fallback;
  };
  const decimal = value => String(value).replace('.', ',');
  const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  function engine() {
    if (root.BancaWeightedModel) return root.BancaWeightedModel;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./weighted-model.js');
    throw new Error('O cálculo dos modelos ainda não carregou. Recarregue a página antes de emitir o relatório.');
  }
  function duration(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Não registrado';
    const ticks = Math.floor(value / 10);
    return `${String(Math.floor(ticks / 6000)).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')},${String(ticks % 100).padStart(2, '0')}`;
  }
  function reportStatus(board, student) {
    if (board.unassigned) return 'Sem banca';
    if (!valid(student.result?.final)) return board.sealed ? 'Pendente' : 'Pendente · Provisório';
    return board.sealed ? 'Concluído' : 'Provisório';
  }
  function evaluatorWeight(evaluator, model) {
    const configured = model.evaluatorWeights || {};
    return Object.prototype.hasOwnProperty.call(configured, evaluator.uid) ? configured[evaluator.uid] : 1;
  }
  function mean(evaluator) {
    return valid(evaluator.weightedMean) ? evaluator.weightedMean : valid(evaluator.mean) ? evaluator.mean : null;
  }
  function append(pdf, input, rawOptions = {}) {
    if (!pdf || !['paragraph', 'table', 'newPage'].every(key => typeof pdf[key] === 'function') || !Number.isFinite(pdf.width) || !Number.isFinite(pdf.margin) || pdf.width - 2 * pdf.margin < 150) {
      throw new TypeError('O relatório não oferece os recursos necessários para o modelo personalizado.');
    }
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const models = engine(), model = models.normalize(options.model || models.defaults());
    // Always calculate from raw criteria. Previously saved/rounded means never become input.
    const boards = models.applyModel(list(input), model);
    const students = boards.flatMap(board => list(board.students).map(student => ({ board, student })));
    const actualBoards = boards.filter(board => !board.unassigned);
    const grades = students.map(({ student }) => student.result?.final).filter(valid);
    const format = value => valid(value) ? models.formatGrade(value, model) : 'Pendente';
    const percent = value => `${decimal(value)}%`;
    const title = clean(options.title, clean(model.title, 'Relatório completo de notas'), 2400);
    const name = clean(model.name, 'Modelo personalizado', 2400);
    const scope = clean(options.scopeLabel, 'Todos os alunos e todas as bancas cadastradas.');
    const issued = options.issuedAt instanceof Date ? options.issuedAt.toLocaleString('pt-BR') : clean(options.issuedAt, clean(pdf.issued));
    const preparedBy = clean(options.preparedBy, clean(pdf.responsible, 'Coordenação'));
    const width = pdf.width - 2 * pdf.margin;
    const widths = ratios => ratios.map(value => width * value);
    const table = (headers, rows, ratios, settings = {}) => pdf.table(headers, rows, widths(ratios), settings);
    const startSection = label => { pdf.activeBoardLabel = ''; pdf.newPage(); pdf.paragraph(label, 15, true, BLUE, 9); };
    const continueSection = label => {
      pdf.activeBoardLabel = '';
      // Keep the heading with the first summary rows while using the space left
      // after the model and notes; the native table handles subsequent pages.
      if (typeof pdf.ensure === 'function') pdf.ensure(140);
      pdf.paragraph(label, 15, true, BLUE, 9);
    };
    const chartsOnly = options.chartsOnly === true;
    pdf.activeBoardLabel = '';
    // The native footer is a single line shared with the page number.
    const footerName = clean(name, 'Modelo', 40) + (name.length > 40 ? '...' : '');
    pdf.footerLabel = `Relatório personalizado · ${footerName} · Univap`;
    pdf.documentTitle = clean(`${title} · ${name} · Univap`, '', 512);
    pdf.paragraph('COORDENAÇÃO · UNIVAP', 9, true, MUTED, 7);
    pdf.paragraph(title, 18, true, BLUE, 9);
    pdf.paragraph(`Relatório personalizado · Modelo: ${name}`, 12, true, INK, 9);
    pdf.paragraph(`Emissão: ${issued} · Preparado por: ${preparedBy}`, 9, false, MUTED, 7);
    pdf.paragraph(`Seleção e filtros: ${scope}`, 9, false, MUTED, 8);
    pdf.paragraph('Cálculo de consulta conforme os pesos descritos neste arquivo. O registro oficial das bancas e seus relatórios de 60% / 40% permanecem preservados. Resultados de bancas abertas são provisórios. Notas ausentes aparecem como Pendente; uma nota zero é válida.', 9, false, MUTED, 9);
    pdf.paragraph('Composição do modelo', 12, true, BLUE, 7);
    pdf.paragraph(clean(models.formula(model), 'Nota final conforme o modelo personalizado.'), 10, true, INK, 8);
    table(['Etapa', 'Peso na nota final'], [
      ['Média ponderada da banca', percent(model.boardWeight)],
      ['Monografia / entregas', percent(model.monographWeight)]
    ], [.72, .28], { context: 'Pesos das etapas', size: 9, align: ['', 'center'] });
    table(['Critério individual', 'Peso na média do avaliador'], CRITERIA.map(([key, label]) => [label, percent(model.criteriaWeights[key])]), [.66, .34], { context: 'Pesos dos critérios', size: 9, align: ['', 'center'] });
    pdf.paragraph('Média de cada avaliador = soma de (nota do critério × peso do critério / 100). Média da banca = soma de (média do avaliador × peso relativo) / soma dos pesos relativos. As parcelas são calculadas sem arredondamento intermediário.', 9, false, MUTED, 7);
    pdf.paragraph(`Exibição com ${model.decimals} casa(s) decimal(is). Critérios, avaliadores e etapas com peso zero não participam do cálculo. As notas individuais registradas continuam visíveis, inclusive quando não exigidas pelo modelo.`, 9, false, MUTED, 8);
    const people = new Map();
    for (const { student } of students) for (const evaluator of list(student.evaluators)) {
      const uid = clean(evaluator.uid, '', 512);
      if (uid && !people.has(uid)) people.set(uid, clean(evaluator.name));
    }
    const configured = model.evaluatorWeights || {};
    for (const uid of Object.keys(configured)) if (!people.has(uid) && configured[uid] !== 1) people.set(uid, 'Avaliador fora da seleção');
    const weights = Array.from(people, ([uid, label]) => [label, uid, decimal(Object.prototype.hasOwnProperty.call(configured, uid) ? configured[uid] : 1)]);
    if (weights.length) table(['Avaliador', 'Identificador', 'Peso relativo'], weights, [.45, .39, .16], { context: 'Pesos relativos dos avaliadores', size: 8.5, headerSize: 8, align: ['', '', 'center'] });
    pdf.paragraph('Peso relativo padrão para todos os demais avaliadores, atuais e novos: 1. Peso zero exclui a participação no cálculo deste modelo. Os pesos relativos são normalizados entre os avaliadores de cada aluno; não precisam somar 100.', 9, false, MUTED, 8);
    if (clean(options.notes, '')) {
      pdf.paragraph('Observações da coordenação', 12, true, BLUE, 6);
      pdf.paragraph(clean(options.notes, '', 12000), 9, false, INK, 10);
    }
    if (options.includeSummary !== false && !chartsOnly) {
      continueSection('Resumo dos resultados');
      const complete = ({ student }) => valid(student.result?.final);
      const overview = [
        ['Bancas na seleção', actualBoards.length],
        ['Alunos no relatório', students.length],
        ['Bancas abertas', actualBoards.filter(board => !board.sealed).length],
        ['Bancas encerradas', actualBoards.filter(board => board.sealed).length],
        ['Bancas arquivadas', actualBoards.filter(board => board.archived).length],
        ['Alunos sem banca', students.filter(({ board }) => board.unassigned).length],
        ['Resultados completos', students.filter(complete).length],
        ['Resultados completos em bancas encerradas', students.filter(item => item.board.sealed && !item.board.unassigned && complete(item)).length],
        ['Resultados completos provisórios', students.filter(item => !item.board.sealed && !item.board.unassigned && complete(item)).length],
        ['Resultados com pendências', students.filter(item => !complete(item)).length]
      ];
      table(['Indicador', 'Quantidade'], overview.map(([label, value]) => [label, String(value)]), [.77, .23], { context: 'Resumo do modelo personalizado', size: 9, align: ['', 'center'] });
      if (grades.length) pdf.paragraph(`Média das notas finais completas: ${format(grades.reduce((sum, value) => sum + value, 0) / grades.length)} · Menor nota: ${format(grades.reduce((smallest, value) => Math.min(smallest, value), 10))} · Maior nota: ${format(grades.reduce((largest, value) => Math.max(largest, value), 0))}. Inclui resultados provisórios identificados na tabela.`, 9, false, MUTED, 9);
      pdf.paragraph('Todos os alunos da seleção', 12, true, BLUE, 8);
      if (students.length) table(['Aluno / curso / turma', 'Banca', 'Média da banca', 'Monografia / entregas', 'Nota final', 'Situação'], students.map(({ board, student }) => [
        `${clean(student.name)}\n${clean(board.courseName)} · ${clean(board.className)}`,
        `${board.unassigned ? 'Sem banca' : clean(board.label)}${board.archived ? '\nArquivada' : ''}`,
        format(student.result?.banca), format(student.result?.entrega), format(student.result?.final), reportStatus(board, student)
      ]), [.25, .21, .13, .15, .12, .14], { context: 'Todos os alunos · modelo personalizado', size: 8.2, headerSize: 8, align: ['', '', 'center', 'center', 'center', ''] });
      else pdf.paragraph('Nenhum aluno cadastrado nesta seleção.', 10, false, MUTED, 10);
    }
    if (options.includeDetails !== false && !chartsOnly) boards.forEach((board, boardIndex) => {
      const boardNumber = String(boardIndex + 1).padStart(2, '0');
      startSection(board.unassigned ? `Alunos sem banca · ${clean(board.label)}` : `Banca ${boardNumber} · ${clean(board.label)}`);
      pdf.activeBoardLabel = board.unassigned ? 'Alunos sem banca' : `Banca ${boardNumber}`;
      pdf.paragraph(`Projeto: ${clean(board.project)}`, 10, true, INK, 6);
      pdf.paragraph(`Curso: ${clean(board.courseName)} · Turma: ${clean(board.className)}`, 9, false, MUTED, 6);
      pdf.paragraph(`Orientador: ${clean(board.advisorName)}`, 9, false, MUTED, 6);
      if (board.unassigned) pdf.paragraph(`Sem banca designada.${board.archived ? ' Grupo arquivado.' : ''}`, 9, true, MUTED, 9);
      else {
        pdf.paragraph(`Data: ${clean(board.startLabel)} · Sala / link: ${clean(board.room)}`, 9, false, MUTED, 6);
        pdf.paragraph(`Situação da banca: ${board.sealed ? 'Encerrada' : 'Aberta'}${board.archived ? ' · Arquivada' : ''}`, 9, true, BLUE, 6);
        pdf.paragraph(`Tempo de apresentação registrado: ${duration(board.elapsedMs)} · Tempo previsto: ${duration(board.plannedMs)}`, 9, false, MUTED, 9);
      }
      const members = list(board.students);
      if (!members.length) pdf.paragraph('Nenhum aluno identificado nesta banca.', 10, false, MUTED, 10);
      members.forEach((student, studentIndex) => {
        const studentNumber = String(studentIndex + 1).padStart(2, '0');
        pdf.paragraph(`${studentNumber} · ${clean(student.name)}`, 12, true, BLUE, 8);
        const evaluators = list(student.evaluators);
        if (evaluators.length) table(['Avaliador', 'Peso relativo', 'Apresentação', 'Prática', 'Código', 'Tempo', 'Média ponderada'], evaluators.map(evaluator => [
          clean(evaluator.name), decimal(evaluatorWeight(evaluator, model)), ...CRITERIA.map(([key]) => format(evaluator[key])), format(mean(evaluator))
        ]), [.28, .08, .128, .128, .128, .128, .128], { context: `Aluno ${studentNumber} · critérios e pesos individuais`, size: 8.2, headerSize: 7.5, align: ['', 'center', 'center', 'center', 'center', 'center', 'center'] });
        else pdf.paragraph(board.unassigned ? 'Sem banca designada. Notas dos avaliadores: Pendente.' : 'Avaliadores não identificados. Notas dos avaliadores: Pendente.', 9, false, MUTED, 8);
        const participating = evaluators.filter(evaluator => evaluatorWeight(evaluator, model) > 0);
        const finished = participating.filter(evaluator => valid(mean(evaluator)));
        const relativeTotal = finished.reduce((sum, evaluator) => sum + evaluatorWeight(evaluator, model), 0);
        const partial = relativeTotal ? finished.reduce((sum, evaluator) => sum + mean(evaluator) * evaluatorWeight(evaluator, model), 0) / relativeTotal : null;
        pdf.paragraph(`Consulta parcial dos avaliadores completos: ${format(partial)} · ${finished.length} de ${participating.length} avaliador(es) com peso positivo. Este valor não substitui a composição completa da nota.`, 8.8, false, MUTED, 7);
        table(['Média da banca', 'Monografia / entregas', `Banca × ${percent(model.boardWeight)}`, `Monografia × ${percent(model.monographWeight)}`, 'Nota final'], [[
          format(student.result?.banca), format(student.result?.entrega), format(student.result?.parcelaBanca), format(student.result?.parcelaEntrega), format(student.result?.final)
        ]], [.20, .20, .20, .20, .20], { context: `Aluno ${studentNumber} · composição personalizada`, size: 9.5, headerSize: 8, align: ['center', 'center', 'center', 'center', 'center'], bold: true });
        const pending = Array.isArray(student.pending) ? student.pending : Array.isArray(student.modelPending) ? student.modelPending : [];
        for (const reason of pending) pdf.paragraph(`Pendência: ${clean(reason)}`, 8.8, false, MUTED, 5);
        pdf.paragraph(`Situação do resultado: ${reportStatus(board, student)}${board.archived ? ' · Banca arquivada' : ''}.`, 9, true, valid(student.result?.final) ? INK : MUTED, 12);
      });
    });
    if (options.includeCharts !== false) {
      const charts = Array.isArray(options.charts) ? options.charts : models.charts(boards, model);
      startSection('Gráficos do modelo personalizado');
      pdf.paragraph(`Modelo: ${name} · ${scope}`, 9, false, MUTED, 7);
      pdf.paragraph('Valores calculados com os pesos deste modelo, sem arredondamento intermediário. Notas ausentes não equivalem a zero. Os resultados de bancas abertas são provisórios. Tempos são apresentados em minutos, segundos e centésimos.', 9, false, MUTED, 9);
      if (charts.length) {
        if (!root.BancaAnalyticsPdf || typeof root.BancaAnalyticsPdf.draw !== 'function') throw new Error('Os gráficos ainda não carregaram. Recarregue a página antes de emitir o relatório.');
        root.BancaAnalyticsPdf.draw(pdf, charts);
      } else pdf.paragraph('Nenhum gráfico selecionado ou disponível para esta seleção.', 10, false, MUTED, 10);
    }
    pdf.activeBoardLabel = '';
    return pdf;
  }
  return Object.freeze({ append });
});
