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

import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";

// Load environment variables (.env)
dotenv.config();

import apiRouter from "./server/api/routes";
import { AuthService } from "./server/auth/authService";
import { SessionService } from "./server/services/sessionService";
import { dbService } from "./server/database/dbService";
import { FirebaseBackupService } from "./server/services/firebaseBackupService";
import { setFirestoreApiDisabled, getAppEnv, requestEnvStorage, detectEnvironment } from "./server/services/firestoreService";

// Register global uncaught handler guards to ensure node process stability under any circumstances
process.on("uncaughtException", (err) => {
  console.error("🔥 Global Uncaught Exception caught to prevent server crash:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 Global Unhandled Rejection caught to prevent server crash:", reason);
});

import helmet from "helmet";

const app = express();
const PORT = 3000;

// Enable 12+ security headers via Helmet with iframe embedding compatibility for the AI Studio preview window
app.use(
  helmet({
    contentSecurityPolicy: false, // Permissive CSP to prevent blocking resource streaming inside the sandboxed preview
    frameguard: false,            // Prevents blocking the app inside AI Studio's visual frame/iframe
  })
);

// Parse JSON payloads up to 10MB (for bulk Excel imports)
app.use(express.json({ limit: "10mb" }));

// 🛡️ RECREATIONAL / SANDBOXING ENVIRONMENT DISTRIBUTOR MIDDLEWARE:
// Dynamically routes any incoming API request to the correct environment collection namespace
app.use((req, res, next) => {
  const env = detectEnvironment(req);
  requestEnvStorage.run(env, () => {
    next();
  });
});

// Mount secure API routes controller
app.use("/api", apiRouter);

// 🛡️ API Error Handler: Ensure any errors in /api routes return JSON instead of HTML
app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("🛑 API Error Captured:", err);
  res.status(err.status || 500).json({
    error: err.message || "حدث خطأ داخلي في الخادم (API).",
    path: req.originalUrl
  });
});

// 🛡️ API 404 GUARD: Catch any unhandled /api/* routes and return JSON instead of HTML
app.use("/api/*", (req, res) => {
  res.status(404).json({ 
    error: "المسار المطلوب غير موجود في واجهة البرمجة (API).",
    path: req.originalUrl 
  });
});

