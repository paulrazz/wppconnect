path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

# Fix: extract .message from the error object if it's an object, fallback to string
old = "setMsg({ ok: false, text: err.response?.data?.error || err.message });"
new = "const apiErr = err.response?.data?.error; setMsg({ ok: false, text: (apiErr && typeof apiErr === 'object' ? apiErr.message : apiErr) || err.message || 'Unknown error' });"

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

print(f"Replaced {content.count('apiErr')} occurrences")
