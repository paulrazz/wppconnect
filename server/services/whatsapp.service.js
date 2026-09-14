const path = require('path');
const wppconnect = require('@wppconnect-team/wppconnect');
const puppeteer = require('puppeteer');
const webhooks = require('./webhook.service');
const eventStore = require('./event-store.service');
const automation = require('./automation.service');

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
const crypto = require('crypto');

function hashKey(key) {
  return crypto.createHash('sha256').update(key || '').digest('hex').substring(0, 32);
}

class WhatsAppService {
  constructor() {
    this.client = null;
    this.currentApiKey = null;
    this.sessionStatus = 'DISCONNECTED';
    this.sessionName = 'dashboard-session';
    this.sessionPath = null;
    this.io = null;
    this.startPromise = null;
    this.lastError = null;
    this.connectedAt = null;
    this.lastQrCode = null;
    this.statusCache = {};
    this.chatPreviewCache = new Map();
    this.passiveMode = true;
    this.lifecycleGeneration = 0;
  }

  setIo(io) { this.io = io; }

  setStatus(status, error = null) {
    this.sessionStatus = status;
    this.lastError = error ? (error.message || String(error)) : null;
    if (status !== 'QR_READY') this.lastQrCode = null;
    if (status === 'CONNECTED') this.connectedAt = new Date().toISOString();
    
    if (this.currentApiKey) {
      const room = `session_${this.currentApiKey}`;
      this.io?.to(room).emit('session_status', status);
      this.io?.to(room).emit('session_details', this.getStatus());
    }
    void webhooks.emit('session.status', this.getStatus());
  }

  getStatus() {
    return { status: this.sessionStatus, ready: this.sessionStatus === 'CONNECTED' && Boolean(this.client), session: this.sessionName, connectedAt: this.connectedAt, lastError: this.lastError, passiveMode: this.passiveMode, readReceipts: 'disabled' };
  }

  async ensureSessionActive(apiKey) {
    if (!apiKey) throw new Error('API Key is required to start a session');
    
    // If this specific session is already active or starting, return it
    if (this.currentApiKey === apiKey && (this.client || this.startPromise)) {
      if (this.sessionStatus === 'QR_READY' || this.sessionStatus === 'STARTING') return;
      return this.startPromise || this.client;
    }

    // Otherwise, we must swap. Stop current session if any.
    if (this.client || this.startPromise) {
      console.log(`[Session Swap] Gracefully closing session for ${this.sessionName} to free RAM.`);
      await this.stopSession();
    }

    // Now start the new one
    this.currentApiKey = apiKey;
    this.sessionName = hashKey(apiKey);
    this.sessionPath = path.resolve(__dirname, '..', 'sessions', this.sessionName);
    
    this.setStatus('STARTING');
    const generation = ++this.lifecycleGeneration;
    this.startPromise = this.createClient(generation);
    try { return await this.startPromise; } finally { this.startPromise = null; }
  }

  async startSession(apiKey) {
    return this.ensureSessionActive(apiKey || this.currentApiKey);
  }

