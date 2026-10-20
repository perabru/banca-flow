const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { createNotifier } = require('../assets/chat-notifications.js');

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(settings = {}) {
  let time = 1800000000000;
  const values = settings.values || new Map(), events = new Map(), documentEvents = new Map();
  const calls = { banners: [], changes: [], shows: [], closes: [], registers: [], permissions: 0, vibrations: [], tones: 0, resumes: 0, audioClosed: 0 };
  const openNotifications = [];
  const worker = {
    active: {},
    async showNotification(title, options) {
      calls.shows.push({ title, options });
      await settings.beforeShow?.();
      if (settings.showError) throw settings.showError;
      const notification = { data: options.data, close() { calls.closes.push(this.data); } }; openNotifications.push(notification);
    },
    async getNotifications() { return openNotifications; }
  };
  function Notification() { throw Error('The mobile Notification constructor must never be used'); }
  Notification.permission = settings.permission || 'default';
  Notification.requestPermission = () => {
    calls.permissions++;
    if (settings.request) return settings.request();
    Notification.permission = settings.permissionResult || 'granted'; return Promise.resolve(Notification.permission);
  };
  class Audio {
    state = 'running'; currentTime = 1; destination = {};
    resume() { calls.resumes++; return Promise.resolve(); }
    close() { calls.audioClosed++; return Promise.resolve(); }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { calls.tones++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const env = {
    Date: { now: () => time }, URL, isSecureContext: true, Notification, AudioContext: Audio,
    location: { href: 'https://perabru.github.io/banca-flow/' },
    document: { hidden: settings.hidden === true, addEventListener(type, fn) { documentEvents.set(type, fn); }, removeEventListener(type) { documentEvents.delete(type); } },
    navigator: {
      vibrate(value) { calls.vibrations.push(value); },
      serviceWorker: { register(url) { calls.registers.push(url); if (settings.registrationError) throw settings.registrationError; return settings.registration || Promise.resolve(worker); } }
    },
    localStorage: { getItem(key) { if (settings.storageError) throw Error('Storage unavailable'); return values.get(key) || null; }, setItem(key, value) { if (settings.storageError) throw Error('Storage unavailable'); values.set(key, value); } },
    addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); }
  };
  if (settings.unsupported) delete env.Notification;
  const access = new Set(['geral', 'b1', 'b2']), visible = new Set();
  const api = createNotifier({ environment: env, now: settings.now, onChange: state => calls.changes.push(state), onBanner: payload => calls.banners.push(payload), canAccess: room => access.has(room), isRoomVisible: room => visible.has(room), serviceWorkerUrl: './chat-sw.js', iconUrl: './assets/icon.png', badgeUrl: './assets/badge.png' });
  const message = (text = 'Mensagem nova', extra = {}) => ({ uid: 'other', name: 'Professora Dois', text, at: time, ...extra });
  return { api, env, calls, values, worker, openNotifications, access, visible, settings, events, documentEvents, message, advance(ms) { time += ms; }, emitStorage(key, newValue) { events.get('storage')?.({ key, newValue }); } };
}

test('UMD exposes the stable API without requiring browser globals', () => {
  const context = vm.createContext({}); vm.runInContext(readFileSync(join(__dirname, '..', 'assets/chat-notifications.js'), 'utf8'), context);
  assert.equal(typeof context.BancaChatAlerts.createNotifier, 'function');
  const api = context.BancaChatAlerts.createNotifier({ environment: {} });
  for (const name of ['setSession', 'getState', 'receive', 'markRead', 'forgetRoom', 'toggleMute', 'requestPermission', 'dispose']) assert.equal(typeof api[name], 'function');
  assert.equal(api.getState().permission, 'unsupported'); api.dispose();
});

