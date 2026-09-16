const crypto = require('crypto');
const DB = require('../lib/db');

let s3Client = null;
if (process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
  });
}

class EventStore {
  constructor() {
    this.messageCache = new Map();
    this.latestStatusBySender = new Map();
    this.persistedMessageIds = new Set();
  }

  idOf(id) {
    if (!id) return null;
    if (typeof id === 'string') return id;
    if (typeof id === 'object') {
      if (id._serialized) return id._serialized;
      if (id.id) return id.id;
    }
    return String(id);
  }

  aliasesOf(id) {
    const canonical = this.idOf(id);
    if (!canonical) return [];
    const aliases = new Set([canonical]);
    aliases.add(canonical.replace(/_out$/, ''));
    if (!canonical.endsWith('_out')) aliases.add(`${canonical}_out`);
    if (canonical.includes('@')) {
      const parts = canonical.split('@');
      aliases.add(parts[0]);
      const domain = parts[1];
      if (domain === 'c.us') aliases.add(`${parts[0]}@s.whatsapp.net`);
      if (domain === 's.whatsapp.net') aliases.add(`${parts[0]}@c.us`);
    }
    return [...aliases];
  }

  indexMessage(data) { for (const alias of this.aliasesOf(data?.id)) this.messageCache.set(alias, data); }

  senderOf(data) { return this.idOf(data?.author || data?.sender?.id || data?.from); }

  indexStatus(data) {
    const sender = this.senderOf(data);
    if (sender && sender !== 'status@broadcast') this.latestStatusBySender.set(sender, data);
  }

