const fs = require('fs');
let content = fs.readFileSync('client/src/pages/Dashboard.jsx', 'utf8');

content = content.replace(
  "} catch (e) { console.error(e); }",
  "} catch (e) {\n      console.error(e);\n      setSessionStatus('DISCONNECTED');\n    }"
);

fs.writeFileSync('client/src/pages/Dashboard.jsx', content);
