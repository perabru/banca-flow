/* Anos letivos sem migração ou alteração de identificadores históricos.
 * Cadastros sem academicYear usam a data da banca, depois createdAt; registros
 * antigos sem data conservam 2026, o ano de origem do acervo do BancaFlow.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaAcademicYears = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LEGACY_YEAR = 2026, MIN_YEAR = 2000, MAX_YEAR = 9999;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const entries = value => record(value) ? Object.entries(value) : [];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const yearFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' });

  function parseYear(value) {
    if (typeof value === 'string') {
      if (!/^[0-9]{4}$/.test(value)) return null;
      value = Number(value);
    }
    return Number.isSafeInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR ? value : null;
  }
  function dateYear(value) {
    if (value instanceof Date) value = value.getTime();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8640000000000000) return null;
    try { return parseYear(yearFormat.format(new Date(value))); } catch { return null; }
  }
  function calendarYear(now = Date.now()) {
    return dateYear(now) || LEGACY_YEAR;
  }
  function newGroupYear(selected = 'todos', now = Date.now()) {
    return parseYear(selected) || calendarYear(now);
  }
  function yearOfGroup(group, boardsObject = {}) {
    if (!record(group)) return LEGACY_YEAR;
    const explicit = parseYear(group.academicYear);
    if (explicit !== null) return explicit;
    // O modelo mantém uma banca por grupo. A ordem por data é determinística
    // também quando um acervo antigo contém mais de um vínculo para o grupo.
    const matching = typeof group.id === 'string' && group.id ? entries(boardsObject)
      .filter(([, board]) => record(board) && board.groupId === group.id && dateYear(board.startAt) !== null)
      .sort(([aId, a], [bId, b]) => a.startAt - b.startAt || (aId < bId ? -1 : aId > bId ? 1 : 0)) : [];
    return matching.length ? dateYear(matching[0][1].startAt) : dateYear(group.createdAt) || LEGACY_YEAR;
  }
  function yearOfBoard(board, group) {
    return parseYear(record(group) ? group.academicYear : null) || dateYear(record(board) ? board.startAt : null) || dateYear(record(group) ? group.createdAt : null) || LEGACY_YEAR;
  }
  function years(groupsObject = {}, boardsObject = {}, now = Date.now()) {
    const result = new Set([calendarYear(now)]);
    for (const [id, group] of entries(groupsObject)) {
      if (!record(group)) continue;
      result.add(yearOfGroup(typeof group.id === 'string' && group.id ? group : { ...group, id }, boardsObject));
    }
    for (const [, board] of entries(boardsObject)) {
      if (!record(board)) continue;
      const group = typeof board.groupId === 'string' && own(groupsObject, board.groupId) ? groupsObject[board.groupId] : null;
      result.add(yearOfBoard(board, group));
    }
    return [...result].sort((a, b) => b - a);
  }
  function matchesGroup(group, boardsObject = {}, selected = 'todos') {
    const year = parseYear(selected);
    return year === null || yearOfGroup(group, boardsObject) === year;
  }
  function matchesBoard(board, group, selected = 'todos') {
    const year = parseYear(selected);
    return year === null || yearOfBoard(board, group) === year;
  }
  // Compatibilidade temporária com regras anteriores que ainda recusam o novo
  // campo. Só remove um campo novo quando a mesma classificação já é inferível;
  // jamais apaga um academicYear existente nem transforma um ano futuro em atual.
  function legacyGroupWrite(candidate, { previous, boards = {}, serverTime = Date.now() } = {}) {
    if (!record(candidate) || !own(candidate, 'academicYear') || (record(previous) && own(previous, 'academicYear'))) return null;
    const year = parseYear(candidate.academicYear);
    if (year === null) return null;
    const result = { ...candidate }; delete result.academicYear;
    const inferred = { ...result };
    if (record(inferred.createdAt) && inferred.createdAt['.sv'] === 'timestamp') {
      // A gravação usa o relógio do servidor. Perto da virada, não presumimos em
      // qual ano um pedido lento será confirmado; a regra nova é necessária.
      if (typeof serverTime !== 'number' || !Number.isFinite(serverTime) || dateYear(serverTime - 86400000) !== year || dateYear(serverTime + 86400000) !== year) return null;
      inferred.createdAt = serverTime;
    }
    return yearOfGroup(inferred, boards) === year ? result : null;
  }
  function renderYearSelector(options = {}) {
    const selected = parseYear(options.selected), current = parseYear(options.currentYear) || calendarYear();
    const choices = new Set([current, ...(current < MAX_YEAR ? [current + 1] : [])]);
    for (const value of Array.isArray(options.years) ? options.years : []) { const year = parseYear(value); if (year !== null) choices.add(year); }
    if (selected !== null) choices.add(selected);
    const label = selected === null ? 'Todo o histórico disponível.' : `Consultando o ano letivo de ${selected}.`;
    return `<div class="academic-year-control"><label for="academic-year-filter">Ano letivo</label><select id="academic-year-filter" name="academicYear" aria-describedby="academic-year-help"><option value="todos"${selected === null ? ' selected' : ''}>Todos os anos</option>${[...choices].sort((a, b) => b - a).map(year => `<option value="${year}"${selected === year ? ' selected' : ''}>${year}</option>`).join('')}</select><p id="academic-year-help" class="tiny muted">${esc(label)} Os registros dos outros anos permanecem salvos.</p></div>`;
  }
  return Object.freeze({ LEGACY_YEAR, MIN_YEAR, MAX_YEAR, parseYear, calendarYear, newGroupYear, yearOfGroup, yearOfBoard, years, matchesGroup, matchesBoard, legacyGroupWrite, renderYearSelector });
});
