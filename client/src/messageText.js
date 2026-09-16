// Distinguish a real message payload from a raw base64/media dump so binary
// never leaks into captions, subtitles or reply previews.
const looksLikeBinaryPayload = (value) => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^data:[^;,]+;base64,/i.test(text)) return true;
  if (text.length < 256) return false;
  if (/^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|AAAA(?:F|G|I|J|M|N|O)|SUQz)/.test(text)) return true;
  const sample = text.slice(0, 1024).replace(/\s/g, '');
  return sample.length > 240 && /^[A-Za-z0-9+/=]+$/.test(sample);
};

export const safeMessageText = (message) =>
  [message?.caption, message?.text, message?.body, message?.content]
    .find(value => typeof value === 'string' && value.trim() && !looksLikeBinaryPayload(value))
    ?.trim() || '';

// View-once media arrives (or was stored pre-normalization) under the
// `view_once` / `viewOnce` / `viewOnceMessage` type umbrella with the real
// media nested inside. Resolve the effective media type so view-once images
// and videos render exactly like normal media - no timer emoji, no
// view-once restriction. The server unwraps fresh messages already; this
// covers older durable rows and unnormalized payloads.
export const viewOnceInnerType = (message) => {
  const type = String((message && message.type) || 'chat').toLowerCase();
  if (type === 'viewonce' || type === 'view_once' || type === 'viewoncemessage' || message?.viewOnceMessage) {
    const inner = (message?.viewOnceMessage && typeof message.viewOnceMessage === 'object') ? (message.viewOnceMessage.message || message.viewOnceMessage) : {};
    const mediaKey = Object.keys(inner || {}).find(k => String(k).endsWith('Message'));
    return String(mediaKey || 'image').replace(/Message$/, '').toLowerCase();
  }
  return type;
};

const MEDIA_LABELS = {
  image: '📷 Photo',
  video: '🎥 Video',
  gif: 'GIF',
  audio: '🎵 Audio',
  ptt: '🎵 Voice message',
  sticker: '🖼️ Sticker',
  document: '📎 Document',
  location: '📍 Location',
  live_location: '📍 Live location',
  vcard: '👤 Contact',
  contact: '👤 Contact',
  contact_card: '👤 Contact',
  revoked: '🚫',
};

export const messagePreview = (message) => {
  const text = safeMessageText(message);
  if (text) return text;
  const labeled = MEDIA_LABELS[viewOnceInnerType(message)];
  if (labeled) return labeled;
  const mime = message?.mimetype || '';
  if (/^image\//.test(mime)) return MEDIA_LABELS.image;
  if (/^audio\//.test(mime)) return MEDIA_LABELS.audio;
  if (/^video\//.test(mime)) return MEDIA_LABELS.video;
  if (/^(application|text)\//.test(mime)) return MEDIA_LABELS.document;
  return '';
};