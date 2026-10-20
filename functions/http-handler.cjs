'use strict';
const { AccountError } = require('./account-service.cjs');

function createAccountHttpHandler(options) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Vary', 'Origin');
    try {
      const config = options.getConfiguration(), origin = req.get('Origin');
      const local = options.isEmulator?.() === true && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
      if (!origin || (!config.allowedOrigins.includes(origin) && !local)) {
        res.status(403).json({ ok: false, error: { code: 'origin-not-allowed', message: 'Abra esta operação pelo site oficial do BancaFlow.' } }); return;
      }
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
      if (req.method !== 'POST') { res.set('Allow', 'POST, OPTIONS'); res.status(405).json({ ok: false, error: { code: 'method-not-allowed', message: 'Use o formulário de conta do BancaFlow.' } }); return; }
      if (!req.is('application/json')) { res.status(415).json({ ok: false, error: { code: 'invalid-content-type', message: 'Formato de solicitação inválido.' } }); return; }
      if ((req.rawBody?.length || 0) > 16384 || Buffer.byteLength(JSON.stringify(req.body || {})) > 16384) { res.status(413).json({ ok: false, error: { code: 'request-too-large', message: 'A solicitação excedeu o tamanho permitido.' } }); return; }
      const authorization = req.get('Authorization') || '';
      const token = /^Bearer ([^\s]+)$/.exec(authorization)?.[1];
      const result = await options.getService(config).execute(req.body, { token, ip: req.ip || req.socket?.remoteAddress || 'unknown' });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AccountError) { res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message } }); return; }
      options.onError?.();
      res.status(500).json({ ok: false, error: { code: 'service-unavailable', message: 'Não foi possível concluir a operação. Tente novamente mais tarde.' } });
    }
  };
}

module.exports = { createAccountHttpHandler };
