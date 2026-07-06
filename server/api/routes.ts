import express, { Response } from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { AuthService, AuthenticatedRequest } from "../auth/authService";
import { SessionService } from "../services/sessionService";
import { AuditService } from "../services/auditService";
import { dbService } from "../database/dbService";
import { FirebaseBackupService, getFirestoreDB, enableCloudBackup } from "../services/firebaseBackupService";
import { QuotaService } from "../services/quotaService";
import { COLLECTIONS, setFirestoreDoc, getFirestoreDoc, getFirestoreCollection, deleteFirestoreDoc, getFirestoreInstance, resolveCollectionName, getFirestoreApiDisabled, setFirestoreApiDisabled, reinitializeFirestore, getAppEnv, isFirestoreConfigured, UserResolver, checkFirestoreHealth } from "../services/firestoreService";

const router = express.Router();

// Helper to grab caller IP address safely
const getClientIp = (req: express.Request): string => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
  return Array.isArray(ip) ? ip[0] : String(ip);
};

// 1. Unauthenticated Login Endpoint
router.post("/auth/login", async (req, res) => {
  const { code, password } = req.body;
  if (!code || !password) {
    return res.status(400).json({ error: "الرجاء إدخال كود الحساب ورمز المرور." });
  }

  try {
    const { token, user } = await AuthService.login(code, password);
    AuditService.log(user.code, "تسجيل الدخول", `نجح تسجيل الدخول السريع للمستخدم: ${user.name}`, getClientIp(req));
    res.json({ token, user });
  } catch (err: any) {
    // Record login attempts failure securely inside local audit files with IP footprinting
    AuditService.log(
      String(code).trim(),
      "فشل تسجيل الدخول",
      `فشل محاولة تسجيل الدخول للمستخدم: ${err.message}`,
      getClientIp(req)
    );
    res.status(400).json({ error: err.message || "فشل تسجيل الدخول." });
  }
});

// 2. Unauthenticated Check Code details and Password verification for Activation flows
router.post("/auth/verify-code", async (req, res) => {
  const { code, password } = req.body;
  if (!code || !password) {
    return res.status(400).json({ error: "يرجى توفير كود الحساب وكلمة المرور للتحقق من ترميزك بالنظام." });
  }

  try {
    const row = await UserResolver.getUserByCode(String(code).trim().toLowerCase());

    if (!row) {
      return res.status(404).json({ error: "هذا الكود غير معرّف أو معتمد في النظام يرجى مراجعة إدارة البرنامج." });
    }

    const isActivatedVal = row.is_activated !== undefined ? row.is_activated : row.isActivated;
    if (isActivatedVal === 0 || isActivatedVal === false || isActivatedVal === null) {
      return res.status(400).json({ error: "هذا الحساب معطل (غير نشط). يرجى مراجعة مدير النظام لتنشيطه." });
    }

    const isMatch = bcrypt.compareSync(password, row.password);
    if (!isMatch) {
      return res.status(400).json({ error: "رمز المرور المدخل لا يتطابق مع كلمة المرور المعينة لك من المسئول!" });
    }

    const isPrecodedVal = row.is_precoded !== undefined ? row.is_precoded : row.isPrecoded;
    const isRegisteredVal = row.is_registered !== undefined ? row.is_registered : row.isRegistered;

    res.json({
      exists: true,
      isPrecoded: isPrecodedVal === 1 || isPrecodedVal === true,
      isRegistered: isRegisteredVal === 1 || isRegisteredVal === true,
      name: row.name,
      role: row.role,
      phone: row.phone || "",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل الاستعلام والتحقق من الرمز والاسم." });
  }
});

// 3. Complete Activation Registration Endpoint
router.post("/auth/activate", async (req, res) => {
  const { code, name, phone, password } = req.body;
  if (!code || !name || !password) {
    return res.status(400).json({ error: "الرجاء توفير البيانات الأساسية (الكود، الاسم، كلمات المرور) للتفعيل." });
  }

  // Verified password check (accepts any password of any size as requested)
  if (!AuthService.validatePasswordStrength(password)) {
    return res.status(400).json({
      error: "رمز المرور المدخل غير صالح. الرجاء إدخال كلمة مرور صحيحة."
    });
  }

  try {
    const row = await UserResolver.getUserByCode(String(code).trim().toLowerCase());

    if (!row) {
      throw new Error("هذا الكود غير متاح للتفعيل حالياً.");
    }

    const isActivatedVal = row.is_activated !== undefined ? row.is_activated : row.isActivated;
    if (isActivatedVal === 0 || isActivatedVal === false || isActivatedVal === null) {
      throw new Error("هذا الحساب معطل (غير نشط). يرجى مراجعة مدير النظام لتنشيطه.");
    }

    const newHashedPassword = bcrypt.hashSync(password.trim(), 10);
    const nowStamp = Date.now();

    // 🚀 Firestore-First write
    await UserResolver.saveUser(String(code).trim().toLowerCase(), {
      ...row,
      code: String(code).trim(),
      name: name.trim(),
      phone: phone ? phone.trim() : "",
      password: newHashedPassword, // hashed
      remember_me: 1,
      is_precoded: 1,
      is_registered: 1,
      is_activated: 1,
      updated_at: nowStamp
    });

    AuditService.log(
      String(code).trim(),
      "تفعيل الحساب",
      `تم تنشيط وتفعيل حساب المستخدم الجديد بنجاح في الفايرستور السحابي: ${name.trim()}`,
      getClientIp(req)
    );

    const { token, user } = await AuthService.login(code, password);
    
    res.json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل عملية تفعيل الحساب." });
  }
});

// 4. Read overall inventory state (with JWT Protection)
router.get("/data", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const state = SessionService.getState();
    const quotaData = await QuotaService.getGlobalQuota();
    
    res.json({
      status: "ok",
      data: state,
      isFirestoreQuotaExceeded: FirebaseBackupService.isFirestoreQuotaExceeded(),
      globalQuota: quotaData
    });
  } catch (err) {
    res.status(500).json({ error: "فشل استيراد بيانات الجرد وقاعدة البيانات." });
  }
});

