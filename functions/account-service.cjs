'use strict';

// Account administration is deliberately isolated from banks, grades and reports.
// Dependencies are injected so authorization, races and failed deliveries can be
// tested without connecting to a real Firebase project or sending real messages.
const crypto = require('node:crypto');
const TTL = 10 * 60 * 1000;
const RESEND = 60 * 1000;
const RECENT = 5 * 60;
const GENERIC = 'Se os dados corresponderem a uma conta habilitada, você receberá as instruções. Confira também a caixa de spam.';
const INVALID_CODE = 'O código é inválido ou expirou. Solicite um novo código e tente novamente.';
const ACTIONS = new Set(['getCapabilities', 'getAccount', 'requestPasswordResetEmail', 'requestEmailChange', 'notifyEmailChange', 'enrollPhoneStart', 'enrollPhoneConfirm', 'requestPasswordResetSms', 'confirmPasswordResetSms']);

class AccountError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const problem = (code, message, status) => { throw new AccountError(code, message, status); };
const email = value => {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) problem('invalid-email', 'Informe um e-mail válido.');
  return result;
};
const phone = value => {
  const result = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
  if (!/^\+[1-9]\d{7,14}$/.test(result)) problem('invalid-phone', 'Informe o celular com código do país e DDD. Exemplo: +5512999999999.');
  return result;
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeName = value => String(value || 'professor').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'professor';
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};
const active = profile => !!profile && profile.active !== false && ['teacher', 'coordinator'].includes(profile.role);

function message(kind, name, link) {
  const greeting = `Olá, ${safeName(name)}.`;
  const change = kind === 'emailChange';
  const title = change ? 'Confirme seu novo e-mail' : 'Redefina sua senha';
  const explanation = change ? 'Você solicitou a troca do e-mail de acesso ao BancaFlow. Confirme este endereço para concluir a alteração. Sua conta, bancas e notas serão preservadas.' : 'Recebemos uma solicitação para redefinir sua senha do BancaFlow. Use o botão abaixo para escolher uma nova senha. Sua conta, bancas e notas serão preservadas.';
  const button = change ? 'Confirmar novo e-mail' : 'Criar nova senha';
  const warning = 'Se você não fez esta solicitação, ignore esta mensagem. Nunca compartilhe sua senha ou códigos de confirmação.';
  return {
    subject: `BancaFlow · ${title}`,
    text: `${greeting}\n\n${explanation}\n\n${button}: ${link}\n\n${warning}\n\nBancaFlow · Univap`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f6fb;color:#21354b;font-family:Arial,sans-serif"><div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #dbe5ee;border-radius:12px;overflow:hidden"><div style="padding:24px;background:#004c8c;color:white"><strong style="font-size:24px">BancaFlow</strong><div style="margin-top:6px">Gestão de bancas · Univap</div></div><div style="padding:28px"><h1 style="font-size:22px;color:#004c8c">${title}</h1><p>${escape(greeting)}</p><p style="line-height:1.6">${explanation}</p><p style="margin:28px 0"><a href="${escape(link)}" style="background:#0057a4;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;display:inline-block">${button}</a></p><p style="font-size:13px;line-height:1.6;color:#546778">${warning}</p><p style="font-size:12px;word-break:break-all">Se o botão não abrir, copie este endereço:<br><a href="${escape(link)}">${escape(link)}</a></p></div></div></body></html>`
  };
}

