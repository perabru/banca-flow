/* Avisos locais do chat. A página precisa continuar executando; isto não substitui Web Push. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BancaChatAlerts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFIX = 'bancaflow:chat-alerts:v1:';
  const RECENT_MS = 120000, FUTURE_MS = 60000, CLAIM_LIMIT = 256;
  const line = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const permissionValue = value => ['default', 'granted', 'denied'].includes(value) ? value : 'unsupported';

  function createNotifier(options = {}) {
    const env = options.environment || globalThis;
    const nav = env.navigator || {}, doc = env.document || {};
    const rooms = new Map();
    let uid = '', revision = 0, disposed = false;
    let preferences = { enabled: false, muted: false }, status = '';
    let registrationPromise = null, audio = null, gestureUnlocked = false;
    let lastSignalAt = -Infinity;
    const oscillators = new Set();
    const now = () => typeof options.now === 'function' ? options.now() : (env.Date || Date).now();
    const instanceId = (() => { try { if (typeof env.crypto?.randomUUID === 'function') return env.crypto.randomUUID(); } catch {} return now().toString(36) + '-' + Math.random().toString(36).slice(2); })();
    const sessionToken = version => instanceId + ':' + version;
    const prefKey = account => PREFIX + 'prefs:' + encodeURIComponent(account);
    const claimKey = account => PREFIX + 'delivered:' + encodeURIComponent(account);
    const current = (account, version) => !disposed && uid === account && revision === version && !!account;
    const call = (fn, ...args) => { try { return typeof fn === 'function' ? fn(...args) : undefined; } catch { return undefined; } };
    const storageGet = key => { try { return env.localStorage?.getItem(key) || null; } catch { return null; } };
    const storageSet = (key, value) => { try { if (!env.localStorage?.setItem) return false; env.localStorage.setItem(key, value); return true; } catch { return false; } };
    const parse = value => { try { const data = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } };
    const loadPreferences = value => { const data = parse(value); return { enabled: data.enabled === true, muted: data.muted === true }; };
    function supported() {
      try {
        return env.isSecureContext !== false && !!env.Notification && typeof env.Notification.requestPermission === 'function' && typeof nav.serviceWorker?.register === 'function' && (!env.ServiceWorkerRegistration || typeof env.ServiceWorkerRegistration.prototype?.showNotification === 'function');
      } catch { return false; }
    }
    function browserPermission() { try { return supported() ? permissionValue(env.Notification.permission) : 'unsupported'; } catch { return 'unsupported'; } }
    let observedPermission = browserPermission(), permission = observedPermission;
    function getPermission() {
      const observed = browserPermission();
      if (observed !== observedPermission) { observedPermission = observed; permission = observed; }
      return permission;
    }
    function getState() {
      const countByRoom = Object.fromEntries([...rooms].filter(([, room]) => room.unread.size).map(([id, room]) => [id, room.unread.size]));
      const currentPermission = getPermission();
      return {
        muted: preferences.muted, enabled: !!uid && preferences.enabled && currentPermission === 'granted',
        permission: currentPermission, status, unread: Object.values(countByRoom).reduce((sum, count) => sum + count, 0), countByRoom
      };
    }
    const emit = () => { if (!disposed) call(options.onChange, getState()); };
    const allowed = room => !!room && (typeof options.canAccess !== 'function' || call(options.canAccess, room) === true);
    const hidden = () => doc.hidden === true || doc.visibilityState === 'hidden';
    const visible = room => !hidden() && call(options.isRoomVisible, room) === true;
    const savePreferences = () => { if (uid) storageSet(prefKey(uid), JSON.stringify(preferences)); };
    function defaultStatus() {
      if (!uid) return 'Entre para receber avisos de mensagens.';
      if (preferences.muted) return 'Avisos silenciados neste dispositivo.';
      if (getPermission() === 'denied') return 'Notificações bloqueadas. Libere a permissão nas configurações do navegador ou do aparelho.';
      if (getPermission() === 'unsupported') return 'Este navegador não oferece notificações do sistema. Os avisos na página continuam disponíveis.';
      return 'Os avisos funcionam enquanto o BancaFlow estiver aberto. O celular pode pausar o app em segundo plano.';
    }
    function prepareServiceWorker() {
      if (registrationPromise) return registrationPromise;
      if (!supported() || disposed || !uid) return Promise.resolve(null);
      const account = uid, version = revision;
      try {
        const registration = nav.serviceWorker.register(options.serviceWorkerUrl || './chat-sw.js');
        const pending = Promise.resolve(registration).then(async worker => {
          if (!worker?.active && nav.serviceWorker.ready) worker = await nav.serviceWorker.ready;
          return worker && typeof worker.showNotification === 'function' ? worker : null;
        }).catch(() => null);
        registrationPromise = pending;
        void pending.then(worker => {
          if (!worker && registrationPromise === pending) registrationPromise = null;
          if (!worker && current(account, version)) {
            status = 'Não foi possível preparar as notificações. Os avisos na página continuam disponíveis.';
            emit();
          }
        });
        return pending;
      } catch {
        status = 'Não foi possível preparar as notificações. Os avisos na página continuam disponíveis.';
        return Promise.resolve(null);
      }
    }
    function closeNotifications(account, room, sessionId, messageId) {
      if (!account || !registrationPromise) return;
      void registrationPromise.then(async worker => {
        if (typeof worker?.getNotifications !== 'function') return;
        const notifications = await worker.getNotifications();
        for (const item of notifications || []) if (item.data?.accountId === account && (room === undefined || item.data?.room === room) && (sessionId === undefined || item.data?.sessionId === sessionId) && (messageId === undefined || item.data?.messageId === messageId)) call(() => item.close());
      }).catch(() => {});
    }
    function stopSignals() {
      for (const oscillator of oscillators) { try { oscillator.stop(); oscillator.disconnect?.(); } catch {} }
      oscillators.clear();
      if (audio) { try { const closing = audio.close?.(); closing?.catch?.(() => {}); } catch {} audio = null; }
      gestureUnlocked = false; lastSignalAt = -Infinity;
    }
    function unlockSignals() {
      gestureUnlocked = true;
      try {
        const Audio = env.AudioContext || env.webkitAudioContext;
        if (!audio && typeof Audio === 'function') audio = new Audio();
        const resumed = audio?.resume?.(); resumed?.catch?.(() => {});
      } catch { audio = null; }
    }
    function signal() {
      if (!gestureUnlocked || preferences.muted || hidden() || now() - lastSignalAt < 800) return;
      lastSignalAt = now();
      try { nav.vibrate?.(70); } catch {}
      try {
        if (!audio || audio.state !== 'running') return;
        const oscillator = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(740, at);
        gain.gain.setValueAtTime(0.025, at); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.11);
        oscillator.connect(gain); gain.connect(audio.destination); oscillators.add(oscillator);
        oscillator.onended = () => { oscillators.delete(oscillator); try { oscillator.disconnect(); gain.disconnect(); } catch {} };
        oscillator.start(at); oscillator.stop(at + 0.13);
      } catch {}
    }
    function notificationUrl(room) {
      try { const url = new (env.URL || URL)(env.location?.href || 'https://bancaflow.invalid/'); url.hash = 'chat=' + encodeURIComponent(room); return url.href; } catch { return '#chat=' + encodeURIComponent(room); }
    }
    function showSystem(payload, account, version, roomState) {
      void prepareServiceWorker().then(async worker => {
        if (!worker || !current(account, version) || rooms.get(payload.room) !== roomState || !roomState.unread.has(payload.id) || !allowed(payload.room) || !hidden() || preferences.muted || !getState().enabled) return;
        try {
          await worker.showNotification(payload.title, {
            body: line(payload.name + ': ' + payload.text, 240), tag: 'bancaflow:' + encodeURIComponent(account) + ':' + encodeURIComponent(payload.room) + ':' + sessionToken(version),
            ...(options.iconUrl ? { icon: options.iconUrl } : {}), ...(options.badgeUrl ? { badge: options.badgeUrl } : {}),
            data: { accountId: account, room: payload.room, url: notificationUrl(payload.room), sessionId: sessionToken(version), messageId: payload.id }
          });
          if (!current(account, version) || preferences.muted || rooms.get(payload.room) !== roomState || !roomState.unread.has(payload.id) || !allowed(payload.room)) closeNotifications(account, payload.room, sessionToken(version), payload.id);
        } catch {
          if (current(account, version)) { status = 'O navegador não exibiu a notificação. Os avisos na página continuam disponíveis.'; emit(); }
        }
      }).catch(() => {});
    }
    function claimDelivery(account, room, id) {
      const key = claimKey(account), token = JSON.stringify([room, id]), time = now(), stored = parse(storageGet(key));
      if (typeof stored[token] === 'number' && stored[token] >= time - RECENT_MS - FUTURE_MS) return false;
      const entries = Object.entries(stored).filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at >= time - RECENT_MS - FUTURE_MS && at <= time + FUTURE_MS);
      entries.unshift([token, time]); entries.sort((a, b) => b[1] - a[1]);
      storageSet(key, JSON.stringify(Object.fromEntries(entries.slice(0, CLAIM_LIMIT))));
      return true;
    }
    function deliver(payload, account, version, roomState) {
      const notify = () => {
        if (!current(account, version) || rooms.get(payload.room) !== roomState || !roomState.unread.has(payload.id) || !allowed(payload.room) || preferences.muted) return;
        if (visible(payload.room)) { markRead(payload.room); return; }
        if (hidden() && !getState().enabled) return;
        if (!claimDelivery(account, payload.room, payload.id)) return;
        if (hidden()) showSystem(payload, account, version, roomState);
        else { call(options.onBanner, payload); if (current(account, version) && !preferences.muted) signal(); }
      };
      try {
        if (typeof nav.locks?.request === 'function') {
          void Promise.resolve(nav.locks.request(PREFIX + 'delivery-lock:' + encodeURIComponent(account), notify)).catch(() => { if (current(account, version)) notify(); });
        } else notify();
      } catch { notify(); }
    }
    function receive(room, input) {
      if (disposed || !uid || typeof room !== 'string' || !room) return;
      if (!allowed(room)) { forgetRoom(room); return; }
      const rows = input && typeof input === 'object' ? Object.entries(input) : [];
      let roomState = rooms.get(room);
      if (!roomState) {
        roomState = { seen: new Set(rows.map(([id]) => id)), unread: new Set() };
        rooms.set(room, roomState); emit(); return;
      }
      const messages = []; let latest = null, latestAt = -Infinity;
      for (const [id, message] of rows) {
        if (roomState.seen.has(id)) continue;
        roomState.seen.add(id);
        if (!message || typeof message !== 'object' || typeof message.uid !== 'string' || !message.uid || message.uid === uid || typeof message.text !== 'string' || !message.text.trim() || typeof message.at !== 'number' || !Number.isFinite(message.at) || message.at < now() - RECENT_MS || message.at > now() + FUTURE_MS) continue;
        const payload = { room, id, name: line(message.name, 120) || 'Professor', text: message.text.slice(0, 2000), title: room === 'geral' ? 'Nova mensagem na sala dos professores' : 'Nova mensagem na conversa da banca' };
        messages.push(payload);
        if (message.at > latestAt || (message.at === latestAt && (!latest || id > latest.id))) { latestAt = message.at; latest = payload; }
      }
      if (visible(room)) { markRead(room); return; }
      for (const payload of messages) roomState.unread.add(payload.id);
      if (messages.length) emit();
      const account = uid, version = revision;
      // Uma atualização pode trazer várias mensagens após uma breve desconexão.
      if (latest) deliver(latest, account, version, roomState);
    }
    function markRead(room) {
      const roomState = rooms.get(room); if (!roomState || !uid || disposed) return getState();
      const changed = roomState.unread.size > 0; roomState.unread.clear(); closeNotifications(uid, room);
      if (changed) emit(); return getState();
    }
    function forgetRoom(room) {
      if (disposed) return getState();
      const changed = rooms.delete(room); closeNotifications(uid, room); if (changed) emit(); return getState();
    }
    function setSession(account) {
      if (disposed) return getState();
      account = typeof account === 'string' ? account : '';
      if (account === uid) return getState();
      const previous = uid, previousSession = sessionToken(revision); ++revision; uid = account; rooms.clear(); stopSignals(); closeNotifications(previous, undefined, previousSession);
      preferences = uid ? loadPreferences(storageGet(prefKey(uid))) : { enabled: false, muted: false };
      status = defaultStatus(); emit(); if (uid) void prepareServiceWorker(); return getState();
    }
    function toggleMute() {
      if (!uid || disposed) return getState();
      preferences.muted = !preferences.muted;
      if (preferences.muted) { for (const oscillator of oscillators) { try { oscillator.stop(); } catch {} } closeNotifications(uid); }
      else unlockSignals();
      savePreferences(); status = defaultStatus(); emit(); return getState();
    }
    function requestPermission() {
      if (!uid || disposed) return Promise.resolve(getState());
      const account = uid, version = revision;
      unlockSignals();
      let result;
      try {
        const before = getPermission();
        // Deve ocorrer no próprio gesto do usuário, antes de qualquer await/registro assíncrono.
        result = before === 'default' ? env.Notification.requestPermission() : before;
      } catch (error) { result = Promise.reject(error); }
      return Promise.resolve(result).then(value => {
        if (!current(account, version)) return getState();
        permission = permissionValue(value); preferences.enabled = permission === 'granted';
        savePreferences(); status = defaultStatus(); emit(); if (preferences.enabled) void prepareServiceWorker(); return getState();
      }, () => {
        if (current(account, version)) { preferences.enabled = false; status = 'Não foi possível ativar as notificações. Os avisos na página continuam disponíveis.'; savePreferences(); emit(); }
        return getState();
      });
    }
    function storageChanged(event) {
      if (disposed || !uid || (event?.key !== prefKey(uid) && event?.key !== null)) return;
      preferences = loadPreferences(event.key === null ? storageGet(prefKey(uid)) : event.newValue);
      if (preferences.muted) { for (const oscillator of oscillators) { try { oscillator.stop(); } catch {} } closeNotifications(uid); }
      status = defaultStatus(); emit();
    }
    function visibilityChanged() {
      if (disposed || !uid) return;
      if (!hidden()) for (const [room, roomState] of rooms) if (roomState.unread.size && visible(room)) markRead(room);
      emit();
    }
    function unlockFromGesture(event) {
      if (disposed || !uid || preferences.muted || gestureUnlocked || event?.isTrusted === false) return;
      unlockSignals();
    }
    env.addEventListener?.('storage', storageChanged); env.addEventListener?.('focus', visibilityChanged);
    doc.addEventListener?.('visibilitychange', visibilityChanged);
    doc.addEventListener?.('pointerdown', unlockFromGesture, { passive: true }); doc.addEventListener?.('keydown', unlockFromGesture);
    function dispose() {
      if (disposed) return;
      const account = uid, sessionId = sessionToken(revision); ++revision; disposed = true; uid = ''; rooms.clear(); preferences = { enabled: false, muted: false }; status = '';
      closeNotifications(account, undefined, sessionId); stopSignals();
      env.removeEventListener?.('storage', storageChanged); env.removeEventListener?.('focus', visibilityChanged); doc.removeEventListener?.('visibilitychange', visibilityChanged);
      doc.removeEventListener?.('pointerdown', unlockFromGesture); doc.removeEventListener?.('keydown', unlockFromGesture);
    }
    return { setSession, getState, receive, markRead, forgetRoom, toggleMute, requestPermission, dispose };
  }
  return Object.freeze({ createNotifier });
});
