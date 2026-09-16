import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

# Add import
if "const inboxStore = require('./inbox-store.service');" not in content:
    content = content.replace("const eventStore = require('./event-store.service');", "const eventStore = require('./event-store.service');\nconst inboxStore = require('./inbox-store.service');")

# Find where system prompt is built
# Let's check the code around `llm_reply` execution.
