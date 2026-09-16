const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = require('../lib/db');

// The durable, per-tenant inbox. Store it in the same SQLite database that
// already holds auth/users so it inherits the persistent volume: once a user
// signs in we snapshot their chat list (summaries only - never their pre-login
// history) and permanently record every message/deletion/edit/reaction that
// flows from that moment. The inbox survives restarts, redeploys, and even a
// disconnected WhatsApp session - the next time they open the dashboard they
// see everything their account has done since the very first login.
//
// Tables (all keyed by api_key):
//   inbox_meta     - started_at (first ever login), last_boot_at
//   inbox_chats    - chatId -> display name, last-message subtitle, updated_at
//   inbox_messages - msgId -> full message (JSON) + body_text for search,
//                    overlaid live with is_deleted / reactions / edited

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
  // View-once media: normalize to its inner media type so the sidebar preview
  // reads like a normal photo/video (never a bare "[view once]").
  const normalizedType =
    type === 'viewonce' || type === 'view_once' || type === 'viewoncemessage' || message?.viewOnceMessage
      ? String(((() => {
          const inner = (message?.viewOnceMessage && typeof message.viewOnceMessage === 'object') ? (message.viewOnceMessage.message || message.viewOnceMessage) : {};
          return Object.keys(inner || {}).find(key => String(key).endsWith('Message')) || 'image';
        })())).replace(/Message$/, '').toLowerCase()
      : type;
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
  if (['protocol', 'notification', 'gp2', 'ciphertext', 'e2e_notification'].includes(type)) return `ℹ️ ${text || 'System update'}`;
  if (text) return text;
  return type === 'chat' ? 'Message' : `[${type.replaceAll('_', ' ')}]`;
}

const ids = (id) => typeof id === 'string' ? id : (id?._serialized || id?.id || '');
const canonical = (id) => String(ids(id) || '').replace(/_out$/, '');

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

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function previewDto(message, fallbackT) {
  if (!message) return {
    id: null, body: '', previewText: '', type: 'activity', timestamp: toSeconds(fallbackT), fromMe: false, deleted: false,
  };
  const type = String(message.type || 'chat').toLowerCase();
  return {
    id: canonical(message.id),
    body: safeText(message) || '',
    previewText: previewText(message) || '',
    type: type === 'revoked' ? 'revoked' : (type || 'chat'),
    timestamp: toSeconds(message.timestamp || message.t || fallbackT),
    fromMe: Boolean(message.fromMe || message.isSentByMe),
    deleted: Boolean(message.isDeleted || message.isRevoked || type === 'revoked'),
  };
}

class InboxStore {
  constructor() {
    this.readyPromise = this.ensureSchema().catch(error => {
      console.error('Inbox schema init failed:', error.message);
    });
    this.readyPromise.then(() => this.migrateLegacy()).catch(() => {});
  }

