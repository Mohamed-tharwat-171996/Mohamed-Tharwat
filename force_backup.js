const { dbService } = require('./dist/server.cjs');
const state = {
  lastUpdated: Date.now(),
  activeSession: JSON.parse(dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'").value)
};
const fs = require('fs');
const mirrorPath = require('path').join(process.cwd(), 'server', 'server-local-sync-mirror_development.json');
let mirror = JSON.parse(fs.readFileSync(mirrorPath));
mirror.activeSession = state.activeSession;
fs.writeFileSync(mirrorPath, JSON.stringify(mirror, null, 2));
console.log("Wrote activeSession to mirror");
