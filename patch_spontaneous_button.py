import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_btn = """            <div className={`flex flex-wrap gap-2 pt-2 border-t ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-100'}`}>
              <button 
                onClick={() => patchTrigger({ conditions: [...(draft.trigger.conditions || []), { field: 'message', op: 'equals', value: '' }] })}
                className={`inline-flex items-center px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${theme === 'dark' ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Condition
              </button>
            </div>"""

new_btn = """            <div className={`flex flex-wrap items-center justify-between gap-2 pt-2 border-t ${theme === 'dark' ? 'border-[#1e222b]' : 'border-slate-100'}`}>
              <button 
                onClick={() => patchTrigger({ conditions: [...(draft.trigger.conditions || []), { field: 'message', op: 'equals', value: '' }] })}
                className={`inline-flex items-center px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${theme === 'dark' ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Condition
              </button>
              {lockedChatScope && draft.trigger.conditions?.length > 0 && (
                <button 
                  onClick={() => patchTrigger({ conditions: [] })}
                  className={`inline-flex items-center px-2 py-1.5 rounded-lg text-xs font-bold transition-colors ${theme === 'dark' ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'}`}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Switch to Spontaneous Mode
                </button>
              )}
            </div>"""

content = content.replace(old_btn, new_btn)

with open(path, 'w') as f:
    f.write(content)

