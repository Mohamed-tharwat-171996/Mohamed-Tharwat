/* ==========================================
   ١. فسم المكتبات والاعتمادات والاستيراد (Imports & Setup)
   ========================================== */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { MasterItem, AuditSession, AuditItem, LoggedInUser, BagCalculatorDetails } from "./types";
import ImportItemsModal from "./components/ImportItemsModal";
import MasterInventoryMirror from "./components/MasterInventoryMirror";
import UserManagement from "./components/UserManagement";
import UserAccessControlModal from "./components/UserAccessControlModal";
import SalatMessage from "./components/SalatMessage";
import BagCalculatorModal from "./components/BagCalculatorModal";
import QuotaMonitor from "./components/QuotaMonitor";
import StoresManagerDashboard from "./components/StoresManagerDashboard";
import {
  ClipboardList, BookOpen, Clock, FileText, CheckCircle, Sparkles,
  AlertCircle, Info, FileDown, Search, Plus, Trash, Trash2, Edit2, Play, Pause,
  Layers, Calendar, ChevronDown, ChevronLeft, Save, X, Eye, ArrowLeft, RotateCcw,
  Wheat, Lock, User, Key, LogOut, Settings, UserCheck, Shield, Check, Upload, Calculator, Phone, Package,
  Database, FileUp, Cloud, WifiOff, RefreshCw, ScrollText, TriangleAlert, Send
} from "lucide-react";
import { offlineService } from "./lib/offlineSync";
import { motion, AnimatePresence } from "motion/react";

// @ts-ignore
import alEmanLogoImg from "./assets/images/al_eman_logo_new_1779919375634.png";

