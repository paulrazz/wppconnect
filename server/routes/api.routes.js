const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');

// Start the WhatsApp session
router.post('/start-session', async (req, res) => {
  try {
    void whatsappService.startSession().catch(() => {});
    res.status(202).json({ message: 'Session start initiated', ...whatsappService.getStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop the WhatsApp session (Disconnects browser but stays logged in)
router.post('/stop-session', async (req, res) => {
  try {
    await whatsappService.stopSession();
    res.json({ message: 'Session stopped' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout of WhatsApp session (Unlinks device entirely)
router.post('/logout-session', async (req, res) => {
  try {
    await whatsappService.logoutSession();
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset the WhatsApp session
router.post('/reset-session', async (req, res) => {
  try {
    await whatsappService.resetSession();
    res.json({ message: 'Session reset' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session status
router.get('/status', (req, res) => {
  res.json(whatsappService.getStatus());
});

// Send a message
router.post('/send-message', async (req, res) => {
  const { to, text } = req.body;
  
  if (!to || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "to" or "text" in request body' });
  }

  try {
    console.log(`Sending message to: ${to}, Text: ${text}`);
    const cleanTo = String(to).trim();
    // Preserve every WhatsApp JID that the chat list can return. In particular,
    // converting an @lid chat to @c.us discards its identity and makes the
    // WhatsApp sender fail with "No LID for user".
    const formattedTo = /@(c\.us|g\.us|lid|newsletter)$/.test(cleanTo)
      ? cleanTo
      : `${cleanTo.replace(/\D/g, '')}@c.us`;
    const response = await whatsappService.sendMessage(formattedTo, text.trim());
    console.log('Message sent successfully:', response);
    res.json(response);
  } catch (error) {
    console.error('Send message failed in API route:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/send-file', async (req, res) => {
  const { to, dataUrl, filename, caption } = req.body;
  if (!to || !dataUrl || !filename) return res.status(400).json({ error: 'Recipient, file, and filename are required' });
  try {
    const response = await whatsappService.sendFile(to, dataUrl, filename, caption);
    res.json(response);
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

router.post('/send-sticker', async (req, res) => {
  const { to, dataUrl } = req.body;
  if (!to || !dataUrl) return res.status(400).json({ error: 'Recipient and image are required' });
  try {
    const response = await whatsappService.sendSticker(to, dataUrl);
    res.json(response);
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

router.get('/media/:messageId', async (req, res) => {
  try {
    res.json(await whatsappService.downloadMedia(req.params.messageId));
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

// Get all chats
router.get('/chats', async (req, res) => {
  try {
    const page = await whatsappService.getChats(req.query);
    res.json({ chats: page.items, pagination: { total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific chat
router.get('/messages/:chatId', async (req, res) => {
  try {
    res.setHeader('x-message-read-receipts', 'disabled');
    res.json(await whatsappService.getMessages(req.params.chatId, req.query.count));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/messages/:chatId/sync', async (req, res) => {
  try {
    res.setHeader('x-message-read-receipts', 'disabled');
    res.json(await whatsappService.loadEarlierMessages(req.params.chatId, req.body?.before, req.body?.count));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stories', async (req, res) => {
  try {
    res.setHeader('x-status-read-receipts', 'disabled');
    const stories = await whatsappService.getStatuses();
    res.json(stories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all contacts
router.get('/contacts', async (req, res) => {
  try {
    const contacts = await whatsappService.getContacts();
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
