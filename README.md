# WPPConnect Dev Console

A local-first WhatsApp Web integration console with a versioned API, realtime events, media rendering, deletion recovery, signed webhooks, and a React operations dashboard.

> This project automates WhatsApp Web through WPPConnect. It is not the official WhatsApp Business Platform and should be operated in accordance with WhatsApp's terms and applicable privacy laws.

## Quick start

Requires Node.js 20 or newer.

```sh
cp .env.example server/.env
cd server && npm install && npm start
```

In a second terminal:

```sh
cd client && npm install && npm run dev
```

Open `http://localhost:5173`, scan the QR code, and keep the server's session-data directory private. The development proxy connects the dashboard to the API automatically.

## Security

- Set `WPPCONNECT_API_KEY` in `server/.env`. All `/api` routes and realtime connections then require it.
- For the local dashboard, pass the same value as `VITE_WPPCONNECT_API_KEY` when starting Vite. Treat frontend build output containing this value as private; for public deployment, put authentication in a trusted reverse proxy instead.
- Set `CORS_ORIGINS` to the exact dashboard origins allowed to connect.
- Webhooks cannot target private or reserved networks unless `WEBHOOK_ALLOW_PRIVATE=true` is intentionally configured.
- Session tokens, browser profiles, event data, and cached media are ignored by Git. Back them up only to encrypted storage.

## API

The stable API lives at `/api/v1`; its OpenAPI description is available at `/api/v1/openapi.yaml`. Authenticate with either:

```text
x-api-key: YOUR_KEY
Authorization: Bearer YOUR_KEY
```

The legacy dashboard endpoints under `/api` remain available for compatibility. `/health` is intentionally unauthenticated and exposes only service readiness.

## Verification

```sh
cd server && npm run check
cd client && npm run lint && npm run build
```
