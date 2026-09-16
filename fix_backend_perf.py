import sys
import re

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """  async getContacts(apiKey) {
    const session = this.getSession(apiKey);
    if (session.contactsCache && (Date.now() - session.contactsCache.timestamp < 300000)) {
      return session.contactsCache.data;
    }
    const data = await this.requireClient(apiKey).getAllContacts();
    session.contactsCache = { timestamp: Date.now(), data };
    this._rebuildContactsNameMap(session);
    return data;
  }"""

repl = """  async getContacts(apiKey) {
    const session = this.getSession(apiKey);
    if (session.contactsCache && (Date.now() - session.contactsCache.timestamp < 300000)) {
      return session.contactsCache.data;
    }
    const rawContacts = await this.requireClient(apiKey).getAllContacts();
    
    // Perform the heavy segregation on the backend, exactly as requested by the user
    const contacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
    const groups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));
    
    const data = {
      all: rawContacts,
      contacts: contacts,
      groups: groups
    };
    
    session.contactsCache = { timestamp: Date.now(), data };
    this._rebuildContactsNameMap(session);
    return data;
  }
  
  _rebuildContactsNameMap(session) {
    const map = new Map();
    if (session.contactsCache?.data?.all) {
      for (const c of session.contactsCache.data.all) {
        const id = c.id?._serialized || c.id;
        if (typeof id === 'string' && id) map.set(id, c);
      }
    }
    session.contactsNameMap = map;
  }"""

# Need to replace the rebuild as well so we do a larger replace
content = re.sub(r'  async getContacts.*?session\.contactsNameMap = map;\n  \}', repl, content, flags=re.DOTALL)

with open(path, 'w') as f:
    f.write(content)
