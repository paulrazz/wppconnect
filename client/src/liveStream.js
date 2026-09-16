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

  const listeners = new Set();    // global subscribers (whole-page / cross-chat UI)
  const chats = {};       // chatId -> { messages: [] }  (live messages only)
  const statuses = {};    // senderId -> [status updates] (one "status chat" per sender)
  const reactions = {};   // msgId -> [{ emoji, senderId }]
  const automationEvents = []; // recent rule executions (ran / error)
  const avatars = {};     // chatId / senderId -> profile picture dataUrl
  const chatNames = {};   // group chatId -> group subject (heals listing names)

  // Per-chat version counters + subscribers. The open conversation subscribes
  // to its OWN chat's version so a message landing in any OTHER chat (which
  // still bumps the global version for the sidebar) never re-renders the open
  // message list. This is what separates the "these specific bubbles changed"
  // signal from the "the sidebar previews may have changed" signal.
  const chatVersions = {};   // chatId -> int
  const chatListeners = new Map(); // chatId -> Set<fn>

  // Global notify: something, somewhere, changed (sidebar previews, automation
  // events, lists). Cheap; consumers opt in by reading store getters.
  const notify = () => {
    version += 1;
    listeners.forEach(fn => { try { fn(); } catch (_) {} });
  };

  // Per-chat notify: only this chat's data changed. Fires ONLY that chat's
  // subscribers - no global version bump, no whole-page render.
  const bumpChat = (id) => {
    if (!id || typeof id !== 'string') return;
    chatVersions[id] = (chatVersions[id] || 0) + 1;
    const set = chatListeners.get(id);
    if (set) set.forEach(fn => { try { fn(); } catch (_) {} });
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
    const existingIdx = key ? list.findIndex(m => dedupeKey(m) === key) : -1;
    const existing = existingIdx >= 0 ? list[existingIdx] : null;
    if (isDeletedCopy(message)) {
      // A revoke/delete echo is a stub that mirrors an earlier message. Flag the
      // original bubble (keeping its text) instead of rendering a twin. Replace
      // the object with a fresh reference so memoized bubbles see the change.
      if (existing) {
        list[existingIdx] = { ...existing, isDeleted: true, isRevoked: true, deleted: true };
        return false;
      }
    }
    if (existing) return false;
    list.push(normalizeOut(message));
    // Cap per-chat history at 400 messages to prevent unbounded memory growth
    // during long-running sessions. The oldest messages are trimmed first;
    // the API's durable inbox still holds full history on demand.
    if (list.length > 400) list.splice(0, list.length - 400);
    return true;
  };

  // Status updates arrive with `from` = "status@broadcast"; the person is the
  // `author` (or the `sender` envelope). Bucket each status under that person's
  // JID so every contact shows as its own standalone "status chat". Group
  // messages never reach this path (they land in chats), so an @g.us here
  // would mean a misbucketed story - guarded against.
  const statusSenderId = (m) => {
    const raw = m?.sender?.id?._serialized || m?.sender?.id || m?.author?._serialized || m?.author || m?.from;
    const id = typeof raw === 'string' ? raw : '';
    return id && !id.endsWith('@g.us') && id !== 'status@broadcast' ? id : '';
  };

  const pushStatus = (senderId, status) => {
    if (!senderId || !status) return false;
    if (!statuses[senderId]) statuses[senderId] = [];
    const list = statuses[senderId];
    const key = dedupeKey(status);
    const existingIdx = key ? list.findIndex(s => dedupeKey(s) === key) : -1;
    const existing = existingIdx >= 0 ? list[existingIdx] : null;
    if (isDeletedCopy(status)) {
      if (existing) {
        list[existingIdx] = { ...existing, isDeleted: true, isRevoked: true, deleted: true };
        return false;
      }
    }
    if (existing) return false;
    list.push(normalizeOut(status));
    // Newest story last, so the viewer reads oldest → newest and the sidebar
    // "lastMessage" is the freshest status.
    list.sort((a, b) => (a.timestamp || a.t || 0) - (b.timestamp || b.t || 0));
    // Cap per-sender status history at 50 entries
    if (list.length > 50) list.splice(0, list.length - 50);
    return true;
  };

  const applySocketHandlers = () => {
    socket.on('new_message', (message) => {
      const chatId = chatIdOf(message);
      // Dynamically extract names from the raw websocket payload so the UI can
      // instantly render human names even if the backend contact cache is empty.
      if (chatId && typeof chatId === 'string') {
        if (chatId.endsWith('@g.us')) {
          const groupName = message?.chatName || message?.chat?.name || message?.groupName;
          if (groupName && chatNames[chatId] !== groupName) chatNames[chatId] = groupName;
        } else {
          // Direct messages: if it's from us, the recipient's name is in chat.
          // If it's from them, they literally hand us their pushname in sender.
          const contactName = message.fromMe || message.isSentByMe 
            ? (message?.chat?.name || message?.chat?.formattedName)
            : (message?.sender?.pushname || message?.sender?.name || message?.sender?.formattedName || message?.chat?.name);
          
          if (contactName && chatNames[chatId] !== contactName) {
            chatNames[chatId] = contactName;
          }
        }
      }
      if (!chatId) return;
      const touched = [];
      if (isSelfMessage(message) && activeChatId && activeChatId !== chatId) {
        // A self-send can surface under the LID form while the sidebar uses
        // the PN form. Land it in the chat the user actually has open too.
        if (pushMessage(message, activeChatId)) touched.push(activeChatId);
      } else {
        if (pushMessage(message, chatId)) touched.push(chatId);
      }
      touched.forEach(id => bumpChat(id));
      if (touched.length) notify();
    });

    socket.on('message_reaction', (raw) => {
      // Accept both the envelope (legacy) and the normalized object (current).
      const data = raw?.data || raw;
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
      bumpChat(activeChatId);
      notify();
    });

    socket.on('message_deleted', (raw) => {
      const d = raw?.data || raw;
      const refRaw = d.referenceId || d.refId || d.msgId || d.id || d.original?.id;
      const refId = (refRaw?._serialized || refRaw?.id || refRaw || '').replace(/_out$/, '');
      if (!refId) return;
      const changedChats = new Set();
      for (const chatId of Object.keys(chats)) {
        const list = chats[chatId].messages;
        for (let i = 0; i < list.length; i++) {
          if ((msgId(list[i]) || '').replace(/_out$/, '') === refId && !list[i].isDeleted) {
            list[i] = { ...list[i], isDeleted: true, isRevoked: true, deleted: true };
            changedChats.add(chatId);
          }
        }
      }
      if (changedChats.size) {
        [...changedChats].forEach(id => bumpChat(id));
        notify();
      }
    });

    socket.on('new_status', (status) => {
      const senderId = statusSenderId(status);
      if (pushStatus(senderId, status)) {
        bumpChat(senderId); // re-render an open status chat
        notify();           // refresh the sidebar (newest status moved it)
      }
    });

    socket.on('status_deleted', (raw) => {
      const d = raw?.data || raw;
      const refRaw = d.referenceId || d.refId || d.msgId || d.id || d.original?.id;
      const refId = (refRaw?._serialized || refRaw?.id || refRaw || '').replace(/_out$/, '');
      if (!refId) return;
      const changed = new Set();
      for (const senderId of Object.keys(statuses)) {
        const list = statuses[senderId];
        for (let i = 0; i < list.length; i++) {
          if ((msgId(list[i]) || '').replace(/_out$/, '') === refId && !list[i].isDeleted) {
            list[i] = { ...list[i], isDeleted: true, isRevoked: true, deleted: true };
            changed.add(senderId);
          }
        }
      }
      if (changed.size) {
        [...changed].forEach(id => bumpChat(id));
        notify();
      }
    });

    socket.on('session_status', (status) => sessionStore.setStatus(status));
    socket.on('session_details', (details) => sessionStore.setDetails(details));
    socket.on('qr_code', (qrBase64) => sessionStore.setQr(qrBase64));

    // A background avatar fetch on the server just finished - update the
    // sidebar / header the instant it lands, with no client polling.
    socket.on('avatar_ready', ({ id, dataUrl }) => {
      if (id && dataUrl && avatars[id] !== dataUrl) {
        avatars[id] = dataUrl;
        // Cap avatars at 150 entries to prevent unbounded base64 memory growth.
        const keys = Object.keys(avatars);
        if (keys.length > 150) delete avatars[keys[0]];
        notify();
      }
    });

    socket.on('automation_event', (event) => {
      automationEvents.unshift({ ...event, receivedAt: Date.now() });
      if (automationEvents.length > 50) automationEvents.length = 50;
      notify();
    });
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
    // Clear all per-tenant in-memory data so logging out of account A and
    // into B never leaks A's messages, avatars, or status history.
    for (const k of Object.keys(chats)) delete chats[k];
    for (const k of Object.keys(statuses)) delete statuses[k];
    for (const k of Object.keys(reactions)) delete reactions[k];
    for (const k of Object.keys(avatars)) delete avatars[k];
    for (const k of Object.keys(chatNames)) delete chatNames[k];
    for (const k of Object.keys(chatVersions)) delete chatVersions[k];
    automationEvents.length = 0;
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
      if (pushMessage(sentMsg, chatId)) { bumpChat(chatId); notify(); }
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
        bumpChat(chatId);
        notify();
      }
    },
    seedStatuses: (senderId, list) => {
      if (!senderId || !Array.isArray(list) || !list.length) return;
      let changed = false;
      for (const status of list) {
        if (pushStatus(senderId, status)) changed = true;
      }
      if (changed) {
        bumpChat(senderId);
        notify();
      }
    },
    getStatuses: () => statuses,
    setAvatar: (id, dataUrl) => { if (id && dataUrl && avatars[id] !== dataUrl) { avatars[id] = dataUrl; notify(); } },
    getAvatars: () => avatars,
    // Group name map: chatId -> group subject. Used to resolve a group's
    // listing/header name without waiting on a contacts or chats round-trip.
    setChatName: (chatId, name) => {
      if (!chatId || !name) return;
      const key = typeof chatId === 'string' ? chatId : chatId?._serialized;
      if (key && !key.endsWith('@g.us')) return;
      if (key && chatNames[key] !== name) { chatNames[key] = name; notify(); }
    },
    setChatNames: (rows) => {
      let changed = false;
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = typeof row?.id === 'string' ? row.id : row?.id?._serialized;
        const name = row?.chatName || row?.name || row?.groupMetadata?.subject || row?.groupName;
        if (!id || !id.endsWith('@g.us') || !name) continue;
        if (chatNames[id] !== name) { chatNames[id] = name; changed = true; }
      }
      if (changed) notify();
    },
    getChatNames: () => chatNames,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Per-chat subscription: only re-render when THIS chat's data changes.
    // Used by the open message list to avoid re-rendering on every incoming
    // message globally (the sidebar still uses the global version to refresh
    // previews and sort order).
    subscribeChat: (chatId, fn) => {
      if (!chatListeners.has(chatId)) chatListeners.set(chatId, new Set());
      chatListeners.get(chatId).add(fn);
      return () => {
        const set = chatListeners.get(chatId);
        if (set) { set.delete(fn); if (!set.size) chatListeners.delete(chatId); }
      };
    },
    chatVersion: (chatId) => chatVersions[chatId] || 0,
    get version() { return version; },
    getChats: () => chats,
    getReactions: () => reactions,
    getAutomationEvents: () => automationEvents,
  };
}

const liveStream = createLiveStream();

export default liveStream;