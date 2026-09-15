import { io } from 'socket.io-client';
import { getApiKey } from './auth';
import { sessionStore } from './sessionStore';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');

const msgId = (m) => m?.id?._serialized || m?.id?.id || (typeof m?.id === 'string' ? m.id : null);

// The chat a message belongs to, mirroring the backend emit: prefer the
// message's own chatId, then fall back to the peer (to for outgoing, from
// for incoming).
const chatIdOf = (m) => m?.chatId?._serialized || m?.chatId || (m?.fromMe ? m?.to : m?.from);

// WhatsApp self-sends echo your own wid: from === to.
const isSelfMessage = (m) => String(m?.fromMe) === 'true' && String(m?.to) === String(m?.from);

// The same outgoing message is reported twice - once as the send result (its
// id gained an "_out" suffix), once as the socket echo. Normalize for dedupe
// so we never render twin bubbles.
const dedupeKey = (m) => (msgId(m) || '').replace(/_out$/, '');

function createLiveStream() {
  let socket = null;
  let apiKey = null;
  let activeChatId = null;
  let version = 0;

  const listeners = new Set();
  const chats = {};       // chatId -> { messages: [] }  (live messages only)
  const reactions = {};   // msgId -> [{ emoji, senderId }]

  const notify = () => {
    version += 1;
    listeners.forEach(fn => { try { fn(); } catch (_) {} });
  };

  // Reactions, media lookups and dedupe all assume a canonical (non "_out")
// message id. Strip the "_out" suffix from any copy we store so self-sent
// bubbles behave exactly like peer messages.
const normalizeOut = (m) => {
  const serialized = msgId(m);
  if (!serialized || !serialized.endsWith('_out')) return m;
  const canonical = serialized.replace(/_out$/, '');
  if (m.id && typeof m.id === 'object') return { ...m, id: { ...m.id, id: canonical, _serialized: canonical } };
  if (typeof m.id === 'string') return { ...m, id: canonical };
  return m;
};

const isDeletedCopy = (m) => Boolean(m?.isDeleted || m?.isRevoked || String(m?.type || '').toLowerCase() === 'revoked');

const pushMessage = (message, targetId) => {
    if (!targetId) return false;
    if (!chats[targetId]) chats[targetId] = { messages: [] };
    const list = chats[targetId].messages;
    const key = dedupeKey(message);
    const existing = key ? list.find(m => dedupeKey(m) === key) : null;
    if (isDeletedCopy(message)) {
      // A revoke/delete echo is a stub that mirrors an earlier message. Flag the
      // original bubble (keeping its text) instead of rendering a twin.
      if (existing) {
        existing.isDeleted = true;
        existing.isRevoked = true;
        existing.deleted = true;
        return false;
      }
    }
    if (existing) return false;
    list.push(normalizeOut(message));
    return true;
  };

  const applySocketHandlers = () => {
    socket.on('new_message', (message) => {
      const chatId = chatIdOf(message);
      if (!chatId) return;
      let changed = false;
      if (isSelfMessage(message) && activeChatId && activeChatId !== chatId) {
        // A self-send can surface under the LID form while the sidebar uses
        // the PN form. Land it in the chat the user actually has open too.
        changed = pushMessage(message, activeChatId) || changed;
      } else {
        changed = pushMessage(message, chatId) || changed;
      }
      if (changed) notify();
    });

    socket.on('message_reaction', (data) => {
      const rawTarget = data.msgId?._serialized || data.msgId?.id || data.msgId;
      if (!rawTarget) return;
      // Reactions are always keyed by the canonical parent message key, while
      // self-sent messages may be stored with an "_out" suffix. Normalize both
      // to the same key so the lookup always matches.
      const targetId = String(rawTarget).replace(/_out$/, '');
      const senderRaw = data.sender?.id || data.sender?.user || data.sender;
      const sender = typeof senderRaw === 'string' ? senderRaw
        : (senderRaw?._serialized || senderRaw?.user || (typeof senderRaw?.id === 'string' ? senderRaw.id : ''));
      const list = (reactions[targetId] || []).filter(r => (r.senderId || r.sender) !== sender);
      if (!data.orphan && data.reactionText) {
        list.push({ emoji: data.reactionText, senderId: sender });
      }
      reactions[targetId] = list;
      notify();
    });

    socket.on('session_status', (status) => sessionStore.setStatus(status));
    socket.on('session_details', (details) => sessionStore.setDetails(details));
    socket.on('qr_code', (qrBase64) => sessionStore.setQr(qrBase64));
  };

  const connect = async (key) => {
    if (socket && apiKey === key) return;
    disconnect();
    apiKey = key || null;
    if (!apiKey) return;
    sessionStore.hydrate(apiKey);
    socket = io(SERVER_URL || window.location.origin, {
      auth: { apiKey },
      transports: ['websocket', 'polling'],
    });
    applySocketHandlers();
  };

  const disconnect = () => {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    apiKey = null;
    activeChatId = null;
    sessionStore.clear();
  };

  // The full page (Dashboard, Developer, Inbox) stays live even when the
  // inbox tab isn't open: connect once a stored key exists at app start.
  getApiKey().then(key => { if (key) connect(key); }).catch(() => {});

  return {
    connect,
    disconnect,
    setActiveChat: (chatId) => { activeChatId = chatId || null; },
    addSentMessage: (chatId, sentMsg) => {
      if (pushMessage(sentMsg, chatId)) notify();
    },
    seedMessages: (chatId, messages) => {
      if (!chatId || !Array.isArray(messages) || !messages.length) return;
      if (!chats[chatId]) chats[chatId] = { messages: [] };
      const list = chats[chatId].messages;
      let changed = false;
      for (const message of messages) {
        const key = dedupeKey(message);
        if (key && list.some(m => dedupeKey(m) === key)) continue;
        list.push(normalizeOut(message));
        changed = true;
      }
      if (changed) {
        list.sort((a, b) => (a.timestamp || a.t || 0) - (b.timestamp || b.t || 0));
        notify();
      }
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get version() { return version; },
    getChats: () => chats,
    getReactions: () => reactions,
  };
}

const liveStream = createLiveStream();

export default liveStream;