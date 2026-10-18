/* Banca Flow roster import. SheetJS is vendored separately; no file is uploaded to a service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BancaFlowImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, rows: 10000, columns: 200, groups: 1000, students: 20 });
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const clean = value => String(value ?? '').replace(/\u0000/g, '').trim().replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ');
  const identity = group => [group.courseName || '', group.className, group.name].map(normalize).join('|');
  const aliases = {
    courseName: ['curso', 'nome do curso', 'course'],
    className: ['turma', 'classe', 'class', 'class name'],
    name: ['grupo', 'nome do grupo', 'numero do grupo', 'group', 'group name'],
    title: ['titulo', 'titulo do projeto', 'nome do projeto', 'projeto', 'tcc', 'title'],
    advisor: ['orientador', 'professor orientador', 'email do orientador', 'e mail do orientador', 'advisor', 'advisor uid', 'chave do orientador'],
    student: ['aluno', 'aluna', 'nome do aluno', 'nome da aluna', 'estudante', 'student']
  };
  function headerKind(value) {
    const name = normalize(value);
    for (const [key, values] of Object.entries(aliases)) if (values.includes(name)) return key;
    if (/^(?:aluno|aluna|estudante|student)\s*\d+$/.test(name)) return 'student';
    return '';
  }
  function detectHeader(rows) {
    for (let index = 0; index < Math.min(rows.length, 20); index++) {
      const found = rows[index].map(headerKind);
      if (['name', 'className', 'advisor', 'student'].every(key => found.includes(key))) return index;
    }
    return rows.findIndex(row => row.some(value => clean(value)));
  }
  function resolveAdvisor(value, users) {
    const source = clean(value), token = normalize(source), email = source.toLowerCase();
    const candidates = Object.entries(users || {}).filter(([uid, user]) => user && user.active !== false && ['teacher', 'coordinator'].includes(user.role) &&
      (uid === source || (user.email && user.email.toLowerCase() === email) || [user.key, user.name].some(item => item && normalize(item) === token)));
    if (candidates.length !== 1) return { error: candidates.length ? `Orientador “${source}” é ambíguo. Use o e-mail, identificador ou UID exclusivo.` : `Orientador “${source}” não encontrado entre os professores ativos. Cadastre ou reative o professor primeiro.` };
    return { uid: candidates[0][0], name: candidates[0][1].name };
  }
  function parseRows(rows, { users = {}, existingGroups = {}, defaultCourse = '' } = {}) {
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw Error('A planilha não contém uma tabela válida.');
    if (rows.length > LIMITS.rows + 20 || rows.some(row => row.length > LIMITS.columns)) throw Error('A planilha excede o limite de 10.000 linhas ou 200 colunas.');
    const headerIndex = detectHeader(rows), errors = [], warnings = [], groups = [], skipped = [];
    if (headerIndex < 0) return { groups, skipped, errors: ['A planilha está vazia.'], warnings, studentCount: 0, rowCount: 0 };
    const headers = rows[headerIndex].map(headerKind), columns = {};
    headers.forEach((kind, index) => { if (!kind) return; (columns[kind] ||= []).push(index); });
    for (const key of ['className', 'name', 'title', 'advisor', 'student']) {
      if (!columns[key]?.length) errors.push(`Cabeçalho obrigatório ausente: ${{ className: 'Turma', name: 'Grupo', title: 'Título', advisor: 'Orientador', student: 'Aluno (ou Aluno 1, Aluno 2...)' }[key]}.`);
    }
    if (!columns.courseName?.length && !clean(defaultCourse)) errors.push('Inclua a coluna Curso ou informe o curso no campo acima.');
    for (const key of ['courseName', 'className', 'name', 'title', 'advisor']) if (columns[key]?.length > 1) errors.push(`Há mais de uma coluna para ${key === 'advisor' ? 'Orientador' : key === 'courseName' ? 'Curso' : key === 'className' ? 'Turma' : key === 'name' ? 'Grupo' : 'Título'}. Mantenha somente uma.`);
    if (errors.length) return { groups, skipped, errors, warnings, studentCount: 0, rowCount: 0 };
    const grouped = new Map();
    let rowCount = 0;
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row.some(value => clean(value))) continue;
      rowCount++;
      const line = r + 1, read = key => clean(row[columns[key]?.[0]]);
      const group = { courseName: read('courseName') || clean(defaultCourse), className: read('className'), name: read('name'), title: read('title') };
      const advisorRaw = read('advisor');
      const students = columns.student.map(column => clean(row[column])).filter(Boolean);
      const problems = [];
      for (const [key, label, max] of [['courseName', 'Curso', 120], ['className', 'Turma', 80], ['name', 'Grupo', 100], ['title', 'Título', 300]]) {
        if (!group[key]) problems.push(`${label} está vazio`);
        else if (group[key].length > max) problems.push(`${label} ultrapassa ${max} caracteres`);
      }
      if (!advisorRaw) problems.push('Orientador está vazio');
      if (!students.length) problems.push('informe pelo menos um Aluno');
      if (students.some(name => name.length > 120)) problems.push('nome de aluno ultrapassa 120 caracteres');
      const resolved = advisorRaw ? resolveAdvisor(advisorRaw, users) : {};
      if (resolved.error) problems.push(resolved.error);
      if (problems.length) { errors.push(`Linha ${line}: ${problems.join('; ')}.`); continue; }
      group.advisorUid = resolved.uid;
      const key = identity(group);
      let entry = grouped.get(key);
      if (entry && (entry.group.title !== group.title || entry.group.advisorUid !== group.advisorUid)) {
        errors.push(`Linha ${line}: o mesmo curso, turma e grupo tem título ou orientador diferente da linha ${entry.line}.`); continue;
      }
      if (!entry) { entry = { group, names: new Map(), line, lines: [] }; grouped.set(key, entry); }
      entry.lines.push(line);
      for (const name of students) {
        const token = normalize(name);
        if (!token) { errors.push(`Linha ${line}: nome de aluno inválido.`); continue; }
        if (entry.names.has(token)) errors.push(`Linha ${line}: aluno “${name}” repetido no grupo. Remova a repetição ou diferencie nomes de alunos homônimos.`);
        else entry.names.set(token, name);
      }
      if (entry.names.size > LIMITS.students) errors.push(`Linha ${line}: o grupo ultrapassa o limite de ${LIMITS.students} alunos.`);
    }
    if (!rowCount) errors.push('Não há alunos abaixo do cabeçalho.');
    if (rowCount > LIMITS.rows) errors.push('A planilha excede o limite de 10.000 linhas de dados.');
    if (grouped.size > LIMITS.groups) errors.push(`Importe no máximo ${LIMITS.groups} grupos por arquivo.`);
    const existing = new Map();
    for (const group of Object.values(existingGroups || {})) {
      if (!group || !group.name || !group.className) continue;
      const key = identity(group); (existing.get(key) || (existing.set(key, []), existing.get(key))).push(group);
    }
    for (const [key, entry] of grouped) {
      // Stable IDs depend on sorted names, so reordering spreadsheet rows has no effect.
      const names = [...entry.names].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const group = { ...entry.group, students: Object.fromEntries(names.map(([, name], i) => [`s${String(i + 1).padStart(3, '0')}`, name])), active: true };
      if (existing.has(key)) skipped.push({ ...group, reason: existing.get(key).some(g => g.active === false) ? 'Já existe, inclusive no arquivo de grupos removidos' : 'Já cadastrado', lines: entry.lines });
      else groups.push({ ...group, lines: entry.lines });
    }
    if (skipped.length) warnings.push(`${skipped.length} grupo(s) já cadastrado(s) serão preservados e não serão importados novamente.`);
    return { groups, skipped, errors, warnings, studentCount: groups.reduce((sum, group) => sum + Object.keys(group.students).length, 0), rowCount, headerRow: headerIndex + 1 };
  }
  function validateFile(file) {
    if (!file || !/\.(xlsx|xls|csv)$/i.test(file.name || '')) throw Error('Selecione um arquivo .xlsx, .xls ou .csv.');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > LIMITS.fileBytes) throw Error('Selecione um arquivo não vazio de até 5 MB.');
  }
  function readWorkbook(bytes, XLSX, filename = '') {
    if (!XLSX?.read || XLSX.version !== '0.20.3') throw Error('A biblioteca local de Excel não carregou. Recarregue a página e tente novamente.');
    if (!bytes || bytes.byteLength > LIMITS.fileBytes) throw Error('O arquivo excede o limite de 5 MB.');
    // Formulae and macros are never evaluated. Formula cells in the imported table are rejected below.
    let workbook;
    try { workbook = XLSX.read(bytes, { type: 'array', sheetRows: LIMITS.rows + 21, cellFormula: true, cellHTML: false, cellText: false, bookVBA: false, raw: true, ...( /\.csv$/i.test(filename) ? { codepage: 65001 } : {} ) }); }
    catch { throw Error('Não foi possível ler o arquivo. Salve uma cópia sem senha no formato .xlsx ou CSV UTF-8 e tente novamente.'); }
    if (!workbook.SheetNames?.length) throw Error('Nenhuma aba encontrada no arquivo.');
    if (workbook.SheetNames.length > 100) throw Error('Use um arquivo com até 100 abas.');
    return workbook;
  }
  function readSheet(workbook, sheetName, XLSX) {
    const sheet = workbook?.Sheets?.[sheetName];
    if (!sheet || !workbook.SheetNames.includes(sheetName)) throw Error('Selecione uma aba válida.');
    if (!sheet['!ref']) return [];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    if (range.e.r >= LIMITS.rows + 20 || range.e.c >= LIMITS.columns) throw Error('A aba excede o limite de 10.000 linhas ou 200 colunas.');
    const formula = Object.entries(sheet).find(([key, cell]) => key[0] !== '!' && cell?.f);
    if (formula) throw Error(`A célula ${formula[0]} contém uma fórmula. Cole somente os valores antes de importar.`);
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
    return data;
  }
  function templateCsv(advisor = 'email-do-orientador@univap.br') {
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['Curso', 'Turma', 'Grupo', 'Título', 'Orientador', 'Aluno'],
      ['Análise e Desenvolvimento de Sistemas', '3A', 'Grupo 01', 'Título do projeto', advisor, 'Nome completo do aluno 1'],
      ['Análise e Desenvolvimento de Sistemas', '3A', 'Grupo 01', 'Título do projeto', advisor, 'Nome completo do aluno 2']
    ];
    return '\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n') + '\r\n';
  }
  return Object.freeze({ LIMITS, normalize, identity, headerKind, detectHeader, resolveAdvisor, parseRows, validateFile, readWorkbook, readSheet, templateCsv });
});
