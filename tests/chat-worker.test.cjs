const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'chat-sw.js'), 'utf8');
const scope = 'https://bancaflow.example/banca/';
const plain = value => JSON.parse(JSON.stringify(value));

function client(url, extra = {}) {
  const calls = [];
  return {
    url, focused: false, visibilityState: 'hidden', calls,
    async focus() { calls.push('focus'); await Promise.resolve(); calls.push('focused'); },
    postMessage(message) { calls.push(plain(message)); },
    ...extra
  };
}

function loadWorker(options = {}) {
  const listeners = new Map();
  const calls = { skipWaiting: 0, claim: 0, close: 0, matchAll: [], openWindow: [], waits: [], fetch: 0, cache: 0 };
  const context = {
    URL,
    fetch() { calls.fetch++; throw new Error('The notification worker must not fetch data.'); },
    self: {
      registration: { scope: options.scope || scope },
      addEventListener(type, handler) {
        assert.equal(listeners.has(type), false, `Duplicate worker listener: ${type}`);
        listeners.set(type, handler);
      },
      async skipWaiting() { calls.skipWaiting++; },
      clients: {
        async claim() { calls.claim++; },
        async matchAll(query) {
          calls.matchAll.push(plain(query));
          return options.matchAll ? options.matchAll() : options.clients || [];
        },
        async openWindow(url) { calls.openWindow.push(url); }
      }
    }
  };
  Object.defineProperty(context, 'caches', { get() { calls.cache++; throw new Error('The notification worker must not access caches.'); } });
  vm.runInNewContext(source, context, { filename: 'chat-sw.js' });
  return {
    calls, listeners,
    dispatch(type, data) {
      const waits = [];
      const event = {
        notification: { data, close() { calls.close++; } },
        waitUntil(promise) { waits.push(Promise.resolve(promise)); }
      };
      assert.equal(typeof listeners.get(type), 'function', `Missing worker listener: ${type}`);
      listeners.get(type)(event);
      calls.waits.push({ type, count: waits.length });
      return Promise.all(waits);
    }
  };
}

test('notification worker registers only lifecycle and click listeners without cache or network handlers', async () => {
  const worker = loadWorker();
  assert.deepEqual([...worker.listeners.keys()].sort(), ['activate', 'install', 'notificationclick']);
  await worker.dispatch('install');
  await worker.dispatch('activate');
  await worker.dispatch('notificationclick', { room: 'geral' });
  assert.equal(worker.calls.fetch, 0);
  assert.equal(worker.calls.cache, 0);
});

test('install and activation keep skipWaiting and client claiming alive until completion', async () => {
  const worker = loadWorker();
  await worker.dispatch('install');
  await worker.dispatch('activate');
  assert.equal(worker.calls.skipWaiting, 1);
  assert.equal(worker.calls.claim, 1);
  assert.deepEqual(worker.calls.waits, [{ type: 'install', count: 1 }, { type: 'activate', count: 1 }]);
});

test('notification click focuses the focused app client before delivering the room and account', async () => {
  const visible = client(`${scope}BancaFlow_TCC_2026_Unico.html`, { visibilityState: 'visible' });
  const focused = client(`${scope}index.html?view=dashboard`, { focused: true });
  const worker = loadWorker({ clients: [visible, focused] });
  await worker.dispatch('notificationclick', { room: 'banca-2', accountId: 'teacher-2' });
  assert.equal(worker.calls.close, 1);
  assert.deepEqual(worker.calls.matchAll, [{ type: 'window', includeUncontrolled: true }]);
  assert.deepEqual(focused.calls, ['focus', 'focused', { type: 'bancaflow-open-chat', room: 'banca-2', accountId: 'teacher-2' }]);
  assert.deepEqual(visible.calls, []);
  assert.deepEqual(worker.calls.openWindow, []);
});

test('click prefers a visible app then the first valid app when no client is focused', async () => {
  for (const visible of [true, false]) {
    const first = client(scope);
    const second = client(`${scope}BancaFlow_TCC_2026_Unico.html#chat=geral`, { visibilityState: visible ? 'visible' : 'hidden' });
    const worker = loadWorker({ clients: [first, second] });
    await worker.dispatch('notificationclick', { room: 'geral', accountId: 'professor' });
    assert.equal((visible ? second : first).calls.length, 3);
    assert.deepEqual((visible ? first : second).calls, []);
    assert.deepEqual(worker.calls.openWindow, []);
  }
});

test('click excludes other origins, folders and privacy pages and ignores an untrusted target URL', async () => {
  const ignored = [
    client('https://other.example/banca/index.html', { focused: true }),
    client('https://bancaflow.example/outra/index.html', { focused: true }),
    client(`${scope}outra/index.html`, { focused: true }),
    client(`${scope}privacidade.html`, { focused: true }),
    client(`${scope}index.html/extra`, { focused: true }),
    client('this is not a URL', { focused: true })
  ];
  const worker = loadWorker({ clients: ignored });
  const room = 'banca/ação?x=1&y=#teste';
  await worker.dispatch('notificationclick', { room, accountId: 'private-account', url: 'https://attacker.example/collect' });
  assert.deepEqual(worker.calls.openWindow, [`${scope}#chat=${encodeURIComponent(room)}`]);
  ignored.forEach(item => assert.deepEqual(item.calls, []));
  const target = new URL(worker.calls.openWindow[0]);
  assert.equal(target.origin, new URL(scope).origin);
  assert.equal(target.pathname, new URL(scope).pathname);
  assert.equal(target.search, '');
  assert.doesNotMatch(target.href, /attacker|private-account/);
});

test('malformed notification data falls back to the general room and never posts a nonstring account', async () => {
  const current = client(scope);
  const worker = loadWorker({ clients: [current] });
  await worker.dispatch('notificationclick', { room: { name: 'b1' }, accountId: { uid: 'teacher' } });
  assert.deepEqual(current.calls[2], { type: 'bancaflow-open-chat', room: 'geral', accountId: '' });
  const withoutData = loadWorker();
  await withoutData.dispatch('notificationclick');
  assert.deepEqual(withoutData.calls.openWindow, [`${scope}#chat=geral`]);
});

test('notification closes immediately while client discovery remains pending under waitUntil', async () => {
  let release;
  const pendingClients = new Promise(resolve => { release = resolve; });
  const worker = loadWorker({ matchAll: () => pendingClients });
  const completion = worker.dispatch('notificationclick', { room: 'b1' });
  assert.equal(worker.calls.close, 1);
  assert.deepEqual(worker.calls.waits, [{ type: 'notificationclick', count: 1 }]);
  assert.deepEqual(worker.calls.openWindow, []);
  release([]);
  await completion;
  assert.deepEqual(worker.calls.openWindow, [`${scope}#chat=b1`]);
});