  async ensureSchema() {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS inbox_meta (
        api_key TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        last_boot_at INTEGER,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS inbox_chats (
        api_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        is_group INTEGER NOT NULL DEFAULT 0,
        last_message_id TEXT,
        last_preview TEXT NOT NULL DEFAULT '',
        last_body TEXT NOT NULL DEFAULT '',
        last_type TEXT NOT NULL DEFAULT 'chat',
        last_ts INTEGER NOT NULL DEFAULT 0,
        last_from_me INTEGER NOT NULL DEFAULT 0,
        last_deleted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (api_key, chat_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_chats_key ON inbox_chats (api_key, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS inbox_messages (
        api_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        msg_id TEXT NOT NULL,
        stored_at INTEGER NOT NULL,
        body_text TEXT NOT NULL DEFAULT '',
        message_json TEXT NOT NULL,
        reactions TEXT NOT NULL DEFAULT '[]',
        is_deleted INTEGER NOT NULL DEFAULT 0,
        edited INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (api_key, chat_id, msg_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_msgs_key ON inbox_messages (api_key, chat_id, stored_at DESC)`,
    ]) {
      await DB.run(statement);
    }
  }

  // One-time import of data written by the earlier JSONL inbox layout, so
  // nothing recorded so far is lost after this upgrade. Folders may be plain
  // or already-renamed `*.legacy`; the latter are re-imported only when the
  // key's baseline is missing (i.e. a reset/stranded volume where SQLite lost
  // its rows). Some old folders have no meta.json at all (their JSONL-era
  // bootstrap also hit the WAPI race) - those are attributed via the reverse
  // sha256 lookup against registered api_keys and started_at is derived from
  // the earliest imported message. A folder is deleted only after its import
  // fully succeeds - SQLite is the canonical store, the JSONL layout is the
  // redundant leftover.
  async migrateLegacy() {
    const root = path.resolve(__dirname, '..', 'data', 'inbox');
    let entries;
    try { entries = fs.readdirSync(root); } catch (_) { return; }
    for (const entry of entries) {
      const dir = path.join(root, entry);
      let stat;
      try { stat = fs.statSync(dir); } catch (_) { continue; }
      if (!stat.isDirectory()) continue;
      const folder = String(entry);
      const folderId = folder.endsWith('.legacy') ? folder.replace(/\.legacy$/, '') : folder;
      try {
        let meta = {};
        try { meta = parseJson(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'), {}); } catch (_) { /* Some old folders never wrote a meta.json. */ }
        let hadMeta = Boolean(meta.startedAt);
        if (!meta.apiKey) {
          // No meta.json (JSONL-era bootstrap never completed). The folder name
          // is sha256(apiKey).slice(0,32): recover the key from the registered
          // users so chats.json / messages/*.jsonl can still be imported.
          const keys = await DB.all('SELECT api_key FROM users');
          meta.apiKey = keys.map(row => row.api_key).find(k => crypto.createHash('sha256').update(String(k || '')).digest('hex').substring(0, 32) === folderId) || null;
        }
        if (!meta.apiKey) { console.warn('Inbox legacy folder could not be attributed, skipping:', folder); continue; }
        if (folder.endsWith('.legacy')) {
          const existing = await DB.get('SELECT started_at FROM inbox_meta WHERE api_key=?', [meta.apiKey]);
          if (existing?.started_at) continue; // already imported, nothing to recover
        }
        await this.importLegacyFolder(meta, dir, hadMeta);
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`Inbox legacy data imported to SQLite (${meta.apiKey.slice(0, 8)}) and removed`);
      } catch (error) {
        console.warn('Inbox legacy migration skipped for a folder:', error.message);
      }
    }
  }

  async importLegacyFolder(meta, dir, hadMeta) {
    await DB.run(`INSERT INTO inbox_meta (api_key, started_at, last_boot_at, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(api_key) DO UPDATE SET updated_at=excluded.updated_at`,
      [meta.apiKey, new Date(meta.startedAt || Date.now()).getTime(), Date.now(), Date.now()]);
    const chats = parseJson(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8'), {});
    for (const [chatId, chat] of Object.entries(chats)) {
      await DB.run(`INSERT OR IGNORE INTO inbox_chats
        (api_key, chat_id, display_name, is_group, last_message_id, last_preview, last_body, last_type, last_ts, last_from_me, last_deleted, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [meta.apiKey, chatId, chat.displayName || chatId.split('@')[0], chat.isGroup ? 1 : 0,
         chat.lastMessage?.id || null, chat.lastMessage?.previewText || '', chat.lastMessage?.body || '', chat.lastMessage?.type || 'chat',
         chat.lastMessage?.timestamp || 0, chat.lastMessage?.fromMe ? 1 : 0, chat.lastMessage?.deleted ? 1 : 0, chat.updatedAt || Date.now()]);
    }
    const messagesDir = path.join(dir, 'messages');
    let files;
    try { files = fs.readdirSync(messagesDir); } catch (_) { files = []; }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      let chatId;
      try { chatId = decodeURIComponent(file.replace(/\.jsonl$/, '')); } catch (_) { continue; }
      let lines;
      try { lines = fs.readFileSync(path.join(messagesDir, file), 'utf8').trim().split('\n').filter(Boolean); } catch (_) { continue; }
      await DB.run('BEGIN');
      try {
        for (const line of lines) {
          const entry = parseJson(line, null);
          if (!entry) continue;
          const storedAt = entry.storedAt || entry.seq || Date.now();
          if (entry.kind === 'message') {
            await DB.run(`INSERT OR IGNORE INTO inbox_messages
              (api_key, chat_id, msg_id, stored_at, body_text, message_json, reactions, is_deleted, edited)
              VALUES (?,?,?,?,?,?,?,?,?)`,
              [meta.apiKey, chatId, canonical(entry.data?.id), storedAt, safeText(entry.data), JSON.stringify(cleanMessage(entry.data) || {}), '[]', 0, 0]);
          } else if (entry.kind === 'delete') {
            const existing = await DB.get('SELECT message_json FROM inbox_messages WHERE api_key=? AND chat_id=? AND msg_id=?', [meta.apiKey, chatId, entry.refId]);
            const msgJson = existing?.message_json || (entry.original ? JSON.stringify(cleanMessage(entry.original)) : JSON.stringify({ id: entry.refId, type: 'revoked' }));
            await DB.run(`INSERT INTO inbox_messages (api_key, chat_id, msg_id, stored_at, body_text, message_json, reactions, is_deleted, edited)
              VALUES (?,?,?,?,?,?,?,1,0)
              ON CONFLICT(api_key, chat_id, msg_id) DO UPDATE SET is_deleted=1`,
              [meta.apiKey, chatId, entry.refId, storedAt, safeText(parseJson(msgJson, {})), msgJson, '[]']);
          } else if (entry.kind === 'reaction') {
            await DB.run(`UPDATE inbox_messages SET reactions=? WHERE api_key=? AND chat_id=? AND msg_id=?`,
              [JSON.stringify([{ emoji: entry.emoji, senderId: entry.senderId }]), meta.apiKey, chatId, entry.refId]);
          } else if (entry.kind === 'edit') {
            const existing = await DB.get('SELECT message_json FROM inbox_messages WHERE api_key=? AND chat_id=? AND msg_id=?', [meta.apiKey, chatId, entry.refId]);
            if (existing) {
              const data = parseJson(existing.message_json, {});
              for (const field of ['text', 'body', 'content', 'caption']) {
                if (entry.data?.[field] != null) data[field] = entry.data[field];
              }
              await DB.run('UPDATE inbox_messages SET message_json=?, edited=1 WHERE api_key=? AND chat_id=? AND msg_id=?',
                [JSON.stringify(data), meta.apiKey, chatId, entry.refId]);
            }
          }
        }
        await DB.run('COMMIT');
      } catch (transactionError) {
        await DB.run('ROLLBACK').catch(() => {});
        throw transactionError;
      }
    }
    // Without a meta.json the folder never recorded a startedAt; pin the
    // "saved since" date to the earliest message the import recovered.
    if (!hadMeta) {
      await DB.run('UPDATE inbox_meta SET started_at = COALESCE((SELECT MIN(stored_at) FROM inbox_messages WHERE api_key=?), started_at) WHERE api_key=?', [meta.apiKey, meta.apiKey]);
    }
  }

  saveMessage(apiKey, chatId, message) {
    const cleared = cleanMessage({ ...message, chatId: { _serialized: chatId } });
    const id = canonical(cleared.id);
    const ts = toSeconds(cleared.timestamp || cleared.t) || Math.floor(Date.now() / 1000);
    return {
      id,
      storedAt: Date.now(),
      bodyText: safeText(cleared),
      json: JSON.stringify(cleared),
      ts,
    };
  }

  // Called once per process boot once the session is CONNECTED. Captures the
  // chat list at that moment (summaries only - no pre-login history backfill)
  // and marks the very first login as startedAt. Later boots refresh the
  // baseline without losing accumulated messages.
  async bootstrap(apiKey, chats = [], opts = {}) {
    await this.readyPromise;
    const meta = await DB.get('SELECT started_at FROM inbox_meta WHERE api_key=?', [apiKey]);
    const startedAt = meta?.started_at || Date.now();
    await DB.run(`INSERT INTO inbox_meta (api_key, started_at, last_boot_at, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(api_key) DO UPDATE SET last_boot_at=excluded.last_boot_at, updated_at=excluded.updated_at`,
      [apiKey, startedAt, Date.now(), Date.now()]);
    const selfId = opts.selfId || null;
    const profileName = opts.profileName || null;
    for (const chat of chats) {
      const chatId = ids(chat.id);
      if (!chatId) continue;
      const messages = Array.isArray(chat.msgs) ? chat.msgs : (chat.msgs?.models || []);
      const lastMessage = chat.lastMessage || messages[messages.length - 1] || chat.chatlistPreview || null;
      const contact = chat.contact || {};
      const isGroup = Boolean(chat.isGroup);
      const isSelf = selfId && (chatId === selfId || contact.isMe);
      let displayName;
      if (isSelf) {
        displayName = contact.name || profileName || 'You';
      } else if (isGroup) {
        displayName = chat.name || chat.groupMetadata?.subject || chatId.split('@')[0];
      } else {
        displayName = contact.name || contact.formattedName || chatId.split('@')[0];
      }
      const preview = previewDto(lastMessage, chat.t);
      await DB.run(`INSERT INTO inbox_chats
        (api_key, chat_id, display_name, is_group, last_message_id, last_preview, last_body, last_type, last_ts, last_from_me, last_deleted, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(api_key, chat_id) DO UPDATE SET
          display_name = CASE
            WHEN lower(inbox_chats.display_name) = lower(substr(inbox_chats.chat_id, 1, instr(inbox_chats.chat_id, '@') - 1)) THEN excluded.display_name
            WHEN is_group = 0 AND ? THEN excluded.display_name
            ELSE inbox_chats.display_name END,
          is_group = excluded.is_group`,
        [apiKey, chatId, displayName, isGroup ? 1 : 0, preview.id, preview.previewText, preview.body, preview.type, preview.timestamp, preview.fromMe ? 1 : 0, preview.deleted ? 1 : 0, Date.now(), isGroup ? 0 : 1]);
    }
  }

  async recordMessage(apiKey, chatId, message, nameHintOverride) {
    await this.readyPromise;
    try {
      const saved = this.saveMessage(apiKey, chatId, message);
      await DB.run(`INSERT INTO inbox_messages (api_key, chat_id, msg_id, stored_at, body_text, message_json) VALUES (?,?,?,?,?,?)
        ON CONFLICT(api_key, chat_id, msg_id) DO UPDATE SET stored_at=excluded.stored_at, body_text=excluded.body_text, message_json=excluded.message_json`,
        [apiKey, chatId, saved.id, saved.storedAt, saved.bodyText, saved.json]);
      // Server-side resolved nameHint takes priority: it carries the phone-book
      // saved name or formatted phone number, never the WA profile pushname.
      // For group chats, nameHint is still the GROUP subject from the message.
      const isGroupChat = /@g\.us$/.test(chatId);
      const nameHint = isGroupChat
        ? (nameHintOverride || (typeof message?.groupName === 'string' && message.groupName ? message.groupName : null))
        : nameHintOverride || null;
      await this.upsertChat(apiKey, chatId, message, nameHint);
    } catch (error) {
      console.error('Inbox recordMessage failed:', error.message);
    }
  }

  async upsertChat(apiKey, chatId, message, nameHint) {
    const ts = toSeconds(message?.timestamp || message?.t) || Math.floor(Date.now() / 1000);
    const preview = previewDto({ ...message, timestamp: ts }, ts);
    const existing = await DB.get('SELECT display_name, is_group FROM inbox_chats WHERE api_key=? AND chat_id=?', [apiKey, chatId]);
    const displayName = nameHint || existing?.display_name || chatId.split('@')[0];
    const isGroup = existing?.is_group ? 1 : (String(chatId).endsWith('@g.us') ? 1 : 0);
    await DB.run(`INSERT INTO inbox_chats
      (api_key, chat_id, display_name, is_group, last_message_id, last_preview, last_body, last_type, last_ts, last_from_me, last_deleted, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(api_key, chat_id) DO UPDATE SET
        display_name = CASE
          WHEN excluded.display_name != '' AND excluded.display_name != excluded.chat_id THEN excluded.display_name
          ELSE inbox_chats.display_name END,
        last_message_id=excluded.last_message_id, last_preview=excluded.last_preview, last_body=excluded.last_body,
        last_type=excluded.last_type, last_ts=excluded.last_ts, last_from_me=excluded.last_from_me,
        last_deleted=excluded.last_deleted, updated_at=excluded.updated_at`,
      [apiKey, chatId, displayName, isGroup, preview.id, preview.previewText, preview.body, preview.type, preview.timestamp, preview.fromMe ? 1 : 0, preview.deleted ? 1 : 0, Date.now()]);
  }

  async recordDelete(apiKey, chatId, deletion) {
    await this.readyPromise;
    try {
      const refId = canonical(deletion?.data?.refId || deletion?.data?.referenceId || deletion?.data?.msgId);
      if (!refId) return;
      const existing = await DB.get('SELECT message_json FROM inbox_messages WHERE api_key=? AND chat_id=? AND msg_id=?', [apiKey, chatId, refId]);
      let msgJson;
      if (existing?.message_json) {
        msgJson = existing.message_json;
      } else if (deletion?.data?.original) {
        msgJson = JSON.stringify(cleanMessage(deletion.data.original));
      } else {
        msgJson = JSON.stringify({ id: refId, type: 'revoked', timestamp: Math.floor(Date.now() / 1000) });
      }
      const data = parseJson(msgJson, {});
      await DB.run(`INSERT INTO inbox_messages (api_key, chat_id, msg_id, stored_at, body_text, message_json, reactions, is_deleted, edited)
        VALUES (?,?,?,?,?,?,?,1,0)
        ON CONFLICT(api_key, chat_id, msg_id) DO UPDATE SET is_deleted=1`,
        [apiKey, chatId, refId, Date.now(), safeText(data), msgJson, '[]']);
      // Reflect the deletion in the sidebar subtitle when it affects the last
      // message: keep the full original text, prefixed with the 🚫 marker.
      const chat = await DB.get('SELECT last_message_id, last_body, last_preview FROM inbox_chats WHERE api_key=? AND chat_id=?', [apiKey, chatId]);
      if (chat?.last_message_id === refId) {
        const body = safeText(data) || chat.last_body || '';
        await DB.run('UPDATE inbox_chats SET last_deleted=1, last_preview=?, updated_at=? WHERE api_key=? AND chat_id=?',
          [body ? `🚫 ${body}` : '🚫', Date.now(), apiKey, chatId]);
      }
    } catch (error) {
      console.error('Inbox recordDelete failed:', error.message);
    }
  }

  async recordReaction(apiKey, chatId, reaction) {
    await this.readyPromise;
    try {
      const refId = canonical(reaction?.msgId);
      if (!refId) return;
      const existing = await DB.get('SELECT reactions FROM inbox_messages WHERE api_key=? AND chat_id=? AND msg_id=?', [apiKey, chatId, refId]);
      if (!existing) return; // reaction to a message we never recorded (pre-login) - nothing to attach
      const list = parseJson(existing.reactions, []);
      const sender = reaction?.sender || '';
      const next = list.filter(r => r.senderId !== sender);
      if (reaction?.reactionText) next.push({ emoji: reaction.reactionText, senderId: sender });
      await DB.run('UPDATE inbox_messages SET reactions=? WHERE api_key=? AND chat_id=? AND msg_id=?', [JSON.stringify(next), apiKey, chatId, refId]);
    } catch (error) {
      console.error('Inbox recordReaction failed:', error.message);
    }
  }

  async recordEdit(apiKey, chatId, edit) {
    await this.readyPromise;
    try {
      const refId = canonical(edit?.data?.id || edit?.data?.referenceId);
      if (!refId) return;
      const existing = await DB.get('SELECT message_json FROM inbox_messages WHERE api_key=? AND chat_id=? AND msg_id=?', [apiKey, chatId, refId]);
      if (!existing) return;
      const data = parseJson(existing.message_json, {});
      for (const field of ['text', 'body', 'content', 'caption']) {
        if (edit.data?.[field] != null) data[field] = edit.data[field];
      }
      await DB.run('UPDATE inbox_messages SET message_json=?, body_text=?, edited=1 WHERE api_key=? AND chat_id=? AND msg_id=?',
        [JSON.stringify(data), safeText(data), apiKey, chatId, refId]);
    } catch (error) {
      console.error('Inbox recordEdit failed:', error.message);
    }
  }

  async getChats(apiKey) {
    await this.readyPromise;
    const [meta, rows] = await Promise.all([
      DB.get('SELECT started_at, last_boot_at FROM inbox_meta WHERE api_key=?', [apiKey]),
      DB.all('SELECT * FROM inbox_chats WHERE api_key=? ORDER BY updated_at DESC', [apiKey]),
    ]);
    return {
      startedAt: meta?.started_at ? new Date(meta.started_at).toISOString() : null,
      lastBootAt: meta?.last_boot_at ? new Date(meta.last_boot_at).toISOString() : null,
      total: rows.length,
      chats: rows.map(row => ({
        id: row.chat_id,
        displayName: row.display_name || row.chat_id.split('@')[0],
        isGroup: Boolean(row.is_group),
        lastMessage: {
          id: row.last_message_id,
          body: row.last_body,
          previewText: row.last_preview,
          type: row.last_type || 'chat',
          timestamp: row.last_ts,
          fromMe: Boolean(row.last_from_me),
          deleted: Boolean(row.last_deleted),
        },
      })),
    };
  }

  async getMessages(apiKey, chatId, { count = 50, before } = {}) {
    await this.readyPromise;
    const limit = Math.min(Math.max(Number(count) || 50, 1), 200);
    const rows = before
      ? await DB.all('SELECT * FROM inbox_messages WHERE api_key=? AND chat_id=? AND stored_at<? ORDER BY stored_at DESC LIMIT ?', [apiKey, chatId, Number(before), limit + 1])
      : await DB.all('SELECT * FROM inbox_messages WHERE api_key=? AND chat_id=? ORDER BY stored_at DESC LIMIT ?', [apiKey, chatId, limit + 1]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const messages = page.map(this.materialize);
    const cursor = page.length ? page[0].stored_at : (before || null);
    return { messages, hasMore, cursor };
  }

  materialize(row) {
    const data = parseJson(row.message_json, {});
    return {
      ...data,
      isDeleted: Boolean(row.is_deleted),
      isRevoked: Boolean(row.is_deleted),
      deleted: Boolean(row.is_deleted),
      edited: Boolean(row.edited),
      _reactions: parseJson(row.reactions, []),
    };
  }

  async search(apiKey, query, limit = 25) {
    await this.readyPromise;
    if (!query || !String(query).trim()) return [];
    const q = `%${String(query).trim()}%`;
    const count = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const rows = await DB.all(`
      SELECT im.chat_id, im.msg_id, im.message_json, im.body_text, im.is_deleted, im.stored_at, c.display_name
      FROM inbox_messages im
      LEFT JOIN inbox_chats c ON c.api_key = im.api_key AND c.chat_id = im.chat_id
      WHERE im.api_key=? AND (im.body_text LIKE ? OR im.message_json LIKE ?)
      ORDER BY im.stored_at DESC LIMIT ?`,
      [apiKey, q, q, count]);
    return rows
      .filter(row => String(row.body_text || '').trim())
      .map(row => ({
        chatId: row.chat_id,
        displayName: row.display_name || row.chat_id.split('@')[0],
        message: {
          id: row.msg_id,
          body: row.body_text,
          previewText: row.body_text,
          type: 'chat',
          timestamp: Math.floor((Number(row.stored_at) || 0) / 1000),
          fromMe: false,
          isDeleted: Boolean(row.is_deleted),
        },
      }));
  }
}

module.exports = new InboxStore();