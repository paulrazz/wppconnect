const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');
const webhooks = require('./webhook.service');
const eventStore = require('./event-store.service');
const automation = require('./automation.service');

// One isolated Chromium instance per API key, capped so total RAM stays
// bounded on Railway. Each running Chrome is roughly 200-400MB.
const MAX_CONCURRENT_SESSIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_SESSIONS || 2));

function looksLikeBinaryPayload(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^data:[^;,]+;base64,/i.test(text)) return true;
  if (text.length < 256) return false;
  if (/^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|AAAA(?:F|G|I|J|M|N|O)|SUQz)/.test(text)) return true;
  const sample = text.slice(0, 1024).replace(/\s/g, '');
  return sample.length > 240 && /^[A-Za-z0-9+/=]+$/.test(sample);
}

function safeMessageText(message) {
  return [message?.caption, message?.text, message?.body, message?.content]
    .find(value => typeof value === 'string' && value.trim() && !looksLikeBinaryPayload(value))?.trim() || '';
}

function compactPreview(value, limit = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function messagePreview(message) {
  if (!message) return 'No recent message';
  const type = String(message.type || 'chat').toLowerCase();
  const text = safeMessageText(message);
  const media = {
    image: '📷 Photo', video: '🎥 Video', gif: '🎞️ GIF', audio: '🎵 Audio', ptt: '🎙️ Voice note',
    sticker: '🏷️ Sticker', document: `📄 ${message.filename || message.fileName || 'Document'}`,
    location: '📍 Location', live_location: '📍 Live location', vcard: '👤 Contact card',
    contact_card: '👤 Contact card', contacts_array: '👥 Contact cards',
  }[type];
  if (media) return text ? `${media}: ${text}` : media;
  if (type.includes('call')) return `${message.isMissed || type.includes('missed') ? 'Missed' : 'WhatsApp'} ${message.isVideoCall || type.includes('video') ? 'video' : 'voice'} call`;
  if (type === 'revoked' || message.isDeleted || message.isRevoked) return '🚫 Message deleted';
  if (type.startsWith('poll')) return `📊 ${message.pollName || message.poll?.name || text || 'Poll'}`;
  if (['buttons_response', 'list_response', 'template_button_reply', 'interactive_response'].includes(type)) return `↩️ ${text || 'Interactive response'}`;
  if (['buttons', 'template_button', 'interactive'].includes(type)) return `🔘 ${text || 'Interactive message'}`;
  if (['list', 'list_message'].includes(type)) return `☷ ${text || 'List message'}`;
  if (type.includes('reaction')) return `${message.reaction || message.emoji || 'Reaction'} to a message`;
  if (['order', 'product', 'catalog'].includes(type)) return `🛍️ ${text || type[0].toUpperCase() + type.slice(1)}`;
  if (type.includes('payment')) return `💳 ${text || 'Payment message'}`;
  if (['protocol', 'notification', 'gp2', 'ciphertext', 'e2e_notification', 'newsletter_notification', 'group_notification', 'broadcast_notification'].includes(type)) return `ℹ️ ${text || 'System update'}`;
  if (text) return text;
  return type === 'chat' ? 'Message' : `[${type.replaceAll('_', ' ')}]`;
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key || '').digest('hex').substring(0, 32);
}

// Per-API-key runtime state. One of these exists for every key anyone has
// ever touched (started/stopped/queried), but only `client` or `startPromise`
// being set means a Chromium profile is actually held in RAM.
class Session {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.sessionName = hashKey(apiKey);
    this.sessionPath = path.resolve(__dirname, '..', 'data', 'sessions', this.sessionName);
    this.client = null;
    this.sessionStatus = 'DISCONNECTED';
    this.lastError = null;
    this.connectedAt = null;
    this.lastQrCode = null;
    this.statusCache = {};
    this.chatPreviewCache = new Map();
    this.contactsCache = null;
    this.passiveMode = true;
    this.deviceInfo = { battery: null, platform: null, network: null, apiStatus: 'Active', profileName: null, profilePic: null, updatedAt: null };
    this.metricsTimer = null;
    this.generation = 0;
    this.startPromise = null;
  }
}

class WhatsAppService {
  constructor() {
    this.sessions = new Map();
    this.io = null;
  }

  setIo(io) { this.io = io; }

  getSession(apiKey) {
    if (!apiKey) return null;
    let session = this.sessions.get(apiKey);
    if (!session) {
      session = new Session(apiKey);
      this.sessions.set(apiKey, session);
    }
    return session;
  }

