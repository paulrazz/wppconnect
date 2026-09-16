import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old_picker = """                    {aiConfig.provider === 'groq' && (
                      <>
                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Extremely Fast)</option>
                        <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile (Powerful)</option>
                      </>
                    )}"""

new_picker = """                    {aiConfig.provider === 'groq' && (
                      <>
                        <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Latest & Powerful)</option>
                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Extremely Fast)</option>
                        <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (High Context)</option>
                      </>
                    )}"""

content = content.replace(old_picker, new_picker)

with open(path, 'w') as f:
    f.write(content)
