import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """            const contextMessages = [...chatMsgs].reverse().map(m => {
               const isMe = (m.id.fromMe || (m.author && m.author === myJid));"""

new_block = """            const contextMessages = [...chatMsgs].reverse().map(m => {
               if (!m) return null;
               const isMe = (m.fromMe || m.id?.fromMe || (m.author && m.author === myJid));"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w') as f:
        f.write(content)
    print("Success")
else:
    print("Failed to find old block")
