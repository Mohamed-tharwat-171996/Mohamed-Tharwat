const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const activeSessRow = db.prepare("SELECT value FROM settings WHERE key = 'activeSession'").get();
const activeSession = JSON.parse(activeSessRow.value);
const item = activeSession.items.find(i => i.itemName && i.itemName.includes('علف ذهبى'));
console.log('Active session item mods:', item.storekeeperModifications);
