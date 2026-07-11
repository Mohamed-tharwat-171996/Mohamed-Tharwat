const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /const newItems = \(inspectSession\.items \|\| \[\]\)\.map\(i => \{\n([\s\S]*?)\}\);\n                                              setInspectSession\(\{ \.\.\.inspectSession, items: newItems \}\);/,
  `const newItems = (inspectSession.items || []).map(i => {
$1});
                                              const updatedSession = { ...inspectSession, items: newItems };
                                              setInspectSession(updatedSession);
                                              pushPastSessionUpdate(updatedSession);`
);

fs.writeFileSync('src/App.tsx', code);
