import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, Firestore, memoryLocalCache, terminate } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

export const requestEnvStorage = new AsyncLocalStorage<string>();

let isFirestoreApiDisabled = false;
let isFirestoreApiBlockedByGoogle = false;

// Robust self-healing circuit breaker state
let consecutiveFailures = 0;
const FAILURE_THRESHOLD = 999999; // Disable circuit breaker auto-disabling for standard operations to ensure users are always fetched
const COOLDOWN_PERIOD_MS = 15000; // 15 seconds
let lastFailureTime = 0;

// Load config dynamically on server boot
let appletConfig: any = null;
try {
  // Priority 1: Environment Variable (most secure in AI Studio)
  const envConfig = getEnvSecret("FIREBASE_CONFIG");
  if (envConfig && envConfig.trim().startsWith('{')) {
    try {
      appletConfig = JSON.parse(envConfig);
      console.log("🔥 Firebase configuration loaded successfully from environment variable.");
    } catch (e) {
      console.error("⚠️ Failed to parse FIREBASE_CONFIG environment variable:", e);
    }
  }

  // Priority 2: Config Files (fallback)
  if (!appletConfig) {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    const backupPath = path.join(process.cwd(), 'server', 'firebase-backup-config.json');
    if (fs.existsSync(configPath)) {
      appletConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else if (fs.existsSync(backupPath)) {
      appletConfig = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    }
  }
} catch (err) {
  console.warn("⚠️ Failed to load firebase config during service init:", err);
}

export function getFirestoreApiDisabled(): boolean {
  return isFirestoreApiDisabled;
}

export function setFirestoreApiDisabled(value: boolean) {
  isFirestoreApiDisabled = value;
  if (!value) {
    isFirestoreApiBlockedByGoogle = false;
    consecutiveFailures = 0;
    lastFailureTime = 0;
  }
}

export function isFirestoreErrorDisabled(err: any): boolean {
  if (!err) return false;
  const errMsg = String(err.message || err);
  if (
    errMsg.includes("API has not been used") ||
    errMsg.includes("firestore.googleapis.com has not been used") ||
    errMsg.includes("disabled in this project")
  ) {
    isFirestoreApiBlockedByGoogle = true;
    return true;
  }
  return false;
}

export function handleBloomFilterFailure(err: any): boolean {
  if (!err) return false;
  const errMsg = String(err.message || err);
  if (errMsg.includes("BloomFilter") || errMsg.includes("hash count")) {
    console.warn("🚨 RECOVERABLE CLOUD ERROR: BloomFilter failure detected. Resetting Firestore instance...");
    if (firestore) {
      terminate(firestore).catch(() => {});
      firestore = null;
    }
    return true;
  }
  return false;
}

// Global cached instance
export let firestore: Firestore | null = null;

export function isFirestoreConfigured(): boolean {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    const backupPath = path.join(process.cwd(), 'server', 'firebase-backup-config.json');
    const hasEnv = !!(
      process.env.FIREBASE_CONFIG || 
      process.env.DEVELOPMENT_FIREBASE_CONFIG || 
      process.env.PRODUCTION_FIREBASE_CONFIG || 
      process.env.MASTERS_FIREBASE_CONFIG || 
      process.env.MASTER_FIREBASE_CONFIG
    );
    return fs.existsSync(configPath) || fs.existsSync(backupPath) || hasEnv;
  } catch (e) {
    return false;
  }
}

export function reinitializeFirestore(): any {
  firestore = null;
  // Only re-enable if it's actually configured
  if (isFirestoreConfigured()) {
    isFirestoreApiDisabled = false;
    isFirestoreApiBlockedByGoogle = false;
    consecutiveFailures = 0;
    lastFailureTime = 0;
  }
  return getFirestoreInstance();
}

/**
 * Returns a configured client-side Firestore instance running on the backend.
 * Uses the Web Client SDK to safely pass through firestore.rules using public credentials.
 */
