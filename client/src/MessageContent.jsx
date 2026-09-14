import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BarChart3, Download, FileText, ImageOff, ListChecks, MapPin, Maximize2, Package, PhoneIncoming, PhoneMissed, Play, UserRound } from 'lucide-react';
import { serializedId } from './message-utils';

const IMAGE_TYPES = new Set(['image']);
const VIDEO_TYPES = new Set(['video', 'gif']);
const AUDIO_TYPES = new Set(['audio', 'ptt']);
const DOCUMENT_TYPES = new Set(['document']);
const STICKER_TYPES = new Set(['sticker']);
const LOCATION_TYPES = new Set(['location', 'live_location']);
const CONTACT_TYPES = new Set(['vcard', 'contact_card', 'contacts_array']);
const CALL_TYPES = new Set(['call_log', 'call', 'missed_call', 'video_call', 'voice_call']);
const POLL_TYPES = new Set(['poll_creation', 'poll', 'poll_update']);
const RESPONSE_TYPES = new Set(['buttons_response', 'list_response', 'template_button_reply', 'interactive_response']);
const ORDER_TYPES = new Set(['order', 'product', 'catalog', 'payment', 'payment_invite']);
const SYSTEM_TYPES = new Set(['revoked', 'protocol', 'notification', 'gp2', 'ciphertext', 'e2e_notification', 'newsletter_notification', 'group_notification', 'broadcast_notification']);
const mediaCache = new Map();

function MediaAsset({ message, apiUrl, kind, children, onOpenMedia, onContentResize }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState({ loading: true, dataUrl: null, error: null });
  const messageId = serializedId(message.id);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (!messageId) {
      setState({ loading: false, dataUrl: null, error: 'Media ID is unavailable' });
      return;
    }
    if (mediaCache.has(messageId)) {
      setState({ loading: false, ...mediaCache.get(messageId), error: null });
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl}/media/${encodeURIComponent(messageId)}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Media could not be loaded');
        return data;
      })
      .then(data => {
        const cached = { dataUrl: data.dataUrl, filename: data.filename };
        mediaCache.set(messageId, cached);
        setState({ loading: false, ...cached, error: null });
        requestAnimationFrame(() => onContentResize?.());
      })
      .catch(error => {
        if (error.name !== 'AbortError') setState({ loading: false, dataUrl: null, error: error.message });
      });
    return () => controller.abort();
  }, [apiUrl, messageId, onContentResize, visible]);

  if (!visible || state.loading) return <div ref={containerRef} className="media-skeleton"><span />Loading {kind}…</div>;
  if (state.error) return <div ref={containerRef} className="media-error"><ImageOff size={18} /><span>{state.error}</span></div>;
  return <div ref={containerRef} className="media-asset">{children(state.dataUrl, state.filename)}{onOpenMedia && <button type="button" className="media-expand" onClick={event => { event.stopPropagation(); onOpenMedia({ url: state.dataUrl, kind, filename: state.filename, caption: captionOf(message) }); }} title={`Expand ${kind}`}><Maximize2 size={16} /></button>}</div>;
}

function looksLikeBinaryPayload(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^data:[^;,]+;base64,/i.test(text)) return true;
  if (text.length < 256) return false;
  // JPEG, PNG, GIF, WebP, audio/video containers and generic long Base64 blobs.
  if (/^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|AAAA(?:F|G|I|J|M|N|O)|SUQz)/.test(text)) return true;
  const sample = text.slice(0, 1024).replace(/\s/g, '');
  return sample.length > 240 && /^[A-Za-z0-9+/=]+$/.test(sample);
}

function captionOf(message) {
  const candidates = [message.caption, message.text, message.body, message.content];
  const text = candidates.find(value => typeof value === 'string' && value.trim() && !looksLikeBinaryPayload(value));
  return text && text !== message.filename ? text : '';
}

function ContactCard({ message }) {
  const raw = message.body || message.content || message.vcard || '';
  const name = message.vcardFormattedName || raw.match(/FN:(.+)/)?.[1]?.trim() || 'Shared contact';
  const phone = raw.match(/TEL[^:]*:(.+)/)?.[1]?.trim();
  return <div className="contact-card"><UserRound size={28} /><div><strong>{name}</strong>{phone && <span>{phone}</span>}</div></div>;
}

function LocationCard({ message }) {
  const lat = message.lat ?? message.latitude ?? message.location?.lat;
  const lng = message.lng ?? message.longitude ?? message.location?.lng;
  const href = lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  const content = <><MapPin size={24} /><div><strong>{message.loc || message.location?.name || 'Shared location'}</strong>{lat != null && <span>{lat}, {lng}</span>}</div></>;
  return href ? <a className="location-card" href={href} target="_blank" rel="noreferrer">{content}</a> : <div className="location-card">{content}</div>;
}

function CallCard({ message }) {
  const missed = message.isMissed || message.callSilenceReason || String(message.subtype || '').includes('miss');
  const video = message.isVideoCall || String(message.subtype || message.type).includes('video');
  return <div className={`call-card ${missed ? 'missed' : ''}`}>{missed ? <PhoneMissed size={22} /> : <PhoneIncoming size={22} />}<div><strong>{missed ? 'Missed' : 'Completed'} {video ? 'video' : 'voice'} call</strong><span>{message.callDuration ? `${message.callDuration}s` : message.body || 'WhatsApp call event'}</span></div></div>;
}

