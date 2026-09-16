import sys, re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = "Number of your recent messages sent in this specific chat to inject into the AI prompt so it learns your natural tone and persona."
new = "The amount of your recent outgoing messages from the triggered chat to inject into the AI prompt, allowing it to dynamically adapt to your persona for that specific person or group."

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

