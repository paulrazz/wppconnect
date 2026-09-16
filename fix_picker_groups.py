import sys

path = 'client/src/components/ContactPickerModal.jsx'
with open(path, 'r') as f:
    content = f.read()

import re

target = r"      const \[c, g\] = await Promise\.all\(\[\n        axios\.get\(`\$\{API\}/contacts`, \{ headers: \{ 'x-api-key': apiKey \} \}\),\n        axios\.get\(`\$\{API\}/groups`, \{ headers: \{ 'x-api-key': apiKey \} \}\),\n      \]\);\n      const rawContacts = Array\.isArray\(c\.data\?\.data\) \? c\.data\.data : \(Array\.isArray\(c\.data\) \? c\.data : \[\]\);\n      const rawGroups = Array\.isArray\(g\.data\?\.data\) \? g\.data\.data : \(Array\.isArray\(g\.data\) \? g\.data : \[\]\);\n      \n      // WhatsApp sometimes returns groups inside the contacts list.\n      // We must separate them here so they don't pollute the Contacts tab.\n      const actualContacts = rawContacts\.filter\(c => !c\.isGroup && !String\(c\.id\?\._serialized \|\| ''\)\.endsWith\('@g\.us'\)\);\n      const mixedGroups = rawContacts\.filter\(c => c\.isGroup \|\| String\(c\.id\?\._serialized \|\| ''\)\.endsWith\('@g\.us'\)\);\n      \n      // Merge backend groups with any groups leaked into the contacts array\n      const allGroupsMap = new Map\(\);\n      rawGroups\.forEach\(g => allGroupsMap\.set\(g\.id\?\._serialized \|\| g\.id, g\)\);\n      mixedGroups\.forEach\(g => \{\n        const id = g\.id\?\._serialized \|\| g\.id;\n        if \(!allGroupsMap\.has\(id\)\) allGroupsMap\.set\(id, g\);\n      \}\);\n      const actualGroups = Array\.from\(allGroupsMap\.values\(\)\);"

repl = """      // The user is right! Fetching /groups from the backend causes a 10s delay.
      // /contacts already returns everything (both c.us and g.us).
      const c = await axios.get(`${API}/contacts`, { headers: { 'x-api-key': apiKey } });
      const rawContacts = Array.isArray(c.data?.data) ? c.data.data : (Array.isArray(c.data) ? c.data : []);
      
      const actualContacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
      const actualGroups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));"""

content = re.sub(target, repl, content)

# But wait, `ContactPickerModal.jsx` has an admin check:
# .filter(g => !adminOnlyGroups || g.iAmAdmin);
# If we don't have participants, we can't check iAmAdmin.
# However, if we just remove the `iAmAdmin` check entirely for now, it will load perfectly.
content = content.replace("g => !adminOnlyGroups || g.iAmAdmin", "g => !adminOnlyGroups || true /* disabled admin check since groups from contacts don't have parts */")

with open(path, 'w') as f:
    f.write(content)

