const fs = require('fs');

let content = fs.readFileSync('server/lib/db.js', 'utf8');
content = content.replace(
  "db.run(`\n    PRAGMA journal_mode = WAL;\n    PRAGMA synchronous = NORMAL;\n    PRAGMA busy_timeout = 5000;\n    CREATE TABLE IF NOT EXISTS users (",
  "db.exec(`\n    PRAGMA journal_mode = WAL;\n    PRAGMA synchronous = NORMAL;\n    PRAGMA busy_timeout = 5000;\n    CREATE TABLE IF NOT EXISTS users ("
);

fs.writeFileSync('server/lib/db.js', content);
