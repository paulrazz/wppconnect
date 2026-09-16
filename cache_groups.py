import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """  async getGroups(apiKey) {
    const client = this.requireClient(apiKey);
    const session = this.getSession(apiKey);
    const groups = await client.getAllGroups();
    const myJid = session?.myJid || '';
    return groups.map(g => {"""

repl = """  async getGroups(apiKey) {
    const client = this.requireClient(apiKey);
    const session = this.getSession(apiKey);
    
    // 5 minute TTL cache to make groups load instantly
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
  }
  
  // Dummy to replace the old map block:
  _dummy() {"""

if "session.groupsCache" not in content:
    content = content.replace(target, repl)
    content = content.replace("""      return { ...g, iAmAdmin: me ? Boolean(me.isAdmin || me.isSuperAdmin) : false };
    });
  }""", """      return { ...g, iAmAdmin: me ? Boolean(me.isAdmin || me.isSuperAdmin) : false };
    });
  }""")
    
    with open(path, 'w') as f:
        f.write(content)

