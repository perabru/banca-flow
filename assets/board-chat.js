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
  const BELL = icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>');
  const VOLUME = icon('<path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>');
  const VOLUME_OFF = icon('<path d="m11 5-6 4H2v6h3l6 4V5ZM17 9l5 6M22 9l-5 6"/>');

  function validateMessage(value) {
    if (typeof value !== 'string') throw new TypeError('Digite uma mensagem.');
    const message = value.replace(/\r\n?/g, '\n').trim();
    if (!message) throw new Error('Digite uma mensagem.');
    if (message.length > MAX_MESSAGE_LENGTH) throw new Error('A mensagem deve ter no máximo 2.000 caracteres.');
    return message;
  }

  function sortedMessages(input) {
    const entries = Array.isArray(input) ? input.map((message, index) => [String(message?.id ?? index), message]) : input && typeof input === 'object' ? Object.entries(input) : [];
    return entries.filter(([, message]) => message && typeof message === 'object' && (typeof message.text === 'string' || timestamp(message.deletedAt) !== null)).map(([id, message]) => ({ ...message, id })).sort((a, b) => (timestamp(a.at) ?? 0) - (timestamp(b.at) ?? 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  }

  function initials(value) {
    return line(value).split(' ').filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR') || 'P';
  }

  function dateLabel(value) {
    const at = timestamp(value);
    if (at === null) return 'Horário indisponível';
    return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderAlerts(input) {
    const alerts = input && typeof input === 'object' ? input : {};
    const muted = alerts.muted === true, enabled = alerts.enabled === true;
    const permission = ['granted', 'denied', 'default', 'unsupported'].includes(alerts.permission) ? alerts.permission : 'unsupported';
    const activated = permission === 'granted' && enabled;
    const unread = Number.isSafeInteger(alerts.unread) && alerts.unread > 0 ? alerts.unread : 0;
    const label = permission === 'denied' ? 'Verificar permissão' : activated ? 'Notificações ativadas' : 'Ativar notificações';
    const help = permission === 'unsupported' ? 'As notificações do sistema não estão disponíveis neste navegador.' : permission === 'denied' ? 'As notificações estão bloqueadas. Altere a permissão nas configurações deste site no navegador e verifique novamente.' : activated ? 'As notificações estão autorizadas neste navegador.' : 'A ativação depende da permissão deste navegador.';
    const status = [muted ? 'Sons, notificações e avisos na página estão silenciados.' : '', line(alerts.status) || (!muted ? 'Avisos de novas mensagens habilitados na página.' : '')].filter(Boolean).join(' ');
    return `<section class="bf-chat-alerts${muted ? ' is-muted' : ''}" aria-labelledby="chat-alerts-heading">
      <div class="bf-chat-alerts-intro"><span class="bf-chat-alerts-icon">${BELL}</span><div><h3 id="chat-alerts-heading">Avisos de mensagens${unread ? `<span class="bf-chat-unread" data-chat-unread="${unread}" aria-label="${unread.toLocaleString('pt-BR')} ${unread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}">${unread > 99 ? '99+' : unread}</span>` : ''}</h3><p>Avisos de novas mensagens neste dispositivo.</p></div></div>
      <div class="bf-chat-alerts-actions"><button type="button" class="btn soft" data-chat-notify="1" aria-describedby="chat-alerts-permission" ${permission === 'unsupported' || activated ? 'disabled' : ''}>${BELL}<span>${label}</span></button><button type="button" class="btn soft" data-chat-mute="1" aria-pressed="${muted}" aria-describedby="chat-alerts-status">${muted ? VOLUME_OFF : VOLUME}<span>${muted ? 'Reativar avisos' : 'Silenciar'}</span></button></div>
      <p id="chat-alerts-status" class="bf-chat-alerts-status" role="status" aria-live="polite" aria-atomic="true">${esc(status)}</p><p id="chat-alerts-permission" class="bf-chat-alerts-permission">${help}</p>
    </section>`;
  }

  function renderChat(options = {}) {
    const rooms = list(options.rooms), roomId = String(options.roomId ?? ''), uid = String(options.uid ?? '');
    const room = rooms.find(item => String(item?.id ?? '') === roomId);
    const title = line(options.title) || line(room?.label) || 'Sala dos professores';
    const description = line(options.roomDescription) || line(room?.description);
    const connected = options.connected === true, loading = options.loading === true, sending = options.sending === true;
    const error = line(options.error), sendError = line(options.sendError), draft = String(options.draft ?? '');
    const chatReady = connected && !loading && !error;
    const connectionLabel = !connected ? 'Sem conexão' : error ? 'Chat indisponível' : loading ? 'Conectando ao chat' : 'Chat conectado';
    const messages = sortedMessages(options.messages);
    const pendingIds = new Set(list(options.pendingIds).map(id => String(id)));
    const mutation = options.mutation && typeof options.mutation === 'object' ? options.mutation : null;
    const mutationBusy = mutation?.busy === true;
    const people = connected ? [...new Map(list(options.people).filter(person => person && person.uid).map(person => [String(person.uid), person])).values()].sort((a, b) => line(a.name).localeCompare(line(b.name), 'pt-BR')) : [];
    const cannotSend = !connected || loading || sending || !!error || !room || !draft.trim();
    const status = sending ? 'Enviando mensagem…' : !connected ? 'Sem conexão. Sua mensagem permanece em edição.' : loading ? 'Carregando a conversa…' : error ? 'O envio estará disponível quando a conversa for reconectada.' : sendError ? 'Sua mensagem permanece em edição. Você pode tentar enviar novamente.' : 'As mensagens aparecem para os participantes desta sala.';
    const body = messages.length ? messages.map(message => {
      const own = uid && String(message.uid ?? '') === uid, name = line(message.name) || 'Professor';
      const pending = own && pendingIds.has(String(message.id));
      const deleted = timestamp(message.deletedAt) !== null, edited = !deleted && timestamp(message.editedAt) !== null;
      const canManage = own && !pending && !deleted && typeof message.text === 'string';
      const activeMutation = canManage && String(mutation?.room ?? '') === roomId && String(mutation?.id ?? '') === String(message.id) && ['edit', 'delete'].includes(mutation?.kind) ? mutation : null;
      const mutationError = activeMutation ? line(activeMutation.error) : '';
      const mutationErrorHtml = mutationError ? `<div id="chat-mutation-error" class="bf-chat-mutation-error" role="alert"><p>${esc(mutationError)}</p>${options.canCopyAccessPolicy === true ? '<button type="button" class="btn soft" data-copy-policy="1">Copiar regras de acesso</button>' : ''}</div>` : '';
      const disabledAction = !chatReady || !room || mutationBusy;
      let mutationHtml = '';
      if (activeMutation?.kind === 'edit') {
        const editText = String(activeMutation.text ?? '');
        mutationHtml = `<form id="chat-edit-form" class="bf-chat-message-editor" data-chat-room="${esc(roomId)}" data-chat-id="${esc(message.id)}"><label for="chat-edit-message">Editar sua mensagem</label><textarea id="chat-edit-message" name="message" rows="3" maxlength="${MAX_MESSAGE_LENGTH}" aria-describedby="chat-edit-help${mutationError ? ' chat-mutation-error' : ''}" ${mutationBusy ? 'disabled' : ''}>${esc(editText)}</textarea><p id="chat-edit-help">A alteração ficará visível para todos nesta sala.</p>${mutationErrorHtml}<div class="bf-chat-mutation-actions"><button type="submit" class="btn primary" ${disabledAction || !editText.trim() || editText.length > MAX_MESSAGE_LENGTH ? 'disabled' : ''}>${mutationBusy ? 'Salvando…' : 'Salvar alteração'}</button><button type="button" class="btn soft" data-chat-mutation-cancel="1" ${mutationBusy ? 'disabled' : ''}>Cancelar</button></div><p class="bf-chat-mutation-status" role="status" aria-live="polite">${mutationBusy ? 'Salvando alteração…' : ''}</p></form>`;
      } else if (activeMutation?.kind === 'delete') {
        mutationHtml = `<div class="bf-chat-message-delete" aria-labelledby="chat-delete-heading"><strong id="chat-delete-heading">Apagar esta mensagem?</strong><p>O texto será removido para todos os participantes desta sala.</p>${mutationErrorHtml}<div class="bf-chat-mutation-actions"><button type="button" class="btn bf-chat-delete-confirm" data-chat-delete-confirm="${esc(message.id)}" ${disabledAction ? 'disabled' : ''}>${mutationBusy ? 'Apagando…' : 'Apagar mensagem'}</button><button type="button" class="btn soft" data-chat-mutation-cancel="1" ${mutationBusy ? 'disabled' : ''}>Cancelar</button></div><p class="bf-chat-mutation-status" role="status" aria-live="polite">${mutationBusy ? 'Apagando mensagem…' : ''}</p></div>`;
      }
      const at = timestamp(message.at), datetime = at === null ? '' : ` datetime="${esc(new Date(at).toISOString())}"`;
      return `<article class="bf-chat-message${own ? ' bf-chat-message-own' : ''}${pending ? ' bf-chat-message-pending' : ''}${deleted ? ' bf-chat-message-deleted' : ''}" data-chat-message="${esc(message.id)}"><div class="bf-chat-message-meta"><strong>${esc(name)}${own ? '<span>Você</span>' : ''}</strong><time${datetime}>${esc(dateLabel(message.at))}</time></div><p${deleted ? ' class="bf-chat-deleted-text"' : ''}>${deleted ? 'Mensagem apagada' : esc(message.text)}</p>${edited ? `<span class="bf-chat-message-edited" title="${esc(dateLabel(message.editedAt))}">editada</span>` : ''}${own && !deleted ? `<span class="bf-chat-message-delivery${pending ? ' is-pending' : ''}" data-chat-delivery="${pending ? 'pending' : 'sent'}" aria-label="${pending ? 'Mensagem em envio' : 'Mensagem enviada'}">${pending ? 'Enviando…' : 'Enviada'}</span>` : ''}${canManage && !activeMutation ? `<div class="bf-chat-message-actions" aria-label="Opções da sua mensagem"><button type="button" data-chat-edit="${esc(message.id)}" aria-label="Editar sua mensagem" ${disabledAction ? 'disabled' : ''}>Editar</button><button type="button" data-chat-delete="${esc(message.id)}" aria-label="Apagar sua mensagem para todos" ${disabledAction ? 'disabled' : ''}>Apagar</button></div>` : ''}${mutationHtml}</article>`;
    }).join('') : `<div class="bf-chat-empty">${CHAT}<strong>${error ? 'Não foi possível carregar as mensagens' : loading ? 'Carregando mensagens' : !connected ? 'Aguardando conexão' : 'A conversa começa aqui'}</strong><p>${error ? 'Atualize a conversa para tentar carregar o histórico desta sala.' : loading ? 'Aguarde a atualização da sala.' : !connected ? 'O histórico será carregado quando a conexão for restabelecida.' : 'Envie a primeira mensagem para os professores desta sala.'}</p></div>`;
    return `<section class="bf-chat" data-chat-panel="${esc(roomId)}" aria-labelledby="chat-heading">
      <header class="bf-chat-heading"><div class="bf-chat-heading-icon">${CHAT}</div><div><p class="bf-chat-eyebrow">CONVERSAS DA BANCA</p><h2 id="chat-heading">${esc(title)}</h2>${description ? `<p class="bf-chat-description">${esc(description)}</p>` : ''}</div><span class="bf-chat-connection${chatReady ? ' is-online' : ''}"><i aria-hidden="true"></i>${connectionLabel}</span></header>
      <div class="bf-chat-room-control"><label for="chat-room-select">Sala de conversa</label><select id="chat-room-select" ${!rooms.length ? 'disabled' : ''}>${rooms.length ? rooms.map(item => `<option value="${esc(item.id)}" ${String(item.id) === roomId ? 'selected' : ''}>${esc(item.label)}</option>`).join('') : '<option>Nenhuma sala disponível</option>'}</select></div>
      ${renderAlerts(options.alerts)}
      ${error ? `<div class="bf-chat-error" role="alert"><p>${esc(error)}</p><button type="button" class="btn soft" data-chat-retry="1">Tentar novamente</button></div>` : ''}
      ${!connected ? '<p class="bf-chat-offline">A conversa será atualizada ao reconectar. Você pode continuar escrevendo.</p>' : ''}
      <div class="bf-chat-layout"><div class="bf-chat-conversation">
        <div class="bf-chat-conversation-title"><div class="bf-chat-conversation-summary"><h3>Mensagens</h3><span>${messages.length} ${messages.length === 1 ? 'mensagem carregada' : 'mensagens carregadas'}</span></div><div class="bf-chat-conversation-actions"><button class="btn soft" type="button" data-chat-refresh="1" ${!room ? 'disabled' : ''}>Atualizar conversa</button>${messages.length ? '<button class="btn soft" type="button" data-chat-latest="1" aria-controls="chat-message-list">Últimas mensagens</button>' : ''}</div></div>
        ${options.hasMore ? `<div class="bf-chat-history"><button class="btn soft" type="button" data-chat-older="1" ${options.loadingOlder || !connected ? 'disabled' : ''}>${options.loadingOlder ? 'Carregando histórico…' : 'Carregar mensagens anteriores'}</button></div>` : ''}
        <div id="chat-message-list" class="bf-chat-messages" role="log" aria-label="Mensagens da sala ${esc(title)}" aria-live="polite" aria-relevant="additions text" aria-atomic="false" tabindex="0">${body}</div>
        <form id="chat-form" class="bf-chat-composer" data-chat-room="${esc(roomId)}"><label for="chat-message">Sua mensagem</label><textarea id="chat-message" name="message" rows="3" maxlength="${MAX_MESSAGE_LENGTH}" aria-describedby="chat-composer-help chat-character-count chat-send-status${sendError ? ' chat-send-error' : ''}" placeholder="Escreva para os professores desta sala…" ${!room ? 'disabled' : ''}>${esc(draft)}</textarea>${sendError ? `<div id="chat-send-error" class="bf-chat-send-error" data-chat-send-error="1" role="alert"><strong>Mensagem não enviada</strong><p>${esc(sendError)}</p>${options.canCopyAccessPolicy === true ? '<button type="button" class="btn soft" data-copy-policy="1">Copiar regras de acesso</button>' : ''}</div>` : ''}<div class="bf-chat-composer-footer"><p id="chat-composer-help">Enter envia · Shift + Enter quebra a linha</p><span id="chat-character-count">${draft.length.toLocaleString('pt-BR')} / 2.000</span><button type="submit" class="btn primary" ${cannotSend ? 'disabled' : ''}>${sending ? 'Enviando…' : 'Enviar'}${SEND}</button></div><p id="chat-send-status" class="bf-chat-send-status" role="status" aria-live="polite">${status}</p></form>
      </div><aside class="bf-chat-people" aria-labelledby="chat-people-heading"><div class="bf-chat-people-title"><h3 id="chat-people-heading">Professores online</h3><span>${people.length}</span></div><p class="bf-chat-presence-help">${connected ? 'Disponíveis para conversar nesta sala.' : 'A presença será atualizada ao reconectar.'}</p>${people.length ? `<ul>${people.map(person => { const own = String(person.uid) === uid, name = line(person.name) || 'Professor'; return `<li data-chat-person="${esc(person.uid)}"><span class="bf-chat-person-avatar" aria-hidden="true">${esc(initials(name))}<i></i></span><div><strong>${esc(name)}${own ? ' <small>(você)</small>' : ''}</strong><span>${person.role === 'coordinator' ? 'Coordenação e avaliação' : 'Professor avaliador'}</span></div></li>`; }).join('')}</ul>` : '<p class="bf-chat-no-people">Nenhum professor online nesta sala no momento.</p>'}</aside></div>
    </section>`;
  }

  return Object.freeze({ MAX_MESSAGE_LENGTH, validateMessage, sortedMessages, renderChat });
});
