import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """        // 2. Fetch context (last N messages)
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
          let prompt = interpolate(action.prompt || 'You are a helpful assistant.', ctx);
          
          const personaCount = aiConfig.personaContextCount !== undefined ? Number(aiConfig.personaContextCount) : 20;
          if (personaCount > 0) {
            try {
              const personaMsgs = await inboxStore.getRecentFromMe(apiKey, ctx.chatId, personaCount);
              if (personaMsgs && personaMsgs.length > 0) {
                prompt += `\\n\\nTo help you perfectly mirror the human owner's tone and communication style, here are ${personaMsgs.length} of their most recent spontaneous messages sent specifically in this exact chat:\\n` + personaMsgs.map(m => `"${m}"`).join('\\n') + `\\n\\nAdopt this exact natural casing, slang, sentence length, and vocabulary.`;
              }
            } catch (e) {
              console.error('[AI Persona] Failed to fetch persona context:', e);
            }
          }
          
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
        }"""

new_block = """        const paceSeconds = aiConfig.globalPaceSeconds !== undefined ? Number(aiConfig.globalPaceSeconds) : 15;
        
        await runInQueue(apiKey, paceSeconds, async () => {
          // 2. Fetch context (last N messages) - done inside queue to ensure it's completely fresh
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
            let prompt = interpolate(action.prompt || 'You are a helpful assistant.', ctx);
            
            const personaCount = aiConfig.personaContextCount !== undefined ? Number(aiConfig.personaContextCount) : 20;
            if (personaCount > 0) {
              try {
                const personaMsgs = await inboxStore.getRecentFromMe(apiKey, ctx.chatId, personaCount);
                if (personaMsgs && personaMsgs.length > 0) {
                  prompt += `\\n\\nTo help you perfectly mirror the human owner's tone and communication style, here are ${personaMsgs.length} of their most recent spontaneous messages sent specifically in this exact chat:\\n` + personaMsgs.map(m => `"${m}"`).join('\\n') + `\\n\\nAdopt this exact natural casing, slang, sentence length, and vocabulary.`;
                }
              } catch (e) {
                console.error('[AI Persona] Failed to fetch persona context:', e);
              }
            }
            
            const replyText = await generateReply(aiConfig, prompt, contextMessages);
            
            // 5. Dynamic human delay
            const words = replyText.split(' ').length;
            let delaySeconds = Math.max(10, Math.round(words / (60 / 60))); 
            delaySeconds += Math.floor(Math.random() * 5); 
            
            await new Promise(r => setTimeout(r, delaySeconds * 1000));
            
            // 6. Stop Typing & Send
            await whatsappService.stopTyping(apiKey, ctx.chatId);
            await whatsappService.sendMessage(apiKey, ctx.chatId, replyText, { quotedMessageId: rawId });
          } catch (error) {
            await whatsappService.stopTyping(apiKey, ctx.chatId).catch(() => {});
            throw error;
          }
        });"""

content = content.replace(old_block, new_block)

with open(path, 'w') as f:
    f.write(content)

