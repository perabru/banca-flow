/**
 * Behavior tests for the actual inline app, with in-memory DOM/Firebase adapters.
 * No network, production access, or npm dependencies: node --test tests/app.test.cjs
 * Database authorization is tested separately in rules.test.mjs with the emulator.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s.+?;\s*$/gm, '');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const grade = (presentation = 8, practice = 8, code = 8, time = 8) => ({ presentation, practice, code, time });
const fixture = () => ({
  users: {
    coord: { name: 'Alberson', email:'coord@example.test', role: 'coordinator', key: 'alberson', active: true },
    t1: { name: 'Professor Um', email:'one@example.test', key:'one', role: 'teacher', active: true },
    t2: { name: 'Professora Dois', email:'two@example.test', key:'two', role: 'teacher', active: true },
    outsider: { name: 'Outro Professor', role: 'teacher', active: true },
    disabled: { name: 'Desativado', role: 'teacher', active: false }
  },
  groups: { g1: { id: 'g1', name: 'Grupo Árvore', title: 'Projeto de TCC', className: '2A', advisorUid: 't1', students: { s1: 'Ana', s2: 'Bruno' } } },
  boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Professor Um', t2: 'Professora Dois' }, startAt: 900000, durationMin: 30, room: 'Laboratório' } },
  grades: { b1: { t1: { s1: grade(10, 8, 6, 8), s2: grade(0, 0, 0, 0) }, t2: { s1: grade(6, 6, 6, 6), s2: grade(10, 10, 10, 10) } } },
  deliveries: { b1: { s1: 9, s2: 0 } },
  seals: {}, timers: {},
});

function harness(uid = 't1') {
  let now = 1_800_000_000_000;
  const data = fixture();
  const calls = { reads: [], sets: [], updates: [], transactions: [], confirmations: [], authCreates:[], authDeletes:[], appDeletes:[] };
  const options = { confirm: true, setError: null, updateError: null, transactionError: null };
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', innerHTML: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      setAttribute() {}, focus() {}, scrollIntoView() {}, remove() {}, querySelectorAll() { return []; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(selector);
  };
  const read = path => path ? path.split('/').reduce((value, key) => value?.[key], data) : data;
  const resolveTimestamp = value => {
    if (value && typeof value === 'object') {
      if (value['.sv'] === 'timestamp') return now;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTimestamp(item)]));
    }
    return value;
  };
  const write = (path, value) => {
    const parts = path.split('/'), key = parts.pop();
    const parent = parts.reduce((obj, part) => obj[part] ||= {}, data);
    if (value === null) delete parent[key];
    else parent[key] = clone(resolveTimestamp(value));
  };
  const snapshot = value => ({ val: () => clone(value), exists: () => value !== undefined && value !== null });
  class Clock extends Date { static now() { return now; } }
  class FormDataAdapter {
    constructor(form) { this.values = form.values || {}; }
    get(key) { return this.values[key] ?? null; }
    getAll(key) { return [].concat(this.values[key] || []); }
  }
  const context = vm.createContext({
    console, Date: Clock, Blob, File, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    FormData: FormDataAdapter, URL, atob, btoa, crypto:{randomUUID:()=> 'test-uuid'},
    window: { scrollTo() {}, addEventListener() {} }, navigator: {},
    document: {
      hidden: false, body: { classList: { add() {}, remove() {} } },
      querySelector: element, querySelectorAll: () => [],
      createElement: () => ({ getContext: () => ({ font: '10px Arial', measureText(value) { return { width: String(value).length * (parseFloat(this.font.match(/[\d.]+/)?.[0]) || 10) * .55 }; } }) }),
      getElementById: id => id === 'roster-criptografado' ? { textContent: '{}' } : element('#' + id)
    },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    confirm(message) { calls.confirmations.push(message); return options.confirm; },
    initializeApp: (_config,name='main') => ({name}), getAuth: () => ({}), getDatabase: () => ({}),
    initializeAuth: app => ({app}), inMemoryPersistence:{},
    createUserWithEmailAndPassword: async (_auth,email,password) => {calls.authCreates.push({email,password});if(options.authCreateError)throw options.authCreateError;return{user:{uid:options.newAuthUid||'new-teacher'}};},
    deleteUser: async user => {calls.authDeletes.push(user.uid);if(options.authDeleteError)throw options.authDeleteError;},
    deleteApp: async app => {calls.appDeletes.push(app.name);}, signOut:async()=>{},
    onAuthStateChanged: () => () => {}, onValue: () => () => {},
    ref: (_db, path = '') => path,
    push: () => ({key:'new-group'}),
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    get: async path => { calls.reads.push(path); options.onRead?.(path, calls.reads); return snapshot(read(path)); },
    set: async (path, value) => {
      calls.sets.push([path, clone(value)]);
      if (options.setError) throw options.setError;
      write(path, value);
    },
    update: async (base, changes) => {
      calls.updates.push(clone(changes));
      if (options.updateError) throw options.updateError;
      Object.entries(changes).forEach(([path, value]) => write(base?`${base}/${path}`:path, value));
    },
    runTransaction: async (path, updater, config) => {
      calls.transactions.push({ path, config });
      if (options.transactionError) throw options.transactionError;
      let candidate;
      for (const value of options.transactionRetries || [clone(read(path) ?? null)]) candidate = updater(value);
      if (candidate === undefined) return { committed: false, snapshot: snapshot(read(path) ?? null) };
      write(path, candidate);
      return { committed: true, snapshot: snapshot(read(path)) };
    }
  });
  vm.runInContext(readFileSync(join(__dirname,'..','assets','roster-import.js'),'utf8'),context,{filename:'assets/roster-import.js'});
  vm.runInContext(source + `
    render = () => {};
    refreshTimerUi = () => {};
    globalThis.testDownloads = [];
    downloadBlob = (blob, filename) => globalThis.testDownloads.push({blob,filename});
    globalThis.appTest = { state, CRITERIOS, notaValida, mediaAvaliador, situacao, resultadoAluno,
      elapsedAt, formatElapsed, boardElapsed, timerRecord, controlTimer, closeBoard, reopenBoard,
      createBoardShareSnapshot, assertShareSnapshotCurrent, buildSharePdf, buildBoardShareText, whatsappTextUrl, boardShareFilename,
      assertBoardAccess, hasUnsavedDrafts, saveGrade, saveDelivery, reportHtml, refreshReportData,
      printReports, exportCsv, csvCell, boardActions, timerHtml,
      teacherIdentity,teacherEditIdentity,teacherProfileFingerprint,addTeacher,changeTeacherAccess,saveTeacherEdit,
      validatedGroupDraft,groupRelatedBoards,groupAdminFingerprint,resetGroupAdmin,editGroup,saveGroup,changeGroupAccess,addGroupStudentRow,removeGroupStudentRow,
      confirmExcelImport,
      startTeacherEdit(uid){teacherEditSession={uid,ownerUid:state.user.uid,revision:accessRevision,profileFingerprint:teacherProfileFingerprint(state.users[uid]),dialog:{open:false,remove(){},querySelectorAll(){return[];}},saving:false};},
      prepareImport(rows){const catalog={users:state.users,existingGroups:state.groups},preview=BancaFlowImport.parseRows(rows,catalog);excelImportState={uid:state.user.uid,revision:accessRevision,busy:false,rows,defaultCourse:'',catalog,preview,fingerprint:excelPreviewFingerprint(preview)};return excelImportState;},
      buildEvaluationPdf: typeof buildEvaluationPdf === 'function' ? buildEvaluationPdf : null };
  `, context, { filename: 'index.html.inline-module.js' });
  const app = context.appTest;
  Object.assign(app.state, clone(data), { user: { uid }, profile: clone(data.users[uid]), connected: true });
  return { app, data, calls, options, elements, context, downloads: context.testDownloads, now: () => now, advance: ms => { now += ms; }, read, write };
}

test('individual averages require all four valid grades, including valid zeroes', () => {
  const { app } = harness();
  assert.equal(app.mediaAvaliador(grade(10, 8, 6, 8)), 8);
  assert.equal(app.mediaAvaliador(grade(0, 0, 0, 0)), 0);
  for (const bad of [undefined, {}, grade(8, 8, 8, null), grade(11), grade(-1), grade(NaN), grade('8')]) {
    assert.equal(app.mediaAvaliador(bad), null);
  }
});

test('weighted result keeps every evaluator and applies the existing 60%/40% formula', () => {
  const { app, data } = harness();
  const result = app.resultadoAluno(data.boards.b1, 's1', data.grades.b1, data.deliveries.b1);
  assert.equal(result.banca, 7);
  assert.equal(result.entrega, 9);
  assert.equal(result.parcelaBanca, 4.2);
  assert.equal(result.parcelaEntrega, 3.6);
  assert.ok(Math.abs(result.final - 7.8) < 1e-12);
  assert.equal(app.resultadoAluno(data.boards.b1, 's2', data.grades.b1, data.deliveries.b1).final, 3);
});

test('missing individual or delivery grades prevent a final result and identify pending data', () => {
  const { app, data } = harness();
  delete data.grades.b1.t2.s1.code;
  delete data.deliveries.b1.s2;
  assert.equal(app.resultadoAluno(data.boards.b1, 's1', data.grades.b1, data.deliveries.b1), null);
  const status = app.situacao(data.boards.b1, data.groups.g1, data.grades.b1, data.deliveries.b1);
  assert.equal(status.pronta, false);
  assert.deepEqual(clone(status.pendencias), [{ aluno: 's1', membro: 't2', tipo: 'banca' }, { aluno: 's2', tipo: 'entregas' }]);
  assert.equal(app.situacao({ members: {} }, data.groups.g1, {}, data.deliveries.b1).pronta, false);
});

test('centiseconds truncate milliseconds and roll over seconds and minutes', () => {
  const { app } = harness();
  for (const [ms, display] of [[0, '00:00,00'], [9, '00:00,00'], [10, '00:00,01'], [999, '00:00,99'], [1000, '00:01,00'], [59999, '00:59,99'], [60000, '01:00,00'], [3723456, '62:03,45'], [-500, '00:00,00']]) {
    assert.equal(app.formatElapsed(ms), display);
  }
});

test('cancelling close or reopen performs no reads or writes', async () => {
  const h = harness(), { app } = h;
  h.options.confirm = false;
  await app.closeBoard('b1');
  await app.reopenBoard('b1');
  assert.equal(h.calls.confirmations.length, 2);
  assert.deepEqual(h.calls.reads, []);
  assert.deepEqual(h.calls.updates, []);
});

test('unsaved grade or delivery drafts block closing before confirmation', async () => {
  const h = harness(), { app } = h;
  app.state.drafts.set('grade/b1/s1', { presentation: '9', practice: '8', code: '6', time: '8' });
  await assert.rejects(app.closeBoard('b1'), /Salve as notas/);
  app.state.drafts.clear();
  app.state.drafts.set('delivery/b1/s1', { delivery: '10' });
  await assert.rejects(app.closeBoard('b1'), /Salve as notas/);
  assert.equal(h.calls.confirmations.length, 0);
  assert.equal(h.calls.updates.length, 0);
});

test('unassigned, disabled and unauthenticated users cannot close, reopen or control time', async () => {
  for (const uid of ['outsider', 'disabled', 't1']) {
    const h = harness(uid);
    if (uid === 't1') h.app.state.user = null;
    for (const action of [() => h.app.closeBoard('b1'), () => h.app.reopenBoard('b1'), () => h.app.controlTimer('b1', 'start')]) {
      await assert.rejects(action(), /Somente os avaliadores/);
    }
    assert.equal(h.calls.confirmations.length, 0);
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.calls.transactions.length, 0);
  }
});

test('status changes detect an already closed or reopened remote board', async () => {
  const h = harness(), { app } = h;
  h.write('seals/b1', { by: 't2', at: h.now() });
  await assert.rejects(app.closeBoard('b1'), /O estado da banca mudou/);
  h.write('seals/b1', null);
  await assert.rejects(app.reopenBoard('b1'), /O estado da banca mudou/);
  assert.equal(h.calls.updates.length, 0);
  assert.equal(app.state.busyBoards.has('b1'), false);
});

test('individual grading stays assigned to the signed-in evaluator and is blocked after close', async () => {
  const h = harness(), { app } = h;
  const form = { dataset: { gradeForm: 'b1', student: 's1' }, values: { presentation: '9', practice: '8', code: '7', time: '6' } };
  await app.saveGrade(form);
  assert.equal(h.calls.sets[0][0], 'grades/b1/t1/s1');
  assert.deepEqual(h.data.grades.b1.t2.s1, grade(6, 6, 6, 6));
  app.state.seals.b1 = { by: 't2', at: h.now() };
  await assert.rejects(app.saveGrade(form), /Banca não disponível/);
  app.state.seals.b1 = null;
  form.values.code = '';
  await assert.rejects(app.saveGrade(form), /Preencha todos os critérios/);
});

test('HTML report lists individual grades, weighted portions, final result and centiseconds', () => {
  const h = harness('coord'), { app } = h;
  app.state.seals.b1 = { by: 't1', at: h.now() };
  app.state.timers.b1 = { elapsedMs: 123456, startedAt: 0 };
  const report = app.reportHtml(['b1']);
  for (const text of ['Ana', 'Bruno', 'Professor Um', 'Professora Dois', '10,00', '7,00', '4,20', '3,60', '7,80', '02:03,45', 'Banca × 60%', 'Entregas × 40%']) assert.ok(report.includes(text), text);
  delete app.state.deliveries.b1.s1;
  assert.throws(() => app.reportHtml(['b1']), /notas pendentes/);
});

test('report refresh rejects an empty selection, an open board and reopening during reads', async () => {
  const h = harness('coord'), { app } = h;
  await assert.rejects(app.refreshReportData([]), /Não há bancas completas/);
  assert.equal(h.calls.reads.length, 0);
  await assert.rejects(app.refreshReportData(['b1']), /banca está aberta/);
  assert.deepEqual(h.calls.reads, ['seals/b1']);
  h.calls.reads.length = 0;
  h.write('seals/b1', { by: 't1', at: h.now() });
  h.data.grades.b1.t1.s1.code = 0;
  h.options.onRead = (path, reads) => {
    if (path === 'seals/b1' && reads.filter(item => item === path).length === 2) h.write(path, null);
  };
  await assert.rejects(app.refreshReportData(['b1']), /mudou durante a emissão/);
  assert.equal(app.state.grades.b1.t1.s1.code, 6);
  assert.equal(app.state.seals.b1, undefined);
});

test('report and delivery views remain coordinator-only actions', async () => {
  const { app } = harness();
  await assert.rejects(app.printReports(['b1']), /Acesso restrito/);
  assert.throws(() => app.exportCsv(['b1']), /Acesso restrito/);
});

test('native evaluation PDF includes individual grades, weighted totals and recorded centiseconds', async () => {
  const h = harness('coord'), { app } = h;
  app.state.seals.b1 = { by: 't1', at: h.now() };
  app.state.timers.b1 = { elapsedMs: 123456, startedAt: 0 };
  const blob = app.buildEvaluationPdf(['b1']);
  assert.equal(blob.type, 'application/pdf');
  const pdf = await blob.text();
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /%%EOF\s*$/);
  for (const text of ['Ana', 'Bruno', 'Professor Um', 'Professora Dois', '10,00', '7,00', '4,20', '3,60', '7,80', '02:03,45']) assert.ok(pdf.includes(text), text);
  assert.ok(!pdf.includes('Agenda de bancas confirmadas'));
  assert.match(pdf, /\/Type \/Pages \/Count [1-9]\d*/);
});

