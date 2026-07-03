import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

async function run() {
  const config = {
    projectId: 'ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e',
    // We don't have the API key, but we might not need it for public reads if rules allow
  };
  try {
    const app = initializeApp(config);
    const db = getFirestore(app); // default db
    const snap = await getDocs(collection(db, 'users'));
    console.log("Users in old project:", snap.size);
  } catch (err) {
    console.error("Old project error:", err);
  }
  process.exit(0);
}
run();
