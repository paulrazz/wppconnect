import sys
import re

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """    // Perform the heavy segregation on the backend, exactly as requested by the user
    const contacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
    const groups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));"""

repl = """    // Perform the heavy segregation on the backend, exactly as requested by the user
    const contacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
    const groups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));

    // Backend sorting: Saved contacts first, then alphabetically
    const contactName = (c) => c.name || c.formattedName || c.pushname || c.shortName || c.profileName || (c.id?._serialized || c.id || '');
    const sortContacts = (a, b) => {
       const aSaved = !!a.name;
       const bSaved = !!b.name;
       if (aSaved && !bSaved) return -1;
       if (!aSaved && bSaved) return 1;
       
       const aName = String(contactName(a)).toLowerCase();
       const bName = String(contactName(b)).toLowerCase();
       return aName.localeCompare(bName);
    };

    contacts.sort(sortContacts);
    groups.sort(sortContacts);"""

content = content.replace(target, repl)

with open(path, 'w') as f:
    f.write(content)

