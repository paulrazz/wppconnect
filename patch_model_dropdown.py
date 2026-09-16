import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_start = '                <label className={`block font-semibold mb-1.5 ${theme === \'dark\' ? \'text-slate-400\' : \'text-slate-500\'}`}>Model</label>'
new_code = old_start + """
                <select 
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  className={inputCls(theme)}
                >
                  {aiConfig.provider === 'gemini' && (
                    <>
                      <option value="gemini-3.6-flash">gemini-3.6-flash (Fast & Free)</option>
                      <option value="gemini-3.6-pro">gemini-3.6-pro (Advanced)</option>
                    </>
                  )}
                  {aiConfig.provider === 'groq' && (
                    <>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Extremely Fast)</option>
                      <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile (Powerful)</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                    </>
                  )}
                  {aiConfig.provider === 'openrouter' && (
                    <>
                      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                      <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku</option>
                    </>
                  )}
                </select>"""

# Replace the input block
pattern = re.compile(r'(<label className={`block font-semibold mb-1\.5 \$\{theme === \'dark\' \? \'text-slate-400\' : \'text-slate-500\'\}`}>Model</label>)\s*<input.*?\/>', re.DOTALL)
content = pattern.sub(new_code, content)

# Also fix the initial states and onChange for provider
content = content.replace("model: 'gemini-1.5-flash'", "model: 'gemini-3.6-flash'")
content = content.replace("if (provider === 'gemini') model = 'gemini-1.5-flash';", "if (provider === 'gemini') model = 'gemini-3.6-flash';")
content = content.replace("else if (provider === 'groq') model = 'llama3-8b-8192';", "else if (provider === 'groq') model = 'llama-3.1-8b-instant';")

with open(path, 'w') as f:
    f.write(content)

