import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

if "const inboxStore = require('./inbox-store.service');" not in content:
    content = content.replace("const eventStore = require('./event-store.service');", "const eventStore = require('./event-store.service');\nconst inboxStore = require('./inbox-store.service');")


old_prompt_gen = """          // 4. Generate
          const prompt = interpolate(action.prompt || 'You are a helpful assistant.', ctx);
          const replyText = await generateReply(aiConfig, prompt, contextMessages);"""

new_prompt_gen = """          // 4. Generate
          let prompt = interpolate(action.prompt || 'You are a helpful assistant.', ctx);
          
          const personaCount = aiConfig.personaContextCount !== undefined ? Number(aiConfig.personaContextCount) : 20;
          if (personaCount > 0) {
            try {
              const personaMsgs = await inboxStore.getRecentFromMe(apiKey, personaCount);
              if (personaMsgs && personaMsgs.length > 0) {
                prompt += `\\n\\nTo help you perfectly mirror the human owner's tone and communication style, here are ${personaMsgs.length} of their most recent spontaneous messages sent across various chats:\\n` + personaMsgs.map(m => `"${m}"`).join('\\n') + `\\n\\nAdopt this exact natural casing, slang, sentence length, and vocabulary.`;
              }
            } catch (e) {
              console.error('[AI Persona] Failed to fetch persona context:', e);
            }
          }
          
          const replyText = await generateReply(aiConfig, prompt, contextMessages);"""

content = content.replace(old_prompt_gen, new_prompt_gen)

with open(path, 'w') as f:
    f.write(content)

