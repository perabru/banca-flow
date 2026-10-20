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

test('notification permission controls explain every browser state without changing message submission', () => {
  const cases = [
    { permission: 'default', enabled: false, label: 'Ativar notificações', disabled: false, help: /depende da permissão deste navegador/ },
    { permission: 'granted', enabled: false, label: 'Ativar notificações', disabled: false, help: /depende da permissão deste navegador/ },
    { permission: 'granted', enabled: true, label: 'Notificações ativadas', disabled: true, help: /autorizadas neste navegador/ },
    { permission: 'denied', enabled: false, label: 'Verificar permissão', disabled: false, help: /configurações deste site no navegador/ },
    { permission: 'unsupported', enabled: false, label: 'Ativar notificações', disabled: true, help: /não estão disponíveis neste navegador/ }
  ];
  for (const { permission, enabled, label, disabled, help } of cases) {
    const html = chat.renderChat(fixture({ alerts: { permission, enabled } }));
    const button = html.match(/<button[^>]*data-chat-notify="1"[^>]*>[\s\S]*?<\/button>/)[0];
    assert.match(button, /type="button"/);
    assert.ok(button.includes(`<span>${label}</span>`), `Unexpected notification action for: ${permission}`);
    assert.equal(/\sdisabled[\s>]/.test(button), disabled, `Unexpected notification availability for: ${permission}`);
    assert.match(html, help);
    assert.match(html, /Avisos de novas mensagens neste dispositivo\./);
    assert.doesNotMatch(html.match(/<button type="submit"[^>]*>/)[0], /disabled/);
    assert.match(html, /id="chat-room-select"/);
    assert.match(html, /id="chat-form"/);
  }
});