function PollCard({ message }) {
  const choices = message.pollOptions || message.options || message.poll?.options || [];
  return <div className="rich-card"><BarChart3 size={22} /><div><strong>{message.pollName || message.poll?.name || message.body || 'Poll'}</strong>{choices.map((choice, index) => <span key={choice.id || index}>○ {choice.name || choice.text || String(choice)}</span>)}</div></div>;
}

function ResponseCard({ message }) {
  return <div className="rich-card"><ListChecks size={22} /><div><strong>Interactive response</strong><span>{message.selectedDisplayText || message.selectedRowId || message.selectedButtonId || message.body || message.content || 'Selection received'}</span></div></div>;
}

export default function MessageContent({ message, apiUrl, quotedMessage, context = 'chat', onOpenMedia, onContentResize }) {
  const type = String(message.type || 'chat').toLowerCase();
  const caption = captionOf(message);
  const reactions = useMemo(() => {
    const value = message.reactions || message.reactionList || [];
    return Array.isArray(value) ? value : Object.values(value);
  }, [message]);
  const deleted = type === 'revoked' || message.isDeleted || message.isRevoked;

  return <div className={`message-content message-content-${context}`}>
    {(message.quotedMsgObj || quotedMessage || message.quotedMsgId) && (
      <div className="quoted-message">
        <strong>{(message.quotedMsgObj || quotedMessage)?.fromMe ? 'You' : (message.quotedMsgObj || quotedMessage)?.notifyName || 'Reply'}</strong>
        <span>{(message.quotedMsgObj || quotedMessage)?.body || (message.quotedMsgObj || quotedMessage)?.caption || (message.quotedMsgId ? 'Quoted message' : '')}</span>
      </div>
    )}

    {deleted ? <div className="system-message"><AlertCircle size={15} />This message was deleted</div>
      : IMAGE_TYPES.has(type) ? <MediaAsset message={message} apiUrl={apiUrl} kind="image" onOpenMedia={onOpenMedia} onContentResize={onContentResize}>{url => <img className="message-image" src={url} alt={caption || 'Shared image'} loading="lazy" onLoad={onContentResize} />}</MediaAsset>
      : VIDEO_TYPES.has(type) ? <MediaAsset message={message} apiUrl={apiUrl} kind="video" onOpenMedia={onOpenMedia} onContentResize={onContentResize}>{url => <video className="message-video" src={url} controls preload="metadata" playsInline onLoadedMetadata={onContentResize} />}</MediaAsset>
      : AUDIO_TYPES.has(type) ? <MediaAsset message={message} apiUrl={apiUrl} kind={type === 'ptt' ? 'voice note' : 'audio'} onContentResize={onContentResize}>{url => <div className="audio-message"><Play size={18} /><audio src={url} controls preload="metadata" onLoadedMetadata={onContentResize} /></div>}</MediaAsset>
      : STICKER_TYPES.has(type) ? <MediaAsset message={message} apiUrl={apiUrl} kind="sticker" onOpenMedia={onOpenMedia} onContentResize={onContentResize}>{url => <img className="message-sticker" src={url} alt="Sticker" loading="lazy" onLoad={onContentResize} />}</MediaAsset>
      : DOCUMENT_TYPES.has(type) ? <MediaAsset message={message} apiUrl={apiUrl} kind="document" onContentResize={onContentResize}>{(url, filename) => <a className="document-card" href={url} download={filename || message.filename || 'document'}><FileText size={28} /><div><strong>{filename || message.filename || message.title || 'Document'}</strong><span>{message.mimetype || 'Tap to download'}</span></div><Download size={18} /></a>}</MediaAsset>
      : LOCATION_TYPES.has(type) ? <LocationCard message={message} />
      : CONTACT_TYPES.has(type) ? <ContactCard message={message} />
      : CALL_TYPES.has(type) ? <CallCard message={message} />
      : POLL_TYPES.has(type) ? <PollCard message={message} />
      : RESPONSE_TYPES.has(type) ? <ResponseCard message={message} />
      : ORDER_TYPES.has(type) ? <div className="rich-card"><Package size={22} /><div><strong>{type.replaceAll('_', ' ')}</strong><span>{message.title || message.body || message.content || 'Commerce message'}</span></div></div>
      : SYSTEM_TYPES.has(type) ? <div className="system-message"><AlertCircle size={15} />{message.body || message.content || message.subtype || 'WhatsApp system event'}</div>
      : <p className="message-text">{caption || (type === 'chat' ? '' : `[${type}]`)}</p>}

    {caption && !['chat', 'ptt', 'audio', 'document'].includes(type) && <p className="message-caption">{caption}</p>}
    {reactions.length > 0 && <div className="message-reactions">{reactions.map((reaction, index) => <span key={`${reaction.id || reaction.emoji || index}`}>{reaction.emoji || reaction.reaction || reaction.text}{reaction.count > 1 ? ` ${reaction.count}` : ''}</span>)}</div>}
  </div>;
}
