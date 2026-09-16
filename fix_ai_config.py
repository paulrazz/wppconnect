import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Add state
if 'aiConfigOpen' not in content[:2000]: # avoid matching the button string
    target_state = "const [pickerOpen, setPickerOpen] = useState(null);"
    repl_state = "const [pickerOpen, setPickerOpen] = useState(null);\n  const [aiConfigOpen, setAiConfigOpen] = useState(false);\n  const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });"
    content = content.replace(target_state, repl_state)

# 2. Change Sparkles to Robot emoji (or Bot icon from lucide-react)
# Actually, Lucide has 'Bot' icon.
import_target = "import { Zap, Sparkles, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
import_repl = "import { Zap, Bot, Play, CheckCircle2, AlertCircle, X, ChevronRight, Layers, Plus, Activity, Edit2, Trash2, ArrowRight } from 'lucide-react';"
content = content.replace(import_target, import_repl)

# Change the button icon
btn_target = "<Sparkles className=\"w-4 h-4 mr-1\" /> AI Copilot"
btn_repl = "<Bot className=\"w-4 h-4 mr-1\" /> AI Copilot"
content = content.replace(btn_target, btn_repl)

# Change the modal icon
modal_target = "<Sparkles className=\"w-5 h-5 text-purple-500\" /> AI Copilot Settings"
modal_repl = "<Bot className=\"w-5 h-5 text-purple-500\" /> AI Copilot Settings"
content = content.replace(modal_target, modal_repl)

with open(path, 'w') as f:
    f.write(content)