test('native evaluation PDF supports legacy data and blocks open, incomplete or unauthorized reports', async () => {
  const h = harness('coord'), { app } = h;
  assert.throws(() => app.buildEvaluationPdf(['b1']), /bancas concluídas/);
  app.state.seals.b1 = { by: 't1', at: h.now() };
  const legacy = await app.buildEvaluationPdf(['b1']).text();
  assert.ok(legacy.includes('N\\343o registrado'));
  delete app.state.deliveries.b1.s1;
  assert.throws(() => app.buildEvaluationPdf(['b1']), /notas pendentes/);
  assert.throws(() => harness().app.buildEvaluationPdf(['b1']), /Somente a coordenação/);
  assert.throws(() => app.buildEvaluationPdf([]), /pelo menos uma banca/);
});

test('elapsed timer uses server offset, paused duration and sealed cutoff', () => {
  const h = harness(), { app } = h;
  app.state.serverOffset = 500;
  app.state.timers.b1 = { elapsedMs: 1234, startedAt: h.now() - 3000 };
  assert.equal(app.boardElapsed('b1'), 4734);
  app.state.seals.b1 = { by: 't2', at: h.now() - 1000 };
  assert.equal(app.boardElapsed('b1'), 3234);
  h.advance(60000);
  assert.equal(app.boardElapsed('b1'), 3234);
  assert.equal(app.elapsedAt({ elapsedMs: 1234, startedAt: 0 }), 1234);
});

