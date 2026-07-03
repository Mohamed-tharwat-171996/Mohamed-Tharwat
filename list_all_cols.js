import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);

  // We can't list collections directly, but we can try common names
  const collectionsToCheck = [
    'users', 'users_development', 'users_production', 
    'inventory', 'inventory_development', 'inventory_production',
    'app_state', 'app_state_development', 'app_state_production',
    'system_config', 'system_config_development', 'system_config_production',
    'master_items', 'catalog'
  ];

  console.log("Checking collections...");
  for (const col of collectionsToCheck) {
    try {
      const snap = await getDocs(collection(db, col));
      if (snap.size > 0) {
        console.log(`- ${col}: ${snap.size} docs`);
      }
    } catch(e) {}
  }
  process.exit(0);
}
run();