export function getFirestoreInstance(): Firestore | null {
  if (!isAppEnvValid()) {
    isFirestoreApiDisabled = true;
    console.warn("🛑 CLOUD EXCLUSION: Firestore API disabled (Invalid Env).");
    return null;
  }

  // If permanently blocked by Google, return null immediately
  if (isFirestoreApiBlockedByGoogle) {
    return null;
  }

  // Self-healing check: If the API was disabled, check if the cooldown period has passed to retry
  if (isFirestoreApiDisabled) {
    const now = Date.now();
    if (now - lastFailureTime > COOLDOWN_PERIOD_MS) {
      console.log("🔄 Self-healing: Cooldown expired. Retrying connection to Firestore...");
      isFirestoreApiDisabled = false;
      consecutiveFailures = 0;
    } else {
      return null;
    }
  }
  
  // Verify configuration exists
  if (!isFirestoreConfigured() && !getEnvSecret("FIREBASE_CONFIG")) {
    isFirestoreApiDisabled = true;
    console.warn("☁️ Firestore config missing. Operating in high-performance local SQLite mode.");
    return null;
  }
  
  // If we have a cached valid instance, return it
  if (firestore) return firestore;

  try {
    let freshConfig: any = appletConfig;
    
    // If not loaded yet, try loading again (lazy load)
    if (!freshConfig) {
      const envConfig = getEnvSecret("FIREBASE_CONFIG");
      if (envConfig) {
        try {
          freshConfig = JSON.parse(envConfig);
        } catch (e) {}
      }
      
      if (!freshConfig) {
        const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
        const backupPath = path.join(process.cwd(), 'server', 'firebase-backup-config.json');
        if (fs.existsSync(configPath)) {
          freshConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } else if (fs.existsSync(backupPath)) {
          freshConfig = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
        }
      }
    }

    if (freshConfig) {
      const apps = getApps();
      let app;
      if (apps.length === 0) {
        app = initializeApp(freshConfig);
      } else {
        app = getApp();
      }

      // Authenticate server anonymously to gain a valid request.auth context in firestore.rules
      try {
        const auth = getAuth(app);
        // signInAnonymously(auth) removed to prevent broken auth state
      } catch (authInitErr: any) {
        console.warn("⚠️ Failed to initialize Firebase Auth on server:", authInitErr.message);
      }
      
      // Dynamic Database ID resolution
      let databaseId = freshConfig.firestoreDatabaseId || freshConfig.databaseId;
      if (!databaseId || databaseId === "(default)") {
        try {
          const fbJsonPath = path.join(process.cwd(), 'firebase.json');
          if (fs.existsSync(fbJsonPath)) {
            const fbJson = JSON.parse(fs.readFileSync(fbJsonPath, 'utf-8'));
            if (fbJson?.firestore?.database) {
              databaseId = fbJson.firestore.database;
              console.log(`🎯 Dynamically resolved custom database ID from firebase.json: ${databaseId}`);
            }
          }
        } catch (e) {
          console.warn("⚠️ Failed to parse firebase.json for database ID:", e);
        }
      }
      if (!databaseId) {
        databaseId = "(default)";
      }

      try {
        // Try getFirestore first - often more stable in Node.js environments regarding internal filters/caches
        const innerDb = getFirestore(app, databaseId);
        firestore = innerDb;
        console.log(`🔥 Firestore instance retrieved via getFirestore for database: ${databaseId}`);
      } catch (getErr) {
        try {
          const innerDb = initializeFirestore(app, {
            localCache: memoryLocalCache(),
          }, databaseId);
          firestore = innerDb;
          console.log(`🔥 Firestore connection initialized via initializeFirestore for database: ${databaseId}`);
        } catch (initErr: any) {
          console.warn("⚠️ Firestore initialization failed entirely:", initErr);
        }
      }
    } else {
      // 🛡️ PROTECTIVE SILENCE: If no config exists, permanently disable Cloud for this session
      // to prevent non-stop console errors and 500 blocks for local-first users.
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore config missing. Operating in high-performance local SQLite mode.");
      return null;
    }
  } catch (err) {
    console.warn("⚠️ Firestore re-init attempt failed:", err);
  }
  return firestore;
}

