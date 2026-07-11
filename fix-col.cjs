const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  /\{\['warehouse_supervisor', 'supervisor', 'program_manager'\]\.includes\(user\?\.role \|\| ''\) && \(/,
  `{['warehouse_supervisor', 'supervisor'].includes(user?.role || '') && (`
);
fs.writeFileSync('src/App.tsx', code);
