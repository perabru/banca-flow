'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountService, message, email, phone, constants } = require('../functions/account-service.cjs');
const { createMailGateway, createSmsGateway } = require('../functions/gateways.cjs');
const { createAccountHttpHandler } = require('../functions/http-handler.cjs');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  let now = 1800000000000, serial = 0, code = 123456;
  const records = { u1: { uid: 'u1', email: 'one@example.test', emailVerified: true, disabled: false }, u2: { uid: 'u2', email: 'two@example.test', emailVerified: true, disabled: false } };
  const data = { users: { u1: { name: 'Professor <Um>', role: 'teacher', active: true }, u2: { name: 'Alberson', role: 'coordinator', active: true } }, accountContacts: { u1: { phone: '+5512999999999', phoneVerified: true, verifiedAt: now - 1000 } }, grades: { b1: { u1: { s1: { presentation: 0 } } } }, boards: { b1: { members: { u1: true } } } };
  const sentMail = [], sentSms = [], writes = [], deliveries = [], generated = [], queues = new Map();
  const read = path => path.split('/').reduce((v, key) => v?.[key], data) ?? null;
  const put = (path, value) => { const parts = path.split('/'), key = parts.pop(), parent = parts.reduce((v, part) => v[part] ||= {}, data); if (value === null) delete parent[key]; else parent[key] = clone(value); writes.push(path); };
  const db = { get: async path => clone(read(path)), set: async (path, value) => put(path, value), transaction: async (path, updater) => {
    const previous = queues.get(path) || Promise.resolve();
    let finish; const pending = new Promise(resolve => { finish = resolve; }); queues.set(path, pending);
    await previous;
    try { const next = updater(clone(read(path))); if (next === undefined) return { committed: false, value: clone(read(path)) }; put(path, next); return { committed: true, value: clone(read(path)) }; }
    finally { finish(); if (queues.get(path) === pending) queues.delete(path); }
  } };
  const auth = {
    verifyIdToken: async (token, checkRevoked) => { assert.equal(checkRevoked, true); if (!['token1', 'token2', 'old'].includes(token)) throw Error('Invalid token'); return { uid: token === 'token2' ? 'u2' : 'u1', auth_time: Math.floor(now / 1000) - (token === 'old' ? 600 : 10) }; },
    getUser: async uid => clone(records[uid]),
    getUserByEmail: async address => { const found = Object.values(records).find(user => user.email.toLowerCase() === address.toLowerCase()); if (!found) throw Object.assign(Error('Missing user'), { code: 'auth/user-not-found' }); return clone(found); },
    generatePasswordResetLink: async (address, settings) => { generated.push({ kind: 'reset', address, settings }); return 'https://project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=SERVER_CODE&apiKey=PUBLIC_KEY'; },
    generateVerifyAndChangeEmailLink: async (address, target, settings) => { generated.push({ kind: 'change', address, target, settings }); return 'https://project.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=CHANGE_CODE&apiKey=PUBLIC_KEY'; }
  };
  const mail = { available: options.emailAvailable !== false, send: async value => { if (options.mailError) throw Error('SMTP unavailable'); sentMail.push(value); } };
  const sms = { available: options.smsAvailable !== false, send: async value => { if (options.smsError) throw Error('SMS unavailable'); sentSms.push(value); } };
  const service = createAccountService({ auth, db, mail, sms, now: () => now, randomCode: () => String(code++), randomNonce: () => 'nonce-' + (++serial), onDeliveryFailure: kind => deliveries.push(kind), config: { otpPepper: 'test-only-pepper-abcdefghijklmnopqrstuvwxyz-123456789', siteUrl: 'https://example.test/app/', actionPageUrl: 'https://example.test/app/account-action.html' } });
  return { service, execute: (body, ctx = {}) => service.execute(body, { ip: '192.0.2.10', ...ctx }), data, records, sentMail, sentSms, writes, generated, options, deliveries, advance: ms => { now += ms; }, read, db };
}
const context = { token: 'token1' };
const requestSms = h => h.execute({ action: 'requestPasswordResetSms', email: 'one@example.test', phone: '+5512999999999' });
const confirmSms = (h, code = '123456') => h.execute({ action: 'confirmPasswordResetSms', email: 'one@example.test', phone: '+5512999999999', code });
const expectCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('input parsing requires valid email and E.164 phone, never guesses a country', () => {
  assert.equal(email(' Professor@Example.Test '), 'professor@example.test');
  assert.equal(phone('+55 (12) 99999-9999'), '+5512999999999');
  for (const value of ['', 'one', 'a@b', 'a b@example.test']) assert.throws(() => email(value));
  for (const value of ['', '12999999999', '+0', '+5512<script>']) assert.throws(() => phone(value));
});

