import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Add personaContextCount to default aiConfig state
old_state = 'const [aiConfig, setAiConfig] = useState({ provider: "gemini", model: "gemini-1.5-flash", apiKey: "" });'
new_state = 'const [aiConfig, setAiConfig] = useState({ provider: "gemini", model: "gemini-3.6-flash", apiKey: "", personaContextCount: 20 });'
content = content.replace(old_state, new_state)

# Add UI field for personaContextCount
old_ui = """                </select>
              </div>
              <div className="flex items-center gap-3">"""

new_ui = """                </select>
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Global Persona Context Limit</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  value={aiConfig.personaContextCount !== undefined ? aiConfig.personaContextCount : 20}
                  onChange={e => setAiConfig(prev => ({ ...prev, personaContextCount: parseInt(e.target.value) || 0 }))}
                  className={inputCls(theme)}
                />
                <span className={`text-[10px] mt-1 block ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Number of your recent globally sent messages to inject into the AI prompt so it learns your natural tone and persona.</span>
              </div>
              <div className="flex items-center gap-3">"""

content = content.replace(old_ui, new_ui)

with open(path, 'w') as f:
    f.write(content)

