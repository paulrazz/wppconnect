'use strict';

const MAX_REPLY_CHARS = 4096;
const CAPTION_CHARS = 1024;

function oneEmoji(value) {
  const emoji = String(value || '').trim();
  if (!emoji || emoji.length > 32) return '';
  const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(emoji)];
  return segments.length === 1 && /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20e3]/u.test(emoji) ? emoji : '';
}

// A nested SVG is still one drawing. Look for the matching closing tag rather
// than stopping at the first </svg>, and don't send malformed markup as a caption.
function takeSvg(input) {
  const opening = /<svg\b[^>]*>/i.exec(input);
  if (!opening) return { text: input, svg: null, invalidSvg: false };
  const start = opening.index;
  const tags = /<\/?svg\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(input))) {
    depth += /^<\/svg/i.test(match[0]) ? -1 : 1;
    if (depth === 0) {
      const end = tags.lastIndex;
      return { text: input.slice(0, start) + input.slice(end), svg: input.slice(start, end), invalidSvg: false };
    }
  }
  return { text: input.slice(0, start), svg: null, invalidSvg: true };
}

function parseAiResponse(input) {
  if (typeof input !== 'string') throw new Error('AI response must be text');
  const source = input.trim();
  const drawing = takeSvg(source);
  let text = drawing.text;
  let reaction = '';
  const reactions = /<react\b[^>]*>([\s\S]*?)<\/react\s*>/gi;
  text = text.replace(reactions, (_, value) => {
    if (!reaction) reaction = oneEmoji(value);
    return '';
  });
  const quote = /<quote\s*\/?>/i.test(text);
  text = text.replace(/<quote\s*\/?>|<\/quote\s*>/gi, '');
  // A second image or an incomplete tag is never allowed to leak into WhatsApp.
  text = text.replace(/<svg\b[\s\S]*?(?:<\/svg\s*>|$)/gi, '');
  text = text.replace(/<\/?(?:react|quote)\b[^>]*>/gi, '');
  text = text.replace(/```(?:svg|xml)?\s*```/gi, '').trim();
  if (text.length > MAX_REPLY_CHARS) throw new Error('AI reply exceeds the WhatsApp text limit');
  return { text, reaction, quote, svg: drawing.svg, invalidSvg: drawing.invalidSvg };
}

function typingDelayMs(text, random = Math.random) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const jitter = Math.floor(Math.max(0, Math.min(0.999999, random())) * 5);
  return (Math.max(10, words) + jitter) * 1000;
}

function reactionLeadMs(seconds) {
  const requested = seconds === undefined || seconds === null ? 1.5 : Number(seconds);
  return Math.round(Math.max(1, Math.min(10, Number.isFinite(requested) ? requested : 1.5)) * 1000);
}

async function deliverAiReply({
  output, apiKey, chatId, triggerId, whatsapp, canSend, markSent,
  renderSvg, pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random, reactionLeadSeconds,
}) {
  const response = parseAiResponse(output);
  if (!response.text && !response.reaction && !response.svg) {
    if (output.trim() && (response.invalidSvg || /<react\b|<quote\b/i.test(output))) {
      throw new Error('AI produced an invalid action without a message');
    }
    return false;
  }
  if (!await canSend()) return false;

  // Rendering must finish before the first external action. That avoids a
  // reaction-only partial send if rendering subsequently fails.
  let image = null;
  if (response.svg) {
    image = await renderSvg(response.svg);
    if (!image && !response.text) {
      throw new Error('AI image could not be rendered');
    }
  }
  if (!await canSend()) return false;
  let sentAnything = false;
  let typing = false;
  const stopTyping = async () => {
    if (!typing) return;
    typing = false;
    await whatsapp.stopTyping(apiKey, chatId).catch(() => {});
  };
  const startTyping = async () => {
    await whatsapp.startTyping(apiKey, chatId);
    typing = true;
  };
  const save = async (sent) => {
    if (!sent || sent.erro || sent.error || !sent.id) {
      throw new Error('WhatsApp did not confirm the outgoing message');
    }
    sentAnything = true;
    await markSent(sent);
  };
  const quoteOptions = response.quote && triggerId ? { quotedMessageId: triggerId } : undefined;
  try {
    if (response.reaction) {
      if (!triggerId) {
        if (!response.text && !image) throw new Error('Cannot react without an incoming message ID');
      } else {
        try {
          const reacted = await whatsapp.sendReaction(apiKey, triggerId, response.reaction);
          if (!reacted || reacted.erro || reacted.error) throw new Error('WhatsApp did not confirm the reaction');
          sentAnything = true;
        } catch (error) {
          if (!response.text && !image) throw error; // No silent no-op reaction-only replies.
          console.warn('[AI Reaction] Failed; delivering the message instead:', error.message);
        }
      }
    }

    if (!response.text && !image) return sentAnything;
    if (sentAnything) await pause(reactionLeadMs(reactionLeadSeconds));
    if (!await canSend()) return sentAnything;

    // The real WhatsApp typing delay applies to readable content only, never
    // thousands of raw SVG path coordinates. Reactions happen before typing.
    await startTyping();
    const longImageCaption = Boolean(image && response.text.length > CAPTION_CHARS);
    const firstText = response.text;
    await pause(typingDelayMs(firstText, random));
    if (!await canSend()) return sentAnything;
    await stopTyping();
    if (longImageCaption) {
      // Deliver the actual answer first. If the conversation moves on before
      // the drawing goes out, the pending questions were still acknowledged.
      await save(await whatsapp.sendMessage(apiKey, chatId, response.text, quoteOptions));
      await pause(reactionLeadMs(reactionLeadSeconds));
      if (!await canSend()) return sentAnything;
      await startTyping();
      await pause(typingDelayMs('', random));
      if (!await canSend()) return sentAnything;
      await stopTyping();
      await save(await whatsapp.sendFile(apiKey, chatId, image, 'generated.png', ''));
    } else if (image) {
      await save(await whatsapp.sendFile(apiKey, chatId, image, 'generated.png', firstText, quoteOptions));
    } else if (response.text) {
      await save(await whatsapp.sendMessage(apiKey, chatId, response.text, quoteOptions));
    }
    return sentAnything;
  } catch (error) {
    // Never regenerate the same job after a successful reaction or message;
    // retries would duplicate externally visible actions.
    if (sentAnything) error.partialDelivery = true;
    throw error;
  } finally {
    await stopTyping();
  }
}

module.exports = { parseAiResponse, typingDelayMs, reactionLeadMs, deliverAiReply, oneEmoji };