test('mute is an explicit accessible toggle and leaves the conversation and roster available', () => {
  for (const muted of [false, true]) {
    const html = chat.renderChat(fixture({ alerts: { permission: 'granted', enabled: true, muted, status: 'Preferência salva.' } }));
    const button = html.match(/<button[^>]*data-chat-mute="1"[^>]*>[\s\S]*?<\/button>/)[0];
    assert.match(button, /type="button"/);
    assert.ok(button.includes(`aria-pressed="${muted}"`));
    assert.ok(button.includes(`<span>${muted ? 'Reativar avisos' : 'Silenciar'}</span>`));
    assert.doesNotMatch(button, /disabled/);
    assert.match(html, /id="chat-alerts-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    assert.match(html, /Preferência salva\./);
    if (muted) assert.match(html, /Sons, notificações e avisos na página estão silenciados\./);
    assert.match(html, /data-chat-person="t1"/);
    assert.doesNotMatch(html.match(/<textarea[^>]*>/)[0], /disabled/);
    assert.doesNotMatch(html.match(/<button type="submit"[^>]*>/)[0], /disabled/);
  }
});

test('notification feedback escapes user text and unread counts accept only positive safe integers', () => {
  const attack = '</p><img src=x onerror=alert(1)>';
  const html = chat.renderChat(fixture({ alerts: { permission: 'default', status: attack, unread: 150 } }));
  assert.match(html, /&lt;\/p&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /data-chat-unread="150" aria-label="150 mensagens não lidas">99\+<\/span>/);
  const single = chat.renderChat(fixture({ alerts: { permission: 'default', unread: 1 } }));
  assert.match(single, /aria-label="1 mensagem não lida">1<\/span>/);
  for (const unread of [0, -1, NaN, Infinity, 1.5, '4', attack, Number.MAX_SAFE_INTEGER + 1]) {
    assert.doesNotMatch(chat.renderChat(fixture({ alerts: { unread } })), /data-chat-unread=/);
  }
  const unknownPermission = chat.renderChat(fixture({ alerts: { permission: attack, enabled: true } }));
  assert.match(unknownPermission.match(/<button[^>]*data-chat-notify="1"[^>]*>/)[0], /disabled/);
  assert.doesNotMatch(unknownPermission, /<img|Notificações ativadas/);
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

test('send errors preserve the editable draft and allow a manual retry independently of conversation errors', () => {
  const options = fixture({ sendError: 'Envio recusado <temporariamente>.', draft: 'Mensagem preservada\npara reenviar' });
  for (let render = 0; render < 2; render++) {
    const html = chat.renderChat(options);
    assert.match(html, /id="chat-send-error"[^>]*role="alert"/);
    assert.match(html, /data-chat-send-error="1"/);
    assert.match(html, /Envio recusado &lt;temporariamente&gt;\./);
    assert.match(html, /aria-describedby="[^"]*chat-send-error"/);
    assert.match(html, />Mensagem preservada\npara reenviar<\/textarea>/);
    assert.match(html, /Você pode tentar enviar novamente/);
    assert.doesNotMatch(html.match(/<button type="submit"[^>]*>/)[0], /disabled/);
    assert.doesNotMatch(html.match(/<textarea[^>]*>/)[0], /disabled/);
    assert.match(html, /data-chat-person="t1"/);
    assert.doesNotMatch(html, /data-chat-retry="1"/);
  }
  const readError = chat.renderChat({ ...options, error: 'Não foi possível ler o histórico.' });
  assert.match(readError, /Não foi possível ler o histórico/);
  assert.match(readError, /Mensagem não enviada/);
  assert.match(readError.match(/<button type="submit"[^>]*>/)[0], /disabled/);
});

test('copying access rules is offered only with a send error and an explicit capability', () => {
  const enabled = chat.renderChat(fixture({ sendError: 'Permissão negada <temporariamente>.', canCopyAccessPolicy: true }));
  const alert = enabled.match(/<div id="chat-send-error"[^>]*>[\s\S]*?<\/div>/)[0];
  assert.match(alert, /<button type="button" class="btn soft" data-copy-policy="1">Copiar regras de acesso<\/button>/);
  assert.match(alert, /Permissão negada &lt;temporariamente&gt;\./);
  assert.doesNotMatch(enabled.match(/<button type="submit"[^>]*>/)[0], /disabled/);
  for (const extra of [{ canCopyAccessPolicy: true }, { sendError: 'Permissão negada.' }, { sendError: 'Permissão negada.', canCopyAccessPolicy: false }, { sendError: 'Permissão negada.', canCopyAccessPolicy: 'true' }]) {
    assert.doesNotMatch(chat.renderChat(fixture(extra)), /data-copy-policy|Copiar regras de acesso/);
  }
});

test('only pending own messages show sending and confirmed own messages show sent without read claims', () => {
  const html = chat.renderChat(fixture({
    pendingIds: ['pending', 'other'],
    messages: [
      { id: 'pending', uid: 't1', name: 'Bruno', text: 'A caminho', at: 1 },
      { id: 'sent', uid: 't1', name: 'Bruno', text: 'Confirmada', at: 2 },
      { id: 'other', uid: 't2', name: 'Outra professora', text: 'Recebida', at: 3 }
    ]
  }));
  const article = id => html.match(new RegExp(`<article[^>]*data-chat-message="${id}"[\\s\\S]*?<\\/article>`))[0];
  assert.match(article('pending'), /bf-chat-message-pending/);
  assert.match(article('pending'), /data-chat-delivery="pending"/);
  assert.match(article('pending'), /aria-label="Mensagem em envio">Enviando…<\/span>/);
  assert.doesNotMatch(article('pending'), />Enviada</);
  assert.match(article('sent'), /aria-label="Mensagem enviada">Enviada<\/span>/);
  assert.match(article('sent'), /data-chat-delivery="sent"/);
  assert.doesNotMatch(article('sent'), /bf-chat-message-pending|is-pending/);
  assert.doesNotMatch(article('other'), /bf-chat-message-delivery|Enviando…|Enviada/);
  assert.doesNotMatch(html, /Mensagem lida|Visualizada/);
});

test('edit and delete actions belong only to confirmed own messages', () => {
  const html = chat.renderChat(fixture({ pendingIds: ['pending'], messages: {
    own: { uid: 't1', name: 'Bruno', text: 'Mensagem enviada', at: 1 },
    other: { uid: 't2', name: 'Professora', text: 'Outra mensagem', at: 2 },
    pending: { uid: 't1', name: 'Bruno', text: 'Ainda enviando', at: 3 },
    removed: { uid: 't1', name: 'Bruno', text: '', at: 4, deletedAt: 5, revision: 1 }
  } }));
  const article = id => html.match(new RegExp(`<article[^>]*data-chat-message="${id}"[\\s\\S]*?<\\/article>`))[0];
  assert.match(article('own'), /type="button" data-chat-edit="own" aria-label="Editar sua mensagem"/);
  assert.match(article('own'), /type="button" data-chat-delete="own" aria-label="Apagar sua mensagem para todos"/);
  for (const id of ['other', 'pending', 'removed']) assert.doesNotMatch(article(id), /data-chat-edit=|data-chat-delete=|data-chat-delete-confirm=/);
  assert.doesNotMatch(article('own').match(/<button[^>]*data-chat-edit[^>]*>/)[0], /disabled/);
  for (const extra of [{ connected: false }, { loading: true }, { error: 'Falha na conversa.' }, { mutation: { room: 'geral', id: 'other', kind: 'edit', busy: true } }]) {
    const state = chat.renderChat(fixture({ ...extra, messages: { own: { uid: 't1', name: 'Bruno', text: 'Confirmada', at: 1 } } }));
    for (const control of ['edit', 'delete']) assert.match(state.match(new RegExp(`<button[^>]*data-chat-${control}="own"[^>]*>`))[0], /disabled/);
  }
});

test('editing renders an escaped inline form without changing the new-message draft', () => {
  const attack = '</textarea><img src=x onerror=run()>';
  const html = chat.renderChat(fixture({ draft: 'Nova mensagem não enviada', messages: { own: { uid: 't1', name: 'Bruno', text: 'Texto atual', at: 1 } }, mutation: { room: 'geral', id: 'own', kind: 'edit', text: attack, busy: false, error: 'Falha <temporária>' } }));
  assert.match(html, /id="chat-edit-form"[^>]*data-chat-room="geral" data-chat-id="own"/);
  assert.match(html, /<label for="chat-edit-message">Editar sua mensagem<\/label>/);
  assert.match(html, /id="chat-edit-message" name="message"[^>]*maxlength="2000"[^>]*aria-describedby="chat-edit-help chat-mutation-error"/);
  assert.match(html, /&lt;\/textarea&gt;&lt;img src=x onerror=run\(\)&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /id="chat-mutation-error"[^>]*role="alert"/);
  assert.match(html, /Falha &lt;temporária&gt;/);
  assert.match(html, /A alteração ficará visível para todos nesta sala\./);
  assert.match(html, /data-chat-mutation-cancel="1"/);
  assert.match(html, /id="chat-message"[^>]*>Nova mensagem não enviada<\/textarea>/);
  assert.doesNotMatch(html, /data-chat-edit="own"|data-chat-delete="own"/);
  assert.doesNotMatch(html.match(/<form id="chat-edit-form"[\s\S]*?<button type="submit"[^>]*>/)[0], /disabled/);
});

test('edit actions keep draft text available and prevent empty, offline and repeated saves', () => {
  const base = fixture({ messages: { own: { uid: 't1', text: 'Original', at: 1 } }, mutation: { room: 'geral', id: 'own', kind: 'edit', text: 'Alteração', busy: false } });
  for (const extra of [{ connected: false }, { loading: true }, { error: 'Não conectado' }, { mutation: { ...base.mutation, text: ' \n ' } }, { mutation: { ...base.mutation, text: 'a'.repeat(2001) } }, { mutation: { ...base.mutation, busy: true } }]) {
    const html = chat.renderChat({ ...base, ...extra });
    assert.match(html.match(/<form id="chat-edit-form"[\s\S]*?<button type="submit"[^>]*>/)[0], /disabled/);
    const textarea = html.match(/<textarea id="chat-edit-message"[^>]*>/)[0];
    assert.equal(/disabled/.test(textarea), extra.mutation?.busy === true);
    const cancel = html.match(/<button[^>]*data-chat-mutation-cancel="1"[^>]*>/)[0];
    assert.equal(/disabled/.test(cancel), extra.mutation?.busy === true);
    if (extra.mutation?.busy) assert.match(html, /Salvando alteração…/);
  }
});

test('deletion requires a separate confirmation and preserves other conversation controls', () => {
  const base = fixture({ messages: { own: { uid: 't1', text: 'Texto a apagar', at: 1 } }, mutation: { room: 'geral', id: 'own', kind: 'delete', busy: false } });
  const html = chat.renderChat(base);
  assert.match(html, /Apagar esta mensagem\?/);
  assert.match(html, /O texto será removido para todos os participantes desta sala\./);
  assert.match(html, /<button type="button"[^>]*data-chat-delete-confirm="own"/);
  assert.match(html, /data-chat-mutation-cancel="1"/);
  assert.match(html, /Texto a apagar/);
  assert.match(html, /id="chat-form"/);
  assert.doesNotMatch(html, /id="chat-edit-form"|data-chat-edit="own"|data-chat-delete="own"/);
  for (const extra of [{ connected: false }, { loading: true }, { error: 'Erro na conversa' }, { mutation: { ...base.mutation, busy: true } }]) {
    const waiting = chat.renderChat({ ...base, ...extra });
    assert.match(waiting.match(/<button[^>]*data-chat-delete-confirm="own"[^>]*>/)[0], /disabled/);
    if (extra.mutation?.busy) assert.match(waiting, /Apagando mensagem…/);
  }
});

test('deleted messages retain stable chronology and never expose their previous text or edit actions', () => {
  const rows = {
    removed: { uid: 't1', name: 'Bruno', text: 'Texto antigo que deve ficar oculto', at: 1, deletedAt: 10, editedAt: 5 },
    legacy: { uid: 't2', name: 'Professora', at: 2, deletedAt: 11 },
    edited: { uid: 't2', name: 'Professora', text: 'Texto corrigido', at: 3, editedAt: 9 }
  };
  assert.deepEqual(chat.sortedMessages(rows).map(row => row.id), ['removed', 'legacy', 'edited']);
  const html = chat.renderChat(fixture({ messages: rows, mutation: { room: 'geral', id: 'removed', kind: 'edit', text: 'Não pode editar' } }));
  assert.equal((html.match(/Mensagem apagada/g) || []).length, 2);
  assert.doesNotMatch(html, /Texto antigo|Não pode editar|data-chat-edit=|data-chat-delete=|id="chat-edit-form"/);
  assert.match(html, /Texto corrigido/);
  assert.equal((html.match(/>editada<\/span>/g) || []).length, 1);
  assert.match(html, /aria-relevant="additions text"/);
  const removedArticle = html.match(/<article[^>]*data-chat-message="removed"[\s\S]*?<\/article>/)[0];
  assert.doesNotMatch(removedArticle, /data-chat-delivery=|editada/);
});

test('inline mutation cannot target another author, room, pending message or unknown message', () => {
  const base = fixture({ messages: { own: { uid: 't1', text: 'Minha mensagem', at: 1 }, other: { uid: 't2', text: 'Outra mensagem', at: 2 } } });
  for (const mutation of [
    { room: 'geral', id: 'other', kind: 'edit' },
    { room: 'b1', id: 'own', kind: 'delete' },
    { room: 'geral', id: 'missing', kind: 'edit' },
    { room: 'geral', id: 'own', kind: '<script>' }
  ]) assert.doesNotMatch(chat.renderChat({ ...base, mutation }), /id="chat-edit-form"|data-chat-delete-confirm=/);
  assert.doesNotMatch(chat.renderChat({ ...base, pendingIds: ['own'], mutation: { room: 'geral', id: 'own', kind: 'delete' } }), /data-chat-delete-confirm=/);
});

test('mutation errors offer rules only with an explicit permission capability', () => {
  const base = fixture({ messages: { own: { uid: 't1', text: 'Mensagem', at: 1 } }, mutation: { room: 'geral', id: 'own', kind: 'edit', text: 'Nova mensagem', error: 'Acesso negado' } });
  assert.match(chat.renderChat({ ...base, canCopyAccessPolicy: true }), /data-copy-policy="1"/);
  for (const capability of [false, undefined, 'true']) assert.doesNotMatch(chat.renderChat({ ...base, canCopyAccessPolicy: capability }), /data-copy-policy=/);
  assert.doesNotMatch(chat.renderChat({ ...base, mutation: { ...base.mutation, error: '' }, canCopyAccessPolicy: true }), /data-copy-policy=/);
});

test('empty error and loading states never suggest the room has no previous conversation', () => {
  for (const extra of [{ error: 'Falha na leitura.' }, { error: 'Falha na leitura.', loading: true }]) {
    const html = chat.renderChat(fixture(extra));
    assert.match(html, /Não foi possível carregar as mensagens/);
    assert.doesNotMatch(html, /A conversa começa aqui|Envie a primeira mensagem/);
  }
  const loading = chat.renderChat(fixture({ loading: true }));
  assert.match(loading, /Carregando mensagens/);
  assert.doesNotMatch(loading, /A conversa começa aqui|Envie a primeira mensagem/);
  const existing = chat.renderChat(fixture({ error: 'Falha ao atualizar.', messages: [{ id: 'm1', uid: 't2', text: 'Histórico preservado', at: 1 }] }));
  assert.match(existing, /Histórico preservado/);
  assert.doesNotMatch(existing, /class="bf-chat-empty"/);
});

test('conversation refresh and latest-message controls are explicit buttons without implicit message submission', () => {
  const empty = chat.renderChat(fixture());
  const refresh = empty.match(/<button[^>]*data-chat-refresh="1"[^>]*>/)[0];
  assert.match(refresh, /type="button"/);
  assert.doesNotMatch(refresh, /disabled/);
  assert.match(empty, />Atualizar conversa<\/button>/);
  assert.doesNotMatch(empty, /data-chat-latest/);
  const existing = chat.renderChat(fixture({ messages: [{ id: 'm1', uid: 't2', text: 'Mensagem', at: 1 }] }));
  const latest = existing.match(/<button[^>]*data-chat-latest="1"[^>]*>/)[0];
  assert.match(latest, /type="button"/);
  assert.match(latest, /aria-controls="chat-message-list"/);
  assert.match(existing, />Últimas mensagens<\/button>/);
  const noRoom = chat.renderChat({ rooms: [], roomId: '' });
  assert.match(noRoom.match(/<button[^>]*data-chat-refresh="1"[^>]*>/)[0], /disabled/);
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