test('shared timer starts, pauses and resumes without losing milliseconds', async () => {
  const h = harness(), { app } = h;
  await app.controlTimer('b1', 'start');
  assert.equal(h.data.timers.b1.startedAt, h.now());
  h.advance(12345);
  await app.controlTimer('b1', 'pause');
  assert.equal(h.data.timers.b1.elapsedMs, 12345);
  assert.equal(h.data.timers.b1.startedAt, 0);
  h.advance(10000);
  await app.controlTimer('b1', 'start');
  h.advance(555);
  assert.equal(app.boardElapsed('b1'), 12900);
  await app.controlTimer('b1', 'pause');
  assert.equal(h.data.timers.b1.elapsedMs, 12900);
  assert.equal(h.data.timers.b1.revision, 4);
  assert.ok(h.calls.transactions.every(call => call.config.applyLocally === false));
});

test('transaction retries respect another evaluator already starting or pausing', async () => {
  const h = harness(), { app } = h;
  h.options.transactionRetries = [null, { elapsedMs: 500, startedAt: h.now(), revision: 3 }];
  await app.controlTimer('b1', 'start');
  assert.equal(h.read('timers/b1'), undefined);
  h.options.transactionRetries = [{ elapsedMs: 0, startedAt: h.now() - 5000, revision: 3 }, { elapsedMs: 5000, startedAt: 0, revision: 4 }];
  await app.controlTimer('b1', 'pause');
  assert.equal(h.read('timers/b1'), undefined);
  assert.equal(app.state.busyBoards.has('b1'), false);
});

