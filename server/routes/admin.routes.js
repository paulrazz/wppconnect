const express = require('express');
const router = express.Router();
const DB = require('../lib/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const whatsappService = require('../services/whatsapp.service');

router.use((req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  const expected = process.env.ADMIN_COMMAND_STRING || 'sudo-nexus';
  if (!adminKey || adminKey !== expected) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

router.get('/users', async (req, res) => {
  try {
    const users = await DB.all('SELECT id, phone, api_key, created_at FROM users ORDER BY created_at DESC');
    const data = users.map(u => {
      const hash = crypto.createHash('sha256').update(u.api_key).digest('hex').substring(0, 32);
      // Wait, sessions are stored in whatsapp-session-data/sessions/ or whatsapp-session-data/<hash>?
      // In whatsapp.service.js: path.resolve(__dirname, '..', 'sessions', this.sessionName) => server/sessions/<hash>
      const sessionPath = path.resolve(__dirname, '..', 'sessions', hash);
      const hasProfile = fs.existsSync(sessionPath);
      const isCurrentlyActive = whatsappService.currentApiKey === u.api_key;
      return { ...u, sessionHash: hash, hasProfile, isCurrentlyActive };
    });
    res.json({ users: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await DB.get('SELECT api_key FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    
    // Check if active in RAM
    if (whatsappService.currentApiKey === user.api_key) {
      console.log('[Admin] Force stopping active session before deletion');
      await whatsappService.stopSession();
    }
    
    const hash = crypto.createHash('sha256').update(user.api_key).digest('hex').substring(0, 32);
    const sessionPath = path.resolve(__dirname, '..', 'sessions', hash);
    
    // Delete Chromium profile folder
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    
    // Delete from SQLite
    await DB.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'User and Chromium profile permanently deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
