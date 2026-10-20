/* Interface do chat: texto simples, salas identificadas e presença recebida do servidor. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_MESSAGE_LENGTH = 2000;
  const list = value => Array.isArray(value) ? value : [];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const line = value => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : null;
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
  const CHAT = icon('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>');
  const SEND = icon('<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>');

  function validateMessage(value) {
    if (typeof value !== 'string') throw new TypeError('Digite uma mensagem.');
    const message = value.replace(/\r\n?/g, '\n').trim();
    if (!message) throw new Error('Digite uma mensagem.');
    if (message.length > MAX_MESSAGE_LENGTH) throw new Error('A mensagem deve ter no máximo 2.000 caracteres.');
    return message;
  }

  function sortedMessages(input) {
    const entries = Array.isArray(input) ? input.map((message, index) => [String(message?.id ?? index), message]) : input && typeof input === 'object' ? Object.entries(input) : [];
    return entries.filter(([, message]) => message && typeof message === 'object' && typeof message.text === 'string').map(([id, message]) => ({ ...message, id })).sort((a, b) => (timestamp(a.at) ?? 0) - (timestamp(b.at) ?? 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  }

  function initials(value) {
    return line(value).split(' ').filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR') || 'P';
  }

  function dateLabel(value) {
    const at = timestamp(value);
    if (at === null) return 'Horário indisponível';
    return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderChat(options = {}) {
    const rooms = list(options.rooms), roomId = String(options.roomId ?? ''), uid = String(options.uid ?? '');
    const room = rooms.find(item => String(item?.id ?? '') === roomId);
    const title = line(options.title) || line(room?.label) || 'Sala dos professores';
    const description = line(options.roomDescription) || line(room?.description);
    const connected = options.connected === true, loading = options.loading === true, sending = options.sending === true;
    const error = line(options.error), draft = String(options.draft ?? '');
    const messages = sortedMessages(options.messages);
    const people = connected ? [...new Map(list(options.people).filter(person => person && person.uid).map(person => [String(person.uid), person])).values()].sort((a, b) => line(a.name).localeCompare(line(b.name), 'pt-BR')) : [];
    const cannotSend = !connected || loading || sending || !!error || !room || !draft.trim();
    const status = sending ? 'Enviando mensagem…' : !connected ? 'Sem conexão. Sua mensagem permanece em edição.' : loading ? 'Carregando a conversa…' : error ? 'O envio estará disponível quando a conversa for reconectada.' : 'As mensagens aparecem para os participantes desta sala.';
    const body = messages.length ? messages.map(message => {
      const own = uid && String(message.uid ?? '') === uid, name = line(message.name) || 'Professor';
      const at = timestamp(message.at), datetime = at === null ? '' : ` datetime="${esc(new Date(at).toISOString())}"`;
      return `<article class="bf-chat-message${own ? ' bf-chat-message-own' : ''}" data-chat-message="${esc(message.id)}"><div class="bf-chat-message-meta"><strong>${esc(name)}${own ? '<span>Você</span>' : ''}</strong><time${datetime}>${esc(dateLabel(message.at))}</time></div><p>${esc(message.text)}</p></article>`;
    }).join('') : `<div class="bf-chat-empty">${CHAT}<strong>${loading ? 'Carregando mensagens' : 'A conversa começa aqui'}</strong><p>${loading ? 'Aguarde a atualização da sala.' : 'Envie a primeira mensagem para os professores desta sala.'}</p></div>`;
    return `<section class="bf-chat" data-chat-panel="${esc(roomId)}" aria-labelledby="chat-heading">
      <header class="bf-chat-heading"><div class="bf-chat-heading-icon">${CHAT}</div><div><p class="bf-chat-eyebrow">CONVERSAS DA BANCA</p><h2 id="chat-heading">${esc(title)}</h2>${description ? `<p class="bf-chat-description">${esc(description)}</p>` : ''}</div><span class="bf-chat-connection${connected ? ' is-online' : ''}"><i aria-hidden="true"></i>${connected ? 'Conectado' : 'Sem conexão'}</span></header>
      <div class="bf-chat-room-control"><label for="chat-room-select">Sala de conversa</label><select id="chat-room-select" ${!rooms.length ? 'disabled' : ''}>${rooms.length ? rooms.map(item => `<option value="${esc(item.id)}" ${String(item.id) === roomId ? 'selected' : ''}>${esc(item.label)}</option>`).join('') : '<option>Nenhuma sala disponível</option>'}</select></div>
      ${error ? `<div class="bf-chat-error" role="alert"><p>${esc(error)}</p><button type="button" class="btn soft" data-chat-retry="1">Tentar novamente</button></div>` : ''}
      ${!connected ? '<p class="bf-chat-offline">A conversa será atualizada ao reconectar. Você pode continuar escrevendo.</p>' : ''}
      <div class="bf-chat-layout"><div class="bf-chat-conversation">
        <div class="bf-chat-conversation-title"><h3>Mensagens</h3><span>${messages.length} ${messages.length === 1 ? 'mensagem carregada' : 'mensagens carregadas'}</span></div>
        ${options.hasMore ? `<div class="bf-chat-history"><button class="btn soft" type="button" data-chat-older="1" ${options.loadingOlder || !connected ? 'disabled' : ''}>${options.loadingOlder ? 'Carregando histórico…' : 'Carregar mensagens anteriores'}</button></div>` : ''}
        <div id="chat-message-list" class="bf-chat-messages" role="log" aria-label="Mensagens da sala ${esc(title)}" aria-live="polite" aria-relevant="additions" aria-atomic="false" tabindex="0">${body}</div>
        <form id="chat-form" class="bf-chat-composer" data-chat-room="${esc(roomId)}"><label for="chat-message">Sua mensagem</label><textarea id="chat-message" name="message" rows="3" maxlength="${MAX_MESSAGE_LENGTH}" aria-describedby="chat-composer-help chat-character-count chat-send-status" placeholder="Escreva para os professores desta sala…" ${!room ? 'disabled' : ''}>${esc(draft)}</textarea><div class="bf-chat-composer-footer"><p id="chat-composer-help">Enter envia · Shift + Enter quebra a linha</p><span id="chat-character-count">${draft.length.toLocaleString('pt-BR')} / 2.000</span><button type="submit" class="btn primary" ${cannotSend ? 'disabled' : ''}>${sending ? 'Enviando…' : 'Enviar'}${SEND}</button></div><p id="chat-send-status" class="bf-chat-send-status" role="status" aria-live="polite">${status}</p></form>
      </div><aside class="bf-chat-people" aria-labelledby="chat-people-heading"><div class="bf-chat-people-title"><h3 id="chat-people-heading">Professores online</h3><span>${people.length}</span></div><p class="bf-chat-presence-help">${connected ? 'Disponíveis para conversar nesta sala.' : 'A presença será atualizada ao reconectar.'}</p>${people.length ? `<ul>${people.map(person => { const own = String(person.uid) === uid, name = line(person.name) || 'Professor'; return `<li data-chat-person="${esc(person.uid)}"><span class="bf-chat-person-avatar" aria-hidden="true">${esc(initials(name))}<i></i></span><div><strong>${esc(name)}${own ? ' <small>(você)</small>' : ''}</strong><span>${person.role === 'coordinator' ? 'Coordenação e avaliação' : 'Professor avaliador'}</span></div></li>`; }).join('')}</ul>` : '<p class="bf-chat-no-people">Nenhum professor online nesta sala no momento.</p>'}</aside></div>
    </section>`;
  }

  return Object.freeze({ MAX_MESSAGE_LENGTH, validateMessage, sortedMessages, renderChat });
});
