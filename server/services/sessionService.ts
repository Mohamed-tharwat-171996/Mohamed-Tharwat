import { dbService } from "../database/dbService";
import { AuditService } from "./auditService";
import { FirebaseBackupService } from "./firebaseBackupService";
import { getFirestoreApiDisabled, deleteFirestoreDoc, setFirestoreDoc, getAppEnv, requestEnvStorage } from "./firestoreService";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

function mergeStorekeeperModifications(existing: any[] | undefined, incoming: any[] | undefined): any[] {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  
  const mergedMap = new Map<string, any>();
  
  existingList.forEach((mod: any) => {
    if (!mod) return;
    const key = `${mod.modifiedBy || ''}_${mod.modifiedAt || ''}_${mod.oldQty}_${mod.newQty}`;
    mergedMap.set(key, mod);
  });
  
  incomingList.forEach((mod: any) => {
    if (!mod) return;
    const key = `${mod.modifiedBy || ''}_${mod.modifiedAt || ''}_${mod.oldQty}_${mod.newQty}`;
    mergedMap.set(key, mod);
  });
  
  return Array.from(mergedMap.values()).sort((a, b) => {
    const timeA = new Date(a.modifiedAt || 0).getTime();
    const timeB = new Date(b.modifiedAt || 0).getTime();
    return timeA - timeB;
  });
}

export class SessionService {
  private static cachedState: any = null;
  private static lastMasterTimestamp: number = 0;
  private static lastActiveSessionTimestamp: number = 0;
  private static lastPastSessionsTimestamp: number = 0;
  private static lastDeletedSessionsTimestamp: number = 0;

  public static getState() {
    const timestamps = dbService.query("SELECT key, value FROM settings WHERE key IN ('lastUpdatedMaster', 'lastUpdatedActiveSession', 'lastUpdatedPastSessions', 'lastUpdatedDeletedSessions')");
    const tsMap = new Map(timestamps.map(t => [t.key, Number(t.value || 0)]));
    
    const currentMasterTs = tsMap.get('lastUpdatedMaster') || 0;
    const currentActiveTs = tsMap.get('lastUpdatedActiveSession') || 0;
    const currentPastTs = tsMap.get('lastUpdatedPastSessions') || 0;
    const currentDeletedTs = tsMap.get('lastUpdatedDeletedSessions') || 0;

    if (this.cachedState && 
        this.lastMasterTimestamp === currentMasterTs &&
        this.lastActiveSessionTimestamp === currentActiveTs &&
        this.lastPastSessionsTimestamp === currentPastTs &&
        this.lastDeletedSessionsTimestamp === currentDeletedTs) {
      return this.cachedState;
    }

    this.cachedState = dbService.transaction(() => {
      // 2. Load inventory master catalog items
      const dbItems = dbService.query("SELECT * FROM inventory ORDER BY sort_order ASC");
      const masterItems = dbItems.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        bookQty: i.bookQty,
        unit: i.unit,
        previousDiff: i.previousDiff,
      }));

      // 3. Load active session metadata and detail snapshot
      const activeSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
      const activeSession = activeSessSetting ? JSON.parse(activeSessSetting.value) : null;

      // 4. Load past sessions limit 200
      const dbSnapshots = dbService.query("SELECT snapshot_data FROM inventory_snapshots ORDER BY date DESC, created_at DESC LIMIT 200");
      const pastSessions = dbSnapshots.map((row) => {
        const data = JSON.parse(row.snapshot_data);
        if (data && data.session && typeof data.session === 'object') {
          const flat = { ...data.session, ...data };
          delete flat.session;
          return flat;
        }
        return data;
      });

