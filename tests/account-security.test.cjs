const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const account = require('../assets/account-security.js');

const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(values = {}) {
  const data = { session: { revision: 1 }, capabilities: { emailAvailable: false, smsAvailable: false }, info: { emailAvailable: true, smsAvailable: true, phone: '+5512999999999', phoneVerified: true }, requests: [], native: [], changes: 0, ...values };
  const controller = account.createController({ getSession: () => data.session, onChange: () => data.changes++,
    request: async (name, payload, authenticated) => {
      data.requests.push({ name, payload: clone(payload), authenticated });
      if (data.requestHook) { const result = await data.requestHook(name, payload, authenticated); if (result !== undefined) return result; }
      if (name === 'getCapabilities') return data.capabilities;
      if (name === 'getAccount') return data.info;
      if (name === 'confirmPasswordResetSms') return { oobCode: 'private-code' };
      return { ok: true };
    },
    authApi: {
      resetEmail: async email => { data.native.push(['resetEmail', email]); if (data.resetError) throw data.resetError; },
      reauthenticate: async password => { data.native.push(['reauthenticate', password]); if (data.reauthHook) await data.reauthHook(); if (data.reauthError) throw data.reauthError; },
      verifyEmailChange: async email => data.native.push(['verifyEmailChange', email]),
      confirmReset: async (code, password) => { data.native.push(['confirmReset', code, password]); if (data.confirmError) throw data.confirmError; },
      validatePassword: async password => { data.native.push(['validatePassword', password]); if (data.passwordHook) return data.passwordHook(password); return { isValid: true }; },
      refreshAccount: async () => { data.native.push(['refreshAccount']); if (data.refreshHook) await data.refreshHook(); }
    }
  });
  const logIn = (extra = {}) => { data.session = { revision: 1, user: { uid: 'teacher', email: 'teacher@example.test' }, profile: { name: 'Professor Áureo', email: 'teacher@example.test', role: 'teacher', active: true }, ...extra }; };
  return { controller, data, logIn };
}

test('UMD exports without browser dependencies and validates email/E164 without mutating values', () => {
  const context = vm.createContext({}); vm.runInContext(readFileSync(join(__dirname, '../assets/account-security.js'), 'utf8'), context);
  assert.equal(typeof context.BancaAccountSecurity.createController, 'function');
  assert.equal(account.emailOf(' Prof@Example.test '), 'prof@example.test');
  assert.equal(account.phoneOf('+55 (12) 99999-9999'), '+5512999999999');
  for (const value of ['wrong', 'a@b', 'a@ b.test', 'x'.repeat(250) + '@x.test']) assert.throws(() => account.emailOf(value), /válido/);
  for (const value of ['12999999999', '+00000000', '+1', '+1234567890123456']) assert.throws(() => account.phoneOf(value), /celular/);
});

test('unconfigured backend keeps native email recovery and a truthful unavailable SMS explanation', async () => {
  const h = harness({ requestHook: async () => { throw Error('offline'); } });
  h.controller.openRecovery('USER@EXAMPLE.TEST'); await tick();
  assert.equal(await h.controller.submit('account-recovery-form', { email: 'USER@EXAMPLE.TEST', channel: 'email' }), true);
  assert.deepEqual(h.data.native, [['resetEmail', 'user@example.test']]);
  assert.match(h.controller.view(), /Se os dados corresponderem/);
  assert.match(h.controller.view(), /SMS ainda não está disponível/);
  assert.doesNotMatch(h.controller.view(), /option value="sms"/);
  h.controller.setChannel('sms'); assert.equal(h.controller.getState().channel, 'email');
});

test('personalized backend email requests use a generic public result and capabilities load once', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true } });
  h.controller.openRecovery(); await tick();
  await h.controller.submit('account-recovery-form', new Map([['email', 'other@example.test'], ['channel', 'email']]));
  assert.equal(h.data.native.length, 0);
  assert.deepEqual(h.data.requests.at(-1), { name: 'requestPasswordResetEmail', payload: { email: 'other@example.test' }, authenticated: false });
  assert.match(h.controller.getState().success, /Se os dados corresponderem/);
  h.controller.close(); h.controller.openRecovery(); await tick();
  assert.equal(h.data.requests.filter(item => item.name === 'getCapabilities').length, 1);
});

