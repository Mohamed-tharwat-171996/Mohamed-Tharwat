const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const row = db.prepare("SELECT snapshot_data FROM inventory_snapshots WHERE date LIKE '2026-07-23%'").get();
if (row) {
  const session = JSON.parse(row.snapshot_data).session || JSON.parse(row.snapshot_data);
  const items = session.items || [];
  const targetItem = items.find(i => i.itemName && i.itemName.includes('علف ذهبى'));
  console.log("Snapshot 2026-07-23 has item:", !!targetItem);
} else {
  console.log("No snapshot for 2026-07-23");
}
