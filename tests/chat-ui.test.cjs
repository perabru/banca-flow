const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const chat = require('../assets/board-chat.js');

const fixture = extra => ({
  rooms: [{ id: 'geral', label: 'Sala dos professores', description: 'Conversa de todos os professores ativos.' }, { id: 'b1', label: 'Banca · Grupo 1', description: 'Avaliadores desta banca e coordenação.' }],
  roomId: 'geral', title: 'Sala dos professores', uid: 't1', connected: true, loading: false, draft: 'Olá, professores!',
  people: [{ uid: 't1', name: 'Bruno Pera', role: 'teacher' }, { uid: 'coord', name: 'Alberson', role: 'coordinator' }],
  messages: [], ...extra
});

test('plain message validation normalizes line breaks, trims and preserves intended content', () => {
  assert.equal(chat.MAX_MESSAGE_LENGTH, 2000);
  assert.equal(chat.validateMessage('  Olá!\r\nTudo bem?\rAté já.  '), 'Olá!\nTudo bem?\nAté já.');
  assert.equal(chat.validateMessage('<b>texto simples</b> 😄'), '<b>texto simples</b> 😄');
  assert.equal(chat.validateMessage('a'.repeat(2000)).length, 2000);
  for (const value of ['', '  \n\t ', undefined, null, 0, {}]) assert.throws(() => chat.validateMessage(value), /Digite uma mensagem/);
  assert.throws(() => chat.validateMessage('a'.repeat(2001)), /2\.000/);
});

test('stored messages sort chronologically by timestamp and stable Firebase key without mutating input', () => {
  const source = { z: { uid: 't1', text: 'Terceira', at: 200 }, b: { uid: 't2', text: 'Segunda', at: 100 }, a: { uid: 't1', text: 'Primeira', at: 100 }, missing: null, invalid: { text: 4 } };
  const before = JSON.stringify(source), rows = chat.sortedMessages(source);
  assert.deepEqual(rows.map(message => message.id), ['a', 'b', 'z']);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(chat.sortedMessages([{ id: 'two', text: 'B', at: 20 }, { id: 'one', text: 'A', at: 10 }]).map(message => message.id), ['one', 'two']);
  assert.deepEqual(chat.sortedMessages(null), []);
});

test('equal timestamps use Firebase push-key lexical order rather than locale collation', () => {
  const messages = ['-aB', '-_x', '-Az'].map(id => ({ id, text: id, at: 1700000000000 }));
  assert.deepEqual(chat.sortedMessages(messages).map(message => message.id), ['-Az', '-_x', '-aB']);
});

test('empty conversation contains truthful online roster, room selector and accessible composer', () => {
  const html = chat.renderChat(fixture());
  assert.match(html, /data-chat-panel="geral"/);
  assert.match(html, /id="chat-room-select"/);
  assert.match(html, /value="geral" selected/);
  assert.match(html, /A conversa começa aqui/);
  assert.match(html, /role="log".*aria-live="polite"/);
  assert.match(html, /id="chat-form".*data-chat-room="geral"/);
  assert.match(html, /id="chat-message".*maxlength="2000"/);
  assert.match(html, /id="chat-character-count">17 \/ 2.000/);
  assert.match(html, /Alberson/);
  assert.match(html, /Coordenação e avaliação/);
  assert.match(html, /Bruno Pera.*\(você\)/);
  assert.doesNotMatch(html.match(/<button type="submit"[^>]*>/)[0], /disabled/);
});

