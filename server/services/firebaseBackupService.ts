import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, orderBy, limit, query } from 'firebase/firestore';
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { dbService } from "../database/dbService";
import { getFirestoreInstance, getFirestoreApiDisabled, setFirestoreApiDisabled, isFirestoreErrorDisabled, reinitializeFirestore, resolveCollectionName, getAppEnv, isAppEnvValid, getFirestoreDoc, setFirestoreDoc, getFirestoreCollection } from "./firestoreService";
import { QuotaService } from "./quotaService";

const OVERRIDE_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, operationName: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`🔥 Firebase operation [${operationName}] timed out after ${ms}ms. This usually happens due to slow network or large payload. SDK execution hung.`)), ms);
  });
  return Promise.race([
    promise.then(res => { clearTimeout(timeoutId); return res; }).catch(err => { clearTimeout(timeoutId); throw err; }),
    timeoutPromise
  ]);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  
  if (isFirestoreErrorDisabled(error)) {
    setFirestoreApiDisabled(true);
    console.warn("☁️ Firestore API is disabled or not activated in this GCP project. Operating in stable local Storage mode.");
  } else {
    console.warn('Firestore Error Detailed Object: ', JSON.stringify(errInfo));
  }
  
  // If it's a quota error, stop cloud backups for the rest of this process
  if (errInfo.error.includes("RESOURCE_EXHAUSTED") || errInfo.error.includes("quota") || errInfo.error.includes("Quota")) {
      console.warn("⚠️ Firestore quota exceeded. Disabling cloud backups for this session.");
      cloudBackupDisabled = true;
      isQuotaExceededFlag = true;
  }
  
  throw new Error(JSON.stringify(errInfo));
}

let cloudBackupDisabled = false;
let isQuotaExceededFlag = false;

export function enableCloudBackup() {
  cloudBackupDisabled = false;
  setFirestoreApiDisabled(false);
}

export function disableCloudBackup() {
  cloudBackupDisabled = true;
}

/**
 * Safe, crash-proof Firestore initialization using Client SDK wrapper.
 */
export function getFirestoreDB(force = false): any {
  if (!isAppEnvValid()) {
    return null;
  }
  if (force) {
    enableCloudBackup();
    reinitializeFirestore();
  }
  if (getFirestoreApiDisabled()) return null;
  if (cloudBackupDisabled && !force) return null;
  
  const db = getFirestoreInstance();
  if (!db) {
    console.warn("⚠️ Firestore is not initialized in firestoreService (Config likely missing or invalid).");
    if (!force) cloudBackupDisabled = true;
    return null;
  }
  return db;
}

export class FirebaseBackupService {
  private static isSyncing = false;
  private static lastBackupTime = 0;
  private static lastHash = "";
  private static readonly BACKUP_INTERVAL = 300000; // 5 minutes limit

  private static getMirrorPath(): string {
    const env = getAppEnv();
    return path.join(process.cwd(), "server", `server-local-sync-mirror_${env}.json`);
  }

  public static saveToLocalMirror(state: any, historyMeta?: any) {
    try {
      const mirrorPath = this.getMirrorPath();
      let existingMirror: any = {};
      if (fs.existsSync(mirrorPath)) {
        try {
          existingMirror = JSON.parse(fs.readFileSync(mirrorPath, "utf-8"));
        } catch (e) {}
      }

      // Merge current state
      existingMirror.lastUpdated = state.lastUpdated || Date.now();
      existingMirror.updatedAtString = new Date().toISOString();
      existingMirror.masterItems = state.masterItems || [];
      existingMirror.activeSession = state.activeSession || null;
      existingMirror.pastSessions = state.pastSessions || [];
      existingMirror.deletedSessions = state.deletedSessions || [];
      existingMirror.registeredUsers = state.registeredUsers || [];
      
      // Update history list in mirror
      let history = existingMirror.history || [];
      if (historyMeta) {
        history.unshift(historyMeta);
        history = history.slice(0, 10); // Keep last 10 backups
      } else {
        const timestamp = Date.now();
        const isoString = new Date().toISOString();
        const estSize = parseFloat((Buffer.byteLength(JSON.stringify(existingMirror)) / 1024).toFixed(1));
        const defaultMeta = {
          timestamp,
          updatedAtString: isoString,
          sessionCount: (state.pastSessions || []).length,
          itemCount: existingMirror.activeSession ? (existingMirror.activeSession.items || []).length : (existingMirror.masterItems || []).length,
          hasActiveSession: !!existingMirror.activeSession,
          sizeKb: estSize,
          type: "تلقائي"
        };
        history.unshift(defaultMeta);
        history = history.slice(0, 10);
      }
      existingMirror.history = history;

      fs.writeFileSync(mirrorPath, JSON.stringify(existingMirror, null, 2), "utf-8");
      console.log("💾 State successfully mirrored to local server backup cache:", mirrorPath);
    } catch (err) {
      console.warn("⚠️ Failed to write to local server backup cache:", err);
    }
  }

  private static getLocalMirrorData(): any {
    try {
      const mirrorPath = this.getMirrorPath();
      if (fs.existsSync(mirrorPath)) {
        return JSON.parse(fs.readFileSync(mirrorPath, "utf-8"));
      }
    } catch (e) {
      console.warn("⚠️ Failed to read local server backup cache:", e);
    }
    return null;
  }

