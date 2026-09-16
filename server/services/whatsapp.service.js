const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');
const webhooks = require('./webhook.service');
const eventStore = require('./event-store.service');
const inboxStore = require('./inbox-store.service');
const automation = require('./automation.service');

// One isolated Chromium instance per API key, capped so total RAM stays
// bounded on Railway. Each running Chrome is roughly 200-400MB.
const MAX_CONCURRENT_SESSIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_SESSIONS || 2));

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

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
  // View-once media: normalize to its inner media type so the sidebar preview
  // reads like a normal photo/video (never a bare "[view once]").
  const normalizedType =
    type === 'viewonce' || type === 'view_once' || type === 'viewoncemessage' || message?.viewOnceMessage
      ? String(((() => {
          const inner = (message?.viewOnceMessage && typeof message.viewOnceMessage === 'object') ? (message.viewOnceMessage.message || message.viewOnceMessage) : {};
          return Object.keys(inner || {}).find(key => String(key).endsWith('Message')) || 'image';
        })())).replace(/Message$/, '').toLowerCase()
      : type;
  const text = safeMessageText(message);
  const media = {
    image: '📷 Photo', video: '🎥 Video', gif: '🎞️ GIF', audio: '🎵 Audio', ptt: '🎙️ Voice note',
    sticker: '🏷️ Sticker', document: `📄 ${message.filename || message.fileName || 'Document'}`,
    location: '📍 Location', live_location: '📍 Live location', vcard: '👤 Contact card',
    contact_card: '👤 Contact card', contacts_array: '👥 Contact cards',
  }[normalizedType];
  if (media) return text ? `${media}: ${text}` : media;
  if (type.includes('call')) return `${message.isMissed || type.includes('missed') ? 'Missed' : 'WhatsApp'} ${message.isVideoCall || type.includes('video') ? 'video' : 'voice'} call`;
  if (type === 'revoked' || message.isDeleted || message.isRevoked) return text ? `🚫 ${text}` : '🚫';
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

// wppconnect fills chatId/from/to inconsistently across versions and message
// shapes, and for GROUP chats the sender (participant) JID often leaks into
// `from`. That mis-buckets a group message into a DM with the sender, and the
// sidebar then shows that sender as the "chat". Derive the group JID from any
// id field ending in @g.us and force a normalized chatId onto the message so
// the socket stream, event ledger, inbox store and clients all agree on the
// bucket - while keeping author/participant/pushName intact for attribution.
function normalizeChatIdentity(message, apiKey) {
  if (!message || typeof message !== 'object') return message;
  const idOf = (value) => typeof value === 'string' ? value : (value?._serialized || value?.id || '');
  const candidates = [
    idOf(message.chatId),
    typeof message.to === 'string' ? message.to : idOf(message.to),
    typeof message.from === 'string' ? message.from : idOf(message.from),
    idOf(message.author || message.participant),
    typeof message.chat === 'string' ? message.chat : idOf(message.chat),
    typeof message.group === 'string' ? message.group : idOf(message.group),
  ];
  const groupJid = candidates.find(value => value && /@g\.us$/.test(value));
  const isGroup = Boolean(groupJid || message.isGroupMsg === true || message.isGroup === true);
  if (!isGroup) return message;
  const chatId = groupJid
    || idOf(message.chatId)
    || (message.fromMe ? idOf(message.to) : idOf(message.from))
    || '';
  if (!chatId) return message;
  const stringOrEmpty = (value) => typeof value === 'string' ? value.trim() : '';
  const chatObj = message.chat && typeof message.chat === 'object' ? message.chat : null;
  const groupName = chatObj?.groupMetadata?.subject
    || chatObj?.name
    || stringOrEmpty(message.groupMetadata?.subject)
    || stringOrEmpty(message.subject)
    || stringOrEmpty(message.chatName)
    || '';
  const normalized = { ...message, chatId: { _serialized: chatId }, isGroupMsg: true, isGroup: true, groupName };
  // Warm the group-name cache for this chat so the durable inbox rows (and
  // the client's name map) can heal numeric/sender-name display labels.
  if (apiKey) whatsappService.rememberGroupNames(apiKey, [{ chatId, name: groupName }]);
  return normalized;
}

// WhatsApp Web delivers "view once" media wrapped in a `viewOnceMessage`
// container (inner key like `imageMessage` / `videoMessage`). wppconnect does
// not always unwrap it, so a raw view-once message can surface with an unknown
// type (e.g. "viewOnce") and its media nested away - which makes the inbox
// render a bare "[view once]" bubble and breaks media download. Normalize it
// here: unwrap the inner message, promote the inner media type, flag the
// message with `isViewOnce: true` (the UI renders it like any other media -
// no timer emoji, no restriction) and keep any caption/pushname intact.
function normalizeViewOnce(message) {
  if (!message || typeof message !== 'object') return message;
  if (message.isViewOnce || message.viewOnce) return { ...message, isViewOnce: true };
  const inner = message.viewOnceMessage;
  if (!inner || typeof inner !== 'object') return message;
  const child = inner.message || inner;
  const mediaKey = Object.keys(child || {}).find(key => String(key).endsWith('Message'));
  const media = mediaKey ? child[mediaKey] : child;
  if (!media || typeof media !== 'object') return message;
  return {
    ...message,
    ...media,
    type: String(mediaKey || media.type || 'image').replace(/Message$/, '').toLowerCase(),
    caption: message.caption ?? media.caption ?? null,
    body: message.body ?? media.caption ?? null,
    isViewOnce: true,
  };
}