test('mail templates escape personalized names and links and keep academic records out of delivery', () => {
  const m = message('passwordReset', '<img src=x onerror=1>', 'https://example.test/?a="&b=1');
  assert.match(m.subject, /BancaFlow/); assert.match(m.html, /&lt;img/); assert.doesNotMatch(m.html, /<img/); assert.match(m.html, /&quot;/);
  assert.match(m.text, /bancas e notas serão preservadas/);
  assert.match(message('emailChange', 'Wagner', 'https://example.test/').text, /Olá, Wagner/);
});

test('capabilities are public and truthful while own contact metadata requires a valid enabled user', async () => {
  const h = harness({ smsAvailable: false });
  assert.deepEqual(await h.execute({ action: 'getCapabilities' }), { ok: true, emailAvailable: true, smsAvailable: false });
  await expectCode(h.execute({ action: 'getAccount' }), 'unauthenticated');
  const account = await h.execute({ action: 'getAccount' }, context);
  assert.equal(account.phoneVerified, true); assert.equal(account.phone, '+5512999999999');
  const other = await h.execute({ action: 'getAccount' }, { token: 'token2' }); assert.equal(other.phone, '');
});

test('email password recovery uses canonical Auth address, personalized message and branded one-use action page', async () => {
  const h = harness(), academic = JSON.stringify([h.data.grades, h.data.boards]);
  const result = await h.execute({ action: 'requestPasswordResetEmail', email: 'ONE@example.test' });
  assert.equal(result.message, constants.GENERIC); assert.equal(h.sentMail.length, 1); assert.equal(h.sentMail[0].to, 'one@example.test');
  assert.match(h.sentMail[0].html, /Professor &lt;Um&gt;/); assert.match(h.sentMail[0].text, /https:\/\/example.test\/app\/account-action.html\?mode=resetPassword/);
  assert.equal(JSON.stringify([h.data.grades, h.data.boards]), academic); assert.ok(h.writes.every(path => path.startsWith('accountSecurity/')));
});

test('unknown, disabled and inactive accounts share the same generic reset response without email', async () => {
  const h = harness();
  const unknown = await h.execute({ action: 'requestPasswordResetEmail', email: 'unknown@example.test' });
  h.records.u1.disabled = true;
  const disabled = await h.execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' });
  h.records.u1.disabled = false; h.data.users.u1.active = false;
  const inactive = await h.execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' });
  assert.deepEqual(unknown, disabled); assert.deepEqual(unknown, inactive); assert.equal(h.sentMail.length, 0);
});

