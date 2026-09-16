import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

old_code = """  const sidebar = useMemo(() => {
    const map = {};
    const names = liveStream.getChatNames();
    apiChats.forEach(c => {
      const displayName = c.chatName || (names[c.id] || c.displayName);
      map[c.id] = { ...c, displayName, isStatus: false, profilePic: c.profilePic || avatars[c.id] || null };
    });
    Object.entries(liveChats).forEach(([chatId, { messages }]) => {
      const last = messages[messages.length - 1];
      if (!map[chatId]) map[chatId] = { id: chatId, displayName: resolveName(chatId), lastMessage: null, contact: null, isStatus: false, profilePic: avatars[chatId] || null };
      if (last) map[chatId] = { ...map[chatId], lastMessage: { ...last, timestamp: last.timestamp || 0 } };
    });
    const allStatuses = liveStream.getStatuses();
    for (const senderId of Object.keys(allStatuses)) {
      const list = allStatuses[senderId] || [];
      const newest = list[list.length - 1];
      if (!newest) continue;
      const contact = contacts[senderId] || {};
      const senderInfo = newest.sender || {};
      const displayName = contact.name || contact.pushname || senderInfo.name || senderInfo.formattedName || senderInfo.pushname || newest.notifyName || senderId.split('@')[0];
      map[statusChatId(senderId)] = {
        id: statusChatId(senderId),
        displayName,
        contact: null,
        isStatus: true,
        profilePic: avatars[senderId] || null,
        senderId,
        lastMessage: { ...newest, timestamp: statusTime(newest), previewText: messagePreview({ ...newest, timestamp: statusTime(newest) }) },
      };
    }
    return Object.values(map).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  }, [apiChats, liveChats, liveVersion, contacts, avatars]);
  const [sidebarTab, setSidebarTab] = useState('chats');
  const [chatDisplayLimit, setChatDisplayLimit] = useState(20);
  const chatRows = useMemo(() => sidebar.filter(c => !c.isStatus), [sidebar]);
  const statusRows = useMemo(() => sidebar.filter(c => c.isStatus), [sidebar]);
  const activeRows = sidebarTab === 'status' ? statusRows : chatRows;
  const sidebarCount = sidebarTab === 'status' ? statusRows.length : chatRows.length;"""

new_code = """  const chatRows = useMemo(() => {
    const map = {};
    const names = liveStream.getChatNames();
    apiChats.forEach(c => {
      const displayName = c.chatName || (names[c.id] || c.displayName);
      map[c.id] = { ...c, displayName, isStatus: false, profilePic: c.profilePic || avatars[c.id] || null };
    });
    Object.entries(liveChats).forEach(([chatId, { messages }]) => {
      const last = messages[messages.length - 1];
      if (!map[chatId]) map[chatId] = { id: chatId, displayName: resolveName(chatId), lastMessage: null, contact: null, isStatus: false, profilePic: avatars[chatId] || null };
      if (last) map[chatId] = { ...map[chatId], lastMessage: { ...last, timestamp: last.timestamp || 0 } };
    });
    return Object.values(map).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  }, [apiChats, liveChats, liveVersion, contacts, avatars]);

  const [sidebarTab, setSidebarTab] = useState('chats');
  const [chatDisplayLimit, setChatDisplayLimit] = useState(20);
  const [statusRows, setStatusRows] = useState([]);

  // Async defer status processing to prioritize instant chat list rendering
  useEffect(() => {
    const timer = setTimeout(() => {
      const allStatuses = liveStream.getStatuses();
      const sMap = {};
      for (const senderId of Object.keys(allStatuses)) {
        const list = allStatuses[senderId] || [];
        const newest = list[list.length - 1];
        if (!newest) continue;
        const contact = contacts[senderId] || {};
        const senderInfo = newest.sender || {};
        const displayName = contact.name || contact.pushname || senderInfo.name || senderInfo.formattedName || senderInfo.pushname || newest.notifyName || senderId.split('@')[0];
        sMap[statusChatId(senderId)] = {
          id: statusChatId(senderId),
          displayName,
          contact: null,
          isStatus: true,
          profilePic: avatars[senderId] || null,
          senderId,
          lastMessage: { ...newest, timestamp: statusTime(newest), previewText: messagePreview({ ...newest, timestamp: statusTime(newest) }) },
        };
      }
      setStatusRows(Object.values(sMap).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)));
    }, 150);
    return () => clearTimeout(timer);
  }, [liveVersion, contacts, avatars]);

  const activeRows = sidebarTab === 'status' ? statusRows : chatRows;
  const sidebarCount = sidebarTab === 'status' ? statusRows.length : chatRows.length;"""

content = content.replace(old_code, new_code)

with open(path, 'w') as f:
    f.write(content)

