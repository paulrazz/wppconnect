const fs = require('fs');

// Update db.js
let dbContent = fs.readFileSync('server/lib/db.js', 'utf8');
dbContent = dbContent.replace(
  "const dataDir = path.resolve(__dirname, '..', '..', 'whatsapp-session-data');",
  "const dataDir = path.resolve(__dirname, '..', 'data');"
);
fs.writeFileSync('server/lib/db.js', dbContent);

// Update whatsapp.service.js
let waContent = fs.readFileSync('server/services/whatsapp.service.js', 'utf8');
waContent = waContent.replace(
  "this.sessionPath = path.resolve(__dirname, '..', 'sessions', this.sessionName);",
  "this.sessionPath = path.resolve(__dirname, '..', 'data', 'sessions', this.sessionName);"
);
// Also update admin.routes.js where it deletes profiles
let adminContent = fs.readFileSync('server/routes/admin.routes.js', 'utf8');
adminContent = adminContent.replace(
  "const sessionPath = path.resolve(__dirname, '..', 'sessions', hash);",
  "const sessionPath = path.resolve(__dirname, '..', 'data', 'sessions', hash);"
);
adminContent = adminContent.replace( // there are two instances
  "const sessionPath = path.resolve(__dirname, '..', 'sessions', hash);",
  "const sessionPath = path.resolve(__dirname, '..', 'data', 'sessions', hash);"
);
fs.writeFileSync('server/routes/admin.routes.js', adminContent);

