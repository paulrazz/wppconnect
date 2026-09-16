import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. State
state_target = "const [editing, setEditing] = useState(null);"
state_repl = "const [editing, setEditing] = useState(null);\n  const [aiConfigOpen, setAiConfigOpen] = useState(false);\n  const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });"
if "aiConfigOpen" not in content:
    content = content.replace(state_target, state_repl)

# 2. Fetch Config
fetch_target = "const { data: { rules, events } } = await axios.get(`${API}/automation`, { headers: { 'x-api-key': apiKey } });"
fetch_repl = """const { data: { rules, events } } = await axios.get(`${API}/automation`, { headers: { 'x-api-key': apiKey } });
        const { data: config } = await axios.get(`${API}/automation/config`, { headers: { 'x-api-key': apiKey } }).catch(() => ({ data: {} }));
        if (config && config.provider) setAiConfig(config);"""
if "axios.get(`${API}/automation/config`" not in content:
    content = content.replace(fetch_target, fetch_repl)

# 3. Sparkles import
import_target = "import { Zap, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
import_repl = "import { Zap, Sparkles, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
if "Sparkles" not in content:
    content = content.replace(import_target, import_repl)

# 4. Button
btn_target = """<button onClick={startNew} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
            <Plus className="w-4 h-4 mr-1" /> New rule
          </button>"""
btn_repl = """<div className="flex gap-2">
            <button onClick={() => setAiConfigOpen(true)} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${theme === 'dark' ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400' : 'bg-purple-100 hover:bg-purple-200 text-purple-600'}`}>
              <Sparkles className="w-4 h-4 mr-1" /> AI Copilot
            </button>
            <button onClick={startNew} className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
              <Plus className="w-4 h-4 mr-1" /> New rule
            </button>
          </div>"""
if "AI Copilot" not in content:
    content = content.replace(btn_target, btn_repl)

# 5. Modal
modal_target = "{editing && ("
modal_repl = """{aiConfigOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAiConfigOpen(false)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl border ${theme === 'dark' ? 'bg-[#0d1016] border-[#262931]' : 'bg-white border-slate-200'}`}>
            <h2 className={`text-lg font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-slate-100' : 'text-slate-800'}`}>
              <Sparkles className="w-5 h-5 text-purple-500" /> AI Copilot Settings
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

      {editing && ("""
if "aiConfigOpen &&" not in content:
    content = content.replace(modal_target, modal_repl)

with open(path, 'w') as f:
    f.write(content)
