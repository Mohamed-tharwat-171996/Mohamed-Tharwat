const fs = require('fs');
let code = fs.readFileSync('server/services/sessionService.ts', 'utf8');

code = code.replace(
  /\/\/ 3\. Prevent non-managers from editing or deleting historical sessions\n        if \(incoming\.pastSessions \!\=\= undefined\) \{\n          delete incoming\.pastSessions;\n        \}/,
  `// 3. Prevent non-managers/supervisors from editing or deleting historical sessions
        if (actorRole !== "warehouse_supervisor" && actorRole !== "supervisor" && actorRole !== "stores_manager") {
          if (incoming.pastSessions !== undefined) {
            delete incoming.pastSessions;
          }
        }`
);

fs.writeFileSync('server/services/sessionService.ts', code);
