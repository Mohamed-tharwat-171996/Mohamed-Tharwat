import { getFirestoreInstance, resolveCollectionName } from './server/services/firestoreService.ts';
import { collection, getDocs } from 'firebase/firestore';

async function run() {
  const db = getFirestoreInstance();
  if (!db) {
    console.log("No db instance");
    process.exit(1);
  }
  const collName = resolveCollectionName("users");
  console.log("Collection Name:", collName);
  
  try {
    const snap = await getDocs(collection(db, collName));
    console.log("Docs in collection:", snap.size);
    snap.forEach(doc => console.log(doc.id, doc.data().name));
  } catch (err) {
    console.error("Error fetching docs:", err);
  }
  process.exit(0);
}
run();