test('message and metadata content is escaped, multiline and never creates user HTML or autolinks', () => {
  const attack = '</textarea><img src=x onerror=alert(1)>';
  const html = chat.renderChat(fixture({
    roomId: 'b1', title: '<img title="board">', roomDescription: '<script>run()</script>', draft: attack,
    messages: [{ id: '" onclick="run()', uid: 't1', name: '<b>Bruno</b>', text: '<script>alert(1)</script>\nhttps://example.test/?a=1&b=2', at: 1700000000000 }],
    people: [{ uid: '"bad', name: '<svg onload=run()>', role: 'teacher' }]
  }));
  assert.doesNotMatch(html, /<script>|<img|<b>Bruno|<a\s|onclick="run/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\nhttps:\/\/example\.test\/\?a=1&amp;b=2/);
  assert.match(html, /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /bf-chat-message-own/);
  assert.match(html, /datetime="2023-11-14T22:13:20\.000Z"/);
});

test('offline and sending prevent duplicate submission while keeping the text editable', () => {
  for (const extra of [{ connected: false }, { sending: true }, { loading: true }, { error: 'Não foi possível carregar esta sala.' }, { draft: '' }]) {
    const html = chat.renderChat(fixture(extra));
    assert.match(html.match(/<button type="submit"[^>]*>/)[0], /disabled/);
    assert.doesNotMatch(html.match(/<textarea[^>]*>/)[0], /disabled/);
  }
  const offline = chat.renderChat(fixture({ connected: false }));
  assert.match(offline, /Sua mensagem permanece em edição/);
  assert.doesNotMatch(offline, /data-chat-person=/);
  assert.match(offline, /presença será atualizada ao reconectar/);
  assert.match(offline, /Olá, professores!/);
});

test('chat connection badge is green only after the conversation is ready without errors', () => {
  const cases = [
    { extra: {}, label: 'Chat conectado', ready: true },
    { extra: { loading: true }, label: 'Conectando ao chat', ready: false },
    { extra: { error: 'Acesso à sala indisponível.' }, label: 'Chat indisponível', ready: false },
    { extra: { loading: true, error: 'Acesso à sala indisponível.' }, label: 'Chat indisponível', ready: false },
    { extra: { connected: false, loading: true, error: 'Acesso à sala indisponível.' }, label: 'Sem conexão', ready: false }
  ];
  for (const { extra, label, ready } of cases) {
    const html = chat.renderChat(fixture(extra));
    const badge = html.match(/<span class="bf-chat-connection[^"]*">[\s\S]*?<\/span>/)[0];
    assert.ok(badge.includes(`>${label}</span>`), `Expected connection label: ${label}`);
    assert.equal(badge.includes(' is-online'), ready, `Unexpected ready indicator for: ${label}`);
  }
  const unavailable = chat.renderChat(fixture({ error: 'Acesso à sala indisponível.' }));
  assert.match(unavailable, /data-chat-person="t1"/);
  assert.match(unavailable.match(/<button type="submit"[^>]*>/)[0], /disabled/);
  assert.doesNotMatch(unavailable.match(/<textarea[^>]*>/)[0], /disabled/);
});

test('history, loading and retry controls are explicit and unavailable history is not fabricated', () => {
  const html = chat.renderChat(fixture({ roomId: 'b1', hasMore: true, loadingOlder: true, error: 'Acesso indisponível <temporário>.' }));
  assert.match(html, /data-chat-older="1" disabled/);
  assert.match(html, /Carregando histórico/);
  assert.match(html, /data-chat-retry="1"/);
  assert.match(html, /Acesso indisponível &lt;temporário&gt;/);
  assert.doesNotMatch(chat.renderChat(fixture()), /data-chat-older|data-chat-retry/);
  assert.match(chat.renderChat(fixture({ loading: true })), /Carregando mensagens/);
  assert.match(chat.renderChat({ rooms: [], roomId: '' }), /Nenhuma sala disponível/);
});

test('presence deduplicates sessions by UID, sorts names and treats timestamps without coercion', () => {
  const html = chat.renderChat(fixture({
    people: [{ uid: 't1', name: 'Bruno' }, { uid: 'coord', name: 'Alberson' }, { uid: 't1', name: 'Bruno Pera' }],
    messages: [{ id: '1', text: 'Sem data', at: '1700000000000' }, { id: '2', text: 'Data zero válida', at: 0 }]
  }));
  assert.equal((html.match(/data-chat-person=/g) || []).length, 2);
  assert.ok(html.indexOf('data-chat-person="coord"') < html.indexOf('data-chat-person="t1"'));
  assert.match(html, /Horário indisponível/);
  assert.match(html, /datetime="1970-01-01T00:00:00\.000Z"/);
});

test('browser global exposes the same dependency-free public API', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(__dirname, '..', 'assets/board-chat.js'), 'utf8'), context);
  assert.equal(typeof context.BancaChat.renderChat, 'function');
  assert.equal(context.BancaChat.validateMessage(' Oi '), 'Oi');
  assert.match(context.BancaChat.renderChat(fixture()), /Sala dos professores/);
});
