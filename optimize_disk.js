const fs = require('fs');

let content = fs.readFileSync('server/services/whatsapp.service.js', 'utf8');

// Add disk cache limits to Puppeteer args
content = content.replace(
  "'--disable-sync',",
  "'--disable-sync',\n            '--disk-cache-size=10485760',\n            '--media-cache-size=10485760',"
);

// Add cleanup logic to stopSession
const cleanupLogic = `
    if (client) {
      console.log(\`[Memory Manager] Forcefully terminating Chromium process for session \${this.sessionName}...\`);
      try {
        const browser = await client.page.browser();
        if (browser) browser.process().kill('SIGKILL');
      } catch (err) {}
      await client.close().catch(() => {});
      
      // Aggressive Disk Optimization for Free Tier Limits (Wipe junk caches)
      try {
        const path = require('path');
        const fs = require('fs');
        const junkFolders = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'Service Worker/CacheStorage'];
        for (const folder of junkFolders) {
          const target = path.join(this.sessionPath, 'Default', folder);
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        }
      } catch (e) {
        console.error('Disk cleanup failed:', e.message);
      }
    }
`;

content = content.replace(
  /    if \(client\) \{[\s\S]*?await client\.close\(\)\.catch\(\(\) => \{\}\);\n    \}/,
  cleanupLogic
);

fs.writeFileSync('server/services/whatsapp.service.js', content);