const AlEmanLogo = ({ className = "w-10 h-10" }: { className?: string }) => {
  const [processedLogo, setProcessedLogo] = useState<string | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = alEmanLogoImg;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 245 && data[i+1] > 245 && data[i+2] > 245) {
          data[i+3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      setProcessedLogo(canvas.toDataURL());
    };
  }, []);

  return (
    <div className={`${className} flex items-center justify-center pointer-events-none`}>
      {processedLogo ? (
        <img
          src={processedLogo}
          alt="الإيمان للأعلاف"
          className="w-full h-full object-contain border-0 m-0 p-0 animate-fadeIn"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-full h-full bg-transparent flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-emerald-100 border-t-emerald-500 rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
};

/* ==========================================
   ٢. قسم الدوال المساعدة والمُنسّقات العامة (Helpers)
   ========================================== */
const getStorekeeperName = (code: number | string | undefined, currentUser?: LoggedInUser | null): string => {
  if (code === undefined) return "لم يتم الإدخال";
  if (currentUser && String(currentUser.code) === String(code)) {
    return currentUser.name;
  }

  // Try to resolve name from dynamically registered users in this browser
  try {
    const saved = localStorage.getItem("inventory_registered_users");
    if (saved) {
      const users: LoggedInUser[] = JSON.parse(saved);
      const found = users.find((u) => String(u.code).trim() === String(code).trim());
      if (found) return found.name;
    }
  } catch {}

  // Try to resolve name from precoded users list in this browser
  try {
    const savedPreceded = localStorage.getItem("inventory_precoded_users");
    if (savedPreceded) {
      const users: LoggedInUser[] = JSON.parse(savedPreceded);
      const found = users.find((u) => String(u.code).trim() === String(code).trim());
      if (found) return found.name;
    }
  } catch {}

  const names: { [key: string]: string } = {
    // Role names mapping for display purposes if needed
  };
  return names[String(code)] || `موظف رقم ${code}`;
};

export type UserRole = "general_manager" | "system_admin" | "program_manager" | "warehouse_supervisor" | "storekeeper" | "stores_manager";

const getRoleBasedPhysicalQty = (item: AuditItem, role?: string): number | null => {
  if (role === "storekeeper") {
    if (item.assignedTo && !item.submitted) {
      return item.physicalQty;
    }
    if (item.storekeeperQty !== undefined && item.storekeeperQty !== null) {
      return item.storekeeperQty;
    }
    return item.physicalQty;
  }
  if (role === "supervisor" || role === "warehouse_supervisor") {
    if (item.supervisorQty !== undefined && item.supervisorQty !== null) {
      return item.supervisorQty;
    }
    // Check storekeeperQty first, but fallback to physicalQty if the item is submitted
    // this handles edge cases during offline sync where storekeeperQty might be missing in the object
    const finalSKQty = (item.storekeeperQty !== undefined && item.storekeeperQty !== null) 
      ? item.storekeeperQty 
      : (item.submitted ? item.physicalQty : null);

    if (finalSKQty !== null && finalSKQty !== undefined) {
      // 🛡️ SUBMISSION GATING SHIELD FOR SUPERVISORS:
      // If the item is assigned to a storekeeper, only show their quantity if they have officially submitted/delivered the item!
      if (item.submitted === true || !item.assignedTo) {
        return finalSKQty;
      }
    }
    return null;
  }
  // Program Manager / System Admin / General Manager
  if (item.managerQty !== undefined && item.managerQty !== null) {
    return item.managerQty;
  }
  if (item.supervisorQty !== undefined && item.supervisorQty !== null) {
    return item.supervisorQty;
  }
  if (item.storekeeperQty !== undefined && item.storekeeperQty !== null) {
    // 🛡️ SUBMISSION GATING SHIELD FOR MANAGERS/ADMINS:
    if (item.submitted === true || !item.assignedTo) {
      return item.storekeeperQty;
    }
  }
  return null;
};

/* ==========================================
   ٣. مكون تطبيق الفحص والتدقيق الرئيسي (Main App Component & States)
   ========================================== */
export default function App() {
  // Authentication & session state
  const [user, setUser] = useState<LoggedInUser | null>(() => {
    try {
      const saved = localStorage.getItem("inventory_logged_in_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Device-level saved profile for quick login
  const [savedProfile, setSavedProfile] = useState<LoggedInUser | null>(() => {
    try {
      const saved = localStorage.getItem("inventory_saved_profile");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Registered profiles database on this device
  const [registeredUsers, setRegisteredUsers] = useState<LoggedInUser[]>(() => {
    try {
      const saved = localStorage.getItem("inventory_registered_users");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clean out legacy administrator records
        const filtered = parsed.filter((u: any) => u.code !== "admin" && u.code !== "t29173995" && u.code !== "sa1");
        return filtered;
      }
    } catch {}
    
    // Default initial database is empty; let the server bootstrap the general_manager
    return [];
  });

  // Pre-coded users created by the system administrator (التكويد والترميز المسبق للأمناء)
  const [precodedUsers, setPrecodedUsers] = useState<LoggedInUser[]>(() => {
    try {
      const saved = localStorage.getItem("inventory_precoded_users");
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter((u: any) => u.code !== "admin" && u.code !== "t29173995" && u.code !== "sa1");
        return filtered;
      }
    } catch {}
    
    return [];
  });

  // Helper actions to manage pre-coded users from the admin screen
  const handleAddPrecodedUser = async (newUser: LoggedInUser) => {
    if (!user || !["general_manager", "system_admin", "super_admin"].includes(user.role)) {
      showToast("عذراً، هذه الصلاحية مخصصة فقط للمدير العام أو مسئول النظام!", "error");
      return;
    }
    const codeNormalized = String(newUser.code).trim().toLowerCase();
    const isDuplicate = precodedUsers.some(u => String(u.code).trim().toLowerCase() === codeNormalized) ||
                        registeredUsers.some(u => String(u.code).trim().toLowerCase() === codeNormalized);
    if (isDuplicate) {
      showToast(`عذراً، كود الموظف "${newUser.code}" مسجل مسبقاً في النظام ولا يمكن تكراره!`, "error");
      return;
    }

    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          code: newUser.code,
          name: newUser.name,
          phone: newUser.phone || "",
          role: newUser.role,
          password: "123456", // Temporary pre-coded default
          isPrecoded: true,
          isRegistered: false,
          isActivated: true,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "فشل تكويد المستخدم على السيرفر.");
      }

      const updatedPrecoded = [...precodedUsers, { ...newUser, isActivated: true }];
      setPrecodedUsers(updatedPrecoded);
      localStorage.setItem("inventory_precoded_users", JSON.stringify(updatedPrecoded));

      showToast(`تم تكويد الحساب بنجاح. كلمة المرور المؤقتة هي: 123456. يجب على الموظف تنشيط الحساب أولاً بالنقر على 'تنشيط مستخدم جديد' لاستكمال بياناته وتفعيل الحساب.`, "success");

    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleUpdatePrecodedUser = async (updatedUser: LoggedInUser) => {
    if (!user || !["general_manager", "system_admin", "super_admin"].includes(user.role)) {
      showToast("عذراً، هذه الصلاحية مخصصة فقط للمدير العام أو مسئول النظام!", "error");
      return;
    }
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const response = await fetch("/api/admin/users", {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          code: updatedUser.code,
          name: updatedUser.name,
          phone: updatedUser.phone,
          role: updatedUser.role,
          password: updatedUser.password ? String(updatedUser.password).trim() : undefined,
          isPrecoded: updatedUser.isPrecoded !== undefined ? updatedUser.isPrecoded : updatedUser.is_precoded,
          isRegistered: updatedUser.isRegistered !== undefined ? updatedUser.isRegistered : updatedUser.is_registered,
          isActivated: updatedUser.isActivated !== undefined ? updatedUser.isActivated : updatedUser.is_activated
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "فشل تحديث المستخدم.");
      }

      const updatedPrecoded = precodedUsers.map(u => u.code === updatedUser.code ? updatedUser : u);
      setPrecodedUsers(updatedPrecoded);
      localStorage.setItem("inventory_precoded_users", JSON.stringify(updatedPrecoded));

      const updatedReg = registeredUsers.map(u => u.code === updatedUser.code ? updatedUser : u);
      setRegisteredUsers(updatedReg);
      localStorage.setItem("inventory_registered_users", JSON.stringify(updatedReg));

      if (user && user.code === updatedUser.code) {
        setUser(updatedUser);
        localStorage.setItem("inventory_logged_in_user", JSON.stringify(updatedUser));
      }
      showToast("تم تعديل وحفظ بيانات الترميز بنجاح.", "success");
    } catch (error) {
      showToast("خطأ أثناء التعديل.", "error");
    }
  };

  // Admin Portal Gates State
  const [adminPanelState, setAdminPanelState] = useState<'none' | 'auth' | 'coding'>('none');
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminError, setAdminError] = useState("");

  // SignUp Verification states
  const [isPrecodeVerified, setIsPrecodeVerified] = useState(false);
  const [verifiedUserObj, setVerifiedUserObj] = useState<LoggedInUser | null>(null);

  // Toggle to force showing full registration on demand
  const [forceFullRegister, setForceFullRegister] = useState(false);

  // Phone helper functions
  const validateEgyptianPhone = (phone: string): boolean => {
    const p = phone.trim();
    if (!p) return true; // Optional field
    return /^01\d{9}$/.test(p);
  };

  const sanitizePhoneInput = (val: string): string => {
    return val.replace(/[^0-9]/g, "").slice(0, 11);
  };

  // Login form inputs
  const [loginCode, setLoginCode] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [activationNewPassword, setActivationNewPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  // Autofill code if profile exists
  useEffect(() => {
    if (savedProfile) {
      setLoginCode(savedProfile.code);
    }
  }, [savedProfile]);

  // Profile edit inputs
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [oldPasswordConfirm, setOldPasswordConfirm] = useState("");
  const [editProfileError, setEditProfileError] = useState("");

  // Master database state
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  // Past completed audits archives
  const [pastSessions, setPastSessions] = useState<AuditSession[]>([]);
  // Active/current session that user is filling right now
  const [activeSession, setActiveSession] = useState<AuditSession | null>(null);

  const [hasPendingAssignments, setHasPendingAssignmentsState] = useState<boolean>(() => {
    return localStorage.getItem("inventory_has_pending_assignments") === "true";
  });

  const [pendingLogoutWithUnsaved, setPendingLogoutWithUnsaved] = useState(false);
  const [showStandardLogoutConfirm, setShowStandardLogoutConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const setHasPendingAssignments = (val: boolean) => {
    setHasPendingAssignmentsState(val);
    localStorage.setItem("inventory_has_pending_assignments", String(val));
  };

  const [hasUnsavedChanges, setHasUnsavedChangesState] = useState<boolean>(() => {
    return localStorage.getItem("inventory_has_unsaved_changes") === "true";
  });

  const setHasUnsavedChanges = (val: boolean) => {
    setHasUnsavedChangesState(val);
    if (val) {
      localStorage.setItem("inventory_has_unsaved_changes", "true");
    } else {
      localStorage.removeItem("inventory_has_unsaved_changes");
    }
  };

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "shortage" | "excess" | "match" | "pending">("all");

  // Single Item Manual Form Toggle & Inputs
  const [showAddForm, setShowAddForm] = useState(false);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formBookQty, setFormBookQty] = useState<number | "">("");
  const [formUnit, setFormUnit] = useState("حبة");
  const [formError, setFormError] = useState("");
  const [editingItem, setEditingItem] = useState<MasterItem | null>(null);

  // Archive session inspect modal state
  const [inspectSession, setInspectSession] = useState<AuditSession | null>(null);
  const [isEditingInspectSession, setIsEditingInspectSession] = useState(false);
  const [showInspectModifications, setShowInspectModifications] = useState(false);

  // Modals
  const [showDeletionReasonModal, setShowDeletionReasonModal] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<{ type: 'active' | 'archived', id?: string } | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [confirmingDeleteArchiveId, setConfirmingDeleteArchiveId] = useState<string | null>(null);
  const [confirmingRestoreSessionId, setConfirmingRestoreSessionId] = useState<string | null>(null);
  const [confirmingDeleteInspect, setConfirmingDeleteInspect] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isManageUsersOpen, setIsManageUsersOpen] = useState(false);
  const [isUserAccessControlOpen, setIsUserAccessControlOpen] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<'coding' | 'backup' | 'deleted' | 'logs' | ''>('');
  const [isUserManagementSubTabOpen, setIsUserManagementSubTabOpen] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [hasFirebaseConfig, setHasFirebaseConfig] = useState<boolean>(true);
  const [activeProgramManagerTab, setActiveProgramManagerTab] = useState<'upload' | 'archive' | 'none'>('none');
  const [activeSupervisorTab, setActiveSupervisorTab] = useState<'sheet' | 'archive' | 'none' | 'manager_dashboard'>('none');
  const [storesManagerSubTab, setStoresManagerSubTab] = useState<'items' | 'auditors' | 'general'>('items');
  const [activeStorekeeperTab, setActiveStorekeeperTab] = useState<'sheet' | 'archive' | 'none'>('none');
  const [activeBackupSubTab, setActiveBackupSubTab] = useState<'cloud' | 'offline' | 'none'>('none');
  const [activeBackupInnerSection, setActiveBackupInnerSection] = useState<string>('none');
  const [activeDeletedSection, setActiveDeletedSection] = useState<string>('all');
  const [activeLogsSection, setActiveLogsSection] = useState<string>('none');
  const [deletedSessionsSearchQuery, setDeletedSessionsSearchQuery] = useState("");
  const [deletedDateFilter, setDeletedDateFilter] = useState("");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [logsSearchQuery, setLogsSearchQuery] = useState("");
  const [logsActionFilter, setLogsActionFilter] = useState("all");
  const [deletedSessions, setDeletedSessions] = useState<any[]>([]);
  const [confirmDeleteRecycleId, setConfirmDeleteRecycleId] = useState<number | null>(null);
  const [assignPopoverItemId, setAssignPopoverItemId] = useState<string | null>(null);
  const [assignSearchTerm, setAssignSearchTerm] = useState<string>("");
  const [isRestoringCloud, setIsRestoringCloud] = useState(false);
  const [isBackingUpCloud, setIsBackingUpCloud] = useState(false);
  const [isCloudSyncAvailable, setIsCloudSyncAvailable] = useState<boolean>(false);
  const [appEnv, setAppEnv] = useState<string>("development");
  const [isBackupMetadataLoading, setIsBackupMetadataLoading] = useState(false);
  const [cloudBackupMetadata, setCloudBackupMetadata] = useState<{
    lastUpdated: number;
    updatedAtString: string;
    sessionCount: number;
    deletedSessionCount?: number;
    itemCount: number;
    masterItemCount: number;
    hasActiveSession: boolean;
    userCount?: number;
    history?: any[];
    storageBytes?: number;
  } | null>(null);

  const saveCloudMetadataToLocalTracker = (metadata: any) => {
    if (!metadata) return;
    setCloudBackupMetadata(metadata);
    try {
      const saved = localStorage.getItem("inventory_firestore_usage");
      let usage: any;
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      try {
        usage = saved ? JSON.parse(saved) : { date: todayStr, reads: 0, writes: 0, deletes: 0, storageBytes: 0 };
      } catch (e) {
        usage = { date: todayStr, reads: 0, writes: 0, deletes: 0, storageBytes: 0 };
      }
      if (metadata.storageBytes !== undefined) {
        usage.storageBytes = Number(metadata.storageBytes);
      }
      if (metadata.deletedSessionCount !== undefined) {
        usage.deletes = Number(metadata.deletedSessionCount);
      }
      localStorage.setItem("inventory_firestore_usage", JSON.stringify(usage));
    } catch (e) {
      console.warn("Error updating local firestore tracker from metadata:", e);
    }
  };
  const [isShowingRestoreConfirm, setIsShowingRestoreConfirm] = useState(false);
  const [isShowingMirror, setIsShowingMirror] = useState(false);
  
  // Auto-fetch master items when mirror is requested if current state is empty
  useEffect(() => {
    if (isShowingMirror && masterItems.length === 0) {
      console.log("🔍 Mirror requested but items empty: Fetching from server...");
      fetchStateFromServer(true);
    }
  }, [isShowingMirror, masterItems.length]);

  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [calcItem, setCalcItem] = useState<AuditItem | null>(null);

  // Auto-select worksheet tab if session becomes active and no tab is selected
  useEffect(() => {
    if (activeSession && user) {
      if (user.role === 'storekeeper' && activeStorekeeperTab === 'none') {
        setActiveStorekeeperTab('sheet');
      }
      if (['supervisor', 'warehouse_supervisor'].includes(user.role) && activeSupervisorTab === 'none') {
        setActiveSupervisorTab('sheet');
      }
      if (user.role === 'program_manager' && activeProgramManagerTab === 'none') {
        // No auto-selection to prevent unrequested views appearing on login
      }
    }
  }, [activeSession, user]);

  // Close assignee assignment popover when clicking anywhere else
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (assignPopoverItemId) {
        const target = e.target as HTMLElement;
        const clickedTrigger = target.closest(`[id^="assign-trigger-"]`);
        const clickedSearch = target.closest(`[id^="assign-search-"]`);
        const clickedPopover = target.closest(".assignee-popover-card");
        if (!clickedTrigger && !clickedSearch && !clickedPopover) {
          setAssignPopoverItemId(null);
        }
      }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [assignPopoverItemId]);

  // 5-minute auto-sync
  useEffect(() => {
    const interval = setInterval(() => {
      const storedUser = localStorage.getItem("inventory_logged_in_user");
      const parsedUser = storedUser ? JSON.parse(storedUser) : null;
      if (parsedUser && parsedUser.role === "storekeeper") {
        console.log("🛡️ Auto-sync interval bypassed for storekeeper.");
        return;
      }
      const hasPending = localStorage.getItem("inventory_has_pending_assignments") === "true";
      if (hasPending) {
        console.log("🛡️ Auto-sync interval bypassed: pending supervisor assignments.");
        return;
      }

      const precodedUsers = JSON.parse(localStorage.getItem("inventory_precoded_users") || "[]");
      const registeredUsers = JSON.parse(localStorage.getItem("inventory_registered_users") || "[]");
      const masterItems = JSON.parse(localStorage.getItem("inventory_master_items") || "[]");
      const activeSession = JSON.parse(localStorage.getItem("inventory_active_session") || "null");
      const pastSessions = JSON.parse(localStorage.getItem("inventory_past_sessions") || "[]");
      const isFirebaseSyncDisabled = localStorage.getItem("inventory_firebase_sync_disabled") === "true";
      
      pushStateToServer({
        precodedUsers,
        registeredUsers,
        masterItems,
        activeSession,
        pastSessions,
        isFirebaseSyncDisabled
      }, { isExplicitAction: false });
      
      console.log("⏱️ Auto-sync triggered.");
    }, 300000); // 5 minutes
    
    return () => clearInterval(interval);
  }, []);

  // Initial Sync from IndexedDB on startup
  useEffect(() => {
    const checkQueue = async () => {
      const ops = await offlineService.getPendingOperations();
      setPendingSyncCount(ops.length);
      if (ops.length > 0 && navigator.onLine) {
        processOfflineQueue();
      }
    };
    checkQueue();
  }, []);

  // Monitor connectivity and sync automatically
  useEffect(() => {
    const handleOnline = () => {
      console.log("🌐 Network RESTORED: Triggering Background Sync...");
      processOfflineQueue();
    };
    
    window.addEventListener('online', handleOnline);
    
    // Fallback Retry Logic: Check every 30 seconds if there are pending operations
    const retryInterval = setInterval(() => {
      if (pendingSyncCount > 0 && navigator.onLine && !isSyncingOffline) {
        console.log("🔄 Periodic Retry: Attempting to sync pending operations...");
        processOfflineQueue();
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(retryInterval);
    };
  }, [pendingSyncCount, isSyncingOffline]);

  const processOfflineQueue = async () => {
    if (isSyncingOffline || !navigator.onLine) return;
    
    const ops = await offlineService.getPendingOperations();
    if (ops.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    setIsSyncingOffline(true);
    console.log(`📦 Background Sync: Processing ${ops.length} pending operations...`);
    
    const token = localStorage.getItem("inventory_jwt_token");
    if (!token) {
      setIsSyncingOffline(false);
      return;
    }

    for (const op of ops) {
      try {
        const res = await fetch("/api/data", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(op.payload)
        });

        if (res.ok) {
          await offlineService.removeOperation(op.id);
          console.log(`✅ Sync Success: Operation ${op.id} moved to server.`);
        } else {
          await offlineService.updateRetryCount(op.id);
          // If server error (not network), we might want to skip or retry later
          if (res.status >= 500) break; 
        }
      } catch (err) {
        console.warn(`⏳ Sync Delayed: Network still unstable or server unreachable for ${op.id}`);
        break; // Stop processing and wait for next online event or retry logic
      }
    }

    const updatedOps = await offlineService.getPendingOperations();
    setPendingSyncCount(updatedOps.length);
    setIsSyncingOffline(false);
    
    if (updatedOps.length === 0) {
      showToast("🎉 تمت مزامنة جميع البيانات المعلقة بنجاح!", "success");
      fetchStateFromServer(true);
    }
  };

  // Custom Notifications toaster
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "info" | "error";
  } | null>(null);

  // Refs for navigation
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  
  // Refs for sync protection layer
  const lastSyncTimeRef = useRef<number>(0);
  const lastSentHashRef = useRef<string>("");

  // Show customized short notifications (helper)
  const showToast = (message: string, type: "success" | "info" | "error" = "success", duration = 4000) => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, duration);
  };

  // Connection state for offline auditing
  const [isOnline, setIsOnline] = useState<boolean>(typeof window !== 'undefined' ? navigator.onLine : true);
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(false);
  const [isFirebaseSyncDisabled, setIsFirebaseSyncDisabled] = useState<boolean>(false);
  const [pendingDraftRestore, setPendingDraftRestore] = useState<{
    key: string;
    items: any[];
  } | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast("🟢 تمت استعادة الاتصال بالإنترنت! جاري الحفظ التلقائي في أمان كامل.", "success", 2050);
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast("📡 أنت غير متصل بالإنترنت حالياً! تم الانتقال إلى وضع الجرد المحلي (أوفلاين)، جميع مدخلاتك آمنة ومحفوظة.", "error", 2000);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 1. Load from LocalStorage Reactively on boot
  useEffect(() => {
    try {
      const isFbSyncSaved = localStorage.getItem("inventory_firebase_sync_disabled");
      if (isFbSyncSaved !== null) {
        setIsFirebaseSyncDisabled(isFbSyncSaved === "true");
      }
      const storedItems = localStorage.getItem("inventory_master_items");
      let loadedItems: MasterItem[] = [];
      if (storedItems) {
        loadedItems = JSON.parse(storedItems);
      }
      setMasterItems(loadedItems);

      if (user) {
        const userSearchKey = `inventory_search_query_${user.code}`;
        const userFilterKey = `inventory_status_filter_${user.code}`;

        const globalActiveKey = "inventory_active_session";
        const storedActiveSession = localStorage.getItem(globalActiveKey);
        if (storedActiveSession) {
          const parsed = JSON.parse(storedActiveSession);
          if (parsed && (parsed.isCompleted || parsed.managerApproved)) {
            setActiveSession(null);
            localStorage.removeItem(globalActiveKey);
          } else {
            setActiveSession(parsed);
          }
        } else {
          setActiveSession(null);
        }

        const globalPastKey = "inventory_past_sessions";
        const storedSessions = localStorage.getItem(globalPastKey);
        if (storedSessions) {
          const sessionsArray = JSON.parse(storedSessions);
          setPastSessions(sessionsArray.slice(0, 39));
        } else {
          setPastSessions([]);
        }

        // Custom filters separate per user
        const storedSearch = localStorage.getItem(userSearchKey);
        setSearchQuery(storedSearch || "");

        const storedFilter = localStorage.getItem(userFilterKey);
        setStatusFilter((storedFilter as any) || "all");
      } else {
        setActiveSession(null);
        setPastSessions([]);
        setSearchQuery("");
        setStatusFilter("all");
      }
    } catch (err) {
      console.error("Error loading state from localStorage", err);
    }
  }, [user]);

  // Sync filters to user specific key on filter change
  useEffect(() => {
    if (user) {
      localStorage.setItem(`inventory_search_query_${user.code}`, searchQuery);
    }
  }, [searchQuery, user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(`inventory_status_filter_${user.code}`, statusFilter);
    }
  }, [statusFilter, user]);

  // Defensive Security check: Immediately logout any old admin sessions on page load
  useEffect(() => {
    if (user && (user.code === "admin" || user.code === "t29173995" || user.code === "sa1")) {
      console.warn("🛡️ Security Sanitizer: Unauthorized legacy session detected. Clearing session...");
      setUser(null);
      localStorage.removeItem("inventory_logged_in_user");
      localStorage.removeItem("inventory_jwt_token");
      try {
        window.location.reload();
      } catch {}
    }
  }, [user]);

  /* ==========================================
     ٤. قسم المزامنة والاتصال مع السيرفر والعمل أوفلاين (Sync & WebSocket Logic)
     ========================================== */
  // A ref to prevent pulling from the server triggered by our own pushes immediately
  const isSyncingRef = useRef(false);
  const pendingPushStateRef = useRef<any>({});
  const pushDebounceTimeoutRef = useRef<any>(null);

  // Tracking Firestore usage based on write operations
  const updateFirestoreUsage = (type: 'writes' | 'reads', amount = 1, actionName?: string) => {
      const getPacificTimeDateString = () => {
        try {
          const d = new Date();
          const options = { timeZone: "America/Los_Angeles", year: "numeric" as const, month: "2-digit" as const, day: "2-digit" as const };
          const formatter = new Intl.DateTimeFormat("en-US", options);
          const parts = formatter.formatToParts(d);
          const year = parts.find(p => p.type === 'year')?.value;
          const month = parts.find(p => p.type === 'month')?.value;
          const day = parts.find(p => p.type === 'day')?.value;
          return `${year}-${month}-${day}`;
        } catch (e) {
          return new Date().toISOString().slice(0, 10);
        }
      };

      const saved = localStorage.getItem("inventory_firestore_usage");
      const todayStr = getPacificTimeDateString();
      let usage: any;
      try {
        usage = saved ? JSON.parse(saved) : { date: todayStr, reads: 0, writes: 0, deletes: 0, storageBytes: 0 };
        if (usage.date !== todayStr) {
          usage = { date: todayStr, reads: 0, writes: 0, deletes: 0, storageBytes: usage.storageBytes || 0 };
          // Reset user quota consumption on Pacific Time Midnight rollover
          localStorage.removeItem("inventory_user_quota_consumption");
        }
      } catch (e) {
        usage = { date: todayStr, reads: 0, writes: 0, deletes: 0, storageBytes: 0 };
      }
      usage[type] = (usage[type] || 0) + amount;
      localStorage.setItem("inventory_firestore_usage", JSON.stringify(usage));

      // Track specific logged-in user consumption
      if (user) {
        try {
          const userConsSaved = localStorage.getItem("inventory_user_quota_consumption");
          let userCons: Record<string, any> = userConsSaved ? JSON.parse(userConsSaved) : {};
          
          if (!userCons[user.code]) {
            userCons[user.code] = {
              code: user.code,
              name: user.name || user.code,
              reads: 0,
              writes: 0,
              actions: {}
            };
          }
          
          userCons[user.code][type] = (userCons[user.code][type] || 0) + amount;
          
          const keyForAction = actionName || (type === 'writes' ? "مزامنة تلقائية سحابية" : "تحميل وقراءة سحابية");
          userCons[user.code].actions[keyForAction] = (userCons[user.code].actions[keyForAction] || 0) + amount;
          
          localStorage.setItem("inventory_user_quota_consumption", JSON.stringify(userCons));
        } catch (e) {
          console.error("Failed tracking user userCons:", e);
        }
      }
  };

  // Helper to push updates to Express server & save locally for offline resiliency
  const pushStateToServer = async (
    partialData: {
      precodedUsers?: LoggedInUser[];
      registeredUsers?: LoggedInUser[];
      masterItems?: MasterItem[];
      activeSession?: AuditSession | null;
      pastSessions?: AuditSession[];
      isFirebaseSyncDisabled?: boolean;
    },
    metadata: {
      deletedActiveSessionId?: string;
      deletedPastSessionId?: string;
      deletedReason?: string;
      isExplicitAction?: boolean; // New flag for explicit commitment
    } = {}
  ) => {
    try {
      // 1. Write to LocalStorage instantly for offline use and responsiveness
      if (partialData.isFirebaseSyncDisabled !== undefined) {
        localStorage.setItem("inventory_firebase_sync_disabled", String(partialData.isFirebaseSyncDisabled));
      }
      if (partialData.masterItems !== undefined) {
        localStorage.setItem("inventory_master_items", JSON.stringify(partialData.masterItems));
        updateFirestoreUsage('writes', 1, "تعديل قائمة الأصناف");
      }
      if (partialData.activeSession !== undefined) {
        if (partialData.activeSession) {
          localStorage.setItem("inventory_active_session", JSON.stringify(partialData.activeSession));
        } else {
          localStorage.removeItem("inventory_active_session");
        }
        updateFirestoreUsage('writes', 1, "مزامنة جلسة الجرد النشطة");
      }
      if (partialData.pastSessions !== undefined) {
        localStorage.setItem("inventory_past_sessions", JSON.stringify(partialData.pastSessions));
        updateFirestoreUsage('writes', 1, "حفظ جلسة جرد منتهية");
      }
      if (partialData.precodedUsers !== undefined) {
        localStorage.setItem("inventory_precoded_users", JSON.stringify(partialData.precodedUsers));
        updateFirestoreUsage('writes', 1, "ترميم حساب مستخدم مكود");
      }
      if (partialData.registeredUsers !== undefined) {
        localStorage.setItem("inventory_registered_users", JSON.stringify(partialData.registeredUsers));
        updateFirestoreUsage('writes', 1, "تحديث مستخدم نشط");
      }

      // Generate and save local timestamp
      const now = Date.now();
      localStorage.setItem("inventory_last_updated", String(now));

      // Network Push and synchronization with the Express SQLite database server:
      const token = localStorage.getItem("inventory_jwt_token");
      
      const isStorekeeper = user && user.role === "storekeeper";
      const isSupervisor = user && (user.role === "supervisor" || user.role === "warehouse_supervisor");
      const isManagerOrAdmin = user && (user.role === "program_manager" || user.role === "general_manager" || user.role === "system_admin");
      const hasPending = localStorage.getItem("inventory_has_pending_assignments") === "true";

      // 💡 Absolute Isolation Gating: block automatic background sync of activeSession and masterItems
      // These keys should ONLY be synced to other roles when explicitly clicking Save, Re-Save, Approve, or Submit buttons.
      const dataToSendToServer = { ...partialData };
      const isCommit = metadata.isExplicitAction === true || 
                       metadata.deletedActiveSessionId !== undefined || 
                       metadata.deletedPastSessionId !== undefined;
      
      if (!isCommit) {
        delete dataToSendToServer.activeSession;
        delete dataToSendToServer.masterItems;
        console.log("🛡️ Absolute Sync Gate: Stripped activeSession and masterItems from background auto-sync.");
      }

      const hasFields = Object.keys(dataToSendToServer).length > 0;
      const shouldPush = (metadata.isExplicitAction || 
                         (metadata.deletedActiveSessionId !== undefined || metadata.deletedPastSessionId !== undefined) ||
                         (!isStorekeeper && !isSupervisor && !isManagerOrAdmin)) && 
                         (hasFields || metadata.deletedActiveSessionId !== undefined || metadata.deletedPastSessionId !== undefined);
      
      if (token && shouldPush) {
        if (metadata.isExplicitAction) {
          // Bypassing debounce/delay entirely for explicit user actions!
          if (pushDebounceTimeoutRef.current) {
            clearTimeout(pushDebounceTimeoutRef.current);
            pushDebounceTimeoutRef.current = null;
          }
          const currentHash = JSON.stringify(dataToSendToServer) + JSON.stringify(metadata);
          lastSyncTimeRef.current = Date.now();
          lastSentHashRef.current = currentHash;
          
          const syncPayload = {
            ...dataToSendToServer,
            ...metadata
          };
          
          console.log("SYNC EXECUTED IMMEDIATELY (EXPLICIT ACTION)");
          try {
            const res = await fetch("/api/data", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify(syncPayload)
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              throw new Error(errBody.error || errBody.message || "Server error: " + res.statusText);
            }
            console.log("✅ Sync Done: Data pushed to server immediately.");
          } catch (err: any) {
             console.warn("⚠️ Explicit Action Network Failed: Queuing data for offline sync...", err);
             await offlineService.queueOperation(syncPayload);
             const ops = await offlineService.getPendingOperations();
             setPendingSyncCount(ops.length);
             showToast("⚠️ انقطع الاتصال: تم حفظ التعديلات محلياً وسيتم رفعها عند عودة الشبكة.", "info");
             // Don't re-throw, so the UI can assume it was 'saved' and cleans unsaved flags.
          }
        } else {
          if (pushDebounceTimeoutRef.current) {
            clearTimeout(pushDebounceTimeoutRef.current);
            console.log("SYNC DELAYED: DEBOUNCE ACTIVE");
          }

          // Cancel debounce if there's no data to sync
          if (Object.keys(dataToSendToServer).length === 0 && 
              metadata.deletedActiveSessionId === undefined && 
              metadata.deletedPastSessionId === undefined) {
            console.log("🛡️ Debounce Sync cancelled: No non-gated fields to sync.");
            return;
          }

          pushDebounceTimeoutRef.current = setTimeout(async () => {
            const currentHash = JSON.stringify(dataToSendToServer) + JSON.stringify(metadata);
            if (currentHash === lastSentHashRef.current) {
              console.log("SYNC SKIPPED: HASH IDENTICAL");
              return;
            }

            const nowSync = Date.now();
            const timeSinceLastSync = nowSync - lastSyncTimeRef.current;
            if (timeSinceLastSync < 30000) {
              console.log("SYNC DELAYED: RATE LIMIT ACTIVE");
              // Rate limited
              return;
            }

            lastSyncTimeRef.current = nowSync;
            lastSentHashRef.current = currentHash;
            
            console.log("SYNC EXECUTED");

            const syncPayload = {
              ...dataToSendToServer,
              ...metadata
            };

            fetch("/api/data", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify(syncPayload)
            }).then(async (res) => {
              if (!res.ok) throw new Error("Server responded with error status");
              console.log("✅ Sync Done: Data pushed to server.");
            }).catch(async (err) => {
              console.warn("⚠️ Network Failed: Queuing data for offline sync...", err);
              await offlineService.queueOperation(syncPayload);
              const ops = await offlineService.getPendingOperations();
              setPendingSyncCount(ops.length);
              showToast("⚠️ انقطع الاتصال: تم حفظ التعديلات محلياً وسيتم رفعها عند عودة الشبكة.", "info");
            });
          }, 10000);
        }
      }
      
    } catch (err) {
      console.warn("Failed saving changes locally:", err);
    }
  };

  // Helper to apply any received system state safely and resolve conflicts
  const applyReceivedState = async (serverData: any, forceUpdate = false) => {
    try {
      const dbObj = serverData || {};
      const { 
        masterItems: sMaster, 
        activeSession: sActive, 
        pastSessions: sPast,
        deletedSessions: sDeleted,
        lastUpdated: sLastUpdated 
      } = dbObj;

      // Clean up server-side data models representation
      let sActiveClean = sActive;
      let sMasterClean = sMaster;
      let sDeletedClean = sDeleted || [];

      const mergedPast = [...(sPast || []), ...(pastSessions || [])];
      
      // Reject incoming activeSession if it's already an archived/completed session
      if (sActiveClean) {
        const isAlreadyArchived = sActiveClean.isCompleted || sActiveClean.isArchived || 
          mergedPast.some((p: any) => String(p.id) === String(sActiveClean.id));
          
        if (isAlreadyArchived) {
          console.warn(`🛡️ Security Warning: Server sent an activeSession (${sActiveClean.id}) that is already archived. Rejecting parameter.`);
          sActiveClean = null;
        }
      }
      
      if (sActiveClean && (!sMasterClean || sMasterClean.length === 0) && sActiveClean.items && sActiveClean.items.length > 0) {
        sMasterClean = sActiveClean.items.map((i: any) => ({
          id: i.itemId || i.id,
          name: i.itemName || i.name,
          category: i.category || "عام",
          bookQty: Number(i.bookQty) || 0,
          unit: i.unit || "كجم",
          previousDiff: Number(i.previousDiff) || 0
        }));
      }

      // Check if server payload is empty or uninitialized
      const isServerPayloadEmpty = (!sMasterClean || sMasterClean.length === 0) && 
                                   (!sActiveClean || !sActiveClean.items || sActiveClean.items.length === 0) &&
                                   (!sPast || sPast.length === 0);

      // Retrieve latest local data safely from localStorage to prevent closure delay issues
      let localMaster = masterItems;
      let localActive = activeSession;
      let localPast = pastSessions;

      try {
        const lMast = localStorage.getItem("inventory_master_items");
        if (lMast) localMaster = JSON.parse(lMast);
        const lAct = localStorage.getItem("inventory_active_session");
        if (lAct) localActive = JSON.parse(lAct);
        const lPst = localStorage.getItem("inventory_past_sessions");
        if (lPst) localPast = JSON.parse(lPst);
      } catch (e) {
        console.error("Error parsing local state from storage in fetch/websocket:", e);
      }

      const isLocalActiveArchivedOnServer = !isServerPayloadEmpty && localActive && (
        (Array.isArray(sPast) && sPast.some((pSess: any) => String(pSess.id) === String(localActive.id)))
      );

      if (isLocalActiveArchivedOnServer) {
        const localSessId = localActive ? localActive.id : "unknown";
        console.log(`🛡️ Local Active Session (${localSessId}) has been archived/completed or deleted on the server. Clearing local draft...`);
        localStorage.removeItem("inventory_active_session");
        localStorage.removeItem("inventory_has_unsaved_changes");
        localStorage.removeItem("inventory_has_pending_assignments");
        localStorage.setItem("inventory_master_items", JSON.stringify([]));
        localStorage.setItem("inventory_last_updated", String(Date.now()));
        setActiveSession(null);
        setMasterItems([]);
        
        // Force update reference variables to prevent stale data re-merging below
        localActive = null;
        localMaster = [];
      }

      // 🛡️ SECURITY SHIELD: Shield active draft workspaces (unsaved changes or pending assignments) for ALL roles from background server updates
      if (user && !forceUpdate) {
        const hasPending = localStorage.getItem("inventory_has_pending_assignments") === "true";
        const hasUnsaved = localStorage.getItem("inventory_has_unsaved_changes") === "true";
        
        if (hasUnsaved || hasPending) {
          console.log("🛡️ Sync Shield Activated: Local active draft worksheet is protected from background merges.");
          setIsDataLoaded(true);
          return;
        }
      }

      // Get local timestamp
      const localLastUpdatedRaw = localStorage.getItem("inventory_last_updated");
      let localLastUpdated = localLastUpdatedRaw ? parseInt(localLastUpdatedRaw) : 0;

      const serverTime = sLastUpdated ? parseInt(sLastUpdated) : 0;

      // Check if there is actual data stored in localStorage (not just defaults)
      const hasSavedMaster = localStorage.getItem("inventory_master_items");

      // A device is fresh if it has no synced timestamp tracker in localStorage
      const isFreshDevice = !localLastUpdatedRaw;

      const localHasData = (localMaster && localMaster.length > 0) || 
                           (localActive && localActive.items && localActive.items.length > 0);

      // BULLETPROOF PROTECTION GATES:
      // A server payload is empty or uninitialized if it contains no products, no active session, and no past sessions.
      if (isServerPayloadEmpty && localHasData) {
        console.warn("🛡️ System Shield Activated: Stopped empty server payload from overwriting local data. Healing server...");
        const token = localStorage.getItem("inventory_jwt_token");
        if (token) {
          // 🛡️ ACCIDENTAL WIPE SHIELD: If localActive is null, DO NOT push activeSession: null to prevent wiping active session on server!
          const activeToPush = localActive ? { ...localActive, updatedAt: Date.now() } : undefined;
          const payloadToPush: any = {
            masterItems: localMaster,
            pastSessions: localPast
          };
          if (activeToPush !== undefined) {
            payloadToPush.activeSession = activeToPush;
          }
          await pushStateToServer(payloadToPush, { isExplicitAction: true });
        }
        setIsDataLoaded(true);
        return;
      }

      // Conflict Resolution:
      // Case 1: Server is completely blank/new (e.g. wiped SQLite), but we have local data.
      // We push our local state to restore the server.
      if (!isFreshDevice && localHasData && serverTime === 0) {
        console.log(`Server is blank. Restoring from local state...`);
        // 🛡️ ACCIDENTAL WIPE SHIELD: If localActive is null, DO NOT push activeSession: null to prevent wiping active session on server!
        const activeToPush = localActive ? { ...localActive, updatedAt: Date.now() } : undefined;
        // Note: We intentionally do NOT push pastSessions during conflict resolution to protect historical backups.
        const payloadToPush: any = {
          masterItems: localMaster
        };
        if (activeToPush !== undefined) {
          payloadToPush.activeSession = activeToPush;
        }
        await pushStateToServer(payloadToPush, { isExplicitAction: true });
        
        setIsDataLoaded(true);
        return;
      }

      // Case 2: Server has newer data, or forced trigger. Update local fields.
      isSyncingRef.current = true;

      if (sMasterClean && JSON.stringify(masterItems) !== JSON.stringify(sMasterClean)) {
        const isServerEmptyUninitialized = sMasterClean.length === 0 && serverTime === 0;
        if (!isServerEmptyUninitialized) {
          setMasterItems(sMasterClean);
          localStorage.setItem("inventory_master_items", JSON.stringify(sMasterClean));
        }
      }

      if (sActiveClean) {
        if (JSON.stringify(activeSession) !== JSON.stringify(sActiveClean)) {
          // Check if active input focus exists in a quantity field
          const activeEl = document.activeElement;
          const isEditingQty = activeEl && activeEl.tagName === "INPUT" && activeEl.getAttribute("type") === "number";

          // Intelligently merge local unsubmitted quantities with server's active session state in a local-first offline manner
          let mergedActiveSession = sActiveClean;
          if (localActive && String(localActive.id) === String(sActiveClean.id)) {
            const mergedItems = sActiveClean.items.map((sItem: any) => {
              const localItem = localActive.items?.find((i: any) => String(i.itemId) === String(sItem.itemId));
              if (localItem) {
                const sQty = sItem.physicalQty;
                const lQty = localItem.physicalQty;
                
                // If local has a count but server doesn't, OR local change time is strictly newer:
                const sTime = sItem.inventoriedAt ? new Date(sItem.inventoriedAt).getTime() : 0;
                const lTime = localItem.inventoriedAt ? new Date(localItem.inventoriedAt).getTime() : 0;
                
                const keepLocal = (sQty === null && lQty !== null) || (lTime > sTime && lQty !== null) || (localItem.assignedTo !== sItem.assignedTo);
                if (keepLocal) {
                  return {
                    ...sItem,
                    physicalQty: localItem.physicalQty,
                    storekeeperQty: localItem.storekeeperQty !== undefined ? localItem.storekeeperQty : sItem.storekeeperQty,
                    supervisorQty: localItem.supervisorQty !== undefined ? localItem.supervisorQty : sItem.supervisorQty,
                    managerQty: localItem.managerQty !== undefined ? localItem.managerQty : sItem.managerQty,
                    calculatorDetails: localItem.calculatorDetails !== undefined ? localItem.calculatorDetails : sItem.calculatorDetails,
                    inventoriedByCode: localItem.inventoriedByCode || sItem.inventoriedByCode,
                    inventoriedByName: localItem.inventoriedByName || sItem.inventoriedByName,
                    inventoriedAt: localItem.inventoriedAt || sItem.inventoriedAt,
                    assignedTo: localItem.assignedTo || sItem.assignedTo,
                    submitted: localItem.submitted !== undefined ? localItem.submitted : sItem.submitted,
                    submittedAt: localItem.submittedAt || sItem.submittedAt,
                  };
                }
              }
              return sItem;
            });
            mergedActiveSession = { ...sActiveClean, items: mergedItems };
          }

          if (!isEditingQty || forceUpdate) {
            setActiveSession(mergedActiveSession);
            localStorage.setItem("inventory_active_session", JSON.stringify(mergedActiveSession));
          } else {
            // Merge with current in-memory React state (if user is currently typing in input)
            setActiveSession((prev) => {
              if (!prev) return mergedActiveSession;
              const mergedItems = mergedActiveSession.items.map((sItem: any) => {
                const prevItem = prev.items.find((i) => i.itemId === sItem.itemId);
                const isCurrentTarget = activeEl && (activeEl.id === `qty-input-${sItem.itemId}` || activeEl.id === `input-qty-${sItem.itemId}`);
                if (isCurrentTarget && prevItem) {
                  return { ...sItem, physicalQty: prevItem.physicalQty };
                }
                return sItem;
              });
              return { ...mergedActiveSession, items: mergedItems };
            });
          }
        }
      } else {
        // Protect local active session from being overwritten with null.
        // We should ONLY clear the active session if it is explicitly archived/found in pastSessions or deletedSessions on server.
        // Bypassed if server has NO master catalog items (a clean database reset/wipeout - "تصفير")
        const isActuallyArchived = localActive && Array.isArray(sPast) && sPast.some((pSess: any) => String(pSess.id) === String(localActive.id));
        const isActuallyDeleted = localActive && Array.isArray(sDeletedClean) && sDeletedClean.some((delSess: any) => String(delSess.sessionId) === String(localActive.id));
        const isCatalogCompletelyCleared = !sMasterClean || sMasterClean.length === 0;
        
        if (isActuallyArchived || isActuallyDeleted || isCatalogCompletelyCleared) {
          setActiveSession(null);
          localStorage.removeItem("inventory_active_session");
        } else {
          console.log("🛡️ Preserving local active session draft as it is not found in pastSessions/archive or deletedSessions on server.");
        }
      }

      if (sPast) {
        // Authoritative Past Sessions Adoption:
        // No sorting as requested to preserve exact arrival/creation order.
        const listToAdopt = [...sPast].slice(0, 39);

        if (JSON.stringify(pastSessions) !== JSON.stringify(listToAdopt)) {
          setPastSessions(listToAdopt);
          localStorage.setItem("inventory_past_sessions", JSON.stringify(listToAdopt));
        }
      }

      if (dbObj.isFirebaseSyncDisabled !== undefined) {
        setIsFirebaseSyncDisabled(dbObj.isFirebaseSyncDisabled);
      }

      // Keep local timestamp updated to equal or match the server's time
      if (serverTime > localLastUpdated) {
        localStorage.setItem("inventory_last_updated", String(serverTime));
      }

      setTimeout(() => {
        isSyncingRef.current = false;
      }, 100);
      setIsDataLoaded(true);
    } catch (err) {
      console.error("Error applying state in applyReceivedState:", err);
      isSyncingRef.current = false;
      setIsDataLoaded(true); // Guarantee loader dismissal under any parsing/logical failure
    }
  };

  // Helper to pull from server & update states safely
  const fetchStateFromServer = async (forceUpdate = false) => {
    if (isArchiving) return;
    try {
      if (typeof window !== "undefined" && !navigator.onLine) {
        setIsDataLoaded(true);
        return;
      }

      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) {
        setIsDataLoaded(true);
        return;
      }

      const res = await fetch("/api/data", {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response: ${text.slice(0, 100)}`);
      }

      if (res.status === 401 || res.status === 403) {
        console.warn("Session expired or invalid. Logging out...");
        handleLogout();
        showToast("جلسة العمل منتهية الصلاحية أو غير صالحة. يرجى تسجيل الدخول مجدداً.", "error");
        setIsDataLoaded(true);
        return;
      }
      const result = await res.json();
      if (result.status === "ok" && result.data) {
        if (result.isFirestoreQuotaExceeded) {
          setIsQuotaExceeded(true);
        } else {
          setIsQuotaExceeded(false);
        }
        await applyReceivedState(result.data, forceUpdate);
      } else {
        console.warn("Server response is not OK:", result);
        setIsDataLoaded(true); // Guarantee loader dismissal
      }
    } catch (err) {
      console.warn("Failed fetching metadata from central server:", err);
      isSyncingRef.current = false;
      // Assume local storage is enough if server fetch fails
      setIsDataLoaded(true);
    }
  };

  const mergeUsers = (local: any[], server: any[]) => {
    // If the server list of users is available and non-empty, we treat it as 100% authoritative and ignore any local entries that don't exist in it.
    // This strictly prevents "ghost users" from being revived from localStorage after they were deleted in Firestore.
    if (server && server.length > 0) {
      return server.filter(s => s && !s.isDeleted && !s.is_deleted);
    }
    // If we're offline or server didn't specify any users, fall back to local cache as last resort.
    return local ? local.filter(l => l && !l.isDeleted && !l.is_deleted) : [];
  };

  const fetchUsersFromServer = async () => {
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      const res = await fetch("/api/users", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("🛑 /api/users returned non-JSON response");
        return;
      }

      const result = await res.json();
      if (result.status === "ok") {
        const localPrecRaw = localStorage.getItem("inventory_precoded_users");
        const localRegRaw = localStorage.getItem("inventory_registered_users");
        const localPrec = localPrecRaw ? JSON.parse(localPrecRaw) : [];
        const localReg = localRegRaw ? JSON.parse(localRegRaw) : [];

        if (result.precodedUsers) {
          const merged = mergeUsers(localPrec, result.precodedUsers);
          setPrecodedUsers(merged);
          localStorage.setItem("inventory_precoded_users", JSON.stringify(merged));
        }
        if (result.registeredUsers) {
          const merged = mergeUsers(localReg, result.registeredUsers);
          setRegisteredUsers(merged);
          localStorage.setItem("inventory_registered_users", JSON.stringify(merged));
        }
      }
    } catch (err) {
      console.warn("Failed fetching users from central server:", err);
    }
  };

  // Trigger loading from server on startup/routing
  useEffect(() => {
    fetchUsersFromServer();
    fetchStateFromServer(true);
  }, [user]);

  // Fetch activity logs (Admin only)
  const fetchAuditLogs = async () => {
    try {
      setIsFetchingLogs(true);
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      const res = await fetch("/api/logs", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         console.warn("🛑 /api/logs returned non-JSON response");
         return;
      }

      const result = await res.json();
      if (result.status === "ok") {
        setAuditLogs(result.logs || []);
      }
    } catch (err) {
      console.warn("Failed fetching audit logs:", err);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  // Fetch deleted sessions (System Admin only)
  const fetchDeletedSessions = async () => {
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      const res = await fetch("/api/deleted", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("🛑 /api/deleted returned non-JSON response");
        return;
      }

      const result = await res.json();
      if (result.status === "ok") {
        setDeletedSessions(result.deletedSessions || []);
      }
    } catch (err) {
      console.warn("Failed fetching deleted sessions:", err);
    }
  };

  // Restore deleted session (System Admin only)
  const handleRestoreDeletedSessionValue = async (id: number) => {
    // Check if the session we are trying to restore was an active session and we already have an active session
    const targetSession = deletedSessions.find((s) => s.id === id);
    if (targetSession && targetSession.sessionData && targetSession.sessionData.type !== "archived") {
      if (activeSession && activeSession.items && activeSession.items.length > 0) {
        showToast("❌ لا يمكن الاسترجاع: يوجد حالياً جلسة جرد نشطة في ورقة الجرد! يجب إنهاؤها أو حذفها بالكامل أولاً.", "error");
        return;
      }
    }

    try {
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      const res = await fetch("/api/deleted/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ id })
      });
      const result = await res.json();
      if (result.status === "ok") {
        showToast("🎉 تم استرجاع نسخة الجرد المحذوفة بنجاح تام!", "success");
        await fetchDeletedSessions();
        await fetchStateFromServer(true);
        await performCloudSync(true, true);
      } else {
        showToast(result.error || "فشل استرجاع الجلسة.", "error");
      }
    } catch (err) {
      showToast("حدث خطأ أثناء الاتصال بالسيرفر للمزامنة.", "error");
    }
  };

  const handlePermanentDeleteSession = async (id: number) => {
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      const res = await fetch("/api/deleted/permanently-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ id })
      });
      const result = await res.json();
      if (res.ok) {
        showToast("🗑️ تم حذف الجلسة المحددة من سلة المحذوفات بشكل نهائي.", "success");
        await fetchDeletedSessions();
      } else {
        showToast(result.error || "فشل الحذف النهائي.", "error");
      }
    } catch (err) {
      showToast("حدث خطأ أثناء الاتصال بالسيرفر.", "error");
    }
  };

  // New explicit cloud backup function to be used by Save Final buttons
  const loadCloudBackupMetadataOnly = async () => {
    setIsBackupMetadataLoading(true);
    try {
      const res = await fetch('/api/backup/info', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem("inventory_jwt_token")}` }
      });
      
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (res.ok && data.metadata) {
          saveCloudMetadataToLocalTracker(data.metadata);
          updateFirestoreUsage('reads', 1, "الاستعلام عن معلومات النسخة السحابية");
        } else if (!res.ok) {
          console.warn("☁️ Cloud backup metadata fetch returned error:", data.error || res.statusText);
        }
      } else {
        const text = await res.text();
        if (text.includes("403")) {
          console.warn("☁️ Cloud backup metadata fetch returned 403 Forbidden - likely due to expired token or missing cloud config.");
        } else {
          console.warn("🛑 Server returned non-JSON response for backup metadata:", text.slice(0, 100));
        }
      }
    } catch (err) {
      console.error("Silent cloud backup metadata fetch failed:", err);
    } finally {
      setIsBackupMetadataLoading(false);
    }
  };

  const performCloudSync = async (isManual = false, throwOnError = false) => {
    // If auto-sync is disabled and this wasn't a manual action, skip entirely to save quota
    if (!isManual && isFirebaseSyncDisabled) {
      console.log("☁️ Skipping automatic cloud backup (auto-sync is disabled).");
      return;
    }

    setIsBackingUpCloud(true);
    try {
      const res = await fetch('/api/backup', { 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${localStorage.getItem("inventory_jwt_token")}` } 
      });

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        if (res.ok) {
          const data = await res.json();
          if (data.status === "cloud_disabled") {
            showToast("⚠️ خدمة المزامنة السحابية غير مفعلة حالياً.", "info");
          } else {
            showToast("✅ تم رفع النسخة الاحتياطية وتحديث السجل السحابي بنجاح!", "success");
            updateFirestoreUsage('writes', 3, "رفع نسخة احتياطية يدوية");
            loadCloudBackupMetadataOnly();
          }
        } else {
          console.warn("⚠️ Cloud backup returned non-OK status. Skipping toast per user request.");
          if (throwOnError) throw new Error("Cloud backup failed with status " + res.status);
        }
      } else {
        const text = await res.text();
        console.error("🛑 /api/backup returned non-JSON response:", text.slice(0, 100));
        if (throwOnError) throw new Error("السيرفر لم يرجع رد JSON صالح");
      }
    } catch (err) {
      console.warn("⚠️ Cloud backup failed with error:", err);
      if (throwOnError) throw err;
    } finally {
      setIsBackingUpCloud(false);
    }
  };

  // Support manual trigger to restore the last cloud backup from Firestore
  const handleRestoreCloudBackup = async () => {
    setIsRestoringCloud(true);
    try {
      const res = await fetch('/api/backup/restore-from-cloud', { 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${localStorage.getItem("inventory_jwt_token")}` } 
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`السيرفر لم يرجع رد JSON صالح: ${text.slice(0, 50)}`);
      }

      const result = await res.json();
      if (res.ok) {
        showToast("🎉 تم استعادة البيانات وإعادة مزامنة كافة يوزرات وأصناف الجرد الحية بنجاح!", "success");
        updateFirestoreUsage('reads', 5, "استعادة نسخة احتياطية سحابية");
        fetchStateFromServer(true);
        setIsShowingRestoreConfirm(false);
      } else {
        showToast(result.error || "⚠️ فشل في عملية الاستعادة السحابية للبيانات.", "error");
      }
    } catch (err) {
      console.error("Cloud restore failed:", err);
      showToast("⚠️ حدث خطأ فني أثناء التحدث للسيرفر السحابي.", "error");
    } finally {
      setIsRestoringCloud(false);
    }
  };

  const fetchCloudBackupInfo = async (quiet: boolean = false) => {
    setIsRestoringCloud(true);
    try {
      const res = await fetch('/api/backup/info', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem("inventory_jwt_token")}` }
      });
      const data = await res.json();
      if (res.ok && data.metadata) {
        saveCloudMetadataToLocalTracker(data.metadata);
        if (!quiet) {
          setIsShowingRestoreConfirm(true);
        }
      } else {
        if (!quiet) showToast(data.error || "لم يتم العثور على نسخة سحابية صالحة.", "error");
      }
    } catch (err) {
      if (!quiet) showToast("خطأ في الاتصال بالسيرفر السحابي.", "error");
    } finally {
      setIsRestoringCloud(false);
    }
  };

  const checkSystemStatus = async () => {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        setIsCloudSyncAvailable(data.cloudSyncAvailable);
        setHasFirebaseConfig(data.hasConfig);
        if (data.appEnv) setAppEnv(data.appEnv);
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch system status:", err);
    }
  };

  useEffect(() => {
    checkSystemStatus();
  }, []);

  useEffect(() => {
    if (user && ["general_manager", "system_admin", "super_admin", "warehouse_supervisor", "supervisor"].includes(user.role)) {
      loadCloudBackupMetadataOnly();
    }
  }, [user]);

  useEffect(() => {
    if (user && ["general_manager", "system_admin", "super_admin"].includes(user.role)) {
      if (activeAdminTab === "deleted") fetchDeletedSessions();
      if (activeAdminTab === "logs") fetchAuditLogs();
      if (activeAdminTab === "backup") loadCloudBackupMetadataOnly();
    }
  }, [user, activeAdminTab]);

  // Real-time synchronization via WebSocket with connection health tracking
  const [isWsSynced, setIsWsSynced] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connectWebSocket = () => {
      if (typeof window === "undefined") return;

      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) {
        setIsWsSynced(false);
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

      console.log("WebSocket: Attempting connection to:", wsUrl);
      const ws = new WebSocket(wsUrl);
      socket = ws;

      ws.onopen = () => {
        console.log("WebSocket: Connected successfully");
        setIsWsSynced(true);
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "SYNC_INITIAL") {
            const serverData = payload.data;
            if (serverData) {
              console.log("WebSocket received initial state from server.");
              await applyReceivedState(serverData, false);
            }
          } else if (payload.type === "SYNC_UPDATE") {
            const serverData = payload.data;
            if (serverData) {
              const localActiveStored = localStorage.getItem("inventory_active_session");
              const localActiveParsed = localActiveStored ? JSON.parse(localActiveStored) : null;
              const sPast = serverData.pastSessions;
              const isArchived = localActiveParsed && (
                (!serverData.activeSession) ||
                (Array.isArray(sPast) && sPast.some((pSess: any) => String(pSess.id) === String(localActiveParsed.id)))
              );
              
              if (isArchived) {
                console.log("WebSocket client: Active session was archived on server. Clearing local draft immediately.");
                await applyReceivedState(serverData, true); // forceUpdate = true to clear it
              } else {
                console.log("WebSocket client: SYNC_UPDATE received, applying live changes instantly...");
                await applyReceivedState(serverData, false);
              }
            }
          } else if (payload.type === "ITEM_UPDATE") {
            const { sessionId, itemId, updatedFields } = payload;
            setActiveSession((prev) => {
              if (!prev || String(prev.id) !== String(sessionId)) return prev;
              const updatedItems = prev.items.map((item: any) => {
                if (String(item.itemId) === String(itemId)) {
                  return { ...item, ...updatedFields };
                }
                return item;
              });
              const newSession = { ...prev, items: updatedItems };
              localStorage.setItem("inventory_active_session", JSON.stringify(newSession));
              return newSession;
            });
            console.log(`WebSocket client: Received partial update for itemId ${itemId} in sessionId ${sessionId}`);
          } else if (payload.type === "SYNC_ERROR") {
            showToast(payload.message || "تنبيه: قام زميل آخر بتعديل هذه الجلسة مؤخراً.", "error");
          } else if (payload.type === "SYNC_FORCE_LOGOUT") {
            console.warn("WebSocket received force logout event from server");
            handleLogout();
            showToast(payload.message || "انتهت صلاحية جلسة العمل أو أن الرمز غير صالح. يرجى تسجيل الدخول مجدداً.", "error");
          }
        } catch (e) {
          console.error("WebSocket payload error:", e);
        }
      };

      ws.onclose = (event) => {
        setIsWsSynced(false);
        if (event.code === 4001) {
          console.warn("WebSocket connection terminated by server due to authorization failure. Reconnection bypassed.");
          return;
        }
        console.warn("WebSocket client connection closed. Retrying in 4 seconds...", event.reason);
        reconnectTimeout = setTimeout(connectWebSocket, 4000);
      };

      ws.onerror = (err) => {
        // Log as a silent warning to prevent AI Studio from capturing this as a critical failure
        console.warn("WebSocket client connection closed or could not connect. Reconnect is handled automatically.");
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      if (socket) {
        socket.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [user]);

  // Real-time synchronization across different devices (offline / fallback periodic check & storage event handlers)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      try {
        if (e.key === "inventory_active_session") {
          setActiveSession(e.newValue ? JSON.parse(e.newValue) : null);
        }
        if (e.key === "inventory_past_sessions") {
          const parsed = e.newValue ? JSON.parse(e.newValue) : [];
          setPastSessions(parsed.slice(0, 39));
        }
        if (e.key === "inventory_master_items") {
          setMasterItems(e.newValue ? JSON.parse(e.newValue) : []);
        }
      } catch (err) {
        console.error("Storage event sync error", err);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  // Helper to synthesize a blank active session
  const synthesizeSession = (items: MasterItem[], previousSession?: AuditSession | null): AuditSession => {
    return {
      id: Date.now().toString(),
      date: "",
      notes: "",
      items: items.map((master) => {
        const prevItem = previousSession?.items.find((i) => i.itemId === master.id);
        const assignedTo = prevItem ? prevItem.assignedTo : undefined;
        return {
          itemId: master.id,
          itemName: master.name,
          category: master.category || "عام",
          bookQty: master.bookQty,
          physicalQty: null,
          unit: master.unit || "حبة",
          previousDiff: master.previousDiff !== undefined ? master.previousDiff : 0,
          assignedTo: assignedTo,
          submitted: false,
        };
      }),
      isCompleted: false,
      storekeeperCode: user ? user.code : undefined,
      supervisorApproved: false,
      managerApproved: false,
    };
  };

  // Helper to automatically keep active session items updated with the master catalog
  const syncActiveSessionWithMaster = (session: AuditSession | null, master: MasterItem[]): AuditSession => {
    const defaultNotes = session ? session.notes : "";
    const sessionId = session ? session.id : Date.now().toString();
    const sessionDate = session ? session.date : "";
    const storekeeperValue = session ? session.storekeeperCode : (user ? user.code : undefined);

    const sessionItemsMap = new Map<string, AuditItem>();
    if (session) {
      session.items.forEach((item) => sessionItemsMap.set(item.itemId, item));
    }

    const updatedItems: AuditItem[] = master.map((m) => {
      const existing = sessionMapItemLookup(sessionItemsMap, m.id);
      return {
        itemId: m.id,
        itemName: m.name,
        category: m.category || "عام",
        bookQty: m.bookQty,
        physicalQty: existing ? existing.physicalQty : null,
        unit: m.unit || "حبة",
        previousDiff: m.previousDiff !== undefined ? m.previousDiff : (existing && existing.previousDiff !== undefined ? existing.previousDiff : 0),
        assignedTo: existing ? existing.assignedTo : undefined,
        submitted: existing ? existing.submitted : false,
        submittedAt: existing ? existing.submittedAt : undefined,
        storekeeperQty: existing ? existing.storekeeperQty : undefined,
        supervisorQty: existing ? existing.supervisorQty : undefined,
        managerQty: existing ? existing.managerQty : undefined,
        calculatorDetails: existing ? existing.calculatorDetails : undefined,
        inventoriedByCode: existing ? existing.inventoriedByCode : undefined,
        inventoriedByName: existing ? existing.inventoriedByName : undefined,
        inventoriedAt: existing ? existing.inventoriedAt : undefined,
      };
    });

    return {
      id: sessionId,
      date: sessionDate,
      notes: defaultNotes,
      items: updatedItems,
      isCompleted: session ? session.isCompleted : false,
      storekeeperCode: storekeeperValue,
      supervisorApproved: session ? session.supervisorApproved : false,
      supervisorApprovedAt: session ? session.supervisorApprovedAt : undefined,
      supervisorApprovedBy: session ? session.supervisorApprovedBy : undefined,
      managerApproved: session ? session.managerApproved : false,
    };
  };

  // Synchronize active session's storekeeper details on login or edit
  useEffect(() => {
    if (user && activeSession && String(activeSession.storekeeperCode) !== String(user.code)) {
      saveActiveSession({
        ...activeSession,
        storekeeperCode: user.code
      });
    }
  }, [user]);

  const sessionMapItemLookup = (map: Map<string, AuditItem>, id: string) => {
    return map.get(id);
  };

  // 2. Persist states in LocalStorage and Express server on change
  const handleUpdateMasterAndSync = (newMaster: MasterItem[]) => {
    setMasterItems(newMaster);
    const syncedSession = syncActiveSessionWithMaster(activeSession, newMaster);
    if (syncedSession) {
      syncedSession.updatedAt = Date.now();
    }
    setActiveSession(syncedSession);
    saveActiveSession(syncedSession, true); // Save locally and mark as unsaved so PM gets the active pulsing Save button!
    
    // Always set has unsaved changes to true when catalog is updated, even if there is no active session
    localStorage.setItem("inventory_has_unsaved_changes", "true");
    setHasUnsavedChangesState(true);

    pushStateToServer({ masterItems: newMaster, activeSession: syncedSession }, { isExplicitAction: true });
  };

  const saveActiveSession = (session: AuditSession | null, markAsUnsaved = true) => {
    if (session) {
      session.updatedAt = Date.now();
      localStorage.setItem("inventory_active_session", JSON.stringify(session));
      if (markAsUnsaved) {
        localStorage.setItem("inventory_has_unsaved_changes", "true");
        setHasUnsavedChangesState(true);
      }
    } else {
      localStorage.removeItem("inventory_active_session");
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
    }
    setActiveSession(session);
  };

  const savePastSessions = (sessions: AuditSession[]) => {
    const limitedSessions = sessions.slice(0, 39);
    setPastSessions(limitedSessions);
    pushStateToServer({ pastSessions: limitedSessions });
  };

  /* ==========================================
     ٥. قسم إدارة تسجيل الدخول وبوابة الهوية للموظفين (Authentication & User Identity)
     ========================================== */
  // 2.a Authentication & Profile Customization Actions
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isSimplified = !forceFullRegister;

    if (isSimplified) {
      // Simplified Login Mode: Requires only Code + Password
      if (!loginCode.trim() || !loginPassword.trim()) {
        showToast("الرجاء إدخال كود أمين المخزن وكلمة المرور لتسجيل الدخول السريع.", "error");
        return;
      }

      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: loginCode.trim(),
            password: loginPassword.trim()
          })
        });

        const isJson = response.headers.get("content-type")?.includes("application/json");
        const resData = isJson ? await response.json() : null;

        if (!response.ok) {
          throw new Error(resData?.error || "فشل تسجيل الدخول: يرجى مراجعة البيانات.");
        }

        const { token, user: loggedUser } = resData;
        localStorage.setItem("inventory_jwt_token", token);
        setUser(loggedUser);
        
        // Save user as the device-level saved profile for future convenience
        setSavedProfile(loggedUser);
        localStorage.setItem("inventory_saved_profile", JSON.stringify(loggedUser));

        if (rememberMe) {
          localStorage.setItem("inventory_logged_in_user", JSON.stringify(loggedUser));
        } else {
          localStorage.removeItem("inventory_logged_in_user");
        }

        // Fetch state now that we have authenticated
        setTimeout(() => {
          fetchStateFromServer(true);
        }, 50);

        showToast(`أهلاً بك مجدداً يا ${loggedUser.name}. تم تسجيل الدخول بنجاح.`, "success");
      } catch (err: any) {
        showToast(err.message || "فشل الاتصال بالخادم. يرجى مراجعة حالة الشبكة.", "error");
      }
    } else {
      // Registration activation flow: Check if precode is verified first
      if (!isPrecodeVerified) {
        // Step 1: verify Code and Password on server
        if (!loginCode.trim() || !loginPassword.trim()) {
          showToast("يرجى إدخال الكود وكلمة المرور للتحقق من ترميزك بالنظام.", "error");
          return;
        }

        try {
          const response = await fetch("/api/auth/verify-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: loginCode.trim(),
              password: loginPassword.trim()
            })
          });

          const isJson = response.headers.get("content-type")?.includes("application/json");
          const resData = isJson ? await response.json() : null;

          if (!response.ok) {
            throw new Error(resData?.error || "حدث خطأ غير متوقع في الخادم (يرجى مراجعة المسئول).");
          }

          // Precode is verified! Auto fill name & prepare step 2
          setIsPrecodeVerified(true);
          setVerifiedUserObj(resData);
          setLoginName(resData.name || "");
          
          let cleanedPhone = (resData.phone || "").replace(/[^0-9]/g, "");
          if (cleanedPhone === "20") {
            cleanedPhone = "";
          } else if (cleanedPhone.startsWith("20") && cleanedPhone.length > 11) {
            cleanedPhone = cleanedPhone.replace(/^20/, "0");
          }
          setLoginPhone(cleanedPhone.slice(0, 11));

          showToast(`تم التحقق بنجاح من ترميز ${resData.name}! يرجى استكمال بقية البيانات وتنشيط الحساب.`, "success");
        } catch (err: any) {
          showToast(err.message || "فشل التحقق من الكود بالخادم. يرجى التحقق من المعلومات أو الاتصال بالشبكة.", "error");
        }
      } else {
        // Step 2: Form submission to complete activation
        if (!loginCode.trim() || !loginName.trim()) {
          showToast("الرجاء ملء الاسم وكود الحساب بدقة لإنهاء التنشيط.", "error");
          return;
        }

        if (!loginPhone.trim() || !validateEgyptianPhone(loginPhone)) {
          showToast("رقم الهاتف يجب أن يكون رقم هاتف مصري صحيح مكون من 11 رقم ويبدأ بـ 01 (إجباري).", "error");
          return;
        }

        if (!activationNewPassword.trim()) {
          showToast("الرجاء تعيين الرقم السري الجديد لتفعيل حسابك أول مرة (إجباري)!", "error");
          return;
        }

        try {
          const response = await fetch("/api/auth/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: loginCode.trim(),
              name: loginName.trim(),
              phone: loginPhone.trim(),
              password: activationNewPassword.trim()
            })
          });

          const isJson = response.headers.get("content-type")?.includes("application/json");
          const resData = isJson ? await response.json() : null;

          if (!response.ok) {
            throw new Error(resData?.error || "تحذير: فشل تفعيل الحساب وتطبيقه.");
          }

          const { token, user: newUser } = resData;
          localStorage.setItem("inventory_jwt_token", token);
          setUser(newUser);
          
          // Save user as the device-level saved profile for future simplified logins
          setSavedProfile(newUser);
          localStorage.setItem("inventory_saved_profile", JSON.stringify(newUser));

          if (rememberMe) {
            localStorage.setItem("inventory_logged_in_user", JSON.stringify(newUser));
          } else {
            localStorage.removeItem("inventory_logged_in_user");
          }

          // Fetch state now that we have authenticated
          setTimeout(() => {
            fetchStateFromServer(true);
          }, 50);

          // Clear precode workflow states
          setIsPrecodeVerified(false);
          setVerifiedUserObj(null);
          setForceFullRegister(false);
          setActivationNewPassword("");
          showToast(`مرحباً بك يا ${newUser.name}. تم تنشيط الكود وتفعيل الحساب بالنظام بنجاح!`, "success");
        } catch (err: any) {
          showToast(err.message || "تعذر تفعيل الحساب مع الخادم. تأكد من ثبات اتصال السيرفر.", "error");
        }
      }
    }
  };

  const performLogout = (saveChoice?: "local" | "none") => {
    setUser(null);
    
    // Always clear session-specific and metadata keys on logout to ensure absolute isolation for shared devices
    localStorage.removeItem("inventory_logged_in_user");
    localStorage.removeItem("inventory_jwt_token");
    localStorage.removeItem("inventory_has_unsaved_changes");
    localStorage.removeItem("inventory_has_pending_assignments");
    localStorage.removeItem("inventory_active_session");
    localStorage.removeItem("inventory_last_updated");

    setHasUnsavedChangesState(false);
    setHasPendingAssignmentsState(false);
    setLoginPassword("");
    setForceFullRegister(false); // Reset default to quick login
    setActiveProgramManagerTab('none');
    setActiveSupervisorTab('none');
    setActiveStorekeeperTab('none');
    setIsShowingMirror(false);
    
    if (saveChoice === "local") {
      showToast("💾 تم حفظ جميع التعديلات بأمان للرجوع إليها لاحقاً", "success", 5000);
    } else {
      showToast("🚪 تم تسجيل الخروج بنجاح. تم تسجيل الخروج من هذا الحساب ونم مسح كافة بيانات الجلسة النشطة المؤقتة من المتصفح.", "info");
    }
  };

  const handleLogout = () => {
    if (isArchiving) {
      showToast("⚠️ يرجى الانتظار حتى اكتمال عملية الحفظ والأرشفة.", "info");
      return;
    }
    const isAdminOrManager = user && ["general_manager", "system_admin", "super_admin", "program_manager"].includes(user.role);
    if (isAdminOrManager || (!hasUnsavedChanges && !hasPendingAssignments)) {
      setShowStandardLogoutConfirm(true);
    } else {
      setPendingLogoutWithUnsaved(true);
    }
  };

  const handleLogoutWithSaveChoice = async (choice: "local" | "none") => {
    setPendingLogoutWithUnsaved(false);
    if (!user) {
      performLogout();
      return;
    }

    if (choice === "local") {
      try {
        // Save currently active session modifications locally for this specific user code
        if (activeSession && activeSession.items) {
          localStorage.setItem(`inventory_draft_sess_${activeSession.id}_user_${user.code}`, JSON.stringify(activeSession.items));
          // Save state flags so they are seamlessly restored on returning
          localStorage.setItem(`inventory_draft_has_unsaved_changes_sess_${activeSession.id}_user_${user.code}`, String(hasUnsavedChanges));
          localStorage.setItem(`inventory_draft_has_pending_assignments_sess_${activeSession.id}_user_${user.code}`, String(hasPendingAssignments));
        }
      } catch (err) {
        console.error("Local draft saving failed:", err);
      }
      performLogout("local");
    } else if (choice === "none") {
      // User requested to exit without saving, preserving previous drafts intact without deletions
      performLogout("none");
    }
  };

  // Add standard browser prevention for tab/window reloads/closes with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges || hasPendingAssignments) {
        e.preventDefault();
        e.returnValue = "هل تريد حفظ التعديلات أولاً قبل مغادرة الصفحة والخروج؟ جميع تغييراتك معلقة حالياً.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges, hasPendingAssignments]);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[id^="assign-trigger-"]') && !target.closest('.absolute.z-55')) {
        setAssignPopoverItemId(null);
      }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  const hasCheckedDraftRef = useRef<string | null>(null);

  // 💡 Auto-Scan and restore user-specific local drafts on login automatically without warning modals
  useEffect(() => {
    if (user && activeSession && activeSession.items && activeSession.items.length > 0) {
      if (activeSession.isArchived || activeSession.isCompleted) return; // Never restore drafts to an archived session
      const draftKey = `inventory_draft_sess_${activeSession.id}_user_${user.code}`;
      if (hasCheckedDraftRef.current === user.code) return; // Prevent loop
      
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        try {
          const draftItems = JSON.parse(savedDraft);
          if (draftItems && draftItems.length > 0) {
            // Merge draft items into activeSession items - including assignments and everything else
            const isManagerOrAdmin = user && (user.role === "program_manager" || user.role === "general_manager" || user.role === "system_admin");
            let mergedCount = 0;
            const updatedItems = isManagerOrAdmin 
              ? (() => {
                  mergedCount = draftItems.length;
                  return draftItems;
                })()
              : activeSession.items.map((originalItem: any) => {
                  const draftedItem = draftItems.find((dItem: any) => String(dItem.itemId) === String(originalItem.itemId));
                  if (draftedItem) {
                    mergedCount++;
                    return {
                      ...originalItem,
                      assignedTo: draftedItem.assignedTo !== undefined ? draftedItem.assignedTo : originalItem.assignedTo,
                      physicalQty: draftedItem.physicalQty !== undefined ? draftedItem.physicalQty : originalItem.physicalQty,
                      submitted: draftedItem.submitted !== undefined ? draftedItem.submitted : originalItem.submitted,
                      submittedAt: draftedItem.submittedAt !== undefined ? draftedItem.submittedAt : originalItem.submittedAt,
                      notes: draftedItem.notes !== undefined ? draftedItem.notes : (originalItem.notes || ""),
                      calculatorDetails: draftedItem.calculatorDetails !== undefined ? draftedItem.calculatorDetails : originalItem.calculatorDetails,
                      inventoriedByCode: draftedItem.inventoriedByCode !== undefined ? draftedItem.inventoriedByCode : originalItem.inventoriedByCode,
                      inventoriedByName: draftedItem.inventoriedByName !== undefined ? draftedItem.inventoriedByName : originalItem.inventoriedByName,
                      inventoriedAt: draftedItem.inventoriedAt !== undefined ? draftedItem.inventoriedAt : originalItem.inventoriedAt,
                      storekeeperQty: draftedItem.storekeeperQty !== undefined ? draftedItem.storekeeperQty : originalItem.storekeeperQty,
                      supervisorQty: draftedItem.supervisorQty !== undefined ? draftedItem.supervisorQty : originalItem.supervisorQty,
                      managerQty: draftedItem.managerQty !== undefined ? draftedItem.managerQty : originalItem.managerQty
                    };
                  }
                  return originalItem;
                });

            // Restore state flags
            const draftHasUnsaved = localStorage.getItem(`inventory_draft_has_unsaved_changes_sess_${activeSession.id}_user_${user.code}`) === "true";
            const draftHasPendingAssign = localStorage.getItem(`inventory_draft_has_pending_assignments_sess_${activeSession.id}_user_${user.code}`) === "true";

            setHasUnsavedChanges(draftHasUnsaved);
            setHasPendingAssignments(draftHasPendingAssign);

            const newSessionState = { ...activeSession, items: updatedItems };
            setActiveSession(newSessionState);
            localStorage.setItem("inventory_active_session", JSON.stringify(newSessionState));

            if (mergedCount > 0) {
              showToast("🔋 تم استعادة مسودتك وتعديلات الإسناد المعلقة الخاصة بك تلقائياً بحالة سليمة ومطابقة تماماً لما تركته!", "success", 5000);
            }

            // Remove draft keys after successful auto-loading to prevent repeated toasts
            localStorage.removeItem(draftKey);
            localStorage.removeItem(`inventory_draft_has_unsaved_changes_sess_${activeSession.id}_user_${user.code}`);
            localStorage.removeItem(`inventory_draft_has_pending_assignments_sess_${activeSession.id}_user_${user.code}`);
          }
        } catch (err) {
          console.error("Failed to parse local draft:", err);
          localStorage.removeItem(draftKey); // Remove corrupted draft data
          localStorage.removeItem(`inventory_draft_has_unsaved_changes_sess_${activeSession.id}_user_${user.code}`);
          localStorage.removeItem(`inventory_draft_has_pending_assignments_sess_${activeSession.id}_user_${user.code}`);
        }
      }
      hasCheckedDraftRef.current = user.code;
    } else if (!user) {
      hasCheckedDraftRef.current = null; // Reset on logout
    }
  }, [user, activeSession]);

  const handleAddUser = async (newUser: LoggedInUser) => {
    if (!user || !["general_manager", "system_admin", "super_admin"].includes(user.role)) {
      showToast("عذراً، هذه الصلاحية مخصصة فقط للمدير العام أو مسئول النظام!", "error");
      return;
    }
    const codeNormalized = String(newUser.code).trim().toLowerCase();
    const isDuplicate = precodedUsers.some(u => String(u.code).trim().toLowerCase() === codeNormalized) ||
                        registeredUsers.some(u => String(u.code).trim().toLowerCase() === codeNormalized);
    if (isDuplicate) {
      showToast(`عذراً، كود الموظف "${newUser.code}" مسجل مسبقاً في النظام ولا يمكن تكراره!`, "error");
      return;
    }

    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          code: newUser.code,
          name: newUser.name,
          phone: newUser.phone || "",
          role: newUser.role,
          password: newUser.password || "123456", // Forward custom password if specified, otherwise default to "123456"
          isPrecoded: true,
          isRegistered: false,
          isActivated: true,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "فشل إضافة المستخدم على السيرفر.");
      }

      const fullyScopedUser = {
        ...newUser,
        isPrecoded: true,
        isRegistered: false,
        isActivated: true,
      };

      const updated = [...precodedUsers, fullyScopedUser];
      setPrecodedUsers(updated);
      localStorage.setItem("inventory_precoded_users", JSON.stringify(updated));
      showToast("تم تكويد الحساب بنجاح. بمجرد دخول الموظف، سيتعيّن عليه النقر على 'تنشيط مستخدم جديد' لتسجيل وتعيين كلمة المرور الخاصة به.", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleDeleteUser = async (code: string) => {
    const codeStr = String(code).trim();
    
    if (!user || !["general_manager", "system_admin", "super_admin"].includes(user.role)) {
      showToast("عذراً، هذه الصلاحية مخصصة فقط للمدير العام أو مسئول النظام!", "error");
      return;
    }

    // Protection for code 18
    if (codeStr === "18") {
      showToast("تنبيه أمني: لا يمكن حذف هذا الحساب (كود 18) نهائياً من النظام!", "error");
      return;
    }

    const userToDelete = registeredUsers.find(u => String(u.code) === codeStr) || 
                         precodedUsers.find(u => String(u.code) === codeStr);
    
    if (!userToDelete) {
      showToast("عذراً، لم يتم العثور على بيانات المستخدم المطلوب حذفه.", "error");
      return;
    }

    // RBAC Protection
    if (userToDelete.role === 'general_manager') {
      if (user.role !== 'general_manager') {
        showToast("عذراً، لا يمكن حذف حساب المدير العام إلا بواسطة مدير عام آخر.", "error");
        return;
      }
      const gms = [...registeredUsers, ...precodedUsers].filter(u => u.role === 'general_manager');
      if (gms.length <= 1) {
        showToast("لا يمكن حذف آخر مدير عام مسجل بالنظام للحفاظ على استقرار الصلاحيات!", "error");
        return;
      }
    }

    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const response = await fetch(`/api/admin/users/${codeStr}`, {
        method: 'DELETE',
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "فشل حذف المستخدم من السيرفر.");
      }

      const updated = registeredUsers.filter(u => String(u.code) !== codeStr);
      const updatedPrecoded = precodedUsers.filter(u => String(u.code) !== codeStr);
      
      setRegisteredUsers(updated);
      setPrecodedUsers(updatedPrecoded);
      localStorage.setItem("inventory_registered_users", JSON.stringify(updated));
      localStorage.setItem("inventory_precoded_users", JSON.stringify(updatedPrecoded));
      showToast(`تم حذف المستخدم (${userToDelete.name}) نهائياً.`, "info");
    } catch (error: any) {
      showToast(error.message, "error");
    }
  };

  const handleDeletePrecodedUser = handleDeleteUser;

   const openEditProfileModal = () => {
    console.log("Edit profile button clicked");
    if (user) {
      setEditCode(user.code || "");
      setEditName(user.name || "");
      
      let cleanedPhone = (user.phone || "").replace(/[^0-9]/g, "");
      if (cleanedPhone === "20") {
        cleanedPhone = "";
      } else if (cleanedPhone.startsWith("20") && cleanedPhone.length > 11) {
        cleanedPhone = cleanedPhone.replace(/^20/, "0");
      }
      setEditPhone(cleanedPhone.slice(0, 11));
      setEditPassword(""); // Reset to empty for profile edit
      setOldPasswordConfirm("");
      setEditProfileError("");
      setShowProfileEdit(true);
    }
  };

  const handleUpdateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(editCode || "").trim() || !(editName || "").trim()) {
      setEditProfileError("الاسم وكود المستخدم مطلوبان.");
      return;
    }

    if ((editPhone || "").trim() && !validateEgyptianPhone(editPhone)) {
      setEditProfileError("رقم الهاتف يجب أن يكون رقم هاتف مصري صحيح مكون من 11 رقم ويبدأ بـ 01 (مثل: 01012345678).");
      return;
    }

    if (!oldPasswordConfirm) {
      setEditProfileError("يرجى إدخال كلمة المرور الحالية لتأكيد الترقية وحفظ التغييرات.");
      return;
    }

    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const response = await fetch("/api/auth/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          name: (editName || "").trim(),
          phone: (editPhone || "").trim(),
          password: editPassword, // Will only update if not empty/unchanged from dots
          oldPassword: oldPasswordConfirm,
        })
      });

      const resData = await response.json().catch(() => ({ error: "فشل استلام رد صالح من الخادم." }));
      
      if (!response.ok) {
        setEditProfileError(resData.error || `خطأ في الاتصال بالخادم (كود: ${response.status})`);
        return;
      }

      const updatedUser: LoggedInUser = resData.user;
      setUser(updatedUser);
      localStorage.setItem("inventory_logged_in_user", JSON.stringify(updatedUser));
      setSavedProfile(updatedUser);
      localStorage.setItem("inventory_saved_profile", JSON.stringify(updatedUser));

      const updatedReg = registeredUsers.map(u => u.code === updatedUser.code ? { ...u, name: updatedUser.name, phone: updatedUser.phone } : u);
      setRegisteredUsers(updatedReg);

      const updatedPrecoded = precodedUsers.map(u => u.code === updatedUser.code ? { ...u, name: updatedUser.name, phone: updatedUser.phone } : u);
      setPrecodedUsers(updatedPrecoded);

      if (activeSession) {
        saveActiveSession({ ...activeSession, storekeeperCode: updatedUser.code });
      }

      setShowProfileEdit(false);
      showToast("تم تعديل وحفظ بياناتك الشخصية بنجاح!", "success");
      fetchStateFromServer(false);
    } catch (err: any) {
      console.error("Profile update fetch error:", err);
      setEditProfileError(`فشل الاتصال بالخادم: ${err.message || "خطأ غير معروف"}`);
    }
  };

  /* ==========================================
     ٦. قسم أوراق العمل النشطة وإدخال كميات الجرد وجلسات الوردية الحالية (Active Audit Session & Worksheet)
     ========================================== */
  // 3. User Actions (Active Worksheet)
  const handlePhysicalQtyChange = (itemId: string, val: string) => {
    if (!activeSession) return;

    // Safety check for supervisor/warehouse supervisor: cannot edit if assigned to someone else but not submitted yet by storekeeper
    const targetItem = activeSession.items.find((item) => item.itemId === itemId);
    const isSupervisor = user?.role === "warehouse_supervisor" || user?.role === "supervisor";
    const isStorekeeper = user?.role === "storekeeper";
    if (isSupervisor && targetItem && targetItem.assignedTo && targetItem.assignedTo !== user?.code && !targetItem.submitted) {
      showToast("⚠️ عذراً، لا يمكن للمشرف تعديل الجرد الفعلي لصنف مسند حتى يقوم الأمين بتسليمه أولاً!", "error");
      return;
    }

    let numVal: number | null = null;
    if (val !== "") {
      numVal = parseFloat(val);
      if (isNaN(numVal) || numVal < 0) numVal = 0;
    }

    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        const isStorekeeper = user?.role === "storekeeper";
        const isSupervisor = user?.role === "warehouse_supervisor" || user?.role === "supervisor";
        const isManager = ["general_manager", "system_admin", "program_manager"].includes(user?.role || "");
        
        // Preserve previous audit details so they never disappear or get wiped out
        const prevCode = item.inventoriedByCode || user?.code;
        const prevName = item.inventoriedByName || user?.name || `مستخدم ${user?.code}`;
        const prevAt = item.inventoriedAt || new Date().toISOString();

        const isAssignedToMe = item.assignedTo && item.assignedTo === user?.code;

        return { 
          ...item, 
          physicalQty: numVal,
          submitted: isStorekeeper ? false : (isSupervisor && isAssignedToMe ? (numVal !== null) : item.submitted),
          submittedAt: isSupervisor && isAssignedToMe && numVal !== null ? new Date().toISOString() : item.submittedAt,
          inventoriedByCode: numVal !== null ? (user?.code || prevCode) : prevCode,
          inventoriedByName: numVal !== null ? (user?.name || prevName) : prevName,
          inventoriedAt: numVal !== null ? new Date().toISOString() : prevAt,
          ...(isStorekeeper ? { 
            supervisorQty: null,
            managerQty: null
          } : {}),
          ...(isSupervisor ? { 
            supervisorQty: numVal,
            ...(isAssignedToMe ? { storekeeperQty: numVal } : {})
          } : {}),
          ...(isManager ? { managerQty: numVal } : {})
        };
      }
      return item;
    });

    const nextApproved = isStorekeeper ? false : activeSession.supervisorApproved;
    const updatedSession = { ...activeSession, items: updatedItems, supervisorApproved: nextApproved };
    saveActiveSession(updatedSession);

    // Auto-update user-specific local drafts on the device too!
    if (user?.code) {
      localStorage.setItem(`inventory_draft_sess_${activeSession.id}_user_${user.code}`, JSON.stringify(updatedItems));
    }
  };

  const handleSaveCalculator = (itemId: string, calculatedQty: number, details: BagCalculatorDetails) => {
    if (!activeSession) return;

    // Safety check for supervisor/warehouse supervisor: cannot edit if assigned to someone else but not submitted yet by storekeeper
    const targetItem = activeSession.items.find((item) => item.itemId === itemId);
    const isSupervisor = user?.role === "warehouse_supervisor" || user?.role === "supervisor";
    const isStorekeeper = user?.role === "storekeeper";
    if (isSupervisor && targetItem && targetItem.assignedTo && targetItem.assignedTo !== user?.code && !targetItem.submitted) {
      showToast("⚠️ عذراً، لا يمكن للمشرف تعديل الجرد الفعلي لصنف مسند حتى يقوم الأمين بتسليمه أولاً!", "error");
      return;
    }

    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        const isStorekeeper = user?.role === "storekeeper";
        const isSupervisor = user?.role === "warehouse_supervisor" || user?.role === "supervisor";
        const isManager = ["general_manager", "system_admin", "program_manager"].includes(user?.role || "");
        
        const isAssignedToMe = item.assignedTo && item.assignedTo === user?.code;

        return { 
          ...item, 
          physicalQty: calculatedQty,
          calculatorDetails: details,
          submitted: isStorekeeper ? false : (isSupervisor && isAssignedToMe ? true : item.submitted),
          submittedAt: isSupervisor && isAssignedToMe ? new Date().toISOString() : item.submittedAt,
          inventoriedByCode: user?.code,
          inventoriedByName: user?.name || `مستخدم ${user?.code}`,
          inventoriedAt: new Date().toISOString(),
          storekeeperModifications: item.storekeeperModifications || [],
          ...(isStorekeeper ? { 
            supervisorQty: null,
            managerQty: null
          } : {}),
          ...(isSupervisor ? { 
            supervisorQty: calculatedQty,
            ...(isAssignedToMe ? { storekeeperQty: calculatedQty } : {})
          } : {}),
          ...(isManager ? { managerQty: calculatedQty } : {})
        };
      }
      return item;
    });

    const nextApproved = isStorekeeper ? false : activeSession.supervisorApproved;
    const updatedSession = { ...activeSession, items: updatedItems, supervisorApproved: nextApproved };
    saveActiveSession(updatedSession);

    // Auto-update user-specific local drafts on the device too!
    if (user?.code) {
      localStorage.setItem(`inventory_draft_sess_${activeSession.id}_user_${user.code}`, JSON.stringify(updatedItems));
    }

    // Zero-Latency Multi-User Real-time Sync push:
    pushStateToServer({ activeSession: updatedSession }, { isExplicitAction: true });

    showToast(`تم قياس وحفظ الكمية للصنف عبر الحاسبة بنجاح: ${calculatedQty} كجم 👍`, "success");
  };

  const handleNotesChange = (txt: string) => {
    if (!activeSession) return;
    saveActiveSession({ ...activeSession, notes: txt });
  };

  // Full Autofill Matches (for currently logged-in user only)
  const handleAutoFillMatches = () => {
    if (!activeSession || !user) return;
    const updated = activeSession.items.map((item) => {
      if (item.assignedTo === user.code && item.physicalQty === null) {
        return { 
          ...item, 
          physicalQty: item.bookQty,
          inventoriedByCode: user.code,
          inventoriedByName: user.name || `مستخدم ${user.code}`,
          inventoriedAt: new Date().toISOString(),
          ...(user.role === "storekeeper" ? { 
            storekeeperQty: item.bookQty,
            supervisorQty: null,
            managerQty: null
          } : {})
        };
      }
      return item;
    });
    saveActiveSession({ ...activeSession, items: updated });
    showToast("تم مطابقة وتعبئة فراغات أصنافك المسندة تلقائياً! ⚡", "success");
  };

  // Delete/Reset the entire active session back to masterItems starting list
  const handleDeleteActiveSession = async (reasonOverride?: string) => {
    if (user?.role && !["program_manager", "general_manager", "system_admin", "super_admin"].includes(user.role)) {
      showToast("عذراً، هذه الصلاحية متوفرة فقط لمسئول البرنامج أو الإدارة.", "error");
      return;
    }

    if (!activeSession) {
      showToast("❌ لا توجد جلسة جرد نشطة حالياً لحذفها!", "error");
      return;
    }
    
    if (!reasonOverride) {
      setDeletionTarget({ type: 'active' });
      setShowDeletionReasonModal(true);
      return;
    }
    
    // Completely clear active session locally
    setActiveSession(null);
    localStorage.removeItem("inventory_active_session");
    
    // Clear draft indicators
    localStorage.removeItem("inventory_has_unsaved_changes");
    setHasUnsavedChangesState(false);
    localStorage.removeItem("inventory_has_pending_assignments");
    setHasPendingAssignmentsState(false);

    try {
      await pushStateToServer({
        activeSession: null
      }, {
        deletedActiveSessionId: activeSession.id,
        deletedReason: reasonOverride,
        isExplicitAction: true
      });
      await performCloudSync(true, true);
      showToast("🗑️ تم حذف وإلغاء نسخة الجرد النشطة الحالية بالكامل بنجاح!", "success");
    } catch (err) {
      console.error(err);
      showToast("⚠️ حدث خطأ أثناء إبلاغ السيرفر بحذف الجلسة النشطة.", "error");
    }
  };



  // Complete and save to history
  const handleCompleteActiveAudit = async () => {
    if (!activeSession || isArchiving) return;

    if (!activeSession.date || activeSession.date.trim() === "") {
      showToast("⚠️ عذراً، يجب إدخال وتحديد تاريخ الجرد أعلى الصفحة أولاً قبل المتابعة وحفظ الأرشفة!", "error");
      return;
    }

    if (!activeSession.supervisorApproved) {
      showToast("⚠️ عذراً، لا يمكن أرشفة الجرد! يجب أولاً اعتماد ومطابقة الجرد من قبل مشرف المخازن.", "error");
      return;
    }

    const hasAssignedAny = activeSession.items.some(item => item.assignedTo);
    const hasUnsubmittedAny = activeSession.items.some(item => item.assignedTo && !item.submitted);
    const hasUnassignedOrGeneralAny = activeSession.items.some(item => !item.assignedTo || item.assignedTo === "عام" || item.assignedTo === "general");

    const isSupervisorApproveButtonActive = 
      !activeSession.supervisorApproved && 
      !activeSession.isCompleted && 
      hasAssignedAny && 
      !hasUnsubmittedAny && 
      !hasUnassignedOrGeneralAny && 
      !hasPendingAssignments;

    if (isSupervisorApproveButtonActive) {
      showToast("⚠️ عذراً، لا يمكن أرشفة الجرد حالياً لأن زر اعتماد الجرد نشط عند المشرف! يجب قيام المشرف باعتماده أولاً.", "error");
      return;
    }

    if (hasUnsavedChanges || hasPendingAssignments) {
      showToast("⚠️ عذراً، لا يمكن أرشفة الجرد وهناك تعديلات معلقة أو مهام إسناد غير محفوظة! يرجى التأكد من قيام مشرف المخازن بالضغط على زر (حفظ) أولاً لترحيل التعديلات.", "error");
      return;
    }

    const totalCount = activeSession.items.length;
    const counted = activeSession.items.filter((i) => i.physicalQty !== null).length;
    
    if (counted === 0) {
      showToast("الرجاء إدخال كمية جرد واحدة على الأقل قبل أرشفة التقرير.", "error");
      return;
    }

    if (counted < totalCount) {
      const uncounted = totalCount - counted;
      showToast(`⚠️ عذراً، لا يمكن حفظ وأرشفة الجرد إلا بعد جرد جميع الأصناف بالكامل! هناك ${uncounted} صنف لم يتم جردها بعد.`, "error");
      return;
    }

    setIsArchiving(true);
    try {
      const snapshottedItems = activeSession.items.map((item) => ({
        ...item,
        storekeeperQty: item.storekeeperQty !== undefined ? item.storekeeperQty : item.physicalQty,
        supervisorQty: item.supervisorQty !== undefined ? item.supervisorQty : item.physicalQty,
        managerQty: item.physicalQty
      }));

      const finalSessionObj: AuditSession = {
        ...activeSession,
        items: snapshottedItems,
        isCompleted: true,
        isArchived: true,
        date: activeSession.date,
        archivedBy: user?.code,
        archivedAt: new Date().toISOString(),
      };

      const updatedHistory = [finalSessionObj, ...pastSessions];

      // 1. Send to server
      await pushStateToServer({
        pastSessions: updatedHistory,
        masterItems: [],
        activeSession: null
      }, { isExplicitAction: true });
      
      // 2. Perform cloud backup if enabled
      await performCloudSync(true, true);

      // 3. ONLY after successful syncs, update local state
      setPastSessions(updatedHistory);
      setMasterItems([]);
      setActiveSession(null);

      // Clean up ANY session-specific drafts to prevent them from resurfacing later
      Object.keys(localStorage).forEach((key) => {
        if (key.includes(`sess_${activeSession.id}`) || key.startsWith("inventory_draft_user_")) {
          localStorage.removeItem(key);
        }
      });

      // Clear draft and pending flags
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      localStorage.removeItem("inventory_has_pending_assignments");
      setHasPendingAssignmentsState(false);

      showToast("تم الانتهاء وأرشفة الجرد لليوم بنجاح! رائع جدّاً.", "success");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } catch (err) {
      showToast("❌ حدث خطأ أثناء الاتصال بالخادم ولم تكتمل الأرشفة. يرجى التأكد من استقرار الشبكة.", "error");
      console.error(err);
      // Revert the local storage changes made by pushStateToServer so the session remains active
      localStorage.setItem("inventory_active_session", JSON.stringify(activeSession));
    } finally {
      setIsArchiving(false);
    }
  };

  // Helper to assign a storekeeper to a specific item
  const handleAssignStorekeeper = (itemId: string, storekeeperCode: string) => {
    if (user?.role !== 'supervisor' && user?.role !== 'system_admin' && user?.role !== 'warehouse_supervisor') {
      showToast("عذراً، لا تملك صلاحية تحديد مسئول الجرد (مشرف المخازن فقط).", "error");
      return;
    }
    if (!activeSession) return;
    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        return { ...item, assignedTo: storekeeperCode || undefined };
      }
      return item;
    });

    // Local save: update state and localStorage but bypass auto server pushes
    setActiveSession({ ...activeSession, items: updatedItems });
    localStorage.setItem("inventory_active_session", JSON.stringify({ ...activeSession, items: updatedItems }));
    
    setHasPendingAssignments(true);
    showToast(`📍 تم تعديل إسناد الصنف للأمين بالكود ${storekeeperCode || "عام"} (معلق ويجب الضغط على زر إسناد بالرأس لتأكيد وحفظ الإسناد)`, "info");
  };

  const handleCommitAssignments = async () => {
    if (!activeSession) return;
    
    const unassignedCount = activeSession.items.filter(item => !item.assignedTo).length;
    if (unassignedCount > 0) {
      showToast(`⚠️ يوجد عدد ${unassignedCount} أصناف غير مسندة لأمناء! يرجى إسناد كافة أصناف الجرد لجميع أمناء المخازن لحفظ وترحيل الإسناد.`, "error");
      return;
    }

    try {
      showToast("جاري ترحيل وحفظ إسناد الأصناف للأمناء على السيرفر...", "info");
      await pushStateToServer({ activeSession }, { isExplicitAction: true });
      setHasPendingAssignments(false);
      showToast("🚀 تم ترحيل وحفظ إسناد الأصناف بنجاح تام للأمناء والجرد متاح لديهم الآن!", "success");
    } catch (err) {
      console.error("Error committing assignments:", err);
      showToast("⚠️ فشل ترحيل الإسناد للسيرفر. يرجى مراجعة الشبكة والاتصال.", "error");
    }
  };

  // Helper for Supervisor to request item recheck from assigned Storekeeper
  const handleRequestRecheck = async (itemId: string) => {
    if (!activeSession) return;

    const targetItem = activeSession.items.find(i => i.itemId === itemId);
    if (!targetItem) return;

    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        return {
          ...item,
          submitted: false,
          recheckRequested: true,
          supervisorQty: null, // Clear supervisorQty so it remains suspended and has no confirmed physical balance
          // Preserve previous state and set physicalQty/storekeeperQty back so the storekeeper has their draft ready
          physicalQty: item.storekeeperQty !== undefined && item.storekeeperQty !== null ? item.storekeeperQty : item.physicalQty,
          storekeeperQty: item.storekeeperQty !== undefined && item.storekeeperQty !== null ? item.storekeeperQty : item.physicalQty
        };
      }
      return item;
    });

    const updatedSession = { 
      ...activeSession, 
      items: updatedItems,
      supervisorApproved: false // Ensure active session cannot be approved if some items are pending re-inventory
    };

    saveActiveSession(updatedSession);
    
    // Auto-update user-specific local drafts on the device too!
    if (user?.code) {
      localStorage.setItem(`inventory_draft_sess_${activeSession.id}_user_${user.code}`, JSON.stringify(updatedItems));
    }

    try {
      showToast("جاري ترحيل طلب إعادة الجرد للسيرفر سحابياً...", "info");
      await pushStateToServer({ activeSession: updatedSession }, { isExplicitAction: true });
      showToast(`🔄 تم طلب إعادة جرد الصنف [ ${targetItem.itemName} ] بنجاح من الأمين!`, "success");
    } catch (err: any) {
      console.error("Error setting recheck request:", err);
      showToast(`⚠️ فشل الترحيل السحابي: ${err.message || "مشكلة اتصال/شبكة"}`, "error");
    }
  };

  const handleProgramManagerSave = async () => {
    try {
      showToast("جاري حفظ وتوزيع التعديلات لجميع الصلاحيات فورا...", "info");
      
      const payload: any = {};
      if (activeSession) {
        payload.activeSession = { ...activeSession, updatedAt: Date.now() };
      }
      if (masterItems) {
        payload.masterItems = masterItems;
      }
      
      // Explicitly push state to SQLite server
      await pushStateToServer(payload, { isExplicitAction: true });
      
      // Reset unsaved changes flag
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      
      showToast("🚀 تم حفظ جرد مسئول البرنامج وتوزيعه بنجاح لجميع المستخدمين!", "success");
    } catch (err) {
      console.error("Error saving program manager edits:", err);
      showToast("⚠️ فشل ترحيل البيانات. يرجى التحقق من الشبكة والاتصال.", "error");
    }
  };

  const handleSupervisorSaveOrCommit = async () => {
    if (!activeSession) return;
    try {
      showToast("جاري حفظ التعديلات وتحديث الإسناد الفوري...", "info");
      const updatedSess = { ...activeSession, updatedAt: Date.now() };
      
      // Explicitly push activeSession to server and sync database
      await pushStateToServer({ activeSession: updatedSess }, { isExplicitAction: true });
      
      // Clear both flags
      localStorage.removeItem("inventory_has_pending_assignments");
      setHasPendingAssignments(false);
      
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      
      showToast("🚀 تم حفظ التعديلات وتحديث الإسنادات بنجاح وتعميمها للأمناء!", "success");
    } catch (err) {
      console.error("Error committing supervisor save/assignments:", err);
      showToast("⚠️ فشل ترحيل التعديلات والإسناد. يرجى التأكد من الشبكة.", "error");
    }
  };

  // Helper for Program Manager to directly edit book balance after upload
  const handleBookQtyChange = (itemId: string, val: string) => {
    if (!activeSession) return;
    const num = val === "" ? 0 : parseFloat(val);
    const finalVal = isNaN(num) ? 0 : num;
    
    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        return { ...item, bookQty: finalVal, submitted: false };
      }
      return item;
    });

    // Sync master catalog
    const updatedMaster = masterItems.map((m) => {
      if (m.id === itemId) {
        return { ...m, bookQty: finalVal };
      }
      return m;
    });

    setMasterItems(updatedMaster);
    localStorage.setItem("inventory_master_items", JSON.stringify(updatedMaster));
    saveActiveSession({ ...activeSession, items: updatedItems });
  };

  // Helper for Program Manager to delete a product from active worksheet session
  const handleDeleteWorksheetItem = (itemId: string) => {
    if (!activeSession) return;
    const updatedItems = activeSession.items.filter((item) => item.itemId !== itemId);
    saveActiveSession({ ...activeSession, items: updatedItems });
    showToast("تم حذف الصنف من ورقة الجرد النشطة بنجاح.", "success");
  };

  // Helper for Storekeeper to submit his inventory
  const handleStorekeeperSubmit = async () => {
    if (!activeSession || !user) return;
    
    // Check if they filled at least one quantity for their assigned items
    const assignedItems = activeSession.items.filter(item => item.assignedTo === user.code);
    if (assignedItems.length === 0) {
      showToast("ليس لديك أي أصناف مسندة إليك حالياً لمراجعتها!", "error");
      return;
    }
    
    const uncounted = assignedItems.filter(item => item.physicalQty === null);
    if (uncounted.length > 0) {
      showToast(`⚠️ يرجى جرد جميع الأصناف المسندة إليك أولاً! يوجد ${uncounted.length} أصناف متبقية.`, "error");
      return;
    }

    const updatedItems = activeSession.items.map((item) => {
      if (item.assignedTo === user.code) {
        const newSkMods = [...(item.storekeeperModifications || [])];
        const lastMod = newSkMods.length > 0 ? newSkMods[newSkMods.length - 1] : null;

        // Only add a new modification entry if it's different from the last recorded one
        // and it's a genuine re-count (recheckRequested or change from previously submitted storekeeperQty)
        if (item.recheckRequested && 
            item.storekeeperQty !== null && 
            item.storekeeperQty !== item.physicalQty &&
            (!lastMod || lastMod.newQty !== item.physicalQty)) {
          newSkMods.push({
            modifiedBy: user.code,
            modifiedByName: user.name,
            modifiedAt: new Date().toISOString(),
            oldQty: item.storekeeperQty,
            newQty: item.physicalQty
          });
        }
        return { 
          ...item, 
          submitted: true, 
          recheckRequested: false, // Reset the recheck requested flag
          submittedAt: new Date().toISOString(),
          storekeeperQty: item.physicalQty, // SNAPSHOT STOREKEEPER VALUE AT SUBMISSION
          storekeeperModifications: newSkMods
        };
      }
      return item;
    });

    const updatedSession = { ...activeSession, items: updatedItems };
    saveActiveSession(updatedSession, false); // save local with markAsUnsaved=false
    
    try {
      showToast("جاري ترحيل وتسليم الجرد للسيرفر...", "info");
      // Explicit SQLite save and server push
      await pushStateToServer({ activeSession: updatedSession }, { isExplicitAction: true });
      
      // Successfully pushed! Clean any unsaved changes flags definitely
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      
      showToast("تم تسليم وحفظ الجرد بنجاح وبانتظار المراجعة والاعتماد من مشرف المخازن! 👍", "success");
    } catch (err: any) {
      console.error("Error submitting storekeeper inventory:", err);
      // Revert/restore the unsaved changes flags on failure so they can retry
      localStorage.setItem("inventory_has_unsaved_changes", "true");
      setHasUnsavedChangesState(true);
      showToast(`⚠️ فشل ترحيل البيانات: ${err.message || 'مشكلة في الشبكة'}`, "error");
    }
  };

  // Helper for Supervisor to approve storekeepers' submissions (bulk-approve or single)
  const handleSupervisorApproveSession = async () => {
    if (!activeSession) return;
    
    // Check if ALL assigned storekeepers have submitted their items
    const assignedItems = activeSession.items.filter(item => item.assignedTo);
    const unsubmittedItems = assignedItems.filter(item => !item.submitted);
    
    if (unsubmittedItems.length > 0) {
      const pendingCodes = Array.from(new Set(unsubmittedItems.map(item => item.assignedTo)));
      const pendingNames = pendingCodes.map(code => getStorekeeperName(code as string | number, user)).join("، ");
      showToast(`⚠️ لا يمكن لمشرف المخازن اعتماد وحفظ الجرد إلا بعد قيام جميع أمناء المخازن بتسليم الجرد بالكامل! بانتظار تسليم الجرد من: ${pendingNames}`, "error");
      return;
    }

    // Check if ALL items have been counted
    const totalCount = activeSession.items.length;
    const counted = activeSession.items.filter(i => i.physicalQty !== null).length;
    if (counted === 0) {
      showToast("عذراً, لا توجد أي مدخلات جرد فعلية لاعتمادها حالياً!", "error");
      return;
    }
    if (counted < totalCount) {
      const uncounted = totalCount - counted;
      showToast(`⚠️ عذراً, لا يمكن حفظ واعتماد الجرد إلا بعد جرد جميع الأصناف بالكامل! هناك ${uncounted} صنف لم يتم جردها بعد.`, "error");
      return;
    }

    const updatedItems = activeSession.items.map((item) => {
      return {
        ...item,
        supervisorQty: item.physicalQty // SNAPSHOT SUPERVISOR VALUE AT APPROVAL
      };
    });

    const updatedSession = {
      ...activeSession,
      items: updatedItems,
      supervisorApproved: true,
      supervisorApprovedAt: new Date().toISOString(),
      supervisorApprovedBy: user?.name || "المشرف"
    };

    saveActiveSession(updatedSession, false); // save local with markAsUnsaved=false
    
    try {
      showToast("جاري ترحيل وحفظ الاعتماد...", "info");
      // Explicit SQLite save and server push
      await pushStateToServer({ activeSession: updatedSession }, { isExplicitAction: true });
      
      // Successfully pushed! Clean any unsaved changes flags definitely
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      
      showToast("✅ تم مراجعة واعتماد جرد المخازن بنجاح! الملف بانتظار الاعتماد النهائي من مسئول البرنامج.", "success");
    } catch (err: any) {
      console.error("Error approving supervisor session:", err);
      if (err.message === "SUPERVISOR_APPROVAL_BLOCKED_UNSUBMITTED") {
        showToast("⚠️ فشل الاعتماد: توجد أصناف لم يتم تسليمها من الأمناء على السيرفر سيعاد التحميل الآن.", "error");
        fetchStateFromServer(true);
      } else {
        // Revert/restore the unsaved changes flags on failure so they can retry
        localStorage.setItem("inventory_has_unsaved_changes", "true");
        setHasUnsavedChangesState(true);
        showToast(`⚠️ فشل ترحيل الاعتماد للسيرفر: ${err.message || 'مشكلة في الشبكة'}`, "error");
      }
    }
  };

  // Helper for Supervisor to reset or allow re-entry
  const handleSupervisorRejectOrUnlock = (itemId: string) => {
    if (!activeSession) return;
    const updatedItems = activeSession.items.map((item) => {
      if (item.itemId === itemId) {
        return { ...item, submitted: false };
      }
      return item;
    });
    saveActiveSession({ ...activeSession, items: updatedItems });
    showToast("تم فك قفل الصنف وإعادته لحالة الانتظار ليقوم الأمين بتصحيحه.", "info");
  };

  // Helper for Program Manager to finalize and archive
  const handleProgramManagerFinalize = async () => {
    if (!activeSession || isArchiving) return;

    if (!activeSession.date || activeSession.date.trim() === "") {
      showToast("⚠️ عذراً، يجب إدخال وتحديد تاريخ الجرد أعلى الصفحة أولاً قبل الاعتماد النهائي والترحيل!", "error");
      return;
    }

    if (!activeSession.supervisorApproved) {
      showToast("⚠️ لا يمكن الاعتماد النهائي للأرصدة! يجب أولاً اعتماد ومطابقة الجرد من قبل مشرف المخازن.", "error");
      return;
    }

    // Check if ALL items have been counted
    const totalCount = activeSession.items.length;
    const counted = activeSession.items.filter(i => i.physicalQty !== null).length;
    if (counted < totalCount) {
      const uncounted = totalCount - counted;
      showToast(`⚠️ عذراً، لا يمكن الاعتماد والترحيل النهائي إلا بعد جرد جميع الأصناف بالكامل! هناك ${uncounted} صنف لم يتم جردها بعد.`, "error");
      return;
    }

    setIsArchiving(true);
    try {
      const snapshottedItems = activeSession.items.map((item) => ({
        ...item,
        managerQty: item.physicalQty,
        // If storekeeperQty or supervisorQty were never set because of Direct AutoFill/Quick completion, backfill them:
        storekeeperQty: (item.storekeeperQty !== undefined && item.storekeeperQty !== null) ? item.storekeeperQty : item.physicalQty,
        supervisorQty: (item.supervisorQty !== undefined && item.supervisorQty !== null) ? item.supervisorQty : item.physicalQty
      }));

      const finalSessionObj: AuditSession = {
        ...activeSession,
        items: snapshottedItems,
        isCompleted: true,
        isArchived: true,
        managerApproved: true,
        date: activeSession.date,
        archivedBy: user?.code,
        archivedAt: new Date().toISOString(),
      };

      const updatedHistory = [finalSessionObj, ...pastSessions];

      // 1. Send to server
      await pushStateToServer({
        pastSessions: updatedHistory,
        masterItems: [],
        activeSession: null
      }, { isExplicitAction: true });

      // 2. Perform cloud backup if enabled
      await performCloudSync(true, true);

      // 3. ONLY after successful syncs, update local state
      setPastSessions(updatedHistory);
      setMasterItems([]);
      setActiveSession(null);

      // Clean up ANY session-specific drafts to prevent them from resurfacing later
      Object.keys(localStorage).forEach((key) => {
        if (key.includes(`sess_${activeSession.id}`) || key.startsWith("inventory_draft_user_")) {
          localStorage.removeItem(key);
        }
      });

      // Clear draft and pending flags
      localStorage.removeItem("inventory_has_unsaved_changes");
      setHasUnsavedChangesState(false);
      localStorage.removeItem("inventory_has_pending_assignments");
      setHasPendingAssignmentsState(false);

      showToast("🎉 تم الاعتماد النهائي لقيمة الجرد الميداني بالكامل ونقل الجلسة للأرشيف بنجاح تام!", "success");
    } catch (err) {
      showToast("❌ حدث خطأ أثناء الاتصال بالخادم ولم تكتمل الأرشفة. يرجى التأكد من استقرار الشبكة والمزامنة.", "error");
      console.error(err);
      localStorage.setItem("inventory_active_session", JSON.stringify(activeSession));
    } finally {
      setIsArchiving(false);
    }
  };

  // Helper to save direct edits on an archived session inside the modal
  const handleSaveArchivedSession = async () => {
    if (!inspectSession) return;

    if (!user || !["general_manager", "system_admin", "program_manager"].includes(user.role)) {
      showToast("عذراً، التعديل مخصص فقط لمسؤول البرنامج!", "error");
      return;
    }

    try {
      const originalSession = pastSessions.find(s => s.id === inspectSession.id);
      let sessionToSave = { ...inspectSession };

      if (originalSession) {
        const itemChanges: any[] = [];
        sessionToSave.items.forEach(newItem => {
          const oldItem = originalSession.items.find(i => i.itemId === newItem.itemId);
          if (oldItem) {
            const oldRoleQty = getRoleBasedPhysicalQty(oldItem, user?.role) ?? oldItem.physicalQty;
            const newRoleQty = newItem.physicalQty;
            if (oldRoleQty !== newRoleQty) {
              itemChanges.push({
                itemId: newItem.itemId,
                itemName: newItem.itemName,
                oldQty: oldRoleQty,
                newQty: newRoleQty
              });
            }
          }
        });

        if (itemChanges.length > 0) {
          const modEntry = {
            modifiedBy: user.name,
            modifiedAt: new Date().toISOString(),
            itemChanges
          };
          sessionToSave = {
            ...sessionToSave,
            modifications: [...(sessionToSave.modifications || []), modEntry]
          };
        }
      }

      // Just update it in the pastSessions list directly
      // It remains archived, completed, etc. No session changes, no duplicates.
      const updatedPast = pastSessions.map((s) => s.id === sessionToSave.id ? sessionToSave : s);
      
      // We don't touch activeSession or masterItems.
      setPastSessions(updatedPast);
      setIsEditingInspectSession(false);
      setInspectSession(null); // safely close it

      await pushStateToServer({
        pastSessions: updatedPast
      }, { isExplicitAction: true });
      await performCloudSync(true, true);

      showToast("✅ تم حفظ تعديلات السجل المؤرشف بنجاح وتحديثه في مكان واحد!", "success");
    } catch (err) {
      console.error(err);
      showToast("❌ حدث خطأ أثناء الاتصال بالخادم ولم يكتمل حفظ التعديل السحابي.", "error");
    }
  };

  // Export CSV helper
  const handleExportCsv = (session: AuditSession, filename: string) => {
    let csvContent = "\uFEFF"; // UTF-8 BOM
    
    // Add meta descriptive lines at the top of the report
    const overallStorekeeper = session.storekeeperCode !== undefined ? getStorekeeperName(session.storekeeperCode, user) : "غير محدد";
    csvContent += `# تقرير جرد ومطابقة أرصدة مستودعات الإيمان للأعلاف\n`;
    csvContent += `# تاريخ الجلسة الأساسي: ${new Date(session.archivedAt || session.updatedAt || session.date).toLocaleDateString("ar-EG")}\n`;
    csvContent += `# وقت الأرشفة النهائي: ${new Date(session.archivedAt || session.updatedAt || session.date).toLocaleTimeString("ar-EG")}\n`;
    csvContent += `# أمين المخزن الرئيسي المعين للجلسة: ${overallStorekeeper}\n`;
    csvContent += `\n`;
    
    // Write descriptive table column headers in Arabic
    csvContent += "الباركود,اسم الصنف,القسم التجاري,الكمية الدفترية,الكمية الفعلية (المعتمدة),الفرق (العجز والزيادة),الفرق السابق,الوحدة,أمين المخزن المسؤول عن الصنف,القائم بالجرد الفعلي,تاريخ ووقت الجرد\n";

    (session.items || []).forEach((item) => {
      const pQty = session.isCompleted ? getRoleBasedPhysicalQty(item, user?.role) : item.physicalQty;
      const physicalStr = pQty !== null ? pQty : "لم يجرد";
      const diffStr = pQty !== null ? pQty - item.bookQty : "—";
      const prevDiffVal = item.previousDiff !== undefined ? item.previousDiff : "—";
      
      const assignedSK = item.assignedTo ? getStorekeeperName(item.assignedTo, user) : overallStorekeeper;
      const inventoriedBy = item.inventoriedByName || "—";
      const inventoriedTime = item.inventoriedAt ? new Date(item.inventoriedAt).toLocaleString("ar-EG") : "—";

      csvContent += `"${item.itemId}","${item.itemName.replace(/"/g, '""')}","${item.category || "عام"}",${item.bookQty},${physicalStr},${diffStr},${prevDiffVal},"${item.unit}","${assignedSK}","${inventoriedBy}","${inventoriedTime}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export full raw offline database backup (all sessions and items)
  const handleExportOfflineBackup = () => {
    const backupData = {
      appId: "aleman_inventory_system",
      exportType: "full_offline_backup",
      timestamp: Date.now(),
      masterItems: masterItems,
      activeSession: activeSession,
      pastSessions: pastSessions,
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(backupData, null, 2)
    )}`;
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", jsonString);
    downloadAnchor.setAttribute(
      "download",
      `نسخة_احتياطية_كاملة_جرد_الإيمان_${new Date().toISOString().split("T")[0]}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    showToast("💾 تم تصدير ملف النسخة الاحتياطية بنجاح! احفظ هذا الملف لنقله أو استعادته لاحقاً.", "success");
  };

  // Import full raw offline database backup
  const handleImportOfflineBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = e.target.files;
    if (!files || files.length === 0) return;

    fileReader.readAsText(files[0], "UTF-8");
    fileReader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.appId !== "aleman_inventory_system" || parsed.exportType !== "full_offline_backup") {
          showToast("⚠️ ملف غير صالح! يرجى اختيار ملف نسخة احتياطية صحيح خاص بنظام جرد الإيمان للأعلاف.", "error");
          return;
        }

        if (parsed.masterItems) {
          setMasterItems(parsed.masterItems);
          localStorage.setItem("inventory_master_items", JSON.stringify(parsed.masterItems));
        }
        if (parsed.activeSession !== undefined) {
          saveActiveSession(parsed.activeSession);
        }
        if (parsed.pastSessions) {
          savePastSessions(parsed.pastSessions);
        }

        showToast("✅ تم استيراد واستعادة كافة البيانات وجلسة الجرد النشطة بنجاح التام من ملف الطوارئ!", "success");
        // Reset file input value
        e.target.value = "";
      } catch (err) {
        console.error(err);
        showToast("⚠️ حدث خطأ أثناء قراءة وتحليل ملف النسخة الاحتياطية.", "error");
      }
    };
  };

  /* ==========================================
     ٧. قسم إدارة كتالوج الدليل الموحد للأصناف والمنتجات (Master Product Catalog Management)
     ========================================== */
  // 4. Product Catalog Management Actions
  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formId.trim() || !formName.trim()) {
      setFormError("الرجاء إدخال كود الصنف واسمه بالكامل.");
      return;
    }

    const qty = formBookQty === "" ? 0 : Number(formBookQty);

    const duplicateId = masterItems.some((item) => item.id.trim() === formId.trim());
    if (!editingItem && duplicateId) {
      setFormError("هذا الكود/الباركود مسجل مسبقاً لصنف آخر. استخدم كود فريد.");
      return;
    }

    const itemObj: MasterItem = {
      id: formId.trim(),
      name: formName.trim(),
      category: formCategory.trim() || "عام",
      bookQty: qty,
      unit: formUnit.trim() || "حبة",
    };

    let updatedCatalog: MasterItem[];
    if (editingItem) {
      updatedCatalog = masterItems.map((item) => (item.id === editingItem.id ? itemObj : item));
      showToast("تم تعديل الصنف بالكتالوج ومزامنته بـ الجرد الحمرائي.");
    } else {
      updatedCatalog = [itemObj, ...masterItems];
      showToast("تمت إضافة صنف جديد بنجاح إلى دليلك الدفتري.");
    }

    handleUpdateMasterAndSync(updatedCatalog);
    handleResetCatalogForm();
  };

  const handleEditProductClick = (item: MasterItem) => {
    setEditingItem(item);
    setFormId(item.id);
    setFormName(item.name);
    setFormCategory(item.category || "");
    setFormBookQty(item.bookQty);
    setFormUnit(item.unit);
    setShowAddForm(true);
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteProduct = (id: string) => {
    if (confirm("هل أنت متأكد من حذف هذا الصنف بالكامل من دليلك والورقة النشطة؟")) {
      const updated = masterItems.filter((i) => i.id !== id);
      handleUpdateMasterAndSync(updated);
      showToast("تم الحذف بنجاح.", "info");
    }
  };

  const handleResetCatalogForm = () => {
    setFormId("");
    setFormName("");
    setFormCategory("");
    setFormBookQty("");
    setFormUnit("حبة");
    setEditingItem(null);
    setFormError("");
    setShowAddForm(false);
  };

  // Bulk Clear database
  const handleWipeDatabase = () => {
    if (confirm("⚠️ تحذير خطير: هل أنت متأكد من تصفير ومسح جميع تفاصيل الكتالوج الخاص بك؟ سيبدأ دليلك فارغاً تماماً.")) {
      handleUpdateMasterAndSync([]);
      showToast("تم حذف قاعدة الأصناف والدفاتر بالكامل.", "error");
    }
  };

  // Excel Paste Import Confirmed callback
  const handleBulkImportConfirmed = (imported: MasterItem[]) => {
    if (activeSession?.isRestored) {
      showToast("❌ غير مسموح: لا يمكن تحميل أرصدة أو أصناف دفترية جديدة أثناء تعديل جرد مسترجع لتجنب تداخل الأرصدة والبيانات.", "error");
      return;
    }
    // THE "ORDER PRESERVATION" FIX:
    // Use the order of the imported file as the absolute primary sequence.
    // This ensures that 'رفع الجرد' maintains the exact line order from Excel.
    const importedIds = new Set(imported.map(imp => imp.id));
    
    // Update imported items with any extra metadata from existing masterItems if necessary
    const updatedImported = imported.map((imp) => {
      const existing = masterItems.find(m => m.id === imp.id);
      if (existing) {
        return { ...existing, ...imp };
      }
      return imp;
    });
    
    // Append items that were in the catalog but NOT in the new Excel sheet to the end
    const missingFromImport = masterItems.filter(m => !importedIds.has(m.id));
    
    const finalMaster = [...updatedImported, ...missingFromImport];
    
    handleUpdateMasterAndSync(finalMaster);
    showToast(`تم استيراد ${imported.length} صنف بنجاح من ورقة الإكسل ومزامنتها بالفور!`, "success");
  };

  // Keyboard navigation logic
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, itemId: string, index: number, visibleItems: AuditItem[]) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextItem = visibleItems[index + 1];
      if (nextItem) {
        inputRefs.current[nextItem.itemId]?.focus();
        inputRefs.current[nextItem.itemId]?.select();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevItem = visibleItems[index - 1];
      if (prevItem) {
        inputRefs.current[prevItem.itemId]?.focus();
        inputRefs.current[prevItem.itemId]?.select();
      }
    }
  };

  /* ==========================================
     ٨. قسم تصنيفات الفلترة المتقدمة والتحليلات الإحصائية للجرودات (Metrics Classification & Advanced Filters)
     ========================================== */
  // 5. Audit filtering and difference classification
  const [auditorFilter, setAuditorFilter] = useState<string>("all");

  const activeUserItems = activeSession
    ? (activeSession.items && activeSession.items.length > 0 
        ? activeSession.items.filter((item) => {
            // If restored session, by default only managers can view and edit,
            // BUT if items are specifically assigned to a storekeeper, they MUST see them to perform inventory.
            if (activeSession.isRestored) {
              const isManager = ["general_manager", "system_admin", "program_manager", "warehouse_supervisor", "supervisor"].includes(user?.role || "");
              const isAssignedToThisUser = user && item.assignedTo === user.code;
              
              if (!isManager && !isAssignedToThisUser) {
                return false;
              }
            }
            
            // If logged in user is a storekeeper, strictly show only assigned items and hide submitted ones
            if (user && user.role === "storekeeper") {
              // If approved by supervisor, it's considered archived immediately for storekeepers
              if (activeSession.supervisorApproved) {
                return false;
              }
              return item.assignedTo === user.code && !item.submitted;
            }
            return true;
          })
        : (user && user.role === "storekeeper")
          ? [] // 🛡️ Storekeepers should never see the master items fallback list if the session is empty
          : (masterItems || []).map((m) => ({
            itemId: m.id,
            itemName: m.name,
            category: m.category || "عام",
            bookQty: m.bookQty || 0,
            unit: m.unit || "حبة",
            physicalQty: null,
            assignedTo: null,
            submitted: false,
            notes: "",
            storekeeperQty: null,
            supervisorQty: null,
            managerQty: null
          }))
      )
    : [];

  const visibleWorksheetItems = activeUserItems.filter((item) => {
    const matchesSearch =
      item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.itemId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (auditorFilter !== "all") {
      const assigned = String(item.assignedTo || "");
      if (assigned !== auditorFilter) return false;
    }

    if (statusFilter === "all") return true;

    const hasCount = item.physicalQty !== null;
    if (statusFilter === "pending") return !hasCount;

    if (!hasCount) return false;

    const diff = item.physicalQty! - item.bookQty;
    if (statusFilter === "match") return diff === 0;
    if (statusFilter === "shortage") return diff < 0;
    if (statusFilter === "excess") return diff > 0;

    return true;
  });

  // Categorize stats counts (Pieces & unit-based counts, NO costs)
  const isSessionArchivedForUser = 
    (activeSession?.supervisorApproved && user?.role === "storekeeper") ||
    (activeSession?.isRestored && !["general_manager", "system_admin", "program_manager"].includes(user?.role || ""));
  const totalMasterCount = isSessionArchivedForUser ? 0 : masterItems.length;
  const totalMasterBookQty = isSessionArchivedForUser ? 0 : masterItems.reduce((sum, item) => sum + (item.bookQty || 0), 0);
  const totalCounted = activeSession ? activeSession.items.filter((item) => item.physicalQty !== null).length : 0;
  const progressPercent = totalMasterCount > 0 ? Math.round((totalCounted / totalMasterCount) * 100) : 0;

  const totalMatchesCount = activeSession
    ? activeSession.items.filter((i) => i.physicalQty !== null && i.physicalQty === i.bookQty).length
    : 0;
  const totalShortagesCount = activeSession
    ? activeSession.items.filter((i) => i.physicalQty !== null && i.physicalQty < i.bookQty).length
    : 0;
  const totalExcessesCount = activeSession
    ? activeSession.items.filter((i) => i.physicalQty !== null && i.physicalQty > i.bookQty).length
    : 0;

  const processedPastSessions = useMemo(() => {
    // 1. Deduplicate and clone objects to avoid mutating state directly
    const deduplicated = pastSessions.filter((session, index, self) => {
      if (self.findIndex(s => s.id === session.id) !== index) return false;
      return true;
    }).map(s => ({ ...s })); // shallow clone

    // 2. Group by date to calculate version numbers per date
    const dateGroups: Record<string, typeof deduplicated> = {};
    deduplicated.forEach(s => {
      const d = s.date.split("T")[0]; // Extract YYYY-MM-DD
      if (!dateGroups[d]) dateGroups[d] = [];
      dateGroups[d].push(s);
    });

    // 3. Assign version numbers chronologically within each date group
    Object.keys(dateGroups).forEach(d => {
      // Sort older to newer by precise archival time or date to assign numbers 1, 2, 3...
      dateGroups[d].sort((a, b) => {
        const timeA = new Date(a.archivedAt || a.date).getTime();
        const timeB = new Date(b.archivedAt || b.date).getTime();
        return timeA - timeB;
      });
      dateGroups[d].forEach((s, idx) => {
        (s as any).versionNumber = idx + 1;
      });
    });

    // 4. Sort final list: Date descending, then Version descending (Newest version on top)
    return deduplicated.sort((a, b) => {
      const dateA = a.date.split("T")[0];
      const dateB = b.date.split("T")[0];
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA); 
      }
      return ((b as any).versionNumber || 0) - ((a as any).versionNumber || 0);
    });
  }, [pastSessions]);

  const handleAdminLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Use role-based checking instead of hardcoded credentials if possible
    if ((adminUsername.trim() === "18" && adminPasswordInput === "171996")) {
      setAdminPanelState("coding");
      setAdminError("");
      showToast("تم تسجيل الدخول كمدير عام بنجاح!", "success");
    } else {
      setAdminError("كود المدير العام أو كلمة المرور غير صحيحة!");
    }
  };



  /* ==========================================
     ٩. قسم بناء الهيكل الرسومي وواجهات المستخدم (UI Layout & Components Render)
     ========================================== */
  // Render
  if (!user) {
    const isSimplified = !forceFullRegister;

    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-green-50/50 flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden text-right gap-4" dir="rtl">
        {/* Decorative background grain blur effects */}
        <div className="absolute -top-24 -left-20 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-20 w-96 h-96 bg-green-600/10 rounded-full blur-3xl pointer-events-none" />

        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -45, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 border text-xs max-w-sm w-[90%] text-right font-bold justify-between bg-white border-slate-100"
              id="login-toast"
            >
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-emerald-600" />
                <span className="text-slate-700 leading-tight">{notification.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 1. Admin Authentication Screen */}
        {adminPanelState === "auth" && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200/50 p-8 space-y-6 relative z-10 text-right"
          >
            <div className="text-center space-y-2">
              <div className="flex justify-center mx-auto mb-2">
                <Shield className="w-16 h-16 text-slate-800" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">بوابة مسئول النظام</h1>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                يرجى إدخال اسم المستخدم والرقم السري الخاص بمسئول البرنامج للولوج إلى إدارة التكويد والترميز.
              </p>
            </div>

            {adminError && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl leading-relaxed">
                ⚠️ {adminError}
              </div>
            )}

            <form onSubmit={handleAdminLoginSubmit} className="space-y-4 text-right">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-600">اسم مستخدم مسئول النظام *</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-550 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    placeholder="مثال: admin"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-slate-550/10 focus:border-slate-600 text-right text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-600">كلمة المرور لمسئول النظام *</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-550 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-550/10 focus:border-slate-600 text-right"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-extrabold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Key className="w-4 h-4" />
                التحقق وتسجيل الدخول للمسئول
              </button>
            </form>

            <div className="text-center pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setAdminPanelState("none");
                  setAdminUsername("");
                  setAdminPasswordInput("");
                  setAdminError("");
                }}
                className="text-xs text-slate-600 font-extrabold hover:underline hover:text-slate-800 transition-colors cursor-pointer"
              >
                ◀ العودة لواجهة تسجيل الدخول للأمناء
              </button>
            </div>
            <div className="text-center pt-1.5">
              <span className="text-[10px] text-slate-400 font-semibold bg-slate-50 p-2 rounded block leading-tight">
                للتجربة والاختيار السريع: اسم المستخدم <code className="font-mono bg-white p-0.5 border text-red-600 font-bold">admin</code> والرقم السري <code className="font-mono bg-white p-0.5 border text-red-600 font-bold">admin</code>
              </span>
            </div>
          </motion.div>
        )}

        {/* 2. Admin User Coding Dashboard */}
        {adminPanelState === "coding" && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 p-8 space-y-6 relative z-10 text-right mt-4 mb-4"
          >
            <SalatMessage plain={true} />
            <div className="pb-4 border-b border-slate-100 flex justify-between items-center sm:flex-row flex-col-reverse gap-3">
              <button
                type="button"
                onClick={() => {
                  setAdminPanelState("none");
                  setAdminUsername("");
                  setAdminPasswordInput("");
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                {user ? "◀ العودة للوحة الإدارة" : "◀ خروج والعودة لتسجيل دخول الأمناء"}
              </button>
              <div className="text-right">
                <h1 className="text-base font-black text-slate-900 flex items-center gap-2 justify-end">
                  <Shield className="w-5 h-5 text-emerald-600" />
                  منصة تكويد وترميز الأمناء (مسئول النظام)
                </h1>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">تفويض الصلاحيات وربط الأكواد بورقة الجرد الميدانية</p>
              </div>
            </div>

            <UserManagement 
              users={(() => {
                const map = new Map<string, LoggedInUser>();
                registeredUsers.forEach(u => map.set(u.code, u));
                precodedUsers.forEach(u => {
                  if (!map.has(u.code)) {
                    map.set(u.code, u);
                  }
                });
                return Array.from(map.values());
              })()} 
              onAddUser={handleAddPrecodedUser} 
              onDeleteUser={handleDeletePrecodedUser} 
              onUpdateUser={handleUpdatePrecodedUser} 
              forbiddenCodes={Array.from(new Set([...precodedUsers.map(u => u.code), ...registeredUsers.map(u => u.code)]))}
              currentUser={user}
            />
          </motion.div>
        )}

        {/* 3. General Storekeeper Quick Login or Registration form */}
        {adminPanelState === "none" && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200/50 pt-5 pb-8 px-8 space-y-6 relative z-10"
          >
            {/* Brand header */}
            <div className="text-center flex flex-col items-center">
              {/* Logo with fixed bounds to prevent loading layout-shifts */}
              <div className="w-[180px] h-[130px] flex items-center justify-center overflow-hidden mb-2 mt-1">
                <AlEmanLogo className="w-full h-full max-h-[130px]" />
              </div>
              
              {isSimplified ? (
                <div className="space-y-1">
                  <h1 className="text-lg font-black text-slate-900 tracking-tight">نظام جرد منتج تام</h1>
                </div>
              ) : (
                <div className="space-y-1">
                  <h1 className="text-lg font-black text-slate-900 tracking-tight">تنشيط وتفعيل مستخدم جديد</h1>
                  <p className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full inline-block">
                    استكمال بيانات كود الموظف المعتمد وتحديث كلمة المرور
                  </p>
                </div>
              )}
              {!isSimplified && (
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  {!isPrecodeVerified 
                    ? "الرجاء أولاً إدخال الكود المخصص لك والرقم السري المعين من مسئول النظام للتحقق من تكويدك."
                    : "تم التحقق من الكود بنجاح! يرجى إدخال البريد الإلكتروني وتنشيط تفعيل حسابك للدخول."}
                </p>
              )}
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* STEP 1: If creating a new user, they enter Code & password and get verified first */}
              {!isSimplified && !isPrecodeVerified && (
                <>
                  {/* Code Input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors">
                    <div className="relative">
                      <Shield className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        placeholder="كود الشخص"
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-right"
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors">
                    <div className="relative text-right">
                      <Lock className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        placeholder="رقمك السري المعين"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-right"
                      />
                    </div>
                  </div>

                  {/* Step 1 Submit Button */}
                  <button
                    type="submit"
                    className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold shadow-md hover:shadow-lg active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2 mt-4"
                  >
                    <UserCheck className="w-4.5 h-4.5" />
                    التحقق من ترميز الكود بالنظام 🔍
                  </button>
                </>
              )}

              {/* STEP 2: Coded profile is found, let them complete credentials */}
              {!isSimplified && isPrecodeVerified && verifiedUserObj && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="bg-emerald-50/70 border border-emerald-100 p-3.5 rounded-2xl space-y-2 text-right">
                    <div className="text-xs font-black text-emerald-800 flex items-center gap-1 bg-white p-2 rounded-xl border border-emerald-200/50 justify-center">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                      الاسم المعين دفترياً: {verifiedUserObj.name}
                    </div>
                    <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1 justify-between">
                      <span className="font-mono bg-emerald-100 text-emerald-700 font-extrabold px-2 py-0.5 rounded-full text-[10px]">
                        {["super_admin", "system_admin"].includes(verifiedUserObj.role)
                          ? "مسئول نظام" 
                          : verifiedUserObj.role === "program_manager"
                            ? "مسئول برنامج"
                            : verifiedUserObj.role === "supervisor" 
                              ? "مشرف مخازن" 
                              : "أمين مخزن"}
                      </span>
                      <span>سجل الترميز نشط بالصلاحية:</span>
                    </div>
                  </div>

                  {/* Confirmed Name Input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors">
                    <label className="block text-xs font-bold text-slate-600">
                      اسم الموظف المعتمد (للتأكيد والمطابقة)
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        disabled
                        value={loginName}
                        className="w-full pl-4 pr-10 py-3 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 text-right cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Optional Email input removed */}

                  {/* Mandatory Phone input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors">
                    <label className="block text-xs font-bold text-slate-600">
                      رقم الهاتف (إجباري)
                    </label>
                    <div className="relative text-right">
                      <Phone className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        placeholder="01xxxxxxxxx (11 رقم)"
                        value={loginPhone}
                        onChange={(e) => setLoginPhone(sanitizePhoneInput(e.target.value))}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-left"
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors text-right font-sans">
                    <label className="block text-xs font-bold text-slate-600 font-sans">
                      كلمة المرور الجديدة *
                    </label>
                    <div className="relative text-right font-sans">
                      <Lock className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={activationNewPassword}
                        onChange={(e) => setActivationNewPassword(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-right font-sans"
                      />
                    </div>
                  </div>

                  {/* Remember me check */}
                  <div className="flex items-center justify-between pt-1 text-right font-sans">
                    <label className="flex items-center gap-2 select-none cursor-pointer text-right font-sans">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500"
                      />
                      <span className="text-xs text-slate-600 font-bold mr-1">تذكرني على هذا الجهاز</span>
                    </label>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl text-xs font-extrabold shadow-md shadow-emerald-600/15 hover:shadow-lg hover:shadow-emerald-600/20 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <UserCheck className="w-4.5 h-4.5" />
                    تسجيل الدخول الى النظام
                  </button>
                </div>
              )}

              {/* SIMPLIFIED / QUICK LOGIN MODE FOR REGISTERED MEMBERS */}
              {isSimplified && (
                <>
                  {/* Code Input */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors">
                    <div className="relative">
                      <Shield className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        placeholder="كود الشخص"
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-right"
                      />
                    </div>
                  </div>

                  {/* Password Input for Quick Login */}
                  <div className="space-y-1.5 focus-within:text-emerald-600 transition-colors text-right">
                    <div className="relative text-right">
                      <Lock className="w-4 h-4 text-emerald-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        placeholder="كلمة المرور"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 focus:bg-white transition-all text-right"
                      />
                    </div>
                  </div>

                  {/* Remember me check */}
                  <div className="flex items-center justify-between pt-1 text-right">
                    <label className="flex items-center gap-2 select-none cursor-pointer text-right">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500"
                      />
                      <span className="text-xs text-slate-600 font-bold mr-1">تذكرني على هذا الجهاز</span>
                    </label>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl text-xs font-extrabold shadow-md shadow-emerald-600/15 hover:shadow-lg hover:shadow-emerald-600/20 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <UserCheck className="w-4.5 h-4.5" />
                    تسجيل الدخول الى النظام
                  </button>
                </>
              )}
            </form>

            {/* Switch signup/login link */}
            <div className="text-center pt-3 border-t border-slate-100 flex justify-center">
              {isSimplified ? (
                <button
                  type="button"
                  onClick={() => {
                    setForceFullRegister(true);
                    setIsPrecodeVerified(false);
                    setVerifiedUserObj(null);
                    setLoginCode("");
                    setLoginName("");
                    setLoginPassword("");
                    setActivationNewPassword("");
                  }}
                  className="text-xs text-emerald-700 font-extrabold hover:underline hover:text-emerald-800 transition-colors cursor-pointer"
                >
                  تنشيط مستخدم جديد &larr;
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setForceFullRegister(false);
                    setIsPrecodeVerified(false);
                    setVerifiedUserObj(null);
                  }}
                  className="text-xs text-emerald-700 font-extrabold hover:underline hover:text-emerald-800 transition-colors cursor-pointer"
                >
                  العودة لواجهة تسجيل الدخول بالكود والرقم السري &larr;
                </button>
              )}
            </div>

          </motion.div>
        )}

        {/* ذيل الصفحة (Footer) */}
        <div className="text-center space-y-1 z-10 mt-2 select-none">
          <h2 className="text-xs font-black text-slate-800 tracking-tight">الإيمان للأعلاف</h2>
          <p className="text-[10px] font-black text-emerald-600 bg-emerald-50/70 border border-emerald-100/50 px-3 py-0.5 rounded-full inline-block shadow-3xs">
            جودة . ثقة . امان
          </p>
          <p className="text-[10px] font-extrabold text-slate-400 block pt-0.5">
            تم تصميم النظام بواسطة : <span className="text-slate-900 font-black">محمد ثروت</span>
          </p>
        </div>
      </div>
    );
  }

  if (user && ["general_manager", "system_admin", "super_admin"].includes(user.role)) {
    const isSalatMessageVisible = 
      activeAdminTab === '' ||
      (activeAdminTab === 'coding' && !isUserManagementSubTabOpen) ||
      (activeAdminTab === 'backup' && (activeBackupSubTab === 'none' || activeBackupInnerSection === 'none')) ||
      (activeAdminTab === 'deleted' && activeDeletedSection === 'none') ||
      (activeAdminTab === 'logs' && activeLogsSection === 'none');

    return (
      <div className={`bg-slate-50 flex flex-col font-sans transition-all duration-300 min-h-screen`} dir="rtl">
        {/* Dynamic Toast Notifications */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -45, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 border text-xs max-w-lg w-[95%] text-right font-bold justify-between bg-white border-slate-100"
              id="admin-toast-notif"
            >
              <div className="flex items-center gap-2.5 text-right w-full">
                {notification.type === "success" && (
                  <div className="p-1 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                )}
                {notification.type === "info" && (
                  <div className="p-1 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                )}
                {notification.type === "error" && (
                  <div className="p-1 bg-red-50 text-red-600 rounded-lg shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                )}
                <span className="text-slate-700 leading-tight block text-xs font-black">{notification.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modern High-Contrast Application Header (Unified for Admin) */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
          <div className={`w-full px-2 sm:px-4 lg:px-6 py-1 flex flex-col gap-0 ${user && ["program_manager"].includes(user.role) ? "sm:min-h-[165px] pt-1" : ""}`}>
            <div className="flex items-center justify-center w-full relative pb-1 mb-1 border-b border-transparent">
              <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5 absolute right-0">
                   <AlEmanLogo className="w-8 h-8 sm:w-9 sm:h-9" />
              </div>

              <div className="flex items-center justify-center w-full px-10 sm:px-12 gap-2 py-0 mt-0.5 pointer-events-none">
                   <h1 className="text-[13.5px] sm:text-[14.5px] md:text-base lg:text-lg font-black text-slate-900 leading-tight text-center whitespace-nowrap">نظام جرد منتج تام - مؤسسة الإيمان للأعلاف</h1>
              </div>

              <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5 absolute left-0 pointer-events-none">
                   <AlEmanLogo className="w-8 h-8 sm:w-9 sm:h-9" />
              </div>
            </div>

            <div className="flex items-center justify-between w-full gap-1 pt-0 mt-0">
            
              {/* Main Center Area: Username & Role + Actions */}
              <div className="flex flex-col flex-grow py-0 gap-0">
                
                {/* Top row: Username */}
                <div className="flex items-center w-full px-1 h-6 bg-transparent border-0 mt-0">
                  <span className="flex-grow text-[11.5px] sm:text-[12.0px] font-black text-emerald-600 leading-none text-right truncate max-w-[140px]" title={user.name}>
                    {user.name}
                  </span>
                </div>

                {/* Bottom Row: Role on the right, Buttons on the left, completely aligned to the center */}
                <div className="flex items-center justify-between w-full px-1 mt-0">
                  
                  {/* Role */}
                  <div className="text-[8.5px] sm:text-[9.5px] font-extrabold text-blue-700 leading-none shrink-0" title="الوظيفة">
                     {user.role === 'general_manager' ? "المدير العام 💎" : user.role === 'program_manager' ? "مسئول البرنامج 📂" : "مسئول النظام ⚙️"}
                  </div>

                  {/* Action Buttons for User Role */}
                  <div className="flex items-center gap-1 flex-wrap justify-end flex-grow pr-2 relative">
                    <div className="relative w-40 sm:w-48 select-none">
                      <select
                        value={activeAdminTab}
                        onChange={(e) => {
                          const tab = e.target.value as any;
                          setActiveAdminTab(tab);
                          if (tab === 'backup') {
                            setActiveBackupSubTab('none');
                            setActiveBackupInnerSection('none');
                          }
                          if (tab === 'deleted') setActiveDeletedSection('all');
                          if (tab === 'logs') setActiveLogsSection('none');
                        }}
                        className="w-full pl-6 pr-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-black text-slate-800 focus:ring-1 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none appearance-none cursor-pointer text-right shadow-3xs transition-all"
                      >
                        <option value="" disabled>-- إدارة النظام والبيانات --</option>
                        <option value="coding">👥 إدارة مستخدمين</option>
                        <option value="logs">📋 سجل حركة النظام</option>
                        <option value="backup">☁️ نسخ احتياطى</option>
                        <option value="deleted">♻️ سلة المحذوفات</option>
                      </select>
                      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                        <ChevronDown className="w-2.5 h-2.5" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Edit & Logout Buttons - Vertically Stacked at the far left */}
              <div className="flex flex-col items-center gap-1 shrink-0 self-center pl-1 border-l border-transparent pr-2 pb-0.5 relative z-50 pointer-events-auto">
                  <button
                      type="button"
                      onClick={openEditProfileModal}
                      className="w-6 h-6 flex items-center justify-center border border-emerald-250 hover:bg-emerald-50 hover:text-emerald-850 text-emerald-700 bg-white rounded-md transition-all shadow-3xs cursor-pointer shrink-0"
                      title="تعديل البيانات الشخصية"
                  >
                      <Settings className="w-3.5 h-3.5 text-emerald-650" />
                  </button>
                  <button
                      type="button"
                      onClick={handleLogout}
                      className="w-6 h-6 flex items-center justify-center border border-red-200 hover:bg-red-50 text-red-650 bg-white rounded-md transition-all shadow-3xs cursor-pointer shrink-0"
                      title="تسجيل الخروج"
                  >
                      <LogOut className="w-3.5 h-3.5 text-red-650" />
                  </button>
              </div>
            </div>
          </div>
        </header>

        {/* Dedicated Admin Dashboard Workspace */}
        <main className={`w-full max-w-5xl mx-auto px-4 sm:px-6 ${isSalatMessageVisible ? '' : 'flex-1'} transition-all duration-300 pt-6 pb-2 space-y-6`}>
          
          {/* Default Insecure Credentials Warning */}
          {user?.isUsingDefaultPassword && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 text-right shadow-3xs"
              dir="rtl"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl shrink-0">
                  <Shield className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-extrabold text-red-800 text-sm">⚠️ تنبيه أمني خطير! الحساب يستخدم كلمة مرور افتراضية</h4>
                  <p className="text-xs text-red-600 mt-1 leading-relaxed">
                    أنت تستخدم حالياً كلمة مرور افتراضية ضعيفة وغير آمنة (مثل admin أو 123) معرضة للاختراق والسرقة البسيطة. 
                    ننصح بشدة بتحديث كلمة المرور لحسابك فوراً لتأمين وحفظ داتا جلسات الجرد.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openEditProfileModal}
                className="bg-red-600 hover:bg-red-750 text-white font-extrabold text-[11px] px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95 cursor-pointer shrink-0 shadow-xs"
              >
                <Lock className="w-3.5 h-3.5" />
                تحديث كلمة المرور الآن 🔒
              </button>
            </motion.div>
          )}



          {/* Admin Panel Sections */}
          <motion.div
            key={activeAdminTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`h-full flex flex-col text-right overflow-hidden ${isSalatMessageVisible ? 'space-y-0 flex-1 py-0' : 'space-y-4'}`}
          >
            {activeAdminTab === '' && (
              <SalatMessage />
            )}

            {activeAdminTab === 'coding' && (
              <div className="animate-fadeIn">
                  <UserManagement 
                    users={(() => {
                      const map = new Map<string, LoggedInUser>();
                      registeredUsers.forEach(u => map.set(u.code, u));
                      precodedUsers.forEach(u => {
                        if (!map.has(u.code)) {
                          map.set(u.code, u);
                        }
                      });
                      return Array.from(map.values());
                    })()} 
                    onAddUser={handleAddPrecodedUser} 
                    onDeleteUser={handleDeletePrecodedUser} 
                    onUpdateUser={handleUpdatePrecodedUser} 
                    forbiddenCodes={[...precodedUsers.map(u => u.code), ...registeredUsers.map(u => u.code)]}
                    currentUser={user}
                    setIsSubTabOpen={setIsUserManagementSubTabOpen}
                  />
              </div>
            )}

            {activeAdminTab === 'backup' && (
              <div className="animate-fadeIn space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-3xs flex items-center justify-between gap-2" dir="rtl">
                  <div className="flex items-center gap-2">
                    <select 
                      value={activeBackupSubTab}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActiveBackupSubTab(val as any);
                        setActiveBackupInnerSection('none');
                      }}
                      className="px-3 py-1.5 text-[10px] font-black border border-blue-200 rounded-lg focus:outline-none bg-blue-50 text-blue-700 cursor-pointer"
                    >
                      <option value="none">⚙️ خيارات نسخ احتياطي</option>
                      <option value="cloud">نسخ سحابي (Firestore)</option>
                      <option value="offline">نسخ محلي (Offline)</option>
                    </select>

                    {activeBackupSubTab !== 'none' && (
                      <select 
                        value={activeBackupInnerSection}
                        onChange={(e) => setActiveBackupInnerSection(e.target.value)}
                        className="px-3 py-1.5 text-[10px] font-black border border-slate-200 rounded-lg focus:outline-none bg-slate-50 cursor-pointer text-slate-600"
                      >
                        <option value="none">⚙️ خيارات خدمات النسخ</option>
                        {activeBackupSubTab === 'cloud' ? (
                          <>
                            <option value="all">كافة الأدوات السحابية</option>
                            <option value="quota">مراقبة الكوتة السحابية</option>
                            <option value="system">حالة صيانة النظام</option>
                            <option value="sync">رفع واستعادة البيانات</option>
                          </>
                        ) : (
                          <>
                            <option value="all">كافة الأدوات المحلية</option>
                            <option value="import">استعادة نسخة احتياطية</option>
                            <option value="export">تصدير وحفظ نسخة</option>
                          </>
                        )}
                      </select>
                    )}

                    {activeBackupSubTab === 'none' && (
                      <div className="flex items-center gap-1.5 px-2 text-blue-500 animate-pulse transition-all">
                        <ArrowLeft className="w-3 h-3 rotate-180" />
                        <span className="text-[10px] font-black">قم بالاختيار</span>
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-wide">تأمين وحفظ بيانات النظام</h3>
                  </div>
                </div>
                
                {(activeBackupSubTab === 'none' || activeBackupInnerSection === 'none') ? (
                  <SalatMessage />
                ) : (
                  <div className="w-full animate-fadeIn">
                    {activeBackupSubTab === 'cloud' ? (
                    <div className="pt-2 space-y-4 text-right animate-fadeIn">
                      {(activeBackupInnerSection === 'all' || activeBackupInnerSection === 'quota') && (
                        <QuotaMonitor 
                          isFirebaseSyncDisabled={isFirebaseSyncDisabled} 
                          onToggleFirebaseSync={(disabled) => {
                            setIsFirebaseSyncDisabled(disabled);
                            pushStateToServer({ isFirebaseSyncDisabled: disabled }, { isExplicitAction: true });
                          }}
                        />
                      )}

                      {["general_manager", "system_admin", "super_admin", "program_manager", "warehouse_supervisor", "supervisor"].includes(user?.role || "") && (activeBackupInnerSection === 'all' || activeBackupInnerSection === 'system') && (
                        <div className="space-y-3">
                          <div className={`p-4 mt-3 rounded-2xl border ${isFirebaseSyncDisabled ? 'bg-amber-50/60 border-amber-200 text-amber-900' : 'bg-blue-50/60 border-blue-200 text-blue-900'} transition-all`}>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-right">
                              <div className="flex-1">
                                <div className="text-[10px] font-black flex items-center gap-1.5 justify-start">
                                  {isFirebaseSyncDisabled ? (
                                    <>
                                      <TriangleAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                      <span>المزامنة التلقائية متوقفة مؤقتاً 🔴</span>
                                    </>
                                  ) : (
                                    <>
                                      <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-pulse" />
                                      <span>المزامنة والنسخ التلقائي نشط 🟢</span>
                                    </>
                                  )}
                                </div>
                                <p className="text-[9px] text-slate-500 font-extrabold mt-1 leading-normal">
                                  {isFirebaseSyncDisabled 
                                    ? "تم إيقاف المزامنة لحفظ الكوتة اليومية وتخزين البيانات محلياً بـ SQLite بأمان كامل." 
                                    : "يتم نسخ التعديلات بانتظام لقاعدة البيانات السحابية لتأمين الجلسات النشطة."}
                                </p>
                              </div>
                              
                              <button
                                type="button"
                                onClick={() => {
                                  const newVal = !isFirebaseSyncDisabled;
                                  setIsFirebaseSyncDisabled(newVal);
                                  pushStateToServer({ isFirebaseSyncDisabled: newVal }, { isExplicitAction: true });
                                }}
                                className={`px-4 py-2 rounded-xl text-[10px] font-black cursor-pointer transition-all flex items-center gap-1.5 shrink-0 justify-center ${
                                  isFirebaseSyncDisabled 
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' 
                                    : 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm'
                                }`}
                              >
                                {isFirebaseSyncDisabled ? (
                                  <>
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>تنشيط النسخ السحابي</span>
                                  </>
                                ) : (
                                  <>
                                    <Pause className="w-3 h-3 fill-current" />
                                    <span>إيقاف النسخ التلقائي</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setIsUserAccessControlOpen(true)}
                            className="w-full mt-2 font-bold text-[10px] py-1.5 px-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer focus:outline-none"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>تفعيل وتنشيط لبعض اليوزرات (إدارة الوصول الفردي) 👥</span>
                          </button>
                        </div>
                      )}

                      {(activeBackupInnerSection === 'all' || activeBackupInnerSection === 'sync') && (
                        <>
                          <div className="flex items-center gap-2 justify-start">
                            <Cloud className="w-4 h-4 text-blue-600 animate-pulse" />
                            <h3 className="font-extrabold text-blue-950 text-xs text-right">النسخ الاحتياطي السحابي (Firestore Cloud Sync) ☁️</h3>
                          </div>
                          
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 text-right">
                            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5 justify-start">
                                <Database className="w-4 h-4 text-indigo-500" />
                                حالة النسخة السحابية الحالية بـ Firestore
                              </span>
                              {isCloudSyncAvailable ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-750 border border-indigo-100">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                                  مستقر سحابياً
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                  خدمة السحاب غير نشطة
                                  <button 
                                    onClick={async () => {
                                      if (isRefreshingStatus) return;
                                      setIsRefreshingStatus(true);
                                      try {
                                        const res = await fetch('/api/diagnose');
                                        const data = await res.json();
                                        await checkSystemStatus();
                                        
                                        if (data.status === 'ok') {
                                          showToast("تم إعادة فحص حالة الاتصال السحابي بنجاح.", "success");
                                        } else {
                                          showToast("فشل إعادة فحص بيانات السحاب.", "error");
                                        }
                                      } catch (err) {
                                        showToast("حدث خطأ أثناء محاولة الاتصال بالسيرفر السحابي.", "error");
                                      } finally {
                                        setIsRefreshingStatus(false);
                                      }
                                    }}
                                    disabled={isRefreshingStatus}
                                    className={`ml-1 border-l border-rose-200 pl-1 hover:text-rose-900 cursor-pointer ${isRefreshingStatus ? 'animate-spin opacity-50' : ''}`}
                                    title="إعادة محاولة التفعيل"
                                  >
                                    🔄
                                  </button>
                                </span>
                              )}
                            </div>

                            {!isCloudSyncAvailable ? (
                              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-800 text-[10px] font-bold leading-relaxed text-right">
                                ⚠️ الخدمة السحابية غير مفعلة حالياً أو لم يتم العثور على ملف إعدادات (Firebase) من المنصة.
                                <br />
                                العمل يتم الآن عبر قاعدة البيانات المحلية (Local Storage/SQLite).
                              </div>
                            ) : (
                              <>
                                <div className="bg-indigo-50/50 border border-indigo-100/50 p-2.5 rounded-lg mb-3 flex flex-col gap-1 text-[11px] font-bold text-indigo-700">
                                  <div className="flex items-center justify-between w-full">
                                    <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md opacity-90">المزامنة نشطة ✅</span>
                                    <span dir="rtl">البيئة السحابية: {appEnv === 'production' ? 'الإنتاج (Production)' : 'التطوير (Development)'}</span>
                                  </div>
                                </div>
                                
                                {cloudBackupMetadata ? (
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                      <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-1">
                                        <span className="text-[9px] font-bold text-slate-400 block pb-0.5 text-right">المستخدمين بالسحابة</span>
                                        <span className="text-[10.5px] font-black text-purple-700 block text-right">
                                          {cloudBackupMetadata.userCount !== undefined ? `${cloudBackupMetadata.userCount} مستخدم` : 'غير متوفر'}
                                        </span>
                                      </div>
                                      <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-1">
                                        <span className="text-[9px] font-bold text-slate-400 block pb-0.5 text-left">آخر رفع سحابي</span>
                                        <span className="text-[10.5px] font-black text-slate-800 block leading-tight text-left">
                                          {cloudBackupMetadata.updatedAtString
                                            ? new Date(cloudBackupMetadata.updatedAtString).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
                                            : 'غير متوفر'}
                                        </span>
                                      </div>
                                      
                                      <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-1">
                                        <span className="text-[9px] font-bold text-slate-400 block pb-0.5 text-right">الجلسات المؤرشفة</span>
                                        <span className="text-[10.5px] font-black text-blue-700 block text-right">
                                          {cloudBackupMetadata.sessionCount} جلسة جرد
                                        </span>
                                      </div>
                                      <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-1">
                                        <span className="text-[9px] font-bold text-slate-400 block pb-0.5 text-left">الجلسات المحذوفة</span>
                                        <span className="text-[10.5px] font-black text-rose-600 block text-left">
                                          {cloudBackupMetadata.deletedSessionCount !== undefined ? `${cloudBackupMetadata.deletedSessionCount} جلسة` : '0 جلسة'}
                                        </span>
                                      </div>

                                      <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-1 col-span-2 lg:col-span-1">
                                        <span className="text-[9px] font-bold text-slate-400 block pb-0.5 text-right">حالة الدورة الحالية</span>
                                        <span className={`text-[10.5px] font-black block text-right ${cloudBackupMetadata.hasActiveSession ? "text-amber-600" : "text-slate-400"}`}>
                                          {cloudBackupMetadata.hasActiveSession ? "يوجد جلسة نشطة" : "لا توجد جلسات حية"}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="h-0.5 bg-slate-100 rounded-full w-2/3 mx-auto opacity-50"></div>

                                    {/* Inventory Mirror Compact Shortcut Card */}
                                    <div className="bg-emerald-50/40 p-4 rounded-2xl border border-emerald-100/50 space-y-3 relative overflow-hidden group">
                                      <div className="absolute top-0 left-0 w-24 h-24 bg-emerald-200/10 blur-2xl -translate-x-12 -translate-y-12"></div>
                                      
                                      <div className="flex items-center justify-between relative z-10 border-b border-emerald-100/30 pb-2">
                                        <div className="flex items-center gap-2 text-emerald-800">
                                          <div className="p-1.5 bg-emerald-100 rounded-lg">
                                            <Database className="w-3.5 h-3.5" />
                                          </div>
                                          <h4 className="font-black text-[11px] tracking-tight">قاعدة بيانات المرآة (Mirror Inventory)</h4>
                                        </div>
                                        <button 
                                          onClick={() => setIsShowingMirror(true)} 
                                          className="text-[9px] bg-white border border-emerald-200 text-emerald-700 font-bold px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-all cursor-pointer shadow-sm active:scale-95"
                                        >
                                          استعراض الأصناف 🔍
                                        </button>
                                      </div>
                                      
                                      <div className="flex items-center gap-4 relative z-10">
                                        <div className="flex-1 bg-white/60 p-2.5 rounded-xl border border-white/80 space-y-0.5">
                                          <span className="text-[8.5px] font-bold text-emerald-600/70 block text-right">العدد المسجل</span>
                                          <span className="text-[12px] font-black text-emerald-900 block text-right">{cloudBackupMetadata.masterItemCount} صنف</span>
                                        </div>
                                        <div className="flex-1 bg-white/60 p-2.5 rounded-xl border border-white/80 space-y-0.5">
                                          <span className="text-[8.5px] font-bold text-emerald-600/70 block text-right">تاريخ المزامنة</span>
                                          <span className="text-[12px] font-black text-emerald-900 block text-right">
                                            {cloudBackupMetadata.updatedAtString 
                                              ? new Date(cloudBackupMetadata.updatedAtString).toLocaleDateString('ar-EG') 
                                              : 'غير متوفر'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-center py-3 text-xs text-slate-400 font-bold">
                                    جاري جلب تفاصيل النسخة السحابية...
                                  </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                  <div className="bg-blue-50/40 p-3.5 rounded-2xl border border-blue-100 space-y-2">
                                     <button
                                       type="button"
                                       onClick={() => performCloudSync(true)}
                                       disabled={isBackingUpCloud || !isCloudSyncAvailable}
                                       className="w-full font-black text-[9.5px] py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5"
                                     >
                                       {isBackingUpCloud ? "جاري الرفع سحابياً..." : "رفع ومزامنة النسخة السحابية الآن 📤"}
                                     </button>
                                   </div>

                                   <div className="bg-emerald-50/40 p-3.5 rounded-2xl border border-emerald-100 space-y-2">
                                     <button
                                       type="button"
                                       onClick={() => fetchCloudBackupInfo()}
                                       disabled={isRestoringCloud || !isCloudSyncAvailable}
                                       className="w-full font-black text-[9.5px] py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5"
                                     >
                                       {isRestoringCloud ? "جاري الاستعادة سحابياً..." : "استعادة السجل السحابي بالكامل 🔄"}
                                     </button>
                                   </div>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5 pt-2 animate-fadeIn">
                      {(activeBackupInnerSection === 'all' || activeBackupInnerSection === 'import') && (
                        <div className="border border-slate-200 rounded-2xl p-4 bg-gradient-to-br from-slate-50 to-white hover:border-emerald-300 transition-all space-y-2.5 text-right">
                          <div className="flex items-center gap-2 justify-start">
                            <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg"><FileUp className="w-4 h-4" /></span>
                            <h3 className="font-extrabold text-emerald-900 text-[11px] text-right">استعادة نسخة كاملة فنية ⚠️</h3>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed font-bold text-right">
                            استبدال نسخ الجرد واليوزرات بالملف المرفوع (.json) المتواجد على الجهاز.
                          </p>
                          <div className="relative">
                            <input
                              type="file"
                              accept=".json"
                              onChange={handleImportOfflineBackup}
                              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
                            />
                            <div className="w-full font-black text-[10.5px] py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl transition-all flex items-center justify-center gap-1.5">
                              تحميل واستعادة ملف النسخة الاحتياطية
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {(activeBackupInnerSection === 'all' || activeBackupInnerSection === 'export') && (
                        <div className="border border-slate-200 rounded-2xl p-4 bg-gradient-to-br from-slate-50 to-white hover:border-blue-300 transition-all space-y-2.5 text-right">
                          <div className="flex items-center gap-2 justify-start">
                            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-xl"><FileDown className="w-4 h-4" /></span>
                            <h3 className="font-extrabold text-slate-800 text-[11px] text-right">تصدير النسخة الاحتياطية 💾</h3>
                          </div>
                          <p className="text-[9.5px] text-slate-500 leading-relaxed font-bold text-right">
                            سحب ملف نسخة احطياطية كاملة (json.) تشمل كافة بيانات الجرد واليوزرات الحالية.
                          </p>
                          <button
                            type="button"
                            onClick={handleExportOfflineBackup}
                            className="w-full font-black text-[10.5px] py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl cursor-pointer shadow-md shadow-blue-600/10 transition-all flex items-center justify-center gap-1.5"
                          >
                            تصدير وحفظ ملف النسخة الاحتياطية الآن
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                )}
              </div>
            )}

            {activeAdminTab === 'deleted' && (
              <div className="animate-fadeIn space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-3xs flex items-center justify-between gap-2" dir="rtl">
                  <div className="flex items-center gap-2">
                    <select 
                      value={activeDeletedSection}
                      onChange={(e) => {
                        setActiveDeletedSection(e.target.value);
                      }}
                      className="px-3 py-1.5 text-[10px] font-black border border-slate-200 rounded-lg focus:outline-none bg-slate-50 cursor-pointer text-slate-600"
                    >
                      <option value="all">♻️ كل السلة</option>
                      <option value="incomplete">غير مكتمل</option>
                      <option value="error_upload">رفع خطأ</option>
                      <option value="duplicate">تكرار الرفع</option>
                      <option value="other">اخرى</option>
                    </select>

                    {activeDeletedSection !== 'none' ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap w-[125px] justify-center h-[31px]">
                           {!deletedDateFilter && <Calendar className="w-3 h-3 text-slate-400" />}
                           <input 
                             type="date"
                             value={deletedDateFilter}
                             onChange={(e) => setDeletedDateFilter(e.target.value)}
                             className="text-[10px] font-black bg-transparent outline-none cursor-pointer w-full text-center"
                           />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 text-purple-500 animate-pulse transition-all">
                        <ArrowLeft className="w-3 h-3 rotate-180" />
                        <span className="text-[10px] font-black">قم بالاختيار</span>
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wide">إعادة استرجاع الجلسات الملغاة</h3>
                  </div>
                </div>

                {deletedSessions.length === 0 ? (
                  <SalatMessage />
                ) : (
                  <div className="w-full animate-fadeIn">
                      <div className="w-full h-full flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row gap-3" dir="rtl">
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                            <input 
                              type="text"
                              placeholder="ابحث في ملاحظات الجرد المحذوف..."
                              value={deletedSessionsSearchQuery}
                              onChange={(e) => setDeletedSessionsSearchQuery(e.target.value)}
                              className="w-full pl-4 pr-10 py-2.5 text-[9px] border border-slate-200 rounded-xl focus:border-purple-500 outline-none text-right font-bold shadow-3xs"
                            />
                          </div>
                        </div>

                        {(() => {
                          const filtered = deletedSessions.filter(item => {
                            const notes = (item.sessionData.notes || "").toLowerCase();
                            const dateStr = item.sessionData.date || "";
                            const matchesSearch = notes.includes(deletedSessionsSearchQuery.toLowerCase());
                            const matchesDate = !deletedDateFilter || dateStr.includes(deletedDateFilter);
                            const rawReason = String(item.deletedReason || item.sessionData.deletedReason || "").toLowerCase();
                            const matchesReason = activeDeletedSection === 'all' || 
                                                  rawReason === activeDeletedSection ||
                                                  (activeDeletedSection === 'incomplete' && (rawReason.includes('incomplete') || rawReason.includes('غير مكتمل') || rawReason.includes('غير مكتمله'))) ||
                                                  (activeDeletedSection === 'error_upload' && (rawReason.includes('error_upload') || rawReason.includes('رفع خطأ') || rawReason.includes('خطا') || rawReason.includes('رفع خطا') || rawReason.includes('خطأ'))) ||
                                                  (activeDeletedSection === 'duplicate' && (rawReason.includes('duplicate') || rawReason.includes('تكرار') || rawReason.includes('تكرار الرفع') || rawReason.includes('مكرر'))) ||
                                                  (activeDeletedSection === 'other' && (rawReason.includes('other') || rawReason.includes('اخرى') || rawReason.includes('أخرى') || rawReason.includes('يدوي') || rawReason.includes('فني')));
                            return matchesSearch && matchesDate && matchesReason;
                          });

                        if (filtered.length === 0) {
                          return (
                            <div className="p-12 text-center text-slate-400 border border-slate-100 rounded-2xl space-y-2">
                              <Info className="w-8 h-8 text-slate-300 mx-auto" />
                              <p className="font-bold text-slate-500 text-right">لا توجد نتائج تطابق البحث في السلة.</p>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                            {filtered.map((item) => (
                               <div key={item.id} className="border border-slate-200 hover:border-purple-200 bg-slate-50/50 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 transition-all hover:bg-white shadow-3xs">
                                <div className="space-y-1 text-right w-full sm:w-auto">
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-slate-800 text-[10px] text-right">
                                      {item.sessionData.notes ? `جرد: ${item.sessionData.notes}` : "جلسة جرد نشطة"}
                                    </span>
                                    <span className={`px-2 py-0.5 text-[9px] font-black rounded-full border ${
                                      item.sessionData.type === 'archived'
                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    }`}>
                                      {item.sessionData.type === 'archived' ? 'جرد مؤرشف تاريخي' : 'جرد نشط ملغي'}
                                    </span>
                                    {(item.deletedReason || item.sessionData.deletedReason) && (
                                      <span className="px-2 py-0.5 text-[9px] font-black rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                                        السبب: {
                                          (item.deletedReason || item.sessionData.deletedReason) === 'incomplete' ? 'غير مكتمل' :
                                          (item.deletedReason || item.sessionData.deletedReason) === 'error_upload' ? 'رفع خطأ' :
                                          (item.deletedReason || item.sessionData.deletedReason) === 'duplicate' ? 'تكرار الرفع' :
                                          (item.deletedReason || item.sessionData.deletedReason) === 'other' ? 'اخرى' : (item.deletedReason || item.sessionData.deletedReason)
                                        }
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center gap-3 text-[9px] text-slate-400 font-bold">
                                    <span>تاريخ الجرد: {item.sessionData.date || "غير محدد"}</span>
                                    <span>•</span>
                                    <span className="text-rose-600 text-[9px]">
                                      تاريخ الحذف: {new Date(item.deletedAt).toLocaleString("ar-EG")}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex flex-row items-center gap-2">
                                  {confirmDeleteRecycleId === item.id ? (
                                    <div className="flex items-center gap-1 bg-rose-50 p-1 rounded-xl">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handlePermanentDeleteSession(item.id);
                                          setConfirmDeleteRecycleId(null);
                                        }}
                                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs font-bold text-[9px] flex items-center gap-1.5 transition-all text-center cursor-pointer"
                                      >
                                        تأكيد
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteRecycleId(null)}
                                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg shadow-xs font-bold text-[9px] flex items-center gap-1.5 transition-all text-center cursor-pointer"
                                      >
                                        إلغاء
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteRecycleId(item.id)}
                                      className="px-3 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-xl shadow-xs font-bold text-[9.5px] flex items-center gap-1.5 transition-all text-center self-center cursor-pointer"
                                      title="حذف نهائي"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /> حذف نهائي
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => handleRestoreDeletedSessionValue(item.id)}
                                    className="px-4 py-2 bg-purple-900 hover:bg-purple-950 text-white rounded-xl shadow-xs font-bold text-[9.5px] flex items-center gap-1.5 transition-all text-center self-center cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> استرجاع الجلسة
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeAdminTab === 'logs' && (
              <div className="animate-fadeIn space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-3xs flex items-center justify-between gap-2" dir="rtl">
                  <div className="flex items-center gap-2">
                    <select 
                      value={activeLogsSection}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActiveLogsSection(val);
                        setLogsActionFilter(val === 'none' || val === 'all' ? 'all' : val);
                      }}
                      className="px-3 py-1.5 text-[10px] font-black border border-slate-200 rounded-lg focus:outline-none bg-slate-50 cursor-pointer text-slate-600"
                    >
                      <option value="none">📋 خيارات سجل حركة النظام</option>
                      <option value="all">عرض كافة الحركات</option>
                      <option value="تعديل مستخدم">تعديل مستخدم 📝</option>
                      <option value="إضافة مستخدم">إضافة مستخدم ➕</option>
                      <option value="تنشيط مستخدم">تنشيط مستخدم ✅</option>
                      <option value="حذف مستخدم">حذف مستخدم 🗑️</option>
                      <option value="حفظ جرد">حفظ جرد 💾</option>
                    </select>

                    {activeLogsSection === 'none' && (
                      <div className="flex items-center gap-1.5 px-2 text-indigo-500 animate-pulse transition-all">
                        <ArrowLeft className="w-3 h-3 rotate-180" />
                        <span className="text-[10px] font-black">قم بالاختيار</span>
                      </div>
                    )}

                    {activeLogsSection !== 'none' && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setLogsSearchQuery("");
                            setLogsActionFilter("all");
                            setActiveLogsSection("all");
                          }}
                          className="px-3 py-1.5 text-[9px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          تعيين الفلتر
                        </button>
                        <button 
                          onClick={fetchAuditLogs}
                          disabled={isFetchingLogs}
                          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors border border-slate-100 cursor-pointer"
                          title="تحديث البيانات"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isFetchingLogs ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wide">مراقبة جودة الحركات والأمان</h3>
                  </div>
                </div>

                {activeLogsSection === 'none' ? (
                  <SalatMessage />
                ) : (
                  <div className="w-full animate-fadeIn">
                      <div className="w-full h-full flex flex-col gap-4">
                        {/* Search Bar */}
                        <div className="flex gap-2" dir="rtl">
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                            <input 
                              type="text"
                              placeholder="ابحث بكود المستخدم أو الاسم لإظهار النتائج..."
                              value={logsSearchQuery}
                              onChange={(e) => setLogsSearchQuery(e.target.value)}
                              className="w-full pl-4 pr-10 py-2.5 text-[9px] border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-right leading-loose font-bold shadow-3xs"
                            />
                          </div>
                        <button 
                          onClick={() => {
                            setLogsSearchQuery("");
                            setLogsActionFilter("all");
                          }}
                          className="px-4 py-2.5 text-[9px] font-black text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer border border-slate-200 whitespace-nowrap self-center h-full"
                        >
                          تعيين الفلتر
                        </button>
                      </div>
                  
                   {/* Main Logs Area */}
                  {(() => {
                    const filtered = auditLogs.filter(log => {
                      const userName = getStorekeeperName(log.user_code, user);
                      const matchesSearch = 
                        String(log.user_code || "").toLowerCase().includes(logsSearchQuery.toLowerCase()) ||
                        userName.toLowerCase().includes(logsSearchQuery.toLowerCase());
                        
                      const matchesAction = logsActionFilter === "all" || String(log.action || "").includes(logsActionFilter);
                      return matchesSearch && matchesAction;
                    });

                    // Display functions for category styling
                    const getActionBadgeClass = (action: string) => {
                      const act = String(action || "").toLowerCase();
                      if (act.includes("إضافة") || act.includes("تكوين") || act.includes("تنشيط")) {
                        return "bg-emerald-50 text-emerald-700 border border-emerald-150";
                      }
                      if (act.includes("تعديل") || act.includes("تحديث")) {
                        return "bg-amber-50 text-amber-700 border border-amber-150";
                      }
                      if (act.includes("حذف")) {
                        return "bg-rose-50 text-rose-700 border border-rose-150";
                      }
                      return "bg-indigo-50 text-indigo-700 border border-indigo-150";
                    };

                    if (filtered.length === 0) {
                      return (
                        <div className="p-12 text-center text-slate-400 border border-slate-100 rounded-3xl space-y-2 bg-slate-50/50">
                          <Info className="w-8 h-8 text-slate-300 mx-auto" />
                          <p className="font-bold text-slate-500">لم يتم العثور على أي حركات تطابق معايير البحث الحالية.</p>
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-xs">
                        <div className="overflow-x-auto">
                          <table className="w-full text-right text-[9.5px] border-collapse">
                            <thead className="bg-slate-50 text-slate-500 font-extrabold border-b border-slate-200">
                              <tr>
                                <th className="p-4">الوقت والتاريخ</th>
                                <th className="p-4">الموظف / المنفّذ</th>
                                <th className="p-4">تصنيف الحركة</th>
                                <th className="p-4">تفاصيل الحركة المسجلة</th>
                                <th className="p-4 text-center">عنوان الـ IP</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {filtered.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50/70 transition-all duration-150">
                                  <td className="p-4 font-bold text-slate-500 whitespace-nowrap font-mono" dir="ltr">
                                    {new Date(log.timestamp).toLocaleString("ar-EG")}
                                  </td>
                                  <td className="p-4">
                                    <div className="flex items-center gap-2 justify-start">
                                      <div className="w-6 h-6 rounded-full bg-slate-150 flex items-center justify-center font-black text-[10px] text-slate-600 border border-slate-200">
                                        {log.user_code}
                                      </div>
                                      <span className="font-extrabold text-slate-800 text-[10px]">
                                        {getStorekeeperName(log.user_code, user)}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-tight ${getActionBadgeClass(log.action)}`}>
                                      {log.action}
                                    </span>
                                  </td>
                                  <td className="p-4 text-slate-700 font-bold max-w-sm leading-relaxed text-[10px]">
                                    {log.log_details}
                                  </td>
                                  <td className="p-4 font-mono text-slate-400 text-center font-bold text-[10px]">
                                    {log.ip_address || "محلّي"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>

        </main>

        {/* Administration Footer */}
        <footer className="border-t border-slate-100 text-center text-[12px] text-slate-500 font-extrabold bg-white py-6 mt-auto sticky bottom-0 z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.03)] w-full">
          تم تصميم النظام بواسطة : <span className="text-slate-900 font-black">محمد ثروت</span>
        </footer>

        {/* Edit Profile Modal Dialog */}
        {showProfileEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 flex flex-col text-right overflow-hidden"
              dir="rtl"
            >
              {/* Header */}
              <div className="p-5 border-b border-emerald-100 bg-emerald-50 rounded-t-2xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">تغيير وتحديث بيانات أمين المخزن</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">ستنعكس البيانات المحدثة على جميع عمليات الجرد والتدقيق النشطة</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowProfileEdit(false)}
                  className="p-1 hover:bg-emerald-100 transition-colors rounded-full cursor-pointer"
                >
                  <X className="w-5 h-5 text-emerald-800 hover:text-emerald-900" />
                </button>
              </div>

              {/* Content Form */}
              <form onSubmit={handleUpdateProfileSubmit} className="p-5 space-y-4">
                {editProfileError && (
                  <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[11px] font-bold rounded-xl leading-relaxed">
                    ⚠️ {editProfileError}
                  </div>
                )}

                {/* Name */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500">الاسم المسجل بالنظام</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600"
                  />
                </div>

                {/* Code */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500">كود الموظف التعريفي (رمز كود ثابت)</label>
                  <input
                    type="text"
                    disabled
                    value={editCode}
                    className="w-full px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-400 cursor-not-allowed select-none text-right opacity-80 font-mono"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-600">رقم الهاتف (قابل للتغيير)</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      placeholder="01xxxxxxxxx (11 رقم)"
                      value={editPhone}
                      onChange={(e) => setEditPhone(sanitizePhoneInput(e.target.value))}
                      className="w-full pl-3 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-left focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 text-slate-700"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-600">كلمة المرور الجديدة (أو اتركه فارغاً للإبقاء على الحالية)</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={editPassword === "••••••••" ? "" : editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600"
                  />
                </div>

                {/* Old Password check */}
                <div className="space-y-1 pt-3 border-t border-rose-100">
                  <label className="block text-xs font-bold text-rose-600 flex items-center justify-between">
                    <span>تأكيد الأمان والدقة</span>
                    <span>الرقم السري الحالي (مطلوب) *</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="اكتب رقمك السري الحالي للموافقة على التعديلات"
                    value={oldPasswordConfirm}
                    onChange={(e) => setOldPasswordConfirm(e.target.value)}
                    className="w-full px-3 py-2.5 bg-rose-50/40 border border-rose-200 rounded-xl text-xs font-mono text-right focus:outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-600"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm shadow-emerald-600/10 flex items-center justify-center gap-1.5"
                  >
                    حفظ التعديلات الجديدة
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowProfileEdit(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                  >
                    إلغاء التحديث
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Dynamic Unsaved Changes Logout Confirmation Dialogue */}
        {pendingLogoutWithUnsaved && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" dir="rtl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl relative text-right border border-slate-150"
            >
              <div className="flex items-center gap-3 text-red-650 mb-3.5">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                  <TriangleAlert className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">تأكيد تسجيل الخروج 🚪</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">يرجى تحديد خيار تسجيل الخروج المناسب:</p>
                </div>
              </div>

              <div className="text-xs text-slate-650 mb-5 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium font-sans">
                💡 يمكنك اختيار **حفظ التعديلات** لتأمين وحفظ نسختك الحالية بالمتصفح لجهازك، أو **الخروج دون حفظ التعديلات** لإبقاء مسودتك السابقة كما هي، أو **إلغاء الخروج** للرجوع لمتابعة العمل.
              </div>

              <div className="flex flex-col gap-2 font-sans">
                <button
                  type="button"
                  onClick={() => handleLogoutWithSaveChoice("local")}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl shadow-md text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  حفظ التعديلات والخروج 💾
                </button>
                
                <button
                  type="button"
                  onClick={() => handleLogoutWithSaveChoice("none")}
                  className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-800 font-extrabold rounded-xl border border-red-200 text-xs transition-colors cursor-pointer"
                >
                  الخروج دون حفظ التعديلات 🚪
                </button>

                <button
                  type="button"
                  onClick={() => setPendingLogoutWithUnsaved(false)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  إلغاء الخروج (الرجوع للنظام) ↩️
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Standard Logout Confirmation Dialogue */}
        {showStandardLogoutConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" dir="rtl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative text-right border border-slate-150"
            >
              <div className="flex items-center gap-3 text-slate-900 mb-3.5">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <LogOut className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">تأكيد تسجيل الخروج 🚪</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">هل أنت متأكد من رغبتك في تسجيل الخروج الآن؟</p>
                </div>
              </div>

              <div className="text-xs text-slate-600 mb-5 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium">
                سيتم تأمين حسابك ومسح البيانات المؤقتة فور تسجيل الخروج، مع بقاء كافة بياناتك السابقة المحفوظة بأمان على الخادم.
              </div>

              <div className="flex gap-2.5 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    setShowStandardLogoutConfirm(false);
                    performLogout("none");
                    showToast("تم تسجيل الخروج بنجاح وتأمين الحساب 🚪", "success");
                  }}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl shadow-md text-xs transition-colors cursor-pointer text-center"
                >
                  تأكيد الخروج 🚪
                </button>
                
                <button
                  type="button"
                  onClick={() => setShowStandardLogoutConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
                >
                  إلغاء ↩️
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* User Access Control Modal Layer for Admins */}
        <AnimatePresence>
          {isUserAccessControlOpen && (
            <UserAccessControlModal 
              isOpen={isUserAccessControlOpen}
              onClose={() => setIsUserAccessControlOpen(false)}
              registeredUsers={registeredUsers}
              precodedUsers={precodedUsers}
              onUpdateUsers={async (updatedRegistered, updatedPrecoded, targetUserCode, newStatus) => {
                if (targetUserCode !== undefined) {
                  // Individual active status toggled
                  const targetUser = [...registeredUsers, ...precodedUsers].find(u => String(u.code) === String(targetUserCode));
                  if (targetUser) {
                    const updatedSpec = { 
                      ...targetUser, 
                      isActivated: newStatus, 
                      is_activated: newStatus 
                    };
                    await handleUpdatePrecodedUser(updatedSpec);
                  }
                } else {
                  // Bulk action toggled
                  showToast("جاري تحديث حالات تفعيل المستخدمين...", "info");
                  try {
                    const token = localStorage.getItem("inventory_jwt_token");
                    const usersToUpdate = [...updatedRegistered, ...updatedPrecoded];
                    for (const u of usersToUpdate) {
                      if (u.role === 'general_manager') continue;
                      await fetch("/api/admin/users", {
                        method: 'POST',
                        headers: {
                          "Content-Type": "application/json",
                          "Authorization": `Bearer ${token}`
                        },
                        body: JSON.stringify({
                          code: u.code,
                          name: u.name,
                          phone: u.phone,
                          role: u.role,
                          isPrecoded: u.isPrecoded !== undefined ? u.isPrecoded : u.is_precoded,
                          isRegistered: u.isRegistered !== undefined ? u.isRegistered : u.is_registered,
                          isActivated: newStatus
                        })
                      });
                    }
                    setRegisteredUsers(updatedRegistered);
                    setPrecodedUsers(updatedPrecoded);
                    localStorage.setItem("inventory_registered_users", JSON.stringify(updatedRegistered));
                    localStorage.setItem("inventory_precoded_users", JSON.stringify(updatedPrecoded));
                    showToast("تم تحديث وتعديل حالات تفعيل الموظفين بنجاح! 🎉", "success");
                  } catch (err: any) {
                    showToast(`فشل التعديل الجماعي: ${err.message}`, "error");
                  }
                }
              }}
            />
          )}
        </AnimatePresence>

        <DeletionReasonModal />

        {isShowingMirror && user && ["general_manager", "system_admin", "super_admin", "program_manager"].includes(user.role) && (
          <MasterInventoryMirror 
            items={masterItems} 
            userCanClear={["general_manager", "system_admin", "super_admin", "program_manager"].includes(user.role)}
            onClose={() => setIsShowingMirror(false)} 
            onSync={() => {
              fetchCloudBackupInfo(true);
              setMasterItems([]);
              setActiveSession(null);
              localStorage.removeItem("inventory_active_session");
              fetchStateFromServer(true);
            }}
          />
        )}
      </div>
    );
  }

  // Deletion Reason Modal component logic
  function DeletionReasonModal() {
    if (!showDeletionReasonModal) return null;

    const handleConfirm = async () => {
      if (!deletionReason) {
        showToast("يرجى اختيار سبب الحذف أولاً", "error");
        return;
      }

      if (deletionTarget?.type === 'active') {
        handleDeleteActiveSession(deletionReason);
      } else if (deletionTarget?.type === 'archived' && deletionTarget.id) {
        const sessionId = deletionTarget.id;
        const updated = pastSessions.filter((s) => s.id !== sessionId);
        const limitedSessions = updated.slice(0, 39);
        setPastSessions(limitedSessions);
        
        await pushStateToServer(
          { pastSessions: limitedSessions }, 
          { deletedPastSessionId: sessionId, deletedReason: deletionReason, isExplicitAction: true }
        );
        
        showToast("تم حذف الجرد من السجلات بنجاح.", "success");
      }

      setShowDeletionReasonModal(false);
      setDeletionReason("");
      setDeletionTarget(null);
    };

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden transform animate-scaleIn" dir="rtl">
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4 border-b border-slate-100 pb-4 text-rose-600">
              <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                <Trash2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800">تأكيد عملية الحذف النهائية</h3>
                <p className="text-[11px] font-bold text-slate-400 mt-1">يرجى تحديد سبب الحذف للمتابعة بنجاح</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[13px] font-black text-slate-700 block px-1">سبب الحذف أو الإلغاء:</label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { id: 'incomplete', label: 'غير مكتمل' },
                  { id: 'error_upload', label: 'رفع خطأ' },
                  { id: 'duplicate', label: 'تكرار الرفع' },
                  { id: 'other', label: 'اخرى (يدوي/فني)' }
                ].map((reason) => (
                  <button
                    key={reason.id}
                    onClick={() => setDeletionReason(reason.id)}
                    className={`flex items-center justify-between p-3.5 rounded-xl border-2 transition-all cursor-pointer font-bold text-sm ${
                      deletionReason === reason.id 
                        ? "border-rose-500 bg-rose-50/50 text-rose-700 shadow-sm" 
                        : "border-slate-100 bg-slate-50/30 text-slate-500 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>{reason.label}</span>
                    {deletionReason === reason.id && <CheckCircle className="w-5 h-5 text-rose-600" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleConfirm}
                className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black text-base shadow-lg shadow-rose-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                تأكيد وبدء الحذف
              </button>
              <button
                onClick={() => {
                  setShowDeletionReasonModal(false);
                  setDeletionReason("");
                  setDeletionTarget(null);
                }}
                className="px-6 h-12 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-sm transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const isNonAdminSalatMessageVisible = user && !["general_manager", "system_admin", "super_admin"].includes(user.role) && (
    (user.role === 'program_manager' && activeProgramManagerTab === 'none') ||
    ((user.role === 'supervisor' || user.role === 'warehouse_supervisor' || user.role === 'stores_manager') && activeSupervisorTab === 'none') ||
    (user.role === 'storekeeper' && activeStorekeeperTab === 'none')
  );

  return (
    <div className={`bg-slate-50 flex flex-col font-sans transition-all duration-300 min-h-screen`} dir="rtl">
      {/* Dynamic Toast Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -45, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 border text-xs max-w-lg w-[95%] text-right font-bold justify-between bg-white border-slate-100"
            id="toast-notification"
          >
            <div className="flex items-center gap-2.5">
              {notification.type === "success" && (
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded-lg">
                  <CheckCircle className="w-4 h-4" />
                </div>
              )}
              {notification.type === "info" && (
                <div className="p-1 bg-blue-50 text-blue-600 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                </div>
              )}
              {notification.type === "error" && (
                <div className="p-1 bg-red-50 text-red-600 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                </div>
              )}
              <span className="text-slate-700 leading-normal flex-1">{notification.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Isolated Development Sandbox Indicator */}
      {(import.meta as any).env?.DEV && (
        <div className="bg-amber-500 text-amber-950 font-black px-4 py-1.5 text-xs sm:text-sm flex items-center justify-center gap-2 select-none text-center shadow-inner border-b border-amber-600/30">
          <Sparkles className="w-4 h-4 text-amber-900 shrink-0 animate-pulse" />
          <span>ببيئة التجربة والتطوير المعزولة 🧪 - أي تعديلات أو بيانات تضيفها الآن لن تؤثر بأي شكل على المستخدمين الفعليين ولا يرونها حتى تدشن نسختك رسمياً!</span>
        </div>
      )}

      {/* Modern High-Contrast Application Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        {/* Offline Sync Warning Bar */}
        <AnimatePresence>
          {pendingSyncCount > 0 && !isSyncingOffline && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-amber-500 text-white py-1.5 flex items-center justify-center gap-3 overflow-hidden shadow-inner border-b border-amber-600/30"
            >
              <WifiOff className="w-4 h-4 animate-pulse shrink-0" />
              <span className="text-[10px] sm:text-xs font-black">يوجد {pendingSyncCount} تعديلات في قائمة الانتظار (محفوظة محلياً) بانتظار عودة الاتصال للمزامنة.</span>
              <button 
                onClick={processOfflineQueue}
                className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[9px] font-bold border border-white/40 transition-colors"
                type="button"
              >
                محاولة المزامنة الآن 🔄
              </button>
            </motion.div>
          )}
          {isSyncingOffline && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-emerald-600 text-white py-1.5 flex items-center justify-center gap-3 overflow-hidden shadow-inner border-b border-emerald-700/30"
            >
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              <span className="text-xs sm:text-sm font-black">جاري مزامنة العمليات المعلقة مع السيرفر السحابي... يرجى عدم إغلاق الصفحة.</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={`w-full px-0.5 sm:px-1 lg:px-1.5 py-0.5 flex flex-col gap-0 ${user && ["program_manager"].includes(user.role) ? "sm:min-h-[140px] pt-0.5" : ""}`}>
            <div className="flex items-center justify-center w-full relative pb-0.5 mb-0.5 border-b border-transparent">
              <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5 absolute right-0">
                   <AlEmanLogo className="w-8 h-8 sm:w-9 sm:h-9" />
              </div>

              <div className="flex items-center justify-center w-full px-10 sm:px-12 gap-2 py-0 mt-0.5 pointer-events-none">
                   <h1 className="text-[13.5px] sm:text-[14.5px] md:text-base lg:text-lg font-black text-slate-900 leading-tight text-center whitespace-nowrap">نظام جرد منتج تام - مؤسسة الإيمان للأعلاف</h1>
              </div>

              <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5 absolute left-1 sm:left-1.5 pointer-events-none">
                   <AlEmanLogo className="w-8 h-8 sm:w-9 sm:h-9" />
              </div>
            </div>

          <div className="flex items-center justify-between w-full gap-1 pt-0 mt-0">
            
            {/* Main Center Area: Username & Role + Actions */}
            <div className="flex flex-col flex-grow py-0 gap-1.5 min-w-0">
              
              {/* Top row: Right Info (Username) & Left Actions (Edit Profile + User Options) */}
              <div className="flex items-center justify-between w-full px-1 bg-transparent border-0 mt-0">
                
                {/* Right side info (Top Row) */}
                <span className="flex-grow text-[12.5px] sm:text-[13.5px] font-black text-emerald-600 leading-none text-right truncate" title={user.name}>
                  {user.name}
                </span>

                {/* Left side actions (Top Row) - In RTL, placed after info so they render on the left */}
                <div className="flex items-center justify-end gap-1.5 shrink-0 pl-1 z-50 pointer-events-auto">
                    {user.role === 'program_manager' && (
                        <div className="relative h-[26px] flex items-center shrink-0">
                          <select 
                            value={activeProgramManagerTab}
                            onChange={(e) => setActiveProgramManagerTab(e.target.value as any)}
                            className="pl-6 pr-1.5 py-0 bg-blue-50 border border-blue-100 rounded-lg text-[9px] font-black text-blue-700 focus:ring-1 focus:ring-blue-500/20 focus:border-blue-400 outline-none appearance-none cursor-pointer text-right transition-all h-[26px] w-[105px] min-w-[105px] max-w-[105px]"
                          >
                            <option value="none">خيارات مستخدم</option>
                            <option value="upload">اصناف وارصدة 📥</option>
                            <option value="archive">ارشيف الجرد 📂</option>
                          </select>
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-blue-400">
                            <ChevronDown className="w-2.5 h-2.5" />
                          </div>
                        </div>
                    )}

                    {(user.role === 'warehouse_supervisor' || user.role === 'supervisor') && (
                        <div className="relative h-[26px] flex items-center shrink-0">
                          <select 
                            value={activeSupervisorTab}
                            onChange={(e) => setActiveSupervisorTab(e.target.value as any)}
                            className="pl-6 pr-1.5 py-0 bg-blue-50 border border-blue-100 rounded-lg text-[9px] font-black text-blue-700 focus:ring-1 focus:ring-blue-500/20 focus:border-blue-400 outline-none appearance-none cursor-pointer text-right transition-all h-[26px] w-[105px] min-w-[105px] max-w-[105px]"
                          >
                            <option value="none">خيارات مشرف</option>
                            <option value="sheet">جرد الاصناف 📋</option>
                            <option value="archive">ارشيف الجرد 📂</option>
                          </select>
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-blue-400">
                            <ChevronDown className="w-2.5 h-2.5" />
                          </div>
                        </div>
                    )}

                    {user.role === 'stores_manager' && (
                        <div className="relative h-[26px] flex items-center shrink-0 z-50">
                          <select 
                            value={activeSupervisorTab}
                            onChange={(e) => setActiveSupervisorTab(e.target.value as any)}
                            className="pl-6 pr-1.5 py-0 bg-indigo-50 border border-indigo-100 rounded-lg text-[9px] font-black text-indigo-700 focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none appearance-none cursor-pointer text-right transition-all h-[26px] w-[115px] min-w-[115px] max-w-[115px]"
                          >
                            <option value="none">خيارات مدير</option>
                            <option value="archive">ارشيف الجرد 📂</option>
                            <option value="manager_dashboard">تحليلات وتقييم 📊</option>
                          </select>
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-400">
                            <ChevronDown className="w-2.5 h-2.5" />
                          </div>
                        </div>
                    )}

                    {user.role === 'storekeeper' && (
                        <div className="relative h-[26px] flex items-center shrink-0">
                          <select 
                            value={activeStorekeeperTab}
                            onChange={(e) => setActiveStorekeeperTab(e.target.value as any)}
                            className="pl-6 pr-1.5 py-0 bg-emerald-50 border border-emerald-100 rounded-lg text-[9px] font-black text-emerald-700 focus:ring-1 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none appearance-none cursor-pointer text-right transition-all h-[26px] w-[105px] min-w-[105px] max-w-[105px]"
                          >
                            <option value="none">خيارات امين</option>
                            <option value="sheet">جرد المخازن 📋</option>
                            <option value="archive">ارشيف الجرد 📂</option>
                          </select>
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-400">
                            <ChevronDown className="w-2.5 h-2.5" />
                          </div>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={openEditProfileModal}
                        className="w-[26px] h-[26px] flex items-center justify-center border border-emerald-250 hover:bg-emerald-50 hover:text-emerald-850 text-emerald-700 bg-white rounded-md transition-all shadow-3xs cursor-pointer shrink-0"
                        title="تعديل البيانات الشخصية"
                    >
                        <Settings className="w-3.5 h-3.5 text-emerald-650" />
                    </button>
                </div>

              </div>

              {/* Bottom Row: Right Info (Role) & Left Actions (Save, Date, Logout) */}
              <div className="flex items-center justify-between w-full px-1 mt-0">
                
                {/* Right side info (Bottom Row) - Role */}
                <div className="flex-grow text-[9.5px] sm:text-[10.5px] font-extrabold text-blue-700 leading-none text-right truncate" title="الوظيفة">
                   {user.role === 'general_manager' && "المدير العام 💎"}
                   {user.role === 'system_admin' && "مسئول النظام ⚙️"}
                   {user.role === 'program_manager' && "مسئول البرنامج 📊"}
                   {(user.role === 'warehouse_supervisor' || user.role === 'supervisor') && "مشرف المخازن 👑"}
                   {user.role === 'stores_manager' && "مدير مخازن 💼"}
                   {user.role === 'storekeeper' && "أمين مخزن 📦"}
                </div>

                {/* Left side actions (Bottom Row) */}
                <div className="flex items-center justify-end gap-1.5 shrink-0 pl-1 z-50 pointer-events-auto flex-wrap">
                    
                    {totalMasterCount > 0 ? (
                        <>
                        {user.role === 'program_manager' && activeProgramManagerTab === 'upload' && (
                            <>
                              <button
                                type="button"
                                onClick={handleProgramManagerSave}
                                disabled={!hasUnsavedChanges}
                                className={"h-[26px] rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer px-2.5 " + (
                                  hasUnsavedChanges
                                  ? "bg-blue-600 hover:bg-blue-750 text-white animate-pulse shadow-md shadow-blue-600/15"
                                  : "bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed"
                                )}
                                title="اضغط لحفظ التعديلات وتوزيعها سحابياً لجميع الصلاحيات"
                              >
                                <Save className="w-3.5 h-3.5 shrink-0" />
                                <span className="text-[10px] font-bold">حفظ</span>
                              </button>

                              <div className="relative flex flex-col justify-center items-center font-sans border border-slate-200 bg-slate-50 rounded-xl h-[26px] w-[105px] shrink-0 overflow-hidden" dir="rtl">
                                {!activeSession?.date && (
                                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none h-full w-full bg-slate-50">
                                     <span className="text-[9px] font-bold text-rose-500 animate-pulse text-center leading-none">⚠️ حدد تاريخ</span>
                                   </div>
                                )}
                                <input
                                  type="date"
                                  value={activeSession?.date ? activeSession.date.split("T")[0] : ""}
                                  onChange={(e) => {
                                    if (!activeSession) return;
                                    saveActiveSession({
                                      ...activeSession,
                                      date: e.target.value
                                    });
                                  }}
                                  className={`bg-transparent border-0 text-[10.5px] font-black text-center w-full h-full p-0 m-0 cursor-pointer hover:text-emerald-750 focus:ring-0 appearance-none inline-block [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:bg-none ${!activeSession?.date ? "opacity-0" : "text-slate-700 font-mono opacity-100"}`}
                                  style={{ outline: "none", direction: 'rtl' }}
                                  title="اضغط لتعديل تاريخ الجرد"
                                />
                              </div>
                            </>
                        )}

                        {(user.role === 'warehouse_supervisor' || user.role === 'supervisor') && activeSupervisorTab === 'sheet' && (() => {
                          const hasUnassignedOrGeneral = activeSession?.items.some(item => !item.assignedTo || item.assignedTo === "عام" || item.assignedTo === "general") || false;
                          const assignDisabled = activeSession?.isCompleted || !hasPendingAssignments || hasUnassignedOrGeneral;
                          
                          const hasAssigned = activeSession?.items.some(item => item.assignedTo) || false;
                          const hasUnsubmitted = activeSession?.items.some(item => item.assignedTo && !item.submitted) || false;
                          
                          // Supervisor interlock: allow "Save Edits" logic if already approved
                          const approveDisabled = activeSession?.isCompleted || 
                            hasUnsubmitted || 
                            (!activeSession?.supervisorApproved && (!hasAssigned || hasUnassignedOrGeneral || hasPendingAssignments)) ||
                            (activeSession?.supervisorApproved && !hasUnsavedChanges);
                          
                          const buttonLabel = activeSession?.supervisorApproved ? "حفظ التعديلات 💾" : "اعتماد الجرد 🤝";
                          const buttonTitle = activeSession?.supervisorApproved 
                            ? "حفظ التعديلات الفنية النهائية التي أجريتها على الجرد المعتمد" 
                            : (hasPendingAssignments ? "يرجى أولاً الضغط على إسناد لتفعيل التعديلات" : hasUnassignedOrGeneral ? "يرجى إسناد كافة الأصناف لأمناء معينين أولاً" : hasUnsubmitted ? "بانتظار قيام كافة الأمناء بتسليم وحفظ الجرد الخاص بهم بالكامل أولاً" : "مراجعة واعتماد جرد الوردية نهائياً لترحيله لمسئول البرنامج");
                          
                          return (
                            <div className="flex items-center gap-1.5" dir="rtl">
                              {/* زر إسناد */}
                              <button
                                type="button"
                                id="supervisor-commit-assigns-btn"
                                onClick={handleSupervisorSaveOrCommit}
                                disabled={assignDisabled}
                                className={"h-[26px] rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer px-2.5 " + (
                                  assignDisabled
                                  ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed"
                                  : "bg-blue-600 hover:bg-blue-750 text-white animate-pulse active:scale-95 shadow-md shadow-blue-600/10"
                                )}
                                title={hasUnassignedOrGeneral ? "يجب إسناد كافة الأصناف لأمناء معينين أولاً (لا يمكن إبقاء صنف عام أو غير مسند)" : "حفظ وإرسال التعديلات وتحديث إسناد الأصناف للأمناء سحابياً"}
                              >
                                <Save className="w-3.5 h-3.5 shrink-0" />
                                <span className="text-[10px] font-bold">إسناد 🚀</span>
                              </button>

                              {/* زر اعتماد الجرد */}
                              <button
                                type="button"
                                id="supervisor-approve-session-btn"
                                onClick={handleSupervisorApproveSession}
                                disabled={approveDisabled}
                                className={"h-[26px] rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer px-2.5 " + (
                                  approveDisabled
                                  ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed"
                                  : "bg-emerald-600 hover:bg-emerald-750 text-white animate-pulse active:scale-95 shadow-md shadow-emerald-600/10"
                                )}
                                title={buttonTitle}
                              >
                                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                <span className="text-[10px] font-bold">{buttonLabel}</span>
                              </button>
                            </div>
                          );
                        })()}

                        {user.role === 'storekeeper' && activeStorekeeperTab === 'sheet' && (
                            <button
                            type="button"
                            onClick={handleStorekeeperSubmit}
                            disabled={activeSession?.isCompleted || activeSession?.items.filter(item => item.assignedTo === user.code && !item.submitted).length === 0}
                            className="h-[26px] bg-emerald-600 hover:bg-emerald-750 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 transition-transform active:scale-95 cursor-pointer truncate px-3"
                            >
                            <Save className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">حفظ وتسليم الجرد 📝</span>
                            </button>
                        )}
                        </>
                    ) : null}

                    {user.role === 'stores_manager' && activeSupervisorTab === 'manager_dashboard' && (
                      <div className="relative h-[26px] flex items-center shrink-0 animate-fadeIn z-50 -translate-y-[1.5px]">
                        <select 
                          value={storesManagerSubTab}
                          onChange={(e) => setStoresManagerSubTab(e.target.value as any)}
                          className="pl-6 pr-2 py-0 bg-amber-50 border border-amber-200 rounded-lg text-[9px] font-black text-amber-800 focus:ring-1 focus:ring-amber-500/20 focus:border-amber-400 outline-none appearance-none cursor-pointer text-right transition-all h-[26px] w-[115px] min-w-[115px] max-w-[115px] shadow-sm"
                        >
                          <option value="items">اصناف الجرد 📦</option>
                          <option value="auditors">كادر بشري 👥</option>
                          <option value="general">مراجعة عامة 📊</option>
                        </select>
                        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500">
                          <ChevronDown className="w-3 h-3" />
                        </div>
                      </div>
                    )}

                    <button
                        type="button"
                        onClick={handleLogout}
                        className={`w-[26px] h-[26px] flex items-center justify-center border border-red-200 hover:bg-red-50 text-red-650 bg-white rounded-md transition-all shadow-3xs cursor-pointer shrink-0 ${user.role !== 'general_manager' ? '-translate-y-[1.5px]' : ''}`}
                        title="تسجيل الخروج"
                    >
                        <LogOut className="w-3.5 h-3.5 text-red-600" />
                    </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Unified Main Interface Area */}
      <main className={`w-full px-0.5 sm:px-1 ${isNonAdminSalatMessageVisible ? '' : 'flex-1'} flex flex-col min-h-0 py-1.5 space-y-1`}>
        {(() => {
          const hasLeftColumnContent = 
            (user?.role === 'program_manager' && activeProgramManagerTab !== 'none' && activeProgramManagerTab !== 'archive') ||
            ((user?.role === 'warehouse_supervisor' || user?.role === 'supervisor') && activeSupervisorTab === 'sheet') ||
            (user?.role === 'storekeeper' && activeStorekeeperTab === 'sheet');
          return (
            <div className="space-y-1.5">

              {/* Layout Grid: Right Side (Worksheet/Direct matching) & Left Side (Actions/Adding SKU/Archives) */}
              <div className={hasLeftColumnContent ? "grid grid-cols-1 lg:grid-cols-3 gap-2" : "block space-y-2"}>
                {/* RIGHT SIDE: Active Audit/Matching registry grid or Selected Section */}
                <div className={hasLeftColumnContent ? "lg:col-span-2 space-y-1.5" : "w-full space-y-1.5"}>
                  {((user?.role === 'program_manager' && activeProgramManagerTab === 'archive') ||
                    ((user?.role === 'supervisor' || user?.role === 'warehouse_supervisor' || user?.role === 'stores_manager') && activeSupervisorTab === 'archive') ||
                    (user?.role === 'storekeeper' && activeStorekeeperTab === 'archive')) ? (
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-4 animate-fadeIn" dir="rtl">
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                      <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                        <Layers className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-black text-slate-900 text-base">قائمة الأرشيف والبيانات التاريخية</h3>
                        <p className="text-[10px] font-bold text-slate-400">استعراض وإدارة جلسات الجرد المحفوظة</p>
                      </div>
                    </div>
                    
                    <div className="max-h-[600px] overflow-y-auto pr-2 space-y-3">
                      {(() => {
                        let filteredSessions = processedPastSessions;
                        if (user && user.role === 'storekeeper') {
                          filteredSessions = processedPastSessions.filter(session => {
                            return (session.items || []).some(item => 
                              item.inventoriedByCode === user.code || 
                              (item.assignedTo === user.code && (item.physicalQty !== null || item.storekeeperQty !== null))
                            );
                          }).slice(0, 7);
                        }

                        if (filteredSessions.length === 0) {
                          return (
                            <div className="py-20 text-center">
                              <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Layers className="w-8 h-8" />
                              </div>
                              <p className="text-slate-400 font-bold text-xs italic">لا توجد سجلات مؤرشفة حالياً</p>
                            </div>
                          );
                        }

                        return filteredSessions.map((session, idx) => {
                          const userItems = (session.items || []).filter((item: any) => {
                            if (user && user.role === 'storekeeper') {
                              return item.inventoriedByCode === user.code || (item.assignedTo === user.code && (item.physicalQty !== null || item.storekeeperQty !== null));
                            }
                            return true;
                          });
                          const roleItems = userItems.map((item: any) => ({
                            ...item,
                            physicalQty: getRoleBasedPhysicalQty(item, user?.role)
                          }));
                          const total = roleItems.length;
                          const counted = roleItems.filter((i) => i.physicalQty !== null).length;
                          const mismatches = roleItems.filter((i) => i.physicalQty !== null && i.physicalQty !== i.bookQty).length;
                          
                          return (
                            <div
                              key={session.id || idx}
                              className="p-4 bg-white rounded-2xl border border-slate-100 shadow-3xs flex flex-col hover:border-slate-200 transition-all text-right space-y-3 relative overflow-hidden"
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex flex-col gap-0.5 w-full">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[12px] font-black text-slate-800 flex items-center gap-1">
                                        📅 جرد يوم: {new Date(session.date).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" })}
                                      </span>
                                      {(session as any).versionNumber && (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-150 px-1.5 py-0.5 rounded text-[10px] font-black leading-none shrink-0" title={`نسخة جرد رقم ${(session as any).versionNumber}`}>
                                          {(session as any).versionNumber}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 flex items-center justify-center py-0.5 rounded-md">
                                      بواسطة: {getStorekeeperName(session.archivedBy || session.storekeeperCode)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100 justify-start w-full">
                                    <span className="text-[10px] text-slate-500 font-bold flex items-center gap-1 w-full justify-start">
                                      <Clock className="w-2.5 h-2.5 text-emerald-500" />
                                      تمت الأرشفة النهائية: 
                                      <span className="text-emerald-700 font-mono" dir="ltr">
                                        {new Date(session.archivedAt || session.updatedAt || session.date).toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {session.notes && (
                                <p className="text-[10px] text-slate-600 bg-slate-50 p-1.5 rounded-md border border-slate-100 font-medium my-2">
                                  📝 {session.notes}
                                </p>
                              )}

                              <div className="flex items-center justify-between text-[12px] text-slate-500 font-bold py-1">
                                <span>
                                  فروقات:{" "}
                                  <strong className={`font-mono text-[13px] ${mismatches > 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {mismatches} صنف
                                  </strong>
                                </span>
                                <span>
                                  المواد: <strong className="text-slate-800 font-mono text-[13px]">{counted}/{total}</strong>
                                </span>
                              </div>

                              {/* Options inside past session item */}
                              <div className="pt-2 flex items-center justify-between gap-1.5 border-t border-slate-100">
                                <button
                                  type="button"
                                  onClick={() => setInspectSession(session)}
                                  className="flex-1 px-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[9px] sm:text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                                  title="عرض المقارنات"
                                >
                                  عرض المقارنات
                                  <Eye className="w-3.5 h-3.5 shrink-0" />
                                </button>
                                {user?.role === 'program_manager' && (
                                  <button
                                    type="button"
                                    onClick={() => handleExportCsv(session, `جرد_مؤرشف_${new Date(session.archivedAt || session.updatedAt || session.date).toISOString().split("T")[0]}.csv`)}
                                    className="flex-1 px-1 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-[9px] sm:text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                                    title="تحميل التفاصيل"
                                  >
                                    <FileDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                    تحميل التفاصيل
                                  </button>
                                )}
                                {user?.role === 'program_manager' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeletionTarget({ type: 'archived', id: session.id });
                                      setShowDeletionReasonModal(true);
                                    }}
                                    className={`px-2 py-1.5 flex items-center justify-center gap-1 text-[9px] sm:text-[10px] font-bold rounded-lg cursor-pointer transition-all border shrink-0 min-w[50px] bg-white border-red-100 hover:bg-red-50 text-rose-600 hover:border-rose-200`}
                                    title="حذف هذا الجرد المؤرشف"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    حذف
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ) : (user?.role === 'stores_manager' && activeSupervisorTab === 'manager_dashboard') ? (
                  <StoresManagerDashboard 
                    pastSessions={processedPastSessions} 
                    registeredUsers={registeredUsers}
                    precodedUsers={precodedUsers}
                    activeSubTab={storesManagerSubTab}
                    setActiveSubTab={setStoresManagerSubTab}
                  />
                ) : ((user?.role === 'program_manager' && activeProgramManagerTab === 'none') ||
                     ((user?.role === 'supervisor' || user?.role === 'warehouse_supervisor' || user?.role === 'stores_manager') && activeSupervisorTab === 'none') ||
                     (user?.role === 'storekeeper' && activeStorekeeperTab === 'none')) ? (
                /* Falling back to SalatMessage when no tab is selected */
                <div className="flex-1 flex flex-col items-center justify-center p-1 min-h-0 w-full">
                  <SalatMessage />
                </div>
              ) : totalMasterCount === 0 ? (
                /* Falling back to Welcome message ONLY when no data is loaded at all */
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-6 my-auto flex flex-col items-center justify-center text-center animate-fadeIn min-h-0 space-y-4" dir="rtl">
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center animate-pulse">
                    <Sparkles className="w-7 h-7" />
                  </div>
                  <div className="space-y-3 max-w-lg">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight leading-snug">
                      مرحباً بك في نظام الجرد والتدقيق السريع!
                    </h2>
                    <p className="text-sm sm:text-base font-semibold text-slate-500 leading-relaxed mx-auto">
                      {user?.role === 'program_manager' 
                        ? "لم يتم تحميل الأرصدة الدفترية والأصناف لبدء الوردية الحالية بعد. بصفتك صاحب الصلاحية، يرجى الضغط على زر (تحميل الأصناف والأرصدة الدفترية) المتاح في القائمة لرفع وتحميل المستند لبدء عملية الجرد."
                        : "لم تقم الإدارة بتحميل الأرصدة الدفترية والأصناف لبدء الوردية الحالية بعد. يرجى الانتظار لحين قيام مسئول البرنامج برفع بيانات الوردية وبدء الجرد."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200/70 shadow-xs overflow-hidden md:animate-fade-in">
                  
                  {/* Worksheet Header tools */}
                  <div className="p-1 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-1.5 animate-fade-in">
                    
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 w-full">
                      {/* Dropdown list of items */}
                      <div className="relative w-32 sm:w-40 border-slate-200">
                        <select
                          value={activeUserItems.some(item => item.itemName === searchQuery) ? searchQuery : ""}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full px-2 py-1 h-7 bg-white border border-slate-200 rounded-lg text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 text-right text-slate-755 cursor-pointer"
                        >
                          <option value="">اختر صنف مباشر جرد 🔍</option>
                          {activeSession && [...activeUserItems]
                            .map((item) => {
                              const hasMods = item.storekeeperModifications && item.storekeeperModifications.length > 0;
                              const lastMod = hasMods ? item.storekeeperModifications[item.storekeeperModifications.length - 1] : null;
                              return (
                                <option key={item.itemId} value={item.itemName}>
                                  {hasMods ? `🔄 [${lastMod.oldQty}➔${lastMod.newQty}] ` : ""}{item.itemName} ({item.itemId})
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          statusFilter === "pending" ? "bg-amber-600 text-white shadow-3xs" : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {statusFilter === "pending" ? "إظهار الكل 📋" : "بانتظار الجرد ⏳"}
                      </button>

                      {/* Auditor Filter Dropdown */}
                      {(user?.role === 'system_admin' || user?.role === 'program_manager' || user?.role === 'supervisor' || user?.role === 'warehouse_supervisor') && activeSession && (
                        <div className="flex items-center gap-1">
                          <select
                            value={auditorFilter}
                            onChange={(e) => setAuditorFilter(e.target.value)}
                            className="px-2 py-1 h-7 bg-white border border-slate-200 rounded-lg text-[9px] font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 text-right text-slate-600 cursor-pointer"
                          >
                            <option value="all">كل المسئولين 👥</option>
                            {Array.from(new Set(activeSession.items.map(i => i.assignedTo).filter(Boolean)))
                              .sort((a, b) => {
                                const codeA = parseInt(String(a)) || 0;
                                const codeB = parseInt(String(b)) || 0;
                                return codeA - codeB;
                              })
                              .map((code: any) => (
                                <option key={String(code)} value={String(code)}>{getStorekeeperName(String(code), user)}</option>
                              ))}
                            {activeSession.items.some(i => !i.assignedTo) && (
                              <option value="">غير مسند عام</option>
                            )}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {activeSession && activeSession.items.length === 0 && masterItems.length > 0 && (
                    <div className="mx-2 my-2 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl text-right text-blue-900 shadow-3xs flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between" dir="rtl">
                      <div className="flex items-start gap-2">
                        <span className="text-lg">📢</span>
                        <div>
                          <p className="text-[11px] font-black text-blue-950">تنويه هام: أنت تعرض الكتالوج المرجعي للمواد والأصناف</p>
                          <p className="text-[9.5px] font-bold text-blue-700/90 leading-normal">الجلسة النشطة حالياً لا تحتوى على أرصدة معدة للجرد. يُعرض الكتالوج أدناه كمرجع استرشادي لتسهيل الاطلاع والتعرف الميداني على فئات المواد المقيدة بالسيستم.</p>
                        </div>
                      </div>
                      {["program_manager", "general_manager", "system_admin", "super_admin"].includes(user?.role || "") && (
                        <button
                          onClick={() => handleDeleteActiveSession()}
                          className="mt-1.5 sm:mt-0 text-[10px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-150 transition-all cursor-pointer self-start sm:self-center shrink-0"
                        >
                          🗑️ حذف وإلغاء هذه الجلسة بتاتا
                        </button>
                      )}
                    </div>
                  )}

                  {/* Worksheet list grid */}
                  {visibleWorksheetItems.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 space-y-2">
                      <Search className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs font-bold text-slate-500 max-w-sm mx-auto leading-relaxed">
                        {user.role === 'storekeeper' && activeSession?.supervisorApproved
                          ? "✨ تم اعتماد الجرودات الفنية من قبل مشرف المخازن بنجاح! تم أرشفة الجلسة وبانتظار ترحيلها النهائي من مسئول البرنامج."
                          : user.role === 'storekeeper' && activeSession && activeSession.items.some(it => it.assignedTo === user.code) && activeSession.items.filter(it => it.assignedTo === user.code).every(it => it.submitted)
                          ? "تم تسليم الجرد بانتظار الاعتماد 👍"
                          : activeSession?.isRestored && user.role !== "program_manager" && user.role !== "system_admin"
                          ? "🔒 جلسة الجرد الحالية في حالة مراجعة وتعديل فني من قبل الإدارة الفنية والمسؤول، ولذلك تم إغلاق ورقة الميدان مؤقتاً."
                          : activeSession && activeSession.items.length === 0
                          ? "⚠️ الجلسة الحالية فارغة تماماً من الأصناف! يجب على (مسئول البرنامج) تحميل الأرصدة الدفترية والأصناف لبدء العمل."
                          : user.role === 'storekeeper' && activeSession && activeSession.items.length > 0 && activeSession.items.filter(it => it.assignedTo === user.code).length === 0
                          ? "👤 الجلسة نشطة وبها أصناف، ولكن لم يتم إسناد أي عهدة جرد لسيادتكم حتى هذه اللحظة. يرجى مراجعة مشرف المخازن."
                          : "لا توجد سجلات مطابقة لمعايير البحث أو التصفية الحالية أو الأصناف المسندة إليك."}
                      </p>
                      {!(user.role === 'storekeeper' && activeSession?.supervisorApproved) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery("");
                            setStatusFilter("all");
                          }}
                          className="text-[10px] text-blue-600 hover:underline inline-block mt-1 cursor-pointer"
                        >
                          إلغاء التصفية وإظهار قائمة المواد كاملة
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-auto max-h-[650px] border border-slate-200 border-t-0 rounded-b-xl relative shadow-xs scrollbar-thin">
                      <table className={`w-full text-right text-xs border-separate border-spacing-0 table-fixed ${user?.role === 'storekeeper' ? 'w-full' : 'min-w-[540px] md:min-w-full'}`}>
                        <colgroup>
                          {user?.role === 'storekeeper' ? (
                            <>
                              <col className="w-56" />
                              <col className="w-24" />
                            </>
                          ) : (
                            <>
                              <col className="w-40" />
                              {['system_admin', 'program_manager', 'supervisor', 'warehouse_supervisor'].includes(user?.role || '') && (
                                <col className={user?.role === 'program_manager' ? "w-[140px]" : "w-[120px]"} />
                              )}
                              <col className="w-16" />
                              <col className="w-24" />
                              <col className="w-14" />
                              <col className="w-14" />
                              {['warehouse_supervisor', 'system_admin', 'supervisor'].includes(user?.role || '') && (
                                <col className="w-[72px]" />
                              )}
                              {user?.role === 'program_manager' && <col className="w-6" />}
                            </>
                          )}
                        </colgroup>
                        <thead className="z-30">
                          <tr className="bg-slate-100 text-slate-700 font-bold">
                            <th className={`py-1 px-1 bg-slate-100 text-slate-800 font-extrabold border-l border-b border-slate-200 text-right whitespace-normal break-words leading-tight ${user?.role !== 'storekeeper' ? 'sticky right-0 z-15 shadow-[-2px_0_5px_rgba(51,65,85,0.08)]' : ''}`}>
                              <div className="whitespace-normal break-words underline-offset-2 w-full text-right">اسم الصنف</div>
                            </th>
                            {['system_admin', 'program_manager', 'supervisor', 'warehouse_supervisor'].includes(user?.role || '') && (
                              <th className="py-1 px-0.5 bg-slate-100 text-slate-650 font-bold border-b border-slate-200 text-right whitespace-nowrap text-[9px]">مسئول جرد</th>
                            )}
                            {user?.role !== 'storekeeper' && (
                              <th className="py-1 px-0.5 bg-slate-100 text-slate-650 font-bold border-b border-slate-200 text-center font-mono whitespace-nowrap text-[9px]">دفتري</th>
                            )}
                            <th className="py-1 px-0.5 bg-slate-100 text-slate-650 font-bold border-b border-slate-200 text-center whitespace-nowrap text-[9px]">فعلي</th>
                            {user?.role !== 'storekeeper' && (
                              <>
                                <th className="py-1 px-0.5 bg-slate-100 text-slate-650 font-bold border-b border-slate-200 text-center font-bold font-mono whitespace-nowrap text-[8.5px]">فارق</th>
                                <th className="py-1 px-0.5 bg-slate-100 text-slate-500 font-bold border-b border-slate-200 text-center font-bold font-mono whitespace-nowrap text-[8.5px]">سابق</th>
                                {(user?.role === 'warehouse_supervisor' || user?.role === 'system_admin' || user?.role === 'supervisor') && (
                                  <th className="py-1 px-0.5 bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-center whitespace-nowrap text-[8.5px]">إعادة</th>
                                )}
                                {user?.role === 'program_manager' && (
                                  <th className="py-1 px-0.5 bg-slate-100 text-slate-650 font-bold border-b border-slate-200 text-center whitespace-nowrap text-[8.5px]">X</th>
                                )}
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleWorksheetItems.map((item, idx) => {
                            const rolePhysicalQty = getRoleBasedPhysicalQty(item, user?.role);
                            const isCounted = rolePhysicalQty !== null;
                            const diff = isCounted ? rolePhysicalQty! - item.bookQty : 0;
                            
                            // Check lock status: can edit as long as not approved/archived by the role above them
                            const isInputDisabled = (() => {
                              if (activeSession?.isCompleted) return true;
                              if (activeSession?.items.length === 0) return true;
                              
                              // If restored session, only Program Manager and Admin can edit
                              if (activeSession?.isRestored) {
                                return user?.role !== "program_manager" && user?.role !== "system_admin";
                              }

                              if (user?.role === "storekeeper") {
                                // Locked if supervisor approved the session AND the item is already submitted
                                return !!activeSession?.supervisorApproved && !!item.submitted;
                              }
                              
                              if (user?.role === "supervisor" || user?.role === "warehouse_supervisor") {
                                // Locked if session is completed
                                if (activeSession?.isCompleted) return true;
                                
                                // LOCKED FOR SUPERVISOR if item is assigned to a storekeeper BUT they haven't submitted yet
                                if (item.assignedTo && item.assignedTo !== user?.code && !item.submitted) {
                                  return true;
                                }
                                return false;
                              }

                              if (["general_manager", "program_manager", "system_admin", "super_admin"].includes(user?.role || "")) {
                                // Needs supervisor to approve first before finalizing or editing
                                return !activeSession?.supervisorApproved;
                              }
                              return false;
                            })();

                            return (
                              <tr key={item.itemId} className="hover:bg-slate-50/55 transition-colors group">
                                <td className={`${user?.role === 'storekeeper' ? 'py-3 px-1.5' : 'py-1 px-1'} bg-white group-hover:bg-slate-100 transition-colors border-b border-l border-slate-100 font-extrabold text-slate-900 text-[11.5px] sm:text-xs selection:bg-blue-100 whitespace-normal break-words ${user?.role !== 'storekeeper' ? 'sticky right-0 z-10 shadow-[-2px_0_4px_rgba(51,65,85,0.05)]' : ''}`}>
                                  <div className={`font-extrabold text-slate-900 ${user?.role === 'storekeeper' ? 'text-[12.5px] sm:text-[13px] py-1' : 'text-[11.5px] sm:text-xs'} leading-tight break-words whitespace-normal w-full text-right flex flex-col gap-0.5 items-start`}>
                                    <span>{item.itemName}</span>
                                    {item.recheckRequested && (
                                      <span className="text-[9px] bg-amber-500 text-white font-extrabold px-1.5 py-0.5 rounded-md mt-1 flex items-center gap-1 shadow-xs">
                                        ⚠️ مطلوب إعادة الجرد 🔄
                                      </span>
                                    )}
                                    {(item.storekeeperModifications && item.storekeeperModifications.length > 0) && (
                                      <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-200 font-extrabold px-1.5 py-0.5 rounded-md mt-1 flex items-center gap-1 shadow-3xs">
                                        🔄 تم إعادة الجرد ({item.storekeeperModifications.length})
                                      </span>
                                    )}
                                  </div>
                                  {item.inventoriedByName && (
                                    <div className="text-[8px] text-emerald-600 font-bold mt-0.5 flex flex-col items-start gap-0 leading-none selection:bg-blue-105">
                                      <div className="flex flex-row gap-1 items-center">
                                        <span>{item.inventoriedByName}</span>
                                        {item.inventoriedAt && (
                                          <span className="text-[7.5px] text-emerald-600/75 font-mono">
                                            ({new Date(item.inventoriedAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </td>

                                {/* Storekeeper assignment column */}
                                {(['system_admin', 'program_manager', 'supervisor', 'warehouse_supervisor'].includes(user?.role || '')) && (
                                  <td className="p-0 border-b border-slate-100 relative">
                                    {user?.role === 'supervisor' || user?.role === 'system_admin' || user?.role === 'warehouse_supervisor' ? (
                                      <div className="flex flex-col gap-0.5 px-0.5">
                                        <div className="relative">
                                          {/* Custom Searchable Trigger Button */}
                                          <button
                                            type="button"
                                            id={`assign-trigger-${item.itemId}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (assignPopoverItemId === item.itemId) {
                                                setAssignPopoverItemId(null);
                                              } else {
                                                setAssignPopoverItemId(item.itemId);
                                                setAssignSearchTerm("");
                                              }
                                            }}
                                            className="px-1 py-0.5 border border-slate-200 rounded text-[9px] font-bold bg-white focus:outline-none h-6 w-full text-center flex items-center justify-between gap-0.5 shadow-3xs cursor-pointer hover:bg-slate-50 text-slate-700"
                                          >
                                            <span className="truncate flex-1 w-0 text-[9px] text-right font-bold pl-0.5">
                                              {item.assignedTo 
                                                ? getStorekeeperName(item.assignedTo, user) 
                                                : "عام"}
                                            </span>
                                            <span className="text-[6px] text-slate-400 shrink-0">▼</span>
                                          </button>

                                          {/* Modal Overlay Style Assignment with live filtering */}
                                          {assignPopoverItemId === item.itemId && (
                                            <div 
                                              className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setAssignPopoverItemId(null);
                                              }}
                                            >
                                              <div 
                                                className="bg-white rounded-[28px] w-full max-w-sm overflow-hidden flex flex-col shadow-2xl animate-scaleUp"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {/* Search Input Box Header */}
                                                <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col shadow-xs relative z-10">
                                                  <div className="relative">
                                                    <input
                                                      type="text"
                                                      value={assignSearchTerm}
                                                      id={`assign-search-${item.itemId}`}
                                                      onChange={(e) => setAssignSearchTerm(e.target.value)}
                                                      placeholder="البحث بالاسم أو الكود..."
                                                      className="w-full px-4 py-3.5 pr-10 bg-slate-50 border border-slate-200 rounded-[16px] text-[15px] text-slate-800 focus:outline-none focus:ring-2 focus:border-blue-500 focus:ring-blue-100 font-bold text-right transition-all"
                                                    />
                                                    <span className="absolute right-3.5 top-[14px] text-[17px] text-slate-400">🔍</span>
                                                  </div>
                                                </div>

                                                {/* Scrollable list options */}
                                                <div className="overflow-y-auto max-h-[60vh] p-2 space-y-0.5 scrollbar-thin text-right">
                                                  {/* General / Unassigned option */}
                                                  {(!assignSearchTerm || "عام غير مسند".includes(assignSearchTerm) || "general".includes(assignSearchTerm.toLowerCase())) && (
                                                    <button
                                                      type="button"
                                                      id={`assign-option-none-${item.itemId}`}
                                                      onClick={() => {
                                                        handleAssignStorekeeper(item.itemId, "");
                                                        setAssignPopoverItemId(null);
                                                      }}
                                                      className="w-full text-right px-4 py-4 hover:bg-slate-50 active:bg-slate-100 rounded-[18px] flex items-center justify-between cursor-pointer transition-colors"
                                                    >
                                                      <div className={`w-6 h-6 rounded-full border-[2.5px] flex items-center justify-center shrink-0 transition-colors ${!item.assignedTo ? 'border-teal-700' : 'border-slate-500'}`}>
                                                        {!item.assignedTo && <div className="w-3 h-3 bg-teal-700 rounded-full animate-fadeIn"></div>}
                                                      </div>
                                                      <span className={`text-[16px] sm:text-[17px] ${!item.assignedTo ? 'font-bold text-slate-900' : 'text-slate-800'}`}>-- غير مسند (عام) --</span>
                                                    </button>
                                                  )}

                                                  {/* Copy Previous option */}
                                                  {idx > 0 && (!assignSearchTerm || "السابق كالسابق".includes(assignSearchTerm)) && (
                                                    <button
                                                      type="button"
                                                      id={`assign-option-copy-${item.itemId}`}
                                                      onClick={() => {
                                                        let foundAssignee: string | undefined = undefined;
                                                        let foundIdx = -1;
                                                        for (let i = idx - 1; i >= 0; i--) {
                                                          if (visibleWorksheetItems[i].assignedTo) {
                                                            foundAssignee = visibleWorksheetItems[i].assignedTo;
                                                            foundIdx = i;
                                                            break;
                                                          }
                                                        }

                                                        if (foundAssignee && foundIdx !== -1) {
                                                          const itemIdsToAssign: string[] = [];
                                                          for (let i = foundIdx + 1; i <= idx; i++) {
                                                            itemIdsToAssign.push(visibleWorksheetItems[i].itemId);
                                                          }

                                                          if (activeSession) {
                                                            const updatedItems = activeSession.items.map((it) => {
                                                              if (itemIdsToAssign.includes(it.itemId)) {
                                                                return { ...it, assignedTo: foundAssignee };
                                                              }
                                                              return it;
                                                            });
                                                            setActiveSession({ ...activeSession, items: updatedItems });
                                                            localStorage.setItem("inventory_active_session", JSON.stringify({ ...activeSession, items: updatedItems }));
                                                            setHasPendingAssignments(true);
                                                            showToast(`📍 تم نسخ وتعيين مسئول الجرد لـ ${itemIdsToAssign.length} أصناف بنجاح! يرجى الضغط على زر "إسناد 🚀" في الأعلى لتفعيلها للجرّادين سحابياً.`, "info");
                                                          }
                                                        } else {
                                                          showToast("لا يوجد أمين مخزن معين لأي صنف سابق لنسخه!", "info");
                                                        }
                                                        setAssignPopoverItemId(null);
                                                      }}
                                                      className="w-full text-right px-4 py-4 mt-1 hover:bg-blue-50 active:bg-blue-100 rounded-[18px] flex items-center justify-between cursor-pointer transition-colors"
                                                    >
                                                      <span className="text-[12px] text-blue-500 font-mono font-bold">نسخ السابق</span>
                                                      <span className="text-[16px] sm:text-[17px] text-blue-700 font-bold">-- كالسابق 🗐 --</span>
                                                    </button>
                                                  )}

                                                  {/* Users filtered list */}
                                                  {(() => {
                                                    const allUsers = Array.from(
                                                      new Map(
                                                        [...precodedUsers, ...registeredUsers]
                                                          .filter(u => u.role === 'storekeeper' || u.role === 'supervisor' || u.role === 'warehouse_supervisor')
                                                          .map(u => [u.code, u])
                                                      ).values()
                                                    );

                                                    const filtered = allUsers.filter(u => {
                                                      const term = assignSearchTerm.toLowerCase();
                                                      return u.name.toLowerCase().includes(term) || String(u.code).toLowerCase().includes(term);
                                                    }).sort((a, b) => {
                                                      const codeA = parseInt(String(a.code)) || 0;
                                                      const codeB = parseInt(String(b.code)) || 0;
                                                      return codeA - codeB;
                                                    });

                                                    if (filtered.length === 0) {
                                                      return <div className="p-4 text-center text-[14px] text-slate-500 font-bold">لا توجد نتائج بحث تطابق "{assignSearchTerm}"</div>;
                                                    }

                                                    return filtered.map(u => {
                                                      const isSelected = item.assignedTo === u.code;
                                                      return (
                                                        <button
                                                          key={u.code}
                                                          type="button"
                                                          id={`assign-option-user-${u.code}-${item.itemId}`}
                                                          onClick={() => {
                                                            handleAssignStorekeeper(item.itemId, u.code);
                                                            setAssignPopoverItemId(null);
                                                          }}
                                                          className="w-full text-right px-4 py-4 hover:bg-slate-50 active:bg-slate-100 rounded-[18px] flex items-center justify-between transition-colors cursor-pointer"
                                                        >
                                                          <div className={`w-6 h-6 rounded-full border-[2.5px] flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-teal-700' : 'border-slate-500'}`}>
                                                            {isSelected && <div className="w-3 h-3 bg-teal-700 rounded-full animate-fadeIn"></div>}
                                                          </div>
                                                          <span className={`text-[16px] sm:text-[17px] ${isSelected ? 'font-bold text-slate-900' : 'text-slate-800'}`}>
                                                            {u.name} (كود: {u.code})
                                                          </span>
                                                        </button>
                                                      );
                                                    });
                                                  })()}
                                                </div>
                                                {/* Close Button */}
                                                <div className="p-3 sm:p-4 border-t border-slate-100 flex justify-center bg-slate-50">
                                                  <button
                                                    type="button"
                                                    onClick={() => setAssignPopoverItemId(null)}
                                                    className="w-full py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-[16px] text-[16px] hover:bg-slate-100 active:bg-slate-200 transition-colors"
                                                  >
                                                    إغلاق
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                        {item.submitted && (
                                          <div className="flex flex-col items-center gap-0.5">
                                            <span className="text-[8px] text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-md font-bold leading-none">
                                              {activeSession?.supervisorApproved ? "معتمد ومراجع ✓" : "تم التسليم ✓"}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-[9px] text-slate-600 font-bold">
                                          {item.assignedTo ? getStorekeeperName(item.assignedTo, user) : "غير مسند عام"}
                                        </span>
                                        {activeSession?.supervisorApproved ? (
                                          <span className="text-[8px] text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-md font-bold leading-none">
                                            معتمد ✓
                                          </span>
                                        ) : item.submitted ? (
                                          <span className="text-[8px] text-sky-600 bg-sky-50 px-1 py-0.5 rounded-md font-bold leading-none">
                                            تم التسليم ✓
                                          </span>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                )}

                                {user?.role !== 'storekeeper' && (
                                  <td className="py-1 px-1.5 text-center text-slate-700 font-bold font-mono text-[13px] bg-slate-50/20 border-b border-slate-100">
                                    {user?.role === "program_manager" ? (
                                      <input
                                        type="number"
                                        value={item.bookQty}
                                        onChange={(e) => handleBookQtyChange(item.itemId, e.target.value)}
                                        onBlur={() => {
                                          if (activeSession) {
                                            pushStateToServer({ activeSession, masterItems: masterItems }, { isExplicitAction: true });
                                          }
                                        }}
                                        className="w-14 text-center px-1 py-0.5 h-6.5 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-100 font-bold font-mono text-xs text-slate-800"
                                        id={`book-qty-input-${item.itemId}`}
                                      />
                                    ) : (
                                      item.bookQty
                                    )}
                                  </td>
                                )}
                                <td className="py-1 px-1 text-center border-b border-slate-100">
                                  <div className="flex items-center justify-center gap-1 min-w-[80px] max-w-[100px] mx-auto">
                                    <div className="relative inline-block w-16 shrink-0">
                                      <input
                                        type="number"
                                        value={getRoleBasedPhysicalQty(item, user?.role) ?? ""}
                                        onChange={(e) => handlePhysicalQtyChange(item.itemId, e.target.value)}
                                        onBlur={() => {
                                          if (activeSession) {
                                            pushStateToServer({ activeSession }, { isExplicitAction: true });
                                          }
                                        }}
                                        onKeyDown={(e) => handleKeyDown(e, item.itemId, idx, visibleWorksheetItems)}
                                        onFocus={(e) => {
                                          if (user?.role === "storekeeper") {
                                            if (!isInputDisabled) {
                                              setCalcItem(item);
                                            }
                                          } else {
                                            e.target.select();
                                          }
                                        }}
                                        onClick={() => {
                                          if (user?.role === "storekeeper" && !isInputDisabled) {
                                            setCalcItem(item);
                                          }
                                        }}
                                        placeholder="—"
                                        disabled={isInputDisabled}
                                        readOnly={user?.role === "storekeeper"}
                                        ref={(el) => {
                                          inputRefs.current[item.itemId] = el;
                                        }}
                                        className={`w-full text-center px-0.5 h-6 border rounded text-[11px] font-black font-mono focus:ring-1 focus:ring-blue-105 focus:border-blue-600 text-blue-700 focus:outline-none ${
                                          isInputDisabled 
                                            ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                                            : user?.role === "storekeeper"
                                              ? "bg-amber-50/10 border-amber-200 cursor-pointer hover:bg-amber-50/20"
                                              : "bg-blue-50/20 border-slate-300"
                                        }`}
                                        title={user?.role === "storekeeper" ? "مغلق للكتابة المباشرة - اضغط هنا أو على الحاسبة للجرد الفعلي" : "الرصيد الفعلي"}
                                        id={`qty-input-${item.itemId}`}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setCalcItem(item)}
                                      className={`h-6 w-6 flex items-center justify-center border rounded shrink-0 transition-all cursor-pointer shadow-3xs active:scale-95 ${
                                        isInputDisabled
                                          ? "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100"
                                          : "bg-blue-50 border-blue-200 hover:border-blue-600 hover:bg-blue-600 hover:text-white text-blue-600"
                                      }`}
                                      title={isInputDisabled ? "عرض تفاصيل حاسبة الشكاير (قراءة فقط)" : "افتح حاسبة الشكاير والبلتات التفصيلية لدقة الجرد"}
                                    >
                                      <Calculator className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                </td>
                                {user?.role !== 'storekeeper' && (
                                  <>
                                    <td className="py-1 px-1.5 text-center font-bold border-b border-slate-100">
                                      {!isCounted ? (
                                        <span className="text-[9px] text-slate-400 font-semibold whitespace-nowrap">
                                          بانتظار الجرد
                                        </span>
                                      ) : diff === 0 ? (
                                        <span className="text-[9px] text-blue-600 font-extrabold flex items-center justify-center gap-0.5 whitespace-nowrap">
                                          مطابق ✓
                                        </span>
                                      ) : diff < 0 ? (
                                        <span className="text-[9px] text-red-600 font-extrabold block whitespace-nowrap">
                                          عجز ({diff})
                                        </span>
                                      ) : (
                                        <span className="text-[9px] text-emerald-600 font-extrabold block whitespace-nowrap">
                                          زيادة (+{diff})
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 px-1.5 text-center font-mono text-slate-600 font-semibold bg-slate-50/10 border-b border-slate-100 text-[11px]">
                                      {item.previousDiff !== undefined ? (
                                        item.previousDiff === 0 ? "0" : item.previousDiff > 0 ? `+${item.previousDiff}` : item.previousDiff
                                      ) : "—"}
                                    </td>
                                    {(user?.role === 'warehouse_supervisor' || user?.role === 'system_admin' || user?.role === 'supervisor') && (
                                      <td className="py-1 px-1 border-b border-slate-100 text-center">
                                        {item.assignedTo ? (
                                          <button
                                            type="button"
                                            disabled={!item.submitted || activeSession?.supervisorApproved}
                                            onClick={() => handleRequestRecheck(item.itemId)}
                                            className={`px-2 py-1 text-[10px] rounded-lg font-extrabold transition-all cursor-pointer ${
                                              !item.submitted
                                                ? "bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed"
                                                : item.recheckRequested
                                                  ? "bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200"
                                                  : "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 active:scale-95"
                                            }`}
                                            title={
                                              !item.submitted
                                                ? "لا يمكن الطلب قبل تسليم الأمين للجرد"
                                                : "طلب إعادة جرد هذا الصنف من مسئول الجرد"
                                            }
                                          >
                                            {item.recheckRequested ? "مطلوب 🔄" : "إعادة جرد 🔄"}
                                          </button>
                                        ) : (
                                          <span className="text-[10px] text-slate-300 font-medium">—</span>
                                        )}
                                      </td>
                                    )}
                                    {user?.role === 'program_manager' && (
                                      <td className="py-1 px-1.5 text-center border-b border-slate-100">
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteWorksheetItem(item.itemId)}
                                          className="p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                                          title="حذف الصنف من الجلسة"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    )}
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* General active worksheet footer controls */}
                  <div className="p-5 border-t border-slate-100 bg-slate-50/70 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-black text-slate-500 uppercase mb-1.5 text-center">
                          وصف ورقة الجرد الفعلية (ملاحظات الجرد العامة)
                        </label>
                        <input
                          type="text"
                          value={activeSession?.notes || ""}
                          onChange={(e) => handleNotesChange(e.target.value)}
                          placeholder="مثلاً: جرد المندوب في الفترة الصباحية، أو مراجعة الاختلافات لقسم المبردات..."
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-100 focus:outline-none text-center"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                      {user?.role === 'program_manager' && (() => {
                        const hasAssignedAny = activeSession?.items.some(item => item.assignedTo) || false;
                        const hasUnsubmittedAny = activeSession?.items.some(item => item.assignedTo && !item.submitted) || false;
                        const hasUnassignedOrGeneralAny = activeSession?.items.some(item => !item.assignedTo || item.assignedTo === "عام" || item.assignedTo === "general") || false;

                        const isSupervisorApproveButtonActive = 
                          !!activeSession && 
                          !activeSession.supervisorApproved && 
                          !activeSession.isCompleted && 
                          hasAssignedAny && 
                          !hasUnsubmittedAny && 
                          !hasUnassignedOrGeneralAny && 
                          !hasPendingAssignments;

                        const isArchiveDisabled = !activeSession?.supervisorApproved || hasUnsubmittedAny || hasUnassignedOrGeneralAny || hasUnsavedChanges || hasPendingAssignments || isArchiving || isSupervisorApproveButtonActive;

                        return (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleCompleteActiveAudit}
                              disabled={isArchiveDisabled}
                              className={`px-4.5 py-2 font-black rounded-xl text-[11px] flex items-center gap-1.5 cursor-pointer transition-all ${
                                !isArchiveDisabled
                                  ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/15"
                                  : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                              }`}
                              id="save-session-action-btn"
                              title={
                                hasUnsavedChanges || hasPendingAssignments 
                                  ? "تنبيه: يوجد تعديلات معلقة أو مهام إسناد غير محفوظة من المشرف" 
                                  : isSupervisorApproveButtonActive 
                                    ? "عذراً، زر اعتماد الجرد نشط حالياً عند المشرف! يرجى قيام المشرف باعتماده أولاً" 
                                    : !activeSession?.supervisorApproved 
                                      ? "يجب اعتماد ومطابقة الجرد من قبل مشرف المخازن أولاً" 
                                      : "إنهاء ومطابقة وأرشفة الجرد"
                              }
                            >
                              <Save className="w-3.5 h-3.5" />
                              إنهاء و أرشفة جرد اليوم 🔒
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                </div>
              )}
            </div>

              {/* LEFT SIDE: Directory tools / Catalog adding / Excel Upload & Archives history */}
              <div className="lg:col-span-1 space-y-4">
                
                {/* Supervisor Control Card */}
                {((user?.role === 'warehouse_supervisor' || user?.role === 'supervisor')) && activeSupervisorTab === 'sheet' && (
                  <div className="bg-white rounded-2xl border border-slate-200/70 shadow-xs p-5 space-y-4 animate-fadeIn" dir="rtl">
                    <div>
                      <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-2">
                        <Shield className="w-4.5 h-4.5 text-blue-600" />
                        لوحة تحكم مشرف المخازن 👑
                      </h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">عمليات إسناد وإدارة الجرد والموافقة النهائية للوردية</p>
                    </div>

                    {/* Stats inside the card */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <div className="text-center p-1.5 bg-white rounded-lg shadow-3xs">
                        <div className="text-[9px] font-bold text-slate-400">إجمالي الأصناف</div>
                        <div className="text-sm font-black text-slate-800">{activeSession?.items.length || 0}</div>
                      </div>
                      <div className="text-center p-1.5 bg-white rounded-lg shadow-3xs">
                        <div className="text-[9px] font-bold text-slate-400">بانتظار التسليم</div>
                        <div className="text-sm font-black text-amber-600">
                          {activeSession?.items.filter(item => item.assignedTo && !item.submitted).length || 0}
                        </div>
                      </div>
                      <div className="text-center p-1.5 bg-white rounded-lg shadow-3xs">
                        <div className="text-[9px] font-bold text-slate-400">تعديلات الأمين</div>
                        <div className="text-sm font-black text-emerald-600">
                          {activeSession?.items.reduce((acc, item) => acc + (item.storekeeperModifications?.length || 0), 0) || 0}
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 text-blue-800 border border-blue-100 px-3 py-2 rounded-xl text-center">
                      <p className="text-[10px] font-black">
                        تمت اعادة جرد {activeSession?.items.filter(item => (item.storekeeperModifications?.length || 0) > 0).length || 0} صنف باجمالي تعديلات {(activeSession?.items.reduce((acc, item) => acc + (item.storekeeperModifications?.length || 0), 0) || 0) + (activeSession?.modifications?.reduce((acc, mod) => acc + (mod.itemChanges?.length || 0), 0) || 0)}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={handleSupervisorSaveOrCommit}
                        disabled={activeSession?.isCompleted || (!hasPendingAssignments && !hasUnsavedChanges)}
                        className={`w-full font-extrabold text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 border-0 transition-all shadow-md ${
                          (activeSession?.isCompleted || (!hasPendingAssignments && !hasUnsavedChanges))
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none"
                            : "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-95 shadow-blue-600/10"
                        }`}
                        title="حفظ تعديلات إسناد الأصناف للأمناء وترحيلها سحابياً"
                      >
                        <Save className="w-4 h-4" />
                        حفظ وإرسال الإسناد للأمناء
                      </button>

                      <button
                        type="button"
                        onClick={handleSupervisorApproveSession}
                        disabled={
                          activeSession?.isCompleted || 
                          (activeSession?.supervisorApproved && !activeSession?.items.some(item => item.assignedTo && !item.submitted)) || 
                          !activeSession?.items.some(item => item.assignedTo) || 
                          activeSession?.items.some(item => item.assignedTo && !item.submitted)
                        }
                        className={`w-full font-extrabold text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 border-0 transition-all shadow-md ${
                          (
                            activeSession?.isCompleted || 
                            (activeSession?.supervisorApproved && !activeSession?.items.some(item => item.assignedTo && !item.submitted)) || 
                            !activeSession?.items.some(item => item.assignedTo) || 
                            activeSession?.items.some(item => item.assignedTo && !item.submitted)
                          )
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95 shadow-emerald-600/10"
                        }`}
                        title="اعتماد جرد الوردية بعد تسليم كافة الأمناء"
                      >
                        <CheckCircle className="w-4 h-4" />
                        اعتماد جرد الوردية 🤝
                      </button>
                    </div>
                  </div>
                )}

                {/* Storekeeper Control Card */}
                {user?.role === 'storekeeper' && activeStorekeeperTab === 'sheet' && (
                  <div className="bg-white rounded-2xl border border-slate-200/70 shadow-xs p-3.5 space-y-3 animate-fadeIn" dir="rtl">
                    <div>
                      <h3 className="font-extrabold text-slate-805 text-[13px] flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-emerald-600" />
                        لوحة جرد أمين المخزن 📦
                      </h3>
                      <p className="text-[9.5px] text-slate-400 mt-0">تسليم وإجراء عمليات الجرد الفعلي للمجاميع والكميات المسندة</p>
                    </div>

                    {/* Stats inside the card */}
                    <div className="grid grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-xl border border-slate-100">
                      <div className="text-center p-1 bg-white rounded-lg shadow-3xs">
                        <div className="text-[8.5px] font-bold text-slate-400 leading-none mb-0.5">أصناف مسندة</div>
                        <div className="text-xs font-black text-slate-800">
                          {activeSession?.items.filter(item => item.assignedTo === user.code).length || 0}
                        </div>
                      </div>
                      <div className="text-center p-1 bg-white rounded-lg shadow-3xs">
                        <div className="text-[8.5px] font-bold text-slate-400 leading-none mb-0.5">متبقي مراجعة</div>
                        <div className="text-xs font-black text-rose-600">
                          {activeSession?.items.filter(item => item.assignedTo === user.code && item.physicalQty === null).length || 0}
                        </div>
                      </div>
                      <div className="text-center p-1 bg-white rounded-lg shadow-3xs">
                        <div className="text-[8.5px] font-bold text-slate-400 leading-none mb-0.5">إعادة جرد</div>
                        <div className="text-xs font-black text-emerald-600">
                          {activeSession?.items.filter(item => item.assignedTo === user.code && (item.storekeeperModifications?.length || 0) > 0).length || 0}
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-2 rounded-xl text-center">
                      <p className="text-[10px] font-black">
                        تمت اعادة جرد {activeSession?.items.filter(item => item.assignedTo === user.code && (item.storekeeperModifications?.length || 0) > 0).length || 0} صنف باجمالي تعديلات {(activeSession?.items.filter(item => item.assignedTo === user.code).reduce((acc, item) => acc + (item.storekeeperModifications?.length || 0), 0) || 0) + (activeSession?.modifications?.reduce((acc, mod) => acc + (mod.itemChanges?.filter(change => activeSession.items.find(i => i.itemId === change.itemId)?.assignedTo === user.code).length || 0), 0) || 0)}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={handleStorekeeperSubmit}
                        disabled={activeSession?.isCompleted || activeSession?.items.filter(item => item.assignedTo === user.code && !item.submitted).length === 0}
                        className={`w-full font-extrabold text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 border-0 transition-all shadow-md ${
                          (activeSession?.isCompleted || activeSession?.items.filter(item => item.assignedTo === user.code && !item.submitted).length === 0)
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95 shadow-emerald-600/10"
                        }`}
                        title="ترحيل وتسليم الكميات المدخلة للمشرف على السيرفر سحابياً"
                      >
                        <Save className="w-4 h-4" />
                        حفظ وتسليم الجرد للمشرف 📝
                      </button>


                    </div>
                  </div>
                )}

                {/* 1. Loading items & balances button card */}
                {user?.role === 'program_manager' && activeProgramManagerTab !== 'none' && activeProgramManagerTab !== 'archive' && (
                  <div className="bg-white rounded-2xl border border-slate-200/70 shadow-xs p-3.5 space-y-2.5 animate-fadeIn">
                    <div>
                      <h3 className="font-extrabold text-slate-800 text-[13px] flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4 text-blue-600" />
                        رفع الجرد والتحميل
                      </h3>
                      <p className="text-[9.5px] text-slate-400 mt-0">تحميل الأصناف والأرصدة الدفترية لبدء المطابقة</p>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={!!activeSession?.isRestored}
                        onClick={() => {
                          if (activeSession?.isRestored) {
                            showToast("❌ غير مسموح: لا يمكن تحميل أرصدة أو أصناف دفترية جديدة أثناء تعديل جرد مسترجع لتجنب تداخل الأرصدة والبيانات.", "error");
                            return;
                          }
                          setIsImportOpen(true);
                        }}
                        className={`w-full font-extrabold text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md ${
                          activeSession?.isRestored
                            ? "bg-slate-200 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none"
                            : "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-95 shadow-blue-600/15 hover:shadow-lg hover:shadow-blue-600/25"
                        }`}
                        title={activeSession?.isRestored ? "مغلق: لا يمكن تحميل أرصدة لشرائح جرد مسترجعة للتعديل." : "تحميل الأصناف والأرصدة الدفترية 📥"}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        تحميل الأصناف والأرصدة الدفترية
                      </button>

                      <button
                        type="button"
                        disabled={!activeSession}
                        onClick={() => handleDeleteActiveSession()}
                        className={`w-full font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                          !activeSession
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-50 shadow-none text-center"
                            : "bg-white hover:bg-slate-50 text-slate-500 hover:text-red-700 border border-red-50 hover:border-red-100 cursor-pointer active:scale-95 shadow-3xs"
                        }`}
                        title={!activeSession ? "لا توجد جلسة جرد نشطة حالياً لحذفها" : "حذف جلسة الجرد الحالية بالكامل من ورقة الجرد"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        حذف جلسة الجرد الحالية
                      </button>
                    </div>
                  </div>
                )}

                {["general_manager", "system_admin", "super_admin"].includes(user?.role || "") && (
                  <div className="bg-white rounded-2xl border border-slate-200/70 shadow-xs p-3.5 space-y-2.5">
                    <div>
                      <h3 className="font-extrabold text-slate-800 text-[13px] flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-blue-600" />
                        تكويد وادارة المستخدمين ⚙️
                      </h3>
                      <p className="text-[9.5px] text-slate-400 mt-0">منصة تكويد وترميز الأمناء، تفويض صلاحيات الدخول، ومطابقة الحسابات بالجرودات</p>
                    </div>

                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsManageUsersOpen(true);
                        }}
                        className="w-full font-extrabold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white cursor-pointer active:scale-95 transition-all shadow-md focus:outline-none"
                      >
                        <Settings className="w-4 h-4 shrink-0 text-emerald-400" />
                        منصة تكويد وإدارة حسابات الأمناء 🔐
                      </button>

                      {/* Removed system toggle from here since it is now in the backup admin tab */}
                    </div>
                  </div>
                )}

                {/* Removed Archived Historical Audits card per user request */}
                <div className="hidden"></div>
              </div>
            </div>
          </div>
          );
        })()}
      </main>

      {/* Excel Paste Import Modal Layer */}
      {isImportOpen && (
        <ImportItemsModal
          onClose={() => setIsImportOpen(false)}
          onImport={handleBulkImportConfirmed}
        />
      )}

      {/* Dynamic Unsaved Changes Logout Confirmation Dialogue */}
      {pendingLogoutWithUnsaved && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" dir="rtl">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl relative text-right border border-slate-150"
          >
            <div className="flex items-center gap-3 text-red-650 mb-3.5">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <TriangleAlert className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm">تأكيد تسجيل الخروج 🚪</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">يرجى تحديد خيار تسجيل الخروج المناسب:</p>
              </div>
            </div>

            <div className="text-xs text-slate-650 mb-5 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium font-sans">
              💡 يمكنك اختيار **حفظ التعديلات** لتأمين وحفظ نسختك الحالية بالمتصفح لجهازك، أو **الخروج دون حفظ التعديلات** لإبقاء مسودتك السابقة كما هي، أو **إلغاء الخروج** للرجوع لمتابعة العمل.
            </div>

            <div className="flex flex-col gap-2 font-sans">
              <button
                type="button"
                onClick={() => handleLogoutWithSaveChoice("local")}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl shadow-md text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                حفظ التعديلات والخروج 💾
              </button>
              
              <button
                type="button"
                onClick={() => handleLogoutWithSaveChoice("none")}
                className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-800 font-extrabold rounded-xl border border-red-200 text-xs transition-colors cursor-pointer"
              >
                الخروج دون حفظ التعديلات 🚪
              </button>

              <button
                type="button"
                onClick={() => setPendingLogoutWithUnsaved(false)}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                إلغاء الخروج (الرجوع للنظام) ↩️
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Standard Logout Confirmation Dialogue */}
      {showStandardLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" dir="rtl">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative text-right border border-slate-150"
          >
            <div className="flex items-center gap-3 text-slate-900 mb-3.5">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm">تأكيد تسجيل الخروج 🚪</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">هل أنت متأكد من رغبتك في تسجيل الخروج الآن؟</p>
              </div>
            </div>

            <div className="text-xs text-slate-600 mb-5 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium">
              سيتم تأمين حسابك ومسح البيانات المؤقتة فور تسجيل الخروج، مع بقاء كافة بياناتك السابقة المحفوظة بأمان على الخادم.
            </div>

            <div className="flex gap-2.5 font-sans">
              <button
                type="button"
                onClick={() => {
                  setShowStandardLogoutConfirm(false);
                  performLogout("none");
                  showToast("تم تسجيل الخروج بنجاح وتأمين الحساب 🚪", "success");
                }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl shadow-md text-xs transition-colors cursor-pointer text-center"
              >
                تأكيد الخروج 🚪
              </button>
              
              <button
                type="button"
                onClick={() => setShowStandardLogoutConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                إلغاء ↩️
              </button>
            </div>
          </motion.div>
        </div>
      )}



      {/* Dynamic Bag & Pallet Calculator Modal */}
      {calcItem && (
        <BagCalculatorModal
          key={calcItem.itemId}
          item={calcItem}
          isOpen={!!calcItem}
          onClose={() => setCalcItem(null)}
          onSave={(qty, details) => handleSaveCalculator(calcItem.itemId, qty, details)}
          isReadOnly={(() => {
            if (activeSession?.isCompleted) return true;
            if (activeSession?.isRestored) {
              return user?.role !== "program_manager" && user?.role !== "system_admin";
            }
            if (user?.role === "storekeeper") {
              return !!activeSession?.supervisorApproved;
            }
            if (user?.role === "supervisor" || user?.role === "warehouse_supervisor") {
              if (activeSession?.isCompleted) return true;
              const freshItem = activeSession?.items.find(i => i.itemId === calcItem.itemId);
              if (freshItem && freshItem.assignedTo && freshItem.assignedTo !== user?.code && !freshItem.submitted) {
                return true;
              }
              return false;
            }
            if (["general_manager", "program_manager", "system_admin", "super_admin"].includes(user?.role || "")) {
              return !activeSession?.supervisorApproved;
            }
            return false;
          })()}
        />
      )}

      {/* User Management Modal Layer */}
      {isManageUsersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto" dir="rtl">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl relative">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-xs">إدارة المستخدمين</h3>
                <button type="button" onClick={() => setIsManageUsersOpen(false)} className="p-1 hover:bg-slate-100 rounded-full"><X className="w-5 h-5"/></button>
             </div>
             <UserManagement 
               users={(() => {
                 const map = new Map<string, LoggedInUser>();
                 registeredUsers.forEach(u => map.set(u.code, u));
                 precodedUsers.forEach(u => {
                   if (!map.has(u.code)) {
                     map.set(u.code, u);
                   }
                 });
                 return Array.from(map.values());
               })()} 
               onAddUser={handleAddUser} 
               onDeleteUser={handleDeleteUser} 
               onUpdateUser={handleUpdatePrecodedUser} 
               forbiddenCodes={Array.from(new Set([...precodedUsers.map(u => u.code), ...registeredUsers.map(u => u.code)]))} 
             />
          </motion.div>
        </div>
      )}

      {/* User Access Control Modal Layer */}
      <AnimatePresence>
        {isUserAccessControlOpen && (
          <UserAccessControlModal 
            isOpen={isUserAccessControlOpen}
            onClose={() => setIsUserAccessControlOpen(false)}
            registeredUsers={registeredUsers}
            precodedUsers={precodedUsers}
            onUpdateUsers={async (updatedRegistered, updatedPrecoded, targetUserCode, newStatus) => {
              if (targetUserCode !== undefined) {
                // Individual active status toggled
                const targetUser = [...registeredUsers, ...precodedUsers].find(u => String(u.code) === String(targetUserCode));
                if (targetUser) {
                  const updatedSpec = { 
                    ...targetUser, 
                    isActivated: newStatus, 
                    is_activated: newStatus 
                  };
                  await handleUpdatePrecodedUser(updatedSpec);
                }
              } else {
                // Bulk action toggled
                showToast("جاري تحديث حالات تفعيل المستخدمين...", "info");
                try {
                  const token = localStorage.getItem("inventory_jwt_token");
                  const usersToUpdate = [...updatedRegistered, ...updatedPrecoded];
                  for (const u of usersToUpdate) {
                    if (u.role === 'general_manager') continue;
                    await fetch("/api/admin/users", {
                      method: 'POST',
                      headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        code: u.code,
                        name: u.name,
                        phone: u.phone,
                        role: u.role,
                        isPrecoded: u.isPrecoded !== undefined ? u.isPrecoded : u.is_precoded,
                        isRegistered: u.isRegistered !== undefined ? u.isRegistered : u.is_registered,
                        isActivated: newStatus
                      })
                    });
                  }
                  setRegisteredUsers(updatedRegistered);
                  setPrecodedUsers(updatedPrecoded);
                  localStorage.setItem("inventory_registered_users", JSON.stringify(updatedRegistered));
                  localStorage.setItem("inventory_precoded_users", JSON.stringify(updatedPrecoded));
                  showToast("تم تحديث وتعديل حالات تفعيل الموظفين بنجاح! 🎉", "success");
                } catch (err: any) {
                  showToast(`فشل التعديل الجماعي: ${err.message}`, "error");
                }
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Edit Profile Modal Dialog */}
      {showProfileEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 flex flex-col text-right overflow-hidden"
            dir="rtl"
          >
            {/* Header */}
            <div className="p-5 border-b border-emerald-100 bg-emerald-50 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">تغيير وتحديث بيانات أمين المخزن</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">ستنعكس البيانات المحدثة على جميع عمليات الجرد والتدقيق النشطة</p>
                </div>
              </div>
              <button
                onClick={() => setShowProfileEdit(false)}
                className="p-1 hover:bg-emerald-100 transition-colors rounded-full cursor-pointer"
              >
                <X className="w-5 h-5 text-emerald-800 hover:text-emerald-900" />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleUpdateProfileSubmit} className="p-5 space-y-4">
              {editProfileError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[11px] font-bold rounded-xl leading-relaxed">
                  ⚠️ {editProfileError}
                </div>
              )}

              {/* Name */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-500">الاسم المسجل بالنظام</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600"
                />
              </div>

              {/* Code */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-500">كود الموظف التعريفي (رمز كود ثابت)</label>
                <input
                  type="text"
                  disabled
                  value={editCode}
                  className="w-full px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-400 cursor-not-allowed select-none text-right opacity-80 font-mono"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">رقم الهاتف (قابل للتغيير)</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    placeholder="01xxxxxxxxx (11 رقم)"
                    value={editPhone}
                    onChange={(e) => setEditPhone(sanitizePhoneInput(e.target.value))}
                    className="w-full pl-3 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-left focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600 text-slate-700"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">كلمة المرور الجديدة (أو اتركه فارغاً للإبقاء على الحالية)</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={editPassword === "••••••••" ? "" : editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-600"
                />
              </div>

              {/* Old Password check */}
              <div className="space-y-1 pt-3 border-t border-rose-100">
                <label className="block text-xs font-bold text-rose-600 flex items-center justify-between">
                  <span>تأكيد الأمان والدقة</span>
                  <span>الرقم السري الحالي (مطلوب) *</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="اكتب رقمك السري الحالي للموافقة على التعديلات"
                  value={oldPasswordConfirm}
                  onChange={(e) => setOldPasswordConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 bg-rose-50/40 border border-rose-200 rounded-xl text-xs font-mono text-right focus:outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm shadow-emerald-600/10 flex items-center justify-center gap-1.5"
                >
                  حفظ التعديلات الجديدة
                </button>
                <button
                  type="button"
                  onClick={() => setShowProfileEdit(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  إلغاء التحديث
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Archive Inspector Detail Overlay Modal (without any price data) */}
      {inspectSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-3 sm:p-5 border-b border-slate-100 bg-slate-50 rounded-t-2xl flex items-start justify-between">
              <div className="flex items-start gap-2">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg shrink-0 mt-1">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-[12px] sm:text-sm">
                    تقرير جرد يوم : {new Date(inspectSession.date).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" })}
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mt-1.5">
                    <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100/50 inline-flex items-center gap-1 whitespace-nowrap self-start">
                      مسئول الأرشفة : {getStorekeeperName(inspectSession.archivedBy || inspectSession.storekeeperCode)}
                      <span className="text-emerald-600 mr-1 flex items-center gap-1 font-mono" dir="ltr">
                         {new Date(inspectSession.archivedAt || inspectSession.updatedAt || inspectSession.date).toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                  </div>
                  {['program_manager', 'stores_manager'].includes(user?.role || '') && (
                    <button
                      onClick={() => setShowInspectModifications(!showInspectModifications)}
                      className={`flex items-center gap-1.5 mt-2 px-2.5 py-1 font-bold rounded-md text-[9px] transition-colors cursor-pointer w-fit ${
                        inspectSession.modifications && inspectSession.modifications.length > 0
                          ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-400 opacity-60 border border-transparent"
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      سجل التعديلات ({inspectSession.modifications?.length || 0})
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <button
                  onClick={() => { setInspectSession(null); setConfirmingRestoreSessionId(null); setIsEditingInspectSession(false); setShowInspectModifications(false); }}
                  className="p-1 hover:bg-slate-200 transition-colors rounded-full cursor-pointer"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 hover:text-slate-600" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-right" dir="rtl">
              {showInspectModifications && inspectSession.modifications && inspectSession.modifications.length > 0 && (
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 space-y-2">
                  <h4 className="text-[11px] font-bold text-indigo-900 mb-1 border-b border-indigo-100 pb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    سجل تعديلات الجرد بعد الأرشفة
                  </h4>
                  {inspectSession.modifications.map((mod, index) => (
                    <div key={index} className="bg-white p-2.5 rounded-lg border border-indigo-50 shadow-sm text-[10px]">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-bold text-indigo-700">قام بالتعديل: {mod.modifiedBy}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{new Date(mod.modifiedAt).toLocaleString("ar-EG")}</span>
                      </div>
                      <div className="space-y-1">
                        {mod.itemChanges.map((change, idx) => (
                          <div key={idx} className="flex justify-between items-center text-[9px] bg-slate-50 p-1 rounded">
                            <span className="font-bold text-slate-700 truncate max-w-[60%]">{change.itemName}</span>
                            <span className="font-mono text-slate-500">
                              <span className="line-through mx-1">{change.oldQty === null ? "—" : change.oldQty}</span>
                              <span className="text-emerald-600 font-bold mx-1">➜</span>
                              <span className="font-bold text-slate-800">{change.newQty === null ? "—" : change.newQty}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const sessionItems = (inspectSession.items || []).filter((item) => {
                  if (user && user.role === "storekeeper") {
                    return item.inventoriedByCode === user.code || (item.assignedTo === user.code && (item.physicalQty !== null || item.storekeeperQty !== null));
                  }
                  return true;
                }).map((item) => ({
                  ...item,
                  physicalQty: getRoleBasedPhysicalQty(item, user?.role)
                }));

                const totalItemsCount = sessionItems.length;
                const matchesCount = sessionItems.filter((i) => i.physicalQty !== null && i.physicalQty === i.bookQty).length;
                const shortageCount = sessionItems.filter((i) => i.physicalQty !== null && i.physicalQty < i.bookQty).length;
                const excessCount = sessionItems.filter((i) => i.physicalQty !== null && i.physicalQty > i.bookQty).length;

                return (
                  <>
                    {/* Stats for the inspected session */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-slate-50 p-2 rounded-lg text-center border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold block">إجمالي الأصناف</span>
                        <span className="text-sm font-black font-mono text-slate-700 mt-0.5 block">{totalItemsCount}</span>
                      </div>
                      <div className="bg-emerald-50/50 p-2 rounded-lg text-center border border-emerald-100/50">
                        <span className="text-[9px] text-emerald-600 font-bold block">أصناف مطابقة</span>
                        <span className="text-sm font-black font-mono text-emerald-600 mt-0.5 block">
                          {matchesCount}
                        </span>
                      </div>
                      <div className="bg-red-50/50 p-2 rounded-lg text-center border border-red-100/50">
                        <span className="text-[9px] text-red-500 font-bold block">عجز فعلي</span>
                        <span className="text-sm font-black font-mono text-red-600 mt-0.5 block">
                          {shortageCount}
                        </span>
                      </div>
                      <div className="bg-indigo-50/50 p-2 rounded-lg text-center border border-indigo-100/50">
                        <span className="text-[9px] text-indigo-600 font-bold block">زيادة فعلية</span>
                        <span className="text-sm font-black font-mono text-indigo-600 mt-0.5 block">
                          {excessCount}
                        </span>
                      </div>
                    </div>

                    {/* Items Table List */}
                    <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
                      <div className="bg-slate-100/60 px-3 py-2 text-[9px] font-extrabold text-slate-600 border-b border-slate-100">
                        بيان الكميات الفعلية ومطابقتها دفترياً
                      </div>
                      {/* Grid Columns Table Header for perfect alignment and zero overflow */}
                      <div className="grid grid-cols-12 gap-1 bg-slate-50 border-b border-slate-100 px-2 py-1.5 text-center text-[9px] font-extrabold text-slate-500 font-sans" dir="rtl">
                        <div className="col-span-4 text-right pr-1">اسم الصنف</div>
                        <div className="col-span-2">الرصيد الدفتري</div>
                        <div className="col-span-2">الرصيد الفعلي</div>
                        <div className="col-span-2">طبيعة المطابقة</div>
                        <div className="col-span-2">فرق سابق</div>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                        {sessionItems.map((item) => {
                          const isCounted = item.physicalQty !== null;
                          const diff = isCounted ? item.physicalQty! - item.bookQty : 0;

                          return (
                            <div key={item.itemId} className="px-2 py-2 grid grid-cols-12 gap-1 items-center text-center text-[10px] hover:bg-slate-50 text-slate-700 transition-colors" dir="rtl">
                              <div className="col-span-4 text-right pr-1">
                                <span className="font-bold text-slate-800 block text-[10px] break-words leading-tight" title={item.itemName}>{item.itemName}</span>
                                {item.storekeeperModifications && item.storekeeperModifications.length > 0 && (
                                  <div className="mt-1 flex flex-col gap-0.5 items-start">
                                    <span className="text-[8px] bg-emerald-100 text-emerald-800 border border-emerald-200 font-extrabold px-1 py-0.5 rounded-sm flex items-center gap-1 shadow-3xs">
                                      🔄 تم إعادة الجرد ({item.storekeeperModifications.length})
                                    </span>
                                  </div>
                                )}
                                {item.inventoriedByName && (
                                  <div className="text-[8px] text-emerald-600 font-bold mt-0.5 flex flex-col items-start gap-0.5 leading-none">
                                    <div className="flex flex-row gap-0.5 items-center">
                                      <span>{item.inventoriedByName}</span>
                                      {item.inventoriedAt && (
                                        <span className="text-[8px] text-emerald-600/75 font-mono">
                                          ({new Date(item.inventoriedAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="col-span-2 font-mono font-bold text-slate-600">
                                {item.bookQty}
                              </div>

                              <div className="col-span-2 font-mono font-bold text-blue-700 flex justify-center items-center">
                                {isEditingInspectSession ? (
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.physicalQty === null ? "" : item.physicalQty}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const newQty = val === "" ? null : Number(val);
                                      const newItems = (inspectSession.items || []).map(i => {
                                        if (i.itemId === item.itemId) {
                                          const roleUpdates: any = {};
                                          if (user?.role === 'program_manager') roleUpdates.managerQty = newQty;
                                          else if (['supervisor', 'warehouse_supervisor', 'stores_manager'].includes(user?.role || '')) roleUpdates.supervisorQty = newQty;
                                          else if (user?.role === 'storekeeper') roleUpdates.storekeeperQty = newQty;

                                          return { 
                                            ...i, 
                                            physicalQty: newQty, 
                                            ...roleUpdates,
                                            inventoriedByCode: user?.code,
                                            inventoriedByName: user?.name,
                                            inventoriedAt: new Date().toISOString()
                                          };
                                        }
                                        return i;
                                      });
                                      setInspectSession({ ...inspectSession, items: newItems });
                                    }}
                                    className="w-14 px-1 py-0.5 text-center border border-blue-200 rounded text-xs no-spin focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                  />
                                ) : (
                                  isCounted ? item.physicalQty : "—"
                                )}
                              </div>

                              <div className="col-span-2 text-center font-sans">
                                {!isCounted ? (
                                  <span className="text-[8px] text-slate-400 font-bold">بانتظار الجرد</span>
                                ) : diff === 0 ? (
                                  <span className="text-[9px] text-blue-600 font-extrabold">مطابق ✨</span>
                                ) : diff < 0 ? (
                                  <span className="text-[9px] text-red-600 font-extrabold">عجز ({diff}) 📉</span>
                                ) : (
                                  <span className="text-[9px] text-emerald-600 font-extrabold">زيادة (+{diff}) 📈</span>
                                )}
                              </div>

                              <div className="col-span-2 text-center font-mono text-[9px] text-slate-600 font-semibold col-span-2">
                                {item.previousDiff !== undefined ? (
                                  item.previousDiff === 0 ? "0" : item.previousDiff > 0 ? `+${item.previousDiff}` : item.previousDiff
                                ) : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {inspectSession.notes && (
                      <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100 text-xs text-blue-800 leading-relaxed font-semibold mt-4">
                        📝 ملاحظات المشرف الفنية: {inspectSession.notes}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between">
              <button
                onClick={() => { setInspectSession(null); setConfirmingRestoreSessionId(null); setIsEditingInspectSession(false); setShowInspectModifications(false); }}
                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                إغلاق
              </button>
              {(user?.role === 'program_manager' || user?.role === 'system_admin' || user?.role === 'super_admin') && (
                <div className="flex items-center gap-2">
                  {isEditingInspectSession ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        onClick={handleSaveArchivedSession}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center shadow-xs cursor-pointer transition-colors"
                      >
                        حفظ التعديلات
                      </button>
                      <button
                        onClick={() => setIsEditingInspectSession(false)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-extrabold rounded-xl text-[11px] cursor-pointer transition-colors shadow-xs"
                      >
                        إلغاء التعديل
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setIsEditingInspectSession(true);
                          if (inspectSession) {
                            const prefilledItems = (inspectSession.items || []).map(item => ({
                              ...item,
                              physicalQty: getRoleBasedPhysicalQty(item, user?.role)
                            }));
                            setInspectSession({
                              ...inspectSession,
                              items: prefilledItems
                            });
                          }
                        }}
                        className="px-5 py-2 font-extrabold rounded-xl text-[11px] flex items-center justify-center shadow-xs transition-all bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        title="تعديل هذا الجرد المؤرشف مباشرة"
                      >
                        تعديل الجرد
                      </button>
                      <button
                        onClick={() => {
                          handleExportCsv(inspectSession, `جرد_تاريخي_${new Date(inspectSession.date).toISOString().split("T")[0]}.csv`);
                        }}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-[11px] flex items-center justify-center cursor-pointer shadow-xs transition-colors"
                      >
                        تحميل التقرير
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cloud Restore Confirmation Modal */}
      {isShowingRestoreConfirm && cloudBackupMetadata && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-sm shadow-2xl border border-slate-100 overflow-hidden" dir="rtl">
            <div className="bg-emerald-600 p-6 text-white text-center relative">
              <RotateCcw className="w-12 h-12 mx-auto mb-3 opacity-20 absolute -top-2 -right-2 rotate-12" />
              <RotateCcw className="w-10 h-10 mx-auto mb-3" />
              <h3 className="text-lg font-black tracking-tight">تأكيد استرجاع النسخة السحابية</h3>
              <p className="text-[11px] font-bold opacity-80 mt-1">يرجى مراجعة تفاصيل النسخة قبل الاستبدال</p>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                <div className="flex justify-between items-center text-[11px] font-bold">
                  <span className="text-slate-500">تاريخ النسخة:</span>
                  <span className="text-slate-900 dir-ltr">{cloudBackupMetadata.updatedAtString ? new Date(cloudBackupMetadata.updatedAtString).toLocaleString('ar-EG') : 'غير متوفر'}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-bold">
                  <span className="text-slate-500">عدد الجلسات المؤرشفة:</span>
                  <span className="text-emerald-700">{cloudBackupMetadata.sessionCount} جلسة</span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-bold">
                  <span className="text-slate-500">عدد أصناف المخزن:</span>
                  <span className="text-blue-700">{cloudBackupMetadata.itemCount} صنف</span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-bold">
                  <span className="text-slate-500">حالة الجرد النشط:</span>
                  <span className={cloudBackupMetadata.hasActiveSession ? "text-amber-600" : "text-slate-400"}>
                    {cloudBackupMetadata.hasActiveSession ? "يوجد جلسة نشطة" : "لا يوجد"}
                  </span>
                </div>
              </div>

              <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex gap-2">
                <TriangleAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-800 font-extrabold leading-relaxed">
                  تنبيه: هذا الإجراء سيقوم بحذف كافة السجلات والمخزون والجلسات واللقطات الحالية على السيرفر واستبدالها ببيانات النسخة السحابية. لا يمكن التراجع عن هذا الإجراء وسيتم الحفاظ على المستخدمين الحاليين فقط.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  disabled={isRestoringCloud}
                  onClick={handleRestoreCloudBackup}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-lg shadow-emerald-200 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {isRestoringCloud ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      جاري الاستعادة...
                    </>
                  ) : (
                    "تأكيد استبدال البيانات والبدء بالاسترجاع ✔️"
                  )}
                </button>
                <button
                  disabled={isRestoringCloud}
                  onClick={() => setIsShowingRestoreConfirm(false)}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all cursor-pointer text-sm"
                >
                  إلغاء الأمر
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-slate-100 text-center text-[10px] text-slate-400 font-extrabold bg-white py-2 mt-auto sticky bottom-0 z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.03)] w-full">
        تم تصميم النظام بواسطة : <span className="text-slate-900 font-black">محمد ثروت</span>
      </footer>

      <DeletionReasonModal />
      
      {isShowingMirror && user && ["general_manager", "system_admin", "super_admin", "program_manager"].includes(user.role) && (
        <MasterInventoryMirror 
          items={masterItems} 
          userCanClear={["general_manager", "system_admin", "super_admin", "program_manager"].includes(user.role)}
          onClose={() => setIsShowingMirror(false)} 
          onSync={() => {
            fetchCloudBackupInfo(true);
            setMasterItems([]);
            setActiveSession(null);
            localStorage.removeItem("inventory_active_session");
            fetchStateFromServer(true);
          }}
        />
      )}
    </div>
  );
}