  knownSessions() { return [...this.sessions.values()]; }

  activeSessions() {
    return this.knownSessions().filter(session => session.client || session.startPromise);
  }

  isActiveFor(apiKey) {
    const session = this.sessions.get(apiKey);
    return Boolean(session && (session.client || session.startPromise));
  }

  getStatus(apiKey) {
    const session = this.getSession(apiKey);
    return { status: session.sessionStatus, ready: session.sessionStatus === 'CONNECTED' && Boolean(session.client), session: session.sessionName, connectedAt: session.connectedAt, lastError: session.lastError, passiveMode: session.passiveMode, readReceipts: 'disabled', info: session.deviceInfo };
  }

  getQr(apiKey) {
    return this.getSession(apiKey).lastQrCode || null;
  }

  overview() {
    const running = this.activeSessions();
    const connected = running.filter(session => session.sessionStatus === 'CONNECTED');
    return { status: connected.length ? 'CONNECTED' : running.length ? 'STARTING' : 'DISCONNECTED', passiveMode: running.every(session => session.passiveMode), readReceipts: 'disabled', sessionsKnown: this.sessions.size, activeSessions: running.length, connectedSessions: connected.length, maxConcurrentSessions: MAX_CONCURRENT_SESSIONS };
  }

  setStatus(session, status, error = null) {
    session.sessionStatus = status;
    session.lastError = error ? (error.message || String(error)) : null;
    if (status !== 'QR_READY') session.lastQrCode = null;
    if (status === 'CONNECTED') session.connectedAt = new Date().toISOString();
    if (status === 'CONNECTED') void this.refreshDeviceInfo(session);

    if (session.apiKey) {
      const room = `session_${session.apiKey}`;
      this.io?.to(room).emit('session_status', status);
      this.io?.to(room).emit('session_details', this.getStatus(session.apiKey));
    }
    void webhooks.emit('session.status', this.getStatus(session.apiKey));
  }

  async refreshDeviceInfo(session) {
    if (!session.client || session.sessionStatus !== 'CONNECTED') {
      session.deviceInfo.network = 'Offline';
      return;
    }
    try {
      const batteryRaw = await session.client.getBatteryLevel().catch(() => null);
      const battery = typeof batteryRaw === 'number' ? Math.round(batteryRaw) : (batteryRaw && typeof batteryRaw === 'object' && batteryRaw.battery != null ? Math.round(Number(batteryRaw.battery)) : null);

      const platformRaw = await session.client.page.evaluate(() => {
        try { return window.WPP?.conn?.getPlatform?.() || null; } catch (_) { return null; }
      }).catch(() => null);
      const platform = platformRaw === 'iphone' ? 'iOS' : platformRaw === 'android' ? 'Android' : platformRaw === 'wp' ? 'Windows Phone' : platformRaw;

      // Read-only "me" data (no socket traffic beyond what WhatsApp Web does on boot).
      let profileName = null;
      let profilePic = null;
      try {
        profileName = (await session.client.getProfileName().catch(() => null)) || null;
      } catch (_) {}
      try {
        const me = await session.client.page.evaluate(() => {
          try {
            const wid = window.WPP?.whatsapp?.UserPrefs?.getMaybeMeUser?.();
            return wid ? String(wid) : null;
          } catch (_) { return null; }
        }).catch(() => null);
        if (me) {
          profilePic = await session.client.page.evaluate((meId) => {
            try { return window.WPP?.contact?.getProfilePictureUrl?.(meId, false) || null; } catch (_) { return null; }
          }, me).catch(() => null);
        }
      } catch (_) {}

      const socketState = await session.client.getConnectionState().catch(() => null);
      const network = socketState === 'CONNECTED' ? 'Stable' : socketState === 'SYNCING' ? 'Syncing' : socketState === 'TIMEOUT' ? 'Reconnecting' : socketState || null;

      session.deviceInfo = { battery, platform, network, apiStatus: 'Active', profileName, profilePic, updatedAt: new Date().toISOString() };
    } catch (_) {
      session.deviceInfo = { ...session.deviceInfo, updatedAt: new Date().toISOString() };
    }
  }