test('unknown native reset account and successful native reset produce the same generic result', async () => {
  const h = harness(); h.controller.openRecovery(); await tick();
  await h.controller.sendRecovery({ email: 'known@example.test' }); const expected = h.controller.getState().success;
  h.data.resetError = Object.assign(Error('missing user details'), { code: 'auth/user-not-found' });
  await h.controller.sendRecovery({ email: 'unknown@example.test' });
  assert.equal(h.controller.getState().success, expected); assert.equal(h.controller.getState().error, '');
});

test('SMS recovery uses the supplied account email and canonical phone, then Firebase resets after OTP proof', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true } }); h.controller.openRecovery(); await tick();
  h.controller.setChannel('sms');
  assert.equal(await h.controller.submit('account-recovery-form', { email: 'teacher@example.test', channel: 'sms', phone: '+55 (12) 99999-9999' }), true);
  assert.equal(h.controller.getState().panel, 'sms-reset'); assert.match(h.controller.view(), /account-sms-reset-form/);
  await h.controller.submit('account-sms-reset-form', { code: '123456', password: 'StrongPassword123!', confirm: 'StrongPassword123!' });
  const confirmed = h.data.requests.find(item => item.name === 'confirmPasswordResetSms');
  assert.deepEqual(confirmed, { name: 'confirmPasswordResetSms', payload: { email: 'teacher@example.test', phone: '+5512999999999', code: '123456' }, authenticated: false });
  assert.deepEqual(h.data.native.at(-1), ['confirmReset', 'private-code', 'StrongPassword123!']);
  assert.equal(h.controller.getState().panel, 'complete'); assert.doesNotMatch(JSON.stringify(h.controller.getState()), /private-code|StrongPassword|123456/);
});

test('password validation happens before consuming the SMS code and identifies project policy requirements', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true }, passwordHook: () => ({ isValid: false, meetsMinPasswordLength: false, containsUppercaseLetter: false, passwordPolicy: { customStrengthOptions: { minPasswordLength: 12 } } }) });
  h.controller.openRecovery(); await tick(); await h.controller.sendRecovery({ email: 'teacher@example.test', channel: 'sms', phone: '+5512999999999' });
  assert.equal(await h.controller.submit('account-sms-reset-form', { code: '123456', password: 'passwordlong', confirm: 'passwordlong' }), false);
  assert.match(h.controller.getState().error, /12 caracteres.*maiúscula/);
  assert.equal(h.data.requests.filter(item => item.name === 'confirmPasswordResetSms').length, 0);
  assert.doesNotMatch(JSON.stringify(h.controller.getState()), /passwordlong/);
});

test('password confirmation and invalid OTP fail before contacting recovery backend', async () => {
  const h = harness({ capabilities: { smsAvailable: true } }); h.controller.openRecovery(); await tick();
  await h.controller.sendRecovery({ email: 'teacher@example.test', channel: 'sms', phone: '+5512999999999' });
  await h.controller.submit('account-sms-reset-form', { code: '123456', password: 'password1', confirm: 'password2' });
  assert.match(h.controller.getState().error, /confirmação/);
  await h.controller.submit('account-sms-reset-form', { code: '12<script>', password: 'password1', confirm: 'password1' });
  assert.match(h.controller.getState().error, /6 números/);
  assert.equal(h.data.requests.filter(item => item.name === 'confirmPasswordResetSms').length, 0);
});

test('a confirmed OTP can retry a Firebase password-policy failure without being consumed twice', async () => {
  const h = harness({ capabilities: { smsAvailable: true }, confirmError: Object.assign(Error('policy'), { code: 'auth/weak-password' }) });
  h.controller.openRecovery(); await tick(); await h.controller.sendRecovery({ email: 'teacher@example.test', channel: 'sms', phone: '+5512999999999' });
  await h.controller.submit('account-sms-reset-form', { code: '123456', password: 'password1', confirm: 'password1' });
  assert.match(h.controller.getState().error, /requisitos/); assert.doesNotMatch(JSON.stringify(h.controller.getState()), /private-code/);
  assert.match(h.controller.view(), /Código confirmado/);
  h.data.confirmError = null;
  assert.equal(await h.controller.submit('account-sms-reset-form', { password: 'BetterPassword1!', confirm: 'BetterPassword1!' }), true);
  assert.equal(h.data.requests.filter(item => item.name === 'confirmPasswordResetSms').length, 1);
});

