/* BancaFlow coordinator report: complete student coverage and explicit missing data. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaCoordinatorReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLORS = Object.freeze(['#174B8E', '#087F8C', '#B4223B', '#7356A6']);
  const CRITERIA = Object.freeze([
    ['presentation', 'Apresentação'], ['practice', 'Parte prática'],
    ['code', 'Domínio do código'], ['time', 'Domínio do tempo']
  ]);
  const list = value => Array.isArray(value) ? value : [];
  const clean = value => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const grade = value => number(value) !== null && value <= 10 ? value : null;
  const mean = values => {
    const available = values.filter(value => value !== null);
    return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
  };
  const studentsOf = boards => list(boards).flatMap(board => list(board?.students).map(student => ({ board, student })));
  const boardLabel = (board, index) => clean(board?.label) || (board?.unassigned ? 'Sem banca' : `Banca ${index + 1}`);
  const studentLabel = (student, index) => clean(student?.name) || `Aluno(a) ${index + 1}`;

  function statusOf(board, student) {
    if (board?.unassigned || student?.status === 'Sem banca') return 'Sem banca';
    if (grade(student?.result?.final) === null) return 'Pendente';
    return student?.status === 'Encerrada' || (student?.status !== 'Provisório' && board?.sealed) ? 'Encerrada' : 'Provisório';
  }

  function summary(boards) {
    const source = list(boards), records = studentsOf(source);
    const finals = records.map(({ student }) => grade(student?.result?.final));
    const elapsed = source.filter(board => !board?.unassigned).map(board => number(board?.elapsedMs)).filter(value => value !== null);
    return {
      boardCount: source.filter(board => !board?.unassigned).length,
      studentCount: records.length,
      pendingCount: finals.filter(value => value === null).length,
      officialCount: records.filter(({ board, student }) => grade(student?.result?.final) !== null && statusOf(board, student) === 'Encerrada').length,
      provisionalCount: records.filter(({ board, student }) => grade(student?.result?.final) !== null && statusOf(board, student) === 'Provisório').length,
      unassignedCount: records.filter(({ board, student }) => board?.unassigned || student?.status === 'Sem banca').length,
      meanFinal: mean(finals),
      meanBanca: mean(records.map(({ student }) => grade(student?.result?.banca))),
      meanMonografia: mean(records.map(({ student }) => grade(student?.result?.entrega))),
      timedCount: elapsed.length,
      meanElapsedMs: mean(elapsed)
    };
  }

  function charts(boards) {
    const source = list(boards), records = studentsOf(source);
    const students = source.flatMap((board, boardIndex) => list(board?.students).map((student, studentIndex) => ({
      label: [studentLabel(student, studentIndex), boardLabel(board, boardIndex), clean(board?.className), clean(board?.courseName), Number.isInteger(board?.academicYear) ? `Ano ${board.academicYear}` : '', statusOf(board, student)].filter(Boolean).join(' · '),
      values: ['banca', 'entrega', 'final'].map(key => grade(student?.result?.[key]))
    })));
    const criteria = CRITERIA.map(([key, label]) => {
      const values = records.flatMap(({ student }) => list(student?.evaluators).map(evaluator => grade(evaluator?.[key]))).filter(value => value !== null);
      return { label: `${label} · ${values.length} ${values.length === 1 ? 'nota salva' : 'notas salvas'}`, values: [mean(values)] };
    });
    const durations = source.flatMap((board, index) => board?.unassigned ? [] : [{
      label: [boardLabel(board, index), clean(board?.className), clean(board?.courseName), Number.isInteger(board?.academicYear) ? `Ano ${board.academicYear}` : ''].filter(Boolean).join(' · '),
      values: [number(board?.elapsedMs), number(board?.plannedMs)]
    }]);
    const maximumDuration = durations.flatMap(row => row.values).reduce((maximum, value) => value === null ? maximum : Math.max(maximum, value), 60000);
    return [
      {
        id: 'coordinator-student-grades', title: 'Notas de todos os alunos',
        subtitle: 'Média da banca e monografia e entregas na escala de 0 a 10. Resultado calculado = banca × 60% + monografia e entregas × 40%. O rótulo identifica resultados provisórios e bancas encerradas; campos pendentes permanecem ausentes. Inclui turmas arquivadas e alunos sem banca presentes na consulta.',
        max: 10, unit: 'grade', mode: 'grouped',
        series: [{ label: 'Média da banca', color: COLORS[0] }, { label: 'Monografia e entregas', color: COLORS[1] }, { label: 'Resultado calculado', color: COLORS[2] }],
        rows: students
      },
      {
        id: 'coordinator-saved-criteria', title: 'Médias dos critérios registrados',
        subtitle: 'Cada média usa somente as notas salvas válidas do respectivo critério, de todos os alunos e avaliadores da consulta. A quantidade de notas usada está no rótulo. Uma avaliação incompleta contribui apenas com os critérios já preenchidos; estas médias não substituem a média da banca.',
        max: 10, unit: 'grade', mode: 'grouped',
        series: [{ label: 'Média das notas salvas', color: COLORS[0] }], rows: criteria
      },
      {
        id: 'coordinator-board-duration', title: 'Tempo de apresentação por banca',
        subtitle: 'Cronômetro registrado e intervalo reservado na agenda de cada banca. O intervalo inclui o horário completo, que pode abranger arguição e transição. Alunos sem banca não possuem duração de apresentação.',
        max: maximumDuration, unit: 'duration', mode: 'grouped',
        series: [{ label: 'Tempo registrado', color: COLORS[0] }, { label: 'Intervalo reservado', color: COLORS[1] }], rows: durations
      }
    ];
  }

  // Quoting alone does not neutralize spreadsheet formulas. Protect textual fields
  // even when a formula prefix follows whitespace or control characters.
  function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001F\u007F\uFEFF]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvGrade(value) {
    const valid = grade(value);
    return valid === null ? '' : valid.toLocaleString('pt-BR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function csvDuration(value) {
    const valid = number(value);
    return valid === null ? '' : valid.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 4 });
  }

  function csv(boards) {
    const rows = [[
      'Curso', 'Turma', 'Grupo', 'Projeto', 'ID da banca', 'ID do aluno', 'Aluno',
      'UID do avaliador', 'Avaliador', 'Apresentação', 'Parte prática', 'Domínio do código', 'Domínio do tempo',
      'Média do avaliador', 'Média da banca', 'Monografia e entregas', 'Parcela da banca (60%)',
      'Parcela da monografia e entregas (40%)', 'Resultado calculado', 'Situação', 'Data e horário',
      'Sala', 'Orientador', 'Banca encerrada', 'Turma arquivada', 'Sem banca',
      'Tempo registrado (ms)', 'Intervalo reservado (ms)', 'Ano letivo'
    ]];
    list(boards).forEach((board, boardIndex) => list(board?.students).forEach((student, studentIndex) => {
      const evaluators = list(student?.evaluators), result = student?.result;
      (evaluators.length ? evaluators : [null]).forEach(evaluator => rows.push([
        board?.courseName, board?.className, boardLabel(board, boardIndex), board?.project,
        board?.unassigned ? '' : board?.id, student?.id, studentLabel(student, studentIndex),
        evaluator?.uid, evaluator?.name, ...CRITERIA.map(([key]) => csvGrade(evaluator?.[key])),
        csvGrade(evaluator?.mean), csvGrade(result?.banca), csvGrade(result?.entrega),
        csvGrade(result?.parcelaBanca), csvGrade(result?.parcelaEntrega), csvGrade(result?.final),
        statusOf(board, student), board?.startLabel, board?.room, board?.advisorName,
        board?.unassigned ? '' : board?.sealed ? 'Sim' : 'Não', board?.archived ? 'Sim' : 'Não',
        board?.unassigned || student?.status === 'Sem banca' ? 'Sim' : 'Não',
        board?.unassigned ? '' : csvDuration(board?.elapsedMs), board?.unassigned ? '' : csvDuration(board?.plannedMs), Number.isInteger(board?.academicYear) ? board.academicYear : ''
      ]));
    }));
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  return Object.freeze({ summary, charts, csv });
});
