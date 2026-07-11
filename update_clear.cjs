const fs = require('fs');

// Fix SessionService
let sessionCode = fs.readFileSync('server/services/sessionService.ts', 'utf8');
sessionCode = sessionCode.replace(/public static clearInventory\(\) \{[\s\S]*?\}\n  \}/, `public static clearInventory() {
    dbService.transaction(() => {
      dbService.run("DELETE FROM inventory");
      dbService.run("DELETE FROM inventory_snapshots");
      dbService.run("DELETE FROM deleted_sessions");
      dbService.run("DELETE FROM permanent_tombstones");
      dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
    });
  }`);
fs.writeFileSync('server/services/sessionService.ts', sessionCode);

// Fix FirebaseBackupService
let fbCode = fs.readFileSync('server/services/firebaseBackupService.ts', 'utf8');
fbCode = fbCode.replace(/public static async clearMasterMirror\(\) \{[\s\S]*?\}\n  \}/, `public static async clearMasterMirror() {
    try {
      const db = getFirestoreDB(true);
      if (!db) {
        console.warn("⚠️ Firestore access required to clear master mirror.");
        return false;
      }
      
      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      const docRef = doc(db, collName, docName);
      
      // Wipe the main app_state doc
      await setDoc(docRef, { 
        masterItems: [], 
        activeSession: null,
        lastUpdated: Date.now(),
        updatedAtString: new Date().toISOString() 
      });
      
      // Wipe subcollections if possible
      try {
        const snapshotsColl = resolveCollectionName("inventory_snapshots");
        const deletedColl = resolveCollectionName("deleted_sessions");
        const tombstonesColl = resolveCollectionName("permanent_tombstones");
        
        const snaps = await getDocs(collection(db, snapshotsColl));
        for (const d of snaps.docs) {
          await deleteDoc(d.ref);
        }
        
        const dels = await getDocs(collection(db, deletedColl));
        for (const d of dels.docs) {
          await deleteDoc(d.ref);
        }

        const stones = await getDocs(collection(db, tombstonesColl));
        for (const d of stones.docs) {
          await deleteDoc(d.ref);
        }
      } catch (e) {
        console.warn("⚠️ Cloud collection destructive prune partial failure:", e);
      }

      const mirrorPath = this.getMirrorPath();
      if (fs.existsSync(mirrorPath)) {
        try {
          fs.unlinkSync(mirrorPath);
        } catch(e) {}
      }
      return true;
    } catch (err: any) {
      console.error("🔥 Error clearing master database in FirebaseBackupService:", err);
      return false;
    }
  }`);
fs.writeFileSync('server/services/firebaseBackupService.ts', fbCode);