test('account requires an active professor and greets teacher/coordinator safely without a name whitelist', async () => {
  const h = harness(); assert.throws(() => h.controller.openAccount(), /Entre/);
  h.logIn(); h.data.session.profile.name = '<img src=x onerror=alert(1)>'; h.controller.openAccount(); await tick();
  assert.match(h.controller.view(), /&lt;img/); assert.doesNotMatch(h.controller.view(), /<img/);
  assert.match(h.controller.view(), /Minha conta/); assert.match(h.controller.view(), /Senha atual/);
  h.data.session.profile.active = false; assert.throws(() => h.controller.openAccount(), /Entre/);
  h.data.session.profile.active = true; h.data.session.profile.role = 'coordinator'; h.controller.openAccount(); await tick(); assert.equal(h.controller.getState().open, true);
});

test('native email change reauthenticates and sends verification while preserving original identity and profile', async () => {
  const h = harness(); h.logIn(); const original = clone(h.data.session); h.controller.openAccount(); await tick();
  assert.equal(await h.controller.submit('account-email-form', { newEmail: 'NEW@EXAMPLE.TEST', password: 'old-password' }), true);
  assert.deepEqual(h.data.native, [['reauthenticate', 'old-password'], ['verifyEmailChange', 'new@example.test']]);
  assert.deepEqual(h.data.session, original); assert.match(h.controller.getState().success, /Professor Áureo.*new@example.test/);
  assert.doesNotMatch(JSON.stringify(h.controller.getState()), /old-password/);
});

test('backend email change includes explicit SMS notice only with an already verified phone and ready channels', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true } }); h.logIn(); h.controller.openAccount(); await tick();
  assert.match(h.controller.view(), /name="notifySms"/);
  await h.controller.submit('account-email-form', { newEmail: 'new@example.test', password: 'password', notifySms: 'on' });
  assert.deepEqual(h.data.requests.at(-1), { name: 'requestEmailChange', payload: { newEmail: 'new@example.test', notifySms: true }, authenticated: true });
  h.data.info.phoneVerified = false; h.controller.openAccount(); await tick(); assert.doesNotMatch(h.controller.view(), /name="notifySms"/);
  await h.controller.submit('account-email-form', { newEmail: 'another@example.test', password: 'password', notifySms: 'on' });
  assert.equal(h.data.requests.at(-1).payload.notifySms, false);
});

test('same email, missing password and failed reauthentication cannot send an email-change link', async () => {
  const h = harness(); h.logIn(); h.controller.openAccount(); await tick();
  await h.controller.submit('account-email-form', { newEmail: 'teacher@example.test', password: 'secret' }); assert.match(h.controller.getState().error, /diferente/);
  await h.controller.submit('account-email-form', { newEmail: 'new@example.test', password: '' }); assert.match(h.controller.getState().error, /senha atual/);
  h.data.reauthError = Object.assign(Error('credential metadata'), { code: 'auth/invalid-credential' });
  await h.controller.submit('account-email-form', { newEmail: 'new@example.test', password: 'wrong' }); assert.match(h.controller.getState().error, /senha atual não foi confirmada/);
  assert.equal(h.data.native.filter(item => item[0] === 'verifyEmailChange').length, 0);
});

test('phone enrollment requires recent password proof and only marks phone verified after code confirmation', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true }, info: { emailAvailable: true, smsAvailable: true, phoneVerified: false } }); h.logIn(); h.controller.openAccount(); await tick();
  await h.controller.submit('account-phone-form', { phone: '+5512888888888', password: 'current-password' });
  assert.equal(h.controller.getState().panel, 'phone-confirm'); assert.equal(h.controller.getState().phoneVerified, false);
  assert.deepEqual(h.data.requests.at(-1), { name: 'enrollPhoneStart', payload: { phone: '+5512888888888' }, authenticated: true });
  await h.controller.submit('account-phone-confirm-form', { phone: '+5512000000000', code: '654321' });
  assert.deepEqual(h.data.requests.at(-1), { name: 'enrollPhoneConfirm', payload: { phone: '+5512888888888', code: '654321' }, authenticated: true });
  assert.equal(h.controller.getState().phoneVerified, true); assert.equal(h.controller.getState().phone, '+5512888888888');
});

