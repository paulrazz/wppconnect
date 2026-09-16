import sys
import re

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

# Replace everything from `async getGroups` to the end of the method.
pattern = r'  async getGroups\(apiKey\) \{.*?\n  \}'
repl = """  async getGroups(apiKey) {
    const client = this.requireClient(apiKey);
    const session = this.getSession(apiKey);
    if (session.groupsCache && (Date.now() - session.groupsCache.timestamp < 300000)) {
      return session.groupsCache.data;
    }
    const groups = await client.getAllGroups();
    const myJid = session?.myJid || '';
    const mapped = groups.map(g => {
      const parts = g.participants || [];
      const me = parts.find(p => p.id === myJid || (p.id && p.id._serialized === myJid));
      return { ...g, iAmAdmin: me ? Boolean(me.isAdmin || me.isSuperAdmin) : false };
    });
    session.groupsCache = { timestamp: Date.now(), data: mapped };
    return mapped;
  }"""

content = re.sub(r'  async getGroups\(apiKey\) \{.*?_dummy\(\) \{.*?\}\n    \}\);\n  \}', repl, content, flags=re.DOTALL)

with open(path, 'w') as f:
    f.write(content)

