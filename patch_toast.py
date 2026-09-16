import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Replace the aiTesting state with a more robust one
old_state = "const [aiTesting, setAiTesting] = useState(false);"
new_state = "const [aiTesting, setAiTesting] = useState({ busy: false, result: null });"
content = content.replace(old_state, new_state)

# Replace the onClick handler for the Test Connection button
old_button = """              <button 
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
              </button>"""

new_button = """              <div className="flex items-center gap-3">
                <button 
                  onClick={async () => {
                    if (!aiConfig.apiKey) return setAiTesting({ busy: false, result: { ok: false, msg: 'Enter API key first' } });
                    setAiTesting({ busy: true, result: null });
                    try {
                      const res = await axios.post(`${SERVER_URL}/api/v1/automation/config/test`, aiConfig, { headers: { 'x-api-key': apiKey } });
                      const text = res.data?.data?.response;
                      if (text === 'OK') setAiTesting({ busy: false, result: { ok: true, msg: 'Connection successful!' } });
                      else setAiTesting({ busy: false, result: { ok: false, msg: 'Unexpected response: ' + text } });
                    } catch (err) {
                      setAiTesting({ busy: false, result: { ok: false, msg: err.response?.data?.error || err.message } });
                    }
                  }}
                  disabled={aiTesting.busy}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50 ${theme === 'dark' ? 'border-[#363a45] text-slate-300 hover:bg-white/5' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                >
                  {aiTesting.busy ? 'Testing...' : 'Test Connection'}
                </button>
                {aiTesting.result && (
                  <span className={`text-xs font-semibold ${aiTesting.result.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {aiTesting.result.ok ? '✅ ' : '❌ '}{aiTesting.result.msg}
                  </span>
                )}
              </div>"""

content = content.replace(old_button, new_button)

with open(path, 'w') as f:
    f.write(content)

