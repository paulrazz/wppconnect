const crypto = require('crypto');

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

function requireApiKey(req, res, next) {
  if (req.path === '/provision' || req.path === '/v1/provision' || req.path.startsWith('/auth/')) return next();

  const apiKey = suppliedApiKey(req);
  if (!apiKey || apiKey.length < 32) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A valid API key is required' }, meta: { requestId: res.locals.requestId } });
  }

  // Bring the user's session into memory (swapping out whoever is currently active)
  const whatsappService = require('../services/whatsapp.service');
  whatsappService.ensureSessionActive(apiKey)
    .then(() => next())
    .catch((err) => next(apiError(500, 'SESSION_ERROR', err.message)));
}

function allowedOrigins() {
  const configured = process.env.CORS_ORIGINS;
  return new Set((configured || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean));
}

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins().has(origin)) return callback(null, true);
  callback(apiError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed'));
}

module.exports = { apiError, requireApiKey, suppliedApiKey, timingSafeEqual, corsOrigin };