// 5. GET All Users (Read-only, separated from app_state)
router.get("/users", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usersList = await UserResolver.getAllUsers();
    
    const precodedUsers: any[] = [];
    const registeredUsers: any[] = [];

    for (const u of usersList) {
      const isPrecodedVal = u.is_precoded !== undefined ? u.is_precoded : u.isPrecoded;
      const isRegisteredVal = u.is_registered !== undefined ? u.is_registered : u.isRegistered;
      const isActivatedVal = u.is_activated !== undefined ? u.is_activated : u.isActivated;

      const isPrecoded = (isPrecodedVal === 1 || isPrecodedVal === true);
      const isRegistered = (isRegisteredVal === 1 || isRegisteredVal === true);
      const isActivated = (isActivatedVal === 1 || isActivatedVal === true || isActivatedVal === undefined);

      const mappedUser = {
        code: u.code,
        name: u.name,
        phone: u.phone,
        role: u.role,
        rememberMe: u.remember_me === 1 || u.remember_me === true || u.rememberMe === true,
        isPrecoded,
        isRegistered,
        isActivated,
        is_precoded: isPrecoded,
        is_registered: isRegistered,
        is_activated: isActivated,
        updatedAt: u.updated_at || u.updatedAt || 0,
      };

      if (isPrecoded) {
        precodedUsers.push(mappedUser);
      }
      if (isRegistered || (!isPrecoded && !isRegistered)) {
        registeredUsers.push(mappedUser);
      }
    }
    
    res.json({
        status: "ok",
        precodedUsers,
        registeredUsers
    });
  } catch (err: any) {
    console.error("🛑 /api/users main error:", err.message || err);
    res.status(500).json({ error: "فشل استيراد قائمة المستخدمين المستقلة من الفايرستور السحابي." });
  }
});

// 5. Post system state update with token verification & dynamic logs
router.post("/data", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "UNKNOWN";
    const payload = req.body || {};

    // STRICTLY DROP USER MANAGEMENT PAYLOADS FROM GENERIC SYNC
    if (payload.registeredUsers) delete payload.registeredUsers;
    if (payload.precodedUsers) delete payload.precodedUsers;

    const stateToSave = {
      ...payload
    };

    const activeSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
    const currentActive = activeSessSetting ? JSON.parse(activeSessSetting.value) : null;

    SessionService.saveState(stateToSave, actor, getClientIp(req));

    const nextActiveSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
    const nextActive = nextActiveSessSetting ? JSON.parse(nextActiveSessSetting.value) : null;

    // Instant socket broadcast (Optimized with partial updates for individual item changes)
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      let isItemUpdateBroadcasted = false;
      if (currentActive && nextActive && String(currentActive.id) === String(nextActive.id) && Array.isArray(currentActive.items) && Array.isArray(nextActive.items)) {
        const changedItems: any[] = [];
        const oldItemsMap = new Map<string, any>();
        currentActive.items.forEach((item: any) => oldItemsMap.set(String(item.itemId), item));

        nextActive.items.forEach((item: any) => {
          const oldItem = oldItemsMap.get(String(item.itemId));
          if (!oldItem) return;
          
          const hasChanged = 
            item.physicalQty !== oldItem.physicalQty ||
            item.storekeeperQty !== oldItem.storekeeperQty ||
            item.supervisorQty !== oldItem.supervisorQty ||
            item.submitted !== oldItem.submitted ||
            item.notes !== oldItem.notes ||
            item.assignedTo !== oldItem.assignedTo;

          if (hasChanged) {
            changedItems.push(item);
          }
        });

        if (changedItems.length > 0 && changedItems.length <= 3) {
          for (const changedItem of changedItems) {
            broadcast(null, {
              type: "ITEM_UPDATE",
              sessionId: String(nextActive.id),
              itemId: String(changedItem.itemId),
              updatedFields: {
                physicalQty: changedItem.physicalQty,
                storekeeperQty: changedItem.storekeeperQty,
                supervisorQty: changedItem.supervisorQty,
                notes: changedItem.notes || "",
                submitted: changedItem.submitted,
                submittedAt: changedItem.submittedAt || null,
                assignedTo: changedItem.assignedTo || null,
                inventoriedByCode: changedItem.inventoriedByCode || null,
                inventoriedByName: changedItem.inventoriedByName || null,
                inventoriedAt: changedItem.inventoriedAt || null,
                itemHistory: changedItem.itemHistory || []
              }
            });
          }
          isItemUpdateBroadcasted = true;
          console.log(`📡 WebSocket partial sync: Pushed ${changedItems.length} partial ITEM_UPDATE events to active clients.`);
        }
      }

      if (!isItemUpdateBroadcasted) {
        // Fallback to full state broadcast for structural changes (e.g. archiving, deletion, creation)
        const fullState = SessionService.getState();
        broadcast(fullState);
        console.log("📡 WebSocket full sync: Pushed full SYNC_UPDATE to all active clients.");
      }
    }

    res.json({ status: "ok", lastUpdated: Date.now() });
  } catch (err: any) {
    if (err.message === "CONCURRENT_EDIT_CONFLICT") {
      return res.status(409).json({
        error: "CONCURRENT_EDIT_CONFLICT",
        message: "تنبيه: قام زميل آخر بتعديل هذه الجلسة مؤخراً. يرجى الانتظار لتحديث البيانات تلقائياً لمنع فقدان عملكما المتزامن."
      });
    }
    res.status(500).json({ error: err.message || "فشل مزامنة وحفظ البيانات بدقة." });
  }
});