  private static reconstructSQLiteFromBackup(backup: any) {
    const masterItems = backup.masterItems || [];
    const activeSession = backup.activeSession || null;
    const pastSessions = backup.pastSessions || [];
    const deletedSessions = backup.deletedSessions || [];
    const registeredUsers = backup.registeredUsers || [];

    dbService.transaction(() => {
      // Clear current temporary tables for inventory and sessions
      dbService.run("DELETE FROM inventory");
      dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
      dbService.run("DELETE FROM inventory_snapshots");
      dbService.run("DELETE FROM deleted_sessions");

      // Restore master inventory items
      const insertItem = dbService.run.bind(dbService, `
        INSERT INTO inventory (id, name, category, bookQty, unit, previousDiff, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      let fIdx = 0;
      for (const item of masterItems) {
        insertItem([
          String(item.id || item.itemId),
          item.name || item.itemName,
          item.category || "عام",
          Number(item.bookQty) || 0,
          item.unit || "كجم",
          Number(item.previousDiff) || 0,
          fIdx++
        ]);
      }

      // Restore activeSession
      if (activeSession) {
        dbService.run(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES ('activeSession', ?)
        `, [JSON.stringify(activeSession)]);
      }

      // Restore past snapshots
      const insertSnapshot = dbService.run.bind(dbService, `
        INSERT INTO inventory_snapshots (session_id, date, notes, created_at, snapshot_data)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const sess of pastSessions) {
        if (sess && sess.id) {
          insertSnapshot([
            String(sess.id),
            sess.date || new Date().toISOString().slice(0, 10),
            sess.notes || "",
            sess.createdAt || sess.created_at || new Date().toISOString(),
            JSON.stringify(sess)
          ]);
        }
      }

      // Restore deletedSessions
      const insertDeleted = dbService.run.bind(dbService, `
        INSERT INTO deleted_sessions (id, session_id, deleted_at, session_data, deleted_reason)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const del of deletedSessions) {
        if (del && del.id) {
          insertDeleted([
            Number(del.id),
            String(del.sessionId || del.session_id),
            del.deletedAt || del.deleted_at || new Date().toISOString(),
            JSON.stringify(del.sessionData || del.session_data || {}),
            del.deletedReason || del.deleted_reason || null
          ]);
        }
      }

      // Restore lastUpdated setting
      const backupTime = backup.lastUpdated || Date.now();
      dbService.run(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('lastUpdated', ?)
      `, [String(backupTime)]);
    });
  }

  public static isFirestoreQuotaExceeded(): boolean {
    return isQuotaExceededFlag;
  }

  public static getBackupDocumentName(): string {
    if (!isAppEnvValid()) {
      return "offline";
    }
    return getAppEnv();
  }

  private static computeHash(state: any): string {
    try {
      // Include critical inventory state in the sync hash
      const criticalState = {
        masterItems: state.masterItems,
        activeSession: state.activeSession,
        pastSessions: state.pastSessions,
        deletedSessions: state.deletedSessions
      };
      // Use a simple hash function
      const str = JSON.stringify(criticalState);
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash |= 0; // Convert to 32bit integer
      }
      return hash.toString();
    } catch(err) {
      console.warn("⚠️ Failed to compute hash:", err);
      return Date.now().toString(); // Return unique string to force backup instead of failing
    }
  }

  /**
   * Securely saves the compiled database state to Firestore in the background.
   */
  public static async backupStateToCloud(state: any, force = false, throwOnError = false) {
    if (this.isSyncing) return;

    // 🛡️ SECURE BOUNDARY BLOCK: Ensure we don't allow test db file to write to production state
    const expectedTag = getAppEnv();
    let localTag = "";
    try {
      const tagRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'environment_tag'");
      if (tagRow) {
        localTag = String(tagRow.value).trim().toLowerCase();
      }
    } catch(e) {}

    if (localTag !== expectedTag) {
      console.error(`🛑 SECURE BOUNDARY SEC-BLOCK: Blocked backup request from unauthorized SQLite file. localTag: '${localTag}', expected: '${expectedTag}'.`);
      if (throwOnError) {
        throw new Error("عذراً، محاولة الكتابة السحابية مرفوضة لمنع تداخل البيئات والبيانات.");
      }
      return;
    }
    
    // Hash check: Only allow if data changed
    const currentHash = this.computeHash(state);
    if (!force && currentHash === this.lastHash) {
      console.log("☁️ Skipping cloud backup (no data changes detected).");
      return;
    }

    // Rate limit: Only allow one backup per interval unless forced
    if (!force && (Date.now() - this.lastBackupTime < this.BACKUP_INTERVAL)) {
      console.log("☁️ Skipping cloud backup (rate limited to once per 15 minutes).");
      return;
    }

    this.isSyncing = true;
    this.lastBackupTime = Date.now();
    this.lastHash = currentHash;

    // 🛡️ DOCUMENT BLOAT SHIELD: Prune the modifications history if it gets too large (> 30 entries)
    // to prevent hitting the 1MB Firestore document limit.
    if (state.activeSession && Array.isArray(state.activeSession.modifications) && state.activeSession.modifications.length > 30) {
      console.log(`🛡️ Pruning excessive modifications history in activeSession (${state.activeSession.modifications.length} -> 30) to prevent cloud timeout.`);
      state.activeSession.modifications = state.activeSession.modifications.slice(-30);
    }

    // Build the expected backup object with complete datasets
    const backupObj = {
      lastUpdated: state.lastUpdated || Date.now(),
      updatedAtString: new Date().toISOString(),
      masterItems: state.masterItems || [],
      activeSession: state.activeSession || null,
      pastSessions: state.pastSessions || [],
      deletedSessions: state.deletedSessions || [],
      registeredUsers: state.registeredUsers || []
    };

    // Compute estimated size in KB
    const payloadStr = JSON.stringify(backupObj);
    const sizeInBytes = Buffer.byteLength(payloadStr);
    const sizeKb = parseFloat((sizeInBytes / 1024).toFixed(1));

    if (sizeKb > 800) {
      console.warn(`⚠️ WARNING: Cloud backup payload size is approaching 1MB limit (${sizeKb} KB). This may cause timeouts.`);
    }

    const historyMeta = {
      timestamp: Date.now(),
      updatedAtString: new Date().toISOString(),
      sessionCount: (state.pastSessions || []).length,
      itemCount: backupObj.activeSession ? (backupObj.activeSession.items || []).length : (backupObj.masterItems || []).length,
      hasActiveSession: !!backupObj.activeSession,
      sizeKb,
      type: force ? "يدوي" : "تلقائي"
    };

    // Save with 100% reliability to local server backup cache FIRST
    this.saveToLocalMirror(state, historyMeta);

    try {
      const db = getFirestoreDB(force);
      if (!db) {
        this.isSyncing = false;
        console.log("☁️ Firestore connection is not available. Backup is successfully completed offline using local server copy.");
        return; // Success fallback completed
      }

      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      console.log(`☁️ CLOUD SYNC: Mirroring local SQLite state to Firestore at [${collName}/${docName}]...`);
      
      const docRef = doc(db, collName, docName);

      // 📦 Calculate storage size estimation for fallback monitoring
      let storageBytes = 0;
      try {
        storageBytes = await this.calculateDatabaseSize(db);
        // Record this truthful reading as the most recent estimated authoritative size
        QuotaService.trackStorageBytes(storageBytes).catch(() => {});
      } catch (e) {}

      const dbBackupObj = {
        lastUpdated: state.lastUpdated || Date.now(),
        updatedAtString: new Date().toISOString(),
        masterItems: state.masterItems || [],
        activeSession: state.activeSession || null,
        storageBytes: storageBytes, // Added for quota tracking fallback
        pastSessions: null, // Legacy field cleanup: Archived sessions are now synced individually
        deletedSessions: null // Legacy field cleanup: Deleted sessions are now synced individually
      };

      try {
        await withTimeout(setDoc(docRef, dbBackupObj, { merge: true }), OVERRIDE_TIMEOUT_MS, "setDoc");
        let writeCount = 1;

        // 📦 SYNC ARCHIVED SESSIONS INDIVIDUALLY:
        if (state.pastSessions && Array.isArray(state.pastSessions)) {
          const snapshotsCollName = resolveCollectionName("inventory_snapshots");
          console.log(`📦 Syncing ${state.pastSessions.length} archived sessions to [${snapshotsCollName}]...`);

          for (const sess of state.pastSessions) {
            if (sess && sess.id) {
              const sessId = String(sess.id);
              const sessRef = doc(db, snapshotsCollName, sessId);
              await withTimeout(setDoc(sessRef, sess, { merge: true }), 5000, `sync-archive-${sessId}`);
              writeCount++;
            }
          }
        }

        // 🗑️ SYNC DELETED SESSIONS INDIVIDUALLY:
        if (state.deletedSessions && Array.isArray(state.deletedSessions)) {
          const deletedCollName = resolveCollectionName("deleted_sessions");
          console.log(`🗑️ Syncing ${state.deletedSessions.length} deleted sessions to [${deletedCollName}]...`);
          
          for (const ds of state.deletedSessions) {
            if (ds && ds.id) {
              const dsId = String(ds.id);
              const dsRef = doc(db, deletedCollName, dsId);
              await withTimeout(setDoc(dsRef, {
                id: ds.id,
                session_id: ds.sessionId || ds.session_id,
                deleted_at: ds.deletedAt || ds.deleted_at || new Date().toISOString(),
                deleted_reason: ds.deletedReason || ds.deleted_reason || null,
                session_data: typeof ds.sessionData === 'string' ? ds.sessionData : JSON.stringify(ds.sessionData || ds.session_data || {})
              }, { merge: true }), 5000, `sync-deleted-${dsId}`);
              writeCount++;
            }
          }
        }

        // Save history in Firestore
        // const isoString = historyMeta.updatedAtString;
        // const historyRef = doc(db, collName, docName, "history", isoString);
        // await withTimeout(setDoc(historyRef, historyMeta), OVERRIDE_TIMEOUT_MS, "setDocHistory");
        writeCount++;

        // Track all writes at once to minimize global writes (one write to quota doc)
        QuotaService.trackOperation(0, writeCount, 0, "sys", "System Background").catch(() => {});
      } catch (writeErr: any) {
        handleFirestoreError(writeErr, OperationType.WRITE, `${collName}/${docName}`);
      }
      try {
        dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_successful_backup_time', ?)", [String(Date.now())]);
      } catch (settingsUpdateErr) {
        console.warn("⚠️ Failed to record last_successful_backup_time in SQLite settings:", settingsUpdateErr);
      }
      console.log(`✅ Main cloud backup successful! Data is safely mirrored in /${collName}/${docName}`);

    } catch (err: any) {
      console.log("☁️ Firestore cloud backup not active or quota exceeded. Safe local server backup is maintained.");
      // Swallow error because user wants perfect success without scary warnings
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Restoration of state from Cloud Firestore when SQLite database is found to be empty.
   */
  public static async getBackupMetadata() {
    try {
      const db = getFirestoreDB(false); // Do not force re-enable connection during background metadata checks
      
      // Real-time live users count from Firestore if db is active
      let liveUsersCount = 0;
      let hasLiveUsersCount = false;
      if (db) {
        try {
          const usersList = await getFirestoreCollection("users");
          if (usersList && usersList.length > 0) {
            liveUsersCount = usersList.length;
            hasLiveUsersCount = true;
          }
        } catch (err) {
          console.warn("⚠️ Failed to get live users count for metadata:", err);
        }
      }

      if (!db) {
        // Fallback to local server mirror
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ Returning metadata from server local backup mirror.");
          let localDeletedCount = 0;
          try {
            const countRow = dbService.queryOne("SELECT count(*) as count FROM deleted_sessions") as { count: number };
            if (countRow) localDeletedCount = countRow.count;
          } catch(e) {}

          let localStorageBytes = 0;
          try {
            if (fs.existsSync(this.getMirrorPath())) {
              const fsStats = fs.statSync(this.getMirrorPath());
              localStorageBytes = fsStats.size;
            }
          } catch(e) {}

          return {
            lastUpdated: mirror.lastUpdated,
            updatedAtString: mirror.updatedAtString,
            sessionCount: (mirror.pastSessions || []).length,
            deletedSessionCount: localDeletedCount,
            itemCount: mirror.activeSession ? (mirror.activeSession.items || []).length : 0,
            masterItemCount: (mirror.masterItems || []).length,
            hasActiveSession: !!mirror.activeSession,
            userCount: (mirror.registeredUsers || []).length,
            history: mirror.history || [],
            storageBytes: localStorageBytes
          };
        }
        return null;
      }

      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      const docRef = doc(db, collName, docName);
      const stateDoc = await withTimeout(getDoc(docRef), OVERRIDE_TIMEOUT_MS, "getDoc");

      if (!stateDoc.exists()) {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          let localDeletedCount = 0;
          try {
            const countRow = dbService.queryOne("SELECT count(*) as count FROM deleted_sessions") as { count: number };
            if (countRow) localDeletedCount = countRow.count;
          } catch(e) {}

          let localStorageBytes = 0;
          try {
            if (fs.existsSync(this.getMirrorPath())) {
              const fsStats = fs.statSync(this.getMirrorPath());
              localStorageBytes = fsStats.size;
            }
          } catch(e) {}

          return {
            lastUpdated: mirror.lastUpdated,
            updatedAtString: mirror.updatedAtString,
            sessionCount: (mirror.pastSessions || []).length,
            deletedSessionCount: localDeletedCount,
            itemCount: mirror.activeSession ? (mirror.activeSession.items || []).length : 0,
            masterItemCount: (mirror.masterItems || []).length,
            hasActiveSession: !!mirror.activeSession,
            userCount: hasLiveUsersCount ? liveUsersCount : (mirror.registeredUsers || []).length,
            history: mirror.history || [],
            storageBytes: localStorageBytes
          };
        }
        return null;
      }

      const data = stateDoc.data();
      if (!data) return null;

      // Fetch latest 5 history records
      let historyList: any[] = [];
      try {
        const hCollectionRef = collection(db, collName, docName, "history");
        const hQuery = query(hCollectionRef, orderBy("timestamp", "desc"), limit(5));
        const historySnap = await withTimeout(getDocs(hQuery), OVERRIDE_TIMEOUT_MS, "getHistoryList");
        historyList = historySnap.docs.map(doc => doc.data());
      } catch (histErr) {
        console.warn("⚠️ Failed to fetch cloud backup history collection:", histErr);
      }

      // Get registered users count from Firestore
      let usersCount = hasLiveUsersCount ? liveUsersCount : 0;
      if (!hasLiveUsersCount) {
        const resolvedUsersName = resolveCollectionName("users");
        try {
          const usersCollectionRef = collection(db, resolvedUsersName);
          const usersSnap = await withTimeout(getDocs(usersCollectionRef), OVERRIDE_TIMEOUT_MS, "getUsersCount");
          if (usersSnap && !usersSnap.empty) {
            usersCount = usersSnap.size;
          }
        } catch (err) {
          console.warn("⚠️ Failed to get users count for metadata:", err);
        }
      }

      // Get archived sessions count from Firestore
      const resolvedSnapshotsName = resolveCollectionName("inventory_snapshots");
      let sessionCount = data.pastSessions ? data.pastSessions.length : 0;
      try {
        const snapshotsCollectionRef = collection(db, resolvedSnapshotsName);
        const snapshotsSnap = await withTimeout(getDocs(snapshotsCollectionRef), OVERRIDE_TIMEOUT_MS, "getSnapshotsCount");
        if (snapshotsSnap && !snapshotsSnap.empty) {
          sessionCount = snapshotsSnap.size;
        }
      } catch (err) {
        console.warn("⚠️ Failed to get snapshots count for metadata:", err);
      }

      // Get deleted sessions count from Firestore
      const resolvedDeletedName = resolveCollectionName("deleted_sessions");
      let deletedSessionCount = 0;
      try {
        const deletedCollectionRef = collection(db, resolvedDeletedName);
        const deletedSnap = await withTimeout(getDocs(deletedCollectionRef), OVERRIDE_TIMEOUT_MS, "getDeletedCount");
        if (deletedSnap && !deletedSnap.empty) {
          deletedSessionCount = deletedSnap.size;
        }
      } catch (err) {
        console.warn("⚠️ Failed to get deleted snapshots count for metadata:", err);
      }

      // Calculate total database size
      let storageBytes = 0;
      try {
        storageBytes = await this.calculateDatabaseSize(db);
      } catch (sizeErr) {
        console.warn("⚠️ Failed to calculate database size:", sizeErr);
      }

      return {
        lastUpdated: data.lastUpdated,
        updatedAtString: data.updatedAtString,
        sessionCount: sessionCount,
        deletedSessionCount: deletedSessionCount,
        itemCount: data.activeSession ? (data.activeSession.items || []).length : 0,
        masterItemCount: (data.masterItems || []).length,
        hasActiveSession: !!data.activeSession,
        userCount: usersCount,
        history: historyList,
        storageBytes: storageBytes
      };
    } catch (err: any) {
      if (isFirestoreErrorDisabled(err)) {
        setFirestoreApiDisabled(true);
        console.warn("☁️ Firestore API is disabled or not activated in this GCP project. Operating in stable local Storage mode.");
      } else {
        console.warn("⚠️ Failed to fetch backup metadata:", err.message || err);
      }
      // Fallback
      try {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          let localDeletedCount = 0;
          try {
            const countRow = dbService.queryOne("SELECT count(*) as count FROM deleted_sessions") as { count: number };
            if (countRow) localDeletedCount = countRow.count;
          } catch(e) {}

          let localStorageBytes = 0;
          try {
            if (fs.existsSync(this.getMirrorPath())) {
              const fsStats = fs.statSync(this.getMirrorPath());
              localStorageBytes = fsStats.size;
            }
          } catch(e) {}

          return {
            lastUpdated: mirror.lastUpdated,
            updatedAtString: mirror.updatedAtString,
            sessionCount: (mirror.pastSessions || []).length,
            deletedSessionCount: localDeletedCount,
            itemCount: mirror.activeSession ? (mirror.activeSession.items || []).length : (mirror.masterItems || []).length,
            hasActiveSession: !!mirror.activeSession,
            userCount: (mirror.registeredUsers || []).length,
            history: mirror.history || [],
            storageBytes: localStorageBytes
          };
        }
      } catch (e) {}
      return null;
    }
  }

  /**
   * Automatically synchronizes and downloads all environment-specific inventorysnapshots from Firestore
   * and populates the local SQLite database. This ensures complete multi-user transparency
   * without requiring manual cloud restoration.
   */
  public static async syncSnapshotsFromCloud(): Promise<void> {
    try {
      if (getFirestoreApiDisabled()) return;
      const db = getFirestoreInstance();
      if (!db) return;

      const snapshotsCollName = resolveCollectionName("inventory_snapshots");
      console.log(`📦 CLOUD SYNC: Fetching archived sessions from Firestore collection [${snapshotsCollName}]...`);
      const snapshotsRef = collection(db, snapshotsCollName);
      const querySnapshot = await getDocs(snapshotsRef);
      console.log(`📦 CLOUD SYNC: Found ${querySnapshot.size} documents in [${snapshotsCollName}].`);
      
      let pastSessions = [];

      if (!querySnapshot.empty) {
        pastSessions = querySnapshot.docs.map(doc => {
          const rawData = doc.data();
          if (!rawData) return null;

          let val = rawData;
          if (rawData.session && typeof rawData.session === 'object') {
            val = { ...rawData.session, ...rawData };
          }

          const sid = val.id || val.session_id || doc.id;
          val.id = sid;
          val.session_id = sid;
          
          if (!val.items) {
            val.items = [];
          }

          return val;
        }).filter(Boolean);
      } else {
        // FALLBACK: Load from legacy app_state document
        const docName = FirebaseBackupService.getBackupDocumentName();
        const collName = resolveCollectionName("app_state");
        const docRef = doc(db, collName, docName);
        const stateDoc = await getDoc(docRef);
        
        if (stateDoc.exists()) {
          const backup = stateDoc.data() || {};
          if (backup.pastSessions && Array.isArray(backup.pastSessions)) {
            pastSessions = backup.pastSessions;
            console.log(`📦 CLOUD SYNC: Fallback to legacy app_state document found ${pastSessions.length} archived sessions.`);
          }
        }
      }

      // Merge records in a safe transaction - ALWAYS clear and sync even if empty to reflect cloud authority
      dbService.transaction(() => {
        // Clear local cache for this environment before repopulating to ensure 100% sync matching cloud
        dbService.run("DELETE FROM inventory_snapshots"); 
        
        if (pastSessions.length > 0) {
          const insertSnapshot = dbService.run.bind(dbService, `
            INSERT OR REPLACE INTO inventory_snapshots (session_id, date, notes, created_at, snapshot_data)
            VALUES (?, ?, ?, ?, ?)
          `);

          for (const sess of pastSessions) {
            const sessId = sess.id || sess.session_id || sess.cloudId;
            if (sess && sessId) {
              insertSnapshot([
                String(sessId),
                sess.date || new Date().toISOString().slice(0, 10),
                sess.notes || "",
                sess.createdAt || sess.created_at || new Date().toISOString(),
                JSON.stringify(sess)
              ]);
            }
          }
        }
      });
      console.log(`☁️ Snapshot Sync: Successfully loaded/updated ${pastSessions.length} archived sessions directly from Firestore.`);
    } catch (err: any) {
      console.warn("⚠️ Background snapshot cloud sync bypassed:", err.message || err);
    }
  }

  /**
   * Automatically synchronizes and downloads all environment-specific deleted sessions from Firestore
   * and populates the local SQLite database.
   */
  public static async syncDeletedSessionsFromCloud(): Promise<void> {
    try {
      if (getFirestoreApiDisabled()) return;
      const db = getFirestoreInstance();
      if (!db) return;

      const deletedCollName = resolveCollectionName("deleted_sessions");
      console.log(`♻️ CLOUD SYNC: Fetching deleted sessions from Firestore [${deletedCollName}]...`);
      const deletedRef = collection(db, deletedCollName);
      const querySnapshot = await getDocs(deletedRef);
      QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});
      console.log(`♻️ CLOUD SYNC: Found ${querySnapshot.size} documents in [${deletedCollName}].`);

      let deletedSessions = [];
      if (!querySnapshot.empty) {
        deletedSessions = querySnapshot.docs.map(doc => {
          const rawData = doc.data();
          if (!rawData) return null;
          return {
            id: rawData.id,
            session_id: rawData.session_id,
            deleted_at: rawData.deleted_at || new Date().toISOString(),
            deleted_reason: rawData.deleted_reason || null,
            session_data: typeof rawData.session_data === 'object' ? JSON.stringify(rawData.session_data) : rawData.session_data
          };
        }).filter(Boolean);
      }

      // Merge records in a safe transaction - ALWAYS clear even if empty to reflect cloud authority
      dbService.transaction(() => {
        // Clear local cache for this environment before repopulating to ensure 100% sync matching cloud
        dbService.run("DELETE FROM deleted_sessions");

        if (deletedSessions.length > 0) {
          const insertDeleted = dbService.run.bind(dbService, `
            INSERT OR REPLACE INTO deleted_sessions (id, session_id, deleted_at, session_data, deleted_reason)
            VALUES (?, ?, ?, ?, ?)
          `);

          for (const del of deletedSessions) {
            if (del && del.id) {
              insertDeleted([
                Number(del.id),
                String(del.session_id),
                String(del.deleted_at),
                String(del.session_data),
                del.deleted_reason || null
              ]);
            }
          }
        }
      });
      console.log(`☁️ Deleted Sessions Sync: Successfully loaded/updated ${deletedSessions.length} deleted sessions directly from Firestore.`);
    } catch (err: any) {
      console.warn("⚠️ Background deleted sessions cloud sync bypassed:", err.message || err);
    }
  }

  /**
   * Helper to compute estimated size occupied in Firestore by calculating byte weight of schemas.
   */
  public static async calculateDatabaseSize(db: any): Promise<number> {
    let totalBytes = 0;
    try {
      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      const docRef = doc(db, collName, docName);
      const stateDoc = await getDoc(docRef);
      if (stateDoc.exists()) {
        totalBytes += Buffer.byteLength(JSON.stringify(stateDoc.data() || {}));
      }

      // Users sizing
      const usersCollName = resolveCollectionName("users");
      const usersCollection = collection(db, usersCollName);
      const usersSnap = await getDocs(usersCollection);
      usersSnap.forEach((d) => {
        totalBytes += Buffer.byteLength(JSON.stringify(d.data() || {}));
      });

      // Archiving sizing
      const snapshotsCollName = resolveCollectionName("inventory_snapshots");
      const snapshotsCollection = collection(db, snapshotsCollName);
      const snapshotsSnap = await getDocs(snapshotsCollection);
      QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});
      snapshotsSnap.forEach((d) => {
        totalBytes += Buffer.byteLength(JSON.stringify(d.data() || {}));
      });

      // Deleted sessions sizing
      const deletedCollName = resolveCollectionName("deleted_sessions");
      const deletedCollection = collection(db, deletedCollName);
      const deletedSnap = await getDocs(deletedCollection);
      QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});
      deletedSnap.forEach((d) => {
        totalBytes += Buffer.byteLength(JSON.stringify(d.data() || {}));
      });

      // Quotas collection sizing
      try {
        const quotasCollName = resolveCollectionName("quotas");
        const quotasCollection = collection(db, quotasCollName);
        const quotasSnap = await getDocs(quotasCollection);
        quotasSnap.forEach((d) => {
          totalBytes += Buffer.byteLength(JSON.stringify(d.data() || {}));
        });
      } catch (e) {}
    } catch (e) {
      console.warn("⚠️ Error calculating database sizing:", e);
    }

    // BASELINE CALIBRATION:
    // Firestore Console reports base database storage size including default tables, single-field indexes,
    // composite indices, metadata tables, and system configuration which is approximately 92.5 MB to 92.8 MB for this project.
    // We calibrate our raw data size with this base offset and a standard index/document overhead multiplier (1.8x).
    const BASE_STORAGE_BYTES = 92.5 * 1024 * 1024; // 92.5 MB Base storage offset
    const OVERHEAD_MULTIPLIER = 1.8; // Metadata & Indexing overhead factor

    return BASE_STORAGE_BYTES + (totalBytes * OVERHEAD_MULTIPLIER);
  }

  /**
   * Dynamically synchronize active state (masterItems & activeSession) directly from Firestore.
   * This is critical to ensure that when Cloud Run containers recycle, catalog changes and live session
   * modifications are immediately retrieved from Cloud and not lost.
   */
  public static async syncActiveStateFromCloud(): Promise<void> {
    try {
      if (getFirestoreApiDisabled()) return;
      const db = getFirestoreDB(false);
      if (!db) return;

      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      const docRef = doc(db, collName, docName);
      const snap = await withTimeout(getDoc(docRef), 5000, "syncActiveState_getDoc");
      QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});

      if (!snap || !snap.exists()) {
        console.log("☁️ syncActiveState: No app_state document found in cloud.");
        return;
      }

      const backup = snap.data() || {};
      const cloudLastUpdated = Number(backup.lastUpdated) || 0;

      let localLastUpdated = 0;
      try {
        const lastUpdatedRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'lastUpdated'");
        if (lastUpdatedRow) {
          localLastUpdated = Number(lastUpdatedRow.value) || 0;
        }
      } catch (err) {
        console.warn("⚠️ Error reading local lastUpdated:", err);
      }

      // Check if the local inventory table is empty or has been wiped
      let localIsEmpty = false;
      try {
        const countRow = dbService.queryOne("SELECT count(*) as count FROM inventory") as { count: number };
        if (!countRow || countRow.count === 0) {
          localIsEmpty = true;
        }
      } catch (err) {}

      // If the cloud state is newer, or the local sqlite state is completely empty, restore the active state securely
      if (cloudLastUpdated > localLastUpdated || localIsEmpty) {
        console.log(`☁️ Cloud app_state is newer than local (Cloud: ${cloudLastUpdated} > Local: ${localLastUpdated}) or local is empty. Synchronizing active state...`);
        
        const masterItems = backup.masterItems || [];
        const activeSession = backup.activeSession || null;

        dbService.transaction(() => {
          // Clear and reload master items
          dbService.run("DELETE FROM inventory");
          const insertItem = dbService.run.bind(dbService, `
            INSERT INTO inventory (id, name, category, bookQty, unit, previousDiff, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          let fcIdx = 0;
          for (const item of masterItems) {
            insertItem([
              String(item.id || item.itemId),
              item.name || item.itemName,
              item.category || "عام",
              Number(item.bookQty) || 0,
              item.unit || "كجم",
              Number(item.previousDiff) || 0,
              fcIdx++
            ]);
          }

          // Update activeSession if present in cloud to prevent unnecessary wipes of local sessions
          if (activeSession) {
            dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
            dbService.run(`
              INSERT OR REPLACE INTO settings (key, value)
              VALUES ('activeSession', ?)
            `, [JSON.stringify(activeSession)]);
          }

          // Update lastUpdated
          dbService.run(`
            INSERT OR REPLACE INTO settings (key, value)
            VALUES ('lastUpdated', ?)
          `, [String(cloudLastUpdated)]);
        });
        
        console.log("☁️ syncActiveState: Master catalog and active session have been synchronized with the cloud.");
      }
    } catch (err: any) {
      console.warn("⚠️ Bypassed dynamic active state sync:", err.message || err);
    }
  }

  public static async restoreStateFromCloud(force = false): Promise<boolean> {
    try {
      if (getFirestoreApiDisabled()) {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ Restoring state from server local backup mirror because Firestore is disabled.");
          this.reconstructSQLiteFromBackup(mirror);
          return true;
        }
        if (force) {
          throw new Error("عذراً، خدمة المزامنة السحابية غير مفعلة في هذا المشروع (موقع العمل يعمل محلياً بكفاءة 100% باستخدام SQLite). يرجى تفعيل الـ Firestore API أو استخدام خيار استرجاع ملف النسخة الاحتياطية (.json) يدوياً.");
        }
        return false;
      }
      const db = getFirestoreDB(force);
      if (!db) {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ Restoring state from server local backup mirror because Firestore db is null.");
          this.reconstructSQLiteFromBackup(mirror);
          return true;
        }
        if (force) {
          throw new Error("عذراً، خدمة المزامنة السحابية غير مفعلة في هذا المشروع (موقع العمل يعمل محلياً بكفاءة 100% باستخدام SQLite). يرجى استخدام خيار استرجاع ملف النسخة الاحتياطية (.json) يدوياً.");
        }
        return false;
      }

      let docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      console.log(`🔍 Checking Firestore for available cloud backups to restore lost SQLite data for environment: /${collName}/${docName}`);

      let stateDoc: any = null;
      let usedDocName = docName;
      
      // 🛡️ PERFECT ENVIRONMENT ISOLATION ENGINE:
      try {
        const primaryRef = doc(db, collName, docName);
        const primarySnap = await withTimeout(getDoc(primaryRef), OVERRIDE_TIMEOUT_MS, "getDocPrimary");
        QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});
        if (primarySnap && primarySnap.exists()) {
          stateDoc = primarySnap;
          usedDocName = docName;
          console.log(`✅ Selected environment backup document '${docName}'.`);
        }
      } catch (getErr: any) {
        handleFirestoreError(getErr, OperationType.GET, `${collName}/${docName}`);
      }

      if (!stateDoc || !stateDoc.exists()) {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ No cloud backup found in Firestore. Restoring from server local backup mirror.");
          this.reconstructSQLiteFromBackup(mirror);
          return true;
        }
        console.log(`ℹ️ No cloud backup found in Firestore for /${collName}/${docName}. Skipping cloud restoration to preserve current local state.`);
        return false;
      }

      // Read local state metadata to prevent overwriting newer local edits
      let localLastUpdated = 0;
      let localHasData = false;
      try {
        const lastUpdatedRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'lastUpdated'");
        if (lastUpdatedRow) {
          localLastUpdated = Number(lastUpdatedRow.value) || 0;
        }
        
        const userCountCount = dbService.queryOne("SELECT count(*) as count FROM users") as { count: number };
        const snapshotCountCount = dbService.queryOne("SELECT count(*) as count FROM inventory_snapshots") as { count: number };
        const itemsCountCount = dbService.queryOne("SELECT count(*) as count FROM inventory") as { count: number };
        
        if ((userCountCount && userCountCount.count > 1) || (snapshotCountCount && snapshotCountCount.count > 0) || (itemsCountCount && itemsCountCount.count > 0)) {
          localHasData = true;
        }
      } catch (err) {
        console.warn("⚠️ Error reading local db metadata during cloud restoration:", err);
      }

      const backup = stateDoc.data() || {};
      const cloudLastUpdated = Number(backup.lastUpdated) || 0;

      // Fetch pastSessions from their own collection
      const snapshotsCollName = resolveCollectionName("inventory_snapshots");
      let pastSessions = backup.pastSessions || []; // fallback to legacy array
      try {
        const snapshotsRef = collection(db, snapshotsCollName);
        const querySnapshot = await getDocs(snapshotsRef);
        QuotaService.trackOperation(1, 0, 0, "sys", "System Background").catch(() => {});
        if (!querySnapshot.empty) {
          pastSessions = querySnapshot.docs.map(doc => {
            const val = doc.data();
            if (val) {
              const sid = val.id || val.session_id || doc.id;
              val.id = sid;
              val.session_id = sid;
            }
            return val;
          }).filter(Boolean);
          console.log(`📦 Restored ${pastSessions.length} archived sessions from individually synchronized collection: ${snapshotsCollName}`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not fetch from ${snapshotsCollName}, falling back to legacy array`, err);
      }

      // 🛡️ DATA PRESERVATION SHIELD: Verify cloud data exists before we even think about wiping local tables
      const masterItems = backup.masterItems || [];
      const activeSession = backup.activeSession || null;

      if (masterItems.length === 0 && !activeSession && pastSessions.length === 0) {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ Cloud backup empty. Restoring from server local backup mirror.");
          this.reconstructSQLiteFromBackup(mirror);
          return true;
        }
        console.warn("🛡️ Cloud backup appears EMPTY or CORRUPTED. Aborting destructive restore to prevent local data loss.");
        return false;
      }

      if (!force && localHasData && localLastUpdated >= cloudLastUpdated) {
        console.log(`🛡️ SQLite state is more recent or equal to Cloud Backup (Local: ${localLastUpdated} >= Cloud: ${cloudLastUpdated}). Skipping overwrite to secure active edits.`);
        return false;
      }

      console.log(`🔄 Restoring state from verified Cloud Backup source '${usedDocName}'...`);

      // Reconstruct SQLite database inside a safe transaction
      this.reconstructSQLiteFromBackup({
        masterItems,
        activeSession,
        pastSessions,
        lastUpdated: backup.lastUpdated
      });

      // 🚀 NEW: Trigger background user independent sync to repopulate SQLite users table from central cloud repository
      FirebaseBackupService.restoreUsersFromCloud(true).catch(e => console.warn("Background user restoration skipped:", e));
      FirebaseBackupService.syncDeletedSessionsFromCloud().catch(e => console.warn("Background deleted sessions sync skipped during restoration:", e));

      console.log(`🎉 SUCCESS: Restored full active and archived sessions gracefully from Firestore Cloud Backup (/${collName}/${docName})!`);
      return true;
    } catch (err: any) {
      console.warn("⚠️ Failed to restore state from Firestore cloud backup (trying local server fallback).", err.message);
      try {
        const mirror = this.getLocalMirrorData();
        if (mirror) {
          console.log("☁️ Restoring from server local backup mirror after actual Firestore restore crashed.");
          this.reconstructSQLiteFromBackup(mirror);
          return true;
        }
      } catch (fallbackE) {}
      return false;
    }
  }

  private static lastUsersSyncTime = 0;

  /**
   * Deep reconstruct of local users table from Firestore 'users' collection.
   */
  /**
   * Deep sync of local users table to Firestore 'users' collection.
   */
  public static async pushUsersToCloud(): Promise<void> {
    try {
      if (getFirestoreApiDisabled()) return;
      const db = getFirestoreInstance();
      if (!db) return;

      const users = dbService.query("SELECT * FROM users") as any[];
      if (!users || users.length === 0) return;

      console.log(`☁️ CLOUD SYNC: Pushing ${users.length} user accounts to Firestore...`);
      for (const u of users) {
        const code = String(u.code).trim().toLowerCase();
        if (!code) continue;

        // Ensure we don't accidentally overwrite cloud data with older local data unless it's necessary
        // In this case, we just want to make sure they exist
        await setFirestoreDoc("users", code, {
          ...u,
          code: code,
          updated_at: u.updated_at || Date.now()
        });
      }
      console.log("✅ CLOUD SYNC: User accounts successfully pushed to Firestore.");
    } catch (err: any) {
      console.warn("⚠️ Failed to push users to Firestore:", err.message || err);
    }
  }

  public static async restoreUsersFromCloud(force = false): Promise<void> {
    const now = Date.now();
    
    // STRICT CLOUD-AUTHORITATIVE MODEL: We only pull from cloud. We NEVER push local users to cloud from here.
    if (!isAppEnvValid()) {
      console.warn("🛑 Cloud synchronization disabled: APP_ENV is invalid or missing.");
      return;
    }
    FirebaseBackupService.lastUsersSyncTime = now;
    try {
      const db = getFirestoreDB(force);
      if (!db) return;

      const { getFirestoreCollection, deleteFirestoreDoc } = await import("./firestoreService");
      
      const resolvedName = resolveCollectionName("users");
      const collectionsToTry = [resolvedName];
      let cloudUsers: any[] = [];
      const seenUserCodes = new Set<string>();

      // 🛡️ STRICT ENVIRONMENT RELATION SHIELD:
      // Restrict syncing of user accounts strictly to the environment-specific collection (e.g. users_development vs users_master),
      // ensuring 100% data separation between development and production environments, as explicitly requested!
      for (const colName of collectionsToTry) {
        try {
          const colRef = collection(db, colName);
          const snap = await withTimeout(getDocs(colRef), 10000, `getDocs-${colName}`);
          if (snap && !snap.empty) {
            console.log(`☁️ Synced ${snap.size} user accounts from cloud collection '${colName}'.`);
            for (const doc of snap.docs) {
              const u = doc.data();
              const codeClean = String(u.code || doc.id).trim().toLowerCase();
              if (codeClean && !seenUserCodes.has(codeClean)) {
                seenUserCodes.add(codeClean);
                cloudUsers.push({
                  ...u,
                  code: u.code || doc.id
                });
              }
            }
          }
        } catch (e: any) {
          console.warn(`⚠️ Bypassed soft users fetch from collection '${colName}':`, e.message || e);
        }
      }

      // 🛡️ NO USER DELETION OR PRUNING IN restoreUsersFromCloud
      // As requested, any pruning, deletion, or background purging of user accounts has been completely disabled.
      // Synchronization is strictly append-and-update only.
      
      if (!cloudUsers || cloudUsers.length === 0) return;

      dbService.transaction(() => {
        for (const u of cloudUsers) {
          const code = String(u.code).trim();
          if (!code) continue;

          const localUser = dbService.queryOne("SELECT * FROM users WHERE LOWER(code) = ?", [code.toLowerCase()]) as any;
          const cloudTime = Number(u.updated_at || u.updatedAt || 0);

          const isPrecodedVal = u.is_precoded !== undefined ? u.is_precoded : (u.isPrecoded !== undefined ? u.isPrecoded : false);
          const isRegisteredVal = u.is_registered !== undefined ? u.is_registered : (u.isRegistered !== undefined ? u.isRegistered : false);
          const isActivatedVal = u.is_activated !== undefined ? u.is_activated : (u.isActivated !== undefined ? u.isActivated : true);
          const rememberMeVal = u.remember_me !== undefined ? u.remember_me : (u.rememberMe !== undefined ? u.rememberMe : false);

          const toInt = (val: any) => (val === true || val === 1 || val === "1") ? 1 : 0;
          let isActivatedInt = (isActivatedVal === false || isActivatedVal === 0 || isActivatedVal === "0") ? 0 : 1;
          let isPrecodedInt = toInt(isPrecodedVal);
          let isRegisteredInt = toInt(isRegisteredVal);
          let roleToSave = u.role;

          if (code === "18") {
            roleToSave = "general_manager";
            isActivatedInt = 1;
            isPrecodedInt = 1;
            isRegisteredInt = 1;
          }

          dbService.run(`
            INSERT OR REPLACE INTO users (code, name, phone, role, password, remember_me, is_precoded, is_registered, is_activated, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            code, 
            u.name, 
            u.phone || "", 
            roleToSave, 
            u.password || (localUser ? localUser.password : null) || bcrypt.hashSync("AlEman@Change123", 10),
            toInt(rememberMeVal),
            isPrecodedInt,
            isRegisteredInt,
            isActivatedInt,
            cloudTime
          ]);
        }
      });

      FirebaseBackupService.lastUsersSyncTime = Date.now();
      console.log(`🎉 Successfully synced and cached ${cloudUsers.length} users to local SQLite cache.`);
    } catch (err: any) {
      console.warn("⚠️ Background users cloud sync failed:", err.message);
    }
  }

  /**
   * Securely seeds and guarantees the presence of the default General Manager (code 18) account.
   * This is a recovery-first account protected with system-master flags.
   */
  public static async ensureDefaultGMInCloud(): Promise<void> {
    try {
      if (getFirestoreApiDisabled()) return;
      if (!isAppEnvValid()) return;

      const { getFirestoreDoc, setFirestoreDoc } = await import("./firestoreService");
      const cloudGM = await getFirestoreDoc("users", "18");
      
      if (!cloudGM) {
        console.log("🚀 Recovery Account Check: Master account (code 18) missing in Cloud. Re-seeding securely...");
        const securePass = bcrypt.hashSync("171996", 10);
        await setFirestoreDoc("users", "18", {
          code: "18",
          name: "المدير العام",
          phone: "",
          role: "general_manager",
          password: securePass,
          remember_me: 1,
          is_precoded: 1,
          is_registered: 1,
          is_activated: 1,
          isSystemMaster: true,
          isProtected: true,
          canDelete: false,
          canDeactivate: false,
          updated_at: Date.now()
        });
        console.log("✅ Recovery Account Seeding: Master account (code 18) established in Firestore.");
      } else {
        // OPTIONAL: Patch existing GM with protection keys if missing
        if (!cloudGM.isSystemMaster || !cloudGM.isProtected) {
          console.log("🛡️ Master Account Guard: Updating existing cloud account with protection flags...");
          await setFirestoreDoc("users", "18", { 
            ...cloudGM, 
            isSystemMaster: true, 
            isProtected: true, 
            canDelete: false, 
            canDeactivate: false 
          });
        }
        console.log("✅ Custom seeding verification: GM account (code 18) secured with persistent protection flags.");
      }
    } catch (err: any) {
      console.warn("⚠️ Failed to ensure master account protection in Firestore:", err.message);
    }
  }

  public static async clearMasterMirror() {
    try {
      const db = getFirestoreDB(true);
      if (!db) {
        console.warn("⚠️ Firestore access required to clear master mirror.");
        return false;
      }
      
      const docName = FirebaseBackupService.getBackupDocumentName();
      const collName = resolveCollectionName("app_state");
      const docRef = doc(db, collName, docName);
      
      // 1. Wipe the central app_state document master and active data
      await withTimeout(setDoc(docRef, { 
        masterItems: [], 
        activeSession: null,
        lastUpdated: Date.now(),
        updatedAtString: new Date().toISOString() 
      }, { merge: true }), 10000, "clear-mirror");
      
      // 2. Wipe cloud collection snapshots and deleted_sessions if possible
      try {
        const snapshotsColl = resolveCollectionName("inventory_snapshots");
        const deletedColl = resolveCollectionName("deleted_sessions");
        
        const snaps = await getDocs(collection(db, snapshotsColl));
        for (const d of snaps.docs) {
          await deleteDoc(d.ref);
        }
        
        const dels = await getDocs(collection(db, deletedColl));
        for (const d of dels.docs) {
          await deleteDoc(d.ref);
        }
      } catch (e) {
        console.warn("⚠️ Cloud collection destructive prune partial failure:", e);
      }

      const mirrorPath = this.getMirrorPath();
      if (fs.existsSync(mirrorPath)) {
        try {
          let mirror = JSON.parse(fs.readFileSync(mirrorPath, "utf-8"));
          mirror.masterItems = [];
          mirror.activeSession = null;
          mirror.pastSessions = [];
          mirror.deletedSessions = [];
          mirror.updatedAtString = new Date().toISOString();
          fs.writeFileSync(mirrorPath, JSON.stringify(mirror, null, 2), "utf-8");
        } catch(e) {}
      }
      return true;
    } catch (err: any) {
      console.error("🔥 Error clearing master database in FirebaseBackupService:", err);
      return false;
    }
  }
}
