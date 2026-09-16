import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

# Make the chat view title strictly match whatever the chat list computed for its display name
old = """                <h2 className={`font-bold text-lg truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
                  {isStatusChat(activeChatId) ? (resolveName(statusSenderOf(activeChatId)) || 'Status') : resolveName(activeChatId)}
                </h2>"""

new = """                <h2 className={`font-bold text-lg truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
                  {isStatusChat(activeChatId) ? (resolveName(statusSenderOf(activeChatId)) || 'Status') : (
                    activeRows.find(c => c.id === activeChatId)?.displayName || 
                    chatRows.find(c => c.id === activeChatId)?.displayName || 
                    resolveName(activeChatId)
                  )}
                </h2>"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

