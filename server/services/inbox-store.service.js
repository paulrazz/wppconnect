const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The durable, per-tenant inbox. Once a user signs in we snapshot their chat
// list (summaries only, never their pre-login history) and then permanently
// record every message that flows while the session is live. Because the data
// lives on disk (Railway volume), the inbox survives restarts, redeploys, and
// even a disconnected WhatsApp session - the next time they open the dashboard
// they see everything their account has done since the very first login.
//
// Layout under <root>/data/inbox/<sha256(apiKey)>/
//   meta.json                 - startedAt (first ever login), lastBootAt
//   chats.json                - chatId -> { id, displayName, isGroup, lastMessage, updatedAt }
//   messages/<enc(chatId)>.jsonl - append-only event log (message/delete/reaction/edit)

function safeKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').substring(0, 32);
}

function chatFile(chatId) {
  return `${encodeURIComponent(String(chatId || ''))}.jsonl`;
}

function looksLikeBinaryPayload(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^data:[^;,]+;base64,/i.test(text)) return true;
  if (text.length < 256) return false;
  const sample = text.slice(0, 1024).replace(/\s/g, '');
  return sample.length > 240 && /^[A-Za-z0-9+/=]+$/.test(sample);
}

function safeText(message) {
  return [message?.caption, message?.text, message?.body, message?.content]
    .find(value => typeof value === 'string' && value.trim() && !looksLikeBinaryPayload(value))?.trim() || '';
}

function previewText(message, fallback = '') {
  if (!message) return fallback;
  const type = String(message.type || 'chat').toLowerCase();
  const text = safeText(message);
  const media = {
    image: '📷 Photo', video: '🎥 Video', gif: '🎞️ GIF', audio: '🎵 Audio', ptt: '🎙️ Voice note',
    sticker: '🏷️ Sticker', document: `📄 ${message.filename || message.fileName || 'Document'}`,
    location: '📍 Location', live_location: '📍 Live location', vcard: '👤 Contact card',
    contact_card: '👤 Contact card', contacts_array: '👥 Contact cards',
  }[type];
  if (media) return text ? `${media}: ${text}` : media;
  if (type.includes('call')) return `${message.isMissed || type.includes('missed') ? 'Missed' : 'WhatsApp'} ${message.isVideoCall || type.includes('video') ? 'video' : 'voice'} call`;
  if (type === 'revoked' || message.isDeleted || message.isRevoked) return text ? `${text} 🚫` : '🚫 Message deleted';
  if (type.startsWith('poll')) return `📊 ${message.pollName || message.poll?.name || text || 'Poll'}`;
  if (['buttons_response', 'list_response', 'template_button_reply', 'interactive_response'].includes(type)) return `↩️ ${text || 'Interactive response'}`;
  if (['buttons', 'template_button', 'interactive'].includes(type)) return `🔘 ${text || 'Interactive message'}`;
  if (['list', 'list_message'].includes(type)) return `☷ ${text || 'List message'}`;
  if (['protocol', 'notification', 'gp2', 'ciphertext', 'e2e_notification'].includes(type)) return `ℹ️ ${text || 'System update'}`;
  if (text) return text;
  return type === 'chat' ? 'Message' : `[${type.replaceAll('_', ' ')}]`;
}

const ids = (id) => typeof id === 'string' ? id : (id?._serialized || id?.id || '');

// wppconnect timestamps arrive in seconds, but chat-level `t`/`previewT` are
// milliseconds. Normalize anything to whole seconds for the UI.
function toSeconds(value) {
  const n = Number(value || 0);
  if (!n) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

// Keep only what the inbox needs; drop raw buffers/base64 blobs so the volume
// never grows with media payloads (those are cached separately, size-capped).
function cleanMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const seen = new WeakSet();
  const clone = JSON.parse(JSON.stringify(message, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  }));
  const out = { ...clone };
  for (const field of ['body', 'content']) {
    if (looksLikeBinaryPayload(out[field])) out[field] = '';
  }
  return out;
}

class InboxStore {
  constructor() {
    this.directory = path.resolve(__dirname, '..', 'data', 'inbox');
    fs.mkdirSync(this.directory, { recursive: true });
  }

  dir(apiKey) { return path.join(this.directory, safeKey(apiKey)); }
  metaPath(apiKey) { return path.join(this.dir(apiKey), 'meta.json'); }
  chatsPath(apiKey) { return path.join(this.dir(apiKey), 'chats.json'); }
  messagesPath(apiKey, chatId) { return path.join(this.dir(apiKey), 'messages', chatFile(chatId)); }

  ensure(apiKey) {
    const dir = this.dir(apiKey);
    fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
    return dir;
  }

  readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
  }

  writeJson(file, value) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  }

  getMeta(apiKey) {
    return this.readJson(this.metaPath(apiKey), null);
  }

  getChatsData(apiKey) {
    return this.readJson(this.chatsPath(apiKey), {});
  }

  setMeta(apiKey, patch) {
    this.ensure(apiKey);
    const meta = this.getMeta(apiKey) || {};
    const merged = { ...meta, ...patch };
    if (!merged.startedAt) merged.startedAt = new Date().toISOString();
    merged.updatedAt = new Date().toISOString();
    this.writeJson(this.metaPath(apiKey), merged);
    return merged;
  }

  // Called once per process boot once the session is CONNECTED. Captures the
  // chat list at that moment (summaries only - no pre-login history backfill)
  // and marks the very first login as startedAt. Later boots refresh the
  // baseline without losing accumulated messages.
  async bootstrap(apiKey, chats = []) {
    const meta = this.getMeta(apiKey);
    this.setMeta(apiKey, { lastBootAt: new Date().toISOString() });
    const data = this.getChatsData(apiKey);
    let changed = false;
    for (const chat of chats) {
      const chatId = ids(chat.id);
      if (!chatId) continue;
      const messages = Array.isArray(chat.msgs) ? chat.msgs : (chat.msgs?.models || []);
      const lastMessage = chat.lastMessage || messages[messages.length - 1] || chat.chatlistPreview || null;
      const contact = chat.contact || {};
      const isGroup = Boolean(chat.isGroup);
      const displayName = isGroup
        ? (chat.name || chat.groupMetadata?.subject || chatId.split('@')[0])
        : (contact.name || contact.formattedName || contact.verifiedName || contact.pushname || contact.shortName || chat.name || chatId.split('@')[0]);
      const previous = data[chatId];
      if (previous) continue; // keep the live preview we recorded at message time
      data[chatId] = {
        id: chatId,
        displayName,
        isGroup,
        lastMessage: this.previewDto(lastMessage, chat.t),
        updatedAt: toSeconds(lastMessage?.timestamp || lastMessage?.t || chat.t) * 1000 || Date.now(),
      };
      changed = true;
    }
    if (changed) this.writeJson(this.chatsPath(apiKey), data);
  }

  previewDto(message, fallbackT) {
    if (!message) return {
      id: null, body: '', previewText: '', type: 'activity',
      timestamp: toSeconds(fallbackT), fromMe: false,
    };
    const type = String(message.type || 'chat').toLowerCase();
    return {
      id: ids(message.id) || null,
      body: safeText(message) || '',
      previewText: previewText(message) || '',
      type: type === 'revoked' ? 'revoked' : (type || 'chat'),
      timestamp: toSeconds(message.timestamp || message.t || fallbackT),
      fromMe: Boolean(message.fromMe || message.isSentByMe),
      deleted: Boolean(message.isDeleted || message.isRevoked || type === 'revoked'),
    };
  }

  upsertChat(apiKey, chatId, message, displayName = null) {
    const data = this.getChatsData(apiKey);
    const previous = data[chatId] || { id: chatId, displayName: displayName || chatId.split('@')[0], isGroup: String(chatId).endsWith('@g.us') };
    const ts = toSeconds(message?.timestamp || message?.t) || Math.floor(Date.now() / 1000);
    data[chatId] = {
      id: chatId,
      displayName: displayName || previous.displayName,
      isGroup: previous.isGroup || String(chatId).endsWith('@g.us'),
      lastMessage: this.previewDto(message, ts),
      updatedAt: ts * 1000,
    };
    this.writeJson(this.chatsPath(apiKey), data);
  }

  recordMessage(apiKey, chatId, message) {
    if (!apiKey || !chatId || !message) return;
    this.ensure(apiKey);
    const line = JSON.stringify({ kind: 'message', seq: Date.now(), recordedAt: Date.now(), data: cleanMessage(message) });
    fs.appendFileSync(this.messagesPath(apiKey, chatId), `${line}\n`);
    this.upsertChat(apiKey, chatId, message, message.notifyName || message.pushname || null);
  }

  recordDelete(apiKey, chatId, deletion) {
    if (!apiKey || !chatId || !deletion) return;
    this.ensure(apiKey);
    const line = JSON.stringify({
      kind: 'delete',
      storedAt: Date.now(),
      refId: deletion?.data?.refId || ids(deletion?.data?.referenceId),
      deletedAt: deletion?.data?.deletedAt || new Date().toISOString(),
      original: deletion?.data?.original ? cleanMessage(deletion.data.original) : null,
    });
    fs.appendFileSync(this.messagesPath(apiKey, chatId), `${line}\n`);
  }

  recordReaction(apiKey, chatId, reaction) {
    if (!apiKey || !chatId || !reaction?.msgId) return;
    this.ensure(apiKey);
    const line = JSON.stringify({
      kind: 'reaction',
      storedAt: Date.now(),
      refId: ids(reaction.msgId),
      emoji: reaction.reactionText || '',
      senderId: reaction.sender || '',
    });
    fs.appendFileSync(this.messagesPath(apiKey, chatId), `${line}\n`);
  }

  recordEdit(apiKey, chatId, edit) {
    if (!apiKey || !chatId || !edit) return;
    this.ensure(apiKey);
    const line = JSON.stringify({
      kind: 'edit',
      storedAt: Date.now(),
      refId: ids(edit.data?.id) || ids(edit.data?.referenceId),
      data: cleanMessage(edit.data),
    });
    fs.appendFileSync(this.messagesPath(apiKey, chatId), `${line}\n`);
  }

  getChats(apiKey) {
    const [meta, data] = [this.getMeta(apiKey), this.getChatsData(apiKey)];
    const chats = Object.values(data)
      .map(chat => ({ ...chat, lastMessage: chat.lastMessage || null }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return {
      startedAt: meta?.startedAt || null,
      lastBootAt: meta?.lastBootAt || null,
      total: chats.length,
      chats,
    };
  }

  getMessages(apiKey, chatId, { count = 50, before } = {}) {
    const file = this.messagesPath(apiKey, chatId);
    const limit = Math.min(Math.max(Number(count) || 50, 1), 200);
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean); } catch (_) { return { messages: [], hasMore: false, cursor: null }; }

    const entries = lines
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean)
      .filter(entry => !before || (entry.storedAt || entry.seq) < Number(before));

    const messages = new Map();
    const reactions = new Map(); // refId -> senderId -> emoji (last wins)
    const deletions = new Map();
    const edits = new Map();

    for (const entry of entries) {
      if (entry.kind === 'message') {
        const id = ids(entry.data?.id);
        if (!id) continue;
        // re-clone latest occurrence; key on canonical (strip nothing here - our
        // records already hold real ids from the server)
        messages.set(id, entry.data);
      } else if (entry.kind === 'reaction' && entry.refId) {
        const bySender = reactions.get(entry.refId) || {};
        if (entry.senderId) { bySender[entry.senderId] = entry.emoji; reactions.set(entry.refId, bySender); }
      } else if (entry.kind === 'delete' && entry.refId) {
        deletions.set(entry.refId, entry);
      } else if (entry.kind === 'edit' && entry.refId) {
        edits.set(entry.refId, entry);
      }
    }

    let list = [...messages.entries()].map(([id, data]) => {
      const message = { ...data };
      const deleted = deletions.get(id);
      if (deleted) {
        const original = deleted.original;
        message.isDeleted = true;
        message.isRevoked = true;
        message.deleted = true;
        // The original body (recorded at arrival) survives the WhatsApp stub.
        if (original && !safeText(message) && safeText(original)) {
          for (const field of ['text', 'body', 'content', 'caption']) {
            if (original[field] != null) message[field] = original[field];
          }
          if (original.type) message.type = original.type;
        }
      }
      const edited = edits.get(id);
      if (edited?.data) {
        const edit = edited.data;
        for (const field of ['text', 'body', 'content', 'caption']) {
          if (edits.get(id).data[field] != null) message[field] = edit[field];
        }
        message.edited = true;
      }
      const reacts = reactions.get(id);
      if (reacts) {
        message._reactions = Object.entries(reacts)
          .filter(([, emoji]) => emoji)
          .map(([senderId, emoji]) => ({ emoji, senderId }));
      }
      return message;
    });

    list.sort((a, b) => (a.timestamp || a.t || 0) - (b.timestamp || b.t || 0));
    const page = list.slice(-limit);
    if (!page.length) return { messages: [], hasMore: false, cursor: before || null };
    const oldestId = ids(page[0].id);
    const oldestEntry = entries.find(e => e.kind === 'message' && ids(e.data?.id) === oldestId);
    const oldestStoredAt = oldestEntry?.storedAt || oldestEntry?.seq || (page[0].timestamp || 0);
    return { messages: page, hasMore: list.length > limit, cursor: Number(oldestStoredAt) || null };
  }

  search(apiKey, query, limit = 25) {
    if (!query || !String(query).trim()) return [];
    const q = String(query).toLowerCase();
    const count = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const chats = this.getChatsData(apiKey);
    const results = [];
    const chatIds = Object.keys(chats);
    for (const chatId of chatIds) {
      if (results.length >= count * 4) break;
      const file = this.messagesPath(apiKey, chatId);
      let lines;
      try { lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean); } catch (_) { continue; }
      // newest first so matches surface recent content
      for (let i = lines.length - 1; i >= 0 && results.length < count; i -= 1) {
        let entry;
        try { entry = JSON.parse(lines[i]); } catch (_) { continue; }
        if (entry.kind !== 'message') continue;
        const text = safeText(entry.data);
        if (text && text.toLowerCase().includes(q)) {
          results.push({
            chatId,
            displayName: chats[chatId]?.displayName || chatId.split('@')[0],
            message: { id: ids(entry.data.id), body: text, previewText: previewText(entry.data), type: entry.data.type || 'chat', timestamp: entry.data.timestamp || entry.data.t || 0, fromMe: Boolean(entry.data.fromMe) },
          });
        }
      }
    }
    return results.slice(0, count);
  }
}

module.exports = new InboxStore();