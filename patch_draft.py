import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """  const emptyDraft = (scope) => ({
    name: '', enabled: true,
    trigger: {
      event: 'message_received', match: 'all',
      chatScope: scope || '',
      conditions: [{ field: scope ? 'message' : 'sender', op: scope ? 'equals' : 'is_group', value: scope ? '' : false }]
    },
    action: { type: 'send_text', text: '' }
  });"""

new = """  const emptyDraft = (scope) => ({
    name: '', enabled: true,
    trigger: {
      event: 'message_received', match: 'all',
      chatScope: scope || '',
      conditions: scope ? [] : [{ field: 'sender', op: 'is_group', value: false }]
    },
    action: scope ? { type: 'ai_reply', prompt: 'Reply warmly as an AI assistant.' } : { type: 'send_text', text: '' }
  });"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