// ADMIN: Get all users
router.get("/admin/users", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usersList = await UserResolver.getAllUsers();

    const mappedUsers = usersList.map(u => {
      const isPrecodedVal = u.is_precoded !== undefined ? u.is_precoded : u.isPrecoded;
      const isRegisteredVal = u.is_registered !== undefined ? u.is_registered : u.isRegistered;
      const isActivatedVal = u.is_activated !== undefined ? u.is_activated : u.isActivated;

      return {
        code: u.code,
        name: u.name,
        phone: u.phone || "",
        role: u.role,
        is_precoded: (isPrecodedVal === 1 || isPrecodedVal === true) ? 1 : 0,
        is_registered: (isRegisteredVal === 1 || isRegisteredVal === true) ? 1 : 0,
        is_activated: (isActivatedVal === 0 || isActivatedVal === false) ? 0 : 1
      };
    });

    res.json({ status: "ok", users: mappedUsers });
  } catch (err: any) {
    console.error("Failed to list users:", err);
    res.status(500).json({ error: "فشل استرجاع قائمة المستخدمين من السيرفر السحابي." });
  }
});

router.post("/admin/clear-active-session", AuthService.authenticateJWT, AuthService.requireRole(["system_admin", "super_admin", "general_manager", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "ADMIN";
    
    // 1. Clear locally
    SessionService.clearActiveSession();
    
    // 2. Clear in Cloud (sync current state with null activeSession)
    const state = SessionService.getStateWithPasswords();
    state.activeSession = null;
    await FirebaseBackupService.backupStateToCloud(state, true, true);
    
    dbService.logAction(actor, "حذف الجلسة النشطة", "تم حذف الجلسة النشطة من جميع الأماكن (SQLite و Firestore) بنجاح.", getClientIp(req));
    
    // Broadcast update
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      const fullState = SessionService.getState();
      broadcast(fullState);
    }
    
    res.json({ status: "ok", message: "تم حذف الجلسة النشطة بنجاح." });
  } catch (err: any) {
    console.error("Failed to clear active session:", err);
    res.status(500).json({ error: err.message || "فشل حذف الجلسة النشطة." });
  }
});

