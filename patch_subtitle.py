import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """                <p className={`text-[10px] font-semibold uppercase tracking-wide ${isStatusChat(activeChatId) ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600')}`}>
                  {isStatusChat(activeChatId) ? 'Status updates' : 'Saved · live'}
                </p>"""

new = """                <p className={`text-[10px] font-semibold uppercase tracking-wide ${isStatusChat(activeChatId) ? (theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600') : (theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600')}`}>
                  {isStatusChat(activeChatId) ? 'Status updates' : (contacts[activeChatId]?.pushname ? `~${contacts[activeChatId].pushname} · Saved live` : 'Saved · live')}
                </p>"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

