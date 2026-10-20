'use strict';

function createMailGateway(config, nodemailer) {
  const smtp = config?.smtp;
  const available = !!(smtp?.host && smtp?.user && smtp?.pass && smtp?.from);
  let transport;
  return {
    available,
    async send(message) {
      if (!available) throw Error('SMTP is not configured.');
      transport ||= nodemailer.createTransport({
        host: smtp.host, port: Number(smtp.port) || 465, secure: smtp.secure !== false,
        auth: { user: smtp.user, pass: smtp.pass }, requireTLS: smtp.secure === false,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        tls: { rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true
      });
      await transport.sendMail({ from: smtp.from, to: message.to, subject: message.subject, text: message.text, html: message.html, headers: { 'X-Auto-Response-Suppress': 'All' } });
    }
  };
}

function createSmsGateway(config, request = fetch) {
  const twilio = config?.twilio;
  const available = !!(/^AC[a-f0-9]{32}$/i.test(twilio?.accountSid || '') && twilio?.authToken && (twilio?.from || twilio?.messagingServiceSid));
  return {
    available,
    async send({ to, body }) {
      if (!available) throw Error('SMS is not configured.');
      const form = new URLSearchParams({ To: to, Body: body });
      if (twilio.messagingServiceSid) form.set('MessagingServiceSid', twilio.messagingServiceSid);
      else form.set('From', twilio.from);
      const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`, {
        method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(twilio.accountSid + ':' + twilio.authToken).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(), signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) { await response.body?.cancel?.(); throw Error('SMS provider rejected delivery.'); }
      const result = await response.json();
      if (!result?.sid || ['failed', 'undelivered', 'canceled'].includes(result.status)) throw Error('SMS provider did not accept delivery.');
      return { id: result.sid };
    }
  };
}

module.exports = { createMailGateway, createSmsGateway };
