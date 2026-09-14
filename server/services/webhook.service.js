const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const SUPPORTED_EVENTS = new Set(['*', 'message.received', 'message.sent', 'message.ack', 'message.deleted', 'message.edited', 'message.reaction', 'call.received', 'session.status', 'whatsapp.state', 'status.received', 'status.deleted']);

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return true;
}

async function validateWebhookUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('Webhook URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Webhook URL must use http or https');
  if (parsed.username || parsed.password) throw new Error('Webhook URL must not contain credentials');
  if (process.env.WEBHOOK_ALLOW_PRIVATE !== 'true') {
    const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error('Webhook URL resolves to a private or reserved network');
  }
  return parsed;
}

class WebhookService {
  constructor() {
    this.file = path.resolve(__dirname, '..', 'data', 'webhooks.json');
    this.webhooks = [];
    this.load();
  }

  load() {
    try { this.webhooks = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { this.webhooks = []; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.webhooks, null, 2));
  }

  list() { return this.webhooks.map(({ secret, ...item }) => ({ ...item, hasSecret: Boolean(secret) })); }

  async create({ url, events = ['*'], secret = '' } = {}) {
    const parsed = await validateWebhookUrl(url);
    if (!Array.isArray(events) || !events.length || events.some(event => !SUPPORTED_EVENTS.has(event))) throw new Error('Webhook events contain an unsupported event name');
    if (typeof secret !== 'string' || secret.length > 512) throw new Error('Webhook secret must be a string of at most 512 characters');
    const webhook = { id: crypto.randomUUID(), url: parsed.toString(), events: [...new Set(events)], secret, active: true, createdAt: new Date().toISOString() };
    this.webhooks.push(webhook);
    this.save();
    return { ...webhook, secret: undefined, hasSecret: Boolean(secret) };
  }

  remove(id) {
    const before = this.webhooks.length;
    this.webhooks = this.webhooks.filter(item => item.id !== id);
    this.save();
    return this.webhooks.length < before;
  }

  async emit(event, data) {
    const envelope = { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data };
    const body = JSON.stringify(envelope);
    for (const webhook of this.webhooks.filter(item => item.active && (item.events.includes('*') || item.events.includes(event)))) {
      const signature = webhook.secret ? crypto.createHmac('sha256', webhook.secret).update(body).digest('hex') : '';
      void this.deliver(webhook, body, signature, 0);
    }
    return envelope;
  }

  async deliver(webhook, body, signature, attempt) {
    try {
      // Re-resolve before each delivery to protect against DNS rebinding.
      await validateWebhookUrl(webhook.url);
      const response = await fetch(webhook.url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'user-agent': 'WPPConnect-Webhook/1.0', 'x-wpp-event': JSON.parse(body).event, 'x-wpp-signature': signature ? `sha256=${signature}` : '' }, body, signal: AbortSignal.timeout(Math.min(Math.max(Number(process.env.WEBHOOK_TIMEOUT_MS) || 10000, 1000), 30000)) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt < 2) setTimeout(() => this.deliver(webhook, body, signature, attempt + 1), 1000 * (2 ** attempt));
      else console.error(`Webhook ${webhook.id} failed:`, error.message);
    }
  }
}

module.exports = new WebhookService();
module.exports.isPrivateAddress = isPrivateAddress;
module.exports.validateWebhookUrl = validateWebhookUrl;
