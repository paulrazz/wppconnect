import sys

path = 'server/services/llm.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """    // Format chat history for Gemini
    const contents = messagesContext.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: `${m.authorName ? m.authorName + ': ' : ''}${m.text}` }]
    }));"""

new_block = """    // Format chat history for Gemini (collapse consecutive identical roles)
    const contents = [];
    for (const m of messagesContext) {
      const gRole = m.role === 'assistant' ? 'model' : 'user';
      const text = `${m.authorName ? m.authorName + ': ' : ''}${m.text}`;
      
      if (contents.length > 0 && contents[contents.length - 1].role === gRole) {
         contents[contents.length - 1].parts[0].text += `\\n\\n${text}`;
      } else {
         contents.push({ role: gRole, parts: [{ text }] });
      }
    }
    
    // Gemini strictly requires the history to end with a 'user' turn
    if (contents.length > 0 && contents[contents.length - 1].role !== 'user') {
       contents.push({ role: 'user', parts: [{ text: '(System: Please reply)' }] });
    }"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w') as f:
        f.write(content)
    print("Success")
else:
    print("Failed to find old block")
