import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

async function run() {
  const config = {
    projectId: "spartan-position-m5xj8",
    appId: "1:496505893272:web:1570fe6d23bbe369aa3bed",
    apiKey: "AIzaSyAqsS7qMCUrzmiR_fvOH7XoD6C_i9jbyb4"
  };
  const app = initializeApp(config);
  const db = getFirestore(app);

  const collectionsToCheck = [
    'users', 'users_development', 'users_production', 
    'inventory', 'inventory_development', 'inventory_production',
    'app_state', 'app_state_development', 'app_state_production',
    'system_config', 'system_config_development', 'system_config_production',
    'master_items', 'catalog'
  ];

  console.log("Checking collections in default db...");
  for (const col of collectionsToCheck) {
    try {
      const snap = await getDocs(collection(db, col));
      console.log(`- ${col}: ${snap.size} docs`);
    } catch(e) {}
  }
  process.exit(0);
}
run();
