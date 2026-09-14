# WPPConnect Dev Platform — continuation checkpoint

Updated: 2026-09-13

## Current test session

- Backend and frontend are intentionally stopped.
- After a clean restart on 2026-09-13, the same profile restored successfully: WPPConnect reached `CONNECTED` / `inChat` without generating a QR scan requirement.

## Current state

- The frontend is in `client/` and runs with Vite on port 5173.
- The backend is in `server/` and runs on port 4005.
- The persistent WhatsApp Chromium profile is `server/whatsapp-session-data/`.
- The backend automatically attempts to restore that profile when it starts.
- The current API foundation is mounted at `/api/v1`.
- API capabilities, session, chats, messages, media, contacts, groups, statuses, outbound text/file/sticker/location/contact messages, and webhooks are implemented.
- Webhook deliveries are signed with `x-wpp-signature` and retried twice.
- The dashboard renders images, video, audio, voice notes, stickers, documents, locations, contact cards, deleted/system messages, quoted replies, and reactions.
- Media is lazy-loaded and cached in the browser.
- The API sandbox in Developer Tools uses `/api/v1/messages/text`.
- OpenAPI contract: `server/openapi.yaml`.
- Conversation loading is paged in batches of 30. Preview history is fetched only for the visible page and cached in memory.
- The API now sends text, template buttons, lists, polls, files, stickers, locations, contacts, and reactions.
- `server/data/event-ledger.jsonl` is an append-only operational ledger created on the first event.
- Deleted, edited, reaction, call, incoming, sent, and acknowledgement events are persisted and exposed at `/api/v1/events`; deletions are exposed at `/api/v1/deleted-messages`.
- Deleted content can only be retained when the original message was observed after the ledger was enabled; earlier deleted content cannot be recovered retroactively.
- Chat messages now have Today/Yesterday/date separators and dedicated call, poll, interactive-response, commerce, media, and system-event renderers.
- Developer Tools contains an advanced JSON message laboratory with templates for text, buttons, lists, polls, locations, contacts, and reactions.
- The message laboratory has a searchable recipient picker with separate Contacts, Groups, and Manual tabs; selecting a person or group fills the WhatsApp destination ID automatically.
- Chat history runs in passive mode: the runtime forces offline presence, history endpoints advertise `x-message-read-receipts: disabled`, and chat browsing never calls WPPConnect `sendSeen`.
- Clicking a bubble opens a Message Intelligence inspector with type, direction, ACK, timestamp, IDs, sender, raw payload, and copy controls.
- Outbound sends resolve WhatsApp's newer `@lid` chat identifiers through the PN/LID mapping before sending, covering text, media, stickers, location, contacts, lists, and polls.
- Media captions now reject raw data URLs and Base64/binary payloads that WPPConnect may place in `body`; this applies to both chat messages and statuses. Status media is vertically centered and constrained beneath the viewer controls.
- Advanced Message Laboratory now uses visual forms for text, buttons, lists, polls, locations, contacts, and reactions. It generates an API payload preview and keeps editable JSON behind an Advanced JSON toggle. Button modes are separated so reply buttons are never mixed with URL/phone action buttons.
- Conversation subtitles are normalized server-side. Raw Base64/data URLs are discarded and known message types receive readable previews for media, voice notes, documents, locations, contacts, calls, deleted messages, polls, interactions, reactions, commerce, payments, and system events.
- Status rendering now wraps content by context. Long media captions have their own bounded scroll region, pure text statuses scroll below the fixed controls, and media is capped at 58vh so neither captions nor images are pushed behind the header/progress bar.
- Deleted-message recovery now separates `status@broadcast` removals from chat deletions, indexes messages loaded through chat history into durable lightweight snapshots, matches both serialized and stanza IDs, and clearly reports whether the original was recovered or had never been observed.
- Page-level status fullscreen was replaced with a dedicated media lightbox. Images, videos, and stickers expand independently of the dashboard, preserve aspect ratio with `object-fit: contain`, and provide close/zoom controls; videos use full-size native playback controls.
- Universal Deletion Monitor combines private-chat, group, and status deletions at `/api/v1/deletions` and streams both `message_deleted` and `status_deleted`. Status snapshots are retained without raw Base64; when WhatsApp omits a deletion reference, the UI explicitly labels a latest-sender correlation as probable rather than exact.
- Opening a conversation now jumps to the latest message instantly (`behavior: auto`) instead of visibly smooth-scrolling through history. Outbound text and button sends force WPPConnect `markIsRead: false`, preventing its default read operation from causing LID-only send failures or violating passive mode.
- LID text/button sends now bypass PN→LID conversion and target the existing WhatsApp `ChatStore` model and native Wid directly. This addresses contacts whose chat exists and has a `historyChatId` but whose PN/LID cache still throws `No LID for user`.
- Fixed the legacy `/send-message` and v1 destination parsers so `@lid` (and newsletter) JIDs are preserved. Previously the chat composer changed `203027533275317@lid` into `203027533275317@c.us` before it reached the LID-safe sender, which caused the repeated `No LID for user` failure.
- Deletion Monitor records are now clickable. Recovered chat/group/status originals open in a dedicated viewer and reuse the normal rich message renderer/media expansion path; unrecovered deletions clearly explain that no original payload exists.
- Incoming media is now cached locally under `server/data/media-cache` while still downloadable. Deleted-media viewers use that cache after WhatsApp removes the live message; cache is best-effort and only applies to media received after this change.
- Initial chat positioning now runs in React's pre-paint layout phase, preventing both animated scrolling and a visible top-of-history flash.
- The conversation viewport now anchors directly to its own `scrollHeight` on open and remains bottom-pinned while lazy media changes layout. Once the user intentionally scrolls more than 80px upward, automatic pinning stops.
- Status text uses a dedicated scrollable reading layout so long posts begin below the viewer chrome instead of clipping. The status viewer has a native fullscreen control for text, images, video, audio, stickers, and documents.
- Status history now reads WhatsApp's StatusV3 store instead of treating `status@broadcast` as a normal chat.
- Status inspection runs in no-read-receipt mode: the backend reads StatusV3 models and media directly and never calls `sendReadStatus`, `handleReadStatus`, or the native WhatsApp status viewer.
- The status UI now renders actual image/video/audio/sticker/text content through the lazy media renderer, supports captions, sender names, timestamps, type metadata, progress indicators, and previous/next navigation.
- Status endpoints return the `x-status-read-receipts: disabled` response header; `/api/v1/statuses` also reports `privacyMode: no-read-receipts`.

## Verified

- `server`: `npm run check` passes.
- `client`: `npm run build` passes.

## Known next work

1. Perform a live test with the restored linked WhatsApp account: list chats, open history, send text, send media/sticker, load statuses, and receive a webhook.
2. Add API idempotency keys, outbound queueing, and durable delivery-status projections from the event ledger.
4. Add multi-session support and per-session API keys.
5. Migrate all remaining dashboard data calls from legacy `/api/*` routes to `/api/v1/*` after validating response-shape compatibility.
6. Add automated integration tests with a mocked WPPConnect client.

## Safe continuation instruction

Continue from the “Known next work” list. Do not delete `server/whatsapp-session-data/`; deleting it unlinks the persisted WhatsApp login and requires scanning a new QR code.
