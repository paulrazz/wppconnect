import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target = "const ACTION_TYPES = ['send_text', 'send_media', 'send_reaction', 'forward_to', 'remove_member'];"
replacement = "const ACTION_TYPES = ['send_text', 'send_media', 'send_reaction', 'forward_to', 'remove_member', 'llm_reply'];"
content = content.replace(target, replacement)

target2 = """  remove_member: {
    label: 'Remove group member',
    fields: [
      { name: 'participant', label: 'Member to remove (usually {sender})', type: 'text', required: true, default: '{sender}' },
    ],
  },"""
replacement2 = """  remove_member: {
    label: 'Remove group member',
    fields: [
      { name: 'participant', label: 'Member to remove (usually {sender})', type: 'text', required: true, default: '{sender}' },
    ],
  },
  llm_reply: {
    label: 'AI Copilot Reply',
    fields: [
      { name: 'prompt', label: 'System Prompt / Persona', type: 'textarea', required: true, default: 'You are a helpful assistant.' },
      { name: 'contextLimit', label: 'Context Limit (Messages)', type: 'number', min: 1, max: 50, default: 10 },
    ],
  },"""
content = content.replace(target2, replacement2)

with open(path, 'w') as f:
    f.write(content)
