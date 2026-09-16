import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """      case 'forward_to': {
        const dest = await whatsappService.resolveDestination(apiKey, action.to);
        const targetMediaId = event === 'message.deleted' ? ctx.messageId : rawId;
        const media = (targetMediaId && ctx.hasMedia) ? await whatsappService.downloadMedia(apiKey, targetMediaId).catch(() => null) : null;
        if (ctx.hasMedia && media?.dataUrl) {
          await whatsappService.sendFile(apiKey, dest, media.dataUrl, media.filename || 'media', ctx.text);
        } else if (ctx.text) {
          await whatsappService.sendMessage(apiKey, dest, ctx.text);
        }
        break;
      }"""

replacement = """      case 'forward_to': {
        const dest = await whatsappService.resolveDestination(apiKey, action.to);
        const targetMessageId = event === 'message.deleted' ? ctx.messageId : rawId;
        if (targetMessageId) {
          await whatsappService.forwardMessage(apiKey, dest, targetMessageId);
        } else {
          const media = (targetMessageId && ctx.hasMedia) ? await whatsappService.downloadMedia(apiKey, targetMessageId).catch(() => null) : null;
          if (ctx.hasMedia && media?.dataUrl) {
            await whatsappService.sendFile(apiKey, dest, media.dataUrl, media.filename || 'media', ctx.text);
          } else if (ctx.text) {
            await whatsappService.sendMessage(apiKey, dest, ctx.text);
          }
        }
        break;
      }
      case 'remove_member': {
        const participantId = interpolate(action.participant || '{sender}', ctx);
        if (!participantId || !ctx.chatId || !ctx.isGroup) {
          throw new Error('remove_member requires a group chat and a participant ID');
        }
        const session = whatsappService.getSession(apiKey);
        const myJid = session?.myJid;
        if (!myJid) throw new Error('Bot JID not available in session');
        
        // 1. We must be an admin
        const admins = await whatsappService.getGroupAdmins(apiKey, ctx.chatId);
        if (!admins.includes(myJid)) {
           throw new Error('Bot is not an admin in this group');
        }
        // 2. The participant must NOT be an admin
        if (admins.includes(participantId)) {
           throw new Error('Cannot remove an admin');
        }
        
        await whatsappService.removeParticipant(apiKey, ctx.chatId, participantId);
        break;
      }"""

content = content.replace(target, replacement)

with open(path, 'w') as f:
    f.write(content)

print("Patched _executeRule!")
