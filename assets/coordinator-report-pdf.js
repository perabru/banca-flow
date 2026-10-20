/* Consolidado de consulta: inclui notas salvas, pendências e alunos sem banca. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaCoordinatorPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const INK = '#17365C', MUTED = '#60738A', BLUE = '#014996';
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
  const number = value => valid(value) ? value.toFixed(2).replace('.', ',') : 'Pendente';
  const text = (value, fallback = 'Não informado') => value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);
  const average = values => { const items = values.filter(valid); return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null; };
  const evaluatorMean = evaluator => {
    const values = ['presentation', 'practice', 'code', 'time'].map(key => evaluator?.[key]);
    return values.every(valid) ? average(values) : null;
  };
  const status = (board, student) => board.unassigned ? 'Sem banca' : !valid(student.result?.final) ? (board.sealed ? 'Pendente' : 'Pendente · Provisório') : !board.sealed ? 'Provisório' : 'Concluído';
  function append(pdf, input, options = {}) {
    if (!pdf || !['paragraph', 'table', 'newPage'].every(key => typeof pdf[key] === 'function')) throw new TypeError('O relatório não oferece os recursos necessários para o consolidado.');
    const boards = (Array.isArray(input) ? input : []).filter(board => board && typeof board === 'object');
    const students = boards.flatMap(board => (Array.isArray(board.students) ? board.students : []).map(student => ({ board, student })));
    const summary = options.summary || {};
    const count = (key, fallback) => Number.isInteger(summary[key]) && summary[key] >= 0 ? summary[key] : fallback;
    const actual = boards.filter(board => !board.unassigned);
    const finalCount = students.filter(({ student }) => valid(student.result?.final)).length;
    const overview = [
      ['Bancas', count('boardCount', actual.length)],
      ['Alunos no consolidado', count('studentCount', students.length)],
      ['Bancas abertas', count('openCount', actual.filter(board => !board.sealed).length)],
      ['Bancas encerradas', count('sealedCount', actual.filter(board => board.sealed).length)],
      ['Bancas arquivadas', count('archivedCount', actual.filter(board => board.archived).length)],
      ['Alunos sem banca', count('unassignedCount', students.filter(({ board }) => board.unassigned).length)],
      ['Resultados com notas completas', count('finalCount', finalCount)],
      ['Resultados completos em bancas encerradas', count('officialCount', students.filter(({ board, student }) => board.sealed && valid(student.result?.final)).length)],
      ['Resultados completos provisórios', count('provisionalCount', students.filter(({ board, student }) => !board.sealed && valid(student.result?.final)).length)],
      ['Resultados com pendências', count('pendingCount', students.length - finalCount)]
    ];
    const width = pdf.width - 2 * pdf.margin;
    const widths = ratios => ratios.map(value => width * value);
    pdf.activeBoardLabel = '';
    pdf.paragraph('Consolidado da coordenação', 16, true, BLUE, 8);
    pdf.paragraph(text(options.scopeLabel, 'Todos os alunos e todas as bancas cadastradas.'), 10, false, MUTED, 8);
    pdf.paragraph('Consulta das notas registradas, incluindo bancas abertas, encerradas, arquivadas e alunos sem banca. Ausência de nota aparece como Pendente e não equivale a zero. Resultados de bancas abertas são provisórios.', 9, false, MUTED, 8);
    pdf.paragraph('Nota final = média da banca × 60% + monografia / entregas × 40%. A média da banca exige a avaliação completa de todos os membros. A média parcial considera somente os avaliadores com os quatro critérios preenchidos e não substitui a nota final.', 9, false, MUTED, 10);
    pdf.table(['Indicador', 'Quantidade'], overview.map(([label, value]) => [label, String(value)]), widths([.76, .24]), { context: 'Resumo do consolidado', size: 9, align: ['', 'center'] });
    pdf.paragraph('Todos os alunos', 13, true, BLUE, 8);
    if (students.length) {
      pdf.table(['Aluno / curso / turma', 'Banca', 'Média da banca', 'Monografia / entregas', 'Nota final', 'Situação'], students.map(({ board, student }) => [
        `${text(student.name)}\n${text(board.courseName)} · ${text(board.className)}`,
        `${board.unassigned ? 'Sem banca' : text(board.label)}${board.archived ? '\nArquivada' : ''}`,
        number(student.result?.banca), number(student.result?.entrega), number(student.result?.final), status(board, student)
      ]), widths([.25, .21, .13, .15, .12, .14]), { context: 'Todos os alunos · notas registradas', size: 8.2, headerSize: 8.1, align: ['', '', 'center', 'center', 'center', ''] });
    } else pdf.paragraph('Nenhum aluno cadastrado neste consolidado.', 10, false, MUTED, 10);
    boards.forEach((board, index) => {
      pdf.activeBoardLabel = '';
      pdf.newPage();
      const boardTitle = board.unassigned ? 'Alunos sem banca' : `Banca ${String(index + 1).padStart(2, '0')} · ${text(board.label)}`;
      pdf.activeBoardLabel = board.unassigned ? 'Alunos sem banca' : `Banca ${String(index + 1).padStart(2, '0')}`;
      pdf.paragraph(boardTitle, 14, true, BLUE, 8);
      pdf.paragraph(`Projeto: ${text(board.project)}`, 10, true, INK);
      pdf.paragraph(`Curso: ${text(board.courseName)} · Turma: ${text(board.className)}${Number.isInteger(board.academicYear) ? ` · Ano letivo: ${board.academicYear}` : ''}`, 10, false, INK);
      if (!board.unassigned) {
        pdf.paragraph(`Data: ${text(board.startLabel)} · Sala / link: ${text(board.room)}`, 9, false, MUTED);
        pdf.paragraph(`Orientador: ${text(board.advisorName)}`, 9, false, MUTED);
        pdf.paragraph(`Situação da banca: ${board.sealed ? 'Encerrada' : 'Aberta'}${board.archived ? ' · Arquivada' : ''}`, 9, true, BLUE);
        if (Number.isFinite(board.elapsedMs) && board.elapsedMs >= 0 && root.BancaAnalyticsPdf?.formatDuration) pdf.paragraph(`Tempo de apresentação registrado: ${root.BancaAnalyticsPdf.formatDuration(board.elapsedMs)}`, 9, false, MUTED);
        else pdf.paragraph('Tempo de apresentação: Não registrado', 9, false, MUTED);
      }
      const members = Array.isArray(board.students) ? board.students : [];
      if (!members.length) pdf.paragraph('Nenhum aluno identificado nesta banca.', 10, false, MUTED);
      members.forEach((student, studentIndex) => {
        pdf.paragraph(`${String(studentIndex + 1).padStart(2, '0')} · ${text(student.name)}`, 12, true, BLUE, 7);
        const evaluators = Array.isArray(student.evaluators) ? student.evaluators : [];
        if (evaluators.length) {
          pdf.table(['Avaliador', 'Apresentação', 'Prática', 'Código', 'Tempo', 'Média'], evaluators.map(evaluator => [
            text(evaluator.name), number(evaluator.presentation), number(evaluator.practice), number(evaluator.code), number(evaluator.time), number(evaluatorMean(evaluator))
          ]), widths([.30, .14, .14, .14, .14, .14]), { context: `Aluno ${String(studentIndex + 1).padStart(2, '0')} · notas individuais`, size: 8.8, headerSize: 8, align: ['', 'center', 'center', 'center', 'center', 'center'] });
        } else pdf.paragraph(board.unassigned ? 'Sem banca designada. Notas dos avaliadores: Pendente.' : 'Avaliadores não identificados. Notas dos avaliadores: Pendente.', 9, false, MUTED, 8);
        const partial = average(evaluators.map(evaluatorMean));
        const completed = evaluators.filter(evaluator => valid(evaluatorMean(evaluator))).length;
        pdf.paragraph(`Média parcial da banca: ${number(partial)} · ${completed} de ${evaluators.length} avaliador(es) com os quatro critérios preenchidos.`, 9, false, MUTED, 7);
        pdf.table(['Média da banca', 'Monografia / entregas', 'Banca × 60%', 'Monografia × 40%', 'Nota final'], [[
          number(student.result?.banca), number(student.result?.entrega), number(student.result?.parcelaBanca), number(student.result?.parcelaEntrega), number(student.result?.final)
        ]], widths([.20, .20, .20, .20, .20]), { context: `Aluno ${String(studentIndex + 1).padStart(2, '0')} · composição da nota`, size: 9.5, headerSize: 8.3, align: ['center', 'center', 'center', 'center', 'center'], bold: true });
        pdf.paragraph(`Situação do resultado: ${status(board, student)}${board.archived ? ' · Banca arquivada' : ''}.`, 9, true, status(board, student) === 'Concluído' ? INK : MUTED, 12);
      });
    });
    if (Array.isArray(options.charts) && options.charts.length) {
      if (!root.BancaAnalyticsPdf || typeof root.BancaAnalyticsPdf.draw !== 'function') throw new Error('Os gráficos ainda não carregaram. Recarregue a página antes de emitir o consolidado.');
      pdf.activeBoardLabel = '';
      pdf.newPage();
      pdf.paragraph('Gráficos de todos os alunos', 15, true, BLUE, 8);
      pdf.paragraph(text(options.scopeLabel, 'Todos os alunos e todas as bancas cadastradas.'), 9, false, MUTED, 8);
      pdf.paragraph('Os gráficos incluem as notas disponíveis e os resultados parciais. Ausências não equivalem a zero. Notas finais de bancas abertas são provisórias. Todos os critérios individuais constam nas tabelas deste arquivo.', 9, false, MUTED, 10);
      root.BancaAnalyticsPdf.draw(pdf, options.charts);
    }
    pdf.activeBoardLabel = '';
    return pdf;
  }
  return Object.freeze({ append });
});
