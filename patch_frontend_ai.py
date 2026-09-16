import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Add AI settings state
target = "const [testOpen, setTestOpen] = useState(false);"
replacement = "const [testOpen, setTestOpen] = useState(false);\n  const [aiConfigOpen, setAiConfigOpen] = useState(false);\n  const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });"
if "aiConfigOpen" not in content:
    content = content.replace(target, replacement)

# Fetch config in useEffect
fetch_target = """        const { data: { rules, events } } = await axios.get(`${API}/automation`, { headers: { 'x-api-key': apiKey } });"""
fetch_replacement = """        const { data: { rules, events } } = await axios.get(`${API}/automation`, { headers: { 'x-api-key': apiKey } });
        const { data: config } = await axios.get(`${API}/automation/config`, { headers: { 'x-api-key': apiKey } }).catch(() => ({ data: {} }));
        if (config && config.provider) setAiConfig(config);"""
if "axios.get(`${API}/automation/config`" not in content:
    content = content.replace(fetch_target, fetch_replacement)

# Render AI Settings button
btn_target = """          <button
            onClick={() => setTestOpen(true)}
            disabled={!rules.length}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm ${dark ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:bg-[#161a22] disabled:text-slate-600 disabled:shadow-none' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none'}`}
          >
            <PlayCircle className="w-4 h-4" /> Test Rules
          </button>"""
btn_replacement = btn_target + """
          <button
            onClick={() => setAiConfigOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm ${dark ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'}`}
          >
            <Sparkles className="w-4 h-4" /> AI Copilot
          </button>"""
if "AI Copilot" not in content:
    content = content.replace(btn_target, btn_replacement)

# Render modal
modal_target = """      {testOpen && (
        <TestModal"""
modal_replacement = """      {aiConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAiConfigOpen(false)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl border ${dark ? 'bg-[#0d1016] border-[#262931]' : 'bg-white border-slate-200'}`}>
            <h2 className={`text-lg font-bold mb-4 flex items-center gap-2 ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Sparkles className="w-5 h-5 text-purple-500" /> AI Copilot Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Provider</label>
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
                <label className={`block text-xs font-semibold mb-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Model</label>
                <input 
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="e.g. gemini-1.5-flash"
                  className={inputCls(theme)}
                />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>API Key</label>
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
              <button onClick={() => setAiConfigOpen(false)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${dark ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
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
      
      {testOpen && (
        <TestModal"""
if "aiConfigOpen &&" not in content:
    content = content.replace(modal_target, modal_replacement)

with open(path, 'w') as f:
    f.write(content)

