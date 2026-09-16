import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

old_resolve_chat = """  resolveChatDisplayName(session, chat) {
    const chatId = chat.id?._serialized || chat.id || '';
    const isGroup = chat.isGroup || String(chatId).endsWith('@g.us');
    if (isGroup) return chat.name || chat.groupMetadata?.subject || null;
    return this.resolveContactDisplayName(session, chatId, chat.contact || {});
  }"""

new_resolve_chat = """  resolveChatDisplayName(session, chat) {
    const chatId = chat.id?._serialized || chat.id || '';
    const isGroup = chat.isGroup || String(chatId).endsWith('@g.us');
    if (isGroup) {
      if (chat.name) return chat.name;
      if (chat.groupMetadata?.subject) return chat.groupMetadata.subject;
      const cached = session.contactsNameMap?.get(chatId);
      if (cached && cached.name) return cached.name;
      return null;
    }
    return this.resolveContactDisplayName(session, chatId, chat.contact || {});
  }"""

old_resolve_contact = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    
    if (contact.formattedName) return contact.formattedName;"""

new_resolve_contact = """    const botName = session.deviceInfo?.profileName;
    if (contact.name && (!botName || contact.name !== botName)) return contact.name;
    if (contact.pushname && (!botName || contact.pushname !== botName)) return contact.pushname;
    
    if (contact.formattedName) return contact.formattedName;"""

content = content.replace(old_resolve_chat, new_resolve_chat)
content = content.replace(old_resolve_contact, new_resolve_contact)

with open(path, 'w') as f:
    f.write(content)

