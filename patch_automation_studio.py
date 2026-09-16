import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """  const eventMeta = spec?.events?.find(e => e.id === draft?.trigger?.event);
  const eventFields = (eventMeta?.fields || []).map(id => spec?.fields?.find(f => f.field === id)).filter(Boolean);
  const switchEvent = (event) => {
    const meta = spec.events.find(e => e.id === event);
    const condition = meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' };
    patchTrigger({ event, conditions: [condition] });
  };"""

new = """  const eventMeta = spec?.events?.find(e => e.id === draft?.trigger?.event);
  
  const isDM = lockedChatScope && lockedChatScope.endsWith('@c.us');
  const allowedField = (id) => {
    if (!lockedChatScope) return true;
    if (id === 'isGroup' || id === 'chat' || id === 'chatName') return false;
    if (isDM && (id === 'sender' || id === 'senderName')) return false;
    return true;
  };
  
  const eventFields = (eventMeta?.fields || [])
    .filter(allowedField)
    .map(id => spec?.fields?.find(f => f.field === id))
    .filter(Boolean);
    
  const switchEvent = (event) => {
    const meta = spec.events.find(e => e.id === event);
    let condition = meta?.defaultCondition || { field: 'sender', op: 'equals', value: '' };
    if (!allowedField(condition.field)) {
      const fallback = (meta?.fields || []).filter(allowedField)[0];
      condition = { field: fallback || 'text', op: 'equals', value: '' };
    }
    patchTrigger({ event, conditions: [condition] });
  };"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

