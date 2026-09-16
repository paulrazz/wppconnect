import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """    if (!draft || !draft.name.trim() || !hasAnyValue(draft.trigger?.conditions)) {
      setMsg({ ok: false, text: 'Give the rule a name and at least one populated condition.' });
      return;
    }"""

new = """    const allowEmptyConds = !!lockedChatScope;
    if (!draft || !draft.name.trim() || (!hasAnyValue(draft.trigger?.conditions) && !allowEmptyConds)) {
      setMsg({ ok: false, text: allowEmptyConds ? 'Give the rule a name.' : 'Give the rule a name and at least one populated condition.' });
      return;
    }"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

