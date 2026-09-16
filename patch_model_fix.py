import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Replace the entire <select> block for Model
old_start = '                <label className={`block font-semibold mb-1.5 ${theme === \'dark\' ? \'text-slate-400\' : \'text-slate-500\'}`}>Model</label>'
new_code = old_start + """
                <input 
                  type="text"
                  value={aiConfig.model} 
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="e.g. gemini-1.5-flash"
                  className={inputCls(theme)}
                />"""

# We need to find the <select> ... </select> that follows old_start
pattern = re.compile(r'(<label className={`block font-semibold mb-1\.5 \$\{theme === \'dark\' \? \'text-slate-400\' : \'text-slate-500\'\}`}>Model</label>)\s*<select.*?</select>', re.DOTALL)
content = pattern.sub(new_code, content)

with open(path, 'w') as f:
    f.write(content)

