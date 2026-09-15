const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const eventStore = require('./event-store.service');

// Per-tenant automation engine. Rules are stored as JSON on the persistent
// volume (server/data/automation/<apiKeyHash>.json), so restarts and Railway
// deploys keep their state. The playground in the Developer docs configures
// these rules; this engine evaluates live WhatsApp events against them and
// runs the matched action (optionally after a delay), reusing the WhatsApp
// client owned by whatsapp.service.js.

// Trigger sources. The first derives from a chat message; the rest are their
// own event streams (statuses, mentions, quotes, reactions, deletions, calls,
// group membership changes).
const EVENT_IDS = [
  'message.received',
  'message.quote',
  'message.mention',
  'message.reaction',
  'message.deleted',
  'status.received',
  'status.deleted',
  'call.received',
  'group.participant_changed',
];

const EVENT_LABELS = {
  'message.received': 'A message is received',
  'message.quote': 'A quoted / reply message is received',
  'message.mention': 'A message that mentions someone is received',
  'message.reaction': 'A message is reacted to',
  'message.deleted': 'A message is deleted',
  'status.received': 'A status is posted',
  'status.deleted': 'A status is deleted',
  'call.received': 'An incoming / missed call',
  'group.participant_changed': 'Group members join, leave or are changed',
};

const EVENT_DESCRIPTIONS = {
  'message.received': 'Runs for every incoming chat message.',
  'message.quote': 'Runs when a message that quotes / replies to an earlier message arrives.',
  'message.mention': 'Runs when a message that @-mentions someone arrives.',
  'message.reaction': 'Runs when a reaction (emoji) is added to a message.',
  'message.deleted': 'Runs when you are told a message was deleted (or you delete yours).',
  'status.received': 'Runs when a contact posts a status update.',
  'status.deleted': 'Runs when a status update disappears.',
  'call.received': 'Runs on an incoming or missed voice / video call.',
  'group.participant_changed': 'Runs when someone is added, removed, joins, leaves, or is promoted / demoted in a group you are in.',
};

// The condition fields that make sense for each trigger. Matching is verified
// against this so a rule can never reference a field its event does not carry.
const EVENT_FIELDS = {
  'message.received': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'fromMe', 'text', 'hasMedia', 'mediaType', 'type', 'mentionsMe', 'isQuotingMe'],
  'message.quote': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'fromMe', 'text', 'isQuotingMe', 'quotedText', 'mediaType', 'hasMedia'],
  'message.mention': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'fromMe', 'text', 'mentionsMe', 'mediaType', 'hasMedia'],
  'message.reaction': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'reaction'],
  'message.deleted': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'fromMe', 'text', 'hasMedia', 'mediaType', 'recoveryStatus'],
  'status.received': ['sender', 'senderName', 'contactName', 'text', 'hasMedia', 'mediaType', 'type'],
  'status.deleted': ['sender', 'senderName', 'text', 'recoveryStatus'],
  'call.received': ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'callKind', 'isVideo', 'fromMe'],
  'group.participant_changed': ['chatId', 'groupName', 'action', 'actor', 'participant', 'senderName', 'byMe'],
};

// Map every trigger to the default condition the builder starts with, so
// switching triggers always produces a valid first condition.
const EVENT_DEFAULT_CONDITION = (event) =>
  event === 'message.reaction' ? { field: 'reaction', op: 'equals', value: '👍' } :
  event === 'call.received' ? { field: 'callKind', op: 'equals', value: 'voice' } :
  event === 'group.participant_changed' ? { field: 'action', op: 'equals', value: 'add' } :
  event === 'message.quote' ? { field: 'isQuotingMe', op: 'is_true', value: true } :
  event === 'message.mention' ? { field: 'mentionsMe', op: 'is_true', value: true } :
  event === 'message.deleted' || event === 'status.deleted' ? { field: 'sender', op: 'equals', value: '' } :
  event === 'status.received' ? { field: 'sender', op: 'equals', value: '' } :
  event === 'message.received' ? { field: 'text', op: 'contains', value: '' } :
  { field: 'sender', op: 'equals', value: '' };