test('reset and status cancellation leave every saved grade untouched', async () => {
  const h = harness(), { app } = h;
  const saved = clone(h.data.grades);
  h.write('timers/b1', { elapsedMs: 12345, startedAt: 0, revision: 1 });
  h.options.confirm = false;
  await app.controlTimer('b1', 'reset');
  assert.equal(h.calls.transactions.length, 0);
  assert.equal(h.data.timers.b1.elapsedMs, 12345);
  h.options.confirm = true;
  await app.controlTimer('b1', 'reset');
  assert.equal(h.data.timers.b1.elapsedMs, 0);
  assert.deepEqual(h.data.grades, saved);
});

test('assigned teacher closes atomically, freezes time and another teacher reopens without deleting grades', async () => {
  const h = harness(), { app } = h;
  const original = clone(h.data.grades);
  h.write('timers/b1', { elapsedMs: 12345, startedAt: h.now() - 1555, revision: 2 });
  await app.closeBoard('b1');
  assert.equal(h.data.seals.b1.by, 't1');
  assert.equal(h.data.timers.b1.elapsedMs, 13900);
  assert.equal(h.data.timers.b1.startedAt, 0);
  assert.deepEqual(Object.keys(h.calls.updates[0]).sort(), ['seals/b1', 'timers/b1']);
  app.state.user.uid = 't2'; app.state.profile = clone(h.data.users.t2);
  await app.reopenBoard('b1');
  assert.equal(h.data.seals.b1, undefined);
  assert.equal(h.data.timers.b1.elapsedMs, 13900);
  assert.equal(h.data.timers.b1.startedAt, 0);
  assert.deepEqual(h.data.grades, original);
});

