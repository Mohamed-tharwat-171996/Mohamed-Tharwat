const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const helperFn = `  const [pastSessions, setPastSessions] = useState<AuditSession[]>([]);

  const pushPastSessionUpdate = (updatedSession: AuditSession) => {
    const updatedPastSessions = pastSessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    setPastSessions(updatedPastSessions);
    pushStateToServer({ pastSessions: [updatedSession] }, { isExplicitAction: false });
  };
`;

code = code.replace(/const \[pastSessions, setPastSessions\] = useState<AuditSession\[\]>\(\[\]\);/, helperFn);
fs.writeFileSync('src/App.tsx', code);
