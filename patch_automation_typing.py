import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

# 1. Update ACTION_META fields
actions_to_patch = ['send_text', 'send_media', 'forward_to', 'send_reaction']
for action in actions_to_patch:
    old_delay = "{ name: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 }"
    new_delay = """{ name: 'delay', label: 'Minimum delay (seconds)', type: 'number', min: 0, max: 3600, default: 0 },
      { name: 'randomDelay', label: 'Add random jitter (+0 to 5s)', type: 'bool', default: true },
      { name: 'simulateTyping', label: 'Show "typing..." indicator', type: 'bool', default: true }"""
    content = content.replace(old_delay, new_delay)

# 2. Modify execute triggering to NOT use setTimeout, but instead await inside `_execute`
target_handle = """    const delay = Math.max(0, Math.min(Number(rule.action?.delay) || 0, MAX_DELAY));
    const run = () => {
      this._execute(apiKey, rule, ctx, eventData, whatsappService).catch((error) => {
        console.error(`[automation] Rule "${rule.name}" failed:`, error.message);
        this._emit(apiKey, { ruleId: rule.id, name: rule.name, status: 'error', actionType: rule.action?.type, error: error.message, at: new Date().toISOString() });
      });
    };
    if (delay) {
      const timer = setTimeout(run, delay * 1000);
      if (timer.unref) timer.unref();
    } else {
      run();
    }"""
replacement_handle = """    this._execute(apiKey, rule, ctx, eventData, whatsappService).catch((error) => {
      console.error(`[automation] Rule "${rule.name}" failed:`, error.message);
      this._emit(apiKey, { ruleId: rule.id, name: rule.name, status: 'error', actionType: rule.action?.type, error: error.message, at: new Date().toISOString() });
    });"""
content = content.replace(target_handle, replacement_handle)

# 3. Add delay logic inside _execute
target_execute = """  async _execute(apiKey, rule, ctx, event, rawMessage) {
    const action = rule.action;
    const rawId = rawMessage?.id?._serialized || rawMessage?.id;
    const quotedId = action.quoted ? (ctx.messageId || rawId) : undefined;
    const to = interpolate(ctx.chatId, ctx);
    
    switch (action.type) {"""
replacement_execute = """  async _execute(apiKey, rule, ctx, event, rawMessage) {
    const action = rule.action;
    const rawId = rawMessage?.id?._serialized || rawMessage?.id;
    const quotedId = action.quoted ? (ctx.messageId || rawId) : undefined;
    const to = interpolate(ctx.chatId, ctx);
    
    const whatsappService = require('./whatsapp.service');
    let waitTime = Number(action.delay) || 0;
    if (action.randomDelay) waitTime += Math.floor(Math.random() * 5);
    
    if (waitTime > 0) {
      if (action.simulateTyping && ctx.chatId) {
        await whatsappService.startTyping(apiKey, ctx.chatId).catch(()=>{});
        await new Promise(r => setTimeout(r, waitTime * 1000));
        await whatsappService.stopTyping(apiKey, ctx.chatId).catch(()=>{});
      } else {
        await new Promise(r => setTimeout(r, waitTime * 1000));
      }
    }
    
    switch (action.type) {"""
content = content.replace(target_execute, replacement_execute)

with open(path, 'w') as f:
    f.write(content)

print("Patched automation typing and delays!")
