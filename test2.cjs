const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const dbSnapshots = db.prepare('SELECT snapshot_data FROM inventory_snapshots ORDER BY date DESC LIMIT 100').all();
let pastSessions = dbSnapshots.map((row) => {
  const data = JSON.parse(row.snapshot_data);
  if (data && data.session && typeof data.session === 'object') return data.session;
  return data;
});

const activeSessRow = db.prepare("SELECT value FROM settings WHERE key = 'activeSession'").get();
if (activeSessRow) {
  const activeSession = JSON.parse(activeSessRow.value);
  pastSessions.push({
    ...activeSession,
    id: activeSession.id || "active",
    name: activeSession.name || "الجلسة الحالية (نشطة)",
    date: activeSession.date || new Date().toISOString(),
    archivedAt: new Date().toISOString(),
  });
}

// Find the item with mods
const items = pastSessions.flatMap(s => (s.items || []).map(i => ({...i, sessionName: s.name, sessionId: s.id})));
const targetItem = items.filter(i => i.itemName && i.itemName.includes('علف ذهبى') && i.storekeeperModifications && i.storekeeperModifications.length > 0);
console.log(JSON.stringify(targetItem.map(i => ({ session: i.sessionName, mods: i.storekeeperModifications })), null, 2));
