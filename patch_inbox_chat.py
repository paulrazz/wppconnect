import sys, re

path = 'server/services/inbox-store.service.js'
with open(path, 'r') as f:
    content = f.read()

old_method = """  async getRecentFromMe(apiKey, limit = 20) {
    if (!limit || limit <= 0) return [];
    // Fetch extra to account for media messages without captions
    const rows = await DB.all(
      `SELECT message_json FROM inbox_messages 
       WHERE api_key=? AND json_extract(message_json, '$.id.fromMe') = 1 
       ORDER BY stored_at DESC LIMIT ?`, 
      [apiKey, limit * 3]
    );"""

new_method = """  async getRecentFromMe(apiKey, chatId, limit = 20) {
    if (!limit || limit <= 0) return [];
    // Fetch extra to account for media messages without captions
    const rows = await DB.all(
      `SELECT message_json FROM inbox_messages 
       WHERE api_key=? AND chat_id=? AND json_extract(message_json, '$.id.fromMe') = 1 
       ORDER BY stored_at DESC LIMIT ?`, 
      [apiKey, chatId, limit * 3]
    );"""

content = content.replace(old_method, new_method)

with open(path, 'w') as f:
    f.write(content)

