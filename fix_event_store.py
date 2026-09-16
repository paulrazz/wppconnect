import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

old = """      if (message.fromMe || message.isSentByMe) {
        // Outgoing message (sent from the API or any frontend). Stream it in
        // real time so an open Live Inbox mirrors the account. eventStore and
        // webhooks already record `message.sent` inside the send path, so we
        // only persist + surface it here.
        const chatId = message.chatId?._serialized || message.chatId || message.to;
        if (chatId) this.cachePreview(session, chatId, message);
        if (chatId) inboxStore.recordMessage(session.apiKey, chatId, message, this.resolveContactDisplayName(session, chatId));
        this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
        return;
      }"""

new = """      if (message.fromMe || message.isSentByMe) {
        const chatId = message.chatId?._serialized || message.chatId || message.to;
        if (chatId) this.cachePreview(session, chatId, message);
        if (chatId) inboxStore.recordMessage(session.apiKey, chatId, message, this.resolveContactDisplayName(session, chatId));
        this.io?.to(`session_${session.apiKey}`).emit('new_message', message);
        // We must append it to eventStore! If it was sent via our API, eventStore 
        // will safely deduplicate it by ID. If it was sent physically from the phone, 
        // this is our only chance to save it to the DB!
        eventStore.append('message.sent', message);
        return;
      }"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

