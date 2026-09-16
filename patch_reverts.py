import sys

# 1. Revert backend
path_backend = 'server/services/whatsapp.service.js'
with open(path_backend, 'r') as f:
    content = f.read()
old = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    if (contact.pushname && (!botName || contact.pushname !== botName)) return contact.pushname;
    
    if (contact.formattedName) return contact.formattedName;"""
new = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    
    if (contact.formattedName) return contact.formattedName;"""
with open(path_backend, 'w') as f:
    f.write(content.replace(old, new))


# 2. Revert frontend LiveInbox.jsx
path_liveinbox = 'client/src/pages/LiveInbox.jsx'
with open(path_liveinbox, 'r') as f:
    content = f.read()

old1 = """    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.pushname) return contacts[chatId].pushname;
    if (contacts[chatId]?.formattedName) return contacts[chatId].formattedName;"""
new1 = """    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.formattedName) return contacts[chatId].formattedName;"""

old2 = """    apiChats.forEach(c => {
      // Forcibly heal missing or ID-only names using the freshly synced contacts list
      const healedName = contacts[c.id]?.name || contacts[c.id]?.pushname;"""
new2 = """    apiChats.forEach(c => {
      // Forcibly heal missing or ID-only names using the freshly synced contacts list
      const healedName = contacts[c.id]?.name;"""
      
with open(path_liveinbox, 'w') as f:
    f.write(content.replace(old1, new1).replace(old2, new2))


# 3. Revert liveStream.js
path_livestream = 'client/src/liveStream.js'
with open(path_livestream, 'r') as f:
    content = f.read()

old3 = """          const contactName = message.fromMe || message.isSentByMe 
            ? (message?.chat?.name || message?.chat?.formattedName)
            : (message?.sender?.pushname || message?.sender?.name || message?.sender?.formattedName || message?.chat?.name);"""
            
new3 = """          const contactName = message.fromMe || message.isSentByMe 
            ? (message?.chat?.name || message?.chat?.formattedName)
            : (message?.sender?.name || message?.sender?.formattedName || message?.chat?.name);"""

with open(path_livestream, 'w') as f:
    f.write(content.replace(old3, new3))

