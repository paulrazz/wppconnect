import sys, re

path = 'server/services/llm.service.js'
with open(path, 'r') as f:
    content = f.read()

old_block = """      model: config.model || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'openai/gpt-3.5-turbo'),"""

new_block = """      model: (config.model === 'llama-3.1-70b-versatile' ? 'llama-3.3-70b-versatile' : config.model) || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'openai/gpt-3.5-turbo'),"""

content = content.replace(old_block, new_block)

with open(path, 'w') as f:
    f.write(content)
