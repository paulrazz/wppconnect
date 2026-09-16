import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old = "const personaMsgs = await inboxStore.getRecentFromMe(apiKey, personaCount);"
new = "const personaMsgs = await inboxStore.getRecentFromMe(apiKey, ctx.chatId, personaCount);"

content = content.replace(old, new)

# And fix the UI label from "Global Persona Context Limit" to "Chat Persona Context Limit"
old_ui = "Global Persona Context Limit"
new_ui = "Chat Persona Context Limit"

path_ui = 'client/src/components/AutomationStudio.jsx'
with open(path_ui, 'r') as f:
    content_ui = f.read()

content_ui = content_ui.replace(old_ui, new_ui)
content_ui = content_ui.replace("Number of your recent globally sent messages", "Number of your recent messages sent in this specific chat")

with open(path_ui, 'w') as f:
    f.write(content_ui)

with open(path, 'w') as f:
    f.write(content)

