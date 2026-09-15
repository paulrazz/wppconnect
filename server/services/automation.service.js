const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Per-tenant automation engine. Rules are stored as JSON on the persistent
// volume (server/data/automation/<apiKeyHash>.json), so restarts and Railway
// deploys keep their state. The playground in the Developer docs configures
// these rules; this engine evaluates incoming messages against them and runs
// the matched action (optionally after a delay), reusing the WhatsApp client
// owned by whatsapp.service.js.

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'automation');
const MAX_PATTERN_LENGTH = 512;
const MAX_DELAY = 3600;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const EVENT_IDS = ['message.received'];

const FIELDS = ['sender', 'chatId', 'isGroup', 'fromMe', 'text', 'hasMedia', 'mediaType', 'type'];

const OPS_BY_FIELD = {
  sender: ['equals', 'not_equals', 'contains', 'in', 'not_in'],
  chatId: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'in', 'not_in'],
  isGroup: ['is_true', 'is_false'],
  fromMe: ['is_true', 'is_false'],
  text: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'matches_regex', 'in', 'not_in'],
  hasMedia: ['is_true', 'is_false'],
  mediaType: ['equals', 'not_equals', 'in', 'not_in'],
  type: ['equals', 'not_equals', 'in', 'not_in'],
};

const BOOL_FIELDS = new Set(['isGroup', 'fromMe', 'hasMedia']);

const FIELD_META = {
  sender: { label: 'Sender', hint: 'WhatsApp ID of the sender, e.g. 2348012345678@c.us or 1234567890@g.us' },
  chatId: { label: 'Chat / Group', hint: 'Chat or group ID the message arrived in' },
  isGroup: { label: 'Is a group chat', hint: 'Matches when the message comes from a group' },
  fromMe: { label: 'From my number', hint: 'Incoming messages are always from someone else' },
  text: { label: 'Message text', hint: 'Body or caption of the message' },
  hasMedia: { label: 'Has media', hint: 'Matches when an image, video, audio, document or sticker is present' },
  mediaType: { label: 'Media type', hint: 'image, video, gif, audio, ptt, sticker or document' },
  type: { label: 'Message type', hint: 'The internal WhatsApp type, e.g. chat / image / vcard' },
};

const OP_META = {
  equals: { label: 'equals', example: '"order"' },
  not_equals: { label: 'does not equal', example: '"order"' },
  contains: { label: 'contains', example: '"order"' },
  not_contains: { label: 'does not contain', example: '"order"' },
  starts_with: { label: 'starts with', example: '"hi"' },
  ends_with: { label: 'ends with', example: '"thanks"' },
  matches_regex: { label: 'matches regex', example: '^order\\s+\\d+$' },
  is_true: { label: 'is true', example: '' },
  is_false: { label: 'is false', example: '' },
  in: { label: 'is one of', example: 'one per line: hi\nhello\nhey' },
  not_in: { label: 'is none of', example: 'one per line: spam\npromo' },
};

const ACTION_TYPES = ['send_text', 'send_media', 'send_reaction', 'forward_to'];

const ACTION_META = {
  send_text: {
    label: 'Send a text reply',
    fields: [
      { name: 'text', label: 'Reply text', type: 'textarea', required: true },
      { name: 'quoted', label: 'Quote the received message', type: 'bool', default: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: MAX_DELAY, default: 0 },
    ],
  },
  send_media: {
    label: 'Send media / a file',
    fields: [
      { name: 'media', label: 'File URL or data URL', type: 'text', required: true },
      { name: 'filename', label: 'Filename', type: 'text' },
      { name: 'caption', label: 'Caption', type: 'textarea' },
      { name: 'quoted', label: 'Quote the received message', type: 'bool', default: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: MAX_DELAY, default: 0 },
    ],
  },
  send_reaction: {
    label: 'React with an emoji',
    fields: [
      { name: 'reaction', label: 'Emoji', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: MAX_DELAY, default: 0 },
    ],
  },
  forward_to: {
    label: 'Relay / forward to another chat',
    fields: [
      { name: 'to', label: 'Destination chat or number', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: MAX_DELAY, default: 0 },
    ],
  },
};