test('coordinator may close incomplete board then reopen to finish delivery grades', async () => {
  const h = harness('coord'), { app } = h;
  delete h.data.deliveries.b1.s1; delete app.state.deliveries.b1.s1;
  await app.closeBoard('b1');
  assert.equal(h.data.seals.b1.by, 'coord');
  await assert.rejects(app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}}),/Banca já concluída/);
  await app.reopenBoard('b1');
  await app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}});
  assert.equal(h.data.deliveries.b1.s1, 9.5);
  await assert.rejects(harness().app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}}),/Acesso restrito/);
});

test('reopening does not discard a draft made before another evaluator closed', async () => {
  const h = harness(), { app } = h;
  const draft = { presentation:'9',practice:'8',code:'6',time:'8' };
  app.state.drafts.set('grade/b1/s1',draft);
  h.write('seals/b1',{by:'t2',at:h.now()});app.state.seals.b1=clone(h.data.seals.b1);
  await app.reopenBoard('b1');
  assert.equal(h.data.seals.b1,undefined);
  assert.deepEqual(clone(app.state.drafts.get('grade/b1/s1')),draft);
});

test('offline, sealed and failed writes do not fabricate state or leave actions busy', async () => {
  const h = harness(), { app } = h;
  app.state.connected=false;
  await assert.rejects(app.closeBoard('b1'),/Conecte-se/);
  await assert.rejects(app.controlTimer('b1','start'),/Conecte-se/);
  app.state.connected=true;app.state.seals.b1={by:'t2',at:h.now()};
  await assert.rejects(app.controlTimer('b1','start'),/Reabra/);
  app.state.seals.b1=null;
  h.options.updateError=Error('permission-denied');
  await assert.rejects(app.closeBoard('b1'),/permission-denied/);
  assert.equal(app.state.seals.b1,undefined);
  assert.equal(app.state.busyBoards.has('b1'),false);
  h.options.transactionError=Error('offline');
  await assert.rejects(app.controlTimer('b1','start'),/offline/);
  assert.equal(app.state.busyBoards.has('b1'),false);
});

test('official snapshot includes every individual note and exact weighted totals from refreshed data', async () => {
  const h=harness('coord'),{app}=h;
  h.write('seals/b1',{by:'t1',at:h.now()});h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  const result=await app.createBoardShareSnapshot('b1');
  assert.equal(result.scope,'official');assert.equal(result.students.length,2);
  assert.equal(result.students[0].evaluators.length,2);
  assert.ok(Math.abs(result.students[0].result.final-7.8)<1e-12);
  assert.equal(result.elapsedMs,123456);
  app.assertShareSnapshotCurrent(result);
  const message=app.buildBoardShareText(result);
  for(const text of ['Ana','Bruno','Professor Um','Professora Dois','Apresentação: 10,00','Média da banca (0–10): 7,00','Banca × 60% (0–6): 4,20','Entregas × 40% (0–4): 3,60','Nota final (0–10): 7,80','02:03,45'])assert.ok(message.includes(text),text);
  assert.equal(new URL(app.whatsappTextUrl(message)).searchParams.get('text'),message);
  const pdf=await app.buildSharePdf(result).text();
  for(const text of ['Ana','Bruno','4,20','3,60','7,80','02:03,45'])assert.ok(pdf.includes(text),text);
});

