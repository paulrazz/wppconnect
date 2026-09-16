import sys, re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

# 1. Add aiQueues map
queue_code = """const inboxStore = require('./inbox-store.service');

const aiQueues = new Map(); // apiKey -> Promise queue
function runInQueue(apiKey, paceSeconds, taskFn) {
  if (!aiQueues.has(apiKey)) aiQueues.set(apiKey, Promise.resolve());
  
  const next = aiQueues.get(apiKey).then(async () => {
    await taskFn();
    // Wait for the pace interval before the next queued item can start
    if (paceSeconds > 0) {
      await new Promise(r => setTimeout(r, paceSeconds * 1000));
    }
  }).catch(e => {
    console.error('[AI Queue Error]', e);
  });
  
  aiQueues.set(apiKey, next);
  return next;
}
"""

content = content.replace("const inboxStore = require('./inbox-store.service');", queue_code)

# 2. Wrap llm_reply execution in the queue.
# We need to find the case 'llm_reply' block and wrap from "3. Start Typing" to "6. Stop Typing & Send".
# But wait, `whatsappService.startTyping` should happen INSIDE the queue, otherwise it will show typing in 5 chats for a long time.
# Yes, inside the queue!
