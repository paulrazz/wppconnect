require('dotenv').config();
if (process.env.NODE_ENV === 'production' && !process.env.WPPCONNECT_API_KEY) {
  throw new Error('WPPCONNECT_API_KEY is required when NODE_ENV=production');
}
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');

const apiRoutes = require('./routes/api.routes');
const v1Routes = require('./routes/v1.routes');
const authRoutes = require('./routes/auth.routes');
const whatsappService = require('./services/whatsapp.service');
const { corsOrigin, requireApiKey, timingSafeEqual } = require('./lib/http');

const app = express();
const server = http.createServer(app);

// Enable CORS for the dashboard frontend
app.disable('x-powered-by');
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '20mb', type: ['application/json', 'application/*+json'] }));

app.use((req, res, next) => {
  res.locals.requestId = /^[A-Za-z0-9._-]{1,100}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : crypto.randomUUID();
  res.setHeader('x-request-id', res.locals.requestId);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use('/api', requireApiKey);


// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  },
});

io.use((socket, next) => {
  const key = socket.handshake.auth?.apiKey || socket.handshake.headers['x-api-key'];
  if (!key || key.length < 32) return next(new Error('Unauthorized'));
  socket.apiKey = key;
  next();
});

whatsappService.setIo(io);

io.on('connection', (socket) => {
  const apiKey = socket.apiKey;
  console.log('A dashboard client connected:', socket.id, 'for session:', apiKey.substring(0, 8));
  socket.join(`session_${apiKey}`);
  
  // We do NOT auto-start the session just because they opened the dashboard.
  // This saves massive amounts of RAM on Railway.
  // The user must click "Connect Device" to explicitly start the engine.

  // Send the current status if they are the currently active session in memory
  if (whatsappService.currentApiKey === apiKey) {
    socket.emit('session_status', whatsappService.sessionStatus);
    socket.emit('session_details', whatsappService.getStatus());
    if (whatsappService.lastQrCode) socket.emit('qr_code', whatsappService.lastQrCode);
  } else {
    // Their session is not active in RAM right now.
    socket.emit('session_status', 'DISCONNECTED');
  }

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('/health', (_req, res) => {
  const status = whatsappService.getStatus();
  res.status(status.status === 'ERROR' ? 503 : 200).json({ ok: status.status !== 'ERROR', service: 'wppconnect-dev-console', uptimeSeconds: Math.round(process.uptime()), whatsapp: status });
});

// Setup API routes
app.use('/api', apiRoutes);
app.use('/api/v1', v1Routes);
app.use('/api/auth', authRoutes);

app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' }, meta: { requestId: res.locals.requestId } }));

app.use((error, req, res, _next) => {
  console.error(`[${res.locals.requestId}]`, error);
  res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'REQUEST_FAILED', message: error.message || 'Request failed' }, meta: { requestId: res.locals.requestId } });
});

const PORT = process.env.PORT || 4005;

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully`);
  server.close();
  const forceExit = setTimeout(() => process.exit(1), 15000);
  forceExit.unref();
  try { await whatsappService.stopSession(); } catch (error) { console.error('Session shutdown failed:', error.message); }
  clearTimeout(forceExit);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

module.exports = { app, server };
