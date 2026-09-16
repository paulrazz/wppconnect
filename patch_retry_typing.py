import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_catch = """            } catch (error) {
              await whatsappService.stopTyping(apiKey, ctx.chatId).catch(() => {});
              
              if (error.message && error.message.startsWith('RATE_LIMIT:')) {"""

new_catch = """            } catch (error) {
              const isRateLimit = error.message && error.message.startsWith('RATE_LIMIT:');
              if (!isRateLimit) {
                await whatsappService.stopTyping(apiKey, ctx.chatId).catch(() => {});
              }
              
              if (isRateLimit) {"""

content = content.replace(old_catch, new_catch)

with open(path, 'w') as f:
    f.write(content)
