import sys, re

path = 'server/services/inbox-store.service.js'
with open(path, 'r') as f:
    content = f.read()

new_method = """  async getRecentFromMe(apiKey, limit = 20) {
    if (!limit || limit <= 0) return [];
    const rows = await DB.all(
      `SELECT message_json FROM inbox_messages 
       WHERE api_key=? AND json_extract(message_json, '$.id.fromMe') = 1 
       ORDER BY stored_at DESC LIMIT ?`, 
      [apiKey, limit]
    );
    const msgs = [];
    for (const r of rows) {
      if (!r.message_json) continue;
      try {
        const msg = JSON.parse(r.message_json);
        const text = msg.body || msg.caption;
        if (text && text.trim().length > 0) {
          msgs.push(text);
        }
      } catch(e) {}
    }
    return msgs.reverse();
  }
"""

content = content.replace("async getThreads(apiKey, limit = 50) {", new_method + "\n  async getThreads(apiKey, limit = 50) {")

with open(path, 'w') as f:
    f.write(content)

