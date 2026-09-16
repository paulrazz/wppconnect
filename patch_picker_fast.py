import sys
import re

path = 'client/src/components/ContactPickerModal.jsx'
with open(path, 'r') as f:
    content = f.read()

load_repl = """  const load = useCallback(async () => {
    if (!apiKey) return;
    
    // Instant cache hit
    if (__fastContactsCache) {
      setContacts(__fastContactsCache);
      setGroups(__fastGroupsCache || []);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const [c, g] = await Promise.all([
        axios.get(`${API}/contacts`, { headers: { 'x-api-key': apiKey } }),
        axios.get(`${API}/groups`, { headers: { 'x-api-key': apiKey } }),
      ]);
      const rawContacts = Array.isArray(c.data?.data) ? c.data.data : (Array.isArray(c.data) ? c.data : []);
      const rawGroups = Array.isArray(g.data?.data) ? g.data.data : (Array.isArray(g.data) ? g.data : []);
      
      // WhatsApp sometimes returns groups inside the contacts list.
      // We must separate them here so they don't pollute the Contacts tab.
      const actualContacts = rawContacts.filter(c => !c.isGroup && !String(c.id?._serialized || '').endsWith('@g.us'));
      const mixedGroups = rawContacts.filter(c => c.isGroup || String(c.id?._serialized || '').endsWith('@g.us'));
      
      // Merge backend groups with any groups leaked into the contacts array
      const allGroupsMap = new Map();
      rawGroups.forEach(g => allGroupsMap.set(g.id?._serialized || g.id, g));
      mixedGroups.forEach(g => {
        const id = g.id?._serialized || g.id;
        if (!allGroupsMap.has(id)) allGroupsMap.set(id, g);
      });
      const actualGroups = Array.from(allGroupsMap.values());
      
      __fastContactsCache = actualContacts;
      __fastGroupsCache = actualGroups;
      
      setContacts(actualContacts);
      setGroups(actualGroups);
    } catch (_) {
      setContacts([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);"""

content = re.sub(r'  const load = useCallback\(async \(\) => \{.*?  \}, \[apiKey\]\);', load_repl, content, flags=re.DOTALL)

with open(path, 'w') as f:
    f.write(content)
