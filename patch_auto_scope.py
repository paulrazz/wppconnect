import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

target_scope = """              <input
                value={draft.trigger.chatScope || ''}
                onChange={e => patchTrigger({ chatScope: e.target.value || null })}
                placeholder="e.g. 2348012345678@c.us or a group ID"
                className={`${inputCls(theme)} font-mono text-[11px] sm:max-w-[280px]`}
              />"""

replacement_scope = """              <button
                type="button"
                onClick={() => setPickerOpen({ target: 'chatScope' })}
                className={`flex items-center gap-2 ${inputCls(theme)} flex-1 sm:max-w-[280px] text-left`}
              >
                <ContactRound className={`w-4 h-4 shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`} />
                <span className={`truncate ${draft.trigger.chatScope ? '' : (theme === 'dark' ? 'text-slate-500' : 'text-slate-400')}`}>
                  {draft.trigger.chatScope ? shortId(draft.trigger.chatScope) : 'Pick a group you manage…'}
                </span>
              </button>"""

content = content.replace(target_scope, replacement_scope)

target_picker = """      {pickerOpen && (
        <ContactPickerModal
          apiKey={apiKey}
          theme={theme}
          onClose={() => setPickerOpen(null)}
          onPick={(contact) => {
            const v = isNameField(pickerOpen.field) ? (contact.name || contact.formattedName || contact.pushname || contact.shortName) : contact.id?._serialized || contact.id;
            updateNode(pickerOpen.path, { value: v || '' });
            setPickerOpen(null);
          }}
        />
      )}"""

replacement_picker = """      {pickerOpen && (
        <ContactPickerModal
          apiKey={apiKey}
          theme={theme}
          adminOnlyGroups={pickerOpen.target === 'chatScope' || pickerOpen.field === 'chatId'}
          onClose={() => setPickerOpen(null)}
          onPick={(contact) => {
            const v = pickerOpen.field && isNameField(pickerOpen.field) ? (contact.name || contact.formattedName || contact.pushname || contact.shortName) : contact.id?._serialized || contact.id;
            if (pickerOpen.target === 'chatScope') {
               patchTrigger({ chatScope: v || null });
            } else if (pickerOpen.path) {
               updateNode(pickerOpen.path, { value: v || '' });
            }
            setPickerOpen(null);
          }}
        />
      )}"""

content = content.replace(target_picker, replacement_picker)

with open(path, 'w') as f:
    f.write(content)

print("Patched Scope Picker!")