test('teacher single-student snapshot works when another student is pending and never reads other grades or deliveries', async () => {
  const h=harness(),{app}=h;
  delete h.data.grades.b1.t1.s2;
  h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  const result=await app.createBoardShareSnapshot('b1',{studentId:'s1'});
  assert.equal(result.scope,'teacher');assert.equal(result.students.length,1);
  assert.equal(result.students[0].name,'Ana');assert.equal(result.students[0].evaluators.length,1);
  assert.equal(result.students[0].evaluators[0].uid,'t1');assert.equal(result.students[0].result,null);
  assert.deepEqual(h.calls.reads.sort(),['grades/b1/t1','seals/b1','timers/b1']);
  const message=app.buildBoardShareText(result),pdf=await app.buildSharePdf(result).text();
  assert.ok(message.includes('parcial'));assert.ok(message.includes('Apresentação: 10,00'));
  for(const leak of ['Professora Dois','Bruno','Entregas (0–10)','Nota final (0–10)']){assert.ok(!message.includes(leak),leak);assert.ok(!pdf.includes(leak),leak);}
  assert.ok(pdf.includes('PARCIAL'));
  await assert.rejects(app.createBoardShareSnapshot('b1'),/quatro notas de Bruno/);
});

test('share preparation blocks official open/incomplete results, unsaved work, offline and unknown students', async () => {
  const h=harness('coord'),{app}=h;
  await assert.rejects(app.createBoardShareSnapshot('b1'),/banca está aberta/);
  h.write('seals/b1',{by:'t1',at:h.now()});delete h.data.deliveries.b1.s1;
  await assert.rejects(app.createBoardShareSnapshot('b1'),/todas as notas completas/);
  app.state.connected=false;await assert.rejects(app.createBoardShareSnapshot('b1'),/Conecte-se/);
  app.state.connected=true;await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'missing'}),/Aluno não encontrado/);
  app.state.drafts.set('delivery/b1/s1',{delivery:'8'});
  await assert.rejects(app.createBoardShareSnapshot('b1'),/Salve as notas/);
});

test('share fingerprints reject edited grades, timer, reopened status and another session', async () => {
  const h=harness('coord'),{app}=h;
  h.write('seals/b1',{by:'t1',at:h.now()});h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  for(const change of [()=>app.state.grades.b1.t1.s1.presentation=1,()=>app.state.timers.b1.elapsedMs++,()=>app.state.seals.b1=null]){
    const result=await app.createBoardShareSnapshot('b1');change();assert.throws(()=>app.assertShareSnapshotCurrent(result),/mudaram/);
  }
  const result=await app.createBoardShareSnapshot('b1');app.state.user.uid='t2';
  assert.throws(()=>app.assertShareSnapshotCurrent(result),/sessão mudou/);
});

test('account changes during asynchronous refresh cannot produce another account snapshot', async () => {
  const h=harness(),{app}=h;
  h.options.onRead=()=>{app.state.user.uid='t2';};
  await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'s1'}),/sessão mudou/);
});

test('snapshot uses refreshed group metadata and rejects a student removed during preparation', async () => {
  const h=harness(),{app}=h;
  h.options.onRead=()=>{app.state.groups.g1={...app.state.groups.g1,title:'Título atualizado',students:{s1:'Ana atualizada',s2:'Bruno'}};};
  const snapshot=await app.createBoardShareSnapshot('b1',{studentId:'s1'});
  assert.equal(snapshot.projectTitle,'Título atualizado');
  assert.equal(snapshot.students[0].name,'Ana atualizada');
  app.assertShareSnapshotCurrent(snapshot);
  h.options.onRead=()=>{app.state.groups.g1={...app.state.groups.g1,students:{s2:'Bruno'}};};
  await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'s1'}),/Aluno não encontrado/);
});

function adminForm(values,dataset={}){
  return{values,dataset,querySelector:()=>({disabled:false}),querySelectorAll:()=>[],reset(){this.wasReset=true;}};
}
function groupForm(draft){
  return{dataset:{},elements:{namedItem:name=>({value:draft[name]||''})},querySelectorAll:selector=>selector==='[data-group-student]'?draft.students.map(student=>({dataset:{groupStudent:student.sid},querySelector:()=>({value:student.name})})):[]};
}
const newGroupDraft=()=>({name:'Grupo do novo curso',className:'1A',courseName:'Redes de Computadores',title:'Rede segura',advisorUid:'t1',students:[{sid:'s1',name:'Carla'},{sid:'s2',name:'Daniel'}]});
const importRows=()=>[['Curso','Turma','Grupo','Título','Orientador','Aluno'],['Engenharia','1E','Grupo novo','Sensores','one@example.test','Carla'],['Engenharia','1E','Grupo novo','Sensores','one@example.test','Daniel']];

test('only Alberson manages teachers or groups, including another coordinator account',async()=>{
  for(const uid of ['t1','coord']){
    const h=harness(uid);if(uid==='coord')h.app.state.profile.key='other-coordinator';
    await assert.rejects(h.app.addTeacher(adminForm({name:'Nova',email:'new@example.test',key:'nova',method:'new',password:'strongpass'})),/Somente o Alberson/);
    await assert.rejects(h.app.changeTeacherAccess('t2',false),/Somente o Alberson/);
    await assert.rejects(h.app.saveGroup(groupForm(newGroupDraft())),/Somente o Alberson/);
    await assert.rejects(h.app.changeGroupAccess('g1',false),/Somente o Alberson/);
    assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
  }
});

