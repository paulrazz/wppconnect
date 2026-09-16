import sys
import re

path1 = 'client/src/components/ContactPickerModal.jsx'
with open(path1, 'r') as f:
    content1 = f.read()

target1 = """      // The user is right! Fetching /groups from the backend causes a 10s delay.
      // /contacts already returns everything (both c.us and g.us).
      const c = await axios.get(`${API}/contacts`, { headers: { 'x-api-key': apiKey } });
      const rawContacts = Array.isArray(c.data?.data) ? c.data.data : (Array.isArray(c.data) ? c.data : []);
      
      const actualContacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
      const actualGroups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));
      
      __fastContactsCache = actualContacts;
      __fastGroupsCache = actualGroups;
      
      setContacts(actualContacts);
      setGroups(actualGroups);"""

repl1 = """      const res = await axios.get(`${API}/contacts`, { headers: { 'x-api-key': apiKey } });
      const payload = res.data?.data || {};
      
      // The backend now intelligently separates them natively so the UI doesn't have to work
      const actualContacts = Array.isArray(payload.contacts) ? payload.contacts : [];
      const actualGroups = Array.isArray(payload.groups) ? payload.groups : [];
      
      __fastContactsCache = actualContacts;
      __fastGroupsCache = actualGroups;
      
      setContacts(actualContacts);
      setGroups(actualGroups);"""

content1 = content1.replace(target1, repl1)

# Truncate DOM rendering
content1 = content1.replace("{list.map(entry => row(entry, tab === 'groups'))}", "{list.slice(0, 100).map(entry => row(entry, tab === 'groups'))}")

with open(path1, 'w') as f:
    f.write(content1)


path2 = 'client/src/pages/LiveInbox.jsx'
with open(path2, 'r') as f:
    content2 = f.read()

# Fix LiveInbox which expects an array directly
content2 = content2.replace("res.data.data.forEach(c => { contactMap[c.id._serialized] = c; });", 
                            "(res.data.data.all || res.data.data).forEach(c => { contactMap[c.id._serialized] = c; });")

with open(path2, 'w') as f:
    f.write(content2)

