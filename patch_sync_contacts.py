import sys

path = 'server/services/whatsapp.service.js'
with open(path, 'r') as f:
    content = f.read()

old = """      if (state === 'CONNECTED') this.setStatus(session, 'CONNECTED');
      if (['UNPAIRED', 'UNPAIRED_IDLE', 'DISCONNECTED'].includes(state)) this.setStatus(session, 'DISCONNECTED');"""

new = """      if (state === 'CONNECTED') {
        this.setStatus(session, 'CONNECTED');
        void this.syncContacts(session.apiKey);
      }
      if (['UNPAIRED', 'UNPAIRED_IDLE', 'DISCONNECTED'].includes(state)) this.setStatus(session, 'DISCONNECTED');"""

content = content.replace(old, new)

old2 = """      clearInterval(session.contactsSyncTimer);
      session.contactsSyncTimer = setInterval(() => void this.syncContacts(session.apiKey), CONTACTS_SYNC_INTERVAL_MS);
      if (session.contactsSyncTimer.unref) session.contactsSyncTimer.unref();
      void this.syncContacts(session.apiKey);"""

new2 = """      clearInterval(session.contactsSyncTimer);
      session.contactsSyncTimer = setInterval(() => void this.syncContacts(session.apiKey), CONTACTS_SYNC_INTERVAL_MS);
      if (session.contactsSyncTimer.unref) session.contactsSyncTimer.unref();
      // Delay initial sync to ensure WAPI is injected, or rely on stateChange
      setTimeout(() => void this.syncContacts(session.apiKey), 5000);"""

content = content.replace(old2, new2)

with open(path, 'w') as f:
    f.write(content)

