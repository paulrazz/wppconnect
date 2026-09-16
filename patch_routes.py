import sys

path = 'server/routes/v1.routes.js'
with open(path, 'r') as f:
    content = f.read()

old = """router.put('/automation/config', (req, res) => ok(res, automation.setConfig(res.locals.apiKey, req.body || {})));"""

new = """router.put('/automation/config', (req, res) => ok(res, automation.setConfig(res.locals.apiKey, req.body || {})));
router.post('/automation/config/test', async (req, res) => {
  const { generateReply } = require('../services/llm.service');
  const result = await generateReply(req.body || {}, 'You are a test bot. Respond with exactly the word "OK" and nothing else.', [
    { role: 'user', text: 'Ping?' }
  ]);
  ok(res, { status: 'success', response: result });
});"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