// ADMIN: Add/Upsert user safely
router.post("/admin/users", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  const { code, name, phone, role, password, isPrecoded, isRegistered, isActivated } = req.body;
  const actorRole = req.user?.role;
  const actorCode = req.user?.code || "sys";

  try {
    const codeStr = String(code).trim();
    const existing = await UserResolver.getUserByCode(codeStr.toLowerCase());
    
    // RBAC Protection: Only general_manager can touch other general_managers
    if (existing && existing.role === 'general_manager' && actorRole !== 'general_manager') {
      return res.status(403).json({ error: "لا يمتلك مسئول النظام صلاحية تعديل بيانات المدير العام." });
    }

    // NEW: Hard Protection for user code 18 (Special Administrative Account)
    if (codeStr === "18" && (role !== "general_manager" || isActivated === false)) {
       return res.status(403).json({ error: "لا يمكن تعديل الدور الوظيفي أو تعطيل الحساب الرئيسي للمدير العام (كود 18)." });
    }

    // Protection: system_admin cannot elevate someone to general_manager
    if (role === 'general_manager' && actorRole !== 'general_manager') {
      return res.status(403).json({ error: "لا يمكن تعيين دور 'المدير العام' إلا بواسطة مدير عام آخر." });
    }

    let securePass = existing ? existing.password : bcrypt.hashSync(password || "123456", 10);
    if (password && String(password).trim()) {
      const isAlreadyHashed = typeof password === "string" && 
        password.length === 60 && 
        (/^\$2[aybx]\$[0-9]{2}\$/).test(password);

      if (isAlreadyHashed) {
        securePass = password;
      } else {
        securePass = bcrypt.hashSync(String(password).trim(), 10);
      }
    }

    const nowStamp = Date.now();

    const updatedUserObj = {
      code: codeStr,
      name,
      phone: phone || "",
      role: role || (existing ? existing.role : "storekeeper"),
      password: securePass,
      remember_me: isPrecoded ? 1 : 0,
      is_precoded: isPrecoded ? 1 : 0,
      is_registered: isRegistered ? 1 : 0,
      is_activated: isActivated !== undefined ? (isActivated ? 1 : 0) : 1,
      updated_at: nowStamp
    };

    await UserResolver.saveUser(codeStr.toLowerCase(), updatedUserObj);

    if (existing) {
      dbService.logAction(actorCode, "تعديل مستخدم", `تم تعديل بيانات المستخدم في الفايرستور: ${codeStr} (${name})`, getClientIp(req));
    } else {
      dbService.logAction(actorCode, "إضافة مستخدم", `تم إضافة مستخدم جديد في الفايرستور: ${codeStr} (${name})`, getClientIp(req));
    }
    
    dbService.bumpLastUpdated();

    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("⚠️ Error in POST /api/admin/users:", err);
    res.status(500).json({ error: `فشل حفظ المستخدم في الفايرستور السحابي: ${err.message || err}` });
  }
});

// ADMIN: Delete user
router.delete("/admin/users/:code", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.params;
  const actorRole = req.user?.role;
  const actorCode = req.user?.code || "sys";

  try {
    const target = await UserResolver.getUserByCode(String(code).trim().toLowerCase());
    
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود في النظام." });

    // Protection: Cannot delete the last general_manager
    if (target.role === 'general_manager') {
      const cloudUsers = await getFirestoreCollection("users") || [];
      const gmCount = cloudUsers.filter(u => u.role === 'general_manager').length;
      if (gmCount <= 1) {
        return res.status(403).json({ error: "لا يمكن حذف آخر مدير عام مسجل بالنظام للحفاظ على استقرار الصلاحيات." });
      }
      if (actorRole !== 'general_manager') {
        return res.status(403).json({ error: "لا يمكن حذف حساب المدير العام إلا بواسطة مدير عام آخر." });
      }
    }

    // NEW: Hard Protection for user code 18 (Special Administrative Account)
    if (String(code).trim() === "18") {
      dbService.logAction(actorCode, "محاولة حذف محظورة", `محاولة فاشلة لحذف حساب المدير العام الرئيسي (كود 18) بواسطة: ${actorCode}`, getClientIp(req));
      return res.status(403).json({ error: "تنبيه أمني: لا يمكن حذف هذا الحساب (كود 18) نهائياً من النظام لأهميته الإدارية القصوى." });
    }

    try {
      await deleteFirestoreDoc("users", String(code).trim().toLowerCase());
      dbService.logAction(actorCode, "حذف مستخدم", `تم حذف المستخدم بنجاح من الفايرستور: ${code}`, getClientIp(req));
      dbService.bumpLastUpdated();

      res.json({ status: "ok" });
    } catch (delErr: any) {
      console.error("🛑 User Deletion Error: Failure to remove from Firestore.", delErr.message);
      return res.status(500).json({ error: "فشل حذف المستخدم سحابياً. الاتصال مع Firestore مطلوب للإتمام." });
    }
  } catch (err: any) {
    console.error("Error deleting user:", err);
    res.status(500).json({ error: `فشل حذف المستخدم: ${err.message}` });
  }
});

// 6. Manual DB Backup triggers (System Admins & Managers only)
router.get("/system/status", async (req, res) => {
  const health = await checkFirestoreHealth();
  
  res.json({ 
    status: "ok", 
    cloudSyncAvailable: health.connected,
    firestoreHealthy: health.healthy,
    cloudDisabledReason: health.reason || null,
    appEnv: getAppEnv(),
    resolvedCollection: resolveCollectionName("app_state"),
    lastSuccessfulSync: dbService.queryOne("SELECT value FROM settings WHERE key = 'last_successful_backup_time'")?.value || null,
    lastFailedSync: dbService.queryOne("SELECT value FROM settings WHERE key = 'last_failed_backup_time'")?.value || null
  });
});

