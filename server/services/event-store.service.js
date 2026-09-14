const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EventStore {
  constructor() {
    this.directory = path.resolve(__dirname, '..', 'data');
    this.file = path.join(this.directory, 'event-ledger.jsonl');
    this.mediaDirectory = path.join(this.directory, 'media-cache');
    this.messageCache = new Map();
    this.latestStatusBySender = new Map();
    this.persistedMessageIds = new Set();
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(this.mediaDirectory, { recursive: true });
    this.hydrateCache();
  }

  hydrateCache() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-5000);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch (_) { continue; }
        if (['message.received', 'message.sent', 'message.snapshot', 'status.received', 'status.snapshot'].includes(entry.type)) {
          this.indexMessage(entry.data);
          if (entry.type.startsWith('status.')) this.indexStatus(entry.data);
          const id = this.idOf(entry.data?.id);
          if (id) this.persistedMessageIds.add(id);
        }
      }
    } catch (_) { /* The ledger is created on the first event. */ }
  }

  idOf(id) { return typeof id === 'string' ? id : id?._serialized || id?.id || ''; }

  aliasesOf(id) {
    const serialized = this.idOf(id);
    const aliases = new Set([serialized, id?.id].filter(Boolean));
    for (const part of serialized.split('_')) if (/^[A-Za-z0-9-]{10,}$/.test(part) && !part.includes('@')) aliases.add(part);
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
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    const id = this.idOf(safeData?.id);
    if (id && ['message.received', 'message.sent', 'message.snapshot', 'status.received', 'status.snapshot'].includes(type)) {
      this.indexMessage(safeData);
      if (type.startsWith('status.')) this.indexStatus(safeData);
      this.persistedMessageIds.add(id);
    }
    if (this.messageCache.size > 5000) this.messageCache.delete(this.messageCache.keys().next().value);
    return entry;
  }

  getMessage(id) {
    for (const alias of this.aliasesOf(id)) {
      const message = this.messageCache.get(alias);
      if (message) return message;
    }
    return null;
  }

  mediaPath(id) { const safe = this.idOf(id).replace(/[^A-Za-z0-9._-]/g, '_'); return safe ? path.join(this.mediaDirectory, safe) : null; }
  cacheMedia(id, dataUrl, metadata = {}) {
    const target = this.mediaPath(id);
    const maxBytes = Math.min(Math.max(Number(process.env.MEDIA_CACHE_MAX_BYTES) || 25 * 1024 * 1024, 1024), 100 * 1024 * 1024);
    if (!target || typeof dataUrl !== 'string' || !/^data:[^;,]+;base64,/i.test(dataUrl) || Buffer.byteLength(dataUrl) > maxBytes * 1.38) return false;
    try { fs.writeFileSync(`${target}.json`, JSON.stringify({ dataUrl, ...metadata })); return true; } catch (_) { return false; }
  }
  getCachedMedia(id) {
    const target = this.mediaPath(id);
    if (!target) return null;
    try { return JSON.parse(fs.readFileSync(`${target}.json`, 'utf8')); } catch (_) { return null; }
  }

  list({ type, types, limit = 100, chatId } = {}) {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      return lines.reverse().map(line => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean).filter(entry => {
        if (type && entry.type !== type) return false;
        if (types && !types.includes(entry.type)) return false;
        if (chatId && ![entry.data?.from, entry.data?.to, entry.data?.chatId].some(value => this.idOf(value) === chatId)) return false;
        return true;
      }).slice(0, Math.min(Number(limit) || 100, 500));
    } catch (_) { return []; }
  }
}

module.exports = new EventStore();