export function detectEnvironment(req?: any): string {
  // 1. If explicit request is provided, check host and referer
  if (req) {
    const host = String(req.headers?.host || req.get?.('host') || "").toLowerCase();
    const referer = String(req.headers?.referer || req.headers?.referrer || "").toLowerCase();
    
    if (host.includes("ais-pre") || referer.includes("ais-pre")) {
      return "production";
    }
    if (host.includes("ais-dev") || referer.includes("ais-dev")) {
      return "development";
    }
  }

  // 2. Fallback to process.env.APP_ENV if set
  const env = (process.env.APP_ENV || "").trim().toLowerCase();
  if (env === "production" || env === "preview" || env === "prod") {
    return "production";
  }
  return "development";
}

export function getAppEnv(): string {
  // Prefer the active AsyncLocalStorage context if available
  const store = requestEnvStorage.getStore();
  if (store) {
    return store;
  }
  return detectEnvironment();
}

/**
 * Robustly retrieves an environment-specific secret.
 * Searches in order: 
 * 1. [ENV]_VAR_NAME (e.g., DEV_JWT_SECRET)
 * 2. VAR_NAME (e.g., JWT_SECRET)
 */
export function getEnvSecret(key: string): string {
  const envPrefix = getAppEnv().toUpperCase();
  const prefixedKey = `${envPrefix}_${key}`;
  
  const val = process.env[prefixedKey] || process.env[key];
  return (val || "").trim();
}

export function isAppEnvValid(): boolean {
  const env = getAppEnv();
  return env === "production" || env === "development";
}

export const COLLECTIONS = {
  USERS: 'users',
  INVENTORY: 'inventory',
  ACTIVE_SESSION: 'activeSession',
  PAST_SESSIONS: 'pastSessions',
  SETTINGS: 'settings'
};

export function resolveCollectionName(name: string): string {
  const env = getAppEnv(); // this already strictly returns "production" or "development"

  let baseName = name.trim();
  if (baseName.endsWith("_production")) {
    baseName = baseName.replace(/_production$/, "");
  } else if (baseName.endsWith("_development")) {
    baseName = baseName.replace(/_development$/, "");
  }

  // Explicit collection mappings to guarantee accurate requested naming structure:
  if (baseName === "users") {
    return `users_${env}`;
  }
  if (baseName === "app_state") {
    return `app_state_${env}`;
  }
  if (baseName === "settings" || baseName === "system_config") {
    return `system_config_${env}`;
  }
  if (baseName === "inventory_snapshots" || baseName === "snapshots" || baseName === "pastSessions" || baseName === "past_sessions") {
    return `inventory_snapshots_${env}`;
  }
  if (baseName === "inventory" || baseName === "master_items" || baseName === "catalog") {
    return `inventory_master_${env}`;
  }
  if (baseName === "active_session" || baseName === "activeSession") {
    return `active_session_${env}`;
  }
  if (baseName === "app_users_backup") {
    return `app_users_backup_${env}`;
  }
  if (baseName === "backups_history" || baseName === "history") {
    return `backups_history_${env}`;
  }
  if (baseName === "deleted_sessions") {
    return `deleted_sessions_${env}`;
  }

  // Fallback to strict namespaced collection
  return `${baseName}_${env}`;
}

export async function getFirestoreDoc(collectionName: string, docId: string): Promise<any> {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return null;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const getDocPromise = getDoc(docRef);
    getDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 12000);
    });
    const docSnap = await Promise.race([getDocPromise, timeoutPromise]);
    
    // Track read
    import("./quotaService").then(({ QuotaService }) => {
      QuotaService.trackOperation(1, 0, 0, "sys", "System Generic Read").catch(() => {});
    }).catch(() => {});

    // Successful operation: reset consecutive failures counter
    consecutiveFailures = 0;
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...data,
        code: data.code || docId
      };
    }
    return null;
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) {
       // Silent retry might be too complex here, just return null so it doesn't crash
       return null;
    }
    
    const now = Date.now();
    lastFailureTime = now;

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      consecutiveFailures++;
      console.warn(`⚠️ Firestore operation failed (${consecutiveFailures}/${FAILURE_THRESHOLD}) on doc ${resolved}/${docId}:`, err.message || err);
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        isFirestoreApiDisabled = true;
        console.warn(`☁️ Firestore API auto-disabled (circuit breaker tripped) for stability after ${consecutiveFailures} consecutive errors.`);
      }
    }
    return null;
  }
}