// 📦 SQLite to SQL Spanner Master Mirror Service Endpoint
router.post("/backup", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager", "warehouse_supervisor", "supervisor", "stores_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "sys";
    const state = await SessionService.getStateWithPasswordsAsync();
    if (!state) {
      return res.status(400).json({ error: "لا توجد بيانات صالحة لتصديرها والنسخ الاحتياطي حالياً." });
    }
    
    // Check if cloud sync is enabled
    const db = getFirestoreInstance();
    if (!db) {
      return res.json({ status: "cloud_disabled" });
    }
    
    await FirebaseBackupService.backupStateToCloud(state, true, true);
    dbService.logAction(actor, "نسخة احتياطية سحابية يدوية", "تم دفع نسخة احتياطية وتحديث السجل السحابي يدوياً بنجاح.", getClientIp(req));
    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("Manual Firestore backup failed:", err);
    res.status(500).json({ error: err.message || "فشل رفع النسخة الاحتياطية للسيرفر السحابي." });
  }
});

router.post("/backup/trigger", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "ADMIN";
    const backupFile = SessionService.triggerDatabaseBackup(actor, getClientIp(req));
    dbService.logAction(actor, "نسخة احتياطية محلية", `تم إنشاء نسخة احتياطية محلية يدوياً: ${backupFile}`, getClientIp(req));
    res.json({ status: "ok", backupFile });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل أخذ نسخة احتياطية محلية." });
  }
});

// New endpoint to fetch backup metadata before restore
router.get("/backup/info", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager", "warehouse_supervisor", "supervisor", "storekeeper", "stores_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const metadata = await FirebaseBackupService.getBackupMetadata();
    if (!metadata) {
      return res.status(404).json({ error: "لم يتم العثور على أي نسخة سحابية مسجلة حالياً." });
    }
    res.json({ status: "ok", metadata });
  } catch (err: any) {
    res.status(500).json({ error: "فشل استرجاع معلومات النسخة السحابية." });
  }
});

router.post("/inventory/clear-master-database", AuthService.authenticateJWT, AuthService.requireRole(["system_admin", "super_admin", "general_manager", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "ADMIN";
    SessionService.clearInventory();
    await FirebaseBackupService.clearMasterMirror();
    dbService.logAction(actor, "تصفير المرآة", "تم حذف جميع الأصناف من قاعدة بيانات النظام بنجاح.", getClientIp(req));
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      const fullState = SessionService.getState();
      broadcast(fullState);
    }
    res.json({ status: "ok" });
  } catch (err: any) {
    res.status(500).json({ error: "فشل تصفير قاعدة بيانات الأصناف." });
  }
});

// Explicit cloud restore trigger endpoint
router.post("/backup/restore-from-cloud", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "super_admin", "system_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user?.code || "ADMIN";
    const restored = await FirebaseBackupService.restoreStateFromCloud(true);
    if (restored) {
      dbService.logAction(actor, "استعادة سحابية", "تم استعادة قاعدة البيانات من السحابة بنجاح.", getClientIp(req));
      // Broadcast full live restored state automatically to all active clients
      const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
      if (broadcast) {
        const fullState = SessionService.getState();
        broadcast(fullState);
      }
      res.json({ status: "ok" });
    } else {
      res.status(400).json({ error: "لم يتم العثور على أي نسخة احتياطية سحابية صالحة أو فشلت عملية الاستعادة." });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل استرجاع الجرد من السيرفر السحابي." });
  }
});

// 7. Session Restore archive Snapshots (System Admins & Managers only)
router.post("/backup/restore", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "يرجى تحديد رقم الجلسة المراد استعادتها." });
  }

  try {
    const actor = req.user?.code || "ADMIN";
    const restoredSession = SessionService.restoreSnapshot(Number(id), actor, getClientIp(req));

    // Broadcast full live restored state automatically to all active clients
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      const fullState = SessionService.getState();
      broadcast(fullState);
    }

    res.json({ status: "ok", restoredSession });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل استعادة الجلسة بنشاط." });
  }
});

// 8. Fetch direct live auditing logs (System Admins & Managers only)
router.get("/logs", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = dbService.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500");
    res.json({ status: "ok", logs });
  } catch (err) {
    res.status(500).json({ error: "فشل استرجاع سجل الحركة العادلة." });
  }
});

// 9. Fetch deleted sessions with 3-day auto-pruning (System Admins only)
router.get("/deleted", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Prune deleted sessions older than 3 days automatically
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const isoThreshold = threeDaysAgo.toISOString();

    const rowsToDelete = dbService.query("SELECT id FROM deleted_sessions WHERE deleted_at < ?", [isoThreshold]);
    if (rowsToDelete.length > 0) {
      const ids = rowsToDelete.map(r => r.id);
      const { getFirestoreApiDisabled, deleteFirestoreDoc } = await import("../services/firestoreService");
      if (!getFirestoreApiDisabled()) {
        for (const id of ids) {
          deleteFirestoreDoc("deleted_sessions", String(id)).catch(e => {
            console.warn(`⚠️ Cloud delete failed for pruned deleted session ${id}:`, e.message);
          });
        }
      }
      dbService.run(`DELETE FROM deleted_sessions WHERE id IN (${ids.join(",")})`);
    }

    const dbDeleted = dbService.query("SELECT * FROM deleted_sessions ORDER BY id DESC");
    const deletedSessions = dbDeleted.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      deletedAt: row.deleted_at,
      deletedReason: row.deleted_reason,
      sessionData: JSON.parse(row.session_data)
    }));

    res.json({ status: "ok", deletedSessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل تحميل سلة المحذوفات." });
  }
});

