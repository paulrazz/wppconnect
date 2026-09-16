import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

old = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    
    if (contact.formattedName) return contact.formattedName;"""

new = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    if (contact.isMyContact && contact.shortName && (!botName || contact.shortName !== botName)) return contact.shortName;
    
    if (contact.formattedName) return contact.formattedName;"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

