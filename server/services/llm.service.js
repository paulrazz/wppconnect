const { GoogleGenerativeAI } = require('@google/generative-ai');

async function generateReply(config, systemPrompt, messagesContext) {
  if (!config.apiKey) throw new Error('AI Copilot: API key is not configured.');
  const provider = config.provider || 'gemini';
  
  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const modelName = config.model || 'gemini-3.6-flash';
    const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
    
    // Format chat history for Gemini (collapse consecutive identical roles)
    const contents = [];
    for (const m of messagesContext) {
      const gRole = m.role === 'assistant' ? 'model' : 'user';
      const text = `${m.authorName ? m.authorName + ': ' : ''}${m.text}`;
      
      if (contents.length > 0 && contents[contents.length - 1].role === gRole) {
         contents[contents.length - 1].parts[0].text += `\n\n${text}`;
      } else {
         contents.push({ role: gRole, parts: [{ text }] });
      }
    }
    
    // Gemini strictly requires the history to end with a 'user' turn
    if (contents.length > 0 && contents[contents.length - 1].role !== 'user') {
       contents.push({ role: 'user', parts: [{ text: '(System: Please reply)' }] });
    }
    
    try {
      const result = await model.generateContent({ contents });
      return result.response.text();
    } catch (error) {
      // Check for 429 rate limit
      if (error.status === 429 || error.message.includes('429 Too Many Requests') || error.message.includes('Quota exceeded')) {
        let delayMs = 15000; // default 15s
        // Try to parse delay from "retryDelay": "13s" or "Please retry in 13.65s"
        const retryMatch = error.message.match(/retry in ([0-9.]+)s/i) || error.message.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
        if (retryMatch && retryMatch[1]) {
           delayMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000; // parse and add 1s buffer
        }
        const err = new Error(`RATE_LIMIT:${delayMs}`);
        throw err;
      }
      throw error;
    }
  }
  
  // OpenAI compatible (Groq, OpenRouter)
  const url = provider === 'groq' 
    ? 'https://api.groq.com/openai/v1/chat/completions' 
    : 'https://openrouter.ai/api/v1/chat/completions';
    
  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messagesContext.map(m => ({
      role: m.role,
      content: `${m.authorName ? m.authorName + ': ' : ''}${m.text}`
    }))
  ];
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: (config.model === 'llama-3.1-70b-versatile' ? 'llama-3.3-70b-versatile' : config.model) || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'openai/gpt-3.5-turbo'),
      messages: formattedMessages,
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    
    // Check for 429 rate limit
    if (response.status === 429 || err.includes('429') || err.includes('Rate limit reached')) {
      let delayMs = 15000;
      // Try to parse delay from error
      const retryMatch = err.match(/Please try again in ([0-9.]+)s/i) || err.match(/retry in ([0-9.]+)s/i);
      if (retryMatch && retryMatch[1]) {
         delayMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000;
      } else {
         // Groq often sends Retry-After header
         const retryAfter = response.headers.get('retry-after');
         if (retryAfter) {
            delayMs = Math.ceil(parseFloat(retryAfter) * 1000) + 1000;
         }
      }
      throw new Error(`RATE_LIMIT:${delayMs}`);
    }
    
    throw new Error(`AI Provider Error: ${err}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = { generateReply };
