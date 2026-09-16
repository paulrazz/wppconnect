import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_catch = """                if (retries >= maxRetries) {
                  console.error(`[AI Rate Limit] Max retries reached for ${ctx.chatId}. Dropping message.`);
                  break; // Give up
                }"""

new_catch = """                if (retries >= maxRetries) {
                  console.error(`[AI Rate Limit] Max retries reached for ${ctx.chatId}. Dropping message.`);
                  await whatsappService.stopTyping(apiKey, ctx.chatId).catch(() => {});
                  break; // Give up
                }"""

content = content.replace(old_catch, new_catch)

with open(path, 'w') as f:
    f.write(content)
