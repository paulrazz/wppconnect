import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

import_statement = "const { interpolate } = require('./webhooks.service');"
if "const { generateReply } = require('./llm.service');" not in content:
    content = content.replace(import_statement, import_statement + "\nconst { generateReply } = require('./llm.service');")

target = """        await whatsappService.removeParticipant(apiKey, ctx.chatId, participantId);
        break;
      }"""
replacement = """        await whatsappService.removeParticipant(apiKey, ctx.chatId, participantId);
        break;
      }
      case 'llm_reply': {
        if (!ctx.chatId) throw new Error('llm_reply requires a chatId');
        const session = whatsappService.getSession(apiKey);
        const myJid = session?.myJid;
        
        // 1. Fetch config
        const aiConfig = this.getConfig(apiKey);
        if (!aiConfig || !aiConfig.apiKey) throw new Error('AI Copilot is not configured in settings.');
        
        // 2. Fetch context (last N messages)
        const limit = Number(action.contextLimit) || 10;
        const chatMsgs = await whatsappService.getMessages(apiKey, ctx.chatId, limit);
        const contextMessages = chatMsgs.reverse().map(m => {
           const isMe = (m.id.fromMe || (m.author && m.author === myJid));
           return {
             role: isMe ? 'assistant' : 'user',
             authorName: isMe ? 'Bot' : (m.sender?.pushname || m.sender?.name || m.sender?.formattedName || 'User'),
             text: m.body || m.caption || ''
           };
        }).filter(m => m.text);
        
        // If the current message isn't in context yet for some reason, ensure it's added
        if (ctx.text && !contextMessages.find(m => m.text === ctx.text)) {
           contextMessages.push({
             role: 'user',
             authorName: ctx.name || 'User',
             text: ctx.text
           });
        }
        
        // 3. Start Typing
        await whatsappService.startTyping(apiKey, ctx.chatId);
        
        try {
          // 4. Generate
          const prompt = interpolate(action.prompt || 'You are a helpful assistant.', ctx);
          const replyText = await generateReply(aiConfig, prompt, contextMessages);
          
          // 5. Dynamic human delay: wait Math.max(10s, words / (40 words per min) * 60s)
          // Actually user said: "randomly vary not less than 10 seconds at anypoint"
          const words = replyText.split(' ').length;
          let delaySeconds = Math.max(10, Math.round(words / (60 / 60))); // basic calc
          // Adding randomness
          delaySeconds += Math.floor(Math.random() * 5); // 0-4 seconds random
          
          // Wait for delay
          await new Promise(r => setTimeout(r, delaySeconds * 1000));
          
          // 6. Stop Typing & Send
          await whatsappService.stopTyping(apiKey, ctx.chatId);
          await whatsappService.sendMessage(apiKey, ctx.chatId, replyText, { quotedMessageId: rawId });
        } catch (error) {
          await whatsappService.stopTyping(apiKey, ctx.chatId).catch(() => {});
          throw error;
        }
        break;
      }"""

content = content.replace(target, replacement)

with open(path, 'w') as f:
    f.write(content)
