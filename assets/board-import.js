/* Importação de bancas agendadas: somente leitura até a confirmação da prévia. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaBoardImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ rows: 10000, columns: 200, boards: 500 });
  const clean = value => String(value == null ? '' : value).replace(/\u0000/g, '').replace(/[\t\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const activeTeacher = user => user && user.active !== false && ['teacher', 'coordinator'].includes(user.role);
  const aliases = {
    groupId: ['id grupo', 'id do grupo', 'codigo do grupo', 'group id'],
    group: ['grupo', 'nome do grupo', 'numero do grupo', 'group'],
    course: ['curso', 'nome do curso', 'course'],
    className: ['turma', 'classe', 'class'],
    date: ['data', 'data da banca', 'dia', 'date'],
    time: ['hora', 'horario', 'horario da banca', 'hora de inicio', 'inicio', 'time'],
    duration: ['duracao', 'duracao min', 'duracao minutos', 'duracao em minutos', 'duration'],
    room: ['sala', 'sala link', 'local', 'sala ou link', 'room']
  };
  function headerKind(value) {
    const key = normalize(value);
    for (const [kind, names] of Object.entries(aliases)) if (names.includes(key)) return kind;
    const evaluator = /^(?:avaliador|avaliadora|professor|professora|professor avaliador|membro)\s*([123])$/.exec(key);
    return evaluator ? `evaluator${evaluator[1]}` : '';
  }
  function detectHeader(rows) {
    for (let index = 0; index < Math.min(rows.length, 20); index++) {
      const keys = rows[index].map(headerKind);
      if ((keys.includes('group') || keys.includes('groupId')) && ['date', 'time', 'room'].every(key => keys.includes(key))) return index;
    }
    return rows.findIndex(row => row.some(value => clean(value)));
  }
  function calendarDate(year, month, day) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    const date = new Date(0); date.setHours(12, 0, 0, 0); date.setFullYear(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? { year, month, day } : null;
  }
  function parseDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return calendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    if (typeof value === 'number' && Number.isFinite(value)) {
      const serial = Math.floor(value);
      if (serial < 1 || serial === 60 || serial > 2958465) return null;
      const date = new Date(Date.UTC(1899, 11, 31) + (serial - (serial > 60 ? 1 : 0)) * 86400000);
      return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    const source = clean(value);
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
    if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(source);
    return match ? calendarDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
  }
  function parseTime(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
      const milliseconds = Math.round(value * 86400000);
      if (milliseconds >= 86400000 || milliseconds % 60000 !== 0) return null;
      return { hour: Math.floor(milliseconds / 3600000), minute: Math.floor(milliseconds / 60000) % 60 };
    }
    const source = clean(value), match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(source);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] && Number(match[3]) !== 0)) return null;
    return { hour: Number(match[1]), minute: Number(match[2]) };
  }
  function startTimestamp(dateValue, timeValue) {
    const date = parseDate(dateValue), time = parseTime(timeValue);
    if (!date) return { error: 'Data inválida. Use dd/mm/aaaa, aaaa-mm-dd ou uma data do Excel.' };
    if (!time) return { error: 'Hora inválida. Use HH:mm, sem segundos, ou uma hora do Excel.' };
    if (time.minute % 15) return { error: 'O horário deve estar em intervalos de 15 minutos.' };
    const result = new Date(0); result.setFullYear(date.year, date.month - 1, date.day); result.setHours(time.hour, time.minute, 0, 0);
    if (result.getFullYear() !== date.year || result.getMonth() !== date.month - 1 || result.getDate() !== date.day || result.getHours() !== time.hour || result.getMinutes() !== time.minute || result.getTime() % 900000 !== 0) return { error: 'Data e hora indisponíveis no fuso local.' };
    return { startAt: result.getTime() };
  }
  function resolveGroup(values, groups) {
    const exactId = values.groupId || (Object.hasOwn(groups, values.group) ? values.group : '');
    let matches = Object.entries(groups || {}).filter(([id, group]) => group && (exactId ? id === exactId : normalize(group.name) === normalize(values.group)));
    if (values.course) matches = matches.filter(([, group]) => normalize(group.courseName || '') === normalize(values.course));
    if (values.className) matches = matches.filter(([, group]) => normalize(group.className) === normalize(values.className));
    if (values.groupId && values.group) matches = matches.filter(([id, group]) => values.group === id || normalize(group.name) === normalize(values.group));
    if (!matches.length) return { error: 'Grupo não encontrado com os dados informados. Cadastre os grupos antes de importar as bancas.' };
    if (matches.length > 1) return { error: 'Grupo ambíguo. Informe Curso e Turma ou use a coluna ID do grupo.' };
    const [id, group] = matches[0];
    return group.active === false ? { error: 'O grupo está removido. Restaure-o antes de agendar a banca.' } : { id, group };
  }
  function resolveEvaluator(value, users) {
    const source = clean(value), token = normalize(source), email = source.toLocaleLowerCase('pt-BR');
    if (!source) return { error: 'Informe o avaliador.' };
    if (Object.hasOwn(users || {}, source)) return activeTeacher(users[source]) ? { uid: source, name: users[source].name } : { error: `Avaliador “${source}” não encontrado entre os professores e coordenadores ativos.` };
    const emailLookup = source.includes('@');
    const matches = Object.entries(users || {}).filter(([, user]) => activeTeacher(user) && (emailLookup ? String(user.email || '').toLocaleLowerCase('pt-BR') === email : [user.key, user.name].some(item => item && normalize(item) === token)));
    if (!matches.length) return { error: `Avaliador “${source}” não encontrado entre os professores e coordenadores ativos.` };
    if (matches.length > 1) return { error: `Avaliador “${source}” ambíguo. Use e-mail, identificador ou UID exclusivo.` };
    return { uid: matches[0][0], name: matches[0][1].name };
  }
  const overlaps = (a, b) => Number.isFinite(b?.startAt) && Number.isFinite(b?.durationMin) && b.durationMin > 0 && a.startAt < b.startAt + b.durationMin * 60000 && b.startAt < a.startAt + a.durationMin * 60000;
  const normalizedRoom = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
  const roomKey = value => Array.from(new TextEncoder().encode(normalizedRoom(value))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  function lockOccupied(map, board, key) {
    for (let at = Math.floor(board.startAt / 900000) * 900000; at < board.startAt + board.durationMin * 60000; at += 900000) if (map?.[at]?.[key]) return true;
    return false;
  }
  function parseRows(rows, options = {}) {
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw Error('A planilha não contém uma tabela válida.');
    if (rows.length > LIMITS.rows + 20 || rows.some(row => row.length > LIMITS.columns)) throw Error('A planilha excede o limite de 10.000 linhas ou 200 colunas.');
    const { users = {}, groups = {}, boards: savedBoards = {}, groupBoards = {}, locks = {}, roomLocks = {} } = options;
    const now = options.now === undefined ? Date.now() : options.now;
    if (!Number.isFinite(now)) throw Error('O horário de referência é inválido.');
    const errors = [], warnings = [], boards = [], headerIndex = detectHeader(rows), result = () => ({ boards: errors.length ? [] : boards, errors, warnings, rowCount, headerRow: headerIndex + 1 });
    let rowCount = 0;
    if (headerIndex < 0) { errors.push('A planilha está vazia.'); return result(); }
    const columns = {};
    rows[headerIndex].map(headerKind).forEach((key, index) => { if (key) (columns[key] ||= []).push(index); });
    const names = { date: 'Data', time: 'Hora', duration: 'Duração', room: 'Sala', evaluator1: 'Avaliador 1', evaluator2: 'Avaliador 2' };
    if (!columns.group?.length && !columns.groupId?.length) errors.push('Cabeçalho obrigatório ausente: Grupo ou ID do grupo.');
    for (const key of Object.keys(names)) if (!columns[key]?.length) errors.push(`Cabeçalho obrigatório ausente: ${names[key]}.`);
    for (const [key, indexes] of Object.entries(columns)) if (indexes.length > 1) errors.push(`Há mais de uma coluna para ${names[key] || key}. Mantenha somente uma.`);
    if (errors.length) return result();
    const existing = Object.values(savedBoards || {}), seenGroups = new Set();
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]; if (!row.some(value => clean(value))) continue;
      rowCount++; const line = rowIndex + 1, problems = [], raw = key => row[columns[key]?.[0]], read = key => clean(raw(key));
      const values = { groupId: read('groupId'), group: read('group'), course: read('course'), className: read('className') };
      if (!values.groupId && !values.group) problems.push('Informe Grupo ou ID do grupo.');
      const resolvedGroup = values.groupId || values.group ? resolveGroup(values, groups) : {};
      if (resolvedGroup.error) problems.push(resolvedGroup.error);
      const timestamp = startTimestamp(raw('date'), raw('time')); if (timestamp.error) problems.push(timestamp.error);
      else if (timestamp.startAt <= now - 60000) problems.push('A data e a hora devem estar no futuro.');
      const durationText = read('duration'), durationMin = Number(durationText);
      if (!/^\d+$/.test(durationText) || ![30, 45, 60, 90].includes(durationMin)) problems.push('A duração deve ser 30, 45, 60 ou 90 minutos.');
      const room = String(raw('room') == null ? '' : raw('room')).trim();
      if (!room || room.length > 80 || /[\u0000-\u001F\u007F]/.test(room)) problems.push('Informe uma sala ou link de até 80 caracteres, em uma única linha.');
      const evaluatorValues = ['evaluator1', 'evaluator2', 'evaluator3'].map(read);
      const evaluators = evaluatorValues.flatMap((value, index) => {
        if (!value && index === 2) return [];
        const evaluator = resolveEvaluator(value, users);
        if (evaluator.error) { problems.push(`Avaliador ${index + 1}: ${evaluator.error}`); return []; }
        return [evaluator];
      });
      if (new Set(evaluators.map(item => item.uid)).size !== evaluators.length) problems.push('Selecione dois ou três avaliadores diferentes.');
      if (resolvedGroup.id) {
        if (groupBoards[resolvedGroup.id] || existing.some(board => board?.groupId === resolvedGroup.id)) problems.push('O grupo já possui uma banca agendada. A importação não substitui bancas existentes.');
        if (seenGroups.has(resolvedGroup.id)) problems.push('O grupo aparece em mais de uma linha da planilha. Use uma única linha por banca.');
        seenGroups.add(resolvedGroup.id);
      }
      if (problems.length) { errors.push(`Linha ${line}: ${problems.join(' ')}`); continue; }
      const group = resolvedGroup.group, members = Object.fromEntries(evaluators.map(item => [item.uid, true]));
      const board = { groupId: resolvedGroup.id, advisorUid: group.advisorUid, advisorName: users[group.advisorUid]?.name || group.advisorUid, members, memberNames: Object.fromEntries(evaluators.map(item => [item.uid, item.name])), startAt: timestamp.startAt, durationMin, room, lines: [line] };
      if (!board.advisorUid || !users[board.advisorUid]) { errors.push(`Linha ${line}: O orientador do grupo não possui cadastro. Corrija o grupo antes de importar.`); continue; }
      for (const evaluator of evaluators) if ([...existing, ...boards].some(other => other?.members?.[evaluator.uid] && overlaps(board, other)) || lockOccupied(locks, board, evaluator.uid)) problems.push(`${evaluator.name} tem outra banca ou reserva no mesmo horário.`);
      if ([...existing, ...boards].some(other => normalizedRoom(other?.room) === normalizedRoom(room) && overlaps(board, other)) || lockOccupied(roomLocks, board, roomKey(room))) problems.push(`A sala ${room} já está ocupada ou reservada neste horário.`);
      if (problems.length) { errors.push(`Linha ${line}: ${problems.join(' ')}`); continue; }
      if (!members[group.advisorUid]) warnings.push(`Linha ${line}: o orientador ${board.advisorName} não participa como avaliador desta banca.`);
      boards.push(board);
    }
    if (!rowCount) errors.push('Não há bancas abaixo do cabeçalho.');
    if (rowCount > LIMITS.boards) errors.push(`Importe no máximo ${LIMITS.boards} bancas por arquivo.`);
    return result();
  }
  function readSheet(workbook, sheetName, XLSX) {
    const sheet = workbook?.Sheets?.[sheetName];
    if (!sheet || !workbook.SheetNames?.includes(sheetName) || !XLSX?.utils) throw Error('Selecione uma aba válida.');
    if (!sheet['!ref']) return [];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    if (range.e.r >= LIMITS.rows + 20 || range.e.c >= LIMITS.columns) throw Error('A aba excede o limite de 10.000 linhas ou 200 colunas.');
    const formula = Object.entries(sheet).find(([key, cell]) => key[0] !== '!' && cell?.f);
    if (formula) throw Error(`A célula ${formula[0]} contém uma fórmula. Cole somente os valores antes de importar.`);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    if (workbook.Workbook?.WBProps?.date1904 === true || workbook.Workbook?.WBProps?.date1904 === 1) {
      const header = detectHeader(rows), dateColumn = rows[header]?.findIndex(value => headerKind(value) === 'date') ?? -1;
      if (dateColumn >= 0) for (let index = header + 1; index < rows.length; index++) if (typeof rows[index][dateColumn] === 'number') rows[index][dateColumn] += 1462;
    }
    return rows;
  }
  function templateRows({ now = Date.now() } = {}) {
    const next = new Date(now); next.setDate(next.getDate() + 1);
    const date = [next.getDate(), next.getMonth() + 1, next.getFullYear()].map((value, index) => index < 2 ? String(value).padStart(2, '0') : String(value)).join('/');
    return [['Curso', 'Turma', 'Grupo', 'Data', 'Hora', 'Duração', 'Sala', 'Avaliador 1', 'Avaliador 2', 'Avaliador 3'], ['Nome do curso', 'Turma', 'Nome do grupo já cadastrado', date, '19:00', 30, 'Sala 01', 'email-do-avaliador-1@univap.br', 'email-do-avaliador-2@univap.br', '']];
  }
  function templateCsv(options) { return '\uFEFF' + templateRows(options).map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(';')).join('\r\n') + '\r\n'; }
  return Object.freeze({ LIMITS, headerKind, detectHeader, parseDate, parseTime, startTimestamp, resolveGroup, resolveEvaluator, parseRows, readSheet, templateRows, templateCsv });
});