  async ensureSessionActive(apiKey) {
    if (!apiKey) throw new Error('API Key is required to start a session');

    // If THIS key's session is already active (or starting), return it. No
    // cross-key swap: another person's connected profile is never evicted.
    const session = this.getSession(apiKey);
    if (session.client || session.startPromise) {
      if (session.sessionStatus === 'QR_READY' || session.sessionStatus === 'STARTING') return;
      return session.startPromise || session.client;
    }

    // One Chromium per key up to a hard cap, so one user can start many
    // sessions without OOMing the box.
    if (this.activeSessions().length >= MAX_CONCURRENT_SESSIONS) {
      const error = new Error(`Session limit reached (${MAX_CONCURRENT_SESSIONS} active). Stop another session before starting this one.`);
      error.statusCode = 429;
      session.sessionStatus = 'ERROR';
      session.lastError = error.message;
      this.io?.to(`session_${apiKey}`).emit('session_status', 'ERROR');
      throw error;
    }

    session.generation += 1;
    this.setStatus(session, 'STARTING');
    const generation = session.generation;
    session.startPromise = this.createClient(session);
    try {
      return await session.startPromise;
    } finally {
      session.startPromise = null;
    }
  }

  async startSession(apiKey) {
    if (!apiKey) throw new Error('API Key is required to start a session');
    return this.ensureSessionActive(apiKey);
  }

