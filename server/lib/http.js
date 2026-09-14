const crypto = require('crypto');
const DB = require('./db');

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function suppliedApiKey(req) {
  const authorization = req.headers.authorization || '';
  return req.headers['x-api-key'] || (/^Bearer\s+/i.test(authorization) ? authorization.replace(/^Bearer\s+/i, '') : '');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// In-memory cache to prevent DB lookups on every single API request
const validApiKeys = new Set();

async function requireApiKey(req, res, next) {
  if (req.path === '/provision' || req.path === '/v1/provision' || req.path.startsWith('/auth/')) return next();

  const apiKey = suppliedApiKey(req);
  if (!apiKey || apiKey.length < 32) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A valid API key is required' }, meta: { requestId: res.locals.requestId } });
  }

  // Security & Optimization: Validate API key exists in DB before booting Chromium (prevents DoS)
  if (!validApiKeys.has(apiKey)) {
    try {
      const user = await DB.get('SELECT id FROM users WHERE api_key = ?', [apiKey]);
      if (!user) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' }, meta: { requestId: res.locals.requestId } });
      }
      validApiKeys.add(apiKey);
    } catch (err) {
      return next(apiError(500, 'DB_ERROR', 'Failed to validate API key: ' + err.message));
    }
  }

  // Only boot Chromium for endpoints that explicitly need it.
  // Status checks and other read-only queries should NOT launch a browser.
  const readOnlyPaths = ['/status', '/v1/session'];
  if (readOnlyPaths.some(p => req.path === p || req.path.endsWith(p))) {
    return next();
  }

  // For start-session, the route handler itself calls ensureSessionActive with the API key.
  if (req.path === '/start-session') {
    return next();
  }

  // For all other API calls, ensure the session is active (swap in if needed)
  const whatsappService = require('../services/whatsapp.service');
  if (!whatsappService.client || whatsappService.currentApiKey !== apiKey) {
    // Session isn't active for this user — don't auto-boot, just pass through
    // and let the route handler throw a 503 "not connected" if it needs a client
    return next();
  }
  next();
}

function allowedOrigins() {
  const configured = process.env.CORS_ORIGINS;
  return new Set((configured || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean));
}

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins().has(origin)) return callback(null, true);
  callback(apiError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed'));
}

module.exports = { apiError, requireApiKey, suppliedApiKey, timingSafeEqual, corsOrigin, validApiKeys };
