import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

old = """        setTimeout(() => {
          void client.downloadMedia(message).then(dataUrl => eventStore.cacheMedia(message.id, dataUrl, { mimetype: message.mimetype, filename: message.filename || message.fileName }))
            .catch(err => { if (isSticker) console.log('[media]', session.apiKey.slice(0, 8), 'proactive sticker cache failed:', String(err?.message || err).slice(0, 120)); });
        }, delay);"""

new = """        setTimeout(() => {
          void client.downloadMedia(message).then(dataUrl => eventStore.cacheMedia(message.id, dataUrl, { mimetype: message.mimetype, filename: message.filename || message.fileName }))
            .catch(err => { 
              console.log('[media]', session.apiKey.slice(0, 8), 'proactive cache failed for type', message.type, 'id', message.id, 'error:', String(err?.message || err).slice(0, 120)); 
            });
        }, delay);"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

