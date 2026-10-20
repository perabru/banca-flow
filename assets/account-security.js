/* Segurança da própria conta. O UID e os registros acadêmicos permanecem os mesmos. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaAccountSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const clean = value => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const emailOf = value => {
    const email = clean(value).toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Informe um e-mail válido.');
    return email;
  };
  const phoneOf = value => {
    const phone = clean(value).replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw Error('Informe o celular com o código do país e o DDD. Exemplo: +55 12 99999-9999.');
    return phone;
  };
  const codeOf = value => {
    const code = clean(value);
    if (!/^\d{6}$/.test(code)) throw Error('Digite os 6 números do código recebido por SMS.');
    return code;
  };
  const valueOf = (values, key) => typeof values?.get === 'function' ? values.get(key) : values?.[key];
  const messages = Object.freeze({
    unavailable: 'SMS ainda não está disponível. A recuperação por e-mail continua disponível.',
    emailSent: 'Se os dados corresponderem a uma conta habilitada, você receberá um e-mail do BancaFlow com as instruções. Confira também a pasta de spam.',
    smsSent: 'Se o e-mail e o celular corresponderem a uma conta habilitada, o BancaFlow enviará um código para o número já verificado. O código expira em 10 minutos.',
    stale: 'A sessão mudou. Abra novamente a área da sua conta.'
  });

  function createController(options = {}) {
    const authApi = options.authApi || {};
    let sequence = 0, capabilities = { emailAvailable: false, smsAvailable: false }, capabilitiesLoaded = false, capabilitiesPromise = null;
    let recoveryCode = '', enrollmentPhone = '';
    const defaults = () => ({ open: false, mode: 'recovery', panel: 'request', busy: false, loading: false, error: '', success: '', channel: 'email', email: '', newEmail: '', phone: '', verifiedPhone: '', phoneVerified: false, notifySms: false, owner: '', revision: undefined, name: '' });
    let state = defaults();
    const session = () => options.getSession?.() || {};
    const actor = () => { const current = session(); return { uid: current.user?.uid || '', revision: current.revision }; };
    const changed = () => options.onChange?.();
    function sameSession(ticket) {
      const current = actor();
      return ticket.sequence === sequence && state.open && current.uid === ticket.uid && current.revision === ticket.revision;
    }
    function ticket() { return { ...actor(), sequence }; }
    function requireAccount() {
      const current = session();
      if (!current.user?.uid || !current.profile || current.profile.active === false || !['teacher', 'coordinator'].includes(current.profile.role)) throw Error('Entre com sua conta de professor para alterar os dados de acesso.');
      if (state.mode !== 'account' || state.owner !== current.user.uid || state.revision !== current.revision) throw Error(messages.stale);
      return current;
    }
    function readableError(error) {
      const code = String(error?.code || '');
      if (/recent.login|requires.recent.login|credential.too.old/.test(code)) return 'Por segurança, entre novamente com sua senha antes de continuar.';
      if (/invalid.credential|wrong.password|invalid.login.credentials/.test(code)) return 'A senha atual não foi confirmada. Confira e tente novamente.';
      if (/invalid.email/.test(code)) return 'Informe um e-mail válido.';
      if (/email.already.in.use/.test(code)) return 'Não foi possível utilizar esse e-mail. Confira o endereço ou escolha outro.';
      if (/too.many|rate.limit|resource.exhausted/.test(code)) return 'Aguarde alguns minutos antes de solicitar outro código ou e-mail.';
      if (/invalid.code|expired.code|invalid.verification.code|invalid.action.code|expired.action.code/.test(code)) return 'O código é inválido, expirou ou já foi utilizado. Solicite outro código.';
      if (/weak.password|password.does.not.meet.requirements/.test(code)) return 'A nova senha não atende aos requisitos de segurança. Confira as orientações e tente novamente.';
      if (/unavailable.channel|not.configured|service.unavailable/.test(code)) return 'Este canal de envio está indisponível no momento. Tente a recuperação por e-mail.';
      if (/delivery.failed/.test(code)) return 'Não foi possível enviar a mensagem. Aguarde e tente novamente; se necessário, use a recuperação por e-mail.';
      if (/network|fetch|unavailable|deadline/.test(code) || error instanceof TypeError) return 'Não foi possível conectar ao serviço. Confira a internet e tente novamente.';
      if (error?.safe === false || /^auth\//.test(code) || error?.safe !== true && /firebase|token|secret|smtp|twilio|https?:\/\//i.test(String(error?.message || ''))) return 'Não foi possível concluir a solicitação. Confira os dados e tente novamente.';
      return clean(error?.message) || 'Não foi possível concluir a solicitação. Tente novamente.';
    }
    async function request(action, values, authenticated) {
      if (typeof options.request !== 'function') throw Object.assign(Error('Canal não configurado.'), { code: 'service-unavailable' });
      let result;
      try { result = await options.request(action, values, authenticated); }
      catch (error) { throw Object.assign(Error('Serviço indisponível.'), { code: String(error?.code || 'service-unavailable'), safe: false }); }
      if (result?.ok === false) throw Object.assign(Error(result.error?.message || ''), { code: result.error?.code || 'service-unavailable', safe: false });
      return result || {};
    }
    async function loadCapabilities() {
      if (capabilitiesLoaded) return capabilities;
      if (!capabilitiesPromise) {
        capabilitiesPromise = request('getCapabilities', {}, false).then(result => {
          capabilities = { emailAvailable: result.emailAvailable === true, smsAvailable: result.smsAvailable === true }; capabilitiesLoaded = true;
          return capabilities;
        }).catch(() => { capabilitiesLoaded = true; return capabilities; }).finally(() => { capabilitiesPromise = null; });
      }
      return capabilitiesPromise;
    }
    async function loadAccount(ticketValue) {
      try {
        await loadCapabilities();
        if (!sameSession(ticketValue)) return;
        if (!capabilities.smsAvailable && !capabilities.emailAvailable) return;
        const info = await request('getAccount', {}, true);
        if (!sameSession(ticketValue)) return;
        state.phoneVerified = false; state.verifiedPhone = '';
        if (info.phoneVerified === true) {
          try { state.verifiedPhone = phoneOf(info.phone); state.phone = state.verifiedPhone; state.phoneVerified = true; }
          catch { /* Um contato incompleto não pode ser tratado como confirmado. */ }
        }
        capabilities = { emailAvailable: info.emailAvailable === true, smsAvailable: info.smsAvailable === true };
      } catch { /* A recuperação nativa por e-mail continua disponível. */ }
      finally { if (sameSession(ticketValue)) { state.loading = false; changed(); } }
    }
    function reset() { sequence++; recoveryCode = ''; enrollmentPhone = ''; state = defaults(); }
    function close() { reset(); changed(); }
    function openRecovery(email = '') {
      reset(); const current = session(); state = { ...defaults(), open: true, email: clean(email).slice(0, 254), owner: current.user?.uid || '', revision: current.revision };
      const currentTicket = ticket(); changed();
      void loadCapabilities().then(() => { if (sameSession(currentTicket)) changed(); });
    }
    function openAccount() {
      const current = session();
      if (!current.user?.uid || !current.profile || current.profile.active === false || !['teacher', 'coordinator'].includes(current.profile.role)) throw Error('Entre com sua conta de professor para alterar os dados de acesso.');
      reset(); state = { ...defaults(), open: true, mode: 'account', loading: true, email: clean(current.user.email || current.profile.email), owner: current.user.uid, revision: current.revision, name: clean(current.profile.name) };
      changed(); void loadAccount(ticket());
    }
    function setChannel(value) {
      if (!state.open || state.busy) return;
      const selected = value === 'sms' ? 'sms' : 'email';
      if (selected === 'sms' && (!capabilities.smsAvailable || state.mode === 'account' && !state.phoneVerified)) { state.error = !capabilities.smsAvailable ? messages.unavailable : 'Confirme primeiro um celular na sua conta para usá-lo na recuperação.'; changed(); return; }
      state.channel = selected; state.error = ''; state.success = ''; state.panel = 'request'; recoveryCode = ''; changed();
    }
    function setDraft(name, value) {
      if (!state.open || state.busy) return;
      if (name === 'notifySms') { state.notifySms = value === true || value === 'on' || value === 'true'; return; }
      if (!['email', 'newEmail', 'phone'].includes(name)) return;
      if (state.panel === 'sms-reset' && ['email', 'phone'].includes(name) && state[name] !== String(value ?? '')) { recoveryCode = ''; state.panel = 'request'; }
      state[name] = String(value ?? '').slice(0, name === 'phone' ? 24 : 254);
    }
    async function operation(callback) {
      if (!state.open || state.busy) return false;
      const currentTicket = ticket(); state.busy = true; state.error = ''; state.success = ''; changed();
      try { await callback(currentTicket); return sameSession(currentTicket); }
      catch (error) { if (sameSession(currentTicket)) state.error = readableError(error); return false; }
      finally { if (sameSession(currentTicket)) { state.busy = false; changed(); } }
    }
    function guard(currentTicket) { if (!sameSession(currentTicket)) throw Error(messages.stale); }
    async function checkPassword(password, confirmation) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Error('Use uma senha de 8 a 128 caracteres, conforme os requisitos da sua conta.');
      if (password !== confirmation) throw Error('A confirmação deve ser igual à nova senha.');
      if (typeof authApi.validatePassword === 'function') {
        const status = await authApi.validatePassword(password);
        if (status?.isValid === false) {
          const requirements = [];
          const required = status.passwordPolicy?.customStrengthOptions || {};
          if (status.meetsMinPasswordLength === false) requirements.push(`pelo menos ${required.minPasswordLength || 8} caracteres`);
          if (status.meetsMaxPasswordLength === false) requirements.push(`no máximo ${required.maxPasswordLength || 128} caracteres`);
          if (status.containsLowercaseLetter === false) requirements.push('uma letra minúscula');
          if (status.containsUppercaseLetter === false) requirements.push('uma letra maiúscula');
          if (status.containsNumericCharacter === false) requirements.push('um número');
          if (status.containsNonAlphanumericCharacter === false) requirements.push('um símbolo');
          throw Error(requirements.length ? `A nova senha deve conter ${requirements.join(', ')}.` : 'A nova senha não atende aos requisitos de segurança desta conta.');
        }
      }
    }
    async function sendRecovery(values = {}) {
      return operation(async currentTicket => {
        const email = emailOf(valueOf(values, 'email') ?? state.email), channel = valueOf(values, 'channel') ?? state.channel;
        if (!['email', 'sms'].includes(channel)) throw Error('Escolha o envio por e-mail ou SMS.');
        state.email = email; state.channel = channel;
        await loadCapabilities(); guard(currentTicket);
        if (channel === 'sms') {
          if (!capabilities.smsAvailable) throw Error(messages.unavailable);
          const phone = phoneOf(valueOf(values, 'phone') ?? state.phone); state.phone = phone;
          await request('requestPasswordResetSms', { email, phone }, false); guard(currentTicket);
          recoveryCode = ''; state.panel = 'sms-reset'; state.success = messages.smsSent;
        } else {
          if (capabilities.emailAvailable) await request('requestPasswordResetEmail', { email }, false);
          else {
            if (typeof authApi.resetEmail !== 'function') throw Error('O envio por e-mail não está disponível. Atualize a página e tente novamente.');
            try { await authApi.resetEmail(email); }
            catch (error) { if (!/user.not.found/.test(String(error?.code || ''))) throw error; }
          }
          guard(currentTicket); state.success = messages.emailSent;
        }
      });
    }
    async function submitSmsReset(values) {
      return operation(async currentTicket => {
        if (state.panel !== 'sms-reset' || state.channel !== 'sms' || !capabilities.smsAvailable) throw Error('Solicite primeiro um código para seu celular verificado.');
        const password = valueOf(values, 'password'), confirmation = valueOf(values, 'confirm');
        await checkPassword(password, confirmation); guard(currentTicket);
        if (!recoveryCode) {
          const code = codeOf(valueOf(values, 'code'));
          const result = await request('confirmPasswordResetSms', { email: state.email, phone: state.phone, code }, false); guard(currentTicket);
          if (typeof result.oobCode !== 'string' || !result.oobCode || result.oobCode.length > 4096) throw Error('Não foi possível confirmar o código. Solicite outro código.');
          recoveryCode = result.oobCode;
        }
        if (typeof authApi.confirmReset !== 'function') throw Error('A redefinição não carregou. Atualize a página e tente novamente.');
        try { await authApi.confirmReset(recoveryCode, password); }
        catch (error) { if (/invalid.action.code|expired.action.code/.test(String(error?.code || ''))) recoveryCode = ''; throw error; }
        guard(currentTicket); recoveryCode = ''; state.panel = 'complete'; state.success = 'Sua senha foi redefinida. Entre no BancaFlow com a nova senha; suas bancas e avaliações continuam na mesma conta.';
      });
    }
    async function changeEmail(values) {
      return operation(async currentTicket => {
        const current = requireAccount(), newEmail = emailOf(valueOf(values, 'newEmail')), password = valueOf(values, 'password');
        state.newEmail = newEmail;
        if (newEmail === clean(current.user.email || current.profile.email).toLowerCase()) throw Error('Informe um e-mail diferente do endereço atual.');
        if (typeof password !== 'string' || !password) throw Error('Confirme sua senha atual para alterar o e-mail.');
        await authApi.reauthenticate(password); guard(currentTicket); requireAccount();
        await loadCapabilities(); guard(currentTicket);
        const notifyInput = valueOf(values, 'notifySms');
        const notifySms = state.phoneVerified && capabilities.smsAvailable && (notifyInput === true || notifyInput === 'on' || notifyInput === 'true');
        if (capabilities.emailAvailable) await request('requestEmailChange', { newEmail, notifySms }, true);
        else await authApi.verifyEmailChange(newEmail);
        guard(currentTicket); state.success = `${state.name || 'Professor'}, enviamos a confirmação para ${newEmail}. Seu e-mail de acesso só será alterado depois que você confirmar a mensagem. O histórico da conta será preservado.`;
      });
    }
    async function enrollPhone(values) {
      return operation(async currentTicket => {
        requireAccount(); await loadCapabilities(); guard(currentTicket);
        if (!capabilities.smsAvailable) throw Error(messages.unavailable);
        const phone = phoneOf(valueOf(values, 'phone')), password = valueOf(values, 'password'); state.phone = phone;
        if (typeof password !== 'string' || !password) throw Error('Confirme sua senha atual para cadastrar o celular.');
        await authApi.reauthenticate(password); guard(currentTicket); requireAccount();
        await request('enrollPhoneStart', { phone }, true); guard(currentTicket);
        enrollmentPhone = phone; state.panel = 'phone-confirm'; state.success = 'Enviamos um código de confirmação ao celular informado. Ele só será usado na recuperação depois que você confirmar o código.';
      });
    }
    async function confirmPhone(values) {
      return operation(async currentTicket => {
        requireAccount(); if (!enrollmentPhone || state.panel !== 'phone-confirm') throw Error('Solicite primeiro a confirmação do celular.');
        const code = codeOf(valueOf(values, 'code'));
        await request('enrollPhoneConfirm', { phone: enrollmentPhone, code }, true); guard(currentTicket);
        state.phone = enrollmentPhone; state.verifiedPhone = enrollmentPhone; enrollmentPhone = ''; state.phoneVerified = true; state.panel = 'request';
        state.success = `${state.name || 'Professor'}, seu celular foi confirmado. Você já pode escolhê-lo para recuperar a senha por SMS.`;
      });
    }
    async function refreshAccount() {
      return operation(async currentTicket => {
        requireAccount(); if (typeof authApi.refreshAccount !== 'function') throw Error('Entre novamente para atualizar os dados da sua conta.');
        await authApi.refreshAccount(); guard(currentTicket);
        const current = requireAccount(); state.email = clean(current.user.email || current.profile.email); state.success = `${state.name || 'Professor'}, os dados da sua conta foram atualizados.`;
      });
    }
    function submit(formId, values) {
      if (formId === 'account-recovery-form') return sendRecovery(values);
      if (formId === 'account-sms-reset-form') return submitSmsReset(values);
      if (formId === 'account-email-form') return changeEmail(values);
      if (formId === 'account-phone-form') return enrollPhone(values);
      if (formId === 'account-phone-confirm-form') return confirmPhone(values);
      return Promise.resolve(false);
    }
    function action(name) {
      if (name === 'close') { close(); return Promise.resolve(true); }
      if (name === 'refresh') return refreshAccount();
      if (name === 'reset') return sendRecovery({ email: state.email, channel: state.channel, phone: state.mode === 'account' ? state.verifiedPhone : state.phone });
      if (name === 'back' && !state.busy) { recoveryCode = ''; enrollmentPhone = ''; state.panel = 'request'; state.error = ''; state.success = ''; changed(); return Promise.resolve(true); }
      return Promise.resolve(false);
    }
    function getState() {
      if (state.open && (actor().uid !== state.owner || actor().revision !== state.revision)) reset();
      return { ...state, capabilities: { ...capabilities }, capabilitiesLoaded };
    }
    const input = (id, name, label, type, value = '', attributes = '') => `<div class="account-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${attributes}></div>`;
    const passwordInput = (id, label, name = 'password', autocomplete = 'current-password') => input(id, name, label, 'password', '', `autocomplete="${autocomplete}" maxlength="128" required`);
    const submitButton = (text, busy) => `<button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Aguarde…' : text}</button>`;
    function recoveryForm(data) {
      return `<form id="account-recovery-form" class="account-form">${input('account-recovery-email', 'email', 'E-mail da sua conta', 'email', data.email, 'autocomplete="username" inputmode="email" autocapitalize="none" maxlength="254" required')}<div class="account-field"><label for="account-recovery-channel">Receber instruções por</label><select id="account-recovery-channel" name="channel" ${data.busy ? 'disabled' : ''}><option value="email" ${data.channel === 'email' ? 'selected' : ''}>E-mail</option>${data.capabilities.smsAvailable ? `<option value="sms" ${data.channel === 'sms' ? 'selected' : ''}>SMS no celular verificado</option>` : ''}</select></div>${data.channel === 'sms' ? input('account-recovery-phone', 'phone', 'Celular já confirmado na sua conta', 'tel', data.phone, 'autocomplete="tel" placeholder="+55 12 99999-9999" maxlength="24" required') : ''}<p class="account-help">${data.channel === 'sms' ? 'Informe o mesmo celular que você confirmou em Minha conta.' : 'Você receberá um link para escolher uma nova senha. Seu histórico será preservado.'}</p>${!data.capabilities.smsAvailable ? `<p class="account-help">${messages.unavailable}</p>` : ''}${submitButton(data.channel === 'sms' ? 'Enviar código por SMS' : 'Enviar instruções por e-mail', data.busy)}</form>`;
    }
    function smsResetForm(data) {
      return `<form id="account-sms-reset-form" class="account-form">${!recoveryCode ? input('account-reset-code', 'code', 'Código recebido por SMS', 'text', '', 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required') : '<p class="account-help">Código confirmado. Escolha sua nova senha.</p>'}${passwordInput('account-reset-password', 'Nova senha', 'password', 'new-password')}${passwordInput('account-reset-confirm', 'Repita a nova senha', 'confirm', 'new-password')}<p class="account-help">Use de 8 a 128 caracteres e atenda aos requisitos de segurança indicados para sua conta.</p><div class="account-actions">${submitButton('Redefinir senha', data.busy)}<button class="btn soft" type="button" data-account-action="back" ${data.busy ? 'disabled' : ''}>Solicitar outro código</button></div></form>`;
    }
    function accountView(data) {
      if (data.panel === 'sms-reset') return smsResetForm(data);
      if (data.panel === 'phone-confirm') return `<form id="account-phone-confirm-form" class="account-form"><p>Confirme o código enviado para <strong>${esc(enrollmentPhone)}</strong>.</p>${input('account-phone-code', 'code', 'Código de confirmação', 'text', '', 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required')}<div class="account-actions">${submitButton('Confirmar celular', data.busy)}<button class="btn soft" type="button" data-account-action="back" ${data.busy ? 'disabled' : ''}>Voltar</button></div></form>`;
      return `<section class="account-section"><h3>E-mail de acesso</h3><p class="account-current-email">${esc(data.email)}</p><p>Confirme o novo endereço antes de usá-lo para entrar. A sua conta e o histórico permanecem os mesmos.</p><form id="account-email-form" class="account-form">${input('account-new-email', 'newEmail', 'Novo e-mail', 'email', data.newEmail, 'autocomplete="email" inputmode="email" autocapitalize="none" maxlength="254" required')}${passwordInput('account-email-password', 'Senha atual')}${data.phoneVerified && data.capabilities.smsAvailable && data.capabilities.emailAvailable ? `<label class="account-check"><input type="checkbox" name="notifySms" ${data.notifySms ? 'checked' : ''}>Também receber um aviso de segurança por SMS no celular confirmado</label>` : ''}<div class="account-actions">${submitButton('Confirmar novo e-mail', data.busy)}<button class="btn soft" type="button" data-account-action="refresh" data-account-refresh="1" ${data.busy ? 'disabled' : ''}>Já confirmei o e-mail</button></div></form></section><section class="account-section"><h3>Redefinir senha</h3><p>Receba instruções de recuperação para cadastrar uma nova senha.</p><div class="account-field"><label for="account-security-channel">Receber por</label><select id="account-security-channel" name="channel" ${data.busy ? 'disabled' : ''}><option value="email" ${data.channel === 'email' ? 'selected' : ''}>E-mail da conta</option>${data.capabilities.smsAvailable && data.phoneVerified ? `<option value="sms" ${data.channel === 'sms' ? 'selected' : ''}>SMS no celular confirmado</option>` : ''}</select></div><button class="btn soft" type="button" data-account-action="reset" data-account-reset="1" ${data.busy ? 'disabled' : ''}>${data.channel === 'sms' ? 'Receber código por SMS' : 'Receber e-mail de redefinição'}</button></section><section class="account-section"><h3>Celular para recuperação</h3>${data.phoneVerified ? `<p class="account-status is-success">Celular confirmado: <strong>${esc(data.verifiedPhone)}</strong></p>` : '<p>Confirme um celular para poder recuperar a senha por SMS.</p>'}${data.capabilities.smsAvailable ? `<form id="account-phone-form" class="account-form">${input('account-phone', 'phone', data.phoneVerified ? 'Novo celular' : 'Celular com DDD e código do país', 'tel', data.phone, 'autocomplete="tel" placeholder="+55 12 99999-9999" maxlength="24" required')}${passwordInput('account-phone-password', 'Senha atual')}${submitButton(data.phoneVerified ? 'Confirmar outro celular' : 'Enviar código de confirmação', data.busy)}</form>` : `<p class="account-help">${messages.unavailable}</p>`}</section>`;
    }
    function view() {
      const data = getState(); if (!data.open) return '';
      const title = data.mode === 'account' ? 'Minha conta' : 'Recuperar acesso';
      const body = data.panel === 'complete' ? '<p class="account-help">Você pode fechar esta janela e entrar com a nova senha.</p>' : data.mode === 'account' ? accountView(data) : data.panel === 'sms-reset' ? smsResetForm(data) : recoveryForm(data);
      return `<div class="bf-account"><header class="account-header"><div><p class="account-eyebrow">BancaFlow · Univap</p><h2 id="account-dialog-title">${title}</h2></div><button class="icon-btn" type="button" data-account-action="close" data-account-close="1" aria-label="Fechar área da conta">×</button></header>${data.mode === 'account' ? `<p class="account-greeting">Olá, <strong>${esc(data.name || 'professor')}</strong>. Gerencie os dados de acesso da sua conta.</p>` : '<p>Escolha como deseja receber as instruções para entrar novamente.</p>'}${data.loading ? '<p class="account-help" role="status">Consultando os canais de recuperação…</p>' : ''}${data.error ? `<div class="account-error" role="alert">${esc(data.error)}</div>` : ''}${data.success ? `<div class="account-success" role="status" aria-live="polite">${esc(data.success)}</div>` : ''}<div class="account-body" aria-busy="${data.busy}">${body}</div>${data.busy ? '<p class="account-help" role="status" aria-live="polite">Concluindo sua solicitação…</p>' : ''}</div>`;
    }
    return Object.freeze({ openRecovery, openAccount, close, reset, view, getState, setChannel, setDraft, submit, action, sendRecovery });
  }
  return Object.freeze({ createController, emailOf, phoneOf, messages });
});
