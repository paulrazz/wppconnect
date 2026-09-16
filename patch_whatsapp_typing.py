import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

target = """  async removeParticipant(apiKey, groupId, phone) {"""
replacement = """  async startTyping(apiKey, chatId) {
    const client = this.requireClient(apiKey);
    return client.startTyping(chatId);
  }

  async stopTyping(apiKey, chatId) {
    const client = this.requireClient(apiKey);
    return client.stopTyping(chatId);
  }
  
  async getMessages(apiKey, chatId, limit = 50) {
    const client = this.requireClient(apiKey);
    return client.getMessages(chatId, { count: limit });
  }

  async removeParticipant(apiKey, groupId, phone) {"""

content = content.replace(target, replacement)
with open(path, 'w') as f:
    f.write(content)
