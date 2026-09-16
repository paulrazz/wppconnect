import sys, re

path = 'server/services/llm.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI Provider Error: ${err}`);
  }"""

new_block = """  if (!response.ok) {
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
  }"""

content = content.replace(old_block, new_block)

with open(path, 'w') as f:
    f.write(content)
