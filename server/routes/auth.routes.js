const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const DB = require('../lib/db');

const router = express.Router();

function generateRandomString(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
}

// Sign Up
router.post('/signup', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid phone and a password (min 6 chars) are required.' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    
    // Check if user exists
    const existing = await DB.get('SELECT id FROM users WHERE phone = ?', [cleanPhone]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this phone number already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const recoveryCode = generateRandomString(8); // e.g., 'A1B2C3D4'

    await DB.run(
      'INSERT INTO users (phone, password_hash, api_key, recovery_code) VALUES (?, ?, ?, ?)',
      [cleanPhone, passwordHash, apiKey, recoveryCode]
    );

    res.status(201).json({
      success: true,
      data: { apiKey, recoveryCode }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log In
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password are required.' });
    
    const cleanPhone = String(phone).replace(/\D/g, '');
    const user = await DB.get('SELECT api_key, password_hash FROM users WHERE phone = ?', [cleanPhone]);
    
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    res.json({ success: true, data: { apiKey: user.api_key } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, recoveryCode, newPassword } = req.body;
    if (!phone || !recoveryCode || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Phone, recovery code, and a new password (min 6 chars) are required.' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const user = await DB.get('SELECT id, recovery_code, api_key FROM users WHERE phone = ?', [cleanPhone]);

    if (!user || user.recovery_code.toUpperCase() !== String(recoveryCode).toUpperCase()) {
      return res.status(401).json({ error: 'Invalid phone number or recovery code.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Generate a new recovery code after successful reset for security
    const newRecoveryCode = generateRandomString(8);

    await DB.run(
      'UPDATE users SET password_hash = ?, recovery_code = ? WHERE id = ?',
      [passwordHash, newRecoveryCode, user.id]
    );

    res.json({ 
      success: true, 
      data: { apiKey: user.api_key, newRecoveryCode },
      message: 'Password reset successful.' 
    });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
