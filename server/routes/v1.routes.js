const express = require('express');
const path = require('path');
const whatsapp = require('../services/whatsapp.service');
const webhooks = require('../services/webhook.service');
const automation = require('../services/automation.service');

const crypto = require('crypto');

const router = express.Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data, meta: { requestId: res.locals.requestId } });

router.post('/provision', (req, res) => {
  const apiKey = crypto.randomBytes(32).toString('hex');
  ok(res, { apiKey, message: 'Store this key securely. It cannot be recovered.' }, 201);
});

function destination(value) {
  const input = String(value || '').trim();
  if (!input) { const error = new Error('A destination is required'); error.statusCode = 400; throw error; }
  if (/@(c\.us|g\.us|lid|newsletter)$/.test(input)) return input;
  const number = input.replace(/\D/g, '');
  if (!number) { const error = new Error('Destination must be a WhatsApp ID or international phone number'); error.statusCode = 400; throw error; }
  return `${number}@c.us`;
}

router.get('/openapi.yaml', (_req, res) => res.sendFile(path.resolve(__dirname, '..', 'openapi.yaml')));
router.get('/capabilities', (_req, res) => ok(res, {
  apiVersion: 'v1',
  messages: ['text', 'buttons', 'list', 'poll', 'file', 'image', 'video', 'audio', 'voice', 'sticker', 'location', 'contact', 'reaction'],
  events: ['message.received', 'message.sent', 'message.ack', 'message.deleted', 'message.edited', 'message.reaction', 'call.received', 'session.status', 'whatsapp.state', 'status.received', 'status.deleted'],
  resources: ['session', 'chats', 'messages', 'contacts', 'groups', 'statuses', 'events', 'deletions', 'deleted-messages', 'webhooks', 'automation'],
  documentation: '/api/v1/openapi.yaml',
}));

router.get('/session', (req, res) => ok(res, whatsapp.getStatus(res.locals.apiKey)));
router.post('/session/start', (req, res) => { void whatsapp.startSession(res.locals.apiKey).catch(() => {}); ok(res, whatsapp.getStatus(res.locals.apiKey), 202); });
router.post('/session/stop', async (req, res) => { await whatsapp.stopSession(res.locals.apiKey); ok(res, whatsapp.getStatus(res.locals.apiKey)); });
router.delete('/session', async (req, res) => { await whatsapp.logoutSession(res.locals.apiKey); ok(res, whatsapp.getStatus(res.locals.apiKey)); });
router.get('/chats', async (req, res) => ok(res, await whatsapp.getChats(res.locals.apiKey, req.query)));
router.get('/chats/:chatId/messages', async (req, res) => {
  res.setHeader('x-message-read-receipts', 'disabled');
  ok(res, await whatsapp.getMessages(res.locals.apiKey, req.params.chatId, req.query.limit));
});
router.get('/contacts', async (req, res) => ok(res, await whatsapp.getContacts(res.locals.apiKey)));
router.get('/contacts/:contactId/identity', async (req, res) => ok(res, await whatsapp.inspectIdentity(res.locals.apiKey, req.params.contactId)));
router.get('/groups', async (req, res) => ok(res, await whatsapp.getGroups(res.locals.apiKey)));
router.get('/statuses', async (req, res) => {
  res.setHeader('x-status-read-receipts', 'disabled');
  ok(res, { items: await whatsapp.getStatuses(res.locals.apiKey), privacyMode: 'no-read-receipts' });
});
router.get('/media/:messageId', async (req, res) => ok(res, await whatsapp.downloadMedia(res.locals.apiKey, req.params.messageId)));
router.get('/events', async (req, res) => ok(res, await whatsapp.getEvents(req.query)));
router.get('/deleted-messages', async (req, res) => ok(res, await whatsapp.getDeletedMessages(req.query)));
router.get('/deletions', async (req, res) => ok(res, await whatsapp.getDeletions(req.query)));

