import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Add lockedChatScope prop
content = content.replace("export default function AutomationStudio({ apiKey, theme, onDraftChange, initialChatScope }) {", "export default function AutomationStudio({ apiKey, theme, onDraftChange, initialChatScope, lockedChatScope }) {")

# 2. Add displayRules variable
if "const displayRules =" not in content:
    content = content.replace("const [loadError, setLoadError] = useState(false);", "const [loadError, setLoadError] = useState(false);\n  const displayRules = lockedChatScope ? rules.filter(r => r.trigger.chatScope === lockedChatScope) : rules;")

# 3. Use displayRules for the list rendering
content = content.replace("{rules.length === 0 ?", "{displayRules.length === 0 ?")
content = content.replace("{rules.map(rule => (", "{displayRules.map(rule => (")

# 4. Hide chatScope picker if lockedChatScope is provided
chatScopeLabel = """<label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                    Only trigger for a specific chat
                  </label>"""
newChatScopeLabel = """<label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                    {lockedChatScope ? 'Locked to this chat' : 'Only trigger for a specific chat'}
                  </label>"""
content = content.replace(chatScopeLabel, newChatScopeLabel)

# Wait, if lockedChatScope is set, we don't need to change much, just disable the button to change it, or hide it altogether?
# Actually, hiding it completely simplifies it.
scopeBlock = """                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                    Only trigger for a specific chat
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      value={draft.trigger.chatScope || ''}
                      readOnly
                      placeholder="Any chat"
                      className={`${inputCls(theme)} bg-transparent cursor-pointer`}
                      onClick={() => setPickerOpen({ target: 'chatScope' })}
                    />
                    {draft.trigger.chatScope && (
                      <button onClick={() => patchTrigger({ chatScope: null })} className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>"""

newScopeBlock = """                {!lockedChatScope && (
                  <div>
                    <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      Only trigger for a specific chat
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        value={draft.trigger.chatScope || ''}
                        readOnly
                        placeholder="Any chat"
                        className={`${inputCls(theme)} bg-transparent cursor-pointer`}
                        onClick={() => setPickerOpen({ target: 'chatScope' })}
                      />
                      {draft.trigger.chatScope && (
                        <button onClick={() => patchTrigger({ chatScope: null })} className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}>
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}"""
content = content.replace(scopeBlock, newScopeBlock)


# When creating a new rule, ensure it gets lockedChatScope
createFunc = """  const startCreate = () => {
    const defaultEvent = spec?.events?.[0]?.id || 'message.any';
    setDraft({
      name: '',
      trigger: { event: defaultEvent, conditions: { op: 'and', nodes: [] }, chatScope: initialChatScope || null },
      action: { type: 'send_message', text: '' },
    });
    setEditingId('new');
    setMsg(null);
  };"""

newCreateFunc = """  const startCreate = () => {
    const defaultEvent = spec?.events?.[0]?.id || 'message.any';
    setDraft({
      name: '',
      trigger: { event: defaultEvent, conditions: { op: 'and', nodes: [] }, chatScope: lockedChatScope || initialChatScope || null },
      action: { type: 'send_message', text: '' },
    });
    setEditingId('new');
    setMsg(null);
  };"""
content = content.replace(createFunc, newCreateFunc)

with open(path, 'w') as f:
    f.write(content)