// 10. Restore a deleted session (System Admins only)
router.post("/deleted/restore", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin"]), (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "الرجاء تحديد الجلسة المطلوب استعادتها." });
  }

  try {
    const actor = req.user?.code || "ADMIN";
    const row = dbService.queryOne("SELECT * FROM deleted_sessions WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: "لم يتم العثور على الجلسة المحذوفة." });
    }

    const sessionObj = JSON.parse(row.session_data);
    const sessionType = sessionObj.type;

    if (sessionType !== "archived") {
      const activeSessSetting = dbService.queryOne("SELECT value FROM settings WHERE key = 'activeSession'");
      if (activeSessSetting && activeSessSetting.value) {
        try {
          const parsedActive = JSON.parse(activeSessSetting.value);
          if (parsedActive && parsedActive.items && parsedActive.items.length > 0) {
            return res.status(400).json({ 
              error: "❌ لا يمكن الاسترجاع: يوجد حالياً جلسة جرد نشطة في ورقة الجرد! يجب إنهاؤها أو حذفها بالكامل أولاً." 
            });
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    dbService.transaction(() => {
      if (sessionType === "archived") {
        // Restore to archived snapshots table - first delete any existing duplicate with the same session_id
        dbService.run("DELETE FROM inventory_snapshots WHERE session_id = ?", [row.session_id]);
        dbService.run(`
          INSERT INTO inventory_snapshots (session_id, date, notes, created_at, snapshot_data)
          VALUES (?, ?, ?, ?, ?)
        `, [
          row.session_id,
          sessionObj.date || new Date().toISOString().slice(0, 10),
          sessionObj.notes || "",
          new Date().toISOString(),
          JSON.stringify(sessionObj)
        ]);
        AuditService.log(
          actor,
          "استعادة النسخ الاحتياطية",
          `تم استرجاع جلسة الجرد التاريخية المؤرشفة رقم (${row.session_id}) من سلة المحذوفات بنجاح.`,
          getClientIp(req)
        );
      } else {
        // Restore to active settings key
        dbService.run(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES ('activeSession', ?)
        `, [JSON.stringify(sessionObj)]);

        // If the inventory master catalog table is currently empty, reconstruct and restore it from the recovered session's items
        try {
          const countRow = dbService.queryOne("SELECT COUNT(*) as count FROM inventory");
          const count = countRow ? countRow.count : 0;
          if (count === 0 && sessionObj && Array.isArray(sessionObj.items) && sessionObj.items.length > 0) {
            let resIdx = 0;
            for (const item of sessionObj.items) {
              dbService.run(`
                INSERT INTO inventory (id, name, category, bookQty, unit, previousDiff, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `, [
                String(item.itemId || item.id),
                item.itemName || item.name,
                item.category || "عام",
                Number(item.bookQty) || 0,
                item.unit || "كجم",
                Number(item.previousDiff) || 0,
                resIdx++
              ]);
            }
          }
        } catch (catErr) {
          console.error("Failed to reconstruct inventory catalog on session restore:", catErr);
        }

        AuditService.log(
          actor,
          "استعادة النسخ الاحتياطية",
          `تم استرجاع جلسة الجرد النشطة رقم (${row.session_id}) من سلة المحذوفات بنجاح.`,
          getClientIp(req)
        );
      }

      // Cleanup resolved recycling bin entry
      dbService.run("DELETE FROM deleted_sessions WHERE id = ?", [id]);
    });

    // Save durable checkpoint after restoration of recycled session
    SessionService.writeDurableCheckpoint();

    // Broadcast update across existing live dashboard worksheets
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      const fullState = SessionService.getState();
      broadcast(fullState);
    }

    res.json({ status: "ok" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل عملية استرجاع الجلسة الحذرة." });
  }
});

router.post("/deleted/permanently-delete", AuthService.authenticateJWT, AuthService.requireRole(["general_manager", "system_admin", "super_admin", "program_manager"]), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing required session record id" });

  try {
    const actor = req.user?.code || "ADMIN";
    
    // Get row before deleting to log it
    const row = dbService.queryOne("SELECT * FROM deleted_sessions WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: "لم يتم العثور على الجلسة." });
    }

    dbService.transaction(() => {
      dbService.run("DELETE FROM deleted_sessions WHERE id = ?", [id]);
      dbService.run("INSERT OR REPLACE INTO permanent_tombstones (session_id, tombstoned_at) VALUES (?, ?)", [
        row.session_id,
        new Date().toISOString()
      ]);
      
      const logDetails = `تم الحذف النهائي للجلسة رقم (${row.session_id}) من سلة المحذوفات.`;
      dbService.logAction(actor, "حذف نهائي", logDetails, getClientIp(req));
    });

    SessionService.writeDurableCheckpoint();

    // Broadcast update across existing live dashboard worksheets
    const broadcast = (req.app as any).getWssBroadcast ? (req.app as any).getWssBroadcast() : null;
    if (broadcast) {
      const fullState = SessionService.getState();
      broadcast(fullState);
    }

    // Force immediate cloud sync to prune the permanently deleted item from Firestore
    if (!getFirestoreApiDisabled()) {
      try {
        // 🛡️ TRIPLE-STRETCH DELETION: Explicitly remove from all possible cloud collections immediately
        await deleteFirestoreDoc("deleted_sessions", String(id));
        if (row && row.session_id) {
          await deleteFirestoreDoc("inventory_snapshots", String(row.session_id));
          // 🛡️ Tombstone in Firestore
          await setFirestoreDoc("permanent_tombstones", String(row.session_id), {
            session_id: row.session_id,
            tombstoned_at: new Date().toISOString()
          });
        }
        
        const fullState = SessionService.getStateWithPasswords();
        if (fullState) {
          FirebaseBackupService.backupStateToCloud(fullState, true, true).catch(err => {
            console.error("🛑 Archiving Failure: Could not persist permanent delete prune to Firestore Cloud.", err.message);
          });
        }
      } catch (delErr: any) {
        console.warn("⚠️ Explicit cloud deletion failed during permanent delete:", delErr.message);
      }
    }

    res.json({ message: "تم الحذف النهائي بنجاح." });
  } catch (error: any) {
    console.error("Permanent delete error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 11. Secure Profile Update Endpoint for Logged-In User
router.post("/auth/update-profile", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { name, phone, password, oldPassword } = req.body;
  const userCode = req.user?.code;

  if (!userCode) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً." });
  }

  try {
    let userRow = null;
    try {
      userRow = await getFirestoreDoc("users", String(userCode).toLowerCase());
    } catch (err: any) {
      console.error("⚠️ User lookup failed in update-profile:", err.message || err);
      throw new Error("فشل الاتصال بفايرستور للتحقق من بيانات الملف الشخصي.");
    }

    if (!userRow) {
      return res.status(404).json({ error: "المستخدم غير موجود في الفايرستور السحابي." });
    }

    // Verify current (old) password
    if (!oldPassword) {
      return res.status(400).json({ error: "الرجاء إدخال كلمة المرور الحالية لتأكيد الترقية وحفظ التغييرات." });
    }
    
    // Safety check for password hashes
    if (!userRow.password) {
      console.error(`❌ User ${userCode} has no password in DB`);
      return res.status(500).json({ error: "خطأ في بيانات الحساب: لا توجد كلمة مرور مسجلة." });
    }

    try {
      const isMatch = bcrypt.compareSync(oldPassword, userRow.password);
      if (!isMatch) {
        return res.status(400).json({ error: "كلمة المرور الحالية المدخلة غير صحيحة!" });
      }
    } catch (bcryptErr: any) {
      console.error("Bcrypt comparison failed:", bcryptErr);
      return res.status(500).json({ error: "خطأ في التحقق من كلمة المرور: " + bcryptErr.message });
    }

    let securePass = userRow.password;
    if (password && String(password).trim()) {
      if (!AuthService.validatePasswordStrength(String(password).trim())) {
        return res.status(400).json({
          error: "كلمة المرور غير صالحة. يرجى كتابة رمز مرور صحيح."
        });
      }
      try {
        securePass = bcrypt.hashSync(String(password).trim(), 10);
      } catch (hashErr: any) {
        console.error("Bcrypt hashing failed:", hashErr);
        return res.status(500).json({ error: "خطأ في تشفير كلمة المرور الجديدة." });
      }
    }

    const nowStamp = Date.now();
    const finalName = name ? name.trim() : userRow.name;
    const finalPhone = phone ? phone.trim() : (userRow.phone || "");

    const isPrecodedVal = userRow.is_precoded !== undefined ? userRow.is_precoded : userRow.isPrecoded;
    const isRegisteredVal = userRow.is_registered !== undefined ? userRow.is_registered : userRow.isRegistered;
    const isActivatedVal = userRow.is_activated !== undefined ? userRow.is_activated : userRow.isActivated;

    const updatedUserObj = {
      code: userRow.code,
      name: finalName,
      phone: finalPhone,
      role: userRow.role,
      password: securePass, // hashed
      remember_me: userRow.remember_me || 0,
      is_precoded: isPrecodedVal !== undefined ? (isPrecodedVal ? 1 : 0) : 1,
      is_registered: isRegisteredVal !== undefined ? (isRegisteredVal ? 1 : 0) : 1,
      is_activated: isActivatedVal !== undefined ? (isActivatedVal ? 1 : 0) : 1,
      updated_at: nowStamp
    };

    await UserResolver.saveUser(String(userCode).toLowerCase(), updatedUserObj);
    dbService.bumpLastUpdated();
    
    let auditAction = "تعديل الملف الشخصي";
    let auditMsg = `قام المستخدم بتحديث بيانات ملفه الشخصي بنجاح في الفايرستور.`;
    if (password && String(password).trim()) {
      auditAction = "تغيير كلمة المرور";
      auditMsg = `قام المستخدم بتحديث ملفه الشخصي وتعديل كلمة المرور الخاصة به بنجاح في الفايرستور.`;
    }

    AuditService.log(
      String(userCode),
      auditAction,
      auditMsg,
      getClientIp(req)
    );

    res.json({
      status: "ok",
      user: {
        code: updatedUserObj.code,
        name: updatedUserObj.name,
        phone: updatedUserObj.phone || "",
        role: updatedUserObj.role,
        rememberMe: updatedUserObj.remember_me === 1,
        isUsingDefaultPassword: false,
      }
    });
  } catch (err: any) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: err.message || "فشل تحديث الملف الشخصي." });
  }
});

// 12. Public Health Check Endpoint
router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 13. System Environment Diagnostic Endpoint (For Troubleshooting)
router.get("/diagnose", async (req, res) => {
  try {
    const health = await checkFirestoreHealth();
    const resolvedUsersCollection = resolveCollectionName("users");
    const docName = FirebaseBackupService.getBackupDocumentName();
    
    // Check SQLite counts
    let localUsersCount = 0;
    let localItemsCount = 0;
    try {
      localUsersCount = dbService.queryOne("SELECT count(*) as count FROM users")?.count || 0;
      localItemsCount = dbService.queryOne("SELECT count(*) as count FROM inventory")?.count || 0;
    } catch (dbE) {}

    // Check Cloud counts if healthy
    let cloudUsersCountStatus = "Unknown";
    let foundInCollection = "None";
    
    if (health.healthy) {
      try {
        const users = await UserResolver.getAllUsers();
        cloudUsersCountStatus = `${users.length} users`;
        foundInCollection = resolvedUsersCollection;
      } catch (e: any) {
        cloudUsersCountStatus = `Error: ${e.message || e}`;
      }
    } else {
      cloudUsersCountStatus = `Cloud Unhealthy: ${health.reason}`;
    }

    res.json({
      status: "ok",
      cloudSyncAvailable: health.connected,
      firestoreHealthy: health.healthy,
      diagnostics: {
        APP_ENV: getAppEnv(),
        resolvedUsersCollection,
        backupDocumentName: docName,
        localUsersCount,
        localItemsCount,
        cloudUsersCountStatus,
        foundInCollection,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed diagnostics." });
  }
});


// 10. System Diagnostic & Force Cloud Sync (Admins only)
router.get("/cloud-sync-force", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== "general_manager" && req.user?.role !== "program_manager") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("🚀 Forced Cloud Sync initiated via API...");
    
    // Reset flags
    setFirestoreApiDisabled(false);
    
    const state = SessionService.getStateWithPasswords();
    if (!state) throw new Error("Could not retrieve system state");

    // 1. Sync Base State
    await FirebaseBackupService.backupStateToCloud(state, true, true);
    
    // 2. Sync All Users individually
    const users = dbService.query("SELECT * FROM users");
    for (const user of users) {
      await setFirestoreDoc("users", String(user.code).toLowerCase(), {
        ...user,
        updated_at: user.updated_at || Date.now()
      });
    }

    res.json({ 
      status: "ok", 
      message: `تمت مزامنة ${users.length} مستخدم ولقطة قاعدة البيانات كاملة بنجاح مع Firestore سحابة Al-Eman.`,
      env: getAppEnv()
    });
  } catch (err: any) {
    console.error("🛑 Cloud Sync Force Failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 13.5 POST Recalculate Storage
router.post("/quota/recalculate", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { getFirestoreInstance } = await import("../services/firestoreService");
    const db = getFirestoreInstance();
    if (!db) {
      return res.status(503).json({ error: "Cloud storage is not connected" });
    }
    
    const { FirebaseBackupService } = await import("../services/firebaseBackupService");
    const size = await FirebaseBackupService.calculateDatabaseSize(db);
    
    await QuotaService.trackStorageBytes(size);
    
    res.json({ 
      status: "ok", 
      storageBytes: size 
    });
  } catch (error: any) {
    res.status(500).json({ error: "فشل إعادة حساب المساحة التخزينية." });
  }
});

// 13. GET Global Quota Data
router.get("/quota", AuthService.authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const quotaData = await QuotaService.getGlobalQuota();
    res.json({
      status: "ok",
      quota: quotaData
    });
  } catch (err) {
    res.status(500).json({ error: "فشل استرداد بيانات الكوتا الصلاحية." });
  }
});

export default router;


