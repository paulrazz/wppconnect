import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """  async downloadMedia(apiKey, messageId) {"""

replacement = """  async forwardMessage(apiKey, to, messageId) {
    const client = this.requireClient(apiKey);
    const dest = await this.resolveDestination(apiKey, to);
    return client.forwardMessagesV2(dest, messageId);
  }

  async removeParticipant(apiKey, groupId, phone) {
    const client = this.requireClient(apiKey);
    return client.removeParticipant(groupId, phone);
  }

  async getGroupAdmins(apiKey, groupId) {
    const client = this.requireClient(apiKey);
    const admins = await client.getGroupAdmins(groupId);
    return admins.map(a => a._serialized || a.id || a);
  }

  async downloadMedia(apiKey, messageId) {"""

content = content.replace(target, replacement)

with open(path, 'w') as f:
    f.write(content)
print("Patched whatsapp.service.js!")
