import { io } from 'socket.io-client';
import { getApiKey } from './auth';

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

  const pushMessage = (message, targetId) => {
    if (!targetId) return false;
    if (!chats[targetId]) chats[targetId] = { messages: [] };
    const list = chats[targetId].messages;
    const key = dedupeKey(message);
    if (key && list.some(m => dedupeKey(m) === key)) return false;
    list.push(message);
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
      const targetId = data.msgId?._serialized || data.msgId?.id || data.msgId;
      if (!targetId) return;
      const sender = typeof data.sender === 'string' ? data.sender : (data.sender?._serialized || String(data.sender));
      const list = (reactions[targetId] || []).filter(r => (r.senderId || r.sender) !== sender);
      if (!data.orphan && data.reactionText) {
        list.push({ emoji: data.reactionText, senderId: sender });
      }
      reactions[targetId] = list;
      notify();
    });
  };

  const connect = async (key) => {
    if (socket && apiKey === key) return;
    disconnect();
    apiKey = key || null;
    if (!apiKey) return;
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