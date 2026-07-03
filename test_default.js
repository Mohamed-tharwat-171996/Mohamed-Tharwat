import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(config);
  const db = getFirestore(app);
  
  try {
    await getDoc(doc(db, 'users', 'test'));
    console.log('Default db exists');
  } catch (err) {
    console.error("Default db error:", err.code || err.message);
  }
  process.exit(0);
}
run();