test('disabled channels and nonverified phone do not offer or initiate account SMS recovery', async () => {
  const h = harness(); h.logIn(); h.controller.openAccount(); await tick();
  await h.controller.submit('account-phone-form', { phone: '+5512999999999', password: 'secret' }); assert.match(h.controller.getState().error, /SMS ainda/);
  assert.equal(h.data.native.length, 0);
  const ready = harness({ capabilities: { smsAvailable: true }, info: { emailAvailable: true, smsAvailable: true, phoneVerified: false } }); ready.logIn(); ready.controller.openAccount(); await tick();
  ready.controller.setChannel('sms'); assert.equal(ready.controller.getState().channel, 'email'); assert.match(ready.controller.getState().error, /Confirme primeiro/);
});

test('editing the phone draft never labels it verified or changes the existing SMS recovery destination', async () => {
  const h = harness({ capabilities: { emailAvailable: true, smsAvailable: true } }); h.logIn(); h.controller.openAccount(); await tick();
  h.controller.setDraft('phone', '+5512888888888');
  assert.match(h.controller.view(), /Celular confirmado: <strong>\+5512999999999/);
  h.controller.setChannel('sms'); await h.controller.action('reset');
  const reset = h.data.requests.find(item => item.name === 'requestPasswordResetSms');
  assert.equal(reset.payload.phone, '+5512999999999');
});

test('busy submits are ignored and closing prevents late email results from repopulating the UI', async () => {
  const pending = deferred(); const h = harness({ capabilities: { emailAvailable: true }, requestHook: name => name === 'requestPasswordResetEmail' ? pending.promise : undefined });
  h.controller.openRecovery(); await tick(); const sending = h.controller.sendRecovery({ email: 'teacher@example.test' }); await tick();
  assert.equal(h.controller.getState().busy, true); assert.equal(await h.controller.sendRecovery({ email: 'other@example.test' }), false);
  assert.equal(h.data.requests.filter(item => item.name === 'requestPasswordResetEmail').length, 1);
  h.controller.close(); pending.resolve({ ok: true }); assert.equal(await sending, false); assert.equal(h.controller.view(), ''); assert.equal(h.controller.getState().success, '');
});

test('a changed account or access revision stops email change between reauthentication and the send', async () => {
  const pending = deferred(); const h = harness({ reauthHook: () => pending.promise }); h.logIn(); h.controller.openAccount(); await tick();
  const changing = h.controller.submit('account-email-form', { newEmail: 'new@example.test', password: 'private' }); await tick();
  h.data.session.revision++; pending.resolve(); assert.equal(await changing, false);
  assert.equal(h.data.native.filter(item => item[0] === 'verifyEmailChange').length, 0); assert.equal(h.controller.getState().open, false);
});

test('native account refresh uses the canonical auth email and never performs profile writes itself', async () => {
  const h = harness(); h.logIn(); h.data.refreshHook = async () => { h.data.session.user.email = 'confirmed@example.test'; }; h.controller.openAccount(); await tick();
  await h.controller.action('refresh'); assert.equal(h.controller.getState().email, 'confirmed@example.test');
  assert.equal(h.data.session.profile.email, 'teacher@example.test'); assert.deepEqual(h.data.native, [['refreshAccount']]);
});

test('backend failures use friendly codes and never render raw provider messages or hidden codes', async () => {
  const h = harness({ capabilities: { emailAvailable: true }, requestHook: name => name === 'requestPasswordResetEmail' ? { ok: false, error: { code: 'delivery-failed', message: 'smtp-password secret' } } : undefined });
  h.controller.openRecovery(); await tick(); await h.controller.sendRecovery({ email: 'teacher@example.test' });
  assert.match(h.controller.getState().error, /enviar a mensagem/); assert.doesNotMatch(h.controller.view(), /smtp-password|secret/);
  h.data.requestHook = name => name === 'requestPasswordResetEmail' ? { ok: false, error: { code: 'unexpected', message: 'private internal data' } } : undefined;
  await h.controller.sendRecovery({ email: 'teacher@example.test' }); assert.doesNotMatch(h.controller.view(), /private internal data/);
});

test('nonsecret draft capture never retains passwords, verification codes or reset codes', async () => {
  const h = harness(); h.controller.openRecovery(); await tick();
  h.controller.setDraft('email', '<script>@example.test'); h.controller.setDraft('password', 'secret'); h.controller.setDraft('code', '123456'); h.controller.setDraft('oobCode', 'private-code');
  const markup = h.controller.view(); assert.match(markup, /&lt;script&gt;/); assert.doesNotMatch(markup, /<script>|private-code|secret|123456/);
  h.controller.reset(); assert.equal(h.controller.getState().email, ''); assert.equal(h.controller.getState().open, false);
});
