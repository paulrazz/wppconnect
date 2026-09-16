import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

old_resolve = """  const resolveName = (chatId) => {
    if (!chatId) return '';
    const names = liveStream.getChatNames();
    if (names[chatId]) return names[chatId];
    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.formattedName) return contacts[chatId].formattedName;
    return chatId.split('@')[0];
  };"""

new_resolve = """  const resolveName = (chatId) => {
    if (!chatId) return '';
    const names = liveStream.getChatNames();
    if (names[chatId]) return names[chatId];
    if (contacts[chatId]?.name) return contacts[chatId].name;
    if (contacts[chatId]?.pushname) return contacts[chatId].pushname;
    if (contacts[chatId]?.formattedName) return contacts[chatId].formattedName;
    return chatId.split('@')[0];
  };"""

old_api_chats = """    apiChats.forEach(c => {
      const displayName = c.chatName || (names[c.id] || c.displayName);
      map[c.id] = { ...c, displayName, isStatus: false, profilePic: c.profilePic || avatars[c.id] || null };
    });"""

new_api_chats = """    apiChats.forEach(c => {
      // Forcibly heal missing or ID-only names using the freshly synced contacts list
      const healedName = contacts[c.id]?.name || contacts[c.id]?.pushname;
      const displayName = c.chatName || names[c.id] || healedName || c.displayName;
      map[c.id] = { ...c, displayName, isStatus: false, profilePic: c.profilePic || avatars[c.id] || null };
    });"""

content = content.replace(old_resolve, new_resolve)
content = content.replace(old_api_chats, new_api_chats)

with open(path, 'w') as f:
    f.write(content)

