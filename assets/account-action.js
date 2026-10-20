/* Fluxos de confirmação da conta. Sem armazenamento de códigos ou senhas. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaAccountAction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = Object.freeze({ resetPassword: 'PASSWORD_RESET', verifyAndChangeEmail: 'VERIFY_AND_CHANGE_EMAIL', verifyEmail: 'VERIFY_EMAIL', recoverEmail: 'RECOVER_EMAIL' });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
  function parseActionInput(value, expectedApiKey = '') {
    try {
      const url = new URL(value);
      for (const key of ['mode', 'oobCode', 'apiKey']) if (url.searchParams.getAll(key).length > 1) return null;
      const mode = url.searchParams.get('mode') || '', code = url.searchParams.get('oobCode') || '';
      if (!Object.hasOwn(MODES, mode) || !code || code.length > 2048 || /[\s\u0000-\u001f]/.test(code)) return null;
      if (expectedApiKey && url.searchParams.has('apiKey') && url.searchParams.get('apiKey') !== expectedApiKey) return null;
      if (url.searchParams.get('tenantId')) return null;
      return Object.freeze({ mode, code });
    } catch { return null; }
  }
  function errorText(error) {
    const code = String(error?.code || '');
    if (/expired-action-code|invalid-action-code|user-not-found/.test(code)) return 'Este link expirou ou já foi utilizado. Solicite uma nova mensagem pelo BancaFlow.';
    if (/network-request-failed/.test(code)) return 'Não foi possível conectar. Confira sua internet e tente novamente.';
    if (/too-many-requests/.test(code)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.';
    if (/weak-password|password-does-not-meet-requirements/.test(code)) return 'A senha não atende aos requisitos de segurança. Confira as orientações abaixo do campo e tente novamente.';
    if (/email-already-in-use/.test(code)) return 'Este e-mail já está vinculado a outra conta. Solicite uma nova troca com outro endereço.';
    if (/user-disabled/.test(code)) return 'Esta conta está desabilitada. Procure a coordenação.';
    return error?.safeMessage || 'Não foi possível concluir esta ação. Tente novamente ou solicite um novo link pelo BancaFlow.';
  }
  function passwordPolicyText(result) {
    const criteria = result?.passwordPolicy?.customStrengthOptions || {};
    const missing = [];
    if (result?.meetsMinPasswordLength === false) missing.push(`pelo menos ${Number(criteria.minPasswordLength) || 8} caracteres`);
    if (result?.meetsMaxPasswordLength === false) missing.push(`no máximo ${Number(criteria.maxPasswordLength) || 128} caracteres`);
    if (result?.containsLowercaseLetter === false) missing.push('uma letra minúscula');
    if (result?.containsUppercaseLetter === false) missing.push('uma letra maiúscula');
    if (result?.containsNumericCharacter === false) missing.push('um número');
    if (result?.containsNonAlphanumericCharacter === false) missing.push('um símbolo');
    return missing.length ? `Use ${missing.join(', ')}.` : 'Escolha uma senha que atenda à política de segurança desta conta.';
  }
  function createController(options = {}) {
    const api = options.api || {}, auth = options.auth, params = options.params;
    const state = { phase: 'loading', mode: params?.mode || '', email: '', previousEmail: '', error: '', policy: '', busy: false, completed: false, refreshNeeded: false };
    let disposed = false, epoch = 0;
    const emit = () => { if (!disposed) options.onChange?.(view()); };
    function view() { return Object.freeze({ ...state }); }
    function safeFailure(message) { return Object.assign(new Error(message), { safeMessage: message }); }
    async function start() {
      if (disposed || state.busy || state.completed) return view();
      const ticket = ++epoch;
      state.busy = true; state.error = ''; state.phase = 'loading'; emit();
      try {
        if (!params || !Object.hasOwn(MODES, params.mode) || !params.code) throw safeFailure('Este link está incompleto. Solicite uma nova mensagem pelo BancaFlow.');
        if (params.mode === 'resetPassword') state.email = cleanEmail(await api.verifyPasswordResetCode(auth, params.code));
        else {
          const info = await api.checkActionCode(auth, params.code);
          if (info?.operation !== MODES[params.mode]) throw safeFailure('Este link não corresponde à ação solicitada. Abra a mensagem mais recente enviada pelo BancaFlow.');
          state.email = cleanEmail(info?.data?.email); state.previousEmail = cleanEmail(info?.data?.previousEmail);
        }
        if (!state.email) throw safeFailure('Não foi possível conferir a conta deste link. Solicite uma nova mensagem pelo BancaFlow.');
        if (!disposed && ticket === epoch) state.phase = 'ready';
      } catch (error) { if (!disposed && ticket === epoch) { state.phase = 'error'; state.error = errorText(error); } }
      finally { if (!disposed && ticket === epoch) { state.busy = false; emit(); } }
      return view();
    }
    async function finish(password, confirmation) {
      if (disposed || state.busy || state.completed || state.phase !== 'ready') return view();
      const ticket = epoch; state.busy = true; state.error = ''; state.policy = ''; emit();
      try {
        if (state.mode === 'resetPassword') {
          if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw safeFailure('Use uma senha entre 8 e 128 caracteres.');
          if (password !== confirmation) throw safeFailure('As senhas estão diferentes. Confira os dois campos.');
          if (typeof api.validatePassword === 'function') {
            const result = await api.validatePassword(auth, password);
            if (!result?.isValid) { state.policy = passwordPolicyText(result); throw safeFailure('A nova senha ainda não atende à política de segurança.'); }
          }
          if (disposed || ticket !== epoch) return view();
          await api.confirmPasswordReset(auth, params.code, password);
        } else {
          // Confere novamente para detectar links usados entre a leitura e a confirmação.
          const info = await api.checkActionCode(auth, params.code);
          if (info?.operation !== MODES[state.mode] || cleanEmail(info?.data?.email) !== state.email) throw safeFailure('O link mudou ou já foi utilizado. Solicite uma nova mensagem pelo BancaFlow.');
          if (disposed || ticket !== epoch) return view();
          await api.applyActionCode(auth, params.code);
        }
        if (!disposed && ticket === epoch) {
          state.completed = true; state.phase = 'success';
          const user = auth?.currentUser;
          if (user && typeof api.reload === 'function') {
            try { await api.reload(user); if (typeof api.getIdToken === 'function') await api.getIdToken(user, true); }
            catch { state.refreshNeeded = true; }
          }
        }
      } catch (error) { if (!disposed && ticket === epoch) state.error = errorText(error); }
      finally { if (!disposed && ticket === epoch) { state.busy = false; emit(); } }
      return view();
    }
    return Object.freeze({ start, finish, view, dispose() { disposed = true; ++epoch; } });
  }
  function render(state = {}) {
    const mode = state.mode, ready = state.phase === 'ready', busy = state.busy === true;
    const email = esc(state.email), previous = esc(state.previousEmail);
    const title = state.phase === 'success' ? mode === 'resetPassword' ? 'Senha redefinida' : mode === 'recoverEmail' ? 'E-mail restaurado' : mode === 'verifyEmail' ? 'E-mail confirmado' : 'E-mail atualizado' : mode === 'resetPassword' ? 'Crie sua nova senha' : mode === 'recoverEmail' ? 'Restaure seu e-mail' : mode === 'verifyEmail' ? 'Confirme seu e-mail' : 'Confirme a troca de e-mail';
    let content = '';
    if (state.phase === 'loading') content = '<p class="account-status" role="status">Conferindo seu link com segurança…</p>';
    else if (state.phase === 'success') content = `<div class="account-success" role="status"><strong>Tudo certo${email ? ` para ${email}` : ''}.</strong><p>${mode === 'resetPassword' ? 'Sua nova senha já pode ser usada para entrar no BancaFlow.' : mode === 'recoverEmail' ? 'O e-mail anterior da sua conta foi restaurado. Entre novamente com o endereço confirmado.' : mode === 'verifyEmail' ? 'Seu endereço foi confirmado. Você já pode voltar ao BancaFlow.' : 'Use este e-mail no próximo acesso. Sua conta, suas bancas e todas as notas foram preservadas.'}</p>${state.refreshNeeded ? '<p>Entre novamente para atualizar esta sessão.</p>' : ''}</div>`;
    else if (ready) {
      const explanation = mode === 'resetPassword' ? `Olá! Vamos atualizar a senha de <strong>${email}</strong>.` : mode === 'verifyAndChangeEmail' ? `Você está confirmando <strong>${email}</strong> como novo e-mail de acesso${previous ? `, substituindo <strong>${previous}</strong>` : ''}.` : mode === 'recoverEmail' ? `Confirme para restaurar <strong>${email}</strong> como e-mail de acesso da sua conta.` : `Confirme que <strong>${email}</strong> pertence a você.`;
      content = `<p class="account-intro">${explanation}</p>${mode !== 'resetPassword' ? '<p class="account-help">Sua conta mantém o mesmo histórico de bancas e avaliações.</p>' : ''}<form id="account-action-form">${mode === 'resetPassword' ? `<div class="account-field"><label for="action-password">Nova senha</label><div class="account-password-field"><input id="action-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required aria-describedby="action-password-help"><button type="button" data-action-show-password="1" aria-label="Mostrar nova senha" aria-pressed="false">Mostrar</button></div><p id="action-password-help" class="account-help">Use uma senha exclusiva, com pelo menos 8 caracteres. A política da sua conta será conferida antes de salvar.</p></div><div class="account-field"><label for="action-password-confirm">Confirme a nova senha</label><input id="action-password-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>` : ''}<button type="submit" class="account-primary" ${busy ? 'disabled' : ''}>${busy ? 'Salvando…' : mode === 'resetPassword' ? 'Salvar nova senha' : mode === 'recoverEmail' ? 'Restaurar e-mail' : mode === 'verifyEmail' ? 'Confirmar meu e-mail' : 'Confirmar novo e-mail'}</button></form>`;
    }
    return `<div class="account-action-heading"><span class="account-eyebrow">SEGURANÇA DA CONTA</span><h1>${title}</h1><p>BancaFlow · Gestão de bancas de TCC</p></div>${content}${state.error ? `<div class="account-error" role="alert"><strong>Confira esta etapa</strong><p>${esc(state.error)}</p>${state.policy ? `<p>${esc(state.policy)}</p>` : ''}</div>` : ''}<a class="account-login-link" href="./index.html">${state.phase === 'success' ? 'Entrar no BancaFlow' : 'Voltar ao acesso'}</a>`;
  }
  function mount(root, controller, documentRef = globalThis.document) {
    if (!root || !controller) throw new TypeError('A página de confirmação não carregou.');
    function paint(state) {
      // Mantém os campos locais em falhas de política ou rede, sem persistir credenciais.
      const password = root.querySelector('#action-password')?.value || '', confirmation = root.querySelector('#action-password-confirm')?.value || '';
      root.innerHTML = render(state);
      if (state.phase === 'ready') { const input = root.querySelector('#action-password'), confirm = root.querySelector('#action-password-confirm'); if (input) input.value = password; if (confirm) confirm.value = confirmation; }
    }
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-action-show-password]'); if (!button) return;
      const input = root.querySelector('#action-password'), confirm = root.querySelector('#action-password-confirm'); if (!input) return;
      const visible = input.type !== 'text'; input.type = visible ? 'text' : 'password'; if (confirm) confirm.type = input.type;
      button.textContent = visible ? 'Ocultar' : 'Mostrar'; button.setAttribute('aria-pressed', String(visible)); button.setAttribute('aria-label', visible ? 'Ocultar nova senha' : 'Mostrar nova senha');
    });
    root.addEventListener('submit', event => {
      if (event.target.id !== 'account-action-form') return; event.preventDefault();
      const data = new FormData(event.target); void controller.finish(String(data.get('password') || ''), String(data.get('confirmation') || ''));
    });
    return Object.freeze({ paint });
  }
  return Object.freeze({ MODES, parseActionInput, errorText, passwordPolicyText, createController, render, mount });
});
