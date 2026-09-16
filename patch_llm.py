path = 'server/services/llm.service.js'
with open(path, 'r') as f:
    content = f.read()

old_gemini = """    const result = await model.generateContent({ contents });
    return result.response.text();"""

new_gemini = """    try {
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
    }"""

content = content.replace(old_gemini, new_gemini)

with open(path, 'w') as f:
    f.write(content)
