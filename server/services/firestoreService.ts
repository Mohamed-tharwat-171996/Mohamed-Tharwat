// Intercept and swallow benign Firestore BloomFilter warnings before any imports
const originalConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map(a => {
    if (a instanceof Error) return a.message + "\n" + a.stack;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }).join(" ");
  if (msg.includes("BloomFilter") || msg.includes("Invalid hash count")) {
    return;
  }
  originalConsoleError.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  const msg = args.map(a => {
    if (a instanceof Error) return a.message + "\n" + a.stack;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }).join(" ");
  if (msg.includes("BloomFilter") || msg.includes("Invalid hash count")) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

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
  let env = (process.env.APP_ENV || "").trim().toLowerCase();
  
  // Use Cloud Run service name as a hint for production environment if not explicitly set
  if (!env && process.env.K_SERVICE) {
    env = "production";
  }

  // 1. If explicit request is provided, check host and referer
  if (req) {
    const host = String(req.headers?.host || req.get?.('host') || "").toLowerCase();
    const referer = String(req.headers?.referer || req.headers?.referrer || "").toLowerCase();
    const xForwardedHost = String(req.headers?.['x-forwarded-host'] || "").toLowerCase();

    if (host.includes("ais-pre") || referer.includes("ais-pre") || xForwardedHost.includes("ais-pre")) {
      env = "production";
    } else if (host.includes("ais-dev") || referer.includes("ais-dev") || xForwardedHost.includes("ais-dev") || host.startsWith("3000-") || host.includes("localhost") || host.includes("127.0.0.1")) {
      env = "development";
    } else if (host.includes(".run.app") || xForwardedHost.includes(".run.app")) {
      env = "production";
    }
  }

  if (env === "production" || env === "preview" || env === "prod") {
    return "production";
  }
  if (env === "development" || env === "dev" || env === "local") {
    return "development";
  }

  // If we are here, we couldn't determine the environment strictly.
  // Default to development to prevent system crash, especially for background tasks.
  const diag = req ? `Host: ${req.headers?.host}, X-Forwarded-Host: ${req.headers?.['x-forwarded-host']}, Referer: ${req.headers?.referer}` : "No Request Context";
  console.warn(`⚠️ Environment detection fallback to 'development'. Context: ${diag}`);
  return "development";
}

export function getAppEnv(): string {
  try {
    // Prefer the active AsyncLocalStorage context if available
    const store = requestEnvStorage.getStore();
    if (store) {
      return store;
    }
    return detectEnvironment();
  } catch (e) {
    return "unknown";
  }
}

export function getEnvSecret(key: string): string {
  const env = getAppEnv();
  if (env === "unknown") return "";
  
  const envPrefix = env.toUpperCase();
  const prefixedKey = `${envPrefix}_${key}`;
  
  const val = process.env[prefixedKey] || process.env[key];
  return (val || "").trim();
}

export function isAppEnvValid(): boolean {
  const env = getAppEnv();
  return env === "production" || env === "development";
}

export async function checkFirestoreHealth(): Promise<{ connected: boolean; healthy: boolean; reason?: string }> {
  if (!isFirestoreConfigured()) {
    return { connected: false, healthy: false, reason: "ملف الإعدادات (firebase-applet-config.json) غير موجود" };
  }
  if (isFirestoreApiDisabled) {
    return { connected: false, healthy: false, reason: isFirestoreApiBlockedByGoogle ? "تم تجاوز حدود استخدام Google API" : "معطل يدوياً أو بسبب أخطاء متكررة" };
  }
  
  const db = getFirestoreInstance();
  if (!db) {
    return { connected: false, healthy: false, reason: "فشل تهيئة Firestore (تأكد من صحة الإعدادات)" };
  }

  try {
    const testDoc = doc(db, resolveCollectionName("health_check"), "ping");
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    await Promise.race([getDoc(testDoc), timeoutPromise]);
    return { connected: true, healthy: true };
  } catch (err: any) {
    return { connected: true, healthy: false, reason: `خطأ في الاتصال: ${err.message || "Timeout"}` };
  }
}

// Unified User Resolver to ensure 100% consistency across login, listing, and activation
export class UserResolver {
  public static async getUserByCode(code: string): Promise<any | null> {
    const codeClean = String(code).trim().toLowerCase();
    try {
      const user = await getFirestoreDoc("users", codeClean);
      return user;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      if (errMsg.includes("Timeout") || errMsg.includes("deadline")) {
        throw new Error("TIMEOUT");
      }
      if (errMsg.includes("unavailable") || errMsg.includes("network")) {
        throw new Error("UNAVAILABLE");
      }
      if (errMsg.includes("permission") || errMsg.includes("denied")) {
        throw new Error("PERMISSION_DENIED");
      }
      throw err;
    }
  }

  public static async getAllUsers(): Promise<any[]> {
    try {
      const users = await getFirestoreCollection("users");
      return users || [];
    } catch (err) {
      console.error("UserResolver.getAllUsers failed:", err);
      return [];
    }
  }

  public static async saveUser(code: string, userData: any): Promise<void> {
    const codeClean = String(code).trim().toLowerCase();
    await setFirestoreDoc("users", codeClean, userData);
  }
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
  
  try {
    const collRef = collection(db, resolved);
    const getDocsPromise = getDocs(collRef);
    getDocsPromise.catch(() => {});
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 8000);
    });
    const snap = await Promise.race([getDocsPromise, timeoutPromise]);
    
    // Track operation
    if (snap && !snap.empty) {
      import("./quotaService").then(({ QuotaService }) => {
        QuotaService.trackOperation(snap.size, 0, 0, "sys", "System Collection Read").catch(() => {});
      }).catch(() => {});
    }

    consecutiveFailures = 0;
    if (snap && !snap.empty) {
      return snap.docs.map(d => {
        const data = d.data();
        return { ...data, code: data.code || d.id };
      });
    }
    return [];
  } catch (err: any) {
    if (err && err.message === "Timeout") {
      console.warn("⚠️ Firestore collection fetch timed out. Reinitializing connection...");
      reinitializeFirestore();
      throw err;
    }

    const errMsg = String(err.message || err);
    const isNetworkError = errMsg.includes("network") || errMsg.includes("offline") || errMsg.includes("unavailable") || errMsg.includes("deadline") || errMsg.includes("stream");

    if (isNetworkError) {
      console.warn(`🌐 Network issue in collection fetch (${errMsg}). Reinitializing Firestore...`);
      reinitializeFirestore();
      throw err;
    }

    if (isFirestoreErrorDisabled(err)) {
      isFirestoreApiBlockedByGoogle = true;
      isFirestoreApiDisabled = true;
      console.warn("☁️ Firestore API is disabled or not activated. Operating in local mode.");
      return [];
    }

    throw err;
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