const FIELDS = ['sender', 'senderName', 'contactName', 'chatId', 'groupName', 'isGroup', 'fromMe', 'text', 'hasMedia', 'mediaType', 'type', 'mentionsMe', 'isQuotingMe', 'quotedText', 'reaction', 'action', 'actor', 'participant', 'byMe', 'callKind', 'isVideo', 'recoveryStatus'];

const STRING_OPS = ['equals', 'not_equals', 'contains', 'in', 'not_in'];
const TEXT_OPS = ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'matches_regex', 'in', 'not_in'];
const BOOL_OPS = ['is_true', 'is_false'];

const OPS_BY_FIELD = {
  sender: STRING_OPS,
  senderName: STRING_OPS,
  contactName: STRING_OPS,
  chatId: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'in', 'not_in'],
  groupName: STRING_OPS,
  isGroup: BOOL_OPS,
  fromMe: BOOL_OPS,
  text: TEXT_OPS,
  hasMedia: BOOL_OPS,
  mediaType: ['equals', 'not_equals', 'in', 'not_in'],
  type: ['equals', 'not_equals', 'in', 'not_in'],
  mentionsMe: BOOL_OPS,
  isQuotingMe: BOOL_OPS,
  quotedText: TEXT_OPS,
  reaction: ['equals', 'not_equals', 'in', 'not_in'],
  action: ['equals', 'not_equals', 'in', 'not_in'],
  actor: STRING_OPS,
  participant: ['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in'],
  byMe: BOOL_OPS,
  callKind: ['equals', 'not_equals', 'in', 'not_in'],
  isVideo: BOOL_OPS,
  recoveryStatus: ['equals', 'not_equals', 'in', 'not_in'],
};

const BOOL_FIELDS = new Set(['isGroup', 'fromMe', 'hasMedia', 'mentionsMe', 'isQuotingMe', 'byMe', 'isVideo']);