      // 4.5 Load deleted sessions
      const dbDeleted = dbService.query("SELECT * FROM deleted_sessions ORDER BY deleted_at DESC LIMIT 50");
      const deletedSessions = dbDeleted.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        deletedAt: row.deleted_at,
        deletedReason: row.deleted_reason,
        sessionData: JSON.parse(row.session_data)
      }));

      // 6. Load isFirebaseSyncDisabled
      const syncDisabledRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'isFirebaseSyncDisabled'");
      const isFirebaseSyncDisabled = syncDisabledRow ? syncDisabledRow.value === "true" : false;

      return {
        masterItems,
        activeSession,
        pastSessions,
        deletedSessions,
        isFirebaseSyncDisabled,
        lastUpdated: Math.max(currentMasterTs, currentActiveTs, currentPastTs, currentDeletedTs),
      };
    });
    
    this.lastMasterTimestamp = currentMasterTs;
    this.lastActiveSessionTimestamp = currentActiveTs;
    this.lastPastSessionsTimestamp = currentPastTs;
    this.lastDeletedSessionsTimestamp = currentDeletedTs;
    return this.cachedState;
  }

  public static clearInventory() {
    dbService.transaction(() => {
      dbService.run("DELETE FROM inventory");
      dbService.run("DELETE FROM inventory_snapshots");
      dbService.run("DELETE FROM deleted_sessions");
      dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
      const now = Date.now();
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedMaster', ?)", [now.toString()]);
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedActiveSession', ?)", [now.toString()]);
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedPastSessions', ?)", [now.toString()]);
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedDeletedSessions', ?)", [now.toString()]);
    });
  }

  public static clearActiveSession() {
    dbService.transaction(() => {
      dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
      const now = Date.now();
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedActiveSession', ?)", [now.toString()]);
    });
  }

  // Save partial or complete application state updates with atomicity & strict server-side RBAC validation
  public static async saveState(incoming: any, actorCode?: string, clientIp?: string) {
    let oldSnapshotsCount = 0;
    try {
      const countRes = dbService.queryOne("SELECT count(*) as count FROM inventory_snapshots") as { count: number };
      if (countRes) {
        oldSnapshotsCount = countRes.count;
      }
    } catch (e) {}

    let newSnapshotAdded = false;
    let snapshotDeleted = false;

    const pendingCloudDeletes: { sessionId: string; stubData: string; deletedReason: string | null }[] = [];

    // Try to fetch real session data from Firestore before creating a stub
    let realSessionData: any = null;
    if (incoming.deletedPastSessionId !== undefined) {
      const deleteIdStr = String(incoming.deletedPastSessionId);
      const snap = dbService.queryOne("SELECT * FROM inventory_snapshots WHERE session_id = ?", [deleteIdStr]);
      if (!snap) {
        try {
          const { getFirestoreDoc } = await import("./firestoreService");
          realSessionData = await getFirestoreDoc("inventory_snapshots", deleteIdStr);
        } catch (fsErr) {
          console.warn("Could not fetch from Firestore for delete stub:", fsErr);
        }
      }
    }

    const success = dbService.transaction(() => {
      // Load current actor's details to enforce secure Role-Based Access Control using LOWER(code) for case-insensitive matching
      const actorRow = actorCode ? dbService.queryOne("SELECT role FROM users WHERE LOWER(code) = LOWER(?)", [actorCode]) : null;
      const actorRole = actorRow ? actorRow.role : "storekeeper"; // Safeguard: fallback to safest role

      let currentActive: any = null;
      try {
        const activeSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
        if (activeSessSetting) {
          currentActive = JSON.parse(activeSessSetting.value);
        }
      } catch (err) {
        console.error("Error loading activeSession at transaction start:", err);
      }

      // Enforce zero-trust restrictions on state mutations based on roles (Admins and Managers can make state mutations)
      if (actorRole !== "system_admin" && actorRole !== "program_manager" && actorRole !== "general_manager") {
        // 1. Prevent non-managers from editing the master product catalog
        if (incoming.masterItems !== undefined) {
          delete incoming.masterItems;
        }
        // 2. Prevent non-managers from managing precoded or registered system users
        if (incoming.precodedUsers !== undefined) {
          delete incoming.precodedUsers;
        }
        if (incoming.registeredUsers !== undefined) {
          delete incoming.registeredUsers;
        }
        // 3. Prevent non-managers/supervisors from editing or deleting historical sessions
        if (actorRole !== "warehouse_supervisor" && actorRole !== "supervisor" && actorRole !== "stores_manager") {
          if (incoming.pastSessions !== undefined) {
            delete incoming.pastSessions;
          }
        }
      }

      // 1. Process Master catalog items (Admins/Managers only)
      if (incoming.masterItems !== undefined) {
        // Load existing database items to match and preserve any fields/records safely without forcing sorting scrambling
        const dbItems = dbService.query("SELECT * FROM inventory ORDER BY sort_order ASC");
        const dbItemsMap = new Map<string, any>();
        dbItems.forEach((i) => dbItemsMap.set(String(i.id), i));

        const finalItemsToSave = incoming.masterItems.map((incomingItem: any) => {
          const itemId = String(incomingItem.id || incomingItem.itemId);
          const dbItem = dbItemsMap.get(itemId);
          return {
            id: itemId,
            name: incomingItem.name || incomingItem.itemName || (dbItem ? dbItem.name : ""),
            category: incomingItem.category || (dbItem ? dbItem.category : "عام"),
            bookQty: incomingItem.bookQty !== undefined ? Number(incomingItem.bookQty) : (dbItem ? dbItem.bookQty : 0),
            unit: incomingItem.unit || (dbItem ? dbItem.unit : "كجم"),
            previousDiff: incomingItem.previousDiff !== undefined ? Number(incomingItem.previousDiff) : (dbItem ? dbItem.previousDiff : 0),
          };
        });

        // Safe Fallback: Append any database items that were NOT part of incoming.masterItems to the end of the list
        const incomingIds = new Set(incoming.masterItems.map((i: any) => String(i.id || i.itemId)));
        dbItems.forEach((existing) => {
          const idStr = String(existing.id);
          if (!incomingIds.has(idStr)) {
            finalItemsToSave.push({
              id: idStr,
              name: existing.name,
              category: existing.category || "عام",
              bookQty: existing.bookQty !== undefined ? Number(existing.bookQty) : 0,
              unit: existing.unit || "كجم",
              previousDiff: existing.previousDiff !== undefined ? Number(existing.previousDiff) : 0,
            });
          }
        });

        // Wipe the database catalog table and insert the resolved final list synchronously
        dbService.run("DELETE FROM inventory"); // Wipe to reload atomic list safely
        const insertItem = dbService.run.bind(dbService, `
          INSERT INTO inventory (id, name, category, bookQty, unit, previousDiff, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        let insIdx = 0;
        for (const item of finalItemsToSave) {
          insertItem([
            item.id,
            item.name,
            item.category || "عام",
            Number(item.bookQty) || 0,
            item.unit || "كجم",
            Number(item.previousDiff) || 0,
            insIdx++,
          ]);
        }

        // Update incoming.masterItems array so that we can distribute this exact pristine-ordered copy to all users
        incoming.masterItems = finalItemsToSave;
        dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedMaster', ?)", [Date.now().toString()]);

        AuditService.log(
          actorCode || "SYSTEM",
          "تعديل الجرد",
          `تم تعديل أو استيراد دليل أصناف الكتالوج وتحديث الكميات الدفترية لـ ${finalItemsToSave.length} صنف (مع الحفاظ الكامل على ترتيب الرفع الأصلي ومنع ميله أو بعثرته).`,
          clientIp
        );
      }

      // 2. Clear or update active session
      if (incoming.activeSession !== undefined) {
        // 🛡️ REJECTION OF ARCHIVED SESSION RESURRECTION:
        // If the incoming activeSession payload has an ID that is already archived in inventory_snapshots, 
        // reject it and convert it to null to prevent overwriting the archived state.
        if (incoming.activeSession !== null) {
          try {
            const row = dbService.queryOne(
              "SELECT id FROM inventory_snapshots WHERE session_id = ?",
              [String(incoming.activeSession.id)]
            );
            if (row) {
              console.log(`🛡️ Blocked attempt to resurrect or rewrite archived session ID (${incoming.activeSession.id}). Converting payload activeSession to null.`);
              incoming.activeSession = null;
            }
          } catch (snapshotErr) {
            console.error("Error querying snapshot during resurrection shield check:", snapshotErr);
          }
        }

        // Check if previous non-empty session was deleted
        try {
          if (currentActive) {
              const isExplicitDelete = incoming.deletedActiveSessionId !== undefined && String(incoming.deletedActiveSessionId) === String(currentActive.id);
              if (isExplicitDelete) {
                // Save to deleted_sessions
                const activeStubData = JSON.stringify({ ...currentActive, type: "active", deletedReason: incoming.deletedReason || incoming.metadata?.deletedReason });
                dbService.run(`
                  INSERT INTO deleted_sessions (session_id, deleted_at, session_data, deleted_reason)
                  VALUES (?, ?, ?, ?)
                `, [
                  String(currentActive.id || "deleted_active"),
                  new Date().toISOString(),
                  activeStubData,
                  incoming.deletedReason || incoming.metadata?.deletedReason || null
                ]);
                pendingCloudDeletes.push({
                  sessionId: String(currentActive.id || "deleted_active"),
                  stubData: activeStubData,
                  deletedReason: incoming.deletedReason || incoming.metadata?.deletedReason || null
                });
                snapshotDeleted = true;
                dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedDeletedSessions', ?)", [Date.now().toString()]);
                AuditService.log(
                  actorCode || "SYSTEM",
                  "تعديل الجرد",
                  `تم نقل جلسة الجرد النشطة رقم (${currentActive.id}) إلى سلة المحذوفات مؤقتاً.`,
                  clientIp
                );
              }
            }
        } catch (err) {
          console.error("Error archiving deleted active session:", err);
        }

        // 🛡️ ZERO-TRASH ACTIVE SESSION RETENTION SHIELD:
        // Prevent any silent, accidental, or unauthorized deletion/wipeout of the active session.
        if (incoming.activeSession === null && currentActive !== null) {
          const isManagerOrAdmin = ["general_manager", "system_admin", "program_manager"].includes(actorRole);
          const isExplicitAction = incoming.deletedActiveSessionId !== undefined || 
                                   incoming.isExplicitDeleteOrArchive === true ||
                                   incoming.isExplicitAction === true;
          
          if (!isManagerOrAdmin || !isExplicitAction) {
            console.warn(`🛡️ Security Shield: Blocked deletion of activeSession by actor '${actorCode}' (${actorRole}). ExplicitDelete: ${isExplicitAction}. Restoring pre-existing session state.`);
            incoming.activeSession = currentActive; // Restore to preserve it
          }
        }

        if (incoming.activeSession === null) {
          dbService.run("DELETE FROM settings WHERE key = 'activeSession'");
        } else {
          if (incoming.activeSession.id) {
            const isArchived = dbService.queryOne("SELECT id FROM inventory_snapshots WHERE session_id = ?", [String(incoming.activeSession.id)]);
            if (isArchived) {
              throw new Error("لا يمكن تنشيط الجلسة لأنها مؤرشفة مسبقاً (لا يسمح بالعودة للحالة النشطة).");
            }
          }

          // Stamp with fresh server time
          incoming.activeSession.updatedAt = Date.now();

          // Intelligent Merging Logic and validation to prevent data loss between multiple users in parallel
          if (currentActive && Array.isArray(incoming.activeSession.items) && Array.isArray(currentActive.items)) {
            const isStorekeeper = actorRole === "storekeeper";
            const isSupervisor = actorRole === "supervisor" || actorRole === "warehouse_supervisor" || actorRole === "stores_manager";

            // Enforce: Prevent supervisor approval if any storekeeper's assigned item is unsubmitted
            if (isSupervisor && incoming.activeSession.supervisorApproved === true && !currentActive.supervisorApproved) {
              const unsubmittedItems = currentActive.items.filter((item: any) => item.assignedTo && !item.submitted);
              if (unsubmittedItems.length > 0) {
                throw new Error("SUPERVISOR_APPROVAL_BLOCKED_UNSUBMITTED");
              }
            }

            // 🛡️ REJECT STEWARD SUBMISSIONS ONCE APPROVED BY SUPERVISOR
            if (isStorekeeper && currentActive.supervisorApproved) {
              console.warn(`🛡️ Security Guard: Blocked late storekeeper '${actorCode}' edits to an already supervisor-approved active session.`);
              incoming.activeSession.items = currentActive.items;
            } else if (isStorekeeper || isSupervisor) {
              // Centralized Smart Merge of the items array (Radical Non-Overwriting Fix)
              incoming.activeSession.items = currentActive.items.map((existingItem: any) => {
                const incomingItem = incoming.activeSession.items.find((item: any) => String(item.itemId) === String(existingItem.itemId));
                if (!incomingItem) {
                  return existingItem; // Maintain database version if not present in payload
                }

                if (isStorekeeper) {
                  // Storekeeper can ONLY modify and submit their own assigned items
                  if (String(existingItem.assignedTo) === String(actorCode)) {
                    const mergedSK: any = {
                      ...existingItem,
                      physicalQty: incomingItem.physicalQty !== undefined ? incomingItem.physicalQty : existingItem.physicalQty,
                      storekeeperQty: incomingItem.storekeeperQty !== undefined ? incomingItem.storekeeperQty : existingItem.storekeeperQty,
                      storekeeperModifications: mergeStorekeeperModifications(existingItem.storekeeperModifications, incomingItem.storekeeperModifications),
                      recheckRequested: incomingItem.recheckRequested !== undefined ? incomingItem.recheckRequested : existingItem.recheckRequested,
                      calculatorDetails: incomingItem.calculatorDetails || existingItem.calculatorDetails, 
                      notes: incomingItem.notes || existingItem.notes,
                      submitted: incomingItem.submitted !== undefined ? incomingItem.submitted : existingItem.submitted,
                      submittedAt: incomingItem.submittedAt || existingItem.submittedAt,
                      inventoriedByCode: incomingItem.inventoriedByCode || existingItem.inventoriedByCode,
                      inventoriedByName: incomingItem.inventoriedByName || existingItem.inventoriedByName,
                      inventoriedAt: incomingItem.inventoriedAt || existingItem.inventoriedAt,
                      ...(incomingItem.itemHistory ? { itemHistory: incomingItem.itemHistory } : {})
                    };
                    return mergedSK;
                  }
                  return existingItem; // Maintain other storekeepers' data untouched
                }

                // If isSupervisor
                // Supervisor can reassing items, modify supervisorQty, lock, unlock, reject submissions
                const isPhysicalQtyChanged = incomingItem.physicalQty !== undefined && incomingItem.physicalQty !== existingItem.physicalQty;
                
                return {
                  ...existingItem,
                  assignedTo: incomingItem.assignedTo !== undefined ? incomingItem.assignedTo : existingItem.assignedTo,
                  supervisorQty: incomingItem.supervisorQty !== undefined ? incomingItem.supervisorQty : existingItem.supervisorQty,
                  physicalQty: incomingItem.physicalQty !== undefined ? incomingItem.physicalQty : existingItem.physicalQty,
                  storekeeperModifications: mergeStorekeeperModifications(existingItem.storekeeperModifications, incomingItem.storekeeperModifications),
                  recheckRequested: incomingItem.recheckRequested !== undefined ? incomingItem.recheckRequested : existingItem.recheckRequested,
                  calculatorDetails: incomingItem.calculatorDetails || existingItem.calculatorDetails, 
                  notes: incomingItem.notes || existingItem.notes,
                  submitted: incomingItem.submitted !== undefined ? incomingItem.submitted : existingItem.submitted,
                  submittedAt: incomingItem.submittedAt !== undefined ? incomingItem.submittedAt : existingItem.submittedAt,
                  ...(isPhysicalQtyChanged ? {
                    inventoriedByCode: incomingItem.inventoriedByCode,
                    inventoriedByName: incomingItem.inventoriedByName,
                    inventoriedAt: incomingItem.inventoriedAt,
                  } : {}),
                  ...(incomingItem.itemHistory ? { itemHistory: incomingItem.itemHistory } : {})
                };
              });
            } else {
              // Admins & managers (like program_manager) have full authority over adding/deleting/modifying items.
              // They determine the list of items in activeSession, but we can merge historical fields from
              // currentActive.items for items that still match by itemId.
              incoming.activeSession.items = incoming.activeSession.items.map((incomingItem: any) => {
                const existingItem = currentActive.items.find((item: any) => String(item.itemId) === String(incomingItem.itemId));
                if (existingItem) {
                  const mergedItem = {
                    ...existingItem,
                    ...incomingItem,
                    storekeeperQty: (existingItem.storekeeperQty !== undefined && existingItem.storekeeperQty !== null) ? existingItem.storekeeperQty : incomingItem.storekeeperQty,
                    storekeeperModifications: mergeStorekeeperModifications(existingItem.storekeeperModifications, incomingItem.storekeeperModifications)
                  };

                  // 🛡️ CRITICAL ADMIN STALENESS GATES:
                  // Prevent stale updates from clearing active audit records unless explicitly intentful.
                  // If incoming has null or undefined for count or supervisor parameters but existing has them, preserve existing!
                  if ((incomingItem.supervisorQty === null || incomingItem.supervisorQty === undefined) && existingItem.supervisorQty !== null && existingItem.supervisorQty !== undefined) {
                    mergedItem.supervisorQty = existingItem.supervisorQty;
                  }
                  if ((incomingItem.storekeeperQty === null || incomingItem.storekeeperQty === undefined) && existingItem.storekeeperQty !== null && existingItem.storekeeperQty !== undefined) {
                    mergedItem.storekeeperQty = existingItem.storekeeperQty;
                  }
                  if ((incomingItem.physicalQty === null || incomingItem.physicalQty === undefined) && existingItem.physicalQty !== null && existingItem.physicalQty !== undefined) {
                    mergedItem.physicalQty = existingItem.physicalQty;
                  }
                  if (!incomingItem.calculatorDetails && existingItem.calculatorDetails) {
                    mergedItem.calculatorDetails = existingItem.calculatorDetails;
                  }
                  if (!incomingItem.inventoriedByCode && existingItem.inventoriedByCode) {
                    mergedItem.inventoriedByCode = existingItem.inventoriedByCode;
                    mergedItem.inventoriedByName = existingItem.inventoriedByName;
                    mergedItem.inventoriedAt = existingItem.inventoriedAt;
                  }
                  return mergedItem;
                }
                return incomingItem;
              });
            }

            // Santize and protect general session parameters from invalid shortcuts
            if (isStorekeeper) {
              incoming.activeSession.supervisorApproved = currentActive.supervisorApproved;
              incoming.activeSession.supervisorApprovedAt = currentActive.supervisorApprovedAt;
              incoming.activeSession.supervisorApprovedBy = currentActive.supervisorApprovedBy;
              incoming.activeSession.managerApproved = currentActive.managerApproved;
              incoming.activeSession.archivedBy = currentActive.archivedBy;
              incoming.activeSession.isRestored = currentActive.isRestored;
              incoming.activeSession.id = currentActive.id;
              incoming.activeSession.date = currentActive.date;
              incoming.activeSession.notes = currentActive.notes;
            } else if (isSupervisor) {
              incoming.activeSession.managerApproved = currentActive.managerApproved;
              incoming.activeSession.archivedBy = currentActive.archivedBy;
              incoming.activeSession.isRestored = currentActive.isRestored;
              incoming.activeSession.id = currentActive.id;
              incoming.activeSession.date = currentActive.date;
            }

            // 🛡️ GLOBAL WORKFLOW STATUS LOCK (Zero-Trust):
            // Once approved on the server, prevent storekeepers or unauthorized roles from downgrading the approval flag back to false.
            // If the supervisor or manager explicitly downgrades or clears supervisorApproved, we respect it.
            if (currentActive.supervisorApproved && !isSupervisor && actorRole !== "general_manager" && actorRole !== "program_manager" && actorRole !== "system_admin") {
              incoming.activeSession.supervisorApproved = true;
              if (currentActive.supervisorApprovedAt) {
                incoming.activeSession.supervisorApprovedAt = currentActive.supervisorApprovedAt;
              }
              if (currentActive.supervisorApprovedBy) {
                incoming.activeSession.supervisorApprovedBy = currentActive.supervisorApprovedBy;
              }
            }
            if (currentActive.managerApproved) {
              incoming.activeSession.managerApproved = true;
            }
          }

          dbService.run(`
            INSERT OR REPLACE INTO settings (key, value)
            VALUES ('activeSession', ?)
          `, [JSON.stringify(incoming.activeSession)]);
          dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedActiveSession', ?)", [Date.now().toString()]);
        }
      }

      // Save isFirebaseSyncDisabled setting in SQLite if present
      if (incoming.isFirebaseSyncDisabled !== undefined) {
        dbService.run(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES ('isFirebaseSyncDisabled', ?)
        `, [String(incoming.isFirebaseSyncDisabled)]);
      }

      // 3. Process explicit past session deletion requests safely
      if (incoming.deletedPastSessionId !== undefined) {
        try {
          const deleteIdStr = String(incoming.deletedPastSessionId);
          const snap = dbService.queryOne("SELECT * FROM inventory_snapshots WHERE session_id = ?", [deleteIdStr]);
          if (snap) {
            const snapshotObj = JSON.parse(snap.snapshot_data);
            const stubData = JSON.stringify({ ...snapshotObj, type: "archived", deletedReason: incoming.deletedReason || incoming.metadata?.deletedReason });
            dbService.run(`
              INSERT INTO deleted_sessions (session_id, deleted_at, session_data, deleted_reason)
              VALUES (?, ?, ?, ?)
            `, [
              deleteIdStr,
              new Date().toISOString(),
              stubData,
              incoming.deletedReason || incoming.metadata?.deletedReason || null
            ]);
            try {
              (async () => {
                const { setFirestoreDoc } = await import("./firestoreService");
                await setFirestoreDoc("deleted_sessions", deleteIdStr, {
                  session_id: deleteIdStr, deleted_at: new Date().toISOString(),
                  session_data: stubData, deleted_reason: incoming.deletedReason || null
                });
              })();
            } catch (e) { console.warn("Could not save deleted session to Firestore:", e); }
            pendingCloudDeletes.push({
              sessionId: deleteIdStr,
              stubData: stubData,
              deletedReason: incoming.deletedReason || incoming.metadata?.deletedReason || null
            });
            dbService.run("DELETE FROM inventory_snapshots WHERE session_id = ?", [deleteIdStr]);
            snapshotDeleted = true;
            dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedPastSessions', ?)", [Date.now().toString()]);
          } else {
            // Stub insert for deleted_sessions when deleting something that wasn't in local SQLite cache
            // This is crucial to prevent the session from ever returning on subsequent Firestore background downloads
            const stubData = realSessionData ?
              JSON.stringify({ ...realSessionData, type: "archived", deletedReason: incoming.deletedReason }) :
              JSON.stringify({ id: deleteIdStr, type: "archived", items: [], notes: "Deleted from cloud sync" });

            dbService.run(`
              INSERT INTO deleted_sessions (session_id, deleted_at, session_data, deleted_reason)
              VALUES (?, ?, ?, ?)
            `, [
              deleteIdStr,
              new Date().toISOString(),
              stubData,
              incoming.deletedReason || incoming.metadata?.deletedReason || null
            ]);
            try {
              (async () => {
                const { setFirestoreDoc } = await import("./firestoreService");
                await setFirestoreDoc("deleted_sessions", deleteIdStr, {
                  session_id: deleteIdStr, deleted_at: new Date().toISOString(),
                  session_data: stubData, deleted_reason: incoming.deletedReason || null
                });
              })();
            } catch (e) { console.warn("Could not save deleted session to Firestore:", e); }
            pendingCloudDeletes.push({
              sessionId: deleteIdStr,
              stubData: stubData,
              deletedReason: incoming.deletedReason || incoming.metadata?.deletedReason || null
            });
            dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedDeletedSessions', ?)", [Date.now().toString()]);
          }

          // Explicitly prune from cloud to ensure it doesn't return on next sync
          if (!getFirestoreApiDisabled()) {
            deleteFirestoreDoc("inventory_snapshots", deleteIdStr).catch(e => 
              console.warn(`⚠️ Cloud delete failed for moved snapshot ${deleteIdStr}:`, e.message)
            );
          }

          AuditService.log(
            actorCode || "SYSTEM",
            "تعديل الجرد",
            `تم نقل جلسة الجرد المؤرشفة رقم (${deleteIdStr}) إلى سلة المحذوفات موقتاً.`,
            clientIp
          );
        } catch (err) {
          console.error("Error archiving deleted archived sessions:", err);
        }
      }

      // 4. Process incoming past session snapshots safely without accidental deletes
      if (incoming.pastSessions !== undefined) {
        try {
          // Find if there is any past session in incoming array
          const dbSnapIds = new Set(
            dbService.query("SELECT session_id FROM inventory_snapshots").map((r) => String(r.session_id))
          );
          const deletedSnapIds = new Set(
            dbService.query("SELECT session_id FROM deleted_sessions").map((r) => String(r.session_id))
          );

          for (const sess of incoming.pastSessions) {
            const sessId = String(sess.id);
            if (deletedSnapIds.has(sessId)) continue; // Never restore a session that was intentionally deleted

            if (!dbSnapIds.has(sessId)) {
              // New snapshot archiving detected!
              newSnapshotAdded = true;

              // 🛡️ SERVER-SIDE SNAPSHOT ENRICHMENT GATES (Anti-Staleness):
              // If we are archiving the currently active session, do NOT trust the client's version of the session data entirely (which may be stale).
              // Instead, reconstruct the final snapshot by taking the server's absolute correct and fully-submitted 'currentActive' session,
              // and stamp it as archived, preserving all storekeeper & supervisor counts perfectly!
              let finalSessToSave = sess;
              if (currentActive && String(currentActive.id) === sessId) {
                console.log(`🛡️ Server-Side Snapshot Enrichment: Reconstructing newly archived session id (${sessId}) from server's 'currentActive' to prevent stale manager client counts from writing.`);
                
                const enrichedItems = currentActive.items.map((item: any) => ({
                  ...item,
                  managerQty: item.physicalQty,
                  storekeeperQty: item.storekeeperQty !== undefined && item.storekeeperQty !== null ? item.storekeeperQty : item.physicalQty,
                  supervisorQty: item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : item.physicalQty
                }));

                finalSessToSave = {
                  ...currentActive,
                  items: enrichedItems,
                  isCompleted: true,
                  isArchived: true,
                  managerApproved: true,
                  date: sess.date || currentActive.date || new Date().toISOString().slice(0, 10),
                  notes: sess.notes || currentActive.notes || "",
                  archivedBy: sess.archivedBy || currentActive.archivedBy || actorCode || "UNKNOWN",
                  archivedAt: sess.archivedAt || new Date().toISOString(),
                };
              }

              dbService.run(`
                INSERT INTO inventory_snapshots (session_id, date, notes, created_at, snapshot_data)
                VALUES (?, ?, ?, ?, ?)
              `, [
                sessId,
                finalSessToSave.date || new Date().toISOString().slice(0, 10),
                finalSessToSave.notes || "",
                new Date().toISOString(),
                JSON.stringify(finalSessToSave),
              ]);
              dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedPastSessions', ?)", [Date.now().toString()]);

              AuditService.log(
                actorCode || "SYSTEM",
                "تعديل الجرد",
                `تم أرشفة وحفظ جلسة الجرد بتاريخ ${finalSessToSave.date || "غير معروف"} برقم: (${sessId}) وعنوان "${finalSessToSave.notes || 'بلا ملاحظات'}" بنجاح.`,
                clientIp
              );
            } else {
              // 🔄 UPDATE EXISTING ARCHIVE (Managers only):
              // If the session already exists, we update its snapshot data.
              // This is safe because only managers can send pastSessions in the payload due to RBAC checks above.
              dbService.run(`
                UPDATE inventory_snapshots 
                SET snapshot_data = ?, notes = ?, date = ?
                WHERE session_id = ?
              `, [
                JSON.stringify(sess),
                sess.notes || "",
                sess.date || new Date().toISOString().slice(0, 10),
                sessId
              ]);
              dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdatedPastSessions', ?)", [Date.now().toString()]);

              console.log(`🔄 Updated existing archived session ID (${sessId}) with fresh edits.`);
            }
          }
        } catch (err) {
          console.error("Error processing archived snapshots:", err);
        }

        // Automatic Snapshot Rotation: Retain active + last 30 snapshots. Limit total saved snapshots to 30.
        this.pruneSnapshots();
        this.pruneDeletedSessions();
      }

      // Update lastUpdated timestamp at the end of the transaction
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdated', ?)", [String(Date.now())]);

      return true;
    });

    if (success) {
      const forceCloud = (incoming.activeSession === null) || 
                         (incoming.deletedActiveSessionId !== undefined) || 
                         (incoming.deletedPastSessionId !== undefined);
      this.writeDurableCheckpoint(forceCloud);

      // Async save deleted sessions to Firestore
      for (const del of pendingCloudDeletes) {
        (async () => {
          try {
            const { setFirestoreDoc } = await import("./firestoreService");
            await setFirestoreDoc("deleted_sessions", del.sessionId, {
              session_id: del.sessionId,
              deleted_at: new Date().toISOString(),
              session_data: del.stubData,
              deleted_reason: del.deletedReason
            });
          } catch (e) {
            console.warn("Could not save deleted session to Firestore:", e);
          }
        })();
      }

      // 🛡️ ATOMIC ARCHIVING SHIELD is now managed exclusively by the client via explicit /api/backup 
      // calls after pushStateToServer succeeds. This prevents duplicate cloud backups and saves quota.
    }
    return success;
  }

  // Auto clean excessive snapshot logs, preserving exactly the top 30 history entries and deleting old ones from SQLite and Firestore
  private static pruneSnapshots() {
    try {
      const countRes = dbService.queryOne("SELECT count(*) as count FROM inventory_snapshots") as { count: number };
      if (countRes.count > 30) {
        const excess = countRes.count - 30;
        const oldestRows = dbService.query("SELECT id, session_id FROM inventory_snapshots ORDER BY date ASC, created_at ASC, id ASC LIMIT ?", [excess]);
        
        for (const row of oldestRows) {
          const sessId = String(row.session_id);
          dbService.run("DELETE FROM inventory_snapshots WHERE session_id = ?", [sessId]);
          
          if (!getFirestoreApiDisabled()) {
            deleteFirestoreDoc("inventory_snapshots", sessId).catch(e => {
              console.warn(`⚠️ Cloud delete failed for pruned snapshot ${sessId}:`, e.message);
            });
          }
        }
        console.log(`Pruned ${oldestRows.length} obsolete snapshots from SQLite and cloud.`);
      }
    } catch (err) {
      console.error("Pruning process exception:", err);
    }
  }

  // Keep deleted sessions for exactly 3 days only, and then permanently delete them from SQLite and Firestore
  public static pruneDeletedSessions() {
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const isoThreshold = threeDaysAgo.toISOString();
      
      const rowsToDelete = dbService.query("SELECT id, session_id FROM deleted_sessions WHERE deleted_at < ?", [isoThreshold]);
      if (rowsToDelete.length > 0) {
        const ids = rowsToDelete.map(r => r.id);
        
        if (!getFirestoreApiDisabled()) {
          for (const row of rowsToDelete) {
            const sid = String(row.session_id);
            // 🛡️ TRIPLE-STRETCH DELETION: Explicitly remove from all possible cloud collections immediately
            deleteFirestoreDoc("deleted_sessions", sid).catch(e => {
              console.warn(`⚠️ Cloud delete failed for pruned deleted session ${sid}:`, e.message);
            });
            deleteFirestoreDoc("deleted_sessions", String(row.id)).catch(() => {});
            deleteFirestoreDoc("inventory_snapshots", sid).catch(() => {});
            
            // Tombstone in Firestore
            setFirestoreDoc("permanent_tombstones", sid, {
              session_id: sid,
              tombstoned_at: new Date().toISOString()
            }).catch(() => {});
          }
        }
        
        // Add to local permanent_tombstones and delete from local SQLite
        dbService.transaction(() => {
          for (const row of rowsToDelete) {
            dbService.run("INSERT OR REPLACE INTO permanent_tombstones (session_id, tombstoned_at) VALUES (?, ?)", [
              row.session_id,
              new Date().toISOString()
            ]);
          }
          dbService.run(`DELETE FROM deleted_sessions WHERE id IN (${ids.join(",")})`);
        });
        
        console.log(`Pruned ${ids.length} expired deleted sessions (older than 3 days) from SQLite and cloud.`);
      }
    } catch (err) {
      console.error("Error pruning deleted sessions:", err);
    }
  }

  // Restore snapshot data from DB ID
  public static restoreSnapshot(id: number, actorCode: string, clientIp?: string) {
    const snapshot = dbService.transaction(() => {
      const row = dbService.queryOne("SELECT snapshot_data FROM inventory_snapshots WHERE id = ?", [id]);
      if (!row) {
        throw new Error("لم يتم العثور على النسخة المحددة.");
      }

      const snapshot = JSON.parse(row.snapshot_data);
      // Restore this session as the activeSession
      dbService.run(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('activeSession', ?)
      `, [row.snapshot_data]);

      // Update lastUpdated timestamp at the end of the transaction
      dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdated', ?)", [String(Date.now())]);

      AuditService.log(
        actorCode,
        "استعادة النسخ الاحتياطية",
        `تم استعادة نسخة الجرد المؤرشفة للجلسة رقم (${snapshot.id}) المؤرخة بـ ${snapshot.date} بنجاح.`,
        clientIp
      );

      return snapshot;
    });

    if (snapshot) {
      this.writeDurableCheckpoint();
    }
    return snapshot;
  }

  // Async wrapper for cloud syncing to prevent blocking the main request thread
  public static async getStateWithPasswordsAsync() {
    try {
      return this.getStateWithPasswords();
    } catch (err) {
      console.error("⚠️ Background state capture failed:", err);
      return null;
    }
  }

  private static cachedWithPasswords: any = null;
  private static lastCachedPasswordsTimestamp: number = 0;

  // ✅ New helper: State backup including password hashes for secure Firestore reconstruction
  public static getStateWithPasswords() {
    const lastUpdatedRow = dbService.queryOne("SELECT value FROM settings WHERE key = 'lastUpdated'");
    const currentLastUpdated = lastUpdatedRow ? Number(lastUpdatedRow.value) : 0;

    if (this.cachedWithPasswords && this.lastCachedPasswordsTimestamp === currentLastUpdated) {
      return this.cachedWithPasswords;
    }

    this.cachedWithPasswords = dbService.transaction(() => {
      const dbItems = dbService.query("SELECT * FROM inventory ORDER BY sort_order ASC");
      const masterItems = dbItems.map((i: any) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        bookQty: i.bookQty,
        unit: i.unit,
        previousDiff: i.previousDiff,
      }));

      const activeSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
      const activeSession = activeSessSetting ? JSON.parse(activeSessSetting.value) : null;

      const dbSnapshots = dbService.query("SELECT snapshot_data FROM inventory_snapshots ORDER BY date DESC, created_at DESC LIMIT 200");
      const pastSessions = dbSnapshots.map((row: any) => {
        const data = JSON.parse(row.snapshot_data);
        if (data && data.session && typeof data.session === 'object') {
          const flat = { ...data.session, ...data };
          delete flat.session;
          return flat;
        }
        return data;
      });

      // 👥 Include registered users for independent cloud sync
      const registeredUsers = dbService.query("SELECT * FROM users");

      // 🗑️ Include deleted sessions
      const dbDeleted = dbService.query("SELECT * FROM deleted_sessions ORDER BY deleted_at DESC LIMIT 50");
      const deletedSessions = dbDeleted.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        deletedAt: row.deleted_at,
        deletedReason: row.deleted_reason,
        sessionData: JSON.parse(row.session_data)
      }));

      // 🛡️ Include permanent tombstones
      const dbTombstones = dbService.query("SELECT * FROM permanent_tombstones");
      const permanentTombstones = dbTombstones.map((row: any) => ({
        sessionId: row.session_id,
        tombstonedAt: row.tombstoned_at
      }));

      return {
        masterItems,
        activeSession,
        pastSessions,
        registeredUsers,
        deletedSessions,
        permanentTombstones,
        lastUpdated: currentLastUpdated,
      };
    });

    this.lastCachedPasswordsTimestamp = currentLastUpdated;
    return this.cachedWithPasswords;
  }

  // Write a backup of the current database state (Legacy fallback removed)
  public static writeDurableCheckpoint(forceCloud = false) {
    const env = getAppEnv();
    SessionService.getStateWithPasswordsAsync().then(state => {
      requestEnvStorage.run(env, () => {
        if (state) {
          let lastSuccess = 0;
          try {
            const row = dbService.queryOne("SELECT value FROM settings WHERE key = 'last_successful_backup_time'");
            if (row) {
              lastSuccess = Number(row.value);
            }
          } catch (e) {
            console.warn("⚠️ Failed reading last_successful_backup_time:", e);
          }

          const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in ms
          const timeElapsed = Date.now() - lastSuccess;

          let shouldForce = forceCloud;
          if (!state.activeSession) {
            // Check if local mirror still has an active session. If it does, we MUST force backup to clear it on cloud!
            try {
              const mirror = FirebaseBackupService.getLocalMirrorData();
              if (mirror && mirror.activeSession) {
                console.log("🛡️ DETECTED ACTIVE SESSION ENDED: Forcing cloud sync to clear active session in Firestore.");
                shouldForce = true;
              }
            } catch (e) {}
          }

          if (shouldForce || timeElapsed >= fifteenMinutes) {
            FirebaseBackupService.backupStateToCloud(state, shouldForce)
              .catch(e => console.warn("☁️ Checkpoint cloud sync skipped:", e?.message));
          } else {
            console.log(`☁️ Rate-limiting check: last successful backup was ${Math.round(timeElapsed / 1000)}s ago. Saving to server local mirror only.`);
            FirebaseBackupService.saveToLocalMirror(state);
          }
        }
      });
    }).catch(e => console.warn("⚠️ Checkpoint state capture failed:", e));
  }

  // Automated daily database backups (triggerable via API)
  public static triggerDatabaseBackup(actorCode: string, clientIp?: string) {
    const timestampStr = new Date().toISOString().slice(0, 10) + "_" + Date.now();
    const backupName = `inventory_backup_${timestampStr}.db`;
    dbService.backupDatabaseFile(backupName);
    AuditService.log(
      actorCode,
      "استعادة النسخ الاحتياطية",
      `تم إنشاء نسخة احتياطية كاملة وملف مضغوط لقاعدة البيانات باسم: ${backupName} بنجاح.`,
      clientIp
    );
    return backupName;
  }
}
