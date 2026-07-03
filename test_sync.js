import { FirebaseBackupService } from './server/services/firebaseBackupService.ts';
import { getFirestoreInstance, isFirestoreConfigured } from './server/services/firestoreService.ts';

async function run() {
  console.log("Configured?", isFirestoreConfigured());
}
run();
