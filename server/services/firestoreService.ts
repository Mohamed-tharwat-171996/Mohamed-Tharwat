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
  if (firestore) {
    try {
      terminate(firestore).catch(() => {});
    } catch (e) {}
  }
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
      let databaseId = "ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e";
      
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
    
    // DEBUG: Logging detection parameters
    const xForwardedHost = String(req.headers?.['x-forwarded-host'] || "").toLowerCase();
    if (host.includes("ais-") || referer.includes("ais-") || xForwardedHost.includes("ais-")) {
       console.log(`🔍 [ENV_DEBUG] Host: ${host}, X-Forwarded-Host: ${xForwardedHost}, Referer: ${referer}`);
    }

    if (host.includes("ais-pre") || referer.includes("ais-pre") || xForwardedHost.includes("ais-pre")) {
      return "production";
    }
    if (host.includes("ais-dev") || referer.includes("ais-dev") || xForwardedHost.includes("ais-dev") || host.startsWith("3000-")) {
      return "development";
    }

    // Default for deployed Cloud Run apps or other production environments
    if (host.includes(".run.app") || xForwardedHost.includes(".run.app")) {
      return "production";
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
  if (baseName === "users" || baseName === "app_users") {
    return `users_${env}`;
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

export async function _getFirestoreDoc(collectionName: string, docId: string): Promise<any> {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return null;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const getDocPromise = getDoc(docRef);
    getDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 8000);
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

    // 🛡️ FALLBACK: If user not found in namespaced collection, try development as it often contains legacy data
    if (collectionName === "users" && !resolved.includes("development")) {
      try {
        const devDocRef = doc(db, "users_development", docId);
        const devSnap = await getDoc(devDocRef);
        if (devSnap.exists()) {
          console.log(`💡 Legacy User Discovery: Found ${docId} in users_development.`);
          const data = devSnap.data();
          return { ...data, code: data.code || docId };
        }
      } catch (e) {}
    }
    
    return null;
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) {
       // Silent retry might be too complex here, just return null so it doesn't crash
       return null;
    }

    if (err && err.message === "Timeout") {
      console.warn("⚠️ Firestore operation timed out. Reinitializing connection...");
      reinitializeFirestore();
      throw err;
    }
    
    const now = Date.now();
    lastFailureTime = now;

    const errMsg = String(err.message || err);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("deadline") || errMsg.includes("stream");

    if (isNetworkError) {
      console.warn(`🌐 Network issue detected (${errMsg}). Proactively reinitializing Firestore...`);
      reinitializeFirestore();
    }

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      // For all other errors (timeout, network, etc), just reinitialize and throw, but DO NOT DISABLE
      console.warn(`⚠️ Firestore operation failed on doc ${resolved}/${docId}: ${err.message || err}. Reinitializing for stability...`);
      reinitializeFirestore();
      throw err;
    }
    return null;
  }
}

export async function _setFirestoreDoc(collectionName: string, docId: string, data: any) {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const setDocPromise = setDoc(docRef, data, { merge: true });
    setDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 8000);
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
    
    if (err && err.message === "Timeout") {
      console.warn("⚠️ Firestore operation timed out. Reinitializing connection...");
      reinitializeFirestore();
      throw err;
    }
    
    const now = Date.now();
    lastFailureTime = now;

    const errMsg = String(err.message || err);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("deadline") || errMsg.includes("stream");

    if (isNetworkError) {
      console.warn(`🌐 Network issue detected (${errMsg}). Proactively reinitializing Firestore...`);
      reinitializeFirestore();
    }

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      // For all other errors (timeout, network, etc), just reinitialize and throw, but DO NOT DISABLE
      console.warn(`⚠️ Firestore operation failed on set doc ${resolved}/${docId}: ${err.message || err}. Reinitializing for stability...`);
      reinitializeFirestore();
      throw err;
    }
  }
}

