import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  
  try {
    for (const col of ['users', 'users_development', 'users_production']) {
      const snap = await getDocs(collection(db, col));
      console.log(`Docs in ${col}: ${snap.size}`);
      snap.forEach(doc => console.log(` - ${doc.id}: ${doc.data().name}`));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
