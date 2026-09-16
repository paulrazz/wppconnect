import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>API Key</label>
                <input 
                  type="password"
                  value={aiConfig.apiKey} 
                  onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Enter API Key..."
                  className={inputCls(theme)}
                />
              </div>"""

new = """              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>API Key</label>
                <input 
                  type="password"
                  value={aiConfig.apiKey} 
                  onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Enter API Key..."
                  className={inputCls(theme)}
                />
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Chat Persona Context Limit</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  value={aiConfig.personaContextCount !== undefined ? aiConfig.personaContextCount : 20}
                  onChange={e => setAiConfig(prev => ({ ...prev, personaContextCount: parseInt(e.target.value) || 0 }))}
                  className={inputCls(theme)}
                />
                <span className={`text-[10px] mt-1 block ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Number of your recent messages sent in this specific chat to inject into the AI prompt so it learns your natural tone and persona.</span>
              </div>"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

