import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

import re
content = re.sub(r'  // Dummy to replace the old map block:\n  _dummy\(\) \{\n      const parts = g.participants \|\| \[\];\n      const me = parts\.find\(p => p\.id === myJid \|\| \(p\.id && p\.id\._serialized === myJid\)\);\n      return \{ \.\.\.g, iAmAdmin: me \? Boolean\(me\.isAdmin \|\| me\.isSuperAdmin\) : false \};\n    \}\);\n  \}', '', content)

with open(path, 'w') as f:
    f.write(content)

