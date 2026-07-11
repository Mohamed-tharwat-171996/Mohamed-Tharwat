const fs = require('fs');
let code = fs.readFileSync('recovered_sessionService.ts', 'utf8');

// The proper way to replace clearInventory:
code = code.replace(/public static clearInventory\(\) \{[\s\S]*?dbService\.run\("DELETE FROM settings WHERE key = 'activeSession'"\);\n      \}\n    \}\);\n  \}/, `public static clearInventory() {
    dbService.transaction(() => {
      dbService.run("DELETE FROM inventory");
      dbService.run("DELETE FROM inventory_snapshots");
      dbService.run("DELETE FROM deleted_sessions");
      dbService.run("DELETE FROM permanent_tombstones");
      dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
    });
  }`);

fs.writeFileSync('server/services/sessionService.ts', code);