const FIELD_META = {
  sender: { label: 'Sender', hint: 'WhatsApp ID of the sender / actor, e.g. 2348012345678@c.us or 1234567890@g.us' },
  senderName: { label: 'WhatsApp name', hint: 'Profile name the sender chose in WhatsApp' },
  contactName: { label: 'Saved name', hint: 'The name you saved this contact under in your phone book' },
  chatId: { label: 'Chat / Group', hint: 'Chat or group ID the event occurred in' },
  groupName: { label: 'Group name', hint: 'Name / subject of the group' },
  isGroup: { label: 'Is a group chat', hint: 'Matches when the event is from a group' },
  fromMe: { label: 'From my number', hint: 'Matches events involving my own account' },
  text: { label: 'Message text', hint: 'Body or caption of the message / status' },
  hasMedia: { label: 'Has media', hint: 'Matches when an image, video, audio, document or sticker is present' },
  mediaType: { label: 'Media type', hint: 'image, video, gif, audio, ptt, sticker or document' },
  type: { label: 'Message type', hint: 'The internal WhatsApp type, e.g. chat / image / vcard' },
  mentionsMe: { label: 'Mentions me', hint: 'True when the message @-mentions my number' },
  isQuotingMe: { label: 'Quotes one of my messages', hint: 'True when the reply quotes a message I sent' },
  quotedText: { label: 'Quoted text', hint: 'The text of the message being quoted' },
  reaction: { label: 'Reaction', hint: 'The emoji used for the reaction, e.g. 👍' },
  action: { label: 'Member action', hint: 'add, remove, join, leaver, promote or demote' },
  actor: { label: 'Actor', hint: 'WhatsApp ID of the person who performed the action' },
  participant: { label: 'Affected members', hint: 'Comma-separated WhatsApp IDs of the members added / removed / promoted' },
  byMe: { label: 'Done by me', hint: 'True when I performed the action' },
  callKind: { label: 'Call type', hint: 'voice or video' },
  isVideo: { label: 'Video call', hint: 'True for a video call' },
  recoveryStatus: { label: 'Recovery status', hint: 'recovered, not-observed or probable-sender-match' },
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
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },
  send_media: {
    label: 'Send media / a file',
    fields: [
      { name: 'media', label: 'File URL or data URL', type: 'text', required: true },
      { name: 'filename', label: 'Filename', type: 'text' },
      { name: 'caption', label: 'Caption', type: 'textarea' },
      { name: 'quoted', label: 'Quote the received message', type: 'bool', default: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },
  send_reaction: {
    label: 'React with an emoji',
    fields: [
      { name: 'reaction', label: 'Emoji', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },
  forward_to: {
    label: 'Relay / forward to another chat',
    fields: [
      { name: 'to', label: 'Destination chat or number', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },
};

const PLACEHOLDERS = [
  { token: '{name}', label: 'WhatsApp profile name' },
  { token: '{contactName}', label: 'Saved phone-book name' },
  { token: '{number}', label: 'Sender phone number' },
  { token: '{from}', label: 'Sender WhatsApp ID' },
  { token: '{chatId}', label: 'Chat / group ID' },
  { token: '{groupName}', label: 'Group name' },
  { token: '{text}', label: 'Message text' },
  { token: '{reaction}', label: 'Reaction emoji' },
  { token: '{mediaType}', label: 'Media type (image, video, …)' },
  { token: '{type}', label: 'Message type' },
  { token: '{time}', label: 'Local time' },
];

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'automation');
const MAX_PATTERN_LENGTH = 512;
const MAX_DELAY = 3600;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image', 'video', 'gif', 'audio', 'ptt', 'sticker', 'document']);

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 32);
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value?._serialized || value?.id || value?.user || '';
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

function normalizeCondition(condition, index, event) {
  if (!condition || typeof condition !== 'object') throw badRequest(`Condition #${index + 1} is invalid`);
  const field = condition.field;
  if (!FIELDS.includes(field)) throw badRequest(`Condition #${index + 1}: unknown field "${field}"`);
  if (!(EVENT_FIELDS[event] || []).includes(field)) {
    throw badRequest(`Condition #${index + 1}: field "${FIELD_META[field]?.label || field}" is not available for the "${EVENT_LABELS[event] || event}" trigger`);
  }
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
  const conditions = rawConditions.map((condition, index) => normalizeCondition(condition, index, event));
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
  const sender = ctx?.sender || ctx?.from || '';
  const values = {
    name: ctx?.senderName || '',
    contactName: ctx?.contactName || '',
    number: sender.replace(/\D/g, ''),
    from: sender,
    chatId: ctx?.chatId || '',
    groupName: ctx?.groupName || '',
    text: ctx?.text || '',
    reaction: ctx?.reaction || '',
    mediaType: ctx?.mediaType || '',
    type: ctx?.type || '',
    quotedText: ctx?.quotedText || '',
    action: ctx?.action || '',
    actor: ctx?.actor || '',
    participant: ctx?.participant || '',
    recoveryStatus: ctx?.recoveryStatus || '',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  return String(template || '').replace(/\{(name|contactName|number|from|chatId|groupName|text|reaction|mediaType|type|quotedText|action|actor|participant|recoveryStatus|time)\}/g, (_, key) => values[key]);
}

// Contact name sources, arranged so the WhatsApp profile name and the saved
// phone-book name can be resolved independently ({name} vs {contactName}).
function senderNamesFrom(message) {
  const ns = message || {};
  const notify = ns.notifyName || ns.pushName || ns.sender?.pushname || ns.senderObj?.pushname || ns.senderName || '';
  const saved = ns.contactName || ns.sender?.name || ns.sender?.formattedName || ns.senderObj?.name || ns.senderObj?.formattedName || '';
  return {
    senderName: notify || saved,
    contactName: saved || notify,
  };
}

function mentionedMe(message, selfId) {
  const mentioned = (message?.mentionedJidList || []).map(idOf).filter(Boolean);
  if (!mentioned.length) return false;
  if (!selfId) return true; // self id unavailable: treat any mention as a likely mention of me
  return mentioned.includes(selfId);
}

function quotesMe(message, selfId) {
  const quotedId = idOf(message?.quotedMsgId);
  const quotedOriginal = quotedId ? eventStore.getMessage(quotedId) : null;
  if (quotedOriginal?.fromMe) return true;
  const participant = idOf(message?.quotedParticipant);
  return Boolean(selfId && participant && participant === selfId);
}

function resolveContext(message, overrides = {}) {
  const source = message && typeof message === 'object' ? message : {};
  let from = idOf(source?.from) || idOf(source?.author) || idOf(source?.sender?.id) || idOf(source?.senderObj) || overrides.from || '';
  if (from === 'status@broadcast') from = idOf(source?.author) || from;
  const chatId = overrides.chatId !== undefined
    ? overrides.chatId
    : (idOf(source?.chatId) || idOf(source?.to) || from);
  const groupJid = /@g\.us$/.test(chatId) || /@g\.us$/.test(from);
  const body = String(source?.body ?? source?.caption ?? source?.content ?? source?.text ?? overrides.text ?? '');
  const text = /^data:.+;base64,/.test(body) ? '' : body;
  const type = String(overrides.type !== undefined ? overrides.type : (source?.type || '')).toLowerCase();
  const mediaType = overrides.mediaType !== undefined
    ? overrides.mediaType
    : (MEDIA_TYPES.has(type) ? type : '');
  const names = overrides.senderNames || senderNamesFrom(source);
  return {
    from,
    sender: idOf(source?.author) || from,
    chatId,
    isGroup: groupJid || idOf(source?.isGroupMsg) === 'true' || source?.isGroupMsg === true || source?.isGroup === true,
    fromMe: source?.fromMe === true || source?.isSentByMe === true,
    text,
    mediaType: String(mediaType || ''),
    hasMedia: Boolean(mediaType) || source?.isMedia === true,
    type,
    senderName: names.senderName || '',
    contactName: names.contactName || '',
    groupName: overrides.groupName || source?.groupName || source?.chatName || '',
    mentionsMe: overrides.mentionsMe !== undefined ? overrides.mentionsMe : mentionedMe(source, overrides.selfId || ''),
    isQuotingMe: overrides.isQuotingMe !== undefined ? overrides.isQuotingMe : quotesMe(source, overrides.selfId || ''),
    quotedText: overrides.quotedText || (() => {
      const original = idOf(source?.quotedMsgId) ? eventStore.getMessage(idOf(source?.quotedMsgId)) : null;
      return original ? String(original.body || original.caption || original.content || '') : '';
    })(),
    reaction: '',
    action: '',
    actor: '',
    participant: '',
    byMe: false,
    callKind: '',
    isVideo: false,
    recoveryStatus: overrides.recoveryStatus || '',
  };
}

// Best-effort name resolution from the live session's caches (group subjects
// and the contact list). Used for events that carry no sender object (calls,
// reactions, group changes, deletions).
function sessionLookup(whatsappService, apiKey, jid) {
  const names = { senderName: '', contactName: '', groupName: '' };
  const session = whatsappService?.getSession?.(apiKey);
  if (!session) return names;
  const clean = idOf(jid);
  if (!clean) return names;
  if (/@g\.us$/.test(clean)) names.groupName = session.groupNameCache?.get?.(clean) || '';
  const contact = (session.contactsCache?.data || []).find(c => idOf(c.id) === clean);
  if (contact) {
    names.contactName = contact.name || contact.formattedName || contact.shortName || '';
    names.senderName = contact.pushname || contact.notifyName || contact.formattedName || contact.name || '';
  }
  return names;
}

// Maps a raw event payload to a normalized condition/interpolation context.
// Events that are message-shaped funnel through resolveContext; the rest build
// their own context (with names filled in from the session when available).
function buildContext(event, data, env = {}) {
  const whatsappService = env.whatsappService;
  const apiKey = env.apiKey;
  const selfId = env.selfId || '';
  const payload = data && typeof data === 'object' ? data : {};
  const lookup = jid => sessionLookup(whatsappService, apiKey, jid);

  if (['message.received', 'message.quote', 'message.mention'].includes(event)) {
    return resolveContext(payload, { selfId });
  }

  if (event === 'message.deleted') {
    const original = payload.original && typeof payload.original === 'object' ? payload.original : {};
    const chatId = payload.chatId || idOf(original.chatId) || idOf(original.from) || idOf(payload.from);
    const groupNames = /@g\.us$/.test(chatId) ? lookup(chatId) : {};
    const ctx = resolveContext(original, {
      selfId,
      from: payload.from || idOf(original.author) || idOf(original.from),
      chatId,
      groupName: payload.chatName || groupNames.groupName,
      senderNames: (() => {
        const names = lookup(idOf(original.author) || original.from || original.sender);
        const own = senderNamesFrom(original);
        return {
          senderName: own.senderName || names.senderName,
          contactName: own.contactName || names.contactName,
        };
      })(),
    });
    ctx.recoveryStatus = payload.recoveryStatus || 'not-observed';
    return ctx;
  }

  if (event === 'status.received') {
    const ctx = resolveContext(payload, { selfId, chatId: 'status@broadcast' });
    ctx.isGroup = false;
    return ctx;
  }

  if (event === 'status.deleted') {
    const original = payload.original && typeof payload.original === 'object' ? payload.original : {};
    const sender = payload.author || payload.from || idOf(original.author) || idOf(original.from) || '';
    const names = lookup(sender);
    return {
      from: sender,
      sender,
      chatId: 'status@broadcast',
      isGroup: false,
      fromMe: false,
      text: original.body || original.caption || original.content || payload.text || '',
      mediaType: '',
      hasMedia: false,
      type: 'status',
      senderName: names.senderName || original.notifyName || '',
      contactName: names.contactName,
      groupName: '',
      mentionsMe: false,
      isQuotingMe: false,
      quotedText: '',
      reaction: '',
      action: '',
      actor: '',
      participant: '',
      byMe: false,
      callKind: '',
      isVideo: false,
      recoveryStatus: payload.recoveryStatus || 'not-observed',
    };
  }

  if (event === 'message.reaction') {
    const reacted = payload.msgId ? eventStore.getMessage(idOf(payload.msgId)) : null;
    const chatId = payload.chatId || idOf(reacted?.chatId) || idOf(reacted?.from) || '';
    const sender = payload.sender || idOf(reacted?.author) || '';
    const names = lookup(sender);
    const groupNames = /@g\.us$/.test(chatId) ? lookup(chatId) : {};
    return {
      from: chatId,
      sender,
      chatId,
      isGroup: /@g\.us$/.test(chatId),
      fromMe: false,
      text: payload.text || '',
      mediaType: '',
      hasMedia: false,
      type: 'reaction',
      senderName: payload.senderName || names.senderName,
      contactName: payload.contactName || names.contactName,
      groupName: groupNames.groupName || '',
      mentionsMe: false,
      isQuotingMe: false,
      quotedText: '',
      reaction: String(payload.reaction || payload.reactionText || ''),
      action: '',
      actor: '',
      participant: '',
      byMe: false,
      callKind: '',
      isVideo: false,
      recoveryStatus: '',
    };
  }

  if (event === 'call.received') {
    const chatId = payload.groupJid || payload.peerJid || payload.from || '';
    const sender = payload.peerJid || payload.from || idOf(payload.id);
    const names = lookup(sender);
    const groupNames = /@g\.us$/.test(chatId) ? lookup(chatId) : {};
    return {
      from: chatId,
      sender,
      chatId,
      isGroup: Boolean(payload.isGroup) || /@g\.us$/.test(chatId),
      fromMe: Boolean(payload.outgoing),
      text: payload.text || '',
      mediaType: '',
      hasMedia: false,
      type: 'call',
      senderName: payload.senderName || names.senderName,
      contactName: payload.contactName || names.contactName,
      groupName: groupNames.groupName || payload.groupName || '',
      mentionsMe: false,
      isQuotingMe: false,
      quotedText: '',
      reaction: '',
      action: '',
      actor: '',
      participant: '',
      byMe: false,
      callKind: payload.isVideo ? 'video' : 'voice',
      isVideo: Boolean(payload.isVideo),
      recoveryStatus: '',
    };
  }

  if (event === 'group.participant_changed') {
    const groupId = payload.groupId || payload.chatId || '';
    const actor = payload.by || payload.actor || '';
    const names = lookup(actor);
    const groupNames = lookup(groupId);
    return {
      from: groupId,
      sender: actor,
      chatId: groupId,
      isGroup: true,
      fromMe: false,
      text: payload.text || '',
      mediaType: '',
      hasMedia: false,
      type: 'participant',
      senderName: payload.byPushName || names.senderName,
      contactName: names.contactName,
      groupName: groupNames.groupName || payload.chatName || '',
      mentionsMe: false,
      isQuotingMe: false,
      quotedText: '',
      reaction: '',
      action: payload.action || payload.operation || '',
      actor,
      participant: Array.isArray(payload.who) ? payload.who.join(', ') : String(payload.who || ''),
      byMe: Boolean(payload.byMe) || Boolean(selfId && actor && actor === selfId),
      callKind: '',
      isVideo: false,
      recoveryStatus: '',
    };
  }

  return null;
}

function fieldValue(ctx, field) {
  switch (field) {
    case 'sender': return ctx.sender || ctx.from;
    case 'senderName': return ctx.senderName;
    case 'contactName': return ctx.contactName;
    case 'chatId': return ctx.chatId;
    case 'groupName': return ctx.groupName;
    case 'isGroup': return ctx.isGroup === true;
    case 'fromMe': return ctx.fromMe === true;
    case 'text': return ctx.text || '';
    case 'hasMedia': return ctx.hasMedia === true;
    case 'mediaType': return ctx.mediaType || '';
    case 'type': return ctx.type || '';
    case 'mentionsMe': return ctx.mentionsMe === true;
    case 'isQuotingMe': return ctx.isQuotingMe === true;
    case 'quotedText': return ctx.quotedText || '';
    case 'reaction': return ctx.reaction || '';
    case 'action': return ctx.action || '';
    case 'actor': return ctx.actor || '';
    case 'participant': return ctx.participant || '';
    case 'byMe': return ctx.byMe === true;
    case 'callKind': return ctx.callKind || '';
    case 'isVideo': return ctx.isVideo === true;
    case 'recoveryStatus': return ctx.recoveryStatus || '';
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
  const results = (rule.trigger.conditions || []).map((condition) => {
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

const MESSAGE_EVENTS = new Set(['message.received', 'message.quote', 'message.mention']);

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
    return store.rules;
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
    const event = rule.trigger.event;
    const sender = sample.sender != null && String(sample.sender).trim()
      ? (String(sample.sender).includes('@') ? String(sample.sender) : `${String(sample.sender).replace(/\D/g, '')}@c.us`)
      : '5550001111@c.us';
    const data = {
      from: sender,
      author: sender,
      chatId: sample.chatId || (String(sample.sender || '').includes('@g.us') ? String(sample.sender) : '2345550001111@c.us'),
      body: sample.text || '',
      type: sample.hasMedia === false || sample.mediaType ? (sample.mediaType || 'chat') : 'chat',
      ...(sample.event ? {} : sample),
    };
    const ctx = buildContext(event, data, {});
    return ctx ? evaluateRule(rule, ctx) : { matched: false, conditions: [] };
  }

  // ---- Engine ----------------------------------------------------------
  // Entry point for every non-message event stream. Only rules whose trigger
  // matches `event` are evaluated, so one message can fire received + mention
  // + quote rules independently without cross-trigger interference.
  async handleEvent(apiKey, event, data, whatsappService) {
    if (!EVENT_IDS.includes(event)) return;
    const store = this._store(apiKey, false);
    if (!store || !store.rules.length) return;
    const session = whatsappService?.getSession?.(apiKey);
    const ctx = buildContext(event, data, { apiKey, whatsappService, selfId: session?.myJid || '' });
    if (!ctx) return;
    let changed = false;
    for (const rule of store.rules) {
      if (!rule.enabled || rule.trigger.event !== event) continue;
      const { matched } = evaluateRule(rule, ctx);
      if (!matched) continue;
      rule.runCount = (rule.runCount || 0) + 1;
      rule.lastRunAt = new Date().toISOString();
      changed = true;
      this._schedule(apiKey, rule, ctx, data, whatsappService);
    }
    if (changed) this._save(store);
  }

  // Backwards-compatible alias shipped on the message.received path. Kept so
  // whatsapp.service.js keeps one obvious call site for chat messages.
  handleIncomingMessage(message, apiKey, whatsappService) {
    return this.handleEvent(apiKey, 'message.received', message, whatsappService);
  }

  _schedule(apiKey, rule, ctx, eventData, whatsappService) {
    const delay = Math.max(0, Math.min(Number(rule.action?.delay) || 0, MAX_DELAY));
    const run = () => {
      this._execute(apiKey, rule, ctx, eventData, whatsappService).catch((error) => {
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

  async _execute(apiKey, rule, ctx, eventData, whatsappService) {
    if (whatsappService?.io && !this.io) this.io = whatsappService.io;
    const action = rule.action;
    const to = ctx.from || ctx.chatId;
    const event = rule.trigger.event;
    const rawMessage = MESSAGE_EVENTS.has(event) && eventData && typeof eventData === 'object' ? eventData : null;
    const rawId = rawMessage?.id?._serialized || rawMessage?.id || (typeof rawMessage?.id === 'string' ? rawMessage?.id : undefined);
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
        else if (action.reaction && rawMessage?.id) await whatsappService.sendReaction(apiKey, idOf(rawMessage.id), String(action.reaction).slice(0, 8));
        break;
      case 'forward_to': {
        const dest = await whatsappService.resolveDestination(apiKey, action.to);
        const media = rawMessage ? await whatsappService.downloadMedia(apiKey, rawId).catch(() => null) : null;
        if (ctx.hasMedia && media?.dataUrl) {
          await whatsappService.sendFile(apiKey, dest, media.dataUrl, media.filename || 'media', ctx.text);
        } else if (ctx.text) {
          await whatsappService.sendMessage(apiKey, dest, ctx.text);
        }
        break;
      }
      default:
        throw new Error(`Unknown action type "${action.type}"`);
    }

    this._emit(apiKey, { ruleId: rule.id, name: rule.name, status: 'ran', actionType: action.type, at: new Date().toISOString() });
  }

  spec() {
    return {
      events: EVENT_IDS.map(id => ({
        id,
        label: EVENT_LABELS[id] || id,
        description: EVENT_DESCRIPTIONS[id] || '',
        fields: EVENT_FIELDS[id] || [],
        defaultCondition: EVENT_DEFAULT_CONDITION(id),
      })),
      maxConditions: 10,
      fields: FIELDS.map(field => ({ field, label: FIELD_META[field]?.label || field, hint: FIELD_META[field]?.hint || '' })),
      operators: OPS_BY_FIELD,
      operatorMeta: OP_META,
      actions: ACTION_TYPES.map(type => ({ type, label: ACTION_META[type].label, fields: ACTION_META[type].fields })),
      placeholders: PLACEHOLDERS,
    };
  }
}

module.exports = new AutomationService();