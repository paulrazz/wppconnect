import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_state = "const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });"
new_state = """const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });
  const [aiTesting, setAiTesting] = useState(false);"""

content = content.replace(old_state, new_state)

old_buttons = """              <button onClick={() => setAiConfigOpen(false)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${theme === 'dark' ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
              <button 
                onClick={async () => {
                  try {
                    await axios.put(`${SERVER_URL}/api/v1/automation/config`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    setAiConfigOpen(false);
                    alert('Saved!');
                  } catch (e) {
                    alert('Failed to save config');
                  }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 shadow-md"
              >
                Save
              </button>"""

new_buttons = """              <button onClick={() => setAiConfigOpen(false)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${theme === 'dark' ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
              <button 
                onClick={async () => {
                  if (!aiConfig.apiKey) return alert('Enter API key first');
                  setAiTesting(true);
                  try {
                    const res = await axios.post(`${SERVER_URL}/api/v1/automation/config/test`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    if (res.data.response === 'OK') alert('Connection successful!');
                    else alert('Unexpected response: ' + res.data.response);
                  } catch (err) {
                    alert('Test failed: ' + (err.response?.data?.error || err.message));
                  }
                  setAiTesting(false);
                }}
                disabled={aiTesting}
                className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${theme === 'dark' ? 'border-[#363a45] text-slate-300 hover:bg-white/5' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {aiTesting ? 'Testing...' : 'Test Connection'}
              </button>
              <button 
                onClick={async () => {
                  try {
                    await axios.put(`${SERVER_URL}/api/v1/automation/config`, aiConfig, { headers: { 'x-api-key': apiKey } });
                    setAiConfigOpen(false);
                    alert('Saved!');
                  } catch (e) {
                    alert('Failed to save config: ' + (e.response?.data?.error || e.message));
                  }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 shadow-md"
              >
                Save
              </button>"""

content = content.replace(old_buttons, new_buttons)

with open(path, 'w') as f:
    f.write(content)

