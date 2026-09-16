import sys
import re

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

content = content.replace("🌟 Omni-Adaptive Clone (Intelligent Mode)", "Intelligent Mode")

with open(path, 'w') as f:
    f.write(content)

