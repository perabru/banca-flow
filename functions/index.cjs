'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { createAccountService } = require('./account-service.cjs');
const { createMailGateway, createSmsGateway } = require('./gateways.cjs');
const { createAccountHttpHandler } = require('./http-handler.cjs');
const nodemailer = require('nodemailer');

initializeApp();
const accountConfig = defineSecret('BANCAFLOW_ACCOUNT_CONFIG');
let instance;
function configuration() {
  const config = JSON.parse(accountConfig.value());
  // The public site cannot supply origins, action URLs or delivery credentials.
  const origins = config.allowedOrigins || ['https://perabru.github.io'];
  if (!Array.isArray(origins) || !origins.length || origins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || url.protocol !== 'https:' || url.username || url.password; } catch { return true; }
  })) throw Error('Use explicit HTTPS origins in allowedOrigins.');
  return { ...config, allowedOrigins: origins };
}
function service(config) {
  if (instance) return instance;
  const database = getDatabase();
  const db = {
    get: async path => (await database.ref(path).get()).val(),
    set: (path, value) => database.ref(path).set(value),
    transaction: async (path, updater) => {
      const result = await database.ref(path).transaction(updater, undefined, false);
      return { committed: result.committed, value: result.snapshot.val() };
    }
  };
  instance = createAccountService({
    auth: getAuth(), db, config, emulator: process.env.FUNCTIONS_EMULATOR === 'true',
    mail: createMailGateway(config, nodemailer), sms: createSmsGateway(config),
    onDeliveryFailure: kind => logger.warn('Account recovery delivery rejected', { kind })
  });
  return instance;
}

exports.accountService = onRequest({ region: 'southamerica-east1', secrets: [accountConfig], timeoutSeconds: 45, memory: '256MiB', maxInstances: 5, cors: false }, createAccountHttpHandler({
  getConfiguration: configuration, getService: service, isEmulator: () => process.env.FUNCTIONS_EMULATOR === 'true',
  // Never log user input, phone/email, passwords, OTPs, Firebase links or tokens.
  onError: () => logger.error('Account service operation failed', { code: 'account-operation-failed' })
}));

// Expired abuse counters and used/expired challenges have no academic value.
// Delete in bounded batches; never read or alter banks, users or grades here.
exports.cleanupAccountSecurity = onSchedule({ schedule: 'every day 03:00', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 1 }, async () => {
  const database = getDatabase(), cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const prefix of ['rateLimits', 'challenges/enroll', 'challenges/reset', 'emailChanges']) {
    const location = database.ref(`accountSecurity/${prefix}`);
    for (let batch = 0; batch < 10; batch++) {
      const snapshot = await location.orderByChild('expiresAt').endAt(cutoff).limitToFirst(500).get();
      if (!snapshot.exists()) break;
      const updates = {};
      snapshot.forEach(child => { if (typeof child.val()?.expiresAt === 'number' && child.val().expiresAt <= cutoff) updates[child.key] = null; });
      if (!Object.keys(updates).length) break;
      await Promise.all(Object.keys(updates).map(key => location.child(key).transaction(current => typeof current?.expiresAt === 'number' && current.expiresAt <= cutoff ? null : undefined, undefined, false)));
      if (snapshot.numChildren() < 500) break;
    }
  }
});
