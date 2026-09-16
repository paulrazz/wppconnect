import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

dup = """  async getMessages(apiKey, chatId, limit = 50) {
    const client = this.requireClient(apiKey);
    return client.getMessages(chatId, { count: limit });
  }

"""
content = content.replace(dup, '')
with open(path, 'w') as f:
    f.write(content)
