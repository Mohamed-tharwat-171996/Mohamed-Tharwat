import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  
  try {
    const snap = await getDoc(doc(db, 'app_state_development', 'master'));
    if (snap.exists()) {
      const data = snap.data();
      console.log('registeredUsers:', data.registeredUsers?.length || 0);
      console.log('precodedUsers:', data.precodedUsers?.length || 0);
      data.registeredUsers?.forEach(u => console.log(' - ' + u.code + ' ' + u.name));
    } else {
      console.log('No master doc in app_state_development');
    }
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();