export async function setFirestoreDoc(collectionName: string, docId: string, data: any) {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const setDocPromise = setDoc(docRef, data, { merge: true });
    setDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 12000);
    });
    await Promise.race([setDocPromise, timeoutPromise]);
    
    // Track write
    import("./quotaService").then(({ QuotaService }) => {
      QuotaService.trackOperation(0, 1, 0, "sys", "System Generic Write").catch(() => {});
    }).catch(() => {});

    // Successful operation: reset consecutive failures counter
    consecutiveFailures = 0;
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) return;
    
    const now = Date.now();
    lastFailureTime = now;

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      consecutiveFailures++;
      console.warn(`⚠️ Firestore operation failed (${consecutiveFailures}/${FAILURE_THRESHOLD}) on set doc ${resolved}/${docId}:`, err.message || err);
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        isFirestoreApiDisabled = true;
        console.warn(`☁️ Firestore API auto-disabled (circuit breaker tripped) for stability after ${consecutiveFailures} consecutive errors.`);
      }
    }
  }
}

export async function deleteFirestoreDoc(collectionName: string, docId: string) {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const deleteDocPromise = deleteDoc(docRef);
    deleteDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 12000);
    });
    await Promise.race([deleteDocPromise, timeoutPromise]);

    // Track delete
    import("./quotaService").then(({ QuotaService }) => {
      QuotaService.trackOperation(0, 0, 1, "sys", "System Generic Delete").catch(() => {});
    }).catch(() => {});

    // Successful operation: reset consecutive failures counter
    consecutiveFailures = 0;
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) return;
    
    const now = Date.now();
    lastFailureTime = now;

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      consecutiveFailures++;
      console.warn(`⚠️ Firestore operation failed (${consecutiveFailures}/${FAILURE_THRESHOLD}) on delete doc ${resolved}/${docId}:`, err.message || err);
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        isFirestoreApiDisabled = true;
        console.warn(`☁️ Firestore API auto-disabled (circuit breaker tripped) for stability after ${consecutiveFailures} consecutive errors.`);
      }
    }
  }
}

export async function getFirestoreCollection(collectionName: string): Promise<any[]> {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return [];
  const resolved = resolveCollectionName(collectionName);
  try {
    const collRef = collection(db, resolved);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const getDocsPromise = getDocs(collRef);
    getDocsPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 12000);
    });
    const snap = await Promise.race([getDocsPromise, timeoutPromise]);
    
    // Track read (1 call to getDocs is 1 read operation in simple billing, but effectively counting documents or metadata)
    import("./quotaService").then(({ QuotaService }) => {
      QuotaService.trackOperation(1, 0, 0, "sys", "System Generic Collection Read").catch(() => {});
    }).catch(() => {});

    // Successful operation: reset consecutive failures counter
    consecutiveFailures = 0;
    return snap.docs.map(d => {
      const data = d.data();
      return {
        ...data,
        code: data.code || d.id
      };
    });
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) return [];
    
    const now = Date.now();
    lastFailureTime = now;

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      consecutiveFailures++;
      console.warn(`⚠️ Firestore operation failed (${consecutiveFailures}/${FAILURE_THRESHOLD}) on collection ${resolved}:`, err.message || err);
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        isFirestoreApiDisabled = true;
        console.warn(`☁️ Firestore API auto-disabled (circuit breaker tripped) for stability after ${consecutiveFailures} consecutive errors.`);
      }
    }
    return [];
  }
}
