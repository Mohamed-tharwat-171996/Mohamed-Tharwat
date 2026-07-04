const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server/services/firestoreService.ts');
let content = fs.readFileSync(file, 'utf8');

// We will modify getFirestoreDoc, setFirestoreDoc, deleteFirestoreDoc, getFirestoreCollection
// to decrease timeout to 12s, and on timeout, call reinitializeFirestore and throw for the caller to retry.
// Actually, even better: we can wrap the whole operation in a retry inside the service.

// But wait, the user's issue in login was already fixed with retry.
// What about other operations?
// Let's just fix the timeout value to 8000 and explicitly call reinitializeFirestore on Timeout.
content = content.replace(/setTimeout\(\(\) => reject\(new Error\("Timeout"\)\), 35000\);/g, 'setTimeout(() => reject(new Error("Timeout")), 8000);');

content = content.replace(/if \(err && err\.message === "Timeout"\) \{\n\s*throw err;\n\s*\}/g, 
`if (err && err.message === "Timeout") {
      console.warn("⚠️ Firestore operation timed out. Reinitializing connection...");
      reinitializeFirestore();
      throw err;
    }`);

fs.writeFileSync(file, content);
console.log("Replaced timeouts.");
