import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

# Add remove_member to ACTION_TYPES
content = content.replace("const ACTION_TYPES = ['send_text', 'send_media', 'send_reaction', 'forward_to'];", "const ACTION_TYPES = ['send_text', 'send_media', 'send_reaction', 'forward_to', 'remove_member'];")

# Add remove_member to ACTION_META
action_meta_target = """  forward_to: {
    label: 'Relay / forward to another chat',
    fields: [
      { name: 'to', label: 'Destination chat or number', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },"""
action_meta_replacement = """  forward_to: {
    label: 'Relay / forward to another chat',
    fields: [
      { name: 'to', label: 'Destination chat or number', type: 'text', required: true },
      { name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
    ],
  },
  remove_member: {
    label: 'Remove group member',
    fields: [
      { name: 'participant', label: 'Member to remove (usually {sender})', type: 'text', required: true, default: '{sender}' },
    ],
  },"""
content = content.replace(action_meta_target, action_meta_replacement)

# Add exceeds_rate_limit to OPS_BY_FIELD
content = content.replace("sender: STRING_OPS,", "sender: [...STRING_OPS, 'exceeds_rate_limit'],")

# Add exceeds_rate_limit to OP_META
op_meta_target = """  not_in: { label: 'is none of', example: 'one per line: spam\\npromo' },"""
op_meta_replacement = """  not_in: { label: 'is none of', example: 'one per line: spam\\npromo' },
  exceeds_rate_limit: { label: 'exceeds rate limit', example: '5/10 (5 messages per 10s)' },"""
content = content.replace(op_meta_target, op_meta_replacement)

with open(path, 'w') as f:
    f.write(content)
print("Patched automation actions!")
