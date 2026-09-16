import sys

path = 'client/src/liveStream.js'
with open(path, 'r') as f:
    content = f.read()

old_logic = """      // A group message carries the group subject - keep the sidebar's group
      // listing name pointed at the real name even if the durable row was
      // recorded with a number or a sender-name clobber.
      const groupName = message?.chatName || message?.chat?.name || message?.groupName;
      if (chatId && groupName && typeof chatId === 'string' && chatId.endsWith('@g.us') && chatNames[chatId] !== groupName) {
        chatNames[chatId] = groupName;
      }"""

new_logic = """      // Dynamically extract names from the raw websocket payload so the UI can
      // instantly render human names even if the backend contact cache is empty.
      if (chatId && typeof chatId === 'string') {
        if (chatId.endsWith('@g.us')) {
          const groupName = message?.chatName || message?.chat?.name || message?.groupName;
          if (groupName && chatNames[chatId] !== groupName) chatNames[chatId] = groupName;
        } else {
          // Direct messages: if it's from us, the recipient's name is in chat.
          // If it's from them, they literally hand us their pushname in sender.
          const contactName = message.fromMe || message.isSentByMe 
            ? (message?.chat?.name || message?.chat?.formattedName)
            : (message?.sender?.pushname || message?.sender?.name || message?.sender?.formattedName || message?.chat?.name);
          
          if (contactName && chatNames[chatId] !== contactName) {
            chatNames[chatId] = contactName;
          }
        }
      }"""

content = content.replace(old_logic, new_logic)

with open(path, 'w') as f:
    f.write(content)