router.post('/messages/text', async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) { const error = new Error('Message text is required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendMessage(res.locals.apiKey, destination(req.body.to), text), 201);
});
router.post('/messages/buttons', async (req, res) => {
  const text = String(req.body.text || '').trim();
  const buttons = req.body.buttons;
  if (!text || !Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) { const error = new Error('Message text and between 1 and 3 buttons are required'); error.statusCode = 400; throw error; }
  const kinds = new Set(buttons.map(button => button.url ? 'url' : button.phoneNumber ? 'phone' : 'reply'));
  if (kinds.has('reply') && kinds.size > 1) { const error = new Error('WhatsApp cannot mix reply buttons with URL or phone buttons. Choose one button mode.'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendMessage(res.locals.apiKey, destination(req.body.to), text, { useTemplateButtons: true, buttons: req.body.buttons, title: req.body.title, footer: req.body.footer }), 201);
});
router.post('/messages/list', async (req, res) => {
  if (!req.body.options?.sections?.length) { const error = new Error('options.sections is required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendList(res.locals.apiKey, destination(req.body.to), req.body.options), 201);
});
router.post('/messages/poll', async (req, res) => {
  if (!req.body.name || !Array.isArray(req.body.choices) || req.body.choices.length < 2) { const error = new Error('name and at least two choices are required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendPoll(res.locals.apiKey, destination(req.body.to), req.body.name, req.body.choices, req.body.options), 201);
});
router.post('/messages/reaction', async (req, res) => {
  if (!req.body.messageId || !('reaction' in req.body)) { const error = new Error('messageId and reaction are required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendReaction(res.locals.apiKey, req.body.messageId, req.body.reaction), 201);
});
router.post('/messages/file', async (req, res) => {
  if (!req.body.dataUrl || !req.body.filename) { const error = new Error('dataUrl and filename are required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendFile(res.locals.apiKey, destination(req.body.to), req.body.dataUrl, req.body.filename, req.body.caption), 201);
});
router.post('/messages/sticker', async (req, res) => {
  if (!req.body.dataUrl) { const error = new Error('dataUrl is required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendSticker(res.locals.apiKey, destination(req.body.to), req.body.dataUrl), 201);
});
router.post('/messages/location', async (req, res) => {
  const { latitude, longitude, title } = req.body;
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) { const error = new Error('Valid latitude and longitude are required'); error.statusCode = 400; throw error; }
  ok(res, await whatsapp.sendLocation(res.locals.apiKey, destination(req.body.to), latitude, longitude, title), 201);
});
router.post('/messages/contact', async (req, res) => ok(res, await whatsapp.sendContact(res.locals.apiKey, destination(req.body.to), destination(req.body.contact), req.body.name), 201));

router.get('/webhooks', (_req, res) => ok(res, webhooks.list()));
router.post('/webhooks', async (req, res) => ok(res, await webhooks.create(req.body), 201));
router.delete('/webhooks/:id', (req, res) => {
  if (!webhooks.remove(req.params.id)) { const error = new Error('Webhook not found'); error.statusCode = 404; throw error; }
  ok(res, { deleted: true });
});

// ---- Automation rules (visual playground) ----------------------------
router.get('/automation', (req, res) => {
  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId.trim() : '';
  ok(res, automation.list(res.locals.apiKey, chatId || undefined));
});
router.get('/automation/spec', (_req, res) => ok(res, automation.spec()));
router.get('/automation/config', (req, res) => ok(res, automation.getConfig(res.locals.apiKey)));
router.put('/automation/config', (req, res) => ok(res, automation.setConfig(res.locals.apiKey, req.body || {})));
router.post('/automation', (req, res) => ok(res, automation.create(res.locals.apiKey, req.body || {}), 201));
router.put('/automation/:id', (req, res) => {
  const rule = automation.update(res.locals.apiKey, req.params.id, req.body || {});
  if (!rule) { const error = new Error('Automation rule not found'); error.statusCode = 404; throw error; }
  ok(res, rule);
});
router.delete('/automation/:id', (req, res) => {
  if (!automation.remove(res.locals.apiKey, req.params.id)) { const error = new Error('Automation rule not found'); error.statusCode = 404; throw error; }
  ok(res, { deleted: true });
});
router.post('/automation/:id/test', (req, res) => {
  const rule = automation.get(res.locals.apiKey, req.params.id);
  if (!rule) { const error = new Error('Automation rule not found'); error.statusCode = 404; throw error; }
  ok(res, { rule: { id: rule.id, name: rule.name }, match: automation.testMatch(res.locals.apiKey, req.params.id, req.body || {}) });
});

module.exports = router;
