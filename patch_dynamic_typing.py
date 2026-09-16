import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """    let waitTime = Number(action.delay) || 0;
    if (action.randomDelay) waitTime += Math.floor(Math.random() * 5);
    
    if (waitTime > 0 && action.type !== 'llm_reply') {"""

replacement = """    let waitTime = Number(action.delay) || 0;
    
    // Auto-calculate dynamic typing time based on word count
    if (action.simulateTyping && action.type !== 'llm_reply') {
      let textToType = '';
      if (action.type === 'send_text') textToType = interpolate(action.text || '', ctx);
      if (action.type === 'send_media') textToType = interpolate(action.caption || '', ctx);
      
      if (textToType.trim()) {
        const words = textToType.trim().split(/\\s+/).length;
        // Assume ~40 WPM (1.5 seconds per word), capped at 15 seconds so we don't hang the engine too long
        const dynamicDelay = Math.min(15, Math.round(words * 0.8));
        waitTime = Math.max(waitTime, dynamicDelay);
      }
    }

    if (action.randomDelay) waitTime += Math.floor(Math.random() * 5);
    
    if (waitTime > 0 && action.type !== 'llm_reply') {"""

content = content.replace(target, replacement)
with open(path, 'w') as f:
    f.write(content)