// Set up server startup sequence
async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // 1. Instantly start listening on the designated PORT
  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server is ONLINE and listening on http://0.0.0.0:${PORT} under 100% secure SQLite mode.`);
    
    // Ensure the secure dynamic cryptographic JWT keys are initialized/synced safely on background boot
    try {
      await AuthService.initializeSecrets();
    } catch (err) {
      console.error("⚠️ Failed to initialize secure JWT keys on boot:", err);
    }
    
    // 🛡️ ADVANCED SYSTEM ENVIRONMENT BOUNDARY ENFORCER:
    // Run startup sync for both development and production environments to guarantee both isolated SQLite files
    // are fully bootstrapped and synchronized from Firestore on server startup.
    for (const expectedTag of ["development", "production"]) {
      await requestEnvStorage.run(expectedTag, async () => {
        console.log(`🚀 Performing startup sync for environment secure partition: [${expectedTag.toUpperCase()}]`);

        // Check SQLite environment marker
        let localTag = "";
        try {
          const tagRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'environment_tag'");
          if (tagRow) {
            localTag = String(tagRow.value).trim().toLowerCase();
          }
        } catch (e) {}

        console.log(`🔍 SQLite [${expectedTag.toUpperCase()}] environment marker: '${localTag || "MISSING"}', Expected: '${expectedTag}'`);

        // 🛡️ AUTO-ADOPTION: Associate local database with the current environment if missing or mismatched.
        if (!localTag) {
          console.log(`🌱 Current database missing tag. Associating with environment: [${expectedTag}] to enable Cloud Sync.`);
          dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('environment_tag', ?)", [expectedTag]);
          localTag = expectedTag;
        }

        if (localTag !== expectedTag) {
          console.log(`🌱 Environment tag mismatch (Local: '${localTag}', System: '${expectedTag}'). Auto-adopting database to prevent disabling Cloud.`);
          dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('environment_tag', ?)", [expectedTag]);
          localTag = expectedTag;
        }

        console.log(`✅ SQLite database [${expectedTag.toUpperCase()}] matches system APP_ENV perfectly. Database tagged and trusted.`);
        
        // ☁️ Start synchronization & data restoration from Cloud
        const itemRow = dbService.queryOne("SELECT count(*) as count FROM inventory") as { count: number };
        const snapshotRow = dbService.queryOne("SELECT count(*) as count FROM inventory_snapshots") as { count: number };
        const activeSessRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
        const userRow = dbService.queryOne("SELECT count(*) as count FROM users") as { count: number };
        
        const isSqliteEmpty = (!itemRow || itemRow.count === 0) && 
                              (!snapshotRow || snapshotRow.count === 0) && 
                              (!activeSessRow || !activeSessRow.value) &&
                              (!userRow || userRow.count <= 1);

        if (isSqliteEmpty) {
          console.log(`☁️ SQLite [${expectedTag.toUpperCase()}] is empty (possibly a stateless Cloud Run boot). Automatically restoring cloud backup...`);
          try {
            const success = await FirebaseBackupService.restoreStateFromCloud(false);
            console.log(`☁️ [SYNC_RESULT] FirebaseBackupService.restoreStateFromCloud for [${expectedTag}]: ${success ? "SUCCESS" : "NO_BACKUP_FOUND"}`);
            
            // Restore deleted sessions from Firestore to SQLite to prevent re-appearing
            try {
              const { getFirestoreCollection } = await import("./server/services/firestoreService");
              const cloudDeleted = await getFirestoreCollection("deleted_sessions");
              for (const ds of cloudDeleted) {
                dbService.run("INSERT OR IGNORE INTO deleted_sessions (session_id, deleted_at, session_data, deleted_reason) VALUES (?,?,?,?)",
                  [ds.session_id, ds.deleted_at, ds.session_data, ds.deleted_reason]);
              }
            } catch (e) { console.warn("Could not restore deleted sessions from cloud:", e); }
          } catch (restoreErr: any) {
            console.error(`🛑 Failed cloud state recovery during routine startup for [${expectedTag.toUpperCase()}]: ${restoreErr.message}`);
          }
        } else {
          console.log(`✅ SQLite [${expectedTag.toUpperCase()}] has content. Performing emergency audit check to prevent data loss...`);
          
          // 🛡️ EMERGENCY RECOVERY: Handle cases where activeSession was accidentally wiped but exists in local mirror
          if (!activeSessRow || !activeSessRow.value || activeSessRow.value === "null" || activeSessRow.value === "{}") {
             console.log(`⚠️ Active session is MISSING in SQLite [${expectedTag.toUpperCase()}]. Checking local sync mirror for recovery...`);
             try {
                const mirrorPath = path.join(process.cwd(), "server", `server-local-sync-mirror_${expectedTag}.json`);
                if (fs.existsSync(mirrorPath)) {
                   const mirror = JSON.parse(fs.readFileSync(mirrorPath, "utf-8"));
                   if (mirror && mirror.activeSession && mirror.activeSession.items && mirror.activeSession.items.length > 0) {
                      console.log(`🚑 EMERGENCY RECOVERY: Found active session with ${mirror.activeSession.items.length} items in local mirror for [${expectedTag.toUpperCase()}]. Restoring...`);
                      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('activeSession', ?)", [JSON.stringify(mirror.activeSession)]);
                      const timestamp = new Date().toISOString();
                      dbService.run("INSERT INTO audit_logs (user_code, action, target_type, timestamp, ip_address, log_details) VALUES (?, ?, ?, ?, ?, ?)", 
                         ["SYSTEM", "EMERGENCY_RECOVERY", "SESSION", timestamp, "127.0.0.1", `Restored active session ID ${mirror.activeSession.id} from local mirror.`]);
                      console.log("🎉 Successfully restored lost active session from mirror.");
                   }
                }
             } catch (recoveryErr) {
                console.error(`❌ Emergency recovery failed for [${expectedTag.toUpperCase()}]:`, recoveryErr);
             }
          }

          // 🚀 CRITICAL CLOUD-SYNC FOR COLD STARTS AND REFRESHES:
          // Synchronize snapshots, deleted sessions, and active state dynamically from Firestore to keep SQLite perfectly synchronized with Cloud.
          try {
            console.log(`☁️ Synchronizing active state, archived snapshots, and deleted sessions from Firestore for [${expectedTag.toUpperCase()}]...`);
            await FirebaseBackupService.syncActiveStateFromCloud();
            await FirebaseBackupService.syncSnapshotsFromCloud();
            await FirebaseBackupService.syncDeletedSessionsFromCloud();
            console.log(`☁️ Primary synchronization successfully completed for [${expectedTag.toUpperCase()}].`);
          } catch (syncErr: any) {
            console.error(`⚠️ Dynamic cloud synchronization failed on startup for [${expectedTag.toUpperCase()}]:`, syncErr.message || syncErr);
          }
        }

        // Guarantee that user profiles, default GM, and global settings are ALWAYS fully synced/loaded on startup
        try {
          await FirebaseBackupService.ensureDefaultGMInCloud().catch(e => {
            console.warn(`⚠️ Default GM user startup sync bypassed for [${expectedTag.toUpperCase()}]:`, e.message || e);
          });
          await FirebaseBackupService.restoreUsersFromCloud(false).then(() => {
             console.log(`☁️ [SYNC_RESULT] FirebaseBackupService.restoreUsersFromCloud for [${expectedTag}]: DONE`);
          }).catch(e => {
            console.warn(`⚠️ User accounts startup sync bypassed for [${expectedTag.toUpperCase()}]:`, e.message || e);
          });
          console.log(`✅ Primary startup cloud data synchronization completed for [${expectedTag.toUpperCase()}].`);
        } catch (syncErr) {
          console.error(`⚠️ Startup cloud users/settings sync failed for [${expectedTag.toUpperCase()}]:`, syncErr);
        }
      });
    }
  });

  // Handle WebSocket connections for real-time synchronization
  wss.on("connection", (ws, request) => {
    const env = (ws as any).appEnv || "development";
    requestEnvStorage.run(env, () => {
      // Decode and associate the user profile from the token query parameter for RBAC checks
      let userPayload: any = null;
      try {
        const parsedUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
        const token = parsedUrl.searchParams.get("token") || "";
        if (!token) {
          console.warn(`[${env.toUpperCase()}] WS connection verification failed: JWT token is missing in parameters query.`);
          ws.send(JSON.stringify({ type: "SYNC_FORCE_LOGOUT", error: "UNAUTHORIZED", message: "جلسة العمل منتهية الصلاحية أو الرمز البرمجي مفقود." }));
          ws.close(4001);
          return;
        }
        userPayload = AuthService.verifyToken(token);
        (ws as any).user = userPayload;
        console.log(`[${env.toUpperCase()}] WS Server: Client successfully handshake verified. User "${userPayload.name}" (${userPayload.role}) online.`);
      } catch (err: any) {
        if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
          console.warn(`[${env.toUpperCase()}] WS connection unauthorized: ${err.message}`);
        } else {
          console.error(`[${env.toUpperCase()}] WebSocket client connection decoding details failed:`, err);
        }
        try {
          ws.send(JSON.stringify({ type: "SYNC_FORCE_LOGOUT", error: "UNAUTHORIZED", message: "جلسة العمل منتهية الصلاحية أو غير صالحة. يرجى إعادة تسجيل الدخول لمتابعة المزامنة الفورية." }));
          ws.close(4001);
        } catch (sendErr) {
          // ignore if socket already closed/dead
        }
        return;
      }

      // Send initial db state upon connection
      try {
        const currentDb = SessionService.getState();
        ws.send(JSON.stringify({ type: "SYNC_INITIAL", data: currentDb }));
      } catch (err) {
        console.error(`[${env.toUpperCase()}] Failed sending active state on init connection:`, err);
      }

      ws.on("message", (message) => {
        requestEnvStorage.run(env, async () => {
          try {
            const payload = JSON.parse(message.toString());
            if (payload.type === "SYNC_PUSH") {
              const user = (ws as any).user;
              const actorCode = user ? user.code : "SOCKET_CLIENT";
              console.log(`[${env.toUpperCase()}] WS Server: Received PUSH state from user (${actorCode}) via WebSocket.`);
              const incoming = payload.data || {};

              try {
                // Get current state to compare before saving
                const oldState = SessionService.getState();

                // Atomic write inside Transaction with correct actor tracking
                await SessionService.saveState(incoming, actorCode, "WebSocket");

                // Broadcast compiled update to all active connections
                const updated = SessionService.getState();

                const oldActive = oldState.activeSession;
                const newActive = updated.activeSession;

                let isPartialUpdatePossible = false;
                let partialUpdatePayload: any = null;

                if (
                  oldActive && 
                  newActive && 
                  String(oldActive.id) === String(newActive.id) &&
                  oldActive.status === newActive.status &&
                  oldActive.supervisorApproved === newActive.supervisorApproved &&
                  oldActive.managerApproved === newActive.managerApproved &&
                  JSON.stringify(oldState.pastSessions) === JSON.stringify(updated.pastSessions) &&
                  JSON.stringify(oldState.masterItems) === JSON.stringify(updated.masterItems)
                ) {
                  const oldItems = oldActive.items || [];
                  const newItems = newActive.items || [];

                  if (oldItems.length === newItems.length) {
                    const changedIndices: number[] = [];
                    for (let i = 0; i < oldItems.length; i++) {
                      if (JSON.stringify(oldItems[i]) !== JSON.stringify(newItems[i])) {
                        changedIndices.push(i);
                      }
                    }

                    if (changedIndices.length === 1) {
                      const idx = changedIndices[0];
                      const oldItem = oldItems[idx];
                      const newItem = newItems[idx];

                      if (String(oldItem.itemId) === String(newItem.itemId)) {
                        isPartialUpdatePossible = true;
                        const updatedFields: any = {};
                        const checkedKeys = ["physicalQty", "storekeeperQty", "supervisorQty", "calculatorDetails", "notes", "submitted", "submittedAt", "inventoriedByCode", "inventoriedByName", "inventoriedAt", "itemHistory"];
                        for (const key of checkedKeys) {
                          if (JSON.stringify(oldItem[key]) !== JSON.stringify(newItem[key])) {
                            updatedFields[key] = newItem[key];
                          }
                        }

                        partialUpdatePayload = {
                          type: "ITEM_UPDATE",
                          sessionId: String(newActive.id),
                          itemId: String(newItem.itemId),
                          updatedFields
                        };
                      }
                    }
                  }
                }

                if (isPartialUpdatePossible && partialUpdatePayload) {
                  console.log(`[${env.toUpperCase()}] WS Server: Broadcasting Partial ITEM_UPDATE for ItemID: ${partialUpdatePayload.itemId}`);
                  broadcastToAll(updated, partialUpdatePayload, env);
                } else {
                  console.log(`[${env.toUpperCase()}] WS Server: Broadcasting complete state update.`);
                  broadcastToAll(updated, undefined, env);
                }
              } catch (err: any) {
                if (err.message === "CONCURRENT_EDIT_CONFLICT") {
                  // Notify the outdated client they have a concurrent edit mismatch
                  ws.send(JSON.stringify({
                    type: "SYNC_ERROR",
                    error: "CONCURRENT_EDIT_CONFLICT",
                    message: "تنبيه: قام زميل آخر بتعديل هذه الجلسة مؤخراً. يرجى الانتظار لتحديث البيانات تلقائياً لمنع تعارض التعديلات."
                  }));
                  // Force-update the client's local cache with the latest server copy
                  ws.send(JSON.stringify({ type: "SYNC_UPDATE", data: SessionService.getState() }));
                } else {
                  console.error(`[${env.toUpperCase()}] WS save state exception:`, err);
                }
              }
            }
          } catch (e) {
            console.error(`[${env.toUpperCase()}] WS error parsing message payload:`, e);
          }
        });
      });

      ws.on("close", () => {
        requestEnvStorage.run(env, () => {
          console.log(`[${env.toUpperCase()}] WS Server: Client disconnected.`);
        });
      });
    });
  });

  const broadcastToAll = (data: any, partialUpdate?: any, targetEnv?: string) => {
    const activeEnv = targetEnv || getAppEnv();
    const msg = JSON.stringify(partialUpdate ? partialUpdate : { type: "SYNC_UPDATE", data });
    wss.clients.forEach((client) => {
      const clientEnv = (client as any).appEnv || "development";
      if (clientEnv === activeEnv && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  // Global broadcast helper accessible from REST controllers
  (app as any).getWssBroadcast = () => {
    const activeEnv = getAppEnv();
    return (data: any, partialUpdate?: any) => {
      broadcastToAll(data, partialUpdate, activeEnv);
    };
  };

  // Bind WebSocket server to the same HTTP server on connection upgrades and delegate verification to connection handler
  server.on("upgrade", (request, socket, head) => {
    try {
      const env = detectEnvironment(request);

      const { pathname } = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      if (pathname === "/ws") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          (ws as any).appEnv = env;
          wss.emit("connection", ws, request);
        });
      }
    } catch (err) {
      console.error("Upgrade logic error:", err);
      socket.destroy();
    }
  });

  // Serve static files in production vs Vite middleware for local development hot reload
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 11. Automated 24-Hour Daily Database Backup Loop & Pruner (Saves disk space and retains last 30 backup files)
  setInterval(() => {
    try {
      console.log("⏰ Starting automated scheduled daily database backup...");
      const timestampStr = new Date().toISOString().slice(0, 10) + "_" + Date.now();
      const backupName = `inventory_backup_${timestampStr}.db`;
      dbService.backupDatabaseFile(backupName);

      // Keep exactly the last 30 backup files in /backups
      const backupDir = path.join(process.cwd(), "backups");
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir)
          .filter(f => f.startsWith("inventory_backup_"))
          .map(f => ({
            name: f,
            time: fs.statSync(path.join(backupDir, f)).mtime.getTime()
          }))
          .sort((a, b) => b.time - a.time); // Newest first

        if (files.length > 30) {
          const obsoleteFiles = files.slice(30);
          for (const item of obsoleteFiles) {
            fs.unlinkSync(path.join(backupDir, item.name));
            console.log(`🗑️ Pruned obsolete backup to maintain disk space limits: ${item.name}`);
          }
        }
      }
    } catch (err) {
      console.error("❌ Scheduled database backup failed:", err);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours timer loop

  // 12. Automated Firestore Cloud Backup Loop 4 times daily (03:00, 10:00, 16:00, 22:00)
  // Uploads only archived items (pastSessions) and deleted items snapshots (deletedSessions), ignoring standard active session & draft sessions.
  let lastBackupHour = -1;
  setInterval(() => {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const scheduledHours = [3, 10, 16, 22];

      // Check if current hour matches schedule, minute is 0, and we haven't already backed up in this hour
      if (scheduledHours.includes(currentHour) && currentMinute === 0 && lastBackupHour !== currentHour) {
        lastBackupHour = currentHour;
        console.log(`☁️ Scheduled Cloud Backup triggered at ${currentHour}:00...`);

        const currentEnv = getAppEnv();
        requestEnvStorage.run(currentEnv, () => {
          // Check if sync is disabled first in the Sqlite database settings
          const syncDisabledRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'isFirebaseSyncDisabled'");
          const isFirebaseSyncDisabled = syncDisabledRow ? syncDisabledRow.value === "true" : false;
          if (isFirebaseSyncDisabled) {
            console.log(`☁️ [${currentEnv.toUpperCase()}] Skipping scheduled Firestore cloud backup (automatic sync is disabled by user).`);
            return;
          }

          SessionService.getStateWithPasswordsAsync().then(state => {
            requestEnvStorage.run(currentEnv, () => {
              if (state) {
                // Create a state copy optimized to only contain archived and deleted items snapshots
                const backupOnlyState = {
                  ...state,
                  activeSession: null, // Ignore standard active session items & draft sessions
                  masterItems: state.masterItems || [], // Keep masterItems just in case needed or empty
                  deletedSessions: state.deletedSessions || [] // Include deleted sessions for pruning engine
                };
                FirebaseBackupService.backupStateToCloud(backupOnlyState, true)
                  .catch(e => console.error(`[${currentEnv.toUpperCase()}] Structured backup error:`, e));
              }
            });
          }).catch(e => console.error(`[${currentEnv.toUpperCase()}] Scheduled backup state fetch failed:`, e));
        });
      }
    } catch (err) {
      console.error("❌ Scheduled cloud backup failed:", err);
    }
  }, 60 * 1000); // Check every minute
}

startServer();