test('unconfigured delivery channels fail explicitly and public provider rejection does not enumerate accounts', async () => {
  await expectCode(harness({ emailAvailable: false }).execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' }), 'unavailable-channel');
  await expectCode(requestSms(harness({ smsAvailable: false })), 'unavailable-channel');
  const h = harness({ mailError: true });
  const known = await h.execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' });
  const unknown = await h.execute({ action: 'requestPasswordResetEmail', email: 'nobody@example.test' });
  assert.deepEqual(known, unknown); assert.deepEqual(h.deliveries, ['email-password-reset']);
});

test('email changes require recent reauthentication and only email a verification link without changing identity', async () => {
  const h = harness(), original = clone(h.records.u1);
  await expectCode(h.execute({ action: 'requestEmailChange', newEmail: 'new@example.test' }), 'unauthenticated');
  await expectCode(h.execute({ action: 'requestEmailChange', newEmail: 'new@example.test' }, { token: 'old' }), 'requires-recent-login');
  const result = await h.execute({ action: 'requestEmailChange', newEmail: 'NEW@example.test', notifySms: true }, context);
  assert.equal(result.smsNoticeSent, true); assert.equal(h.sentMail[0].to, 'new@example.test'); assert.equal(h.generated[0].address, 'one@example.test');
  assert.match(h.sentSms[0].body, /solicitacao/); assert.doesNotMatch(h.sentSms[0].body, /foi confirmada/);
  assert.deepEqual(h.records.u1, original); assert.ok(h.writes.every(path => path.startsWith('accountSecurity/')));
});

test('confirmed email change sends one claimed notification despite concurrent tabs and only after canonical confirmation', async () => {
  const h = harness();
  await h.execute({ action: 'requestEmailChange', newEmail: 'new@example.test', notifySms: true }, context);
  await h.execute({ action: 'getAccount' }, context); assert.equal(h.sentMail.length, 1);
  h.records.u1.email = 'new@example.test'; h.records.u1.emailVerified = false;
  await h.execute({ action: 'notifyEmailChange' }, context); assert.equal(h.sentMail.length, 1);
  h.records.u1.emailVerified = true;
  await Promise.all([h.execute({ action: 'getAccount' }, context), h.execute({ action: 'notifyEmailChange' }, context), h.execute({ action: 'notifyEmailChange' }, context)]);
  assert.equal(h.sentMail.length, 2); assert.equal(h.sentMail[1].to, 'one@example.test'); assert.match(h.sentMail[1].text, /foi confirmada/);
  assert.equal(h.sentSms.length, 2); assert.match(h.sentSms[1].body, /foi confirmada/);
});

test('only a recent authenticated owner can enroll and confirm a phone and a verified contact stays private', async () => {
  const h = harness();
  await expectCode(h.execute({ action: 'enrollPhoneStart', phone: '+5511988888888' }), 'unauthenticated');
  await expectCode(h.execute({ action: 'enrollPhoneStart', phone: '+5511988888888' }, { token: 'old' }), 'requires-recent-login');
  await h.execute({ action: 'enrollPhoneStart', phone: '+5511988888888' }, context);
  assert.equal(h.data.accountContacts.u1.phone, '+5512999999999');
  await expectCode(h.execute({ action: 'enrollPhoneConfirm', phone: '+5511988888888', code: '123456' }, { token: 'token2' }), 'invalid-code');
  await expectCode(h.execute({ action: 'enrollPhoneConfirm', phone: '+5511988888887', code: '123456' }, context), 'invalid-code');
  await h.execute({ action: 'enrollPhoneConfirm', phone: '+5511988888888', code: '123456' }, context);
  assert.equal(h.data.accountContacts.u1.phone, '+5511988888888'); assert.equal(h.data.accountContacts.u1.phoneVerified, true);
  await expectCode(h.execute({ action: 'enrollPhoneConfirm', phone: '+5511988888888', code: '123456' }, context), 'invalid-code');
});

test('SMS reset does not expose eligibility and sends only to an exact previously verified contact', async () => {
  const h = harness();
  const unknown = await h.execute({ action: 'requestPasswordResetSms', email: 'unknown@example.test', phone: '+5512999999999' });
  const mismatch = await h.execute({ action: 'requestPasswordResetSms', email: 'one@example.test', phone: '+5511988888888' });
  h.data.accountContacts.u1.phoneVerified = false; const unverified = await requestSms(h);
  assert.deepEqual(unknown, mismatch); assert.deepEqual(unknown, unverified); assert.equal(h.sentSms.length, 0);
  h.data.accountContacts.u1.phoneVerified = true; const valid = await requestSms(h);
  assert.deepEqual(valid, unknown); assert.equal(h.sentSms.length, 1); assert.match(h.sentSms[0].body, /123456/);
  assert.equal(JSON.stringify(h.data.accountSecurity).includes('123456'), false, 'plaintext OTP is not stored');
});

test('OTP is one-use and concurrent valid confirmations issue exactly one Firebase reset code, never process a password', async () => {
  const h = harness(); await requestSms(h);
  const results = await Promise.allSettled([confirmSms(h), confirmSms(h)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const success = results.find(result => result.status === 'fulfilled').value; assert.equal(success.oobCode, 'SERVER_CODE');
  assert.equal(h.generated.length, 1); assert.equal(h.records.u1.password, undefined);
  await expectCode(confirmSms(h), 'invalid-code');
});

test('five wrong attempts lock a challenge, expiry and resend cooldown are enforced and new codes invalidate old ones', async () => {
  const h = harness(); await requestSms(h); await requestSms(h); assert.equal(h.sentSms.length, 1);
  h.advance(61000); await requestSms(h); assert.equal(h.sentSms.length, 2);
  await expectCode(confirmSms(h, '123456'), 'invalid-code');
  for (let i = 0; i < 4; i++) await expectCode(confirmSms(h, '000000'), 'invalid-code');
  await expectCode(confirmSms(h, '123457'), 'invalid-code');
  const expired = harness(); await requestSms(expired); expired.advance(constants.TTL + 1); await expectCode(confirmSms(expired), 'invalid-code');
});

test('concurrent resend requests reserve a single challenge before any SMS delivery', async () => {
  const h = harness(); await Promise.all([requestSms(h), requestSms(h), requestSms(h)]); assert.equal(h.sentSms.length, 1);
});

test('a rejected SMS cannot create a usable challenge or pretend to enroll a phone', async () => {
  const h = harness({ smsError: true });
  await expectCode(h.execute({ action: 'enrollPhoneStart', phone: '+5511988888888' }, context), 'delivery-failed');
  await expectCode(h.execute({ action: 'enrollPhoneConfirm', phone: '+5511988888888', code: '123456' }, context), 'invalid-code');
  assert.equal(h.data.accountContacts.u1.phone, '+5512999999999');
  const known = await requestSms(h), unknown = await h.execute({ action: 'requestPasswordResetSms', email: 'unknown@example.test', phone: '+5512999999999' });
  assert.deepEqual(known, unknown); await expectCode(confirmSms(h, '123457'), 'invalid-code');
});

test('a disabled account cannot consume recovery or change contacts and stale verified phones cannot reset accounts', async () => {
  const h = harness(); await requestSms(h); h.data.users.u1.active = false;
  await expectCode(confirmSms(h), 'invalid-code'); await expectCode(h.execute({ action: 'getAccount' }, context), 'permission-denied');
  h.data.users.u1.active = true; h.data.accountContacts.u1.phone = '+5511988888888'; await expectCode(confirmSms(h), 'invalid-code');
});

test('email and IP limits are transactional and do not leak raw addresses into counter keys', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) await h.execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' });
  await expectCode(h.execute({ action: 'requestPasswordResetEmail', email: 'one@example.test' }), 'too-many-requests');
  assert.ok(Object.keys(h.data.accountSecurity.rateLimits).every(key => /^[a-f0-9]{64}$/.test(key)));
  assert.doesNotMatch(JSON.stringify(h.data.accountSecurity.rateLimits), /example\.test|192\.0\.2/);
});

test('SMTP adapter keeps credentials in server transport and enforces TLS and bounded timeouts', async () => {
  const calls = [], options = [];
  const gateway = createMailGateway({ smtp: { host: 'smtp.example.test', port: 587, secure: false, user: 'fixture', pass: 'fixture-secret', from: 'BancaFlow <sender@example.test>' } }, { createTransport: value => { options.push(value); return { sendMail: async value => calls.push(value) }; } });
  await gateway.send({ to: 'one@example.test', subject: 'Test', text: 'Test', html: '<p>Test</p>' });
  assert.equal(options[0].requireTLS, true); assert.equal(options[0].tls.rejectUnauthorized, true); assert.equal(options[0].disableFileAccess, true);
  assert.equal(calls[0].auth, undefined); assert.equal(calls[0].to, 'one@example.test');
  assert.equal(createMailGateway({}, {}).available, false);
});

test('Twilio adapter uses official HTTPS endpoint, form payload, private Basic auth and rejects failed delivery', async () => {
  const requests = [], config = { twilio: { accountSid: 'AC' + '1'.repeat(32), authToken: 'fixture-secret', from: '+15005550006' } };
  const gateway = createSmsGateway(config, async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ sid: 'SM-fixture', status: 'queued' }) }; });
  assert.equal(gateway.available, true); await gateway.send({ to: '+5512999999999', body: 'BancaFlow test' });
  assert.match(requests[0].url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC/);
  const form = new URLSearchParams(requests[0].options.body); assert.equal(form.get('To'), '+5512999999999'); assert.equal(form.get('Body'), 'BancaFlow test'); assert.match(requests[0].options.headers.Authorization, /^Basic /);
  await assert.rejects(createSmsGateway(config, async () => ({ ok: false })).send({ to: '+5512999999999', body: 'Test' }));
  assert.equal(createSmsGateway({}).available, false);
});

