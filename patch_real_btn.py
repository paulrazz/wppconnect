import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_btn = """              <button
                onClick={() => addLeaf([])}
                disabled={countLeaves(draft.trigger.conditions) >= (spec.maxConditions || 10)}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-indigo-300 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add condition
              </button>"""

new_btn = """              <button
                onClick={() => addLeaf([])}
                disabled={countLeaves(draft.trigger.conditions) >= (spec.maxConditions || 10)}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${theme === 'dark' ? 'text-indigo-300 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add condition
              </button>
              {draft.trigger.conditions?.length > 0 && (
                <button 
                  onClick={() => patchTrigger({ conditions: [] })}
                  className={`ml-auto inline-flex items-center px-2 py-1.5 rounded-lg text-xs font-bold transition-colors ${theme === 'dark' ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'}`}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Switch to Spontaneous Mode
                </button>
              )}"""

content = content.replace(old_btn, new_btn)

with open(path, 'w') as f:
    f.write(content)