const PLACEHOLDERS = [
  { token: '{name}', label: 'Contact name' },
  { token: '{number}', label: 'Sender phone number' },
  { token: '{from}', label: 'Sender WhatsApp ID' },
  { token: '{chatId}', label: 'Chat / group ID' },
  { token: '{text}', label: 'Received message text' },
  { token: '{mediaType}', label: 'Media type (image, video, …)' },
  { token: '{type}', label: 'Message type' },
  { token: '{time}', label: 'Local time' },
];

const MEDIA_TYPES = new Set(['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document']);

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 32);
}

function toList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  return String(value || '').split(/[\n,]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
}

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function validOperator(field, op) {
  return (OPS_BY_FIELD[field] || []).includes(op);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeCondition(condition, index) {
  if (!condition || typeof condition !== 'object') throw badRequest(`Condition #${index + 1} is invalid`);
  const field = condition.field;
  if (!FIELDS.includes(field)) throw badRequest(`Condition #${index + 1}: unknown field "${field}"`);
  const op = condition.op;
  if (!validOperator(field, op)) throw badRequest(`Condition #${index + 1}: operator "${op}" is not valid for field "${field}"`);
  let value = condition.value;
  if (BOOL_FIELDS.has(field)) {
    if (value !== true && value !== false) throw badRequest(`Condition #${index + 1}: boolean fields require a true/false value`);
  } else {
    if (value === undefined || value === null || value === '') throw badRequest(`Condition #${index + 1}: a value is required`);
    if (op === 'matches_regex') {
      value = String(value);
      if (value.length > MAX_PATTERN_LENGTH) throw badRequest('Regular expressions may be at most 512 characters');
      try { new RegExp(value, 'i'); } catch (e) { throw badRequest(`Condition #${index + 1}: invalid regular expression`); }
    }
  }
  return { field, op, value };
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') throw badRequest('An action is required');
  const type = action.type;
  if (!ACTION_TYPES.includes(type)) throw badRequest(`Unknown action type "${type}"`);
  const meta = ACTION_META[type];
  const payload = {};
  for (const field of meta.fields) {
    const value = action[field.name];
    if (field.required && (value === undefined || value === null || value === '')) {
      throw badRequest(`Action "${meta.label}" requires "${field.label}"`);
    }
    if (value === undefined || value === null) {
      payload[field.name] = 'default' in field ? field.default : undefined;
      continue;
    }
    if (field.type === 'bool') {
      payload[field.name] = value === true || value === 'true' || value === 1;
    } else if (field.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) throw badRequest(`"${field.label}" must be a number`);
      const max = typeof field.max === 'number' ? field.max : num;
      payload[field.name] = Math.max(field.min ?? 0, Math.min(num, max));
    } else {
      payload[field.name] = String(value).trim();
    }
  }
  if (type === 'send_media' && payload.media) {
    if (!/^data:/.test(payload.media)) {
      let url;
      try { url = new URL(payload.media); } catch (_) { throw badRequest('Media must be a data URL or an http(s) URL'); }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Media URLs must use http or https');
    } else if (payload.media.length > MAX_MEDIA_BYTES * 1.4) {
      throw badRequest('Media data URL is too large (max 25 MB)');
    }
  }
  if (type === 'forward_to' && !/^[0-9+@\-.\s]+$/.test(payload.to)) {
    throw badRequest('Destination must be a phone number or a WhatsApp ID');
  }
  return { type, ...payload };
}