test('first snapshots are silent baselines; recent new IDs from other authors create per-room unread and safe text banners', () => {
  const h = harness(); h.api.setSession('t1');
  const initial = { old: h.message('Histórico') }; h.api.receive('geral', initial);
  assert.equal(h.api.getState().unread, 0); assert.equal(h.calls.banners.length, 0);
  const text = '<img src=x onerror=alert(1)> olá';
  h.api.receive('geral', { ...initial, own: h.message('Minha mensagem', { uid: 't1' }), a: h.message(text) });
  assert.equal(h.api.getState().unread, 1); assert.deepEqual(h.api.getState().countByRoom, { geral: 1 });
  assert.equal(h.calls.banners.length, 1); assert.equal(h.calls.banners[0].text, text); assert.equal(h.calls.banners[0].room, 'geral');
  assert.equal(h.calls.tones, 0); assert.deepEqual(h.calls.vibrations, [], 'no sound or vibration before a deliberate activating gesture');
  h.api.receive('geral', { a: h.message(text) }); h.api.receive('geral', { a: h.message(text), old: initial.old });
  assert.equal(h.api.getState().unread, 1); assert.equal(h.calls.banners.length, 1, 'replayed IDs never notify twice');
  h.api.receive('b1', {}); h.api.receive('b1', { b: h.message('Outra sala') });
  assert.equal(h.api.getState().unread, 2); assert.deepEqual(h.api.getState().countByRoom, { geral: 1, b1: 1 });
  const detached = h.api.getState(); detached.countByRoom.geral = 99; assert.equal(h.api.getState().countByRoom.geral, 1);
});

test('older pages, invalid records, nonnumeric server placeholders and future timestamps never become new alerts', () => {
  const h = harness(); h.api.setSession('t1'); h.api.receive('geral', null);
  h.api.receive('geral', {
    old: h.message('Histórico', { at: h.env.Date.now() - 120001 }), future: h.message('Futuro', { at: h.env.Date.now() + 60001 }),
    pending: h.message('Placeholder', { at: { '.sv': 'timestamp' } }), string: h.message('String', { at: String(h.env.Date.now()) }),
    nan: h.message('NaN', { at: NaN }), empty: h.message('  '), invalid: null, missing: h.message('Sem autor', { uid: '' })
  });
  h.api.receive('geral', { pending: h.message('Placeholder resolvido depois') });
  assert.equal(h.api.getState().unread, 0); assert.equal(h.calls.banners.length, 0);
  h.api.receive('geral', { recent: h.message('Mensagem recente', { at: h.env.Date.now() - 120000 }) });
  assert.equal(h.api.getState().unread, 1);
});

test('server-adjusted now keeps recent server timestamps eligible on devices with clocks ten minutes ahead or behind', () => {
  const serverNow = 1800000000000;
  for (const skew of [-600000, 600000]) {
    const h = harness({ now: () => serverNow }); h.advance(skew); h.api.setSession('t1'); h.api.receive('geral', {});
    h.api.receive('geral', { recent: h.message('Horário confirmado pelo servidor', { at: serverNow }), old: h.message('Histórico antigo', { at: serverNow - 120001 }) });
    assert.equal(h.api.getState().unread, 1); assert.equal(h.calls.banners.length, 1); assert.equal(h.calls.banners[0].id, 'recent');
  }
});

test('reading the current visible room clears unread while other rooms remain unread, and inaccessible rooms are forgotten', () => {
  const h = harness(); h.api.setSession('t1'); h.api.receive('geral', {}); h.api.receive('b1', {});
  h.api.receive('geral', { a: h.message() }); h.api.receive('b1', { b: h.message() });
  h.visible.add('geral'); h.api.receive('geral', { a: h.message(), c: h.message('Lida na hora') });
  assert.deepEqual(h.api.getState().countByRoom, { b1: 1 }); assert.equal(h.calls.banners.length, 2);
  h.visible.add('b1'); h.documentEvents.get('visibilitychange')(); assert.equal(h.api.getState().unread, 0);
  h.visible.clear(); h.api.receive('b1', { b: h.message(), d: h.message('Nova') });
  h.access.delete('b1'); h.api.receive('b1', { denied: h.message('Sem acesso') }); assert.equal(h.api.getState().unread, 0);
  h.access.add('b1'); h.api.receive('b1', { d: h.message('Reentrada sem replay') }); assert.equal(h.api.getState().unread, 0);
  h.api.forgetRoom('geral'); h.api.receive('geral', { newBaseline: h.message() }); assert.equal(h.api.getState().unread, 0);
});

test('mute suppresses every alert effect while keeping unread, and preferences are isolated per account with unavailable-storage fallback', async () => {
  const h = harness(); h.api.setSession('t1'); await h.api.requestPermission(); h.api.receive('geral', {});
  h.api.toggleMute(); h.api.receive('geral', { a: h.message() });
  assert.equal(h.api.getState().unread, 1); assert.equal(h.calls.banners.length, 0); assert.equal(h.calls.tones, 0); assert.equal(h.calls.shows.length, 0);
  h.api.setSession('t2'); assert.equal(h.api.getState().muted, false); assert.equal(h.api.getState().enabled, false); assert.equal(h.api.getState().unread, 0);
  h.api.setSession('t1'); assert.equal(h.api.getState().muted, true); assert.equal(h.api.getState().enabled, true);
  h.api.toggleMute(); h.api.receive('geral', {}); h.api.receive('geral', { b: h.message() }); assert.equal(h.calls.banners.length, 1);
  assert.equal(h.calls.tones, 1); assert.deepEqual(h.calls.vibrations, [70]);
  const fallback = harness({ storageError: true }); fallback.api.setSession('t1'); fallback.api.receive('geral', {}); fallback.api.receive('geral', { a: fallback.message() });
  assert.equal(fallback.calls.banners.length, 1); assert.doesNotThrow(() => fallback.api.toggleMute());
});

test('permission is requested synchronously in the caller gesture before awaiting worker readiness', async () => {
  let resolveRegistration; const registration = new Promise(resolve => resolveRegistration = resolve);
  const h = harness({ registration }); h.api.setSession('t1');
  const request = h.api.requestPermission(); assert.equal(h.calls.permissions, 1, 'requestPermission is invoked before the method returns');
  const state = await request; assert.equal(state.permission, 'granted'); assert.equal(state.enabled, true);
  resolveRegistration(h.worker); await flush(); assert.deepEqual(h.calls.registers, ['./chat-sw.js']);
  await h.api.requestPermission(); assert.equal(h.calls.permissions, 1, 'granted permission does not show a second browser prompt');
});

test('denied and unsupported browser permissions do not prompt or disable in-page banners', async () => {
  for (const settings of [{ permission: 'denied' }, { unsupported: true }, { permissionResult: 'denied' }]) {
    const h = harness(settings); h.api.setSession('t1'); const state = await h.api.requestPermission();
    assert.equal(state.enabled, false); assert.ok(['denied', 'unsupported'].includes(state.permission));
    assert.equal(h.calls.permissions, settings.permissionResult ? 1 : 0);
    h.api.receive('geral', {}); h.api.receive('geral', { a: h.message() }); assert.equal(h.calls.banners.length, 1);
  }
  const insecure = harness(); insecure.env.isSecureContext = false; insecure.api.setSession('t1'); await insecure.api.requestPermission();
  assert.equal(insecure.api.getState().permission, 'unsupported'); assert.equal(insecure.calls.permissions, 0);
});

test('a thrown or rejected permission prompt stays retryable and cannot reject the notification API', async () => {
  for (const request of [() => { throw Error('Transient prompt error'); }, () => Promise.reject(Error('Transient prompt error'))]) {
    const h = harness({ request }); h.api.setSession('t1');
    const state = await h.api.requestPermission(); assert.equal(state.permission, 'default'); assert.equal(state.enabled, false); assert.match(state.status, /não foi possível ativar/i);
    h.settings.request = () => Promise.resolve('granted'); await h.api.requestPermission(); assert.equal(h.api.getState().enabled, true);
  }
});

test('system notifications use only an active service worker for hidden pages, with safe account/room URLs and click data', async () => {
  const h = harness({ hidden: true }); h.api.setSession('t1'); h.api.receive('geral', {});
  h.api.receive('geral', { noPermission: h.message() }); await flush(); assert.equal(h.calls.shows.length, 0); assert.equal(h.calls.banners.length, 0);
  await h.api.requestPermission(); h.api.receive('geral', { a: h.message() }); await flush();
  assert.equal(h.calls.shows.length, 1); assert.equal(h.calls.banners.length, 0); assert.equal(h.calls.tones, 0); assert.equal(h.calls.vibrations.length, 0);
  const shown = h.calls.shows[0]; assert.equal(shown.options.data.accountId, 't1'); assert.equal(shown.options.data.room, 'geral');
  assert.equal(shown.options.data.url, 'https://perabru.github.io/banca-flow/#chat=geral'); assert.equal(shown.options.icon, './assets/icon.png');
  h.api.markRead('geral'); await flush(); assert.ok(h.calls.closes.some(item => item.accountId === 't1' && item.room === 'geral'));
  h.api.toggleMute(); h.api.receive('geral', { b: h.message() }); await flush(); assert.equal(h.calls.shows.length, 1); assert.equal(h.api.getState().unread, 1);
});

test('a late permission result or worker registration cannot enable or notify a different account', async () => {
  let permissionDone, workerDone;
  const h = harness({ hidden: true, request: () => new Promise(resolve => permissionDone = resolve), registration: new Promise(resolve => workerDone = resolve) });
  h.api.setSession('t1'); const request = h.api.requestPermission(); h.api.setSession('t2'); permissionDone('granted'); await request;
  assert.equal(h.api.getState().enabled, false); assert.equal([...h.values.keys()].some(key => key.endsWith('prefs:t2')), false);
  h.env.Notification.permission = 'granted'; await h.api.requestPermission(); h.api.receive('geral', {}); h.api.receive('geral', { a: h.message() });
  h.api.setSession('t3'); workerDone(h.worker); await flush(); assert.equal(h.calls.shows.length, 0); assert.equal(h.api.getState().unread, 0);
});

test('a notification that finishes showing after logout is closed without closing another account notifications', async () => {
  let completeShow;
  const h = harness({ hidden: true, beforeShow: () => new Promise(resolve => completeShow = resolve) });
  h.api.setSession('t1'); await h.api.requestPermission(); h.api.receive('geral', {}); h.api.receive('geral', { a: h.message() }); await flush();
  h.openNotifications.push({ data: { accountId: 'someone-else', room: 'geral' }, close() { throw Error('Another account notification must not be closed'); } });
  h.api.setSession(''); completeShow(); await flush();
  assert.equal(h.api.getState().enabled, false); assert.equal(h.api.getState().unread, 0); assert.ok(h.calls.closes.some(item => item.accountId === 't1'));
});

test('late notification cleanup cannot close or replace a newer login notification for the same account and room', async () => {
  let releaseOld, shows = 0;
  const h = harness({ hidden: true, beforeShow: () => ++shows === 1 ? new Promise(resolve => releaseOld = resolve) : undefined });
  h.api.setSession('t1'); await h.api.requestPermission(); h.api.receive('geral', {}); h.api.receive('geral', { old: h.message('Sessão anterior') }); await flush();
  h.api.setSession(''); h.api.setSession('t1'); h.api.receive('geral', {}); h.api.receive('geral', { fresh: h.message('Sessão atual') }); await flush();
  const old = h.calls.shows[0], fresh = h.calls.shows[1]; assert.notEqual(old.options.data.sessionId, fresh.options.data.sessionId); assert.notEqual(old.options.tag, fresh.options.tag);
  releaseOld(); await flush();
  assert.ok(h.calls.closes.some(item => item.messageId === 'old'));
  assert.equal(h.calls.closes.some(item => item.messageId === 'fresh'), false, 'the old asynchronous cleanup is scoped to its own session and message');
});

test('a batch counts all new messages but alerts only its latest, with sound and vibration limited during rapid updates', async () => {
  const h = harness(); h.api.setSession('t1'); await h.api.requestPermission(); h.api.receive('geral', {});
  const batch = Object.fromEntries(Array.from({ length: 100 }, (_, index) => ['m' + String(index).padStart(3, '0'), h.message('Mensagem ' + index, { at: h.env.Date.now() - 100 + index })]));
  h.api.receive('geral', batch);
  assert.equal(h.api.getState().unread, 100); assert.equal(h.calls.banners.length, 1); assert.equal(h.calls.banners[0].text, 'Mensagem 99'); assert.equal(h.calls.tones, 1); assert.equal(h.calls.vibrations.length, 1);
  h.api.receive('geral', { rapid: h.message('Logo depois') }); assert.equal(h.calls.banners.length, 2); assert.equal(h.calls.tones, 1); assert.equal(h.calls.vibrations.length, 1);
  h.advance(801); h.api.receive('geral', { later: h.message('Depois do intervalo') }); assert.equal(h.calls.tones, 2); assert.equal(h.calls.vibrations.length, 2);
});

