import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Model</label>
                <select 
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  className={inputCls(theme)}
                >
                  {aiConfig.provider === 'gemini' && (
                    <>
                      <option value="gemini-1.5-flash">gemini-1.5-flash (Fast & Free)</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro (Advanced)</option>
                    </>
                  )}
                  {aiConfig.provider === 'groq' && (
                    <>
                      <option value="llama3-8b-8192">llama3-8b-8192 (Extremely Fast)</option>
                      <option value="llama3-70b-8192">llama3-70b-8192 (Powerful)</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                    </>
                  )}
                  {aiConfig.provider === 'openrouter' && (
                    <>
                      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                      <option value="anthropic/claude-3-haiku">Claude 3 Haiku</option>
                    </>
                  )}
                </select>
              </div>"""

new = """              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Model</label>
                <input 
                  type="text"
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="e.g. gemini-2.5-flash"
                  className={inputCls(theme)}
                />
              </div>"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