export async function _deleteFirestoreDoc(collectionName: string, docId: string) {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return;
  const resolved = resolveCollectionName(collectionName);
  try {
    const docRef = doc(db, resolved, docId);
    
    // Create a 12-second timeout to prevent startup/execution hang
    const deleteDocPromise = deleteDoc(docRef);
    deleteDocPromise.catch(() => {}); // prevent unhandled promise rejection if it fails after timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 8000);
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
    
    if (err && err.message === "Timeout") {
      console.warn("⚠️ Firestore operation timed out. Reinitializing connection...");
      reinitializeFirestore();
      throw err;
    }
    
    const now = Date.now();
    lastFailureTime = now;

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      // For all other errors (timeout, network, etc), just reinitialize and throw, but DO NOT DISABLE
      console.warn(`⚠️ Firestore operation failed on delete doc ${resolved}/${docId}: ${err.message || err}. Reinitializing for stability...`);
      reinitializeFirestore();
      throw err;
    }
  }
}

export async function _getFirestoreCollection(collectionName: string): Promise<any[]> {
  const db = getFirestoreInstance();
  if (!db || isFirestoreApiDisabled) return [];
  const resolved = resolveCollectionName(collectionName);
  
  const attemptFetch = async (targetCollection: string) => {
    try {
      const collRef = collection(db, targetCollection);
      const getDocsPromise = getDocs(collRef);
      getDocsPromise.catch(() => {});
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 8000);
      });
      const snap = await Promise.race([getDocsPromise, timeoutPromise]);
      
      if (snap && !snap.empty) {
        return snap.docs.map(d => {
          const data = d.data();
          return { ...data, code: data.code || d.id };
        });
      }
      return [];
    } catch (e) {
      return [];
    }
  };

  try {
    // 1. Try the primary resolved collection
    let results = await attemptFetch(resolved);
    
    // 2. If it's the 'users' collection and we got nothing, try common fallbacks
    if (results.length === 0 && (collectionName === "users" || collectionName === "app_users")) {
      const env = getAppEnv();
      const fallbacks = ["users", "app_users", `users_${env}`, `app_users_${env}`].filter(f => f !== resolved);
      
      for (const fallback of fallbacks) {
        results = await attemptFetch(fallback);
        if (results.length > 0) {
          console.log(`💡 User Discovery: Found ${results.length} users in fallback collection: ${fallback}`);
          break;
        }
      }
    }

    // Track operation
    import("./quotaService").then(({ QuotaService }) => {
      QuotaService.trackOperation(1, 0, 0, "sys", "System Generic Collection Read").catch(() => {});
    }).catch(() => {});

    consecutiveFailures = 0;
    return results;
  } catch (err: any) {
    if (handleBloomFilterFailure(err)) return [];
    
    const now = Date.now();
    lastFailureTime = now;
    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in stable local Storage mode.");
    } else {
      // For all other errors (timeout, network, etc), just reinitialize but DO NOT DISABLE
      console.warn(`⚠️ Firestore collection fetch failed: ${err.message || err}. Reinitializing for stability...`);
      reinitializeFirestore();
    }
    return [];
  }
}


// ==========================================
// AUTO-RETRY WRAPPERS FOR ROBUSTNESS
// ==========================================

export async function getFirestoreDoc(collectionName: string, docId: string): Promise<any> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _getFirestoreDoc(collectionName, docId);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(`⚠️ Auto-retry getFirestoreDoc for ${docId} (${retries} left)`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function setFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _setFirestoreDoc(collectionName, docId, data);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(`⚠️ Auto-retry setFirestoreDoc for ${docId} (${retries} left)`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function deleteFirestoreDoc(collectionName: string, docId: string): Promise<void> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _deleteFirestoreDoc(collectionName, docId);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(`⚠️ Auto-retry deleteFirestoreDoc for ${docId} (${retries} left)`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function getFirestoreCollection(collectionName: string): Promise<any[]> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _getFirestoreCollection(collectionName);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(`⚠️ Auto-retry getFirestoreCollection for ${collectionName} (${retries} left)`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
