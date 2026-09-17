// Conversation history from the inbox is already oldest-first.
const messageId = (value) => {
  const id = typeof value === 'string' ? value : (value?._serialized || value?.id || '');
  return String(id || '').replace(/_out$/, '');
};

function messageText(message) {
  let text = String(message?.body || message?.caption || message?.text || message?.content || '');
  const type = String(message?.type || '').toLowerCase();
  if (message?.hasMedia || ['image', 'video', 'document', 'audio', 'ptt', 'sticker'].includes(type)) {
    const label = `[Attached ${type || 'media'}${message?.filename ? ': ' + message.filename : ''}${message?.mimetype ? ' (' + message.mimetype + ')' : ''}]`;
    text = [text.trim(), label].filter(Boolean).join(' ');
  }
  if (message?.hasQuotedMsg) {
    const quoted = message?.quotedMsgObj?.body || message?.quotedMsgObj?.caption || message?._data?.quotedMsg?.body;
    if (quoted) text = `> ${quoted}\n${text}`;
  }
  return text.trim();
}

function prepareChatContext(chatMessages, triggeringMessage, ownerId, senderName = '') {
  const triggerId = messageId(triggeringMessage?.id);
  const messages = Array.isArray(chatMessages) ? chatMessages : [];
  const triggerIndex = triggerId ? messages.findIndex(m => messageId(m?.id) === triggerId) : -1;
  // If persistence missed the event, use the event itself; don't include
  // unrelated messages that may have arrived after it while the job waited.
  const relevant = triggerIndex < 0 ? [] : messages.slice(0, triggerIndex + 1);
  const history = relevant.map(m => {
    if (!m) return null;
    const isTrigger = Boolean(triggerId && messageId(m.id) === triggerId);
    const isMe = !isTrigger && Boolean(m.fromMe || m.isSentByMe || m.id?.fromMe || (ownerId && m.author === ownerId));
    const text = messageText(m);
    if (!text) return null;
    const author = isMe
      ? 'Account owner'
      : (m.sender?.pushname || m.sender?.name || m.sender?.formattedName || senderName || 'Sender');
    return { role: isMe ? 'assistant' : 'user', authorName: author, text };
  }).filter(Boolean);

  if (triggerIndex < 0) {
    const text = messageText(triggeringMessage);
    if (!text) throw new Error('AI Copilot: triggering message has no usable content.');
    history.push({ role: 'user', authorName: senderName || 'Sender', text });
  }
  if (!history.length || history.at(-1).role !== 'user') {
    throw new Error('AI Copilot: latest message must be the final user turn.');
  }
  return history;
}

// Only messages since the most recent outgoing turn are still waiting for a reply.
// This count is metadata; the actual message text stays in the chronological history.
function pendingIncomingCount(context) {
  let count = 0;
  for (let i = context.length - 1; i >= 0 && context[i].role === 'user'; i--) count++;
  return count;
}

function isLatestInboxMessage(lastMessage, triggeringId) {
  return !lastMessage || messageId(lastMessage.id) === messageId(triggeringId);
}

module.exports = { messageId, messageText, prepareChatContext, pendingIncomingCount, isLatestInboxMessage };
