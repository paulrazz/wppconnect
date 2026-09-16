import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """  const isDM = lockedChatScope && lockedChatScope.endsWith('@c.us');
  const allowedField = (id) => {
    if (!lockedChatScope) return true;
    if (id === 'isGroup' || id === 'chat' || id === 'chatName') return false;
    if (isDM && (id === 'sender' || id === 'senderName')) return false;
    return true;
  };"""

new = """  const isDM = lockedChatScope && !lockedChatScope.endsWith('@g.us') && lockedChatScope !== 'status@broadcast';
  const allowedField = (id) => {
    if (!lockedChatScope) return true;
    if (id === 'isGroup' || id === 'chatId' || id === 'chatName' || id === 'groupName') return false;
    if (isDM && (id === 'sender' || id === 'senderName' || id === 'contactName')) return false;
    return true;
  };"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

