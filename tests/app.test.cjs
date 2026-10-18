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
    coord: { name: 'Alberson', role: 'coordinator', key: 'alberson', active: true },
    t1: { name: 'Professor Um', role: 'teacher', active: true },
    t2: { name: 'Professora Dois', role: 'teacher', active: true },
    outsider: { name: 'Outro Professor', role: 'teacher', active: true },
    disabled: { name: 'Desativado', role: 'teacher', active: false }
  },
  groups: { g1: { id: 'g1', name: 'Grupo Árvore', title: 'Projeto de TCC', className: '2A', advisorUid: 't1', students: { s1: 'Ana', s2: 'Bruno' } } },
  boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Professor Um', t2: 'Professora Dois' }, startAt: 900000, durationMin: 30, room: 'Laboratório' } },
  grades: { b1: { t1: { s1: grade(10, 8, 6, 8), s2: grade(0, 0, 0, 0) }, t2: { s1: grade(6, 6, 6, 6), s2: grade(10, 10, 10, 10) } } },
  deliveries: { b1: { s1: 9, s2: 0 } },
  seals: {},
});

function harness(uid = 't1', storage = new Map()) {
  let now = 1_800_000_000_000;
  const data = fixture();
  const calls = { reads: [], sets: [], updates: [], transactions: [], confirmations: [] };
  const options = { confirm: true, setError: null, storageError: false };
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', innerHTML: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      setAttribute() {}, focus() {}, querySelectorAll() { return []; },
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
    console, Date: Clock, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    FormData: FormDataAdapter, URL, atob, btoa,
    window: { scrollTo() {}, addEventListener() {} }, navigator: {},
    localStorage: {
      getItem(key) { if (options.storageError) throw Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (options.storageError) throw Error('Storage blocked'); storage.set(key, String(value)); }
    },
    document: {
      hidden: false, body: { classList: { add() {}, remove() {} } },
      querySelector: element, querySelectorAll: () => [],
      createElement: () => ({ getContext: () => ({ font: '10px Arial', measureText(value) { return { width: String(value).length * (parseFloat(this.font.match(/[\d.]+/)?.[0]) || 10) * .55 }; } }) }),
      getElementById: id => id === 'roster-criptografado' ? { textContent: '{}' } : element('#' + id)
    },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    confirm(message) { calls.confirmations.push(message); return options.confirm; },
    initializeApp: () => ({}), getAuth: () => ({}), getDatabase: () => ({}),
    onAuthStateChanged: () => () => {}, onValue: () => () => {},
    ref: (_db, path = '') => path,
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    get: async path => { calls.reads.push(path); options.onRead?.(path, calls.reads); return snapshot(read(path)); },
    set: async (path, value) => {
      calls.sets.push([path, clone(value)]);
      if (options.setError) throw options.setError;
      if (path.startsWith('seals/') && (uid !== 'coord' || value === null || read(path))) {
        const error = Error('PERMISSION_DENIED'); error.code = 'PERMISSION_DENIED'; throw error;
      }
      write(path, value);
    },
    update: async (_path, changes) => {
      calls.updates.push(clone(changes));
      if (options.updateError) throw options.updateError;
      Object.entries(changes).forEach(([path, value]) => write(path, value));
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
  vm.runInContext(source + `
    render = () => {};
    refreshTimerUi = () => {};
    globalThis.testDownloads = [];
    downloadBlob = (blob, filename) => globalThis.testDownloads.push({blob,filename});
    globalThis.appTest = { state, CRITERIOS, notaValida, mediaAvaliador, situacao, resultadoAluno,
      elapsedAt, formatElapsed, parseElapsed, boardElapsed, timerRecord, controlTimer, closeBoard, reopenBoard,
      localTimerKey, validLocalTimer, loadLocalTimer, storeLocalTimer, syncLocalTimers, pauseSealedTimer,
      exportTimer, importTimerData, saveManualTime,
      assertBoardAccess, hasUnsavedDrafts, saveGrade, saveDelivery, reportHtml, refreshReportData,
      printReports, exportCsv, boardActions, timerHtml,
      buildEvaluationPdf: typeof buildEvaluationPdf === 'function' ? buildEvaluationPdf : null };
  `, context, { filename: 'index.html.inline-module.js' });
  const app = context.appTest;
  Object.assign(app.state, clone(data), { user: { uid }, profile: clone(data.users[uid]), connected: true });
  return { app, data, calls, options, elements, context, storage, downloads: context.testDownloads, now: () => now, advance: ms => { now += ms; }, read, write };
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

test('local elapsed time uses a server-adjusted sealed cutoff without changing clock duration', () => {
  const h = harness(), { app } = h;
  app.state.serverOffset = 500;
  app.state.timers.b1 = { elapsedMs: 1234, startedAt: h.now() - 3000 };
  assert.equal(app.boardElapsed('b1'), 4234);
  app.state.seals.b1 = { by: 't2', at: h.now() - 1000 };
  assert.equal(app.boardElapsed('b1'), 2734);
  h.advance(60000);
  assert.equal(app.boardElapsed('b1'), 2734);
  assert.equal(app.elapsedAt({ elapsedMs: 1234, startedAt: 0 }), 1234);
  assert.equal(app.elapsedAt({ elapsedMs: 1234, startedAt: h.now() + 10000 }), 1234);
});

test('local timer starts, pauses and resumes offline without any Firebase request', async () => {
  const h = harness(), { app } = h;
  app.state.connected = false;
  await app.controlTimer('b1', 'start');
  assert.equal(app.state.timers.b1.startedAt, h.now());
  h.advance(12345);
  await app.controlTimer('b1', 'pause');
  assert.equal(app.state.timers.b1.elapsedMs, 12345);
  assert.equal(app.state.timers.b1.startedAt, 0);
  h.advance(10000);
  await app.controlTimer('b1', 'start');
  h.advance(555);
  assert.equal(app.boardElapsed('b1'), 12900);
  await app.controlTimer('b1', 'pause');
  assert.equal(app.state.timers.b1.elapsedMs, 12900);
  assert.equal(app.state.timers.b1.revision, 4);
  assert.equal(h.calls.reads.length + h.calls.sets.length + h.calls.updates.length + h.calls.transactions.length, 0);
  assert.equal(JSON.parse(h.storage.get(app.localTimerKey('b1'))).elapsedMs, 12900);
});

test('local timer survives application reload and stays separate for each account', async () => {
  const h = harness();
  await h.app.controlTimer('b1', 'start');
  const reloaded = harness('t1', h.storage);
  reloaded.advance(12345);
  reloaded.app.syncLocalTimers();
  assert.equal(reloaded.app.boardElapsed('b1'), 12345);
  const other = harness('t2', h.storage);
  other.app.syncLocalTimers();
  assert.equal(other.app.boardElapsed('b1'), 0);
  assert.notEqual(other.app.localTimerKey('b1'), h.app.localTimerKey('b1'));
  assert.notEqual(h.app.localTimerKey('b2'), h.app.localTimerKey('b1'));
  await reloaded.app.controlTimer('b1', 'pause');
  assert.equal(JSON.parse(h.storage.get(h.app.localTimerKey('b1'))).elapsedMs, 12345);
});

test('local timer loads another tab update before applying controls and rejects malformed storage', async () => {
  const h = harness(), { app } = h;
  await app.controlTimer('b1', 'start');
  const key = app.localTimerKey('b1');
  h.storage.set(key, JSON.stringify({ elapsedMs: 9000, startedAt: 0, revision: 4 }));
  await app.controlTimer('b1', 'start');
  assert.equal(app.state.timers.b1.elapsedMs, 9000);
  assert.equal(app.state.timers.b1.revision, 5);
  for (const bad of [{ elapsedMs: -1, startedAt: 0 }, { elapsedMs: 1.5, startedAt: 0 }, { elapsedMs: 0, startedAt: -1 }]) {
    h.storage.set(key, JSON.stringify(bad));
    assert.equal(app.loadLocalTimer('b1', true), null);
  }
  h.storage.set(key, 'invalid JSON');
  app.loadLocalTimer('b1', true);
  assert.equal(app.state.timerErrors.b1, true);
});

test('reset requires confirmation and preserves other board data', async () => {
  const h = harness(), { app } = h;
  const saved = clone(h.data.grades);
  app.storeLocalTimer('b1', { elapsedMs: 12345, startedAt: 0, revision: 1 });
  h.options.confirm = false;
  await app.controlTimer('b1', 'reset');
  assert.equal(h.calls.transactions.length, 0);
  assert.equal(app.state.timers.b1.elapsedMs, 12345);
  h.options.confirm = true;
  await app.controlTimer('b1', 'reset');
  assert.equal(app.state.timers.b1.elapsedMs, 0);
  assert.equal(app.state.timers.b1.startedAt, 0);
  assert.deepEqual(h.data.grades, saved);
  assert.match(h.calls.confirmations[0], /Zerar o cronômetro/);
});

test('teacher close attempts the real seal write and reports permission denial without fake closure', async () => {
  const h = harness(), { app } = h;
  const original = clone(h.data);
  app.storeLocalTimer('b1', { elapsedMs: 12345, startedAt: h.now() - 1555, revision: 2 });
  await assert.rejects(app.closeBoard('b1'), /permissões atuais do banco não autorizam seu perfil/);
  assert.match(h.calls.confirmations[0], /Encerrar a avaliação de Grupo Árvore/);
  assert.deepEqual(h.calls.reads, ['seals/b1', 'seals/b1']);
  assert.deepEqual(h.calls.sets.map(([path]) => path), ['seals/b1']);
  assert.equal(h.calls.updates.length, 0);
  assert.equal(app.state.seals.b1, undefined);
  assert.equal(app.state.timers.b1.startedAt, h.now() - 1555);
  assert.deepEqual(h.data, original);
});

test('teacher reopening denied by original policy preserves seal, grades and local elapsed time', async () => {
  const h = harness('t2'), { app } = h;
  h.write('seals/b1', { by: 't1', at: h.now() - 10000 });
  app.storeLocalTimer('b1', { elapsedMs: 500, startedAt: h.now() - 12000, revision: 1 });
  app.state.seals.b1 = clone(h.data.seals.b1);
  app.pauseSealedTimer('b1');
  await assert.rejects(app.reopenBoard('b1'), /não autorizam a reabertura/);
  assert.match(h.calls.confirmations[0], /reabertura de Grupo Árvore/);
  assert.equal(h.data.seals.b1.by, 't1');
  assert.equal(app.state.timers.b1.elapsedMs, 2500);
  assert.equal(app.state.timers.b1.startedAt, 0);
  assert.equal(app.state.seals.b1.by, 't1');
  assert.ok(h.data.grades.b1.t1.s1);
});

test('coordinator closes only after all grades are complete and original policy denies reopening', async () => {
  const h = harness('coord'), { app } = h;
  delete app.state.deliveries.b1.s1;
  await assert.rejects(app.closeBoard('b1'), /Complete todas as notas/);
  assert.equal(h.calls.confirmations.length, 0);
  app.state.deliveries.b1.s1 = 9;
  app.storeLocalTimer('b1', { elapsedMs: 1000, startedAt: h.now() - 2000, revision: 1 });
  await app.closeBoard('b1');
  assert.equal(h.data.seals.b1.by, 'coord');
  assert.equal(app.state.timers.b1.elapsedMs, 3000);
  assert.equal(app.state.timers.b1.startedAt, 0);
  await assert.rejects(app.reopenBoard('b1'), /não autorizam a reabertura/);
  assert.equal(h.data.seals.b1.by, 'coord');
  assert.deepEqual(h.data.boards.b1.members, { t1: true, t2: true });
  assert.ok(h.calls.sets.every(([path]) => path === 'seals/b1'));
});

test('teacher must save every student grade before attempting a closure', async () => {
  const { app, calls } = harness();
  delete app.state.grades.b1.t1.s2;
  await assert.rejects(app.closeBoard('b1'), /notas de todos os alunos/);
  assert.equal(calls.confirmations.length + calls.sets.length, 0);
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

test('denied reopening still preserves dirty drafts without claiming the board reopened', async () => {
  const h = harness(), { app } = h;
  const draft = { presentation: '9', practice: '8', code: '6', time: '8' };
  app.state.drafts.set('grade/b1/s1', draft);
  h.write('seals/b1', { by: 't2', at: h.now() });
  app.state.seals.b1 = clone(h.data.seals.b1);
  await assert.rejects(app.reopenBoard('b1'), /não autorizam a reabertura/);
  assert.equal(h.data.seals.b1.by, 't2');
  assert.deepEqual(clone(app.state.drafts.get('grade/b1/s1')), draft);
  assert.equal(h.data.grades.b1.t1.s1.presentation, 10);
  assert.equal(app.hasUnsavedDrafts('b1'), true);
});

test('unchanged numeric drafts and drafts from another board do not block closing', async () => {
  const h = harness(), { app } = h;
  app.state.drafts.set('grade/b1/s1', { presentation: '10.0', practice: '8', code: '6,0', time: '8' });
  app.state.drafts.set('grade/other/s1', { presentation: '1' });
  assert.equal(app.hasUnsavedDrafts('b1'), false);
  await assert.rejects(app.closeBoard('b1'), /não autorizam seu perfil/);
  assert.equal(h.calls.sets.length, 1);
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

test('seal changes need connection while local timer works offline and respects sealed state', async () => {
  const h = harness(), { app } = h;
  app.state.connected = false;
  await assert.rejects(app.closeBoard('b1'), /Conecte-se/);
  await app.controlTimer('b1', 'start');
  assert.equal(app.state.timers.b1.startedAt, h.now());
  app.state.connected = true;
  await assert.rejects(app.controlTimer('b1', 'unknown'), /Ação inválida/);
  app.state.seals.b1 = { by: 't1', at: h.now() };
  await assert.rejects(app.controlTimer('b1', 'start'), /banca está encerrada/);
  assert.equal(h.calls.transactions.length, 0);
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

test('failed seal writes release busy state and local timer warns if browser storage is blocked', async () => {
  const h = harness(), { app } = h;
  const original = clone(app.state.grades);
  h.options.setError = Error('offline');
  await assert.rejects(app.closeBoard('b1'), /offline/);
  assert.equal(app.state.seals.b1, undefined);
  assert.equal(app.state.busyBoards.has('b1'), false);
  h.options.storageError = true;
  await app.controlTimer('b1', 'start');
  assert.equal(app.state.timerErrors.b1, true);
  assert.equal(app.state.timers.b1.startedAt, h.now());
  assert.equal(app.state.busyBoards.has('b1'), false);
  assert.deepEqual(clone(app.state.grades), original);
});

test('delivery editing is coordinator-only and remains blocked after denied reopening', async () => {
  const form = { dataset: { deliveryForm: 'b1', student: 's1' }, values: { delivery: '9.5' } };
  const teacher = harness();
  await assert.rejects(teacher.app.saveDelivery(form), /Acesso restrito/);
  assert.equal(teacher.calls.sets.length, 0);
  const h = harness('coord');
  h.write('seals/b1', { by: 't1', at: h.now() });
  h.app.state.seals.b1 = clone(h.data.seals.b1);
  await assert.rejects(h.app.saveDelivery(form), /Banca já concluída/);
  await assert.rejects(h.app.reopenBoard('b1'), /não autorizam a reabertura/);
  await assert.rejects(h.app.saveDelivery(form), /Banca já concluída/);
  assert.equal(h.data.deliveries.b1.s1, 9);
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

test('report refresh reads only original Firebase branches and keeps the local timer', async () => {
  const h = harness('coord'), { app } = h;
  h.data.grades.b1.t1.s1 = grade(1, 2, 3, 4);
  h.data.deliveries.b1.s1 = 5;
  h.write('seals/b1', { by: 't2', at: h.now() });
  app.storeLocalTimer('b1', { elapsedMs: 123456, startedAt: 0, revision: 1 });
  await app.refreshReportData(['b1']);
  assert.deepEqual(h.calls.reads.sort(), ['deliveries/b1', 'grades/b1', 'seals/b1', 'seals/b1']);
  assert.equal(app.state.grades.b1.t1.s1.code, 3);
  assert.equal(app.state.deliveries.b1.s1, 5);
  assert.equal(app.formatElapsed(app.boardElapsed('b1')), '02:03,45');
});

test('manual centisecond parsing is strict and coordinator can register time even after closure', () => {
  const { app } = harness('coord');
  assert.equal(app.parseElapsed('12:34,56'), 754560);
  assert.equal(app.parseElapsed('00:00.01'), 10);
  for (const value of ['12:60,00', '1:2,34', '00:00,1', '-1:00,00', '999999:00,00']) {
    assert.throws(() => app.parseElapsed(value), /Informe|limite/);
  }
  app.state.seals.b1 = { by: 'coord', at: Date.now() };
  app.saveManualTime('b1', '12:34,56');
  assert.equal(app.state.timers.b1.elapsedMs, 754560);
  assert.equal(app.state.timers.b1.startedAt, 0);
  assert.equal(app.state.timers.b1.source, 'manual');
  assert.throws(() => harness().app.saveManualTime('b1', '01:00,00'), /exclusivo da coordenação/);
});

test('export/import transfers exact centiseconds between account-local timers without Firebase', async () => {
  const teacher = harness();
  teacher.app.storeLocalTimer('b1', { elapsedMs: 123456, startedAt: teacher.now() - 100, revision: 1 });
  teacher.app.exportTimer('b1');
  assert.equal(teacher.downloads[0].filename, 'tempo_banca_b1.json');
  const record = JSON.parse(await teacher.downloads[0].blob.text());
  assert.equal(record.type, 'bancaflow-time');
  assert.equal(record.elapsedMs, 123556);
  assert.equal(record.boardId, 'b1');
  const coordinator = harness('coord');
  coordinator.app.state.seals.b1 = { by: 'coord', at: coordinator.now() };
  coordinator.app.importTimerData('b1', record);
  assert.equal(coordinator.app.state.timers.b1.elapsedMs, record.elapsedMs);
  assert.equal(coordinator.app.state.timers.b1.startedAt, 0);
  assert.equal(coordinator.app.state.timers.b1.source, 'imported');
  assert.throws(() => teacher.app.importTimerData('b1', record), /exclusiva da coordenação/);
  for (const invalid of [{...record, projectId:'other'}, {...record,boardId:'other'}, {...record,elapsedMs:-1}, {...record,elapsedMs:1.5}, {...record,elapsedMs:31536000001}, {...record,version:2}]) {
    assert.throws(() => coordinator.app.importTimerData('b1', invalid), /Arquivo inválido/);
  }
  assert.equal(teacher.calls.reads.length + teacher.calls.sets.length + coordinator.calls.reads.length + coordinator.calls.sets.length, 0);
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
  await assert.rejects(app.refreshReportData(['b1']), /foi reaberta/);
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
