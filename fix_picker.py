import sys

path = 'client/src/components/ContactPickerModal.jsx'
with open(path, 'r') as f:
    content = f.read()

target1 = "setContacts(c.data.contacts || c.data || []);"
repl1 = "setContacts(Array.isArray(c.data?.data) ? c.data.data : (Array.isArray(c.data) ? c.data : []));"

target2 = "setGroups(g.data.groups || g.data || []);"
repl2 = "setGroups(Array.isArray(g.data?.data) ? g.data.data : (Array.isArray(g.data) ? g.data : []));"

content = content.replace(target1, repl1).replace(target2, repl2)

# Ensure Array.isArray is used before filter for safety
content = content.replace("const contactsList = (contacts || [])", "const contactsList = (Array.isArray(contacts) ? contacts : [])")
content = content.replace("const groupsList = (groups || [])", "const groupsList = (Array.isArray(groups) ? groups : [])")

with open(path, 'w') as f:
    f.write(content)

