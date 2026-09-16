const { GoogleGenerativeAI } = require('@google/generative-ai');

async function generateReply(config, systemPrompt, messagesContext) {
  if (!config.apiKey) throw new Error('AI Copilot: API key is not configured.');
  const provider = config.provider || 'gemini';
  
  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const modelName = config.model || 'gemini-1.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
    
    // Format chat history for Gemini
    const contents = messagesContext.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: `${m.authorName ? m.authorName + ': ' : ''}${m.text}` }]
    }));
    
    const result = await model.generateContent({ contents });
    return result.response.text();
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
      model: config.model || (provider === 'groq' ? 'llama3-8b-8192' : 'openai/gpt-3.5-turbo'),
      messages: formattedMessages,
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI Provider Error: ${err}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = { generateReply };
