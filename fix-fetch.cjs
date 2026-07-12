const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  /const res = await fetch\("\/api\/deleted", \{\n        headers: \{\n          "Authorization": \`Bearer \$\{token\}\`\n        \}\n      \}\);/,
  `const res = await fetch("/api/deleted", {\n        headers: {\n          "Authorization": \`Bearer \$\{token\}\`\n        },\n        cache: 'no-store'\n      });`
);
fs.writeFileSync('src/App.tsx', code);
