const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const row = db.prepare("SELECT snapshot_data FROM inventory_snapshots WHERE session_id = '1783189755331'").get();
const data = JSON.parse(row.snapshot_data);
const session = data.session || data;
const item = (session.items || []).find(i => i.itemName && i.itemName.includes('علف ذهبى'));
console.log("Mods 07-25:", JSON.stringify(item?.storekeeperModifications, null, 2));
