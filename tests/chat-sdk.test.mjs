/**
 * Actual Firebase SDK callbacks, optimistic writes and server acknowledgements.
 * Uses only an explicitly configured local emulator and fictional demo projects.
 * Run separately or together with rules.test.mjs; each scenario has its own namespace.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(process.env.BANCAFLOW_RULES_DEPS
  ? join(process.env.BANCAFLOW_RULES_DEPS, 'package.json')
  : import.meta.url);
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/database');
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(rootDir, 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s.+?;\s*$/gm, '');
const chatSource = await readFile(join(rootDir, 'assets/board-chat.js'), 'utf8');
const rules = JSON.parse(await readFile(join(rootDir, 'database.rules.json'), 'utf8'));
const [host = '127.0.0.1', port = '9000'] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[key];
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fixture = () => ({
  users: {
    legacy: { name: 'Professor já cadastrado', role: 'teacher' },
    newcomer: { name: 'Professora recém-cadastrada', email: 'new@example.test', key: 'nova', role: 'teacher', active: true }
  },
  groups: { g1: { id: 'g1', name: 'Grupo preservado', students: { s1: 'Ana' } } },
  boards: { b1: { groupId: 'g1', members: { other: true } } },
  grades: { b1: { other: { s1: { presentation: 8, practice: 9, code: 7, time: 8 } } } },
  deliveries: { b1: { s1: 9 } },
  timers: { b1: { elapsedMs: 900010, startedAt: 0, revision: 1 } }
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 8000) throw Error(`Timed out waiting for ${description}`);
    await pause(20);
  }
}
async function environment(t, name, policy = rules) {
  const projectId = `demo-banca-flow-chat-sdk-${name}`;
  const configuration = { projectId, database: { host, port: Number(port), rules: JSON.stringify(policy) } };
  const env = await initializeTestEnvironment(configuration);
  t.after(() => env.cleanup());
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(ctx => sdk.set(sdk.ref(ctx.database()), fixture()));
  return { env, configuration };
}
async function privileged(env, path = '') {
  let value;
  await env.withSecurityRulesDisabled(async ctx => { value = (await sdk.get(path ? sdk.ref(ctx.database(), path) : sdk.ref(ctx.database()))).val(); });
  return value;
}

function session(t, env, uid) {
  const database = env.authenticatedContext(uid).database();
  const elements = new Map(), subscriptions = new Set(), timeouts = new Set();
  const snapshots = [], renders = [];
  const element = selector => {
    if (!elements.has(selector)) {
      const node = {
        textContent: '', value: '', dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
        setAttribute() {}, focus() {}, scrollIntoView() {}, remove() {}, querySelectorAll() { return []; },
        showModal() { this.open = true; }, close() { this.open = false; }
      };
      let markup = '';
      Object.defineProperty(node, 'innerHTML', {
        get() { return markup; },
        set(value) { markup = String(value); if (selector === '#chat-widget-content') renders.push(markup); }
      });
      elements.set(selector, node);
    }
    return elements.get(selector);
  };
  class FormDataAdapter {
    constructor(form) { this.values = form.values || {}; }
    get(key) { return this.values[key] ?? null; }
    getAll(key) { return [].concat(this.values[key] || []); }
  }
  const context = vm.createContext({
    console, Date, Blob, File, TextEncoder, TextDecoder, Uint8Array, Uint32Array, URL, atob, btoa,
    crypto: { randomUUID: () => `chat-sdk-${uid}` }, FormData: FormDataAdapter,
    window: { scrollTo() {}, addEventListener() {} }, navigator: {},
    document: {
      hidden: false, body: { classList: { add() {}, remove() {} } },
      querySelector: element, querySelectorAll: () => [],
      getElementById: id => id === 'roster-criptografado' ? { textContent: '{}' } : element('#' + id)
    },
    setInterval() {}, clearInterval() {},
    setTimeout(callback, ms = 0) { const id = setTimeout(() => { timeouts.delete(id); callback(); }, ms); timeouts.add(id); return id; },
    clearTimeout(id) { timeouts.delete(id); clearTimeout(id); },
    requestAnimationFrame(callback) { return setTimeout(callback, 0); }, cancelAnimationFrame: clearTimeout,
    initializeApp: () => ({}), getAuth: () => ({ currentUser: { uid } }), getDatabase: () => database,
    onAuthStateChanged: () => () => {},
    ref: (_database, path = '') => sdk.ref(database, path),
    get: sdk.get, set: sdk.set, update: sdk.update, remove: sdk.remove,
    push: sdk.push, serverTimestamp: sdk.serverTimestamp, query: sdk.query,
    orderByChild: sdk.orderByChild, limitToLast: sdk.limitToLast, endBefore: sdk.endBefore,
    onDisconnect: sdk.onDisconnect, runTransaction: sdk.runTransaction,
    onValue(target, callback, error) {
      const off = sdk.onValue(target, snapshot => {
        snapshots.push({ path: target.toString(), data: clone(snapshot.val()) });
        callback(snapshot);
      }, error);
      subscriptions.add(off);
      return () => { subscriptions.delete(off); off(); };
    }
  });
  vm.runInContext(chatSource, context, { filename: 'assets/board-chat.js' });
  vm.runInContext(source + `
    render = () => { if (state.user) { renderChatWidget(); syncChat(); } };
    refreshTimerUi = () => {};
    globalThis.chatSdkTest = { state, openGeneralChat, sendChatMessage, retryChat, stopChat, onlineChatPeople, chatView };
  `, context, { filename: 'index.html.inline-module.js' });
  const app = context.chatSdkTest;
  const data = fixture();
  Object.assign(app.state, clone(data), { user: { uid }, profile: clone(data.users[uid]), connected: true });
  t.after(async () => {
    app.stopChat();
    for (const off of subscriptions) off();
    for (const id of timeouts) clearTimeout(id);
  });
  return { app, database, snapshots, renders };
}
const send = (app, text) => app.sendChatMessage({ dataset: { chatRoom: 'geral' }, values: { message: text } });
const messages = app => Object.values(app.state.chatMessages);

test('real SDK shares general chat and server timestamps between legacy and new teachers without banks', { timeout: 25000 }, async t => {
  const { env } = await environment(t, 'valid');
  const before = await privileged(env);
  const first = session(t, env, 'legacy'), second = session(t, env, 'newcomer');
  first.app.openGeneralChat(); second.app.openGeneralChat();
  assert.equal(first.app.state.route, 'inicio', 'opening the floating chat preserves the current page');
  assert.equal(first.app.state.chatOpen, true);
  await until(() => !first.app.state.chatLoading && !second.app.state.chatLoading, 'initial room snapshots');
  await until(() => first.app.onlineChatPeople().length === 2 && second.app.onlineChatPeople().length === 2, 'both teachers online');
  await send(first.app, 'Podemos iniciar a conversa?');
  await until(() => messages(second.app).some(message => message.text === 'Podemos iniciar a conversa?'), 'first message on the other session');
  await send(second.app, 'Sim, este é meu primeiro acesso.');
  await until(() => messages(first.app).length === 2 && messages(second.app).length === 2, 'response on both sessions');
  const stored = await privileged(env, 'chatMessages/geral');
  assert.equal(Object.keys(stored).length, 2);
  for (const [id, message] of Object.entries(stored)) {
    assert.match(id, /^[-0-9A-Z_a-z]{20}$/);
    assert.equal(typeof message.at, 'number');
    assert.equal(Number.isInteger(message.at), true);
    assert.equal(message.name, before.users[message.uid].name);
  }
  assert.equal(first.app.state.chatPendingIds.size, 0);
  assert.equal(second.app.state.chatPendingIds.size, 0);
  const after = await privileged(env);
  for (const root of ['users', 'groups', 'boards', 'grades', 'deliveries', 'timers']) assert.deepEqual(after[root], before[root], root);
});

test('real SDK rollback removes a rejected local message and a permitted retry reaches the other teacher exactly once', { timeout: 25000 }, async t => {
  const denied = clone(rules);
  denied.rules.chatMessages.$room.$mid['.write'] = false;
  const { env, configuration } = await environment(t, 'rollback', denied);
  const first = session(t, env, 'legacy'), second = session(t, env, 'newcomer');
  first.app.openGeneralChat(); second.app.openGeneralChat();
  await until(() => !first.app.state.chatLoading && !second.app.state.chatLoading, 'readable common room');
  await until(() => first.app.onlineChatPeople().length === 2, 'presence despite message write denial');
  const text = 'Mensagem que exige confirmação do servidor.';
  await assert.rejects(send(first.app, text), error => /permission.?denied/i.test(`${error.code} ${error.message}`));
  await until(() => first.app.state.chatPendingIds.size === 0, 'pending write cleanup');
  assert.ok(first.snapshots.some(snapshot => snapshot.path.includes('/chatMessages/geral') && Object.values(snapshot.data || {}).some(message => message.text === text)), 'the actual SDK emitted an optimistic local value before the server rejected it');
  assert.ok(first.renders.some(markup => /data-chat-delivery="pending"/.test(markup)), 'optimistic delivery is labelled as pending');
  assert.equal(messages(first.app).some(message => message.text === text), false, 'rejected optimistic data is removed from the sender');
  assert.equal(messages(second.app).length, 0, 'the other teacher receives no uncommitted message');
  assert.equal(await privileged(env, 'chatMessages/geral'), null);
  assert.equal(first.app.state.chatDrafts.get('geral'), text);
  assert.ok(first.app.state.chatSendError, 'write error persists beside the composer');
  assert.equal(first.app.state.chatSending, false);
  const allowedEnvironment = await initializeTestEnvironment({ ...configuration, database: { ...configuration.database, rules: JSON.stringify(rules) } });
  t.after(() => allowedEnvironment.cleanup());
  await send(first.app, text);
  await until(() => messages(second.app).some(message => message.text === text), 'permitted retry on the other teacher');
  const stored = await privileged(env, 'chatMessages/geral');
  assert.equal(Object.keys(stored).length, 1, 'retry commits exactly one message');
  assert.equal(messages(first.app).length, 1);
  assert.equal(messages(second.app).length, 1);
  assert.equal(first.app.state.chatPendingIds.size, 0);
  assert.equal(first.app.state.chatDrafts.has('geral'), false);
  assert.equal(first.app.state.chatSendError, '');
});
