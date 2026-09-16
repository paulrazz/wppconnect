import sys

path = 'client/src/components/ContactPickerModal.jsx'
with open(path, 'r') as f:
    content = f.read()

content = content.replace("export default function ContactPickerModal({ apiKey, theme, onPick, onClose, title = 'Choose contact / group' }) {", "export default function ContactPickerModal({ apiKey, theme, onPick, onClose, title = 'Choose contact / group', adminOnlyGroups = false }) {")

content = content.replace(".filter(g => !q || String(g.name || g.subject || contactName(g)).toLowerCase().includes(q));", ".filter(g => !q || String(g.name || g.subject || contactName(g)).toLowerCase().includes(q))\n    .filter(g => !adminOnlyGroups || g.iAmAdmin);")

with open(path, 'w') as f:
    f.write(content)

print("Patched ContactPickerModal!")
