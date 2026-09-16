import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = "  getGroups(apiKey) { return this.requireClient(apiKey).getAllGroups(); }"

replacement = """  async getGroups(apiKey) {
    const client = this.requireClient(apiKey);
    const session = this.getSession(apiKey);
    const groups = await client.getAllGroups();
    const myJid = session?.myJid || '';
    return groups.map(g => {
      const parts = g.participants || [];
      const me = parts.find(p => p.id === myJid || (p.id && p.id._serialized === myJid));
      return { ...g, iAmAdmin: me ? Boolean(me.isAdmin || me.isSuperAdmin) : false };
    });
  }"""

if target in content:
    content = content.replace(target, replacement)
    with open(path, 'w') as f:
        f.write(content)
    print("Patched getGroups!")
else:
    print("Target not found!")
