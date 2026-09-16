import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

old = """  // ---- Public CRUD ----------------------------------------------------
  list(apiKey, chatId) {"""

new = """  getConfig(apiKey) {
    const store = this._store(apiKey, true);
    return store.aiConfig || {};
  }

  setConfig(apiKey, aiConfig) {
    const store = this._store(apiKey, true);
    store.aiConfig = aiConfig;
    this._save(store);
    return store.aiConfig;
  }

  // ---- Public CRUD ----------------------------------------------------
  list(apiKey, chatId) {"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