  cleanChromeLocks(session) {
    // A hard container kill / redeploy leaves a stale Chrome SingletonLock in the
    // persisted profile. On the next boot Chrome thinks the profile is in use by
    // "another computer", refuses to open it (locked profile + 'Can't open display').
    // Remove only the runtime lock files - auth data (LevelDB/Default) is untouched.
    for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const p = path.join(session.sessionPath, file);
      try { fs.rmSync(p, { force: true }); } catch (_) {}
    }
  }

  async createClient(session) {
    const generation = session.generation;
    try {
      this.cleanChromeLocks(session);
      const client = await wppconnect.create({
        session: session.sessionName,
        folderNameToken: path.resolve(__dirname, '..', 'data', 'sessions'),
        catchQR: (base64Qr) => {
          session.lastQrCode = base64Qr;
          this.setStatus(session, 'QR_READY');
          if (session.apiKey) this.io?.to(`session_${session.apiKey}`).emit('qr_code', base64Qr);
        },
        statusFind: (status) => {
          console.log('WhatsApp auth status:', session.sessionName, status);
          if (['isLogged', 'inChat', 'qrReadSuccess'].includes(status)) this.setStatus(session, 'CONNECTED');
          if (['autocloseCalled', 'desconnectedMobile', 'browserClose'].includes(status)) this.setStatus(session, 'ERROR', new Error(`WhatsApp session: ${status}`));
        },
        headless: true,
        useChrome: false,
        autoClose: 0,
        deviceSyncTimeout: 0,
        waitForLogin: false,
        logQR: false,
        disableWelcome: true,
        updatesLog: false,
        deviceName: 'WPPConnect Dev Console',
        puppeteerOptions: {
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath(),
          userDataDir: session.sessionPath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-crash-reporter',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disk-cache-size=10485760',
            '--media-cache-size=10485760',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--safebrowsing-disable-auto-update',
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--disable-component-update',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees',
            '--disable-client-side-phishing-detection',
            '--disable-software-rasterizer',
          ],
        },
      });
      if (generation !== session.generation) {
        await client.close().catch(() => {});
        throw Object.assign(new Error('Session startup was cancelled'), { code: 'SESSION_START_CANCELLED', statusCode: 409 });
      }
      session.client = client;
      // Keep the automation runtime offline and never call sendSeen while browsing.
      // History and media retrieval use data-layer APIs and do not open the native chat UI.
      await client.setOnlinePresence(false).catch((error) => console.warn('Could not force offline presence:', error.message));
      this.setStatus(session, 'CONNECTED');
      this.registerListeners(client, session);
      console.log(`WhatsApp session ready for ${session.apiKey.slice(0, 8)} (${session.sessionPath})`);
      // Restore path: an already-paired profile relaunches the browser with no QR.
      // `waitForLogin:false` skips wppconnect's own login wait, so verify login
      // here (read-only) and surface CONNECTED. A fresh/unpaired profile stays in
      // QR_READY (catchQR already fired) until the user scans.
      try {
        if (session.generation === generation && await client.isLoggedIn()) this.setStatus(session, 'CONNECTED');
      } catch (err) {
        console.warn('Login state check failed, leaving session in current status:', err.message);
      }
      clearInterval(session.metricsTimer);
      session.metricsTimer = setInterval(() => void this.refreshDeviceInfo(session), 30000);
      if (session.metricsTimer.unref) session.metricsTimer.unref();
      return client;
    } catch (error) {
      session.client = null;
      session.chatPreviewCache.clear();
      session.contactsCache = null;
      if (generation === session.generation) this.setStatus(session, 'ERROR', error);
      console.error('Failed to start WhatsApp session:', error);
      throw error;
    }
  }

  registerListeners(client, session) {
    // Listen for every chat message, including our own outgoing ones. The
    // wppconnect `onMessage` listener filters out isSentByMe (listener.layer:
    // `if (msg.isSentByMe || msg.isStatusV3) return;`), which is exactly why
    // messages sent through the API used to never reach the live inbox.
    client.onAnyMessage((message) => {
      // Preserve media while it is still downloadable. WhatsApp can remove
      // the live message immediately when the sender chooses Delete for all.
      if (['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document'].includes(String(message.type || '').toLowerCase())) {
        void client.downloadMedia(message).then(dataUrl => eventStore.cacheMedia(message.id, dataUrl, { mimetype: message.mimetype, filename: message.filename || message.fileName })).catch(() => {});
      }
      if (message.isStatus || message.isStatusV3 || message.from === 'status@broadcast') {
        const senderId = message.author || message.from;
        session.statusCache[senderId] ||= [];
        session.statusCache[senderId].push(message);
        session.statusCache[senderId] = session.statusCache[senderId].slice(-25);
        eventStore.rememberStatus(message);
        this.io?.to(`session_${session.apiKey}`).emit('new_status', message);
        void webhooks.emit('status.received', message);
        return;
      }
      if (message.fromMe || message.isSentByMe) {
        // Outgoing message (sent from the API or any frontend). Stream it in
        // real time so an open Live Inbox mirrors the account. eventStore and
        // webhooks already record `message.sent` inside the send path, so we
        // only surface it on the socket here.
        const chatId = message.chatId?._serialized || message.chatId || message.to;
        if (chatId) session.chatPreviewCache.set(chatId, message);
        this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
        return;
      }
      this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
      eventStore.append('message.received', message);
      const chatId = message.chatId?._serialized || message.chatId || (message.fromMe ? message.to : message.from);
      if (chatId) session.chatPreviewCache.set(chatId, message);
      // Trigger automation rules (may send replies, templates, orders, etc.)
      void automation.handleIncomingMessage(message, session.apiKey, this);
      void webhooks.emit('message.received', message);
    });
    client.onAck((ack) => {
      eventStore.append('message.ack', ack);
      this.io?.to(`session_${session.apiKey}`).emit('message_ack', ack);
      void webhooks.emit('message.ack', ack);
    });
    client.onRevokedMessage(async (data) => {
      if (data.from === 'status@broadcast') {
        const referenceId = data.refId || data.msgId || data.protocolMessageKey || data.id;
        const exact = eventStore.getMessage(referenceId);
        const original = exact || eventStore.getLatestStatus(data.author);
        const removal = eventStore.append('status.deleted', { ...data, referenceId: eventStore.idOf(referenceId), original, recoveryStatus: exact ? 'recovered' : original ? 'probable-sender-match' : 'not-observed', deletedAt: new Date().toISOString() });
        this.io?.to(`session_${session.apiKey}`).emit('status_deleted', removal);
        void webhooks.emit('status.deleted', removal);
        return;
      }
      const referenceId = data.refId || data.msgId || data.protocolMessageKey || data.id;
      let original = eventStore.getMessage(referenceId);
      if (!original && referenceId) {
        try { original = await client.getMessageById(eventStore.idOf(referenceId)); } catch (_) { /* Already removed from WhatsApp's live store. */ }
      }
      if (original && (original.type === 'revoked' || (!original.body && !original.content && !original.caption && !original.filename && !original.mimetype))) original = null;
      const deletion = eventStore.append('message.deleted', { ...data, referenceId: eventStore.idOf(referenceId), original, recoveryStatus: original ? 'recovered' : 'not-observed', deletedAt: new Date().toISOString() });
      this.io?.to(`session_${session.apiKey}`).emit('message_deleted', deletion);
      void webhooks.emit('message.deleted', deletion);
    });
    client.onMessageEdit((data) => {
      const edit = eventStore.append('message.edited', data);
      this.io?.to(`session_${session.apiKey}`).emit('message_edited', edit);
      void webhooks.emit('message.edited', edit);
    });
    client.onReactionMessage((data) => {
      const reaction = eventStore.append('message.reaction', data);
      this.io?.to(`session_${session.apiKey}`).emit('message_reaction', reaction);
      void webhooks.emit('message.reaction', reaction);
    });
    client.onIncomingCall((data) => {
      const call = eventStore.append('call.received', data);
      this.io?.to(`session_${session.apiKey}`).emit('incoming_call', call);
      void webhooks.emit('call.received', call);
    });
    client.onStateChange((state) => {
      console.log('WhatsApp state:', state);
      this.io?.to(`session_${session.apiKey}`).emit('whatsapp_state', state);
      void webhooks.emit('whatsapp.state', { state });
      if (['CONFLICT', 'UNLAUNCHED'].includes(state)) client.useHere().catch((error) => console.warn('WhatsApp takeover skipped:', error.message));
      if (state === 'CONNECTED') this.setStatus(session, 'CONNECTED');
      if (['UNPAIRED', 'UNPAIRED_IDLE', 'DISCONNECTED'].includes(state)) this.setStatus(session, 'DISCONNECTED');
    });
  }

  requireClient(apiKey) {
    const session = this.getSession(apiKey);
    if (!session.client || session.sessionStatus !== 'CONNECTED') {
      const error = new Error('WhatsApp is not connected yet');
      error.statusCode = 503;
      throw error;
    }
    return session.client;
  }

  async stopSession(apiKey) {
    const session = this.getSession(apiKey);
    session.generation += 1;
    clearInterval(session.metricsTimer);
    session.metricsTimer = null;
    const client = session.client;
    session.client = null;
    session.chatPreviewCache.clear();
    session.contactsCache = null;

    if (client) {
      console.log(`[Memory Manager] Forcefully terminating Chromium process for session ${session.sessionName}...`);
      try {
        const browser = await client.page.browser();
        if (browser) browser.process().kill('SIGKILL');
      } catch (err) {}
      await client.close().catch(() => {});

      // Aggressive Disk Optimization for Free Tier Limits (Wipe junk caches)
      try {
        const junkFolders = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'Service Worker/CacheStorage'];
        for (const folder of junkFolders) {
          const target = path.join(session.sessionPath, 'Default', folder);
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        }
      } catch (e) {
        console.error('Disk cleanup failed:', e.message);
      }
    }

    this.setStatus(session, 'DISCONNECTED');
  }

  async logoutSession(apiKey) {
    const session = this.getSession(apiKey);
    session.generation += 1;
    clearInterval(session.metricsTimer);
    session.metricsTimer = null;
    const client = session.client;
    session.client = null;
    session.chatPreviewCache.clear();
    session.contactsCache = null;
    if (client) await client.logout();
    session.connectedAt = null;
    this.setStatus(session, 'DISCONNECTED');
  }

  async resetSession(apiKey) { await this.stopSession(apiKey); return this.startSession(apiKey); }

  async stopAll() {
    await Promise.all(this.knownSessions().map(session => this.stopSession(session.apiKey).catch(error => console.error('Session shutdown failed:', error.message))));
  }

  async resolveDestination(apiKey, to) {
    const client = this.requireClient(apiKey);
    let id = String(to || '').trim();

    // Normalize any local phone format to the full E.164 chat JID. Handles
    // "09034040635", "+2349034040635" AND "09034040635@c.us" (which the API
    // route pre-appends) - a leading '0' means Nigeria national format.
    if (!id.includes('@') || /^\+?\d+@c\.us$/.test(id)) {
      const digitsMatch = id.replace(/@c\.us$/, '').replace(/\D/g, '');
      if (/^\d+$/.test(digitsMatch)) {
        let digits = digitsMatch;
        if (digits.startsWith('0')) digits = '234' + digits.substring(1);
        id = `${digits}@c.us`;
      }
    }

    if (!id.endsWith('@lid')) return id;
    try {
      const mapping = await client.getPnLidEntry(id);
      return mapping?.phoneNumber?._serialized || mapping?.phoneNumber?.toString?.() || id;
    } catch (error) {
      console.warn(`Could not resolve LID destination ${id}:`, error.message);
      return id;
    }
  }

  async sendMessage(apiKey, to, text, options) {
    const session = this.getSession(apiKey);
    const client = this.requireClient(apiKey);
    if (String(to).endsWith('@lid')) {
      // A known LID chat can still lack the PN->LID cache entry used by the
      // normal sender. Target the existing in-page ChatModel/Wid directly.
      const result = await client.page.evaluate(async ({ chatId, content, sendOptions }) => {
        const chat = globalThis.WPP?.whatsapp?.ChatStore?.get(chatId);
        if (!chat) throw new Error(`Existing LID chat was not found: ${chatId}`);
        const sent = await globalThis.WPP.chat.sendTextMessage(chat.id, content, { ...sendOptions, markIsRead: false, waitForAck: true });
        const message = await globalThis.WAPI?.getMessageById?.(sent.id);
        return JSON.parse(JSON.stringify(message || sent));
      }, { chatId: String(to), content: text, sendOptions: options || {} });
      eventStore.append('message.sent', result);
      session.chatPreviewCache.set(to, result);
      return result;
    }
    const resolvedTo = await this.resolveDestination(apiKey, to);
    // WPPConnect defaults markIsRead to true when sending. Besides violating
    // passive mode, that read operation can fail for newer LID-only chats.
    const result = await this.requireClient(apiKey).sendText(resolvedTo, text, { ...options, markIsRead: false });
    eventStore.append('message.sent', result);
    session.chatPreviewCache.set(to, result);
    return result;
  }

  async getChats(apiKey, { offset = 0, limit = 30 } = {}) {
    const session = this.getSession(apiKey);
    const client = this.requireClient(apiKey);
    const allChats = (await client.listChats()).sort((a, b) => (b.t || 0) - (a.t || 0));
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const chats = allChats.slice(safeOffset, safeOffset + safeLimit);
    const livePreviews = await this.getChatPreviews(apiKey, chats.map(chat => chat.id?._serialized || chat.id));
    const enriched = await Promise.all(chats.map(async (chat) => {
      const embeddedMessages = Array.isArray(chat.msgs) ? chat.msgs : (chat.msgs?.models || []);
      const chatId = chat.id?._serialized || chat.id;
      let lastMessage = session.chatPreviewCache.get(chatId) || livePreviews[chatId] || chat.lastMessage || embeddedMessages[embeddedMessages.length - 1] || null;
      // Never fan out into one history query per chat here. On large accounts
      // that turns a cheap list request into hundreds of sequential IndexedDB
      // lookups. Missing previews are hydrated only when a chat is opened.
      const contact = chat.contact || {};
      const displayName = chat.isGroup
        ? (chat.name || chat.groupMetadata?.subject)
        : (contact.name || contact.formattedName || contact.verifiedName || contact.pushname || contact.shortName || chat.name);
      return {
        ...chat,
        displayName: displayName || contact.id?.user || chat.id?.user || 'Unknown contact',
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          body: compactPreview(safeMessageText(lastMessage)),
          previewText: compactPreview(messagePreview(lastMessage)),
          type: lastMessage.type || 'chat',
          timestamp: lastMessage.timestamp || lastMessage.t || chat.t,
          fromMe: Boolean(lastMessage.fromMe),
        } : this.previewFromChatMetadata(chat),
      };
    }));
    return { items: enriched, total: allChats.length, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + enriched.length < allChats.length };
  }

  previewFromChatMetadata(chat) {
    const preview = chat.chatlistPreview;
    if (preview?.type === 'reaction') return { id: preview.msgKey || null, body: '', previewText: `${preview.reactionText || 'Reaction'} to a message`, type: 'reaction', timestamp: Math.floor(Number(preview.timestamp || 0) / 1000) || chat.previewT || chat.t, fromMe: preview.sender === chat.id?._serialized };
    if (preview?.type) return { id: preview.msgKey || null, body: '', previewText: messagePreview(preview), type: preview.type, timestamp: Math.floor(Number(preview.timestamp || 0) / 1000) || chat.previewT || chat.t, fromMe: false };
    return { id: null, body: '', previewText: chat.isReadOnly ? 'Read-only conversation' : chat.t ? 'Recent activity' : 'Conversation ready', type: 'activity', timestamp: chat.previewT || chat.t || 0, fromMe: false };
  }

  async getChatPreviews(apiKey, chatIds) {
    if (!chatIds.length) return {};
    return this.requireClient(apiKey).page.evaluate((ids) => {
      const result = {};
      const chatStore = globalThis.WPP?.whatsapp?.ChatStore;
      const msgStore = globalThis.WPP?.whatsapp?.MsgStore;
      const serialize = message => {
        if (!message) return null;
        try { return globalThis.WAPI?.processMessageObj?.(message, true, false) || message.toJSON?.() || message.attributes || null; }
        catch (_) { return message.toJSON?.() || message.attributes || null; }
      };
      for (const id of ids) {
        const chat = chatStore?.get(id);
        if (!chat) continue;
        const loaded = chat.msgs?.getModelsArray?.() || [];
        const key = chat.lastReceivedKey?._serialized || chat.lastReceivedKey;
        const keyed = key ? msgStore?.get(key) : null;
        const message = chat.previewMessage || loaded[loaded.length - 1] || keyed;
        const serialized = serialize(message);
        if (serialized) result[id] = serialized;
      }
      return JSON.parse(JSON.stringify(result));
    }, chatIds);
  }

  async getContacts(apiKey) {
    const session = this.getSession(apiKey);
    if (session.contactsCache && (Date.now() - session.contactsCache.timestamp < 300000)) {
      return session.contactsCache.data;
    }
    const data = await this.requireClient(apiKey).getAllContacts();
    session.contactsCache = { timestamp: Date.now(), data };
    return data;
  }

  getGroups(apiKey) { return this.requireClient(apiKey).getAllGroups(); }

  async inspectIdentity(apiKey, id) {
    const client = this.requireClient(apiKey);
    const [mapping, contact, chats] = await Promise.all([
      client.getPnLidEntry(id).catch(error => ({ error: error.message })),
      client.getContact(id).catch(error => ({ error: error.message })),
      client.listChats(),
    ]);
    const chat = chats.find(item => (item.id?._serialized || item.id) === id);
    return { requestedId: id, mapping, contact, chat: chat ? { id: chat.id, contact: chat.contact, name: chat.name, isGroup: chat.isGroup } : null };
  }

  async getMessages(apiKey, chatId, count = 30) {
    const client = this.requireClient(apiKey);
    const limit = Math.min(Math.max(Number(count) || 30, 1), 100);
    let messages = await client.getMessages(chatId, { count: limit });
    if (!messages.length) messages = (await this.readChatModel(apiKey, chatId, false)).messages.slice(-limit);
    messages.forEach(message => eventStore.rememberMessage(message));
    return { messages, hasMore: messages.length >= limit, cursor: eventStore.idOf(messages[0]?.id) || null };
  }

  async loadEarlierMessages(apiKey, chatId, before, count = 40) {
    const client = this.requireClient(apiKey);
    const limit = Math.min(Math.max(Number(count) || 40, 1), 100);
    let messages = [];
    if (before) {
      try { messages = await client.getMessages(chatId, { count: limit, id: before, direction: 'before' }); } catch (_) { /* LID chats need the model fallback below. */ }
    }
    let noEarlierMessages = false;
    if (!messages.length) {
      const model = await this.readChatModel(apiKey, chatId, true);
      noEarlierMessages = model.noEarlierMessages;
      const beforeIndex = before ? model.messages.findIndex(message => eventStore.idOf(message.id) === before) : model.messages.length;
      const end = beforeIndex >= 0 ? beforeIndex : model.messages.length;
      messages = model.messages.slice(Math.max(0, end - limit), end);
    }
    messages.forEach(message => eventStore.rememberMessage(message));
    return { messages, hasMore: !noEarlierMessages && messages.length > 0, cursor: eventStore.idOf(messages[0]?.id) || before || null };
  }

  async readChatModel(apiKey, chatId, loadEarlier) {
    const client = this.requireClient(apiKey);
    return client.page.evaluate(async ({ requestedId, loadEarlier }) => {
      const store = globalThis.WPP?.whatsapp?.ChatStore;
      let chat = store?.get(requestedId);
      if (!chat) chat = store?.getModelsArray?.().find(item => item.id?.toString?.() === requestedId || item.id?._serialized === requestedId || item.historyChatId === requestedId);
      if (!chat) throw new Error(`Chat not found for ${requestedId}`);
      if (loadEarlier) await chat.loadEarlierMsgs?.();
      else if (!chat.msgs?.length) await chat.loadRecentMsgs?.();
      const models = chat.msgs?.getModelsArray?.() || [];
      const messages = models.map(message => {
        try { return globalThis.WAPI?.processMessageObj?.(message, true, false) || message.toJSON?.() || message.attributes || {}; }
        catch (_) { return message.toJSON?.() || message.attributes || {}; }
      }).filter(Boolean).sort((a, b) => (a.timestamp || a.t || 0) - (b.timestamp || b.t || 0));
      return { messages: JSON.parse(JSON.stringify(messages)), noEarlierMessages: Boolean(chat.msgs?.msgLoadState?.noEarlierMsgs) };
    }, { requestedId: chatId, loadEarlier });
  }

  async sendFile(apiKey, to, dataUrl, filename, caption = '') { return this.requireClient(apiKey).sendFileFromBase64(await this.resolveDestination(apiKey, to), dataUrl, filename, caption); }
  async sendSticker(apiKey, to, dataUrl) { return this.requireClient(apiKey).sendImageAsSticker(await this.resolveDestination(apiKey, to), dataUrl); }
  async sendLocation(apiKey, to, latitude, longitude, title = '') { return this.requireClient(apiKey).sendLocation(await this.resolveDestination(apiKey, to), String(latitude), String(longitude), title); }
  async sendContact(apiKey, to, contactId, name) { return this.requireClient(apiKey).sendContactVcard(await this.resolveDestination(apiKey, to), await this.resolveDestination(apiKey, contactId), name); }
  async sendList(apiKey, to, options) { return this.requireClient(apiKey).sendListMessage(await this.resolveDestination(apiKey, to), options); }
  async sendPoll(apiKey, to, name, choices, options) { return this.requireClient(apiKey).sendPollMessage(await this.resolveDestination(apiKey, to), name, choices, options); }
  sendReaction(apiKey, messageId, reaction) { return this.requireClient(apiKey).sendReactionToMessage(messageId, reaction); }

  getEvents(query) { return eventStore.list(query); }
  getDeletedMessages(query) { return eventStore.list({ ...query, type: 'message.deleted', limit: Math.min(Number(query?.limit) || 100, 500) }).filter(entry => entry.data?.from !== 'status@broadcast'); }
  getDeletions(query) {
    return eventStore.list({ ...query, types: ['message.deleted', 'status.deleted'], limit: Math.min(Number(query?.limit) || 100, 500) })
      .map(entry => ({ ...entry, deletionScope: entry.type === 'status.deleted' || entry.data?.from === 'status@broadcast' ? 'status' : entry.data?.original?.isGroupMsg || String(entry.data?.original?.chatId || '').includes('@g.us') ? 'group' : 'private-chat' }));
  }

  async downloadMedia(apiKey, messageId) {
    const client = this.requireClient(apiKey);
    const cached = eventStore.getCachedMedia(messageId);
    if (cached?.dataUrl) return cached;
    // Revoked messages are often removed from WhatsApp's live store. Prefer
    // the in-process event cache when the native lookup throws, so recovered
    // deletions can still be opened while the media blob remains available.
    let message;
    try { message = await client.getMessageById(messageId); } catch (error) {
      message = eventStore.getMessage(messageId);
      if (!message) {
        const friendly = new Error('This deleted media is no longer available from WhatsApp');
        friendly.statusCode = 410;
        throw friendly;
      }
    }
    if (!message) {
      const error = new Error('This deleted media is no longer available from WhatsApp');
      error.statusCode = 404;
      throw error;
    }
    let dataUrl;
    try { dataUrl = await client.downloadMedia(message); } catch (_) {
      const error = new Error('This deleted media is no longer available from WhatsApp');
      error.statusCode = 410;
      throw error;
    }
    if (!dataUrl) {
      const error = new Error('Media is no longer available from WhatsApp');
      error.statusCode = 410;
      throw error;
    }
    return { dataUrl, mimetype: message.mimetype || null, filename: message.filename || message.fileName || null };
  }

  async getStatuses(apiKey) {
    const session = this.getSession(apiKey);
    const grouped = { ...session.statusCache };
    try {
      const client = this.requireClient(apiKey);
      const statusRows = await client.page.evaluate(() => {
        const store = globalThis.WPP?.whatsapp?.StatusV3Store;
        if (!store) return [];
        return store.getModelsArray().map(model => {
          const messages = model.getAllMsgs?.() || model.msgs?.getModelsArray?.() || [];
          const contact = model.contact?.attributes || model.contact || {};
          return {
            senderId: model.id?.toString?.() || model.id?._serialized,
            contact: { name: contact.name, formattedName: contact.formattedName, pushname: contact.pushname, shortName: contact.shortName },
            messages: messages.map(message => ({ ...(message.toJSON?.() || message.attributes || {}), id: message.id?.toString?.() || message.id?._serialized || message.id })),
          };
        });
      });
      for (const row of statusRows) {
        const senderId = row.senderId || 'unknown';
        grouped[senderId] ||= [];
        for (const status of row.messages) {
          const normalized = { ...status, sender: row.contact, notifyName: row.contact.name || row.contact.formattedName || row.contact.pushname };
          if (!grouped[senderId].some((item) => String(item.id) === String(normalized.id))) grouped[senderId].push(normalized);
        }
      }
    } catch (error) {
      console.warn('Status history was unavailable:', error.message);
    }
    for (const senderId of Object.keys(grouped)) {
      grouped[senderId].sort((a, b) => (b.timestamp || b.t || 0) - (a.timestamp || a.t || 0));
    }
    return grouped;
  }
}

module.exports = new WhatsAppService();