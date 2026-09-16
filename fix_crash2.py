import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

content = content.replace("this.syncContacts(apiKey)", "this.syncContacts(session.apiKey)")

with open(path, 'w') as f:
    f.write(content)