function createAccountService(options) {
  const { auth, db, mail, sms } = options;
  const clock = options.now || Date.now;
  const random = options.randomCode || (() => String(crypto.randomInt(0, 1000000)).padStart(6, '0'));
  const nonce = options.randomNonce || (() => crypto.randomBytes(18).toString('hex'));
  const config = options.config || {};
  if (typeof config.otpPepper !== 'string' || config.otpPepper.length < 32 || /SUBSTITUA|CHANGE.?ME|EXAMPLE/i.test(config.otpPepper)) throw Error('Configure otpPepper com pelo menos 32 caracteres aleatórios.');
  const digest = (...parts) => crypto.createHmac('sha256', config.otpPepper).update(JSON.stringify(parts)).digest('hex');
  const siteUrl = config.siteUrl || 'https://perabru.github.io/banca-flow/';
  const actionPageUrl = config.actionPageUrl || new URL('account-action.html', siteUrl).href;
  for (const value of [siteUrl, actionPageUrl]) {
    const parsed = new URL(value);
    const local = options.emulator === true && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if ((!local && parsed.protocol !== 'https:') || parsed.username || parsed.password) throw Error('As URLs de produção devem usar HTTPS, sem credenciais.');
  }
  const capabilities = () => ({ emailAvailable: !!mail?.available, smsAvailable: !!sms?.available });
  const settings = { url: siteUrl, handleCodeInApp: false };
  const actionLink = generated => {
    const source = new URL(generated), target = new URL(actionPageUrl);
    for (const key of ['mode', 'oobCode', 'apiKey', 'tenantId']) if (source.searchParams.has(key)) target.searchParams.set(key, source.searchParams.get(key));
    if (!target.searchParams.get('oobCode')) throw Error('Firebase action link did not contain a code.');
    target.searchParams.set('lang', 'pt-BR');
    return target.href;
  };
  async function limit(scope, key, maximum, windowMs) {
    const time = clock(), bucket = Math.floor(time / windowMs);
    const result = await db.transaction(`accountSecurity/rateLimits/${digest(scope, key, bucket)}`, current => {
      const count = current && typeof current.count === 'number' ? current.count : 0;
      if (count >= maximum) return undefined;
      return { count: count + 1, expiresAt: (bucket + 2) * windowMs };
    });
    if (!result.committed) problem('too-many-requests', 'Muitas solicitações. Aguarde alguns minutos antes de tentar novamente.', 429);
  }
  async function user(context, recent = false) {
    if (!context?.token) problem('unauthenticated', 'Entre novamente para gerenciar sua conta.', 401);
    let token;
    try { token = await auth.verifyIdToken(context.token, true); } catch { problem('unauthenticated', 'Sua sessão expirou. Entre novamente.', 401); }
    if (!token?.uid) problem('unauthenticated', 'Entre novamente para gerenciar sua conta.', 401);
    if (recent && (!Number.isFinite(token.auth_time) || clock() / 1000 - token.auth_time > RECENT || token.auth_time > clock() / 1000 + 60)) problem('requires-recent-login', 'Confirme sua senha atual para continuar.', 401);
    const [record, profile] = await Promise.all([auth.getUser(token.uid), db.get(`users/${token.uid}`)]);
    if (record.disabled || !active(profile) || !record.email) problem('permission-denied', 'Esta conta não está habilitada para esta operação.', 403);
    return { record, profile, uid: token.uid };
  }
  async function lookup(address) {
    try {
      const record = await auth.getUserByEmail(address);
      const profile = await db.get(`users/${record.uid}`);
      return !record.disabled && active(profile) ? { record, profile, uid: record.uid } : null;
    } catch (error) {
      if (['auth/user-not-found', 'auth/invalid-email'].includes(error?.code)) return null;
      throw error;
    }
  }
  function available(channel) {
    if (!capabilities()[channel + 'Available']) problem('unavailable-channel', channel === 'sms' ? 'O envio por SMS ainda não foi ativado pela administração. Use a recuperação por e-mail.' : 'O envio personalizado de e-mail ainda não foi ativado. Use a recuperação padrão por e-mail.', 503);
  }
  const slot = (kind, uid) => `accountSecurity/challenges/${kind}/${digest(uid)}`;
  const codeHash = (kind, uid, targetHash, salt, code) => digest('otp', kind, uid, targetHash, salt, code);
  async function issue(kind, account, destination, context) {
    const { uid, profile } = account, targetHash = digest('phone', destination), time = clock();
    await limit('otp-account', uid, 5, 60 * 60 * 1000);
    await limit('otp-phone', targetHash, 5, 60 * 60 * 1000);
    const code = random(), salt = nonce();
    if (!/^\d{6}$/.test(code)) throw Error('OTP source must yield six digits.');
    const challenge = { targetHash, salt, codeHash: codeHash(kind, uid, targetHash, salt, code), createdAt: time, expiresAt: time + TTL, attempts: 0, state: 'sending' };
    const path = slot(kind, uid);
    const acquired = await db.transaction(path, current => {
      if (current?.createdAt > time - RESEND && current?.expiresAt > time) return undefined;
      return challenge;
    });
    if (!acquired.committed) return false;
    try {
      const first = safeName(profile.name).split(/\s+/)[0].slice(0, 24);
      const purpose = kind === 'enroll' ? 'confirmar seu celular' : 'redefinir sua senha';
      await sms.send({ to: destination, body: `BancaFlow: ${first}, seu codigo para ${purpose} e ${code}. Valido por 10 minutos. Nao compartilhe.` });
      await db.transaction(path, current => current?.salt === salt && current.state === 'sending' ? { ...current, state: 'ready' } : undefined);
      return true;
    } catch (error) {
      // No code can be consumed if delivery was rejected. Keep the cooldown and
      // attempt record, but remove its hash; retry is possible after one minute.
      await db.transaction(path, current => current?.salt === salt && current.state === 'sending' ? { ...current, state: 'delivery-failed', codeHash: null } : undefined);
      throw new AccountError('delivery-failed', 'Não foi possível enviar a mensagem. Aguarde um minuto e tente novamente.', 503);
    }
  }
  async function consume(kind, uid, destination, value) {
    if (typeof value !== 'string' || !/^\d{6}$/.test(value)) problem('invalid-code', INVALID_CODE);
    const time = clock(), targetHash = digest('phone', destination), claim = nonce();
    const result = await db.transaction(slot(kind, uid), current => {
      if (!current || current.state !== 'ready' || current.expiresAt <= time || current.attempts >= 5 || current.targetHash !== targetHash) return undefined;
      const valid = equal(current.codeHash, codeHash(kind, uid, targetHash, current.salt, value));
      return valid ? { ...current, state: 'consumed', consumedAt: time, claim, codeHash: null } : { ...current, attempts: current.attempts + 1, ...(current.attempts + 1 >= 5 ? { state: 'locked', codeHash: null } : {}) };
    });
    if (!result.committed || result.value?.claim !== claim || result.value?.state !== 'consumed') problem('invalid-code', INVALID_CODE);
  }
  async function notifyEmailChange(account) {
    const path = `accountSecurity/emailChanges/${digest(account.uid)}`;
    const target = account.record.email.toLowerCase(), time = clock(), claim = nonce();
    const claimed = await db.transaction(path, current => {
      if (!current || current.state !== 'pending' || current.newEmail !== target || account.record.emailVerified !== true || current.expiresAt <= time) return undefined;
      return { ...current, state: 'notifying', claim, confirmedAt: time };
    });
    if (!claimed.committed || claimed.value?.claim !== claim) return;
    const pending = claimed.value;
    let emailSent = false, smsSent = false;
    if (capabilities().emailAvailable) {
      try {
        await mail.send({ to: pending.oldEmail, subject: 'BancaFlow · E-mail de acesso alterado', text: `Olá, ${safeName(account.profile.name)}.\n\nA troca do seu e-mail de acesso ao BancaFlow foi confirmada. Suas bancas, notas e relatórios continuam na mesma conta.\n\nSe você não reconhece esta alteração, procure a coordenação imediatamente.\n\nBancaFlow · Univap`, html: `<p>Olá, ${escape(safeName(account.profile.name))}.</p><p>A troca do seu e-mail de acesso ao <strong>BancaFlow</strong> foi confirmada. Suas bancas, notas e relatórios continuam na mesma conta.</p><p>Se você não reconhece esta alteração, procure a coordenação imediatamente.</p><p>BancaFlow · Univap</p>` });
        emailSent = true;
      } catch { options.onDeliveryFailure?.('email-change-confirmed'); }
    }
    if (pending.notifySms === true && capabilities().smsAvailable) {
      const contacts = await db.get(`accountContacts/${account.uid}`);
      if (contacts?.phoneVerified === true) {
        try { await sms.send({ to: contacts.phone, body: `BancaFlow: ${safeName(account.profile.name).split(/\s+/)[0].slice(0, 24)}, a troca do seu e-mail foi confirmada. Sua conta e notas foram preservadas. Nao reconhece? Procure a coordenacao.` }); smsSent = true; }
        catch { options.onDeliveryFailure?.('sms-email-change-confirmed'); }
      }
    }
    await db.transaction(path, current => current?.claim === claim && current.state === 'notifying' ? { ...current, state: 'notified', emailSent, smsSent } : undefined);
  }
  async function execute(input, context = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !ACTIONS.has(input.action)) problem('invalid-action', 'Operação de conta não reconhecida.');
    const { action } = input;
    if (action === 'getCapabilities') return { ok: true, ...capabilities() };
    await limit('ip', context.ip || 'unknown', 30, 60 * 60 * 1000);
    if (action === 'getAccount') {
      const account = await user(context), contacts = await db.get(`accountContacts/${account.uid}`);
      await notifyEmailChange(account);
      return { ok: true, ...capabilities(), phone: contacts?.phoneVerified === true ? contacts.phone : '', phoneVerified: contacts?.phoneVerified === true };
    }
    if (action === 'notifyEmailChange') { const account = await user(context); await notifyEmailChange(account); return { ok: true }; }
    if (action === 'requestPasswordResetEmail') {
      available('email'); const address = email(input.email);
      await limit('reset-email', digest(address), 5, 60 * 60 * 1000);
      const account = await lookup(address);
      if (account) {
        const link = actionLink(await auth.generatePasswordResetLink(account.record.email, settings));
        try { await mail.send({ to: account.record.email, ...message('passwordReset', account.profile.name, link) }); }
        catch { options.onDeliveryFailure?.('email-password-reset'); }
      }
      return { ok: true, message: GENERIC };
    }
    if (action === 'requestEmailChange') {
      available('email'); const account = await user(context, true), address = email(input.newEmail);
      if (address === account.record.email.toLowerCase()) problem('same-email', 'Informe um endereço diferente do seu e-mail atual.');
      await limit('email-change', account.uid, 5, 60 * 60 * 1000);
      let generated;
      try { generated = await auth.generateVerifyAndChangeEmailLink(account.record.email, address, settings); }
      catch (error) {
        if (error?.code === 'auth/email-already-exists') problem('email-already-in-use', 'Este endereço já está vinculado a outra conta.');
        throw error;
      }
      try { await mail.send({ to: address, ...message('emailChange', account.profile.name, actionLink(generated)) }); }
      catch { problem('delivery-failed', 'Não foi possível enviar a mensagem de confirmação. Tente novamente mais tarde.', 503); }
      await db.set(`accountSecurity/emailChanges/${digest(account.uid)}`, { oldEmail: account.record.email, newEmail: address, notifySms: input.notifySms === true, requestedAt: clock(), expiresAt: clock() + 7 * 24 * 60 * 60 * 1000, state: 'pending' });
      let smsNoticeSent = false;
      if (input.notifySms === true && capabilities().smsAvailable) {
        const contacts = await db.get(`accountContacts/${account.uid}`);
        if (contacts?.phoneVerified === true) {
          try { await sms.send({ to: contacts.phone, body: `BancaFlow: ${safeName(account.profile.name).split(/\s+/)[0].slice(0, 24)}, recebemos uma solicitacao de troca de e-mail. Confirme no novo endereco. Se nao foi voce, procure a coordenacao.` }); smsNoticeSent = true; }
          catch { options.onDeliveryFailure?.('sms-email-change-requested'); }
        }
      }
      // Firebase verifies the new address and changes Authentication only when
      // the recipient follows this link; no UID/profile/grades are replaced.
      return { ok: true, smsNoticeSent, message: `${safeName(account.profile.name)}, enviamos uma confirmação para ${address}. Seu e-mail atual continua válido até você confirmar a troca.` };
    }
    if (action === 'enrollPhoneStart') {
      available('sms'); const account = await user(context, true), destination = phone(input.phone);
      const sent = await issue('enroll', account, destination, context);
      return { ok: true, message: sent ? 'Enviamos um código para confirmar seu celular. Ele vale por 10 minutos.' : 'Aguarde um minuto entre os envios e use o código mais recente.', retryAfterSeconds: 60 };
    }
    if (action === 'enrollPhoneConfirm') {
      available('sms'); const account = await user(context, true), destination = phone(input.phone);
      await consume('enroll', account.uid, destination, input.code);
      const current = await user(context, true);
      await db.set(`accountContacts/${current.uid}`, { phone: destination, phoneVerified: true, verifiedAt: clock() });
      return { ok: true, phone: destination, phoneVerified: true, message: `${safeName(account.profile.name)}, seu celular foi confirmado e poderá ser usado para recuperar sua conta.` };
    }
    if (action === 'requestPasswordResetSms') {
      available('sms'); const address = email(input.email), destination = phone(input.phone);
      await limit('sms-request', digest(address, destination), 5, 60 * 60 * 1000);
      const account = await lookup(address);
      if (account) {
        const contacts = await db.get(`accountContacts/${account.uid}`);
        if (contacts?.phoneVerified === true && contacts.phone === destination) {
          try { await issue('reset', account, destination, context); }
          catch (error) { if (!['delivery-failed', 'too-many-requests'].includes(error?.code)) throw error; options.onDeliveryFailure?.('sms-password-reset'); }
        }
      }
      return { ok: true, message: 'Se este celular já estiver confirmado na conta informada, você receberá um código válido por 10 minutos.', retryAfterSeconds: 60 };
    }
    if (action === 'confirmPasswordResetSms') {
      available('sms'); const address = email(input.email), destination = phone(input.phone);
      await limit('sms-confirm', digest(address, destination), 10, 60 * 60 * 1000);
      const account = await lookup(address);
      if (!account) problem('invalid-code', INVALID_CODE);
      const contacts = await db.get(`accountContacts/${account.uid}`);
      if (contacts?.phoneVerified !== true || contacts.phone !== destination) problem('invalid-code', INVALID_CODE);
      await consume('reset', account.uid, destination, input.code);
      // This proof issues a Firebase one-use password reset code. The client
      // applies confirmPasswordReset, which enforces the project's own policy.
      const latest = await lookup(address);
      if (!latest || latest.uid !== account.uid) problem('invalid-code', INVALID_CODE);
      const currentContacts = await db.get(`accountContacts/${latest.uid}`);
      if (currentContacts?.phoneVerified !== true || currentContacts.phone !== destination) problem('invalid-code', INVALID_CODE);
      const code = new URL(await auth.generatePasswordResetLink(latest.record.email, settings)).searchParams.get('oobCode');
      if (!code) throw Error('Firebase password reset code missing.');
      return { ok: true, oobCode: code };
    }
  }
  return { execute, capabilities };
}

module.exports = { createAccountService, AccountError, message, email, phone, constants: { TTL, RESEND, RECENT, GENERIC, INVALID_CODE } };
