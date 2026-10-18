/* BancaFlow analytics: pure calculations and accessible, dependency-free SVG charts. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLORS = Object.freeze(['#174B8E', '#087F8C', '#B4223B', '#7356A6', '#A76A10', '#407B50']);
  const CRITERIA = Object.freeze([
    ['presentation', 'Apresentação'], ['practice', 'Parte prática'],
    ['code', 'Domínio do código'], ['time', 'Domínio do tempo']
  ]);
  const MAX_ROWS = 8;
  let renderSequence = 0;

  const clean = value => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const list = value => Array.isArray(value) ? value : [];
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const grade = value => number(value) !== null && value <= 10 ? value : null;
  const mean = values => {
    const known = values.filter(value => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
  };
  const fmtGrade = value => value === null ? 'Não disponível' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function formatDuration(value) {
    if (number(value) === null) return 'Não registrado';
    const centiseconds = Math.floor(value / 10);
    const cs = centiseconds % 100, seconds = Math.floor(centiseconds / 100) % 60;
    const minutes = Math.floor(centiseconds / 6000) % 60, hours = Math.floor(centiseconds / 360000);
    const pad = number => String(number).padStart(2, '0');
    return `${hours ? pad(hours) + ':' : ''}${pad(minutes)}:${pad(seconds)},${pad(cs)}`;
  }

  function axisDuration(value, maximum) {
    const divisor = maximum >= 3600000 ? 3600000 : maximum >= 60000 ? 60000 : 1000;
    return (value / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }

  function durationMax(values) {
    let largest = 0;
    for (const value of values) if (number(value) !== null) largest = Math.max(largest, value);
    if (!largest) return 60000;
    const divisor = largest >= 3600000 ? 3600000 : largest >= 60000 ? 60000 : 1000;
    const rawStep = largest / divisor / 4;
    const scale = 10 ** Math.floor(Math.log10(rawStep));
    const multiple = [1, 2, 2.5, 5, 10].find(item => item * scale >= rawStep) || 10;
    const step = multiple * scale;
    return step * 4 * divisor;
  }

  function boardLabel(board, index) {
    return [clean(board?.label) || `Banca ${index + 1}`, clean(board?.className), clean(board?.courseName)].filter(Boolean).join(' · ');
  }

  function summary(boards) {
    const source = list(boards), students = source.flatMap(board => list(board?.students));
    const elapsed = source.map(board => number(board?.elapsedMs)).filter(value => value !== null);
    return {
      boardCount: source.length,
      studentCount: students.length,
      meanFinal: mean(students.map(student => grade(student?.result?.final))),
      meanElapsedMs: mean(elapsed),
      timedCount: elapsed.length
    };
  }

  function overview(boards) {
    const source = list(boards);
    const gradeRows = source.map((board, index) => ({
      label: boardLabel(board, index),
      values: ['banca', 'entrega', 'final'].map(key => mean(list(board?.students).map(student => grade(student?.result?.[key]))))
    }));
    const timeRows = source.map((board, index) => ({
      label: boardLabel(board, index), values: [number(board?.elapsedMs), number(board?.plannedMs)]
    }));
    const studentRows = source.flatMap((board, index) => list(board?.students).map((student, studentIndex) => ({
      label: `${clean(student?.name) || `Aluno(a) ${studentIndex + 1}`} · ${boardLabel(board, index)}`,
      values: [grade(student?.result?.parcelaBanca), grade(student?.result?.parcelaEntrega)]
    })));
    return [
      {
        id: 'overview-grades', title: 'Notas por banca',
        subtitle: 'Médias dos alunos com resultado disponível, na escala de 0 a 10. Banca e entregas são exibidas antes da ponderação.',
        max: 10, unit: 'grade', mode: 'grouped',
        series: [{ label: 'Média da banca', color: COLORS[0] }, { label: 'Entregas', color: COLORS[1] }, { label: 'Nota final', color: COLORS[2] }], rows: gradeRows
      },
      {
        id: 'overview-duration', title: 'Tempo de apresentação',
        subtitle: 'Tempo registrado no cronômetro versus intervalo reservado na agenda. O intervalo é o horário completo da banca e pode incluir arguição e transição.',
        max: durationMax(timeRows.flatMap(row => row.values)), unit: 'duration', mode: 'grouped',
        series: [{ label: 'Tempo registrado', color: COLORS[0] }, { label: 'Intervalo reservado', color: COLORS[1] }], rows: timeRows
      },
      {
        id: 'overview-weighted', title: 'Composição da nota final por aluno',
        subtitle: 'Cada barra soma a parcela da banca (60%, até 6 pontos) e das entregas (40%, até 4 pontos). Total na escala de 0 a 10.',
        max: 10, unit: 'grade', mode: 'stacked',
        series: [{ label: 'Banca × 60%', color: COLORS[0] }, { label: 'Entregas × 40%', color: COLORS[1] }], rows: studentRows
      }
    ];
  }

  function details(board) {
    if (!board || typeof board !== 'object') return [];
    const students = list(board.students), label = clean(board.label) || 'Banca';
    const specs = [{
      id: `${clean(board.id) || 'board'}-students`, title: `Notas individuais · ${label}`,
      subtitle: 'Comparação de cada aluno: média da banca, entregas antes da ponderação e nota final (banca × 60% + entregas × 40%).',
      max: 10, unit: 'grade', mode: 'grouped',
      series: [{ label: 'Média da banca', color: COLORS[0] }, { label: 'Entregas', color: COLORS[1] }, { label: 'Nota final', color: COLORS[2] }],
      rows: students.map((student, index) => ({ label: clean(student?.name) || `Aluno(a) ${index + 1}`, values: ['banca', 'entrega', 'final'].map(key => grade(student?.result?.[key])) }))
    }];
    for (let index = 0; index < students.length; index++) {
      const student = students[index], evaluators = list(student?.evaluators);
      specs.push({
        id: `${clean(board.id) || 'board'}-${clean(student?.id) || index}-criteria`,
        title: `Notas dos avaliadores · ${clean(student?.name) || `Aluno(a) ${index + 1}`}`,
        subtitle: 'Notas individuais salvas em cada critério, sem ponderação. Escala fixa de 0 a 10 para facilitar a comparação.',
        max: 10, unit: 'grade', mode: 'grouped',
        series: evaluators.map((evaluator, evaluatorIndex) => ({ label: clean(evaluator?.name) || `Avaliador ${evaluatorIndex + 1}`, color: COLORS[evaluatorIndex % COLORS.length] })),
        rows: CRITERIA.map(([key, criterion]) => ({ label: criterion, values: evaluators.map(evaluator => grade(evaluator?.[key])) }))
      });
    }
    return specs;
  }

  function wrapLabel(value, limit = 46) {
    // Conservative em estimates also handle a single unbroken name or wide glyphs.
    const charWidth = char => /[\u0300-\u036f]/.test(char) ? 0 : /[MW@#%]/.test(char) ? 1 : /[mw]/.test(char) ? .85 : /[ilI.,:;'!|]/.test(char) ? .3 : /[A-Z0-9]/.test(char) ? .68 : /\s/.test(char) ? .34 : char.codePointAt(0) > 0x2FFF ? 1.05 : .57;
    const width = text => Array.from(text).reduce((sum, char) => sum + charWidth(char), 0);
    const maximum = limit * .55;
    const words = clean(value).split(' '), lines = [];
    let line = '';
    for (const word of words) {
      if (width(word) > maximum) {
        if (line) { lines.push(line); line = ''; }
        for (const char of Array.from(word)) {
          if (line && width(line + char) > maximum) { lines.push(line); line = ''; }
          line += char;
        }
      } else if (width(line + (line ? ' ' : '') + word) > maximum) {
        if (line) lines.push(line);
        line = word;
      } else line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['Sem identificação'];
  }

  function renderChart(spec) {
    if (!spec || typeof spec !== 'object') return '';
    const unit = spec.unit === 'duration' ? 'duration' : 'grade';
    const mode = spec.mode === 'stacked' ? 'stacked' : 'grouped';
    const parse = unit === 'duration' ? number : grade;
    const series = list(spec.series).map((item, index) => ({
      label: clean(item?.label) || `Série ${index + 1}`,
      color: /^#[0-9a-f]{6}$/i.test(item?.color || '') ? item.color : COLORS[index % COLORS.length]
    }));
    const source = list(spec.rows).map(row => ({ label: clean(row?.label) || 'Sem identificação', values: series.map((_, index) => parse(row?.values?.[index])) }));
    const max = unit === 'grade' ? 10 : Math.max(number(spec.max) || 0, durationMax(source.flatMap(row => row.values)));
    const title = clean(spec.title) || 'Gráfico da banca';
    const subtitle = clean(spec.subtitle);
    const id = (clean(spec.id) || 'chart').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    const sequence = ++renderSequence;
    const chunks = [];
    if (!source.length || !series.length) chunks.push([]);
    else for (let index = 0; index < source.length; index += MAX_ROWS) chunks.push(source.slice(index, index + MAX_ROWS));
    return chunks.map((rows, chunkIndex) => {
      const uid = `ba-${id}-${sequence}-${chunkIndex}`;
      const suffix = chunks.length > 1 ? ` · Parte ${chunkIndex + 1} de ${chunks.length}` : '';
      const figureTitle = title + suffix;
      const format = unit === 'duration' ? formatDuration : fmtGrade;
      const legend = series.map(item => `<li><svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="3" fill="${item.color}"/></svg><span>${esc(item.label)}</span></li>`).join('');
      let body = '<p class="ba-chart-empty">Sem dados disponíveis para este gráfico.</p>';
      if (rows.length) {
        // A narrow viewBox and labels above each row keep charts legible on phones.
        const width = 360, left = 12, plotWidth = 232, valueX = 348;
        const rowLayouts = rows.map(row => {
          const labels = wrapLabel(row.label, 32);
          const breakdown = mode === 'stacked' ? wrapLabel(series.map((item, index) => `${item.label}: ${row.values[index] === null ? '—' : format(row.values[index])}`).join(' · '), 36) : [];
          const barsHeight = mode === 'stacked' ? 27 : series.length * 31;
          return { row, labels, breakdown, height: labels.length * 23 + barsHeight + breakdown.length * 22 + 30 };
        });
        const height = rowLayouts.reduce((sum, row) => sum + row.height, 68);
        let svg = `<svg class="ba-chart-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-labelledby="${uid}-title ${uid}-desc" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif">`;
        svg += `<title id="${uid}-title">${esc(figureTitle)}</title><desc id="${uid}-desc">${esc(subtitle)} ${unit === 'grade' ? 'Eixo fixo de 0 a 10.' : 'Valores de duração em minutos, segundos e centésimos.'} Dados exatos disponíveis na tabela após o gráfico. Traço indica dado ausente.</desc>`;
        if (unit === 'duration') svg += `<text x="${left + plotWidth}" y="10" text-anchor="end" fill="#526277" font-size="13">${max >= 3600000 ? 'horas' : max >= 60000 ? 'minutos' : 'segundos'}</text>`;
        for (let tick = 0; tick <= 4; tick++) {
          const value = max * tick / 4, x = left + plotWidth * tick / 4;
          const label = unit === 'duration' ? axisDuration(value, max) : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
          svg += `<line x1="${x}" x2="${x}" y1="40" y2="${height - 15}" stroke="#DCE5EF" stroke-dasharray="3 5"/><text x="${x}" y="25" text-anchor="${tick === 0 ? 'start' : 'middle'}" fill="#526277" font-size="17">${esc(label)}</text>`;
        }
        svg += `<text x="${valueX}" y="25" text-anchor="end" fill="#526277" font-size="15">${unit === 'grade' ? 'Nota' : 'Tempo'}</text>`;
        let y = 58;
        rowLayouts.forEach(({ row, labels, breakdown, height: rowHeight }) => {
          const top = y;
          labels.forEach((line, index) => { svg += `<text x="${left}" y="${y + index * 23}" fill="#18324E" font-size="18" font-weight="650">${esc(line)}</text>`; });
          y += labels.length * 23 + 3;
          if (mode === 'grouped') {
            row.values.forEach((value, index) => {
              svg += `<rect x="${left}" y="${y - 2}" width="${plotWidth}" height="19" rx="5" fill="#EDF2F7"/>`;
              if (value !== null) {
                const barWidth = Math.min(value / max, 1) * plotWidth;
                if (value === 0) svg += `<circle cx="${left + 2}" cy="${y + 7.5}" r="3" fill="${series[index].color}"/>`;
                else svg += `<rect x="${left}" y="${y - 2}" width="${barWidth.toFixed(3)}" height="19" rx="5" fill="${series[index].color}"/>`;
              }
              svg += `<text x="${valueX}" y="${y + 13}" text-anchor="end" fill="${value === null ? '#687586' : '#18324E'}" font-size="17" font-weight="650">${value === null ? '—' : esc(format(value))}</text>`;
              y += 31;
            });
          } else {
            svg += `<rect x="${left}" y="${y - 2}" width="${plotWidth}" height="22" rx="5" fill="#EDF2F7"/>`;
            let offset = 0;
            row.values.forEach((value, index) => {
              if (value === null) return;
              const barWidth = Math.max(0, Math.min(value / max * plotWidth, plotWidth - offset));
              if (barWidth > 0) svg += `<rect x="${(left + offset).toFixed(3)}" y="${y - 2}" width="${barWidth.toFixed(3)}" height="22" fill="${series[index].color}"/>`;
              offset += barWidth;
            });
            const complete = row.values.every(value => value !== null);
            const total = complete ? row.values.reduce((sum, value) => sum + value, 0) : null;
            if (total === 0) svg += `<circle cx="${left + 2}" cy="${y + 9}" r="3" fill="${series[0].color}"/>`;
            svg += `<text x="${valueX}" y="${y + 15}" text-anchor="end" fill="#18324E" font-size="18" font-weight="700">${total === null ? 'Pendente' : esc(format(total))}</text>`;
            y += 36;
            breakdown.forEach((line, index) => { svg += `<text x="${left}" y="${y + index * 22}" fill="#526277" font-size="16">${esc(line)}</text>`; });
          }
          y = top + rowHeight;
        });
        svg += '</svg>';
        const table = `<details class="ba-chart-data"><summary>Ver dados exatos do gráfico</summary><div class="ba-chart-table-wrap" role="region" aria-label="${esc(figureTitle)} — dados" tabindex="0"><table><caption>${esc(figureTitle)}</caption><thead><tr><th scope="col">${unit === 'duration' ? 'Banca' : 'Identificação'}</th>${series.map(item => `<th scope="col">${esc(item.label)}</th>`).join('')}${mode === 'stacked' ? '<th scope="col">Total</th>' : ''}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${esc(row.label)}</th>${row.values.map(value => `<td>${esc(format(value))}</td>`).join('')}${mode === 'stacked' ? `<td>${row.values.every(value => value !== null) ? esc(format(row.values.reduce((sum, value) => sum + value, 0))) : 'Pendente'}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
        body = svg + table;
      }
      return `<figure class="ba-chart" data-chart-id="${esc(spec.id || 'chart')}"><figcaption><h3 class="ba-chart-heading">${esc(figureTitle)}</h3>${subtitle ? `<p class="ba-chart-caption">${esc(subtitle)}</p>` : ''}</figcaption>${series.length ? `<ul class="ba-chart-legend" aria-label="Legenda">${legend}</ul>` : ''}${body}<p class="ba-chart-footnote">— indica dado ausente. Zero é uma nota ou duração válida.${unit === 'duration' ? ' Tempos exatos: minutos:segundos,centésimos (horas quando necessário).' : ''}</p></figure>`;
    }).join('');
  }

  return Object.freeze({ COLORS, MAX_ROWS, summary, overview, details, renderChart, formatDuration });
});
