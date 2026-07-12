const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Inject the helper function after pushStateToServer
const helperFn = `
  const pushPastSessionUpdate = (updatedSession: AuditSession) => {
    const updatedPastSessions = pastSessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    setPastSessions(updatedPastSessions);
    pushStateToServer({ pastSessions: [updatedSession] }, { isExplicitAction: false });
  };
`;

code = code.replace(/(const pushStateToServer = async \(payload: Partial<AppState>, options: \{ isExplicitAction\?: boolean \} = \{\}\) => \{[\s\S]*?\}\n  \};)/, `$1\n${helperFn}`);

// Fix the notes save button
code = code.replace(
  /setInspectSession\(\{ \.\.\.inspectSession, items: updatedItems \}\);/g,
  `const updatedSession = { ...inspectSession, items: updatedItems };
                        setInspectSession(updatedSession);
                        pushPastSessionUpdate(updatedSession);`
);

fs.writeFileSync('src/App.tsx', code);
