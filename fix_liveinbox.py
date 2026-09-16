import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

target = "if (m.displayName && m.displayName !== (id.split('@')[0] || id)) existing.displayName = m.displayName;"
replacement = "if (m.displayName && m.displayName !== (m.id.split('@')[0] || m.id)) existing.displayName = m.displayName;"

content = content.replace(target, replacement)

with open(path, 'w') as f:
    f.write(content)
