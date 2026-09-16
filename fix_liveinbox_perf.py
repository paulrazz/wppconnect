import sys
import re

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

content = content.replace("activeRows.map(chat => {", "activeRows.slice(0, 150).map(chat => {")

with open(path, 'w') as f:
    f.write(content)