function normalizeRule(body) {
  if (!body || typeof body !== 'object') throw badRequest('A rule body is required');
  const name = String(body.name || '').trim();
  if (!name) throw badRequest('A rule name is required');
  if (name.length > 80) throw badRequest('Rule name must be 80 characters or fewer');

  const event = body.trigger?.event || 'message.received';
  if (!EVENT_IDS.includes(event)) throw badRequest(`Trigger event "${event}" is not supported`);

  const rawConditions = Array.isArray(body.trigger?.conditions) ? body.trigger.conditions : [];
  if (!rawConditions.length) throw badRequest('At least one condition is required');
  if (rawConditions.length > 10) throw badRequest('A rule may have at most 10 conditions');

  const match = body.trigger?.match === 'any' ? 'any' : 'all';
  const conditions = rawConditions.map(normalizeCondition);
  const action = normalizeAction(body.action || {});

  return {
    id: body.id || crypto.randomUUID(),
    name,
    enabled: body.enabled !== false && body.enabled !== 'false',
    trigger: { event, match, conditions },
    action,
    runCount: Math.max(0, Number(body.runCount) || 0),
    lastRunAt: body.lastRunAt || null,
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function interpolate(template, ctx) {
  const values = {
    name: ctx.senderName || '',
    number: ctx.from.replace(/\D/g, ''),
    from: ctx.from,
    chatId: ctx.chatId,
    text: ctx.text,
    mediaType: ctx.mediaType || '',
    type: ctx.type || '',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  return String(template || '').replace(/\{(name|number|from|chatId|text|mediaType|type|time)\}/g, (_, key) => values[key]);
}

function resolveContext(message) {
  const from = message?.from?._serialized || message?.from || message?.author?._serialized || message?.author || '';
  const chatId = message?.chatId?._serialized || message?.chatId || message?.id?.remote?._serialized || '';
  const body = String(message?.body ?? message?.caption ?? message?.content ?? '');
  const text = /^data:.+;base64,/.test(body) ? '' : body;
  const type = String(message?.type || '').toLowerCase();
  const mediaType = MEDIA_TYPES.has(type) ? type : '';
  return {
    from,
    chatId,
    text,
    type,
    mediaType,
    hasMedia: Boolean(mediaType),
    isGroup: /@g\.us$/.test(from) || /@g\.us$/.test(chatId) || Boolean(message?.isGroupMsg),
    fromMe: Boolean(message?.fromMe || message?.isSentByMe),
    senderName: message?.sender?.formattedName || message?.senderObj?.formattedName || message?.pushName || message?.sender?.pushname || '',
  };
}

function fieldValue(ctx, field) {
  switch (field) {
    case 'sender': return ctx.from;
    case 'chatId': return ctx.chatId;
    case 'isGroup': return ctx.isGroup;
    case 'fromMe': return ctx.fromMe;
    case 'text': return ctx.text;
    case 'hasMedia': return ctx.hasMedia;
    case 'mediaType': return ctx.mediaType;
    case 'type': return ctx.type;
    default: return undefined;
  }
}

function matchValue(op, actual, expected) {
  switch (op) {
    case 'is_true': return actual === true;
    case 'is_false': return actual === false;
    case 'equals': return String(actual || '') === normalizeValue(expected);
    case 'not_equals': return String(actual || '') !== normalizeValue(expected);
    case 'contains': return String(actual || '').toLowerCase().includes(normalizeValue(expected).toLowerCase());
    case 'not_contains': return !String(actual || '').toLowerCase().includes(normalizeValue(expected).toLowerCase());
    case 'starts_with': return String(actual || '').toLowerCase().startsWith(normalizeValue(expected).toLowerCase());
    case 'ends_with': return String(actual || '').toLowerCase().endsWith(normalizeValue(expected).toLowerCase());
    case 'matches_regex':
      try { return new RegExp(String(expected), 'i').test(String(actual || '')); } catch (_) { return false; }
    case 'in': return toList(expected).includes(String(actual || '').toLowerCase());
    case 'not_in': return !toList(expected).includes(String(actual || '').toLowerCase());
    default: return false;
  }
}

function evaluateRule(rule, ctx) {
  const results = rule.trigger.conditions.map((condition) => {
    const passed = matchValue(condition.op, fieldValue(ctx, condition.field), condition.value);
    return { ...condition, passed };
  });
  const matched = rule.trigger.match === 'any' ? results.some(r => r.passed) : results.every(r => r.passed);
  return { matched, conditions: results };
}

async function resolveMediaSource(value) {
  if (/^data:/.test(value)) return value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(value, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`Media URL returned HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_MEDIA_BYTES) throw new Error(`Media is larger than 25 MB (${contentLength} bytes)`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error(`Media is larger than 25 MB (${buffer.length} bytes)`);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } finally {
    clearTimeout(timer);
  }
}

class AutomationService {
  constructor() {
    this.stores = new Map(); // apiKeyHash -> { file, rules }
    this.io = null;
  }

  setIo(io) {
    this.io = io;
  }

  clear() {
    this.stores.clear();
  }

  _store(apiKey, create = true) {
    const key = hashApiKey(apiKey);
    if (!this.stores.has(key)) {
      const file = path.join(DATA_DIR, `${key}.json`);
      let rules = [];
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(raw.rules)) rules = raw.rules;
      } catch (_) { /* First run for this tenant. */ }
      if (rules.length || fs.existsSync(file)) {
        this.stores.set(key, { file, rules });
      } else if (!create) {
        return null;
      }
    }
    if (!this.stores.has(key)) this.stores.set(key, { file: path.join(DATA_DIR, `${key}.json`), rules: [] });
    return this.stores.get(key);
  }

  _save(store) {
    try {
      fs.mkdirSync(path.dirname(store.file), { recursive: true });
      const tmp = `${store.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ rules: store.rules }, null, 2), 'utf8');
      fs.renameSync(tmp, store.file);
    } catch (e) {
      console.warn('[automation] Failed to persist rules:', e.message);
    }
  }

  // ---- Public CRUD ----------------------------------------------------
  list(apiKey) {
    const store = this._store(apiKey, false);
    if (!store) return [];
    return store.rules.map(rule => ({ ...rule, trigger: 'message.received' }));
  }

  get(apiKey, id) {
    const store = this._store(apiKey, false);
    return store ? store.rules.find(r => r.id === id) || null : null;
  }

  create(apiKey, body) {
    const rule = normalizeRule(body);
    if (this._store(apiKey, true).rules.some(r => r.name.toLowerCase() === rule.name.toLowerCase())) {
      throw badRequest(`A rule named "${rule.name}" already exists`);
    }
    this._store(apiKey, true).rules.push(rule);
    this._save(this._store(apiKey, true));
    return rule;
  }

  update(apiKey, id, patch) {
    const store = this._store(apiKey, true);
    const index = store.rules.findIndex(r => r.id === id);
    if (index === -1) return null;
    const next = normalizeRule({ ...store.rules[index], ...patch, id });
    next.runCount = store.rules[index].runCount || 0;
    next.lastRunAt = store.rules[index].lastRunAt;
    next.createdAt = store.rules[index].createdAt;
    next.updatedAt = new Date().toISOString();
    store.rules[index] = next;
    this._save(store);
    return next;
  }

  remove(apiKey, id) {
    const store = this._store(apiKey, false);
    if (!store) return false;
    const before = store.rules.length;
    store.rules = store.rules.filter(r => r.id !== id);
    if (store.rules.length !== before) {
      this._save(store);
      return true;
    }
    return false;
  }

  setEnabled(apiKey, id, enabled) {
    const rule = this.get(apiKey, id);
    if (!rule) return null;
    return this.update(apiKey, id, { enabled: enabled === true || enabled === 'true' });
  }

  testMatch(apiKey, id, sample = {}) {
    const rule = this.get(apiKey, id);
    if (!rule) return null;
    const ctx = resolveContext({
      from: sample.sender ? (String(sample.sender).includes('@') ? sample.sender : `${String(sample.sender).replace(/\D/g, '')}@c.us`) : '5550001111@c.us',
      chatId: sample.chatId ? String(sample.chatId) : (String(sample.sender).includes('@g.us') ? String(sample.sender) : '2345550001111@c.us'),
      body: sample.text || '',
      type: sample.hasMedia === false ? 'chat' : (sample.mediaType || 'chat'),
    });
    return evaluateRule(rule, ctx);
  }

  // ---- Engine ----------------------------------------------------------
  handleIncomingMessage(message, apiKey, whatsappService) {
    const store = this._store(apiKey, false);
    if (!store || !store.rules.length) return Promise.resolve();
    const ctx = resolveContext(message);
    let changed = false;
    for (const rule of store.rules) {
      if (!rule.enabled) continue;
      const { matched } = evaluateRule(rule, ctx);
      if (!matched) continue;
      rule.runCount = (rule.runCount || 0) + 1;
      rule.lastRunAt = new Date().toISOString();
      changed = true;
      this._schedule(apiKey, rule, ctx, message, whatsappService);
    }
    if (changed) this._save(store);
    return Promise.resolve();
  }

  _schedule(apiKey, rule, ctx, message, whatsappService) {
    const delay = Math.max(0, Math.min(Number(rule.action?.delay) || 0, MAX_DELAY));
    const run = () => {
      this._execute(apiKey, rule, ctx, message, whatsappService).catch((error) => {
        console.error(`[automation] Rule "${rule.name}" failed:`, error.message);
        this._emit(apiKey, { ruleId: rule.id, name: rule.name, status: 'error', actionType: rule.action?.type, error: error.message, at: new Date().toISOString() });
      });
    };
    if (delay) {
      const timer = setTimeout(run, delay * 1000);
      if (timer.unref) timer.unref();
    } else {
      run();
    }
  }

  _emit(apiKey, payload) {
    this.io?.to(`session_${apiKey}`).emit('automation_event', payload);
  }

  async _execute(apiKey, rule, ctx, message, whatsappService) {
    if (whatsappService?.io && !this.io) this.io = whatsappService.io;
    const action = rule.action;
    const to = ctx.from;
    const rawId = message?.id?._serialized || message?.id || (typeof message?.id === 'string' ? message.id : undefined);
    const quotedId = rawId && (action.type === 'send_reaction' ? true : action.quoted) ? rawId : undefined;

    switch (action.type) {
      case 'send_text':
        await whatsappService.sendMessage(apiKey, to, interpolate(action.text, ctx), quotedId ? { quotedMessageId: quotedId } : undefined);
        break;
      case 'send_media': {
        const dataUrl = await resolveMediaSource(action.media);
        await whatsappService.sendFile(apiKey, to, dataUrl, action.filename || 'media', interpolate(action.caption || '', ctx) || undefined);
        break;
      }
      case 'send_reaction':
        if (action.reaction && quotedId) await whatsappService.sendReaction(apiKey, quotedId, String(action.reaction).slice(0, 8));
        break;
      case 'forward_to': {
        const dest = await whatsappService.resolveDestination(apiKey, action.to);
        if (ctx.hasMedia) {
          try {
            const media = await whatsappService.downloadMedia(apiKey, rawId);
            if (media?.dataUrl) {
              await whatsappService.sendFile(apiKey, dest, media.dataUrl, media.filename || 'media', message?.caption || '');
              break;
            }
          } catch (error) {
            console.warn(`[automation] Media relay failed, falling back to text (${error.message})`);
          }
        }
        if (ctx.text) await whatsappService.sendMessage(apiKey, dest, ctx.text);
        break;
      }
      default:
        throw new Error(`Unknown action type "${action.type}"`);
    }

    this._emit(apiKey, { ruleId: rule.id, name: rule.name, status: 'ran', actionType: action.type, at: new Date().toISOString() });
  }

  spec() {
    return {
      events: EVENT_IDS.map(id => ({ id, label: 'Message received' })),
      maxConditions: 10,
      fields: FIELDS.map(field => ({ field, label: FIELD_META[field].label, hint: FIELD_META[field].hint })),
      operators: OPS_BY_FIELD,
      operatorMeta: OP_META,
      actions: ACTION_TYPES.map(type => ({ type, label: ACTION_META[type].label, fields: ACTION_META[type].fields })),
      placeholders: PLACEHOLDERS,
    };
  }
}

module.exports = new AutomationService();