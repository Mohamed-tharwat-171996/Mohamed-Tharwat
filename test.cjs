const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const row = db.prepare("SELECT value FROM settings WHERE key = 'activeSession'").get();
const session = JSON.parse(row.value);
const item = session.items.find(i => i.itemName.includes('علف ذهبى'));
console.log("Mods:", JSON.stringify(item.storekeeperModifications, null, 2));
