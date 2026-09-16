import sys
import re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Fix the picker
picker_regex = r"<ContactPickerModal.*?\/>"
picker_repl = """<ContactPickerModal
          apiKey={apiKey}
          theme={theme}
          adminOnlyGroups={pickerOpen.target === 'chatScope' || pickerOpen.field === 'chatId'}
          onClose={() => setPickerOpen(null)}
          onPick={(id, label) => {
            const v = pickerOpen.field && isNameField(pickerOpen.field) ? label : id;
            if (pickerOpen.target === 'chatScope') {
               patchTrigger({ chatScope: v || null });
            } else if (pickerOpen.path) {
               updateNode(pickerOpen.path, { value: v || '' });
            } else if (pickerOpen.field) {
               patchAction({ [pickerOpen.field]: v || '' });
            }
            setPickerOpen(null);
          }}
        />"""
content = re.sub(picker_regex, picker_repl, content, flags=re.DOTALL)

# 2. Add AI modal
modal = """
      {aiConfigOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAiConfigOpen(false)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl border ${theme === 'dark' ? 'bg-[#0d1016] border-[#262931]' : 'bg-white border-slate-200'}`}>
            <h2 className={`text-lg font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-slate-100' : 'text-slate-800'}`}>
              <span className="text-xl mr-2">🤖</span> AI Copilot Settings
            </h2>
            <div className="space-y-4 text-sm">
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Provider</label>
                <select 
                  value={aiConfig.provider} 
                  onChange={e => setAiConfig(prev => ({ ...prev, provider: e.target.value }))}
                  className={inputCls(theme)}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="groq">Groq (Llama 3)</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Model</label>
                <input 
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="e.g. gemini-1.5-flash"
                  className={inputCls(theme)}
                />
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>API Key</label>
                <input 
                  type="password"
                  value={aiConfig.apiKey} 
                  onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Enter API Key..."
                  className={inputCls(theme)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setAiConfigOpen(false)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${theme === 'dark' ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
              <button 
                onClick={async () => {
                  try {
                    await axios.put(`${API}/automation/config`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    setAiConfigOpen(false);
                  } catch (e) {
                    alert('Failed to save config');
                  }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 shadow-md"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
"""

if 'aiConfigOpen &&' not in content:
    content = content.replace('    </div>\n  );\n}', modal + '    </div>\n  );\n}')

with open(path, 'w') as f:
    f.write(content)

