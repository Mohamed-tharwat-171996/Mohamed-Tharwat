import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  // Remove the specific database to force default
  delete config.firestoreDatabaseId;
  const app = initializeApp(config);
  const db = getFirestore(app);

  console.log("Checking default db...");
  const collectionsToCheck = ['users', 'users_development', 'users_production'];

  for (const col of collectionsToCheck) {
    try {
      const snap = await getDocs(collection(db, col));
      if (snap.size > 0) {
        console.log(`- ${col}: ${snap.size} docs`);
      }
    } catch(e) {
       console.log("Error for " + col + ": " + e.message);
    }
  }
  process.exit(0);
}
run();
