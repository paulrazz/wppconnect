import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = "const chatMsgsResult = await whatsappService.getMessages(apiKey, ctx.chatId, limit);"
new_block = "const chatMsgsResult = await inboxStore.getMessages(apiKey, ctx.chatId, { count: limit });"

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w') as f:
        f.write(content)
    print("Success")
else:
    print("Failed to find old block")
