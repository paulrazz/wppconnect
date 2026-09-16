import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

target = """      // Legacy /contacts nests the arrays: { contacts: { all, contacts, groups } }.
      // Older payloads may also carry a bare array at res.data.contacts.
      const list = (res.data?.contacts?.contacts) || (Array.isArray(res.data?.contacts) ? res.data.contacts : []);"""

repl = """      // Legacy /contacts nests the arrays: { contacts: { all, contacts, groups } }.
      // We must map 'all' so that we have names for both individuals and groups.
      const payload = res.data?.contacts || {};
      const list = Array.isArray(payload.all) ? payload.all : (
        Array.isArray(payload) ? payload : (Array.isArray(payload.contacts) ? payload.contacts : [])
      );"""

content = content.replace(target, repl)

with open(path, 'w') as f:
    f.write(content)
