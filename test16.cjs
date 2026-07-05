const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const activeSessRow = db.prepare("SELECT value FROM settings WHERE key = 'activeSession'").get();
if (activeSessRow) {
  const activeSession = JSON.parse(activeSessRow.value);
  const item = activeSession.items.find(i => i.itemName && i.itemName.includes('علف ذهبى'));
  if (item) {
    console.log("Active Item storekeeperModifications:", item.storekeeperModifications);
  } else {
    console.log("Item not found in active session");
  }
}
