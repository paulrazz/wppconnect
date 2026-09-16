import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_render = """          <div className="space-y-2 p-4">
            {draft.trigger.conditions.map((condition, index) => (
              <ConditionNodeEditor"""

new_render = """          <div className="space-y-2 p-4">
            {draft.trigger.conditions.length === 0 ? (
              <div className={`p-5 text-center rounded-lg border border-dashed ${theme === 'dark' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-emerald-400/50 bg-emerald-50'}`}>
                <div className={`text-sm font-bold flex items-center justify-center gap-2 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  <Sparkles className="w-4 h-4" /> Spontaneous Mode Active
                </div>
                <p className={`text-xs mt-1.5 max-w-sm mx-auto leading-relaxed ${theme === 'dark' ? 'text-emerald-500/70' : 'text-emerald-700/70'}`}>
                  This automation has no conditions. It will instantly trigger on <strong>every single message</strong> received in this chat.
                </p>
              </div>
            ) : draft.trigger.conditions.map((condition, index) => (
              <ConditionNodeEditor"""

content = content.replace(old_render, new_render)

# Add Sparkles to imports if not there
if "Sparkles" not in content:
    content = content.replace("import { PlayCircle,", "import { PlayCircle, Sparkles,")

with open(path, 'w') as f:
    f.write(content)