test('service refuses weak OTP configuration and unrecognized actions without altering any academics', async () => {
  assert.throws(() => createAccountService({ config: { otpPepper: 'short' } }));
  const h = harness(); await expectCode(h.execute({ action: 'updateUser', role: 'coordinator' }, context), 'invalid-action');
  assert.deepEqual(h.data.grades.b1.u1.s1, { presentation: 0 });
});

function httpHarness(options = {}) {
  const calls = [], errors = [];
  const handler = createAccountHttpHandler({ getConfiguration: () => ({ allowedOrigins: ['https://example.test'] }), getService: () => ({ execute: async (body, context) => { calls.push({ body, context }); if (options.error) throw options.error; return { ok: true }; } }), isEmulator: () => options.emulator === true, onError: () => errors.push('failure') });
  async function request(values = {}) {
    const input = { method: 'POST', origin: 'https://example.test', contentType: 'application/json', body: { action: 'getCapabilities' }, authorization: 'Bearer fixture-id-token', ...values };
    const req = { method: input.method, ip: '192.0.2.10', body: input.body, rawBody: input.rawBody || Buffer.from(JSON.stringify(input.body)), is: value => value === input.contentType, get: name => name === 'Origin' ? input.origin : name === 'Authorization' ? input.authorization : undefined };
    const response = { statusCode: 0, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await handler(req, response); return response;
  }
  return { request, calls, errors };
}

test('HTTP boundary allows only exact origins and exposes local origins solely in the emulator', async () => {
  const h = httpHarness();
  for (const origin of [undefined, 'https://example.test.evil.test', 'https://evil.test', 'http://localhost:8080']) {
    const res = await h.request({ origin }); assert.equal(res.statusCode, 403); assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal(h.calls.length, 0);
  const local = await httpHarness({ emulator: true }).request({ origin: 'http://localhost:8080' }); assert.equal(local.statusCode, 200);
  const fakeLocal = await httpHarness({ emulator: true }).request({ origin: 'http://localhost.evil.test:8080' }); assert.equal(fakeLocal.statusCode, 403);
});

test('HTTP boundary handles preflight without effects and rejects wrong methods, media and oversized bodies', async () => {
  const h = httpHarness();
  assert.equal((await h.request({ method: 'OPTIONS' })).statusCode, 204);
  assert.equal((await h.request({ method: 'GET' })).statusCode, 405);
  assert.equal((await h.request({ contentType: 'text/plain' })).statusCode, 415);
  assert.equal((await h.request({ rawBody: Buffer.alloc(16385) })).statusCode, 413);
  assert.equal((await h.request({ body: { action: 'getCapabilities', large: 'a'.repeat(16385) }, rawBody: Buffer.alloc(0) })).statusCode, 413);
  assert.equal(h.calls.length, 0);
});

test('HTTP boundary preserves authenticated context without logging it and redacts unexpected provider errors', async () => {
  const h = httpHarness(), response = await h.request();
  assert.equal(response.statusCode, 200); assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://example.test'); assert.match(response.headers['Cache-Control'], /no-store/);
  assert.deepEqual(h.calls[0].context, { token: 'fixture-id-token', ip: '192.0.2.10' });
  const failure = httpHarness({ error: Error('provider leaked address@example.test and TOKEN') }), rejected = await failure.request();
  assert.equal(rejected.statusCode, 500); assert.equal(rejected.body.error.code, 'service-unavailable'); assert.doesNotMatch(JSON.stringify(rejected), /address@example|TOKEN/); assert.deepEqual(failure.errors, ['failure']);
});