test('a trusted first gesture restores foreground sound after reload without requesting notification permission again', async () => {
  const first = harness(); first.api.setSession('t1'); await first.api.requestPermission(); first.api.dispose();
  const h = harness({ values: first.values, permission: 'granted' }); h.api.setSession('t1'); h.api.receive('geral', {});
  assert.equal(h.api.getState().enabled, true); assert.equal(h.calls.resumes, 0);
  h.api.receive('geral', { before: h.message() }); assert.equal(h.calls.tones, 0);
  h.documentEvents.get('pointerdown')({ isTrusted: false }); assert.equal(h.calls.resumes, 0, 'synthetic events never unlock sound');
  h.documentEvents.get('keydown')({ isTrusted: true }); assert.equal(h.calls.resumes, 1); assert.equal(h.calls.permissions, 0);
  h.api.receive('geral', { after: h.message() }); assert.equal(h.calls.tones, 1);
  h.api.dispose(); assert.equal(h.documentEvents.size, 0);
  const muted = harness(); muted.api.setSession('t1'); muted.api.toggleMute(); muted.documentEvents.get('pointerdown')({ isTrusted: true }); assert.equal(muted.calls.resumes, 0);
});

test('storage events synchronize current-account mute preferences and shared delivery markers prevent duplicate tab banners', () => {
  const values = new Map(), a = harness({ values }), b = harness({ values });
  a.api.setSession('t1'); b.api.setSession('t1'); a.api.receive('geral', {}); b.api.receive('geral', {});
  const payload = { shared: a.message('Uma mensagem, um aviso') }; a.api.receive('geral', payload); b.api.receive('geral', payload);
  assert.equal(a.calls.banners.length + b.calls.banners.length, 1); assert.equal(a.api.getState().unread, 1); assert.equal(b.api.getState().unread, 1);
  a.api.toggleMute(); const key = [...values.keys()].find(key => key.endsWith('prefs:t1'));
  b.emitStorage(key, values.get(key)); assert.equal(b.api.getState().muted, true);
  b.api.receive('geral', { newer: b.message('Silenciada na outra aba') }); assert.equal(b.calls.banners.length, 0); assert.equal(b.api.getState().unread, 2);
  b.emitStorage(key.replace('t1', 'other-user'), JSON.stringify({ muted: false, enabled: true })); assert.equal(b.api.getState().muted, true);
});

test('queued Web Locks deliveries recheck read/access/session state before effects, and dispose removes listeners', async () => {
  const h = harness(), queued = [];
  h.env.navigator.locks = { request(_key, callback) { return new Promise(resolve => queued.push(() => resolve(callback()))); } };
  h.api.setSession('t1'); h.api.receive('geral', {}); h.api.receive('geral', { a: h.message() }); h.api.markRead('geral'); queued.shift()(); await flush();
  assert.equal(h.calls.banners.length, 0);
  h.api.receive('geral', { b: h.message() }); h.access.delete('geral'); queued.shift()(); await flush(); assert.equal(h.calls.banners.length, 0);
  h.access.add('geral'); h.api.receive('geral', { c: h.message() }); const beforeDispose = h.calls.changes.length; h.api.dispose(); queued.shift()(); await flush();
  assert.equal(h.calls.banners.length, 0); assert.equal(h.calls.changes.length, beforeDispose); assert.equal(h.events.size, 0); assert.equal(h.documentEvents.size, 0);
  h.api.setSession('t2'); h.api.receive('geral', { after: h.message() }); assert.equal(h.api.getState().unread, 0);
});

test('registration/show failures are contained and keep normal in-page notification behavior available', async () => {
  const h = harness({ registrationError: Error('Registration failed') }); h.api.setSession('t1'); await h.api.requestPermission();
  h.api.receive('geral', {}); h.api.receive('geral', { a: h.message() }); assert.equal(h.calls.banners.length, 1); assert.match(h.api.getState().status, /avisos na página/i);
  const bad = harness({ hidden: true, showError: Error('Notifications blocked by platform') }); bad.api.setSession('t1'); await bad.api.requestPermission();
  bad.api.receive('geral', {}); bad.api.receive('geral', { a: bad.message() }); await flush(); assert.match(bad.api.getState().status, /navegador não exibiu/i);
  bad.api.dispose(); await flush();
});
