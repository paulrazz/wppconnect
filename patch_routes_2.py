import sys

path = 'server/routes/v1.routes.js'
with open(path, 'r') as f:
    content = f.read()

old = """router.post('/automation/config/test', async (req, res) => {
  const { generateReply } = require('../services/llm.service');
  const result = await generateReply(req.body || {}, 'You are a test bot. Respond with exactly the word "OK" and nothing else.', [
    { role: 'user', text: 'Ping?' }
  ]);
  ok(res, { status: 'success', response: result });
});"""

new = """router.post('/automation/config/test', async (req, res) => {
  try {
    const { generateReply } = require('../services/llm.service');
    const result = await generateReply(req.body || {}, 'You are a test bot. Respond with exactly the word "OK" and nothing else.', [
      { role: 'user', text: 'Ping?' }
    ]);
    ok(res, { status: 'success', response: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

