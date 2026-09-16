import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """  async _execute(apiKey, rule, ctx, eventData, whatsappService) {
    if (whatsappService?.io && !this.io) this.io = whatsappService.io;
    const action = rule.action;
    const rawMessage = eventData?.rawMessage || eventData;
    const rawId = rawMessage?.id?._serialized || rawMessage?.id;
    const quotedId = action.quoted ? (ctx.messageId || rawId) : undefined;
    const event = eventData?.event || 'message.received';
    const to = interpolate(ctx.chatId, ctx);

    switch (action.type) {"""
replacement = """  async _execute(apiKey, rule, ctx, eventData, whatsappService) {
    if (whatsappService?.io && !this.io) this.io = whatsappService.io;
    const action = rule.action;
    const rawMessage = eventData?.rawMessage || eventData;
    const rawId = rawMessage?.id?._serialized || rawMessage?.id;
    const quotedId = action.quoted ? (ctx.messageId || rawId) : undefined;
    const event = eventData?.event || 'message.received';
    const to = interpolate(ctx.chatId, ctx);
    
    let waitTime = Number(action.delay) || 0;
    if (action.randomDelay) waitTime += Math.floor(Math.random() * 5);
    
    if (waitTime > 0 && action.type !== 'llm_reply') {
      if (action.simulateTyping && ctx.chatId) {
        await whatsappService.startTyping(apiKey, ctx.chatId).catch(()=>{});
        await new Promise(r => setTimeout(r, waitTime * 1000));
        await whatsappService.stopTyping(apiKey, ctx.chatId).catch(()=>{});
      } else {
        await new Promise(r => setTimeout(r, waitTime * 1000));
      }
    }

    switch (action.type) {"""
content = content.replace(target, replacement)
with open(path, 'w') as f:
    f.write(content)
