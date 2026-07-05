const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const dbSnapshots = db.prepare('SELECT snapshot_data FROM inventory_snapshots').all();
let results = [];
dbSnapshots.forEach(row => {
  const session = JSON.parse(row.snapshot_data).session || JSON.parse(row.snapshot_data);
  const items = session.items || [];
  const item = items.find(i => i.itemName && i.itemName.includes('علف ذهبى'));
  if (item) {
    results.push({
      date: session.date,
      storekeeperQty: item.storekeeperQty,
      supervisorQty: item.supervisorQty,
      managerQty: item.managerQty,
      physicalQty: item.physicalQty
    });
  }
});
console.log(results);