  async createClient(generation) {
    try {
      const client = await wppconnect.create({
        session: this.sessionName,
        catchQR: (base64Qr) => { 
          this.lastQrCode = base64Qr; 
          this.setStatus('QR_READY'); 
          if (this.currentApiKey) this.io?.to(`session_${this.currentApiKey}`).emit('qr_code', base64Qr); 
        },
        statusFind: (status) => {
          console.log('WhatsApp auth status:', status);
          if (['isLogged', 'inChat', 'qrReadSuccess'].includes(status)) this.setStatus('CONNECTED');
          if (['autocloseCalled', 'desconnectedMobile', 'browserClose'].includes(status)) this.setStatus('ERROR', new Error(`WhatsApp session: ${status}`));
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
          userDataDir: this.sessionPath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-crash-reporter',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Vastly reduces memory on single-instance containers
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--safebrowsing-disable-auto-update',
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--disable-component-update',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees',
            '--disable-client-side-phishing-detection'
          ],
        },
      });
      if (generation !== this.lifecycleGeneration) {
        await client.close().catch(() => {});
        throw Object.assign(new Error('Session startup was cancelled'), { code: 'SESSION_START_CANCELLED', statusCode: 409 });
      }
      this.client = client;
      // Keep the automation runtime offline and never call sendSeen while browsing.
      // History and media retrieval use data-layer APIs and do not open the native chat UI.
      await client.setOnlinePresence(false).catch((error) => console.warn('Could not force offline presence:', error.message));
      this.setStatus('CONNECTED');
      this.registerListeners(client);
      console.log(`WhatsApp session ready (${this.sessionPath})`);
      return client;
    } catch (error) {
      this.client = null;
      if (generation === this.lifecycleGeneration) this.setStatus('ERROR', error);
      console.error('Failed to start WhatsApp session:', error);
      throw error;
    }
  }

  registerListeners(client) {
    client.onMessage((message) => {
      // Preserve media while it is still downloadable. WhatsApp can remove
      // the live message immediately when the sender chooses Delete for all.
      if (['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document'].includes(String(message.type || '').toLowerCase())) {
        void client.downloadMedia(message).then(dataUrl => eventStore.cacheMedia(message.id, dataUrl, { mimetype: message.mimetype, filename: message.filename || message.fileName })).catch(() => {});
      }
      if (message.isStatus || message.from === 'status@broadcast') {
        const senderId = message.author || message.from;
        this.statusCache[senderId] ||= [];
        this.statusCache[senderId].push(message);
        this.statusCache[senderId] = this.statusCache[senderId].slice(-25);
        eventStore.rememberStatus(message);
        this.io?.emit('new_status', message);
        void webhooks.emit('status.received', message);
        return;
      }
      this.io?.emit('new_message', message);
      eventStore.append('message.received', message);
      const chatId = message.chatId?._serialized || message.chatId || (message.fromMe ? message.to : message.from);
      if (chatId) this.chatPreviewCache.set(chatId, message);
      // Trigger automation rules (may send replies, templates, orders, etc.)
      void automation.handleIncomingMessage(message, this);
      void webhooks.emit('message.received', message);
    });
    client.onAck((ack) => {
      eventStore.append('message.ack', ack);
      this.io?.emit('message_ack', ack);
      void webhooks.emit('message.ack', ack);
    });
    client.onRevokedMessage(async (data) => {
      if (data.from === 'status@broadcast') {
        const referenceId = data.refId || data.msgId || data.protocolMessageKey || data.id;
        const exact = eventStore.getMessage(referenceId);
        const original = exact || eventStore.getLatestStatus(data.author);
        const removal = eventStore.append('status.deleted', { ...data, referenceId: eventStore.idOf(referenceId), original, recoveryStatus: exact ? 'recovered' : original ? 'probable-sender-match' : 'not-observed', deletedAt: new Date().toISOString() });
        this.io?.emit('status_deleted', removal);
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
      this.io?.emit('message_deleted', deletion);
      void webhooks.emit('message.deleted', deletion);
    });
    client.onMessageEdit((data) => {
      const edit = eventStore.append('message.edited', data);
      this.io?.emit('message_edited', edit);
      void webhooks.emit('message.edited', edit);
    });
    client.onReactionMessage((data) => {
      const reaction = eventStore.append('message.reaction', data);
      this.io?.emit('message_reaction', reaction);
      void webhooks.emit('message.reaction', reaction);
    });
    client.onIncomingCall((data) => {
      const call = eventStore.append('call.received', data);
      this.io?.emit('incoming_call', call);
      void webhooks.emit('call.received', call);
    });
    client.onStateChange((state) => {
      console.log('WhatsApp state:', state);
      this.io?.emit('whatsapp_state', state);
      void webhooks.emit('whatsapp.state', { state });
      if (['CONFLICT', 'UNLAUNCHED'].includes(state)) client.useHere().catch((error) => console.warn('WhatsApp takeover skipped:', error.message));
      if (state === 'CONNECTED') this.setStatus('CONNECTED');
      if (['UNPAIRED', 'UNPAIRED_IDLE', 'DISCONNECTED'].includes(state)) this.setStatus('DISCONNECTED');
    });
  }

  requireClient() {
    if (!this.client || this.sessionStatus !== 'CONNECTED') {
      const error = new Error('WhatsApp is not connected yet');
      error.statusCode = 503;
      throw error;
    }
    return this.client;
  }

  async stopSession() {
    this.lifecycleGeneration += 1;
    const client = this.client;
    this.client = null;
    if (client) {
      console.log(`[Memory Manager] Forcefully terminating Chromium process for session ${this.sessionName}...`);
      try {
        const browser = await client.page.browser();
        if (browser) browser.process().kill('SIGKILL');
      } catch (err) {
        // Ignore errors if browser is already dead
      }
      await client.close().catch(() => {});
    }
    this.setStatus('DISCONNECTED');
  }
  async logoutSession() {
    this.lifecycleGeneration += 1;
    const client = this.client;
    this.client = null;
    if (client) await client.logout();
    this.connectedAt = null;
    this.setStatus('DISCONNECTED');
  }
  async resetSession() { await this.stopSession(); return this.startSession(); }
  async resolveDestination(to) {
    const client = this.requireClient();
    const id = String(to || '').trim();
    if (!id.endsWith('@lid')) return id;
    try {
      const mapping = await client.getPnLidEntry(id);
      return mapping?.phoneNumber?._serialized || mapping?.phoneNumber?.toString?.() || id;
    } catch (error) {
      console.warn(`Could not resolve LID destination ${id}:`, error.message);
      return id;
    }
  }
  async sendMessage(to, text, options) {
    const client = this.requireClient();
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
      this.chatPreviewCache.set(to, result);
      return result;
    }
    const resolvedTo = await this.resolveDestination(to);
    // WPPConnect defaults markIsRead to true when sending. Besides violating
    // passive mode, that read operation can fail for newer LID-only chats.
    const result = await this.requireClient().sendText(resolvedTo, text, { ...options, markIsRead: false });
    eventStore.append('message.sent', result);
    this.chatPreviewCache.set(to, result);
    return result;
  }
  async getChats({ offset = 0, limit = 30 } = {}) {
    const client = this.requireClient();
    const allChats = (await client.listChats()).sort((a, b) => (b.t || 0) - (a.t || 0));
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const chats = allChats.slice(safeOffset, safeOffset + safeLimit);
    const livePreviews = await this.getChatPreviews(chats.map(chat => chat.id?._serialized || chat.id));
    const enriched = await Promise.all(chats.map(async (chat) => {
      const embeddedMessages = Array.isArray(chat.msgs) ? chat.msgs : (chat.msgs?.models || []);
      const chatId = chat.id?._serialized || chat.id;
      let lastMessage = this.chatPreviewCache.get(chatId) || livePreviews[chatId] || chat.lastMessage || embeddedMessages[embeddedMessages.length - 1] || null;
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
  async getChatPreviews(chatIds) {
    if (!chatIds.length) return {};
    return this.requireClient().page.evaluate((ids) => {
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
  getContacts() { return this.requireClient().getAllContacts(); }
  getGroups() { return this.requireClient().getAllGroups(); }
  async inspectIdentity(id) {
    const client = this.requireClient();
    const [mapping, contact, chats] = await Promise.all([
      client.getPnLidEntry(id).catch(error => ({ error: error.message })),
      client.getContact(id).catch(error => ({ error: error.message })),
      client.listChats(),
    ]);
    const chat = chats.find(item => (item.id?._serialized || item.id) === id);
    return { requestedId: id, mapping, contact, chat: chat ? { id: chat.id, contact: chat.contact, name: chat.name, isGroup: chat.isGroup } : null };
  }
  async getMessages(chatId, count = 30) {
    const client = this.requireClient();
    const limit = Math.min(Math.max(Number(count) || 30, 1), 100);
    let messages = await client.getMessages(chatId, { count: limit });
    if (!messages.length) messages = (await this.readChatModel(chatId, false)).messages.slice(-limit);
    messages.forEach(message => eventStore.rememberMessage(message));
    return { messages, hasMore: messages.length >= limit, cursor: eventStore.idOf(messages[0]?.id) || null };
  }
  async loadEarlierMessages(chatId, before, count = 40) {
    const client = this.requireClient();
    const limit = Math.min(Math.max(Number(count) || 40, 1), 100);
    let messages = [];
    if (before) {
      try { messages = await client.getMessages(chatId, { count: limit, id: before, direction: 'before' }); } catch (_) { /* LID chats need the model fallback below. */ }
    }
    let noEarlierMessages = false;
    if (!messages.length) {
      const model = await this.readChatModel(chatId, true);
      noEarlierMessages = model.noEarlierMessages;
      const beforeIndex = before ? model.messages.findIndex(message => eventStore.idOf(message.id) === before) : model.messages.length;
      const end = beforeIndex >= 0 ? beforeIndex : model.messages.length;
      messages = model.messages.slice(Math.max(0, end - limit), end);
    }
    messages.forEach(message => eventStore.rememberMessage(message));
    return { messages, hasMore: !noEarlierMessages && messages.length > 0, cursor: eventStore.idOf(messages[0]?.id) || before || null };
  }
  async readChatModel(chatId, loadEarlier) {
    const client = this.requireClient();
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
  async sendFile(to, dataUrl, filename, caption = '') { return this.requireClient().sendFileFromBase64(await this.resolveDestination(to), dataUrl, filename, caption); }
  async sendSticker(to, dataUrl) { return this.requireClient().sendImageAsSticker(await this.resolveDestination(to), dataUrl); }
  async sendLocation(to, latitude, longitude, title = '') { return this.requireClient().sendLocation(await this.resolveDestination(to), String(latitude), String(longitude), title); }
  async sendContact(to, contactId, name) { return this.requireClient().sendContactVcard(await this.resolveDestination(to), await this.resolveDestination(contactId), name); }
  async sendList(to, options) { return this.requireClient().sendListMessage(await this.resolveDestination(to), options); }
  async sendPoll(to, name, choices, options) { return this.requireClient().sendPollMessage(await this.resolveDestination(to), name, choices, options); }
  sendReaction(messageId, reaction) { return this.requireClient().sendReactionToMessage(messageId, reaction); }
  getEvents(query) { return eventStore.list(query); }
  getDeletedMessages(query) { return eventStore.list({ ...query, type: 'message.deleted', limit: Math.min(Number(query?.limit) || 100, 500) }).filter(entry => entry.data?.from !== 'status@broadcast'); }
  getDeletions(query) {
    return eventStore.list({ ...query, types: ['message.deleted', 'status.deleted'], limit: Math.min(Number(query?.limit) || 100, 500) })
      .map(entry => ({ ...entry, deletionScope: entry.type === 'status.deleted' || entry.data?.from === 'status@broadcast' ? 'status' : entry.data?.original?.isGroupMsg || String(entry.data?.original?.chatId || '').includes('@g.us') ? 'group' : 'private-chat' }));
  }
  async downloadMedia(messageId) {
    const client = this.requireClient();
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
  async getStatuses() {
    const grouped = { ...this.statusCache };
    try {
      const client = this.requireClient();
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
