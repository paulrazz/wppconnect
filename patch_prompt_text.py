import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old = "sent across various chats"
new = "sent specifically in this exact chat"

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

