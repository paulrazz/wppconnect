const DB = require('../lib/db');

// Durable, per-tenant contact list. Stored in the same SQLite database that
// already holds users/inbox so it inherits the persistent volume: after the
// first successful sync a tenant's contacts survive restarts, redeploys and
// even disconnected WhatsApp sessions. The /contacts endpoint never has to
// start (or wait on) a browser to answer — it reads here first.
//
// Schema (keyed by api_key):
//   contacts_store - contacts_json + groups_json (sorted JSON arrays),
//                    totals + synced_at (when the browser last supplied data).

class ContactsStore {
  constructor() {
    this.readyPromise = this.ensureSchema().catch(error => {
      console.error('Contacts schema init failed:', error.message);
    });
  }

  async ensureSchema() {
    await DB.run(`CREATE TABLE IF NOT EXISTS contacts_store (
      api_key TEXT PRIMARY KEY,
      contacts_json TEXT NOT NULL DEFAULT '[]',
      groups_json TEXT NOT NULL DEFAULT '[]',
      total_contacts INTEGER NOT NULL DEFAULT 0,
      total_groups INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
  }

  async load(apiKey) {
    await this.readyPromise;
    const row = await DB.get('SELECT * FROM contacts_store WHERE api_key=?', [apiKey]);
    if (!row) return null;
    let contacts, groups;
    try { contacts = JSON.parse(row.contacts_json || '[]'); } catch (_) { contacts = []; }
    try { groups = JSON.parse(row.groups_json || '[]'); } catch (_) { groups = []; }
    return {
      contacts,
      groups,
      totalContacts: row.total_contacts || contacts.length,
      totalGroups: row.total_groups || groups.length,
      syncedAt: row.synced_at || 0,
    };
  }

  async save(apiKey, contacts, groups, syncedAt = Date.now()) {
    await this.readyPromise;
    await DB.run(`INSERT INTO contacts_store
      (api_key, contacts_json, groups_json, total_contacts, total_groups, synced_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(api_key) DO UPDATE SET
        contacts_json=excluded.contacts_json, groups_json=excluded.groups_json,
        total_contacts=excluded.total_contacts, total_groups=excluded.total_groups,
        synced_at=excluded.synced_at, updated_at=excluded.updated_at`,
      [apiKey, JSON.stringify(contacts), JSON.stringify(groups), contacts.length, groups.length, syncedAt, Date.now()]);
  }
}

module.exports = new ContactsStore();
