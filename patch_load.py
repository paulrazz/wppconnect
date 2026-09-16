import sys

path = 'client/src/components/AutomationStudio.jsx'
with open(path, 'r') as f:
    content = f.read()

old = """    axios.get(`${SERVER_URL}/api/v1/automation/config`, { headers: { 'x-api-key': apiKey } })
      .then(res => { if (res.data?.provider) setAiConfig(res.data); })
      .catch(() => {});"""

new = """    axios.get(`${SERVER_URL}/api/v1/automation/config`, { headers: { 'x-api-key': apiKey } })
      .then(res => { if (res.data?.data?.provider) setAiConfig(res.data.data); })
      .catch(() => {});"""

content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)

