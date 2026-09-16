import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import axios from 'axios';
import { getApiKey } from '../auth';
import liveStream from '../liveStream';
import { sessionStore } from '../sessionStore';
import { safeMessageText, messagePreview, viewOnceInnerType } from '../messageText';
import { useTheme } from '../ThemeContext';
import { UserCircle, Search, MessageSquare, LoaderCircle, Lock, Reply, SmilePlus, Download, FileText, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ChatInputForm from '../components/ChatInputForm';
import EmojiPicker from '../components/EmojiPicker';
import ChatAutomationsModal from '../components/ChatAutomationsModal';
import { Zap } from 'lucide-react';

const SERVER_URL = (import.meta.env.VITE_WPPCONNECT_URL || '').replace(/\/$/, '');
const API_URL = `${SERVER_URL}/api`;

const msgId = (m) => m?.id?._serialized || m?.id?.id || (typeof m?.id === 'string' ? m.id : null);

// The chat a message belongs to, mirroring the backend emit: prefer the
// message's own chatId, then fall back to the peer (to for outgoing, from
// for incoming).
const chatIdOf = (m) => m?.chatId?._serialized || m?.chatId || (m?.fromMe ? m?.to : m?.from);

// WhatsApp self-sends echo your own wid: from === to.
const isSelfMessage = (m) => String(m?.fromMe) === 'true' && String(m?.to) === String(m?.from);

// Same outgoing message can be reported twice - once as the optimistic send
// result (id gained an "_out" suffix), once as the socket echo. Normalize for
// dedupe so we never render twin bubbles.
const dedupeKey = (m) => (msgId(m) || '').replace(/_out$/, '');

const MEDIA_TYPES = ['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document'];

// Status chats live in the sidebar as standalone entries keyed by the sender's
// JID under a reserved prefix, so they can never collide with a real 1:1 chat
// with the same person. Opening one renders the dedicated StatusViewer.
const STATUS_PREFIX = 'status:';
const statusChatId = (senderId) => `${STATUS_PREFIX}${senderId}`;
const statusSenderOf = (chatId) => (typeof chatId === 'string' && chatId.startsWith(STATUS_PREFIX) ? chatId.slice(STATUS_PREFIX.length) : null);
const isStatusChat = (chatId) => Boolean(statusSenderOf(chatId));

// Status timestamps arrive in seconds (wppconnect) but a few paths leak
// milliseconds. Normalize to whole seconds once so the sidebar + viewer render
// one consistent "disappeared x ago" style time.
const statusTime = (s) => {
  const n = Number(s?.timestamp ?? s?.t ?? 0);
  if (!n) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
};

const STATUS_TYPE_LABELS = {
  image: 'Photo', video: 'Video', gif: 'GIF', audio: 'Audio', ptt: 'Voice note',
  sticker: 'Sticker', document: 'Document', location: 'Location', live_location: 'Live location',
  vcard: 'Contact card', contact_card: 'Contact card', contacts_array: 'Contact cards',
  chat: 'Text', text: 'Text',
};

const statusTypeLabel = (s) => {
  if (s?.isDeleted || s?.isRevoked || String(s?.type || '').toLowerCase() === 'revoked') return 'Deleted';
  const type = String(s?.type || 'chat').toLowerCase();
  if (STATUS_TYPE_LABELS[type]) return STATUS_TYPE_LABELS[type];
  if (type.startsWith('poll')) return 'Poll';
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Status';
};

// The name to render as a group message's sender title. WhatsApp group bubbles
// carry `sender` (a contact object) / `author` / `pushname` / `notifyName`;
// fall back to the JID's local part so the title is never blank.
const groupSenderDisplayName = (message) => {
  const contact = message?.sender || {};
  const jidRaw = message?.author || message?.participant || (typeof message?.sender?.id === 'object' ? message.sender.id._serialized : message?.sender?.id);
  const jid = typeof jidRaw === 'string' ? jidRaw : jidRaw?._serialized || '';
  return String(
    contact.name || contact.formattedName || contact.pushname || contact.shortName
    || message?.notifyName || message?.friendName || message?.pushname
    || (jid && !jid.startsWith('@') ? jid.split('@')[0] : '')
    || ''
  ).trim();
};

// The canonical (non "_out") id - matches what WhatsApp/our API emit reactions under.
const canonicalId = (m) => (msgId(m) || '').replace(/_out$/, '');

// Client-side media blob cache. The server already caches resolved media on
// disk, but caching the final dataUrl here avoids re-transferring large blobs
// (and re-decoding) every time a bubble remounts — chat switches, back-and-
// forth navigation, and bubble re-renders. Keyed per tenant apiKey + message
// id so one account can never see another's media. Bounded FIFO/pseudo-LRU so
// memory stays flat even on very busy inboxes.
const mediaCache = new Map();    // `${apiKey}:${id}` -> { dataUrl, ... }
const mediaInflight = new Map(); // `${apiKey}:${id}` -> in-flight Promise
const MEDIA_CACHE_MAX = 300;

function cacheMediaData(cacheKey, data) {
  mediaCache.delete(cacheKey); // re-insert to refresh recency (pseudo LRU)
  mediaCache.set(cacheKey, data);
  if (mediaCache.size > MEDIA_CACHE_MAX) {
    const oldest = mediaCache.keys().next().value;
    if (oldest !== undefined) mediaCache.delete(oldest);
  }
}

function fetchMedia(id, apiKey) {
  const cacheKey = `${apiKey}:${id}`;
  if (mediaCache.has(cacheKey)) return Promise.resolve(mediaCache.get(cacheKey));
  if (!mediaInflight.has(cacheKey)) {
    mediaInflight.set(
      cacheKey,
      axios
        .get(`${API_URL}/media/${encodeURIComponent(id)}`, { headers: { 'x-api-key': apiKey } })
        .then((res) => {
          const data = res.data;
          cacheMediaData(cacheKey, data);
          return data;
        })
        .finally(() => mediaInflight.delete(cacheKey))
    );
  }
  return mediaInflight.get(cacheKey);
}

// Lazily fetches/downloads a message's media payload from the API (cached per message).
// An optional `className` merges into each media element so the StatusViewer can
// reuse the same loader while the `.status-content .message-*` CSS rules size it.
function MediaContent({ message, apiKey, theme, className = '' }) {
  const [data, setData] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const type = viewOnceInnerType(message);

  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    const id = (msgId(message) || '').replace(/_out$/, '');
    fetchMedia(id, apiKey)
      .then(data => { if (alive) setData(data); })
      .catch(err => { if (alive) setError(err?.response?.status || err?.message || 'error'); });
    return () => { alive = false; };
  }, [message, apiKey, attempts]);

  if (error) {
    return (
      <p
        className={`text-xs italic cursor-pointer ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}
        title={`Content request failed (${error}). Click to retry.`}
        onClick={() => setAttempts(a => a + 1)}
      >
        {type === 'video' || type === 'gif' ? '🎥 ' : type === 'audio' || type === 'ptt' ? '🎵 ' : type === 'sticker' ? '' : '📄 '}
        Media no longer available <span className="opacity-60">({error})</span>
      </p>
    );
  }
  if (!data?.dataUrl) return <LoaderCircle className="w-4 h-4 animate-spin opacity-50" />;

  if (type === 'image' || type === 'gif') {
    return <img src={data.dataUrl} alt={message.caption || 'Image'} className={`${className} max-h-64 rounded-lg`} />;
  }
  if (type === 'video') {
    return <video src={data.dataUrl} controls className={`${className} max-h-64 rounded-lg`} />;
  }
  if (type === 'audio' || type === 'ptt') {
    return <audio src={data.dataUrl} controls className={`${className} w-56`} />;
  }
  if (type === 'sticker') {
    return <img src={data.dataUrl} alt="Sticker" className={`${className} w-28 h-28`} />;
  }
  if (type === 'document') {
    const name = message.filename || message.fileName || 'document';
    return (
      <a href={data.dataUrl} download={name} className="flex items-center gap-2 text-xs font-semibold underline decoration-dotted">
        <FileText className="w-4 h-4" /> {name} <Download className="w-3 h-3" />
      </a>
    );
  }
  return null;
}

// A circular avatar that renders the profile picture (server-decorated or
// live `avatar_ready` push) and falls back to the UserCircle icon when there
// is none yet. `pic` is the resolved dataUrl, `size` controls the `<img>`.
function ChatAvatar({ pic, size = 32, theme }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [pic]);
  if (pic && !broken) {
    return (
      <img
        src={pic}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return <UserCircle style={{ width: size, height: size }} className={`shrink-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />;
}

function MessageBubble({ message, theme, apiKey, reactions = [], onReply, onReact, activeChatId }) {
  const [showReactions, setShowReactions] = useState(false);
  const type = viewOnceInnerType(message);
  const isMe = message.fromMe || message.isSentByMe || message.isSendByMe;
  const isMedia = MEDIA_TYPES.includes(type);
  const isDeleted = message.isDeleted || message.isRevoked || type === 'revoked';
  // Group messages show the SENDER as a small title above the bubble (like
  // WhatsApp). This never touches the sidebar listing name - the chat list
  // keeps the group's own name; the sender label lives in the chat view only.
  const isGroupChat = message.isGroupMsg === true || message.isGroup === true
    || (typeof activeChatId === 'string' && activeChatId.endsWith('@g.us'));
  const senderTitle = isGroupChat ? groupSenderDisplayName(message) : '';

  const quote = (() => {
    const q = message.quotedMsgObj || message.quotedMsg || (message.quotedMsgObj?.value);
    if (!q) return null;
    const text = safeMessageText(q);
    if (!text && !q.filename) return null;
    const who = q.fromMe ? 'You' : (q.senderName || q.notifyName || q.author || q.pushname || (typeof q.from === 'string' ? q.from.split('@')[0] : 'Contact'));
    return { who, text, hasMedia: MEDIA_TYPES.includes(viewOnceInnerType(q)) };
  })();

  const rawType = String((message && message.type) || 'chat').toLowerCase();
  const isViewOnce = rawType === 'viewonce' || rawType === 'view_once' || rawType === 'viewoncemessage' || Boolean(message?.viewOnceMessage);
  
  let text = safeMessageText(message);
  if (isViewOnce) {
    text = text ? `⏳ ${text}` : '⏳';
  }

  const location = message.location || {};
  const lat = message.lat ?? location.latitude ?? location.lat;
  const lng = message.lng ?? location.longitude ?? location.lng;
  const isLocation = type.includes('location') || (lat != null && lng != null);
  const isContact = type === 'vcard' || type === 'contact' || type === 'contact_card';

  return (
    <div className={`relative flex flex-col max-w-[78%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
      {!isMe && senderTitle && (
        <p className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 px-1 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
          {senderTitle}
        </p>
      )}
      <div className={`px-3 py-2.5 rounded-2xl ${isMe ? 'bg-indigo-600 text-white rounded-tr-sm shadow-indigo-500/20' : (theme === 'dark' ? 'bg-[#1e222b] text-slate-200 rounded-tl-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm')} shadow-sm w-fit max-w-full min-w-[2rem]`}>
        {quote && (
          <div className={`mb-2 px-3 py-2 rounded-lg border-l-4 text-xs ${isMe ? 'bg-indigo-500/30 border-indigo-300' : (theme === 'dark' ? 'bg-black/30 border-slate-500' : 'bg-slate-100 border-slate-400')}`}>
            <p className={`font-semibold mb-0.5 ${isMe ? 'text-indigo-100' : theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{quote.who}</p>
            <p className={`italic ${isMe ? 'text-indigo-100' : theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
              {quote.hasMedia ? '📎 ' : ''}{quote.text || 'Media'}
            </p>
          </div>
        )}

        {isMedia ? (
          <>
            <MediaContent message={message} apiKey={apiKey} theme={theme} />
            {text && <p className="text-sm whitespace-pre-wrap break-words mt-1.5">{isDeleted && <span className="mr-1">🚫</span>}{text}</p>}
          </>
        ) : isLocation ? (
          <a
            className="flex items-center gap-2 text-sm font-semibold underline"
            href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer"
          >
            <MapPin className="w-4 h-4" /> {isDeleted && <span>🚫</span>} Location {text ? `· ${text}` : ''}
          </a>
        ) : isContact ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="text-base">👤</span> {message.vcardFormattedName || message.contactFormattedName || message.contactName || (type === 'vcard' && message.vcard ? 'Contact card' : text || 'Contact card')}
          </p>
        ) : text ? (
          <p className="text-sm whitespace-pre-wrap break-words">{isDeleted && <span className="mr-1">🚫</span>}{text}</p>
        ) : isDeleted ? (
          <p className="text-sm">🚫</p>
        ) : (
          <p className="text-sm italic opacity-80">{type === 'chat' || type === 'revoked' ? '…' : `[${type.replaceAll('_', ' ')}]`}</p>
        )}
      </div>

      {reactions.length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? '' : ''}`}>
          {reactions.map((r, i) => (
            <span key={i} className={`text-xs px-2 py-0.5 rounded-full border ${theme === 'dark' ? 'bg-[#12151a] border-[#262931] text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}>
              {r.emoji}
            </span>
          ))}
        </div>
      )}

      <div className={`flex items-center gap-2 mt-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
        <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
          {new Date((message.timestamp || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {onReply && (
          <button onClick={() => onReply(message)} title="Reply"
            className={`p-1 rounded ${theme === 'dark' ? 'text-slate-500 hover:text-indigo-400' : 'text-slate-400 hover:text-indigo-600'}`}>
            <Reply className="w-3 h-3" />
          </button>
        )}
        {onReact && (
          <button onClick={() => setShowReactions(v => !v)} title="React"
            className={`relative p-1 rounded ${theme === 'dark' ? 'text-slate-500 hover:text-indigo-400' : 'text-slate-400 hover:text-indigo-600'}`}>
            <SmilePlus className="w-3 h-3" />
          </button>
        )}
      </div>

      {showReactions && onReact && (
        <div className={`absolute z-20 bottom-9 w-64 ${isMe ? 'right-0' : 'left-0'}`}>
          <EmojiPicker
            theme={theme}
            onSelect={(emo) => { onReact(message, emo); setShowReactions(false); }}
          />
        </div>
      )}
    </div>
  );
}

// The open conversation's message list - isolated in its own component that
// subscribes ONLY to THIS chat's version. A message arriving in any other chat
// bumps the global version (the sidebar needs it to refresh previews/sort) but
// never re-renders this list. The parent passes stable props (setReplyTo is a
// React setter, sendReaction/loadEarlier are useCallbacks) so React bails out
// of re-rendering the whole pod tree on unrelated parent renders.
function ActiveChatMessages({ chatId, apiKey, theme, hasMore, loadingEarlier, onLoadEarlier, onReply, onReact }) {
  const chatVersion = useSyncExternalStore(
    (cb) => liveStream.subscribeChat(chatId, cb),
    () => liveStream.chatVersion(chatId)
  );
  void chatVersion;
  const messages = liveStream.getChats()[chatId]?.messages || [];
  const liveReactions = liveStream.getReactions();

  const scrollBoxRef = useRef(null);
  const messagesEndRef = useRef(null);
  const nearBottomRef = useRef(true);
  const lastMsgIdRef = useRef({});   // chatId -> newest live message id seen
  const lastSmoothAtRef = useRef(0); // debounce competing smooth-scroll calls

  // Track whether the user is reading near the latest message. When they have
  // scrolled up to read history, new messages must never yank them back down.
  const handleScroll = () => {
    const el = scrollBoxRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Jump to the latest message whenever this chat is (re)opened. The parent
  // keys the component by chatId, so this mounts fresh per chat switch.
  useEffect(() => {
    lastMsgIdRef.current[chatId] = null;
    nearBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [chatId]);

  // Follow new messages while the user is near the bottom. Comparing the
  // newest message id - not length - means loading earlier history (which
  // prepends) and reaction/delete updates never trigger a jump. A burst of
  // messages coalesces: the first gets a smooth animation, subsequent ones
  // snap instantly (behavior 'auto') so overlapping smooth-scroll animations
  // never fight each other in the browser.
  useEffect(() => {
    const newest = messages[messages.length - 1];
    const newestId = newest ? msgId(newest) : null;
    const previous = lastMsgIdRef.current[chatId] ?? null;
    lastMsgIdRef.current[chatId] = newestId ?? previous;
    if (!newestId || newestId === previous || !nearBottomRef.current) return;
    const now = Date.now();
    const behavior = now - lastSmoothAtRef.current > 300 ? 'smooth' : 'auto';
    lastSmoothAtRef.current = now;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [chatVersion, chatId, messages]);

  if (!messages.length) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center text-center p-8 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
        <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No messages recorded yet</p>
        <p className="text-xs mt-1">Messages will appear here permanently once your device starts receiving.</p>
      </div>
    );
  }

  return (
    <div ref={scrollBoxRef} onScroll={handleScroll} className={`flex-1 overflow-y-auto p-3 sm:p-6 flex flex-col gap-4 ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-slate-50'}`}>
      {hasMore && (
        <button
          onClick={() => onLoadEarlier(chatId)}
          disabled={loadingEarlier}
          className={`self-center text-xs font-semibold px-3 py-1.5 rounded-full border transition ${loadingEarlier ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-50'} ${theme === 'dark' ? 'text-indigo-400 border-indigo-500/30' : 'text-indigo-600 border-indigo-300'}`}
        >
          {loadingEarlier ? 'Loading...' : 'Load earlier messages'}
        </button>
      )}
      {messages.map((msg, idx) => {
        const live = liveReactions[canonicalId(msg)] || [];
        const stored = msg._reactions || [];
        const merged = [...live, ...stored.filter(s => !live.some(l => l.senderId === s.senderId && l.emoji === s.emoji))];
        return (
          <MessageBubble
            key={msgId(msg) || idx}
            message={msg}
            theme={theme}
            apiKey={apiKey}
            reactions={merged}
            onReply={onReply}
            onReact={onReact}
            activeChatId={chatId}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}

// A single status/story: media, caption/text, and the time + type footer.
// Reuses the message text/media helpers and the sidebar CSS scaffold
// (.status-content / .message-* / .status-meta) so statuses render like the
// real WhatsApp story screen instead of chat bubbles.
function StatusItem({ status, apiKey, theme }) {
  const type = String(status.type || 'chat').toLowerCase();
  const isMedia = MEDIA_TYPES.includes(type);
  const textOnly = type === 'chat' || type === 'text' || type === 'revoked';
  const caption = status.caption || status.text || '';
  const text = safeMessageText(status);
  const deleted = status.isDeleted || status.isRevoked || type === 'revoked';
  const at = statusTime(status);

  const meta = `${statusTypeLabel(status)}${deleted ? ' · deleted' : ''}${at ? ` · ${new Date(at * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`;

  return (
    <section className="message-content-status">
      {deleted && <p className="text-xs text-red-400/90 italic mb-2">🚫 This status was deleted by its author</p>}
      {isMedia ? (
        <MediaContent
          message={status}
          apiKey={apiKey}
          theme={theme}
          className={type === 'sticker' ? 'message-sticker' : type === 'video' || type === 'gif' ? 'message-video' : 'message-image'}
        />
      ) : null}
      {!isMedia && textOnly && text ? <p className="message-text">{text}</p> : null}
      {isMedia && caption ? <p className="message-caption">{caption}</p> : null}
      {!isMedia && !textOnly && text ? <p className="message-text">{text}</p> : null}
      <p className="status-meta">{meta}</p>
    </section>
  );
}

// The open status "chat": every story a contact posted, oldest → newest, with
// robust caption / time / type rendering. Subscribes only to that sender's
// bucket (bumpChat from liveStream) so a new status streams straight in.
function StatusViewer({ senderId, apiKey, theme }) {
  const version = useSyncExternalStore(
    (cb) => liveStream.subscribeChat(senderId, cb),
    () => liveStream.chatVersion(senderId)
  );
  void version;
  const list = liveStream.getStatuses()[senderId] || [];

  if (!list.length) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center text-center p-8 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
        <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No statuses yet</p>
        <p className="text-xs mt-1">New stories from this contact will appear here the moment they post.</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-black'} status-content`}>
      {list.map((s, idx) => (
        <StatusItem key={msgId(s) || `status-${idx}`} status={s} apiKey={apiKey} theme={theme} />
      ))}
    </div>
  );
}

export default function LiveInbox() {
  const { theme } = useTheme();
  const navigate = useNavigate();

  const [apiKey, setApiKey] = useState('');
  const [contacts, setContacts] = useState({});
  const [apiChats, setApiChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [listsLoading, setListsLoading] = useState(false);
  const [inboxSince, setInboxSince] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [earlier, setEarlier] = useState({});
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const loadingHistoryRef = useRef(null);
  const listLoadedRef = useRef(false);
  const searchTimerRef = useRef(null);

  // Session status lives in the shared store (fed by the always-on socket and
  // cached in localStorage), so this page renders instantly on navigation.
  const sessionVersion = useSyncExternalStore(
    (cb) => sessionStore.subscribe(cb),
    () => sessionStore.version
  );
  void sessionVersion;
  const sessionStatus = sessionStore.getState().status;

  // The live stream lives at the app level (connected even while on another
  // page), so every incoming chat is captured here regardless of navigation.
  const liveVersion = useSyncExternalStore(
    (cb) => liveStream.subscribe(cb),
    () => liveStream.version
  );
  void liveVersion;
  const liveChats = liveStream.getChats();

  // Profile pictures are filled server-side (cache-first + background fetch)
  // and pushed live the moment a miss resolves. One map covers all chat &
  // status rows, keyed by the raw chatId / senderId.
  const avatars = liveStream.getAvatars();

  const CHATS_CACHE_KEY = (key) => `wpp.chats.${key}`;
  const readCachedChats = (key) => {
    try {
      const raw = localStorage.getItem(CHATS_CACHE_KEY(key));
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (Date.now() - saved.at > 30000) return null;
      return saved.chats;
    } catch (_) { return null; }
  };

  const fetchChatList = useCallback(async (key) => {
    // Show the last known list immediately if it's recent enough, then refresh.
    const cached = readCachedChats(key);
    if (cached && cached.length) setApiChats(cached);
    const mapChat = (c) => {
      const rawId = c.id?._serialized || c.id;
      const id = typeof rawId === 'string' ? rawId : String(rawId || '');
      return {
        id,
        displayName: c.displayName || (id.split('@')[0] || id),
        chatName: c.chatName || c.name || c.groupMetadata?.subject || null,
        lastMessage: c.lastMessage || null,
        contact: c.contact || null,
        profilePic: c.profilePic || null,
      };
    };
    try {
      // The durable inbox is the source of truth: every chat recorded since the
      // user first signed in, still available even if WhatsApp is disconnected.
      // A fresh/partial baseline must never hide chats, so the live list (same
      // canonical ids) is always merged in too - filling gaps and replacing
      // id-fallback display names with real contact names.
      const [inboxRes, liveRes] = await Promise.allSettled([
        axios.get(`${API_URL}/inbox`, { headers: { 'x-api-key': key } }),
        axios.get(`${API_URL}/chats`, { headers: { 'x-api-key': key } }),
      ]);
      const inboxChats = inboxRes.status === 'fulfilled' && Array.isArray(inboxRes.value.data?.chats) ? inboxRes.value.data.chats : [];
      const liveChats = liveRes.status === 'fulfilled' && Array.isArray(liveRes.value.data?.chats) ? liveRes.value.data.chats : [];
      // Feed the group-name map from both sources so the sidebar resolves a
      // group by its real subject, not a bare number or a sender name.
      liveStream.setChatNames(inboxChats);
      liveStream.setChatNames(liveChats);
      if (inboxRes.status === 'fulfilled' && inboxRes.value.data?.startedAt) setInboxSince(inboxRes.value.data.startedAt);
      const merged = new Map();
      inboxChats.forEach(c => { const m = mapChat(c); if (m.id) merged.set(m.id, m); });
      liveChats.forEach(c => {
        const m = mapChat(c);
        if (!m.id) return;
        const existing = merged.get(m.id);
        if (!existing) { merged.set(m.id, m); return; }
        if (m.displayName && m.displayName !== (id.split('@')[0] || id)) existing.displayName = m.displayName;
      });
      const mapped = [...merged.values()].filter(c => c.id);
      // Seed the live avatar map with the already-decorated profile pictures
      // so the chat header (keyed by chatId) resolves a face immediately too.
      for (const chat of mapped) {
        if (chat.profilePic) liveStream.setAvatar(chat.id, chat.profilePic);
      }
      setApiChats(mapped);
      try { localStorage.setItem(CHATS_CACHE_KEY(key), JSON.stringify({ chats: mapped, at: Date.now() })); } catch (_) {}
    } catch (err) {
      console.error("Failed to load chat list", err);
    }
  }, []);

  const fetchContacts = useCallback(async (key) => {
    try {
      const res = await axios.get(`${API_URL}/contacts`, { headers: { 'x-api-key': key } });
      const contactMap = {};
      res.data.contacts.forEach(c => { contactMap[c.id._serialized] = c; });
      setContacts(contactMap);
    } catch (err) {
      console.error("Failed to load contacts", err);
    }
  }, []);

  // Seed the live status buckets from the server's status history (live
  // WhatsApp story store + anything captured since the session started).
  // Deduped server-side? No - dedup lives in seedStatuses, so re-running this
  // (periodic refresh, opening a status chat) is always safe.
  const loadStatusHistory = useCallback(async (key) => {
    try {
      const res = await axios.get(`${API_URL}/stories`, { headers: { 'x-api-key': key } });
      const grouped = res.data;
      if (!grouped || typeof grouped !== 'object') return;
      // The server attaches __profiles (senderId → dataUrl) alongside the
      // regular grouped payloads so status feeds carry faces immediately.
      const profiles = grouped?.__profiles;
      if (profiles && typeof profiles === 'object') {
        for (const senderId of Object.keys(profiles)) {
          if (profiles[senderId]) liveStream.setAvatar(senderId, profiles[senderId]);
        }
      }
      for (const senderId of Object.keys(grouped)) {
        if (senderId === '__profiles') continue;
        const list = Array.isArray(grouped[senderId]) ? grouped[senderId] : [];
        if (list.length) liveStream.seedStatuses(senderId, list);
      }
    } catch (err) {
      console.error("Failed to load status history", err);
    }
  }, []);

  const loadLists = useCallback(async (key) => {
    if (listLoadedRef.current) return;
    listLoadedRef.current = true;
    setListsLoading(true);
    await Promise.all([fetchChatList(key), fetchContacts(key), loadStatusHistory(key)]);
    setListsLoading(false);
  }, [fetchChatList, fetchContacts, loadStatusHistory]);

  // Statuses expire and new ones appear while the page is open; the socket
  // streams new ones, but this periodic refresh keeps history + deletions in
  // sync without depending on the socket being connected.
  useEffect(() => {
    if (sessionStatus !== 'CONNECTED' || !apiKey) return undefined;
    const timer = setInterval(() => { void loadStatusHistory(apiKey); }, 60000);
    return () => clearInterval(timer);
  }, [sessionStatus, apiKey, loadStatusHistory]);

  useEffect(() => {
    let cancelled = false;
    getApiKey().then(key => {
      if (cancelled) return;
      setApiKey(key);
      if (!key) return;
      if (sessionStore.getState().status === 'CONNECTED') loadLists(key);
    });
    return () => { cancelled = true; };
  }, [loadLists]);

  // When the session (re)connects, load the sidebar lists if not loaded yet.
  useEffect(() => {
    if (sessionStatus === 'CONNECTED' && apiKey && !listLoadedRef.current) loadLists(apiKey);
  }, [sessionStatus, apiKey, loadLists]);

  // Unbind the store's "chat in view" hint when leaving the page so self-sends
  // route back to their canonical chatId bucket.
  useEffect(() => () => liveStream.setActiveChat(null), []);

  const openChat = (chatId) => {
    setActiveChatId(chatId);
    setReplyTo(null);
    liveStream.setActiveChat(chatId);
    // When opening from search, ensure the sidebar tab matches the result type
    // so the active row stays visible.
    setSidebarTab(isStatusChat(chatId) ? 'status' : 'chats');
    if (isStatusChat(chatId)) {
      // A status "chat" is the contact's story feed. If the live bucket is
      // still empty on open, pull it from the server's status history.
      const senderId = statusSenderOf(chatId);
      if (!liveStream.getStatuses()[senderId]?.length) loadStatusHistory(apiKey);
      return;
    }
    // History on demand: if this chat has no live bucket yet, pull the newest
    // real messages so anything visible in the subtitle is also readable in the
    // box (in full, including deleted messages that WhatsApp still holds).
    if (!liveStream.getChats()[chatId]?.messages?.length) loadSeededHistory(chatId);
  };

  const loadSeededHistory = async (chatId) => {
    if (loadingHistoryRef.current === chatId) return;
    loadingHistoryRef.current = chatId;
    try {
      // Durable history since sign-in (no pre-login backfill, no WhatsApp
      // round-trip). It already carries deleted originals + reactions.
      const res = await axios.get(`${API_URL}/inbox/${encodeURIComponent(chatId)}/messages?count=50`, { headers: { 'x-api-key': apiKey } });
      const stored = Array.isArray(res.data?.messages) ? res.data.messages : [];
      liveStream.seedMessages(chatId, stored);
      setEarlier(prev => ({ ...prev, [chatId]: { cursor: res.data?.cursor || null, hasMore: Boolean(res.data?.hasMore) } }));
      if (stored.length) return;
      // Nothing recorded for this chat yet - surface the sidebar preview so the
      // message visible in the subtitle is readable here too (incl. the
      // recovered text of a deleted message).
      const preview = apiChats.find(c => c.id === chatId)?.lastMessage;
      if (preview?.previewText || preview?.body) {
        // Strip the leading 🚫 marker so the bubble prefix isn't doubled - the
        // bubble itself renders 🚫 + full text for deleted messages.
        const rawText = (preview.body || preview.previewText || '').replace(/^\s*🚫\s*/, '');
        liveStream.seedMessages(chatId, [{
          id: preview.id,
          body: rawText,
          previewText: rawText,
          type: preview.type || 'chat',
          timestamp: preview.timestamp || Math.floor(Date.now() / 1000),
          fromMe: Boolean(preview.fromMe),
          isDeleted: Boolean(preview.deleted),
          isRevoked: Boolean(preview.deleted),
          deleted: Boolean(preview.deleted),
        }]);
      }
    } catch (err) {
      console.error("Failed to load chat history", err);
    } finally {
      loadingHistoryRef.current = null;
    }
  };

  const loadEarlier = useCallback(async (chatId) => {
    const state = earlier[chatId];
    if (!state?.hasMore || !state.cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const res = await axios.get(`${API_URL}/inbox/${encodeURIComponent(chatId)}/messages?count=50&before=${encodeURIComponent(state.cursor)}`, { headers: { 'x-api-key': apiKey } });
      const older = Array.isArray(res.data?.messages) ? res.data.messages : [];
      liveStream.seedMessages(chatId, older);
      setEarlier(prev => ({ ...prev, [chatId]: { cursor: res.data?.cursor || null, hasMore: Boolean(res.data?.hasMore) } }));
    } catch (err) {
      console.error("Failed to load earlier messages", err);
    } finally {
      setLoadingEarlier(false);
    }
  }, [earlier, loadingEarlier, apiKey]);

  const runSearch = useCallback((key, query) => {
    clearTimeout(searchTimerRef.current);
    if (!query || !query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/inbox/search?q=${encodeURIComponent(query.trim())}`, { headers: { 'x-api-key': key } });
        setSearchResults(Array.isArray(res.data?.results) ? res.data.results : []);
      } catch (err) {
        console.error("Search failed", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, []);

  const onMessageSent = useCallback((sentMsg) => {
    liveStream.addSentMessage(activeChatId, sentMsg);
  }, [activeChatId]);

  const sendReaction = useCallback(async (message, emoji) => {
    try {
      await axios.post(`${API_URL}/send-reaction`,
        { messageId: canonicalId(message), reaction: emoji },
        { headers: { 'x-api-key': apiKey } });
    } catch (err) {
      console.error("Failed to send reaction", err);
    }
  }, [apiKey]);

  const resolveName = (chatId) => {
    if (!chatId) return 'Unknown';
    const names = liveStream.getChatNames();
    if (names[chatId]) return names[chatId];
    // Phone-book saved name always preferred; formattedName carries the real
    // phone number for unsaved contacts (never the WA profile pushname).
    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.formattedName) return contacts[chatId].formattedName;
    return chatId.split('@')[0];
  };

  // Merge API chat list (with last-message subtitles) + live chats into one
  // sorted sidebar, then append a "status chat" per contact with stories so
  // each shows up as its own standalone conversation. Memoized so pure
  // local-state churn (typing in search, toggling a reply, sending) does not
  // rebuild + sort the whole list every render; it recomputes on the live
  // version bump and list/contact changes.
  const sidebar = useMemo(() => {
    const map = {};
    const names = liveStream.getChatNames();
    apiChats.forEach(c => {
      const displayName = c.chatName || (names[c.id] || c.displayName);
      map[c.id] = { ...c, displayName, isStatus: false, profilePic: c.profilePic || avatars[c.id] || null };
    });
    Object.entries(liveChats).forEach(([chatId, { messages }]) => {
      const last = messages[messages.length - 1];
      if (!map[chatId]) map[chatId] = { id: chatId, displayName: resolveName(chatId), lastMessage: null, contact: null, isStatus: false, profilePic: avatars[chatId] || null };
      if (last) map[chatId] = { ...map[chatId], lastMessage: { ...last, timestamp: last.timestamp || 0 } };
    });
    const allStatuses = liveStream.getStatuses();
    for (const senderId of Object.keys(allStatuses)) {
      const list = allStatuses[senderId] || [];
      const newest = list[list.length - 1];
      if (!newest) continue;
      const contact = contacts[senderId] || {};
      const senderInfo = newest.sender || {};
      const displayName = contact.name || contact.pushname || senderInfo.name || senderInfo.formattedName || senderInfo.pushname || newest.notifyName || senderId.split('@')[0];
      map[statusChatId(senderId)] = {
        id: statusChatId(senderId),
        displayName,
        contact: null,
        isStatus: true,
        profilePic: avatars[senderId] || null,
        senderId,
        lastMessage: { ...newest, timestamp: statusTime(newest), previewText: messagePreview({ ...newest, timestamp: statusTime(newest) }) },
      };
    }
    return Object.values(map).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  }, [apiChats, liveChats, liveVersion, contacts, avatars]);
  const [sidebarTab, setSidebarTab] = useState('chats');
  const chatRows = useMemo(() => sidebar.filter(c => !c.isStatus), [sidebar]);
  const statusRows = useMemo(() => sidebar.filter(c => c.isStatus), [sidebar]);
  const activeRows = sidebarTab === 'status' ? statusRows : chatRows;
  const sidebarCount = sidebarTab === 'status' ? statusRows.length : chatRows.length;

  if (sessionStatus !== 'CONNECTED') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-6 text-center ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-slate-50'}`}>
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-2xl ${theme === 'dark' ? 'bg-[#12151a] border border-[#1e222b] text-slate-500' : 'bg-white border border-slate-200 text-slate-400'}`}>
          <Lock className="w-10 h-10" />
        </div>
        <h1 className={`text-3xl font-extrabold tracking-tight mb-4 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
          Inbox Locked
        </h1>
        <p className={`max-w-md mb-8 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
          Your secure inbox requires an active WhatsApp connection. Please connect your device to start streaming live messages.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 transition-all"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex overflow-hidden ${theme === 'dark' ? 'bg-[#0a0c10]' : 'bg-white'}`}>

      {/* Left Sidebar: Chat List */}
      <div className={`w-full md:w-80 lg:w-96 flex flex-col shrink-0 border-r ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-slate-50'} ${activeChatId ? 'hidden md:flex' : 'flex'}`}>

        {/* Header */}
        <div className={`h-16 flex items-center px-4 shrink-0 border-b ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          <div className="min-w-0">
            <h2 className={`text-lg font-bold leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Live Inbox</h2>
            <p className={`text-[10px] font-medium truncate ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
              {inboxSince ? `Saved since ${new Date(inboxSince).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Your saved inbox'}
            </p>
          </div>
          <span className="ml-auto text-xs font-semibold bg-indigo-500/10 text-indigo-500 px-2 py-1 rounded-full border border-indigo-500/20 shrink-0">
            {sidebarCount} {sidebarTab === 'status' ? 'statuses' : 'chats'}
          </span>
        </div>

        {/* Tabs: Chats vs Status. Statuses live in their own feed so the chat
            list stays focused on conversations. */}
        <div className={`flex gap-1 px-4 pt-3 border-b shrink-0 ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'}`}>
          {[
            { id: 'chats', label: 'Chats' },
            { id: 'status', label: 'Status', count: statusRows.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSidebarTab(tab.id)}
              className={`flex-1 px-3 py-2 rounded-t-lg text-sm font-semibold transition-colors ${sidebarTab === tab.id
                ? (tab.id === 'status' ? (theme === 'dark' ? 'bg-emerald-500/10 text-emerald-400 border-b-2 border-emerald-500' : 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-500') : (theme === 'dark' ? 'bg-[#16191f] text-indigo-400 border-b-2 border-indigo-500' : 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'))
                : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600')}`}
            >
              {tab.label}
              {tab.label === 'Status' && statusRows.length > 0 && (
                <span className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full align-middle ${theme === 'dark' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className={`p-4 border-b ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-200'} relative`}>
          <div className="relative">
            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); runSearch(apiKey, e.target.value); }}
              placeholder="Search your inbox..."
              className={`w-full pl-9 pr-4 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${theme === 'dark' ? 'bg-[#16191f] border-[#1e222b] text-slate-200 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-700 placeholder-slate-400'}`}
            />
            {searching && <LoaderCircle className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400" />}
          </div>
          {searchQuery.trim() && !searching && (
            <div className={`mt-2 max-h-72 overflow-y-auto rounded-lg border shadow-xl ${theme === 'dark' ? 'bg-[#12151a] border-[#262931]' : 'bg-white border-slate-200'}`}>
              {searchResults.length === 0 ? (
                <p className={`px-3 py-3 text-xs ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>No messages match “{searchQuery.trim()}”.</p>
              ) : searchResults.map((r, i) => {
                const resultIsStatus = isStatusChat(r.chatId);
                if (sidebarTab === 'status' && !resultIsStatus) return null;
                if (sidebarTab === 'chats' && resultIsStatus) return null;
                return (
                <button
                  key={`${r.chatId}-${r.message?.id || i}`}
                  onClick={() => { openChat(r.chatId); if (resultIsStatus) setSidebarTab('status'); setSearchQuery(''); setSearchResults([]); }}
                  className={`w-full text-left px-3 py-2 border-b last:border-0 ${theme === 'dark' ? 'border-[#1e222b] hover:bg-[#1c2028]' : 'border-slate-100 hover:bg-slate-50'}`}
                >
                  <p className={`text-xs font-semibold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>{r.displayName}</p>
                  <p className={`text-xs truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>{r.message?.previewText || r.message?.body}</p>
                </button>
              );
              })}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {activeRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              {listsLoading ? (
                <>
                  <LoaderCircle className={`w-12 h-12 mb-4 animate-spin opacity-50 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`} />
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Loading conversations...</p>
                </>
              ) : sidebarTab === 'status' ? (
                <>
                  <span className="text-4xl mb-4 opacity-60">📷</span>
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>No statuses yet</p>
                  <p className={`text-xs mt-2 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Stories your contacts post will appear here the moment they publish.</p>
                </>
              ) : (
                <>
                  <MessageSquare className={`w-12 h-12 mb-4 opacity-50 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-300'}`} />
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>No chats recorded yet</p>
                  <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Conversations will appear here permanently once your device starts receiving messages.</p>
                </>
              )}
            </div>
          ) : (
            activeRows.map(chat => {
                const lastMsg = chat.lastMessage;
                const preview = lastMsg?.previewText || messagePreview(lastMsg) || '';
                const isActive = activeChatId === chat.id;
                const hasLive = Boolean(liveChats[chat.id]?.messages?.length);
                const pic = chat.profilePic || (chat.senderId && avatars[chat.senderId]) || null;

                return (
                  <button
                    key={chat.id}
                    onClick={() => openChat(chat.id)}
                    className={`w-full flex items-center p-4 border-b text-left transition-colors ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-100'} ${isActive ? (theme === 'dark' ? 'bg-[#1c2028]' : 'bg-indigo-50') : (theme === 'dark' ? 'hover:bg-[#16191f]' : 'hover:bg-slate-100')}`}
                  >
                    <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 mr-4 overflow-hidden">
                      {chat.isStatus ? (
                        pic
                          ? <img src={pic} alt="" className="w-12 h-12 rounded-full object-cover" />
                          : <span className={`w-12 h-12 rounded-full flex items-center justify-center ${theme === 'dark' ? 'bg-emerald-500/10' : 'bg-emerald-100'}`}><span className={`text-lg ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>📷</span></span>
                      ) : (
                        pic
                          ? <img src={pic} alt="" className="w-12 h-12 rounded-full object-cover" />
                          : <span className={`w-12 h-12 rounded-full flex items-center justify-center ${theme === 'dark' ? 'bg-[#262931]' : 'bg-slate-200'}`}><UserCircle className="w-8 h-8 text-slate-400 dark:text-slate-500" /></span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <h3 className={`font-semibold text-sm truncate pr-2 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{chat.displayName && !chat.displayName.includes('@') ? chat.displayName : (resolveName(statusSenderOf(chat.id) || chat.id))}</h3>
                        <span className={`text-[10px] shrink-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                          {chat.isStatus ? (lastMsg?.timestamp ? new Date(lastMsg.timestamp * 1000).toLocaleTimeString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') : (lastMsg?.timestamp ? new Date(lastMsg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (hasLive ? 'Live' : ''))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                          {lastMsg?.fromMe && !chat.isStatus ? 'You: ' : ''}{chat.isStatus ? `Status · ${preview || 'New story'}` : (preview || (hasLive ? 'Waiting for new messages...' : ''))}
                        </p>
                        {chat.isStatus
                          ? <span className={`text-[9px] shrink-0 font-bold uppercase tracking-wide ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>story</span>
                          : (hasLive && <span className={`text-[9px] shrink-0 font-bold uppercase tracking-wide ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>live</span>)}
    </div>
  </div>
                  </button>
                );
              })
          )}
        </div>
      </div>

      {/* Right Content: Active Chat */}
      <div className={`flex-1 flex flex-col min-w-0 ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
        {!activeChatId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-xl ${theme === 'dark' ? 'bg-[#12151a] border border-[#1e222b] text-indigo-500/30' : 'bg-white border border-slate-200 text-indigo-300'}`}>
              <MessageSquare className="w-10 h-10" />
            </div>
            <h2 className={`text-2xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>CommNexus Live Inbox</h2>
            <p className={`max-w-md text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
              Every conversation is saved the moment your device connects. Pick one to keep streaming it live.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className={`h-16 flex items-center px-3 sm:px-6 shrink-0 border-b shadow-sm z-10 ${theme === 'dark' ? 'border-[#1e222b] bg-[#0d1015]' : 'border-slate-200 bg-white'}`}>
              <button onClick={() => { setActiveChatId(null); setReplyTo(null); liveStream.setActiveChat(null); }} aria-label="Back to chats" className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center -ml-2 mr-1 text-slate-500 active:bg-slate-200/60 dark:active:bg-[#16191f]">
                &larr;
              </button>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center mr-3 overflow-hidden shrink-0 ${isStatusChat(activeChatId) ? (theme === 'dark' ? 'bg-emerald-500/10' : 'bg-emerald-100') : (theme === 'dark' ? 'bg-[#1e222b]' : 'bg-slate-100')}`}>
                {isStatusChat(activeChatId)
                  ? (avatars[statusSenderOf(activeChatId)]
                    ? <img src={avatars[statusSenderOf(activeChatId)]} alt="" className="w-9 h-9 rounded-full object-cover" />
                    : <span className={`text-base ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>📷</span>)
                  : <ChatAvatar pic={avatars[activeChatId]} size={36} theme={theme} />}
              </div>
              <div className="min-w-0">
                <h2 className={`font-bold text-lg truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
                  {isStatusChat(activeChatId) ? (resolveName(statusSenderOf(activeChatId)) || 'Status') : resolveName(activeChatId)}
                </h2>
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${isStatusChat(activeChatId) ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600')}`}>
                  {isStatusChat(activeChatId) ? 'Status updates' : 'Saved · live'}
                </p>
              </div>
              {!isStatusChat(activeChatId) && (
                <button
                  onClick={() => setAutomationsOpen(true)}
                  title="Automations for this chat"
                  className={`ml-auto p-2 rounded-xl transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-amber-400/10' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`}
                >
                  <Zap className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Chat Messages / Status Viewer */}
            {isStatusChat(activeChatId) ? (
              <StatusViewer
                key={activeChatId}
                senderId={statusSenderOf(activeChatId)}
                apiKey={apiKey}
                theme={theme}
              />
            ) : (
              <>
                <ActiveChatMessages
                  key={activeChatId}
                  chatId={activeChatId}
                  apiKey={apiKey}
                  theme={theme}
                  hasMore={Boolean(earlier[activeChatId]?.hasMore)}
                  loadingEarlier={loadingEarlier}
                  onLoadEarlier={loadEarlier}
                  onReply={setReplyTo}
                  onReact={sendReaction}
                />

                {/* Chat Input */}
                <ChatInputForm
                  activeChatId={activeChatId}
                  apiKey={apiKey}
                  API_URL={API_URL}
                  onMessageSent={onMessageSent}
                  replyTo={replyTo}
                  onClearReply={() => setReplyTo(null)}
                />
              </>
            )}
          </>
        )}
      </div>

      {automationsOpen && activeChatId && (
        <ChatAutomationsModal
          apiKey={apiKey}
          theme={theme}
          chatId={activeChatId}
          chatName={resolveName(activeChatId)}
          isGroup={activeChatId.endsWith('@g.us')}
          onClose={() => setAutomationsOpen(false)}
        />
      )}

    </div>
  );
}