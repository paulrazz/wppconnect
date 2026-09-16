import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """            if (ctx.text && !contextMessages.find(m => m.text === ctx.text)) {
               contextMessages.push({
                 role: 'user',
                 authorName: ctx.name || 'User',
                 text: ctx.text
               });
            }"""

new_block = """            if (ctx.text && !contextMessages.find(m => m.text === ctx.text)) {
               contextMessages.push({
                 role: 'user',
                 authorName: ctx.name || 'User',
                 text: ctx.text
               });
            }
            
            // Gemini strictly requires the history to end with a user turn.
            // If testing by messaging yourself, the last turn might be marked 'assistant'.
            if (contextMessages.length > 0 && contextMessages[contextMessages.length - 1].role !== 'user') {
               contextMessages.push({ role: 'user', authorName: 'System', text: 'Please reply.' });
            }"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w') as f:
        f.write(content)
    print("Success")
else:
    print("Failed to find old block")
