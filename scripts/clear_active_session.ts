import { SessionService } from "../server/services/sessionService";
import { FirebaseBackupService } from "../server/services/firebaseBackupService";
import { dbService } from "../server/database/dbService";

async function clear() {
  console.log("Clearing active session...");
  SessionService.clearActiveSession();
  
  const state = SessionService.getStateWithPasswords();
  state.activeSession = null;
  await FirebaseBackupService.backupStateToCloud(state, true, true);
  
  console.log("Active session cleared from SQLite and Firestore.");
}

clear().catch(console.error);
