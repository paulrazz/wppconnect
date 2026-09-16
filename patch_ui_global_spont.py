import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Enable Spontaneous button globally by removing lockedChatScope requirement
old_btn = "{lockedChatScope && draft.trigger.conditions?.length > 0 && ("
new_btn = "{draft.trigger.conditions?.length > 0 && ("
content = content.replace(old_btn, new_btn)

# Add globalPaceSeconds to default state
old_state = 'personaContextCount: 20 });'
new_state = 'personaContextCount: 20, globalPaceSeconds: 15 });'
content = content.replace(old_state, new_state)

# Add UI for globalPaceSeconds below personaContextCount
old_input = """                <span className={`text-[10px] mt-1 block ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>The amount of your recent outgoing messages from the triggered chat to inject into the AI prompt, allowing it to dynamically adapt to your persona for that specific person or group.</span>
              </div>"""
              
new_input = """                <span className={`text-[10px] mt-1 block ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>The amount of your recent outgoing messages from the triggered chat to inject into the AI prompt, allowing it to dynamically adapt to your persona for that specific person or group.</span>
              </div>
              <div>
                <label className={`block font-semibold mb-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>AI Reply Pace Interval (seconds)</label>
                <input 
                  type="number"
                  min="0"
                  max="300"
                  value={aiConfig.globalPaceSeconds !== undefined ? aiConfig.globalPaceSeconds : 15}
                  onChange={e => setAiConfig(prev => ({ ...prev, globalPaceSeconds: parseInt(e.target.value) || 0 }))}
                  className={inputCls(theme)}
                />
                <span className={`text-[10px] mt-1 block ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>The minimum wait time between sending AI replies when multiple chats trigger at the same time. Ensures the bot replies to chats one-by-one like a human.</span>
              </div>"""

content = content.replace(old_input, new_input)

with open(path, 'w') as f:
    f.write(content)

