import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target1 = """      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(raw.rules)) rules = raw.rules;
      } catch (_) { /* First run for this tenant. */ }"""
replacement1 = """      let aiConfig = {};
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(raw.rules)) rules = raw.rules;
        if (raw.aiConfig) aiConfig = raw.aiConfig;
      } catch (_) { /* First run for this tenant. */ }"""
content = content.replace(target1, replacement1)

target2 = "      if (rules.length || fs.existsSync(file)) {"
replacement2 = "      if (rules.length || Object.keys(aiConfig).length || fs.existsSync(file)) {"
content = content.replace(target2, replacement2)

target3 = "        this.stores.set(key, { file, rules });"
replacement3 = "        this.stores.set(key, { file, rules, aiConfig });"
content = content.replace(target3, replacement3)

target4 = "if (!this.stores.has(key)) this.stores.set(key, { file: path.join(DATA_DIR, `${key}.json`), rules: [] });"
replacement4 = "if (!this.stores.has(key)) this.stores.set(key, { file: path.join(DATA_DIR, `${key}.json`), rules: [], aiConfig: {} });"
content = content.replace(target4, replacement4)

target5 = "      fs.writeFileSync(tmp, JSON.stringify({ rules: store.rules }, null, 2), 'utf8');"
replacement5 = "      fs.writeFileSync(tmp, JSON.stringify({ rules: store.rules, aiConfig: store.aiConfig || {} }, null, 2), 'utf8');"
content = content.replace(target5, replacement5)

target6 = """  list(apiKey, filterChatId) {
    const store = this._store(apiKey);
    let result = store.rules;"""
replacement6 = """  getConfig(apiKey) {
    return this._store(apiKey).aiConfig || {};
  }
  setConfig(apiKey, config) {
    const store = this._store(apiKey, true);
    store.aiConfig = { ...store.aiConfig, ...config };
    this._save(store);
    return store.aiConfig;
  }
  list(apiKey, filterChatId) {
    const store = this._store(apiKey);
    let result = store.rules;"""
content = content.replace(target6, replacement6)


with open(path, 'w') as f:
    f.write(content)
