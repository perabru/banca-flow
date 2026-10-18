/* Selectable, resolution-independent report charts. No network or raster assets. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaAnalyticsPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['#174B8E', '#087F8C', '#B4223B', '#7354A3', '#A87508', '#457E4C'];
  const INK = '#17365C', MUTED = '#60738A', GRID = '#DDE5EF', PAPER = '#F3F7FC';
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const color = (value, index) => /^#[\da-f]{6}$/i.test(value || '') ? value : COLORS[index % COLORS.length];
  function duration(value) {
    if (!valid(value)) return 'Não registrado';
    const ticks = Math.floor(value / 10);
    return String(Math.floor(ticks / 6000)).padStart(2, '0') + ':' + String(Math.floor(ticks / 100) % 60).padStart(2, '0') + ',' + String(ticks % 100).padStart(2, '0');
  }
  function grade(value) { return valid(value) ? value.toFixed(2).replace('.', ',') : 'Não registrado'; }
  function format(value, unit) { return unit === 'duration' ? duration(value) : grade(value); }
  function normalize(spec) {
    const input = spec || {}, unit = input.unit === 'duration' ? 'duration' : 'grade';
    const series = (Array.isArray(input.series) ? input.series : []).map((item, index) => ({
      label: String(item?.label || `Série ${index + 1}`), color: color(item?.color, index), key: String(index + 1).padStart(2, '0')
    }));
    const rows = (Array.isArray(input.rows) ? input.rows : []).map(row => ({
      label: String(row?.label ?? 'Não informado'), values: series.map((_, i) => valid(row?.values?.[i]) && (unit === 'duration' || row.values[i] <= 10) ? row.values[i] : null)
    }));
    const mode = input.mode === 'stacked' ? 'stacked' : 'grouped';
    let maximum = 0;
    for (const row of rows) {
      const values = row.values.filter(valid);
      maximum = Math.max(maximum, mode === 'stacked' ? values.reduce((sum, value) => sum + value, 0) : Math.max(0, ...values));
    }
    return { title: String(input.title || 'Análise das avaliações'), subtitle: String(input.subtitle || ''), unit, series, rows, mode,
      max: unit === 'grade' ? 10 : Math.max(valid(input.max) ? input.max : 0, maximum, maximum ? 1 : 60000) };
  }
  function draw(pdf, specs) {
    if (!pdf || !['rect', 'text', 'wrap', 'ensure', 'newPage'].every(key => typeof pdf[key] === 'function')) throw new TypeError('O relatório não oferece os recursos necessários para desenhar gráficos.');
    if (!Array.isArray(specs)) return pdf;
    specs.forEach((input, index) => chart(pdf, normalize(input), index));
    return pdf;
  }
  function chart(pdf, spec, chartIndex) {
    const left = pdf.margin, width = pdf.width - 2 * left, bottom = pdf.bottom;
    const textWidth = width - 24, plotX = left + 35, valueWidth = 82, plotWidth = width - 35 - valueWidth - 12;
    if (plotWidth < 120) throw new RangeError('A largura do relatório é insuficiente para os gráficos.');
    const chartNumber = String(chartIndex + 1).padStart(2, '0');
    const titleLines = pdf.wrap(spec.title, width - 24, 13, true);
    const subtitleLines = spec.subtitle ? pdf.wrap(spec.subtitle, textWidth, 9) : [];
    const groupedLaneHeight = 18;
    const legend = spec.series.map(item => ({ ...item, lines: pdf.wrap(`${item.key}  ${item.label}`, width - 42, 8.6) }));
    const legendHeight = legend.reduce((total, item) => total + Math.max(15, item.lines.length * 11 + 5), 0);
    // Normal reports repeat the complete legend. Very large legends first flow in full,
    // then use numbered swatches on data pages so the header cannot consume the page.
    const compactLegend = legendHeight > 110;
    let phase = 'heading', rowContext = null, currentSeries = 0;
    const available = height => pdf.y + height <= bottom + .001;
    function line(value, x, size = 9, bold = false, fill = INK, leading = size + 4) {
      pdf.text(value, x, pdf.y, size, bold, fill); pdf.y += leading;
    }
    function continuationHeader() {
      pdf.rect(left, pdf.y + 1, 3, 18, '#174B8E');
      pdf.text(`GRÁFICO ${chartNumber} · CONTINUAÇÃO`, left + 11, pdf.y, 8, true, MUTED); pdf.y += 16;
      if (titleLines.length <= 3) {
        for (const value of titleLines) line(value, left + 11, 11, true, INK, 14);
      } else line(`Análise visual ${chartNumber}`, left + 11, 11, true, INK, 14);
      pdf.y += 5;
    }
    function drawRepeatedLegend() {
      if (!compactLegend) {
        for (const item of legend) {
          const top = pdf.y;
          pdf.rect(left + 12, top + 2, 7, 7, item.color);
          item.lines.forEach(value => line(value, left + 24, 8.6, false, MUTED, 11));
          pdf.y = top + Math.max(15, item.lines.length * 11 + 5);
        }
      } else {
        line('Séries numeradas conforme a legenda completa deste gráfico.', left + 12, 8.1, false, MUTED, 13);
        const start = Math.floor(currentSeries / 16) * 16;
        const part = legend.slice(start, start + 16);
        part.forEach((item, i) => {
          const x = left + 12 + (i % 8) * ((width - 24) / 8), y = pdf.y + Math.floor(i / 8) * 15;
          pdf.rect(x, y + 3, 7, 7, item.color); pdf.text(item.key, x + 11, y, 8.1, false, MUTED);
        });
        pdf.y += Math.ceil(part.length / 8) * 15 + 4;
      }
    }
    function axis() {
      const top = pdf.y, ticks = spec.unit === 'grade' ? [0, 2, 4, 6, 8, 10] : Array.from({ length: 5 }, (_, i) => spec.max * i / 4);
      pdf.rect(plotX, top + 13, plotWidth, .7, GRID);
      ticks.forEach((value, index) => {
        const label = spec.unit === 'grade' ? String(value) : duration(value), x = plotX + plotWidth * (value / spec.max);
        // A fixed-width slot around each tick avoids text crossing the chart margins.
        const labelWidth = Math.min(80, String(label).length * 4.5);
        const at = index === 0 ? x : index === ticks.length - 1 ? x - labelWidth : x - labelWidth / 2;
        pdf.text(label, at, top, 7.5, false, MUTED);
        pdf.rect(x, top + 10, .6, 5, GRID);
      });
      pdf.text(spec.unit === 'duration' ? 'min:seg,cc' : 'nota / 10', plotX + plotWidth + 9, top, 7.5, true, MUTED);
      pdf.y += 24;
    }
    function nextPage() {
      pdf.newPage(); continuationHeader();
      if (phase === 'data') {
        drawRepeatedLegend(); axis();
        if (rowContext) line(`Item ${rowContext} · continuação`, left + 12, 8.4, true, MUTED, 16);
      }
      if (!available(20)) throw new RangeError('O cabeçalho do relatório não deixa espaço para os gráficos.');
    }
    function reserve(height) { if (!available(height)) nextPage(); if (!available(height)) throw new RangeError('Não foi possível paginar o gráfico.'); }
    function textFlow(lines, { x = left + 12, size = 9, bold = false, fill = MUTED, leading = size + 4, background = null } = {}) {
      for (const value of lines) {
        reserve(leading);
        if (background) pdf.rect(left, pdf.y - 2, width, leading, background);
        line(value, x, size, bold, fill, leading);
      }
    }
    // Keep an ordinary chart intact when it fits a fresh report page. Large
    // charts retain streaming pagination, including huge names and legends.
    const estimatedRowsHeight = spec.rows.reduce((total, row, i) => {
      const labelHeight = pdf.wrap(`${String(i + 1).padStart(2, '0')} · ${row.label}`, textWidth, 10, true).length * 14;
      const lanesHeight = spec.mode === 'stacked' ? 23 + spec.series.length * 15 : spec.series.length * groupedLaneHeight;
      return total + 24 + labelHeight + lanesHeight;
    }, 0);
    const estimatedHeaderHeight = 17 + titleLines.length * 17 + 4 + subtitleLines.length * 13 + 8 + legendHeight;
    const estimatedHeight = estimatedHeaderHeight + (spec.series.length && spec.rows.length ? 24 + estimatedRowsHeight + 23 : 49);
    const freshCapacity = bottom - Math.max(Number.isFinite(pdf.contentTop) ? pdf.contentTop : 149, 149);
    pdf.ensure(estimatedHeight + 10 <= freshCapacity ? estimatedHeight + 10 : 125); pdf.y += 10;
    pdf.rect(left, pdf.y + 1, 3, 20, '#174B8E');
    line(`GRÁFICO ${chartNumber} · ${spec.unit === 'duration' ? 'TEMPO DE APRESENTAÇÃO' : 'NOTAS E DESEMPENHO'}`, left + 11, 8, true, MUTED, 17);
    textFlow(titleLines, { x: left + 11, size: 13, bold: true, fill: INK, leading: 17 });
    pdf.y += 4;
    if (subtitleLines.length) textFlow(subtitleLines, { leading: 13 });
    pdf.y += 8;
    phase = 'legend';
    for (const item of legend) {
      let first = true;
      for (const value of item.lines) {
        reserve(11);
        if (first) { pdf.rect(left + 12, pdf.y + 2, 7, 7, item.color); first = false; }
        line(value, left + 24, 8.6, false, MUTED, 11);
      }
      pdf.y += 5;
    }
    if (!spec.series.length || !spec.rows.length) {
      reserve(49); pdf.rect(left, pdf.y, width, 37, PAPER);
      pdf.text('Não há dados para este gráfico na seleção atual.', left + 12, pdf.y + 11, 9, false, MUTED); pdf.y += 49; return;
    }
    phase = 'data';
    if (!available(70)) nextPage(); else axis();
    spec.rows.forEach((row, rowIndex) => {
      rowContext = String(rowIndex + 1).padStart(2, '0'); currentSeries = 0;
      const background = rowIndex % 2 ? '#FFFFFF' : PAPER;
      const labelLines = pdf.wrap(`${rowContext} · ${row.label}`, textWidth, 10, true);
      const firstRowSize = 24 + labelLines.length * 14 + (spec.mode === 'stacked' ? 23 + spec.series.length * 15 : spec.series.length * groupedLaneHeight);
      // Do not split ordinary rows. Unusually large labels or series flow safely.
      const pageCapacity = bottom - (Number.isFinite(pdf.contentTop) ? pdf.contentTop : 155) - 210;
      if (!available(firstRowSize) && firstRowSize < pageCapacity) nextPage();
      reserve(20); pdf.rect(left, pdf.y, width, 7, background); pdf.y += 7;
      textFlow(labelLines, { size: 10, bold: true, fill: INK, leading: 14, background });
      pdf.y += 3;
      if (spec.mode === 'stacked') {
        drawStack(row, background);
      } else {
        row.values.forEach((value, seriesIndex) => {
          currentSeries = seriesIndex; reserve(groupedLaneHeight);
          laneBackground(background, groupedLaneHeight);
          pdf.text(spec.series[seriesIndex].key, left + 12, pdf.y + 3, 8.1, false, MUTED);
          const barTop = pdf.y + 4;
          pdf.rect(plotX, barTop, plotWidth, 10, '#E5EBF3');
          if (valid(value) && value > 0) pdf.rect(plotX, barTop, Math.min(plotWidth, plotWidth * value / spec.max), 10, spec.series[seriesIndex].color);
          pdf.text(format(value, spec.unit), plotX + plotWidth + 9, pdf.y + 2, 8.5, valid(value), valid(value) ? INK : MUTED);
          pdf.y += groupedLaneHeight;
        });
      }
      reserve(14); pdf.rect(left, pdf.y, width, 7, background); pdf.y += 7;
      pdf.rect(left, pdf.y, width, .6, GRID); pdf.y += 7;
      rowContext = null;
    });
    reserve(23);
    line(`${spec.rows.length} item(ns) · ${spec.unit === 'duration' ? 'Tempo com centésimos; ausências não equivalem a zero.' : 'Escala fixa de 0 a 10; ausências não equivalem a zero.'}`, left + 12, 7.8, false, MUTED, 16);
    pdf.y += 7;
    function laneBackground(fill, height) { pdf.rect(left, pdf.y, width, height, fill); }
    function drawStack(row, background) {
      reserve(23); laneBackground(background, 23);
      pdf.rect(plotX, pdf.y + 4, plotWidth, 12, '#E5EBF3');
      let consumed = 0;
      row.values.forEach((value, i) => {
        if (!valid(value)) return;
        const barWidth = Math.max(0, Math.min(plotWidth - consumed, plotWidth * value / spec.max));
        if (barWidth) pdf.rect(plotX + consumed, pdf.y + 4, barWidth, 12, spec.series[i].color);
        consumed += barWidth;
      });
      const complete = row.values.every(valid), sum = row.values.reduce((total, value) => total + (valid(value) ? value : 0), 0);
      pdf.text(complete ? format(sum, spec.unit) : 'Parcial', plotX + plotWidth + 9, pdf.y + 3, 8.5, true, INK); pdf.y += 23;
      row.values.forEach((value, seriesIndex) => {
        currentSeries = seriesIndex; reserve(15); laneBackground(background, 15);
        pdf.rect(left + 13, pdf.y + 4, 5, 5, spec.series[seriesIndex].color);
        pdf.text(`Série ${spec.series[seriesIndex].key}`, left + 25, pdf.y + 1, 8, false, MUTED);
        pdf.text(format(value, spec.unit), plotX + plotWidth + 9, pdf.y + 1, 8.5, valid(value), valid(value) ? INK : MUTED); pdf.y += 15;
      });
    }
  }
  return Object.freeze({ draw, formatDuration: duration });
});
