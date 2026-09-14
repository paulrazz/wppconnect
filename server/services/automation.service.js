const fs = require('fs');
const path = require('path');

// Simple in‑memory store – can be replaced by a DB later.
class AutomationService {
  constructor() {
    this.templates = new Map(); // name -> { name, content, type }
    this.rules = []; // [{ pattern: string|RegExp, action: { type, payload } }]
    // Persistent file (optional) – keep data across restarts.
    this.storagePath = path.resolve(__dirname, '..', 'automation-data.json');
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        if (Array.isArray(data.templates)) {
          data.templates.forEach(t => this.templates.set(t.name, t));
        }
        if (Array.isArray(data.rules)) this.rules = data.rules;
      }
    } catch (e) {
      console.warn('Failed to load automation data:', e.message);
    }
  }

  _save() {
    try {
      const data = {
        templates: Array.from(this.templates.values()),
        rules: this.rules,
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('Failed to persist automation data:', e.message);
    }
  }

  // ---- Templates -----------------------------------------------------
  addTemplate(name, content, type = 'text') {
    if (!name) throw new Error('Template name required');
    const tmpl = { name, content, type };
    this.templates.set(name, tmpl);
    this._save();
    return tmpl;
  }

  getTemplate(name) {
    return this.templates.get(name) || null;
  }

  listTemplates() {
    return Array.from(this.templates.values());
  }

  deleteTemplate(name) {
    const existed = this.templates.delete(name);
    if (existed) this._save();
    return existed;
  }

  // ---- Rules --------------------------------------------------------
  /**
   * pattern can be a string (exact match) or a RegExp (provided as string, e.g. "^order\\s+\\d+$")
   * action.type: 'reply' | 'template' | 'order'
   * action.payload: depends on type – for 'reply' it's a string, for 'template' it's template name, for 'order' it's a function that receives the incoming message.
   */
  addRule(pattern, action) {
    const compiled = typeof pattern === 'string' ? pattern : new RegExp(pattern, 'i');
    this.rules.push({ pattern: compiled, action });
    this._save();
    return { pattern, action };
  }

  listRules() {
    return this.rules.map(r => ({ pattern: r.pattern.toString(), action: r.action }));
  }

  deleteRule(index) {
    if (index < 0 || index >= this.rules.length) return false;
    this.rules.splice(index, 1);
    this._save();
    return true;
  }

  /**
   * Evaluate an incoming message against stored rules.
   * Returns a promise that resolves when any triggered action has been performed.
   */
  async handleIncomingMessage(message, apiKey, whatsappService) {
    const text = (message.body || message.caption || message.content || '').toString();
    for (const rule of this.rules) {
      const matches = typeof rule.pattern === 'string' ? text.includes(rule.pattern) : rule.pattern.test(text);
      if (!matches) continue;

      const { type, payload } = rule.action;
      try {
        switch (type) {
          case 'reply':
            await whatsappService.sendMessage(apiKey, message.from, payload, { quotedMessageId: message.id._serialized });
            break;
          case 'template':
            const tmpl = this.getTemplate(payload);
            if (tmpl) {
              const content = tmpl.content;
              if (tmpl.type === 'text') {
                await whatsappService.sendMessage(apiKey, message.from, content, { quotedMessageId: message.id._serialized });
              } else if (tmpl.type === 'list') {
                // Simple list payload – expects { title, button, sections }
                await whatsappService.sendList(apiKey, message.from, content);
              }
            }
            break;
          case 'order':
            if (typeof payload === 'function') {
              const orderPayload = await payload(message);
              await whatsappService.sendMessage(apiKey, message.from, orderPayload.text, { quotedMessageId: message.id._serialized });
            }
            break;
          default:
            console.warn('Unknown automation action type:', type);
        }
      } catch (e) {
        console.error('Automation action failed:', e);
      }
    }
  }
}

module.exports = new AutomationService();
