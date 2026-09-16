import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Fix Bot icon import crash
import_target = "import { Zap, Bot, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
import_repl = "import { Zap, Sparkles, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
content = content.replace(import_target, import_repl)

# Change the button icon to 🤖
btn_target = "<Bot className=\"w-4 h-4 mr-1\" /> AI Copilot"
btn_repl = "<span className=\"mr-1 text-sm\">🤖</span> AI Copilot"
content = content.replace(btn_target, btn_repl)

# Change the modal icon to 🤖
modal_target = "<Bot className=\"w-5 h-5 text-purple-500\" /> AI Copilot Settings"
modal_repl = "<span className=\"text-xl mr-2\">🤖</span> AI Copilot Settings"
content = content.replace(modal_target, modal_repl)

# 2. Fix the ContactPickerModal crash
picker_target = """        <ContactPickerModal
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
            } else if (pickerOpen.field) {
               patchAction({ [pickerOpen.field]: v || '' });
            }
            setPickerOpen(null);
          }}
        />"""
picker_repl = """        <ContactPickerModal
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
content = content.replace(picker_target, picker_repl)

with open(path, 'w') as f:
    f.write(content)