// Status timestamps arrive as seconds; only a couple of wppconnect paths use
// milliseconds. Normalize to whole seconds so the UI renders one format.
function statusTimestamp(message) {
  const n = Number(message?.timestamp ?? message?.t ?? 0);
  if (!n) return Math.floor(Date.now() / 1000);
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

// Profile pictures: cached on disk for 24h so the sidebar costs a disk read,
// never a WhatsApp round-trip. Background fetches are capped so even the very
// first sync of a big account never bursts WhatsApp with avatar requests.
const AVATAR_TTL_MS = Math.min(Math.max(Number(process.env.AVATAR_TTL_MS) || 24 * 60 * 60 * 1000, 60 * 60 * 1000), 7 * 24 * 60 * 60 * 1000);
const AVATAR_CONCURRENCY = 4;

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
    this.contactsNameMap = new Map();
    // chatId -> group subject, warmed from the live chat list and from every
    // group message we normalize. Used to heal group display names in the
    // sidebar when the durable row holds a number or an old sender's name.
    this.groupNameCache = new Map();
    // My own JID (e.g. "2348012345678@c.us"), cached once at login. Feeds the
    // automation engine's "mentions me" / "quotes one of my messages" / "done
    // by me" conditions without a per-event page round-trip.
    this.myJid = null;
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
    // Avatar background fetch bookkeeping (dedupe + concurrency cap).
    this.avatarInflight = new Map(); // "apiKey\u0000id" -> true
    this.avatarQueue = [];           // queued "apiKey\u0000id" while saturated
    this.avatarRunning = 0;
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
    // The first time a key reaches CONNECTED on this process, snapshot its chat
    // list into the durable per-tenant inbox (summaries only - never the
    // pre-login history). From that instant every message is recorded.
    if (status === 'CONNECTED' && !session.inboxBooted) {
      session.inboxBooted = true;
      void this.bootstrapInbox(session);
    }

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
      // Cache my own JID once per login (used by automation for mentions /
      // quoted-mine / by-me conditions). Read-only, no socket traffic.
      try {
        session.myJid = await client.page.evaluate(() => {
          try { const wid = window.WPP?.whatsapp?.UserPrefs?.getMaybeMeUser?.(); return wid ? String(wid) : null; } catch (_) { return null; }
        }).catch(() => null) || null;
      } catch (_) {}
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
    client.onAnyMessage((raw) => {
      // Force a canonical chatId for group messages first, so every consumer
      // below (media cache, inbox store, socket stream, ledger, automation)
      // buckets and attributes the message identically.
      const message = normalizeViewOnce(normalizeChatIdentity(raw, session.apiKey));
      // Preserve media while it is still downloadable. WhatsApp can remove
      // the live message immediately when the sender chooses Delete for all.
      if (['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document'].includes(String(message.type || '').toLowerCase())) {
        // Stickers are removed from WhatsApp's CDN faster than other media
        // types. A short delay lets the store settle before we grab the blob,
        // reducing 404s on stickers specifically.
        const isSticker = String(message.type || '').toLowerCase() === 'sticker';
        const delay = isSticker ? 1500 : 0;
        setTimeout(() => {
          void client.downloadMedia(message).then(dataUrl => eventStore.cacheMedia(message.id, dataUrl, { mimetype: message.mimetype, filename: message.filename || message.fileName }))
            .catch(err => { if (isSticker) console.log('[media]', session.apiKey.slice(0, 8), 'proactive sticker cache failed:', String(err?.message || err).slice(0, 120)); });
        }, delay);
      }
      if (message.isStatus || message.isStatusV3 || message.from === 'status@broadcast') {
        const senderId = message.author || message.from;
        // Normalize the status timestamp to whole seconds once, up front, so
        // the live socket, the in-memory cache, the ledger and every client
        // all receive the same well-formed value (wppconnect mixes seconds and
        // milliseconds across paths/versions).
        const status = { ...message, timestamp: statusTimestamp(message) };
        session.statusCache[senderId] ||= [];
        session.statusCache[senderId].push(status);
        session.statusCache[senderId] = session.statusCache[senderId].slice(-25);
        eventStore.rememberStatus(status);
        this.io?.to(`session_${session.apiKey}`).emit('new_status', status);
        void webhooks.emit('status.received', status);
        // Automation: route the status with `from` fixed to the author so the
        // reply target is the status author, never 'status@broadcast'.
        void automation.handleEvent(session.apiKey, 'status.received', { ...status, from: message.author || message.from }, this);
        return;
      }
      if (message.fromMe || message.isSentByMe) {
        // Outgoing message (sent from the API or any frontend). Stream it in
        // real time so an open Live Inbox mirrors the account. eventStore and
        // webhooks already record `message.sent` inside the send path, so we
        // only persist + surface it here.
        const chatId = message.chatId?._serialized || message.chatId || message.to;
        if (chatId) this.cachePreview(session, chatId, message);
        if (chatId) inboxStore.recordMessage(session.apiKey, chatId, message, this.resolveContactDisplayName(session, chatId));
        this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
        return;
      }
      this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
      eventStore.append('message.received', message);
      const chatId = message.chatId?._serialized || message.chatId || (message.fromMe ? message.to : message.from);
      if (chatId) this.cachePreview(session, chatId, message);
      if (chatId) inboxStore.recordMessage(session.apiKey, chatId, message, this.resolveContactDisplayName(session, chatId));
      // Trigger automation rules (may send replies, templates, orders, etc.)
      void automation.handleIncomingMessage(message, session.apiKey, this);
      // A single incoming message can be a "mention" and/or a "quote" too.
      // Dedicated triggers let the user react to those classes of messages
      // without touching their `message.received` rules.
      if (Array.isArray(message.mentionedJidList) && message.mentionedJidList.length) {
        void automation.handleEvent(session.apiKey, 'message.mention', message, this);
      }
      if (message.quotedMsgId || message.quotedParticipant) {
        void automation.handleEvent(session.apiKey, 'message.quote', message, this);
      }
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
        void automation.handleEvent(session.apiKey, 'status.deleted', removal.data, this);
        return;
      }
      const referenceId = data.refId || data.msgId || data.protocolMessageKey || data.id;
      let original = eventStore.getMessageDeep(referenceId);
      if (!original && referenceId) {
        try { original = await client.getMessageById(eventStore.idOf(referenceId)); } catch (_) { /* Already removed from WhatsApp's live store. */ }
      }
      if (original && (original.type === 'revoked' || (!original.body && !original.content && !original.caption && !original.filename && !original.mimetype))) original = null;
      const deletion = eventStore.append('message.deleted', { ...data, referenceId: eventStore.idOf(referenceId), original, recoveryStatus: original ? 'recovered' : 'not-observed', deletedAt: new Date().toISOString() });
      const delChatId = (original?.chatId?._serialized) || original?.chatId || deletion.data?.chatId?._serialized || deletion.data?.chatId || deletion.data?.from || null;
      if (delChatId && String(delChatId) !== 'status@broadcast') {
        inboxStore.recordDelete(session.apiKey, delChatId, deletion);
        // Automation for deleted messages: include the chat it lived in and any
        // group subject we know so rules can target specific chats/groups.
        void automation.handleEvent(session.apiKey, 'message.deleted', { ...deletion.data, chatId: delChatId, chatName: (session.groupNameCache && typeof delChatId === 'string' && /@g\.us$/.test(delChatId)) ? session.groupNameCache.get(delChatId) || '' : '' }, this);
      }
      this.io?.to(`session_${session.apiKey}`).emit('message_deleted', deletion);
      void webhooks.emit('message.deleted', deletion);
    });
    client.onMessageEdit((data) => {
      const edit = eventStore.append('message.edited', data);
      const editedRef = eventStore.getMessage(data?.id);
      const editChatId = editedRef?.chatId?._serialized || editedRef?.chatId || editedRef?.from || editedRef?.to || null;
      if (editChatId) inboxStore.recordEdit(session.apiKey, editChatId, edit);
      this.io?.to(`session_${session.apiKey}`).emit('message_edited', edit);
      void webhooks.emit('message.edited', edit);
    });
    client.onReactionMessage((data) => {
      const probe = data.msgId || data.messageId || data.id;
      const msgIdStr = eventStore.idOf(probe);
      const senderRaw = data.sender?.id || data.sender?.user || data.sender?.author || data.author || data.from;
      const sender = typeof senderRaw === 'string' ? senderRaw
        : eventStore.idOf(senderRaw) || (senderRaw?.user || '');
      const reaction = eventStore.append('message.reaction', {
        msgId: msgIdStr,
        reactionText: data.reactionText || '',
        orphan: Boolean(data.orphan),
        read: data.read,
        timestamp: data.timestamp || data.t || Date.now(),
        sender,
      });
      this.io?.to(`session_${session.apiKey}`).emit('message_reaction', reaction.data);
      const reactedRef = eventStore.getMessage(probe);
      const reactionChatId = reactedRef?.chatId?._serialized || reactedRef?.chatId || reactedRef?.from || reactedRef?.to || null;
      if (reactionChatId) inboxStore.recordReaction(session.apiKey, reactionChatId, reaction.data);
      void webhooks.emit('message.reaction', reaction);
      void automation.handleEvent(session.apiKey, 'message.reaction', {
        msgId: msgIdStr,
        reaction: data.reactionText || '',
        reactionText: data.reactionText || '',
        sender,
        chatId: reactionChatId || null,
        senderName: data.sender?.pushname || data.sender?.name || '',
        contactName: data.sender?.name || data.sender?.formattedName || '',
      }, this);
    });
    client.onIncomingCall((data) => {
      const call = eventStore.append('call.received', data);
      this.io?.to(`session_${session.apiKey}`).emit('incoming_call', call);
      void webhooks.emit('call.received', call);
      void automation.handleEvent(session.apiKey, 'call.received', data, this);
    });
    client.onParticipantsChanged((event) => {
      // Group join / leave / add / remove / promote / demote events.
      void automation.handleEvent(session.apiKey, 'group.participant_changed', {
        groupId: event.groupId,
        by: event.by,
        byPushName: event.byPushName,
        action: event.action,
        operation: event.operation,
        who: event.who || [],
        chatName: (session.groupNameCache && typeof event.groupId === 'string' && /@g\.us$/.test(event.groupId)) ? session.groupNameCache.get(event.groupId) || '' : '',
        byMe: Boolean(session.myJid && event.by && event.by === session.myJid),
      }, this);
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

  // Keep the "last message" preview pointed at real content. A revoked/deleted
  // copy is just a stub, so never let it replace the preview; merge the stub's
  // flag onto the previously cached (full) message instead.
  cachePreview(session, chatId, message) {
    const isDeletedCopy = Boolean(message.isDeleted || message.isRevoked || String(message.type || '').toLowerCase() === 'revoked');
    if (isDeletedCopy) {
      const original = (eventStore.idOf(message.id) && eventStore.getMessage(eventStore.idOf(message.id))) || session.chatPreviewCache.get(chatId);
      if (original && original !== message) {
        session.chatPreviewCache.set(chatId, { ...original, isDeleted: true, isRevoked: true, deleted: true });
        return;
      }
    }
    session.chatPreviewCache.set(chatId, message);
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

  async bootstrapInbox(session) {
    const client = session.client;
    if (!client) return;
    let chats = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (session.client !== client) return; // session stopped or replaced while waiting
      try {
        if (!(await client.isLoggedIn())) return;
        chats = await client.listChats();
        break;
      } catch (error) {
        // listChats races the WAPI bootstrap that runs right after CONNECTED;
        // retry until the page has finished injecting it.
        if (attempt === 7) { console.warn('Inbox baseline capture failed:', error.message); return; }
        await new Promise(resolve => setTimeout(resolve, attempt < 2 ? 2500 : 4000));
      }
    }
    if (session.client !== client || !Array.isArray(chats)) return;
    try {
      await inboxStore.bootstrap(session.apiKey, chats, {
        selfId: session.myJid,
        profileName: session.deviceInfo?.profileName,
      });
      console.log(`Inbox baseline captured for ${session.apiKey.slice(0, 8)} (${chats.length} chats)`);
    } catch (error) {
      console.warn('Inbox baseline capture failed:', error.message);
    }
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
    session.myJid = null;
    // The global /chats TTL cache is keyed by apiKey - drop this tenant's
    // entry so logged-out sessions never linger in memory.
    this.chatsCache?.delete(apiKey);

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
    session.myJid = null;
    // The global /chats TTL cache is keyed by apiKey - drop this tenant's
    // entry so logged-out sessions never linger in memory.
    this.chatsCache?.delete(apiKey);
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
      inboxStore.recordMessage(session.apiKey, String(to), result, this.resolveContactDisplayName(session, String(to)));
      return result;
    }
    const resolvedTo = await this.resolveDestination(apiKey, to);
    // WPPConnect defaults markIsRead to true when sending. Besides violating
    // passive mode, that read operation can fail for newer LID-only chats.
    const result = await this.requireClient(apiKey).sendText(resolvedTo, text, { ...options, markIsRead: false });
    eventStore.append('message.sent', result);
    session.chatPreviewCache.set(to, result);
    inboxStore.recordMessage(session.apiKey, String(resolvedTo), result, this.resolveContactDisplayName(session, String(resolvedTo)));
    return result;
  }

  async getChats(apiKey, { offset = 0, limit = 30 } = {}) {
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    // Cheap TTL cache: the sidebar is refreshed by live events anyway, so a
    // repeated /chats (page re-navigation, inbox re-open) returns instantly
    // instead of round-tripping through WhatsApp each time.
    const cacheKey = `${safeOffset}:${safeLimit}`;
    const cached = this.chatsCache?.get(apiKey);
    if (cached && cached.key === cacheKey && Date.now() - cached.at < 5000) return cached.value;
    const session = this.getSession(apiKey);
    const client = this.requireClient(apiKey);
    const allChats = (await client.listChats()).sort((a, b) => (b.t || 0) - (a.t || 0));
    const chats = allChats.slice(safeOffset, safeOffset + safeLimit);
    const livePreviews = await this.getChatPreviews(apiKey, chats.map(chat => chat.id?._serialized || chat.id));
    const enriched = await Promise.all(chats.map(async (chat) => {
      const embeddedMessages = Array.isArray(chat.msgs) ? chat.msgs : (chat.msgs?.models || []);
      const chatId = chat.id?._serialized || chat.id;
      // Every listChats row carries the group subject (chat.name /
      // groupMetadata.subject) - feed the cache so group-name display labels
      // can be healed everywhere, including on the durable inbox rows.
      this.rememberGroupNames(apiKey, [chat]);
      let lastMessage = session.chatPreviewCache.get(chatId) || livePreviews[chatId] || chat.lastMessage || embeddedMessages[embeddedMessages.length - 1] || null;
      // Never fan out into one history query per chat here. On large accounts
      // that turns a cheap list request into hundreds of sequential IndexedDB
      // lookups. Missing previews are hydrated only when a chat is opened.
      const displayName = this.resolveChatDisplayName(session, chat);
      return {
        ...chat,
        displayName: displayName || 'Unknown contact',
        lastMessage: (() => {
          if (!lastMessage) return this.previewFromChatMetadata(chat);
          // A deleted/revoked record is just a stub - WhatsApp clears the body
          // but we logged the original when it arrived. Recover it so the
          // subtitle keeps showing the real text (with a deleted marker)
          // instead of silently becoming "Message deleted".
          const isDel = Boolean(lastMessage.isDeleted || lastMessage.isRevoked || String(lastMessage.type || '').toLowerCase() === 'revoked');
          const original = isDel && eventStore.idOf(lastMessage.id) ? eventStore.getMessageDeep(eventStore.idOf(lastMessage.id)) : null;
          const display = original || lastMessage;
          const displayText = safeMessageText(display);
          return {
            id: original?.id || lastMessage.id,
            body: compactPreview(displayText),
            previewText: compactPreview(isDel ? (displayText ? `🚫 ${displayText}` : '🚫') : messagePreview(display)),
            type: display.type || lastMessage.type || 'chat',
            timestamp: display.timestamp || display.t || lastMessage.timestamp || lastMessage.t || chat.t,
            fromMe: Boolean(display.fromMe || lastMessage.fromMe),
            deleted: isDel,
          };
        })(),
      };
    }));
    // Attach cached profile pictures (or queue background fetches for the
    // missing ones) so the sidebar avatars render without extra round-trips.
    this.decorateChatsWithAvatars(apiKey, enriched);
    const result = { items: enriched, total: allChats.length, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + enriched.length < allChats.length };
    this.chatsCache ??= new Map();
    this.chatsCache.set(apiKey, { key: cacheKey, at: Date.now(), value: result });
    return result;
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
    this._rebuildContactsNameMap(session);
    return data;
  }

  _rebuildContactsNameMap(session) {
    const map = new Map();
    if (session.contactsCache?.data) {
      for (const c of session.contactsCache.data) {
        const id = c.id?._serialized || c.id;
        if (typeof id === 'string' && id) map.set(id, c);
      }
    }
    session.contactsNameMap = map;
  }

  resolveContactDisplayName(session, chatId, contactObj = {}) {
    const contact = (typeof chatId === 'string' && session.contactsNameMap?.get(chatId)) || contactObj;
    const selfId = session.myJid;
    const isSelf = contact.isMe || (selfId && chatId === selfId);
    if (isSelf) return contact.name || session.deviceInfo?.profileName || 'You';
    
    // Prevent the bot's own pushname (e.g. 'big9ja') from bleeding into newly
    // created outbound peer chats. WPPConnect sometimes echoes the sender's
    // pushname onto the chat.name / contact.name when no other name is known.
    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    
    if (contact.formattedName) return contact.formattedName;
    if (String(chatId).endsWith('@c.us')) {
      const num = String(chatId).split('@')[0];
      if (num) return num;
    }
    return null;
  }

  resolveChatDisplayName(session, chat) {
    const chatId = chat.id?._serialized || chat.id || '';
    const isGroup = chat.isGroup || String(chatId).endsWith('@g.us');
    if (isGroup) return chat.name || chat.groupMetadata?.subject || null;
    return this.resolveContactDisplayName(session, chatId, chat.contact || {});
  }

  // Resolve a contact/group's avatar to a base64 dataUrl, running entirely
  // inside the session's Chromium page so WhatsApp's blob: URLs are fetchable
  // there. Serves nothing stale - returns null when there is no picture.
  async profilePicDataUrl(apiKey, id) {
    const client = this.getSession(apiKey)?.client;
    if (!client || !id) return null;
    try {
      return await withTimeout(client.page.evaluate(async (wid) => {
        const WPP = globalThis.WPP;
        const toDataUrl = async (url) => {
          if (!url || typeof url !== 'string') return null;
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const blob = await res.blob();
            return await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          } catch (_) { return null; }
        };
        // 1) The page's own contact store usually already holds the thumbnail
        //    (a blob URL). Prefer it - zero extra network when warm.
        const contact = WPP?.whatsapp?.ContactStore?.get(wid);
        const thumb = contact?.profilePicThumbObj || {};
        for (const url of [thumb.img, thumb.imgFull, thumb.url]) {
          const dataUrl = await toDataUrl(url);
          if (dataUrl) return dataUrl;
        }
        // 2) Otherwise ask WhatsApp for the (cache-busted) picture URL.
        try {
          const url = await WPP?.contact?.getProfilePictureUrl?.(wid, false);
          return await toDataUrl(url);
        } catch (_) { return null; }
      }, id), 12000);
    } catch (_) { return null; }
  }

  // One miss resolves the avatar, caches it, and ships it to the tenant's
  // room - filling the sidebar the moment it arrives, with no client polling.
  fetchAvatar(apiKey, id) {
    return this.profilePicDataUrl(apiKey, id).then((dataUrl) => {
      if (dataUrl) {
        eventStore.cacheAvatar(id, dataUrl);
        this.io?.to(`session_${apiKey}`).emit('avatar_ready', { id, dataUrl });
      }
      return dataUrl;
    });
  }

  // Background, deduped, concurrency-capped avatar fetch. Safe to call on
  // every request for any number of ids - misses are fetched at most once,
  // and only four WhatsApp profile calls run at a time.
  queueAvatar(apiKey, id) {
    if (!id || typeof id !== 'string') return;
    const key = `${apiKey}\u0000${id}`;
    if (this.avatarInflight.has(key) || this.avatarRunning >= AVATAR_CONCURRENCY) {
      if (!this.avatarInflight.has(key)) this.avatarQueue.push(key);
      return;
    }
    this.avatarRunning += 1;
    this.avatarInflight.set(key, true);
    this.fetchAvatar(apiKey, id).finally(() => {
      this.avatarInflight.delete(key);
      this.avatarRunning -= 1;
      if (this.avatarQueue.length && this.avatarRunning < AVATAR_CONCURRENCY) {
        const nextKey = this.avatarQueue.shift();
        const sep = nextKey.indexOf('\u0000');
        this.queueAvatar(nextKey.slice(0, sep), nextKey.slice(sep + 1));
      }
    });
  }

  // Decorate an array of chat-like rows ({ id }) with `profilePic` from the
  // avatar disk cache. Cache hits are one disk read each; misses are fetched
  // in the background (only while WhatsApp is connected) and never block the
  // request - the surface fills in via avatar_ready as each fetch resolves.
  async decorateChatsWithAvatars(apiKey, chats = []) {
    const session = this.getSession(apiKey);
    const connected = session.client?.isConnected?.();
    try {
      for (const chat of chats) {
        const id = chat?.id?._serialized || chat?.id;
        if (typeof id !== 'string' || !id) continue;
        const cached = await eventStore.getCachedAvatar(id, AVATAR_TTL_MS);
        if (cached) { chat.profilePic = cached; continue; }
        if (connected) this.queueAvatar(apiKey, id);
      }
    } catch (_) { /* Decoration is best-effort; the list renders without avatars. */ }
    return chats;
  }

  // Per-sender avatars for the status payload. Returns { senderId: dataUrl }
  // only for cached entries - misses queue a background fetch (their picture
  // shows up via avatar_ready after it resolves).
  async statusProfiles(apiKey, senderIds = []) {
    const profiles = {};
    for (const senderId of senderIds) {
      if (!senderId || senderId === 'status@broadcast') continue;
      const cached = await eventStore.getCachedAvatar(senderId, AVATAR_TTL_MS);
      if (cached) { profiles[senderId] = cached; continue; }
      this.queueAvatar(apiKey, senderId);
    }
    return profiles;
  }

  // Member of the group-name cache: chatId -> group subject. Warmed from the
  // live chat list and from every normalized group message, so the durable
  // inbox rows (and the client's name map) can always heal a row whose display
  // name is still a bare number or whatever sender-name got persisted before.
  rememberGroupNames(apiKey, rows) {
    const session = this.getSession(apiKey);
    if (!session) return;
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (!row || typeof row !== 'object') continue;
      const chatId = row.chatId || row.id?._serialized || row.id;
      const name = row.name || row.groupName || row.groupMetadata?.subject || row.chatName;
      if (typeof chatId === 'string' && /@g\.us$/.test(chatId) && typeof name === 'string' && name.trim()) {
        session.groupNameCache.set(chatId, name.trim());
      }
    }
  }

  // Decorate durable inbox rows with their real group subject from the live
  // cache. The durable row may still hold a bare number (recorded pre-fix) or a
  // sender-name (recorded while the clobber bug was live) - `chatName` lets the
  // client prefer the resolved group name, and numeric display_names are healed
  // in place so nothing downstream shows a raw JID.
  decorateGroupNames(apiKey, chats = []) {
    const names = this.getSession(apiKey)?.groupNameCache;
    if (!names) return chats;
    for (const chat of chats) {
      const chatId = chat?.id || chat?.chatId;
      if (typeof chatId !== 'string' || !/^[^@\s]+@g\.us$/.test(chatId)) continue;
      const groupName = names.get(chatId);
      if (!groupName) continue;
      chat.chatName = groupName;
      const current = chat.displayName || chatId;
      // Heal year-long numeric labels outright; a sender-name or a real subject
      // is left to the client (chatName is preferred there regardless).
      if (/^\+?[\d\s()\-]+$/.test(current)) chat.displayName = groupName;
    }
    return chats;
  }

  async getGroups(apiKey) {
    const client = this.requireClient(apiKey);
    const session = this.getSession(apiKey);
    const groups = await client.getAllGroups();
    const myJid = session?.myJid || '';
    return groups.map(g => {
      const parts = g.participants || [];
      const me = parts.find(p => p.id === myJid || (p.id && p.id._serialized === myJid));
      return { ...g, iAmAdmin: me ? Boolean(me.isAdmin || me.isSuperAdmin) : false };
    });
  }

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
    // Deleted records from WhatsApp are stubs; swap in the logged original so
    // the deleted message stays fully readable (tagged isDeleted for the UI).
    messages = messages.map(message => {
      if (!message) return message;
      const del = Boolean(message.isDeleted || message.isRevoked || String(message.type || '').toLowerCase() === 'revoked');
      if (del && !safeMessageText(message)) {
        const original = eventStore.idOf(message.id) ? eventStore.getMessage(eventStore.idOf(message.id)) : null;
        if (original) return { ...original, isDeleted: true, isRevoked: true, deleted: true };
      }
      return message;
    });
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

  async sendFile(apiKey, to, dataUrl, filename, caption = '') {
    const client = this.requireClient(apiKey);
    const resolvedTo = await this.resolveDestination(apiKey, to);
    const result = await client.sendFileFromBase64(resolvedTo, dataUrl, filename, caption);
    this.cacheSentMedia(client, resolvedTo, dataUrl, filename);
    return result;
  }
  async sendSticker(apiKey, to, dataUrl) {
    const client = this.requireClient(apiKey);
    const resolvedTo = await this.resolveDestination(apiKey, to);
    const result = await client.sendImageAsSticker(resolvedTo, dataUrl);
    this.cacheSentMedia(client, resolvedTo, dataUrl, 'sticker.webp');
    return result;
  }

  // The just-sent media is already in our hands as a dataUrl, so persist it to
  // the media cache under the canonical message id before WhatsApp can prune
  // it. Read-only on the page: just reflects back the newest sent message id.
  cacheSentMedia(client, chatId, dataUrl, filename) {
    void (async () => {
      try {
        let id = null;
        for (let attempt = 0; attempt < 5 && !id; attempt++) {
          id = await client.page.evaluate(async ({ chatId, fromMe }) => {
            const store = globalThis.WPP?.whatsapp?.ChatStore;
            let chat = store?.get(chatId);
            if (!chat) chat = store?.getModelsArray?.().find(item => item.id?.toString?.() === chatId || item.id?._serialized === chatId);
            const models = chat?.msgs?.getModelsArray?.() || [];
            for (let i = models.length - 1; i >= 0; i--) {
              const msg = models[i];
              if (msg?.isSentByMe && globalThis.WAPI?.processMessageObj?.(msg, true, true)) {
                const idField = globalThis.WAPI.processMessageObj(msg, true, true);
                if (idField && typeof idField.id === 'string') return idField.id;
              }
            }
            return null;
          }, { chatId, fromMe: true });
          if (!id) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (id) eventStore.cacheMedia(id, dataUrl, { mimetype: this.dataUrlMime(dataUrl), filename });
      } catch (_) {}
    })();
  }

  dataUrlMime(dataUrl) {
    try { return /^data:([^;,]+)/.exec(dataUrl)?.[1] || null; } catch (_) { return null; }
  }
  async sendLocation(apiKey, to, latitude, longitude, title = '') { return this.requireClient(apiKey).sendLocation(await this.resolveDestination(apiKey, to), String(latitude), String(longitude), title); }
  async sendContact(apiKey, to, contactId, name) { return this.requireClient(apiKey).sendContactVcard(await this.resolveDestination(apiKey, to), await this.resolveDestination(apiKey, contactId), name); }
  async sendList(apiKey, to, options) { return this.requireClient(apiKey).sendListMessage(await this.resolveDestination(apiKey, to), options); }
  async sendPoll(apiKey, to, name, choices, options) { return this.requireClient(apiKey).sendPollMessage(await this.resolveDestination(apiKey, to), name, choices, options); }
  sendReaction(apiKey, messageId, reaction) { return this.requireClient(apiKey).sendReactionToMessage(messageId, reaction); }

  async getEvents(query) { return await eventStore.list(query); }
  async getDeletedMessages(query) { 
    const list = await eventStore.list({ ...query, type: 'message.deleted', limit: Math.min(Number(query?.limit) || 100, 500) });
    return list.filter(entry => entry.data?.from !== 'status@broadcast'); 
  }
  async getDeletions(query) {
    const list = await eventStore.list({ ...query, types: ['message.deleted', 'status.deleted'], limit: Math.min(Number(query?.limit) || 100, 500) });
    return list.map(entry => ({ ...entry, deletionScope: entry.type === 'status.deleted' || entry.data?.from === 'status@broadcast' ? 'status' : entry.data?.original?.isGroupMsg || String(entry.data?.original?.chatId || '').includes('@g.us') ? 'group' : 'private-chat' }));
  }

  async forwardMessage(apiKey, to, messageId) {
    const client = this.requireClient(apiKey);
    const dest = await this.resolveDestination(apiKey, to);
    return client.forwardMessagesV2(dest, messageId);
  }

  async startTyping(apiKey, chatId) {
    const client = this.requireClient(apiKey);
    return client.startTyping(chatId);
  }

  async stopTyping(apiKey, chatId) {
    const client = this.requireClient(apiKey);
    return client.stopTyping(chatId);
  }
  
  async removeParticipant(apiKey, groupId, phone) {
    const client = this.requireClient(apiKey);
    return client.removeParticipant(groupId, phone);
  }

  async getGroupAdmins(apiKey, groupId) {
    const client = this.requireClient(apiKey);
    const admins = await client.getGroupAdmins(groupId);
    return admins.map(a => a._serialized || a.id || a);
  }

  async downloadMedia(apiKey, messageId) {
    const client = this.requireClient(apiKey);
    const shortKey = apiKey.slice(0, 8);
    // Optimistic outgoing messages carry a "_out" suffix that never exists in
    // WhatsApp's store. The canonical id (used by the event log and cache) is
    // the same id without it.
    const canonicalId = String(messageId).replace(/_out$/, '');
    let cached;
    try { cached = await eventStore.getCachedMedia(canonicalId); } catch (e) {}
    if (cached?.dataUrl) return cached;
    console.log('[media]', shortKey, 'cache miss for', canonicalId);
    // Revoked messages are often removed from WhatsApp's live store. Prefer
    // the in-process event cache when the native lookup throws, so recovered
    // deletions can still be opened while the media blob remains available.
    let message;
    let nativeErr = null;
    try { message = await withTimeout(client.getMessageById(canonicalId), 15000); } catch (error) {
      nativeErr = error;
      console.log('[media]', shortKey, 'getMessageById TIMED OUT OR THREW:', String(error?.message || error).slice(0, 120));
      message = eventStore.getMessage(canonicalId);
      if (!message) {
        console.log('[media]', shortKey, 'no event-store fallback; 410');
        const friendly = new Error('This deleted media is no longer available from WhatsApp');
        friendly.statusCode = 410;
        throw friendly;
      }
      console.log('[media]', shortKey, 'serving from event-store fallback');
    }
    if (!message) {
      console.log('[media]', shortKey, 'getMessageById empty; 404');
      const error = new Error('This deleted media is no longer available from WhatsApp');
      error.statusCode = 404;
      throw error;
    }
    let dataUrl;
    try { dataUrl = await withTimeout(client.downloadMedia(message), 20000); } catch (err) {
      console.log('[media]', shortKey, 'downloadMedia TIMED OUT OR THREW for', canonicalId, '->', String(err?.message || err).slice(0, 120), '| fromMe:', message?.fromMe, '| type:', message?.type, '| nativeErr:', nativeErr ? 'yes' : 'no');
      // One retry with a fresh message reference — WhatsApp CDN sometimes
      // returns a transient 404 for stickers/ephemeral media.
      if (String(message.type || '').toLowerCase() === 'sticker') {
        try {
          const fresh = await withTimeout(client.getMessageById(canonicalId), 15000);
          if (fresh) dataUrl = await withTimeout(client.downloadMedia(fresh), 20000);
        } catch (_) {}
      }
      if (!dataUrl) {
        const error = new Error('This deleted media is no longer available from WhatsApp');
        error.statusCode = 410;
        throw error;
      }
    }
    if (!dataUrl) {
      console.log('[media]', shortKey, 'downloadMedia returned blank for', canonicalId);
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

const whatsappService = new WhatsAppService();
module.exports = whatsappService;