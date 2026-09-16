import sys

path = 'server/routes/v1.routes.js'
with open(path, 'r') as f:
    content = f.read()

target = "router.get('/automation/spec', (_req, res) => ok(res, automation.spec()));"

replacement = """router.get('/automation/spec', (_req, res) => ok(res, automation.spec()));
router.get('/automation/config', (req, res) => ok(res, automation.getConfig(res.locals.apiKey)));
router.put('/automation/config', (req, res) => ok(res, automation.setConfig(res.locals.apiKey, req.body || {})));"""

content = content.replace(target, replacement)
with open(path, 'w') as f:
    f.write(content)