test('new teacher uses a secondary Auth account and preserves the coordinator session and stored data',async()=>{
  const h=harness('coord'),before=clone(h.data),form=adminForm({name:'  Nova Docente  ',email:'NOVA@EXAMPLE.TEST',key:'nova',method:'new',password:'strongpass'});
  await h.app.addTeacher(form);
  assert.equal(h.data.users['new-teacher'].name,'Nova Docente');assert.equal(h.data.users['new-teacher'].email,'nova@example.test');assert.equal(h.data.users['new-teacher'].role,'teacher');
  assert.equal(h.app.state.user.uid,'coord');assert.equal(h.calls.authCreates.length,1);assert.equal(h.calls.authDeletes.length,0);
  assert.equal(form.wasReset,true);assert.equal(h.app.state.teacherBusy,false);
  assert.equal('password'in h.data.users['new-teacher'],false);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
});

test('teacher creation checks fresh duplicates before Auth and rolls back only its own account on profile collision',async()=>{
  const values={name:'Nova',email:'new@example.test',key:'nova',method:'new',password:'strongpass'};
  const duplicate=harness('coord');duplicate.data.users.hidden={name:'Outra',email:'new@example.test',key:'other',role:'teacher',active:true};
  await assert.rejects(duplicate.app.addTeacher(adminForm(values)),/Já existe/);assert.equal(duplicate.calls.authCreates.length,0);
  const conflict=harness('coord');conflict.options.transactionRetries=[{name:'Cadastro concorrente',email:'concurrent@example.test',key:'other',role:'teacher',active:true}];
  await assert.rejects(conflict.app.addTeacher(adminForm(values)),/outra janela/);
  assert.deepEqual(conflict.calls.authDeletes,['new-teacher']);assert.equal(conflict.app.state.teacherBusy,false);assert.equal(conflict.data.users['new-teacher'],undefined);
  const existing=harness('coord');await existing.app.addTeacher(adminForm({...values,method:'existing',uid:'linked-uid'}));
  assert.equal(existing.calls.authCreates.length,0);assert.equal(existing.data.users['linked-uid'].role,'teacher');
});

test('teacher edit changes name/contact only and retains login identity and historical evaluator labels',async()=>{
  const h=harness('coord'),{app}=h;app.startTeacherEdit('t1');
  await app.saveTeacherEdit(adminForm({name:' Nome Atualizado ',contactEmail:'CONTATO@EXAMPLE.TEST'},{teacherUid:'t1'}));
  assert.equal(h.data.users.t1.name,'Nome Atualizado');assert.equal(h.data.users.t1.contactEmail,'contato@example.test');
  assert.equal(h.data.users.t1.email,'one@example.test');assert.equal(h.data.users.t1.key,'one');assert.equal(h.data.users.t1.role,'teacher');
  assert.equal(h.data.boards.b1.memberNames.t1,'Professor Um');assert.equal(h.data.grades.b1.t1.s1.presentation,10);
  const data=new h.context.FormData({values:{name:'Nome',email:'new@example.test'}});
  assert.throws(()=>app.teacherEditIdentity(data,h.data.users.t1),/não podem ser alterados/);
});

test('teacher edit detects stale profiles and removal checks fresh boards before preserving history',async()=>{
  const h=harness('coord'),{app}=h;app.startTeacherEdit('t1');h.data.users.t1.name='Mudou em outra janela';
  await assert.rejects(app.saveTeacherEdit(adminForm({name:'Sobrescrever',contactEmail:''},{teacherUid:'t1'})),/outra janela/);
  assert.equal(h.data.users.t1.name,'Mudou em outra janela');
  app.state.boards={};await assert.rejects(app.changeTeacherAccess('t1',false),/bancas em aberto/);
  h.write('seals/b1',{by:'coord',at:h.now()});const grades=clone(h.data.grades);
  await app.changeTeacherAccess('t1',false);assert.equal(h.data.users.t1.active,false);assert.deepEqual(h.data.grades,grades);
  await app.changeTeacherAccess('t1',true);assert.equal(h.data.users.t1.active,true);assert.equal(h.data.users.t1.disabledAt,undefined);
});

test('manual group creation for another course appends stable student identities without modifying existing evaluations',async()=>{
  const h=harness('coord'),before=clone(h.data);h.app.resetGroupAdmin();
  await h.app.saveGroup(groupForm(newGroupDraft()));
  assert.equal(h.data.groups['new-group'].courseName,'Redes de Computadores');assert.deepEqual(h.data.groups['new-group'].students,{s1:'Carla',s2:'Daniel'});
  assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
});