  snapshotOf(data) {
    const isBinary = value => typeof value === 'string' && (value.startsWith('data:') || value.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 512)));
    return {
      id: data.id, type: data.type, subtype: data.subtype, from: data.from, to: data.to, author: data.author,
      chatId: data.chatId, fromMe: data.fromMe, timestamp: data.timestamp || data.t, notifyName: data.notifyName,
      body: isBinary(data.body) ? '' : data.body, content: isBinary(data.content) ? '' : data.content,
      caption: data.caption, filename: data.filename || data.fileName, mimetype: data.mimetype,
      sender: data.sender ? { id: data.sender.id, name: data.sender.name, pushname: data.sender.pushname, formattedName: data.sender.formattedName } : undefined,
    };
  }

  rememberMessage(data) {
    const id = this.idOf(data?.id);
    if (!id) return;
    this.indexMessage(data);
    if (this.persistedMessageIds.has(id)) return;
    const snapshot = this.snapshotOf(data);
    this.persistedMessageIds.add(id);
    this.append('message.snapshot', snapshot);
  }

  rememberStatus(data) {
    const snapshot = this.snapshotOf(data);
    this.indexMessage(snapshot);
    this.indexStatus(snapshot);
    this.append('status.received', snapshot);
  }

  getLatestStatus(sender) { return this.latestStatusBySender.get(this.idOf(sender)) || null; }

  append(type, data) {
    const seen = new WeakSet();
    const safeData = JSON.parse(JSON.stringify(data, (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }));
    
    const entry = { ledgerId: crypto.randomUUID(), type, recordedAt: new Date().toISOString(), data: safeData };
    
    const id = this.idOf(safeData?.id);
    if (id && ['message.received', 'message.sent', 'message.snapshot', 'status.received', 'status.snapshot'].includes(type)) {
      this.indexMessage(safeData);
      if (type.startsWith('status.')) this.indexStatus(safeData);
      this.persistedMessageIds.add(id);
    }
    if (this.messageCache.size > 5000) this.messageCache.delete(this.messageCache.keys().next().value);
    
    // Async append to SQLite
    DB.run('INSERT INTO events (id, type, chat_id, sender_id, timestamp, data) VALUES (?, ?, ?, ?, ?, ?)', [
      entry.ledgerId,
      type,
      this.idOf(safeData?.chatId || safeData?.from || safeData?.to),
      this.senderOf(safeData),
      safeData?.timestamp || safeData?.t || Date.now() / 1000,
      JSON.stringify(safeData)
    ]).catch(err => console.error('SQLite event write failed:', err));
    
    return entry;
  }

  getMessage(id) {
    for (const alias of this.aliasesOf(id)) {
      const message = this.messageCache.get(alias);
      if (message) return message;
    }
    return null;
  }

  getMessageDeep(id) {
    // Only return hot cache (SQLite historic loading disabled as app doesn't load historic chats)
    return this.getMessage(id);
  }

  cacheMedia(id, dataUrl, metadata = {}) {
    const safeId = this.idOf(id).replace(/[^A-Za-z0-9._-]/g, '_');
    const maxBytes = Math.min(Math.max(Number(process.env.MEDIA_CACHE_MAX_BYTES) || 25 * 1024 * 1024, 1024), 100 * 1024 * 1024);
    if (!safeId || typeof dataUrl !== 'string' || !/^data:[^;,]+;base64,/i.test(dataUrl) || Buffer.byteLength(dataUrl) > maxBytes * 1.38) return false;
    
    if (s3Client && process.env.R2_BUCKET) {
      try {
        const parts = dataUrl.split(',');
        const mimeType = parts[0].match(/:(.*?);/)[1];
        const buffer = Buffer.from(parts[1], 'base64');
        const extension = mimeType.split('/')[1] || 'bin';
        const objectKey = `${safeId}.${extension}`;
        
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: objectKey,
          Body: buffer,
          ContentType: mimeType
        })).catch(err => console.error('R2 upload failed:', err));
        
        const publicUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${objectKey}`;
        DB.run('INSERT OR REPLACE INTO media_cache (id, type, data_url, mimetype, filename) VALUES (?, ?, ?, ?, ?)', [
          safeId, 'media', publicUrl, metadata.mimetype || mimeType, metadata.filename || metadata.fileName || null
        ]).catch(console.error);
        
        return true;
      } catch (err) {
        console.error('Failed to dispatch R2 upload:', err);
      }
    }

    // Local fallback
    DB.run('INSERT OR REPLACE INTO media_cache (id, type, data_url, mimetype, filename) VALUES (?, ?, ?, ?, ?)', [
      safeId, 'media', dataUrl, metadata.mimetype || null, metadata.filename || metadata.fileName || null
    ]).catch(console.error);
    return true;
  }

  async getCachedMedia(id) {
    const safeId = this.idOf(id).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!safeId) return null;
    try {
      const row = await DB.get('SELECT data_url, mimetype, filename FROM media_cache WHERE id = ?', [safeId]);
      if (!row) return null;
      return { dataUrl: row.data_url, mimetype: row.mimetype, filename: row.filename };
    } catch (_) { return null; }
  }

  cacheAvatar(id, dataUrl) {
    const safeId = this.idOf(id).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!safeId || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false;
    DB.run('INSERT OR REPLACE INTO media_cache (id, type, data_url, fetched_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [
      safeId, 'avatar', dataUrl
    ]).catch(console.error);
    return true;
  }

  async getCachedAvatar(id, ttlMs = 24 * 60 * 60 * 1000) {
    const safeId = this.idOf(id).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!safeId) return null;
    try {
      const row = await DB.get('SELECT data_url, strftime("%s", fetched_at) * 1000 as fetchedAt FROM media_cache WHERE id = ? AND type = "avatar"', [safeId]);
      if (!row || !row.data_url) return null;
      if (ttlMs && Date.now() - (row.fetchedAt || 0) > ttlMs) return null;
      return row.data_url;
    } catch (_) { return null; }
  }

  async list({ type, types, limit = 100, chatId } = {}) {
    try {
      const params = [];
      const conditions = [];
      
      if (type) {
        conditions.push('type = ?');
        params.push(type);
      }
      if (types && types.length) {
        conditions.push(`type IN (${types.map(() => '?').join(',')})`);
        params.push(...types);
      }
      if (chatId) {
        conditions.push('chat_id = ?');
        params.push(this.idOf(chatId));
      }
      
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await DB.all(`SELECT id, type, recorded_at, data FROM events ${whereClause} ORDER BY timestamp DESC LIMIT ?`, [...params, Math.min(Number(limit) || 100, 500)]);
      
      return rows.map(row => {
        try {
          return { ledgerId: row.id, type: row.type, recordedAt: row.recorded_at, data: JSON.parse(row.data) };
        } catch (_) { return null; }
      }).filter(Boolean);
    } catch (_) { return []; }
  }
}

module.exports = new EventStore();
