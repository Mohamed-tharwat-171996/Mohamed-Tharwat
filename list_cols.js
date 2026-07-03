import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(config);
  
  // Also try default database?
  const db1 = getFirestore(app);
  const db2 = getFirestore(app, config.firestoreDatabaseId);

  const collectionsToCheck = [
    'users', 'users_development', 'users_production', 
    'inventory_snapshots', 'app_state', 'system_config',
    'inventory_snapshots_development', 'app_state_development',
    'inventory_snapshots_production', 'app_state_production'
  ];

  console.log("--- DEFAULT DATABASE ---");
  for (const col of collectionsToCheck) {
    try {
      const snap = await getDocs(collection(db1, col));
      if (snap.size > 0) console.log(`${col}: ${snap.size}`);
    } catch(e) {}
  }
  
  console.log("--- AI STUDIO DATABASE ---");
  for (const col of collectionsToCheck) {
    try {
      const snap = await getDocs(collection(db2, col));
      if (snap.size > 0) console.log(`${col}: ${snap.size}`);
    } catch(e) {}
  }
}
run();