test('group validation rejects inactive advisors, duplicate names and unsafe student IDs',()=>{
  const {app}=harness('coord');
  for(const change of [draft=>draft.advisorUid='disabled',draft=>draft.students[1].name='Cárla',draft=>draft.students[0].sid='invalid/id',draft=>draft.students=[]]){
    const draft=newGroupDraft();change(draft);assert.throws(()=>app.validatedGroupDraft(draft),/orientador|mesmo nome|identificadores|1 a 20/);
  }
});

test('manual addition does not duplicate an existing or archived course/class/group identity',async()=>{
  const h=harness('coord'),draft=newGroupDraft();h.data.groups.old={id:'old',...draft,students:{s1:'Outra pessoa'},active:false};h.app.resetGroupAdmin();
  await assert.rejects(h.app.saveGroup(groupForm(draft)),/já existe|já cadastrado|cadastrado|duplicado/i);
  assert.equal(h.calls.sets.length,0);assert.equal(h.data.groups.old.active,false);
});

test('scheduled group metadata stays protected while closed groups can be archived and restored without data deletion',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data);
  assert.throws(()=>app.editGroup('g1'),/já possui uma banca/);
  await assert.rejects(app.changeGroupAccess('g1',false),/banca em aberto/);
  h.write('seals/b1',{by:'coord',at:h.now()});await app.changeGroupAccess('g1',false);
  assert.equal(h.data.groups.g1.active,false);assert.deepEqual(h.data.groups.g1.students,before.groups.g1.students);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
  await app.changeGroupAccess('g1',true);assert.equal(h.data.groups.g1.active,true);
});

test('unscheduled group edit keeps student IDs and refuses a fresh schedule or concurrent metadata change',async()=>{
  const h=harness('coord'),{app}=h;
  const group={id:'g2',name:'Grupo sem banca',className:'2A',courseName:'ADS',title:'Antes',advisorUid:'t1',students:{s10:'Carla',s20:'Daniel'},active:true};
  h.write('groups/g2',group);app.state.groups.g2=clone(group);app.resetGroupAdmin();app.editGroup('g2');
  await app.saveGroup(groupForm({...newGroupDraft(),students:[{sid:'s10',name:'Carla Atualizada'},{sid:'s20',name:'Daniel'}]}));
  assert.deepEqual(h.data.groups.g2.students,{s10:'Carla Atualizada',s20:'Daniel'});
  app.editGroup('g2');h.write('boards/b2',{groupId:'g2',members:{t1:true,t2:true}});
  await assert.rejects(app.saveGroup(groupForm(newGroupDraft())),/recebeu uma banca/);
  h.write('boards/b2',null);app.editGroup('g2');h.data.groups.g2.title='Concorrente';
  await assert.rejects(app.saveGroup(groupForm(newGroupDraft())),/outra sessão/);
  assert.equal(h.data.groups.g2.title,'Concorrente');
});

test('Excel commit requires confirmation and appends groups atomically while preserving the existing catalog',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),session=app.prepareImport(importRows());
  h.options.confirm=false;await app.confirmExcelImport(session);assert.equal(h.calls.updates.length,0);
  h.options.confirm=true;await app.confirmExcelImport(session);
  assert.equal(h.data.groups['new-group'].courseName,'Engenharia');assert.deepEqual(h.data.groups['new-group'].students,{s001:'Carla',s002:'Daniel'});
  assert.equal(h.calls.updates.length,1);assert.deepEqual(Object.keys(h.calls.updates[0]),['groups/new-group']);assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);
});

test('Excel confirmation refreshes advisor/catalog and refuses stale previews or partial writes after errors',async()=>{
  const h=harness('coord'),{app}=h,session=app.prepareImport(importRows());h.data.users.t1.active=false;
  await assert.rejects(app.confirmExcelImport(session),/cadastro de grupos ou professores mudou/);assert.equal(h.calls.updates.length,0);
  h.data.users.t1.active=true;app.state.users.t1.active=true;const next=app.prepareImport(importRows());h.options.updateError=Error('permission-denied');
  await assert.rejects(app.confirmExcelImport(next),/permission-denied/);assert.equal(h.data.groups['new-group'],undefined);assert.ok(h.data.groups.g1);
});

test('CSV exports quote literal metadata and neutralize spreadsheet formula prefixes',()=>{
  const{app}=harness('coord');
  for(const value of ['=1+1',' +SUM(A1:A2)','-2+3','@SUM(A1:A2)','\tNome','\uFEFF=1'])assert.ok(app.csvCell(value).startsWith('"\''),value);
  assert.equal(app.csvCell('Ana "Silva"; Engenharia'),'"Ana ""Silva""; Engenharia"');
  assert.equal(app.csvCell('8,50'),'"8,50"');assert.equal(app.csvCell('Ana Silva'),'"Ana Silva"');
});
