import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import { runSmartAnalytics } from "../lib/smartAnalytics";
import { 
  Search, 
  Calendar, 
  User, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Layers, 
  Shield, 
  Users, 
  Package, 
  Clock, 
  Sparkles, 
  BarChart3, 
  FileText,
  Briefcase,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertCircle,
  Award,
  Activity,
  Check,
  UserCheck,
  ClipboardList,
  X,
  Trash2
} from "lucide-react";

interface StoresManagerDashboardProps {
  pastSessions: any[];
  registeredUsers?: any[];
  precodedUsers?: any[];
  activeSubTab?: "items" | "auditors" | "general" | "smart_analytics";
  setActiveSubTab?: (tab: "items" | "auditors" | "general" | "smart_analytics") => void;
}

export default function StoresManagerDashboard({ 
  pastSessions, 
  registeredUsers = [], 
  precodedUsers = [],
  activeSubTab: propActiveSubTab,
  setActiveSubTab: propSetActiveSubTab
}: StoresManagerDashboardProps) {
  
  // 1. Unified User Lists
  const allUsers = useMemo(() => {
    const map = new Map<string, any>();
    registeredUsers.forEach(u => map.set(String(u.code), u));
    precodedUsers.forEach(u => {
      if (!map.has(String(u.code))) {
        map.set(String(u.code), u);
      }
    });
    return Array.from(map.values());
  }, [registeredUsers, precodedUsers]);

  // Selected modification details state for the popup modal
  const [selectedModDetails, setSelectedModDetails] = useState<{
    modifier: string;
    role: string;
    date: any;
    oldQty: number | null;
    newQty: number | null;
    itemName: string;
    sessionName?: string;
    sessionId?: string;
    sessionDate?: number | string | any;
    versionNumber?: number;
  } | null>(null);

  // Helper to dynamically resolve user real name and role title from their code or name
  const getUserDetails = (rawModifier: string, defaultName: string, defaultRole: string) => {
    const cleanMod = String(rawModifier || "").trim();
    
    const normalize = (s: string) => {
      return s.trim()
        .replace(/^ال/, "")
        .replace(/\s+/g, " ")
        .replace(/ى/g, "ي") // Normalize Alef Maqsura / Ya
        .replace(/ة/g, "ه"); // Normalize Ta Marbuta / Ha
    };

    const normMod = normalize(cleanMod);

    const userObj = allUsers.find(u => {
      const uCode = String(u.code).trim();
      const uName = String(u.name || "").trim();
      return uCode === cleanMod || normalize(uName) === normMod || normalize(uCode) === normMod;
    });
    
    const roleMap: Record<string, string> = {
      general_manager: "المدير العام",
      system_admin: "مسئول النظام",
      program_manager: "مسئول البرنامج",
      supervisor: "مشرف مخازن",
      storekeeper: "أمين مخزن"
    };

    let modifierName = userObj?.name || defaultName;
    let modifierRole = userObj?.role ? roleMap[userObj.role] : defaultRole;
    
    // Normalize display names to be professional and exact as requested by the user
    if (normalize(modifierName) === "مسئول برنامج" || normalize(modifierName) === "مسئول البرنامج") {
      modifierName = "مسئول برنامج";
      modifierRole = "مسئول البرنامج";
    } else if (normalize(modifierName) === "امين مخازن" || normalize(modifierName) === "امين مخزن") {
      modifierName = "امين مخازن";
      modifierRole = "أمين مخزن";
    } else if (normalize(modifierName) === "مشرف مخازن" || normalize(modifierName) === "مشرف مخزن") {
      modifierName = "مشرف مخازن";
      modifierRole = "مشرف مخازن";
    }

    return { name: modifierName, role: modifierRole };
  };

  // Helper to choose a stable, professional, high-contrast pastel background and text color based on user's name hash
  const getUserColorClasses = (userName: string) => {
    let hash = 0;
    const nameStr = String(userName || "عام");
    for (let i = 0; i < nameStr.length; i++) {
      hash = nameStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % 6;
    
    const palettes = [
      { bg: "bg-indigo-50 text-indigo-800 border-indigo-200" },
      { bg: "bg-emerald-50 text-emerald-800 border-emerald-200" },
      { bg: "bg-amber-50 text-amber-800 border-amber-200" },
      { bg: "bg-rose-50 text-rose-800 border-rose-200" },
      { bg: "bg-cyan-50 text-cyan-800 border-cyan-200" },
      { bg: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200" }
    ];
    
    return palettes[index];
  };

  const formatModDate = (ts: any) => {
    if (!ts) return "غير محدد";
    const dateObj = new Date(ts);
    if (isNaN(dateObj.getTime())) return String(ts);
    return dateObj.toLocaleDateString("ar-EG-u-nu-latn", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  const formatModTime = (ts: any) => {
    if (!ts) return "غير محدد";
    const dateObj = new Date(ts);
    if (isNaN(dateObj.getTime())) return "";
    return dateObj.toLocaleTimeString("ar-EG-u-nu-latn", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  };

  // Helper to calculate the version number of an item across all sessions chronologically
  // Helper to calculate the version number of an item across all sessions chronologically
  const getItemSessionVersion = (itemId: string, sessionId: string) => {
    const session = pastSessions.find(s => s.id === sessionId);
    return session && (session as any).versionNumber ? (session as any).versionNumber : 1;
  };

  // Helper to identify if a code is strictly a storekeeper
  const isUserStorekeeper = (code: string) => {
    const userObj = allUsers.find(u => String(u.code) === String(code));
    if (userObj) {
      return userObj.role === "storekeeper";
    }
    // Fallback: exclude words that suggest admins/supervisors
    const cLower = String(code).toLowerCase();
    const isExcluded = ["general", "عام", "admin", "supervisor", "manager"].some(ex => cLower.includes(ex));
    return !isExcluded;
  };

  // Helper to extract or reconstruct storekeeper modifications consistently
  const getStorekeeperModifications = (item: any) => {
    const skModsRaw = [...(item.storekeeperModifications || [])];

    return skModsRaw
      .map((mod: any) => {
        const details = getUserDetails(mod.modifiedBy || "103", mod.modifiedByName || "امين مخازن", "أمين مخزن");
        const rawTime = mod.modifiedAt || item.submittedAt || item.inventoriedAt || item.sessionDate;
        const timestamp = rawTime ? new Date(rawTime).getTime() : Date.now();
        return {
          modifier: details.name,
          modifierRole: details.role,
          newQty: mod.newQty,
          oldQty: mod.oldQty,
          timestamp: timestamp,
          sessionName: item.sessionName,
          sessionId: item.sessionId,
          sessionDate: item.sessionDate,
          isStorekeeperModification: true
        };
      });
  };

  // Helper to count recheck and correction events on an item (CRITICAL USER REQUEST FOR EVALUATING ORIGINAL STOREKEEPER ASSIGNEE)
  const getItemRechecksCount = (item: any, session: any) => {
    let count = 0;

    // 1. If the supervisor modified the physical count
    const skVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
      ? item.storekeeperQty 
      : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);
    const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
    const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

    if (skVal !== null && supervisorVal !== null && supervisorVal !== skVal) {
      count++;
    }

    // 2. If the program manager modified the physical count
    if (skVal !== null && managerVal !== null && managerVal !== skVal) {
      count++;
    }

    // 3. If session modifications show historical changes for this item
    if (session && session.modifications && Array.isArray(session.modifications)) {
      session.modifications.forEach((mod: any) => {
        const hasChange = mod.itemChanges?.some((change: any) => 
          change.itemName === item.itemName || change.itemName === item.name
        );
        if (hasChange) {
          count++;
        }
      });
    }

    return count;
  };

  // 2. Local States for Filters
  const [localActiveSubTab, setLocalActiveSubTab] = useState<"items" | "auditors" | "general" | "smart_analytics">("items");
  
  // Helper to handle Excel Export for the current view
  const handleExportExcel = () => {
    try {
      const detailedRows: any[] = [];

      itemsDashboardData.forEach(item => {
        item.history.forEach((h: any) => {
          const modsStr = (h.modifications || []).map((m: any) => 
            `${m.modifier} (${m.modifierRole}): ${m.oldQty} -> ${m.newQty}`
          ).join(' | ');

          detailedRows.push({
            "كود الصنف": item.itemId,
            "اسم الصنف": item.name,
            "الوحدة": item.unit || "عدد",
            "تاريخ الجرد": h.displayDate,
            "أمين العهدة": h.auditor,
            "اسم الجلسة": h.sessionName || "-",
            "الرصيد الدفتري": h.book,
            "جرد الأمين": h.storekeeper !== null ? h.storekeeper : "-",
            "جرد المشرف": h.supervisor !== null ? h.supervisor : "-",
            "جرد المسئول": h.manager !== null ? h.manager : "-",
            "الرصيد المعتمد": h.physical,
            "الفرق": h.diff,
            "حالة الجرد": h.diff === 0 ? "مطابق" : (h.diff > 0 ? `زيادة (+${h.diff})` : `عجز (${h.diff})`),
            "تعديلات المسئولين": modsStr || "-",
            "الملاحظات": h.note || "-"
          });
        });

        if (item.history.length === 0) {
          detailedRows.push({
            "كود الصنف": item.itemId,
            "اسم الصنف": item.name,
            "الوحدة": item.unit || "عدد",
            "حالة الجرد": "لا توجد سجلات تاريخية"
          });
        }
      });

      const ws = XLSX.utils.json_to_sheet(detailedRows);
      
      // Set column widths for better readability
      const wscols = [
        { wch: 15 }, // كود الصنف
        { wch: 30 }, // اسم الصنف
        { wch: 10 }, // الوحدة
        { wch: 15 }, // تاريخ الجرد
        { wch: 20 }, // أمين العهدة
        { wch: 20 }, // اسم الجلسة
        { wch: 15 }, // الرصيد الدفتري
        { wch: 15 }, // جرد الأمين
        { wch: 15 }, // جرد المشرف
        { wch: 15 }, // جرد المسئول
        { wch: 15 }, // الرصيد المعتمد
        { wch: 10 }, // الفرق
        { wch: 20 }, // حالة الجرد
        { wch: 50 }, // تعديلات المسئولين
        { wch: 30 }  // الملاحظات
      ];
      ws['!cols'] = wscols;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "تفاصيل الجرد");
      XLSX.writeFile(wb, `تقرير_جرد_تفصيلي_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error("Excel Export Error:", error);
      alert("حدث خطأ أثناء تصدير ملف Excel");
    }
  };

  const activeSubTab = propActiveSubTab !== undefined ? propActiveSubTab : localActiveSubTab;
  const setActiveSubTab = propSetActiveSubTab !== undefined ? propSetActiveSubTab : setLocalActiveSubTab;

  // States for Smart Analytics Filters and Sub-tabs
  const [selectedSessionIdFilter, setSelectedSessionIdFilter] = useState<string>("all");
  const [smartAnalyticsSubTab, setSmartAnalyticsSubTab] = useState<"items" | "keepers" | "supervisors">("items");
  const [selectedItemIdFilter, setSelectedItemIdFilter] = useState<string>("all");
  const [selectedAuditor, setSelectedAuditor] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedSmartKeeperCode, setSelectedSmartKeeperCode] = useState<string>("all");

  // Dynamically slice the past sessions dataset based on filters prior to running the analytical engine
  const filteredPastSessionsForAnalytics = useMemo(() => {
    return pastSessions.map(session => {
      let filteredItems = session.items || [];
      if (selectedAuditor !== "all") {
        filteredItems = filteredItems.filter((itm: any) => String(itm.assignedTo) === selectedAuditor);
      }
      if (selectedItemIdFilter !== "all") {
        filteredItems = filteredItems.filter((itm: any) => String(itm.itemId || itm.id) === selectedItemIdFilter);
      }
      return {
        ...session,
        items: filteredItems
      };
    }).filter(session => {
      if (selectedSessionIdFilter !== "all") {
        return session.id === selectedSessionIdFilter;
      }
      if (session.date) {
        const dStr = session.date.split("T")[0];
        if (startDate && dStr < startDate) return false;
        if (endDate && dStr > endDate) return false;
      }
      return session.items && session.items.length > 0;
    });
  }, [pastSessions, selectedSessionIdFilter, selectedAuditor, selectedItemIdFilter, startDate, endDate]);

  // Run AI-powered Smart Analytics over the filtered historical sessions
  const smartAnalyticsData = useMemo(() => {
    return runSmartAnalytics(filteredPastSessionsForAnalytics, allUsers);
  }, [filteredPastSessionsForAnalytics, allUsers]);

  // Dynamic AI & Statistical Management Decisions recommendation engine
  const smartRecommendations = useMemo(() => {
    const list: { type: "success" | "warning" | "info" | "danger"; title: string; desc: string; action: string }[] = [];
    
    // 1. Storekeeper Performance Decisions
    const keepers = smartAnalyticsData.storekeeperEvaluations;
    const lowKeepers = keepers.filter(k => k.score < 70);
    const topKeepers = keepers.filter(k => k.score >= 90);

    if (topKeepers.length > 0) {
      list.push({
        type: "success",
        title: "تكريم وحافز تميز جرد للأمين المتميز",
        desc: `الأمين المتميز (${topKeepers[0].name}) حقق درجة ثقة ذكية استثنائية قدرها ${topKeepers[0].score}% مع دقة عالية وتصحيحات نادرة.`,
        action: "يوصى بصرف مكافأة تميز للجرد أو منحه لقب 'أمين الشهر موازنةً' لتشجيع كفاءة الرقابة الميدانية."
      });
    }

    if (lowKeepers.length > 0) {
      list.push({
        type: "danger",
        title: "إعادة تأهيل ورقابة ثنائية فورية",
        desc: `الأمين (${lowKeepers[0].name}) سجل مؤشر استقرار جرد حرج بنسبة ${lowKeepers[0].score}% مع تكرار أخطاء عد بشرية غير مبررة إحصائياً.`,
        action: "يوصى فوراً بجدولة حصة تدريبية له على موازين العد الآلية، وتعيين مرافق تدقيق ثنائي في فترات الجرد المقبلة."
      });
    }

    // 2. Item Discrepancy Decisions
    const items = Object.values(smartAnalyticsData.itemStats) as any[];
    const systemicItems = items.filter((itm: any) => itm.isInherentSystemicDiscrepancy);

    if (systemicItems.length > 0) {
      list.push({
        type: "warning",
        title: "مراجعة عيوب الإنتاج أو التعبئة للصنف",
        desc: `الصنف (${systemicItems[0].name}) يعاني من انحراف نظامي ممتد تاريخياً بمتوسط فارق (${systemicItems[0].historicalMeanDiff.toFixed(1)} وحدة) مستقل تماماً عن العنصر البشري المجرود.`,
        action: "الفروقات ثابتة وناتجة عن عيوب في الآلات أو نقص وزن العبوات الأصلية؛ يوصى بفحص موازين الإنتاج أو تدقيق المورد."
      });
    }

    // 3. Supervisor Auditing Decisions
    const supers = smartAnalyticsData.supervisorEvaluations;
    const highOverrides = supers.filter(s => s.managerOverridesCount > 1);

    if (highOverrides.length > 0) {
      list.push({
        type: "warning",
        title: "مواءمة عاجلة لمعايير التدقيق الإشرافي",
        desc: `المشرف (${highOverrides[0].name}) سجل عدد ${highOverrides[0].managerOverridesCount} تعديلات لاحقة بواسطة الإدارة العامة بعد اعتماده للجلسات الجردية.`,
        action: "يوصى بمطابقة تفسيرات الاعتمادات مع المشرف وتوحيد قواعد التحقق لعدم ترحيل الفروقات العشوائية دون تفصيل نظامي."
      });
    } else if (supers.length > 0 && supers[0].verificationAccuracyRate >= 92) {
      list.push({
        type: "success",
        title: "ترقية أو تكليف المشرف بمهام التدريب",
        desc: `المشرف (${supers[0].name}) يتمتع بمعدل دقة اعتماد مثير للإعجاب (${supers[0].verificationAccuracyRate}%) دون أي تعارضات مع قرارات المدير العام.`,
        action: "يوصى بتكليفه بقيادة بروتوكولات الموازنة وتدريب كادر المشرفين الجدد في الفروع لتسريع عمليات الترحيل الآمن."
      });
    }

    if (list.length === 0) {
      list.push({
        type: "info",
        title: "استقرار تام في المعايير ومؤشرات الجرد",
        desc: "البيانات الإحصائية المفحوصة حالياً تظهر اتساقاً ممتازاً لكافة قراءات الأمناء وأوزان الأصناف دون وجود قيم شاذة متكررة.",
        action: "يوصى بالحفاظ على وتيرة الرقابة الدورية الذاتية المعتمدة حالياً."
      });
    }

    return list;
  }, [smartAnalyticsData]);

  const [streakFilter, setStreakFilter] = useState<"all" | "persistent" | "new">("all");
  const [activeStaffSubTab, setActiveStaffSubTab] = useState<"storekeepers" | "supervisors">("storekeepers");
  const [visibleFilterSections, setVisibleFilterSections] = useState<string[]>([]);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState<boolean>(false);

  // Expanded Accordion Rows
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const [expandedAuditorCodes, setExpandedAuditorCodes] = useState<string[]>([]);
  const [expandedSupervisorNames, setExpandedSupervisorNames] = useState<string[]>([]);
  const [expandedTimelineDates, setExpandedTimelineDates] = useState<string[]>([]);

  // Toggle helpers
  const toggleItemExpand = (id: string) => {
    setExpandedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAuditorExpand = (code: string) => {
    setExpandedAuditorCodes(prev => 
      prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]
    );
  };

  const toggleSupervisorExpand = (name: string) => {
    setExpandedSupervisorNames(prev => 
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]
    );
  };

  const toggleTimelineExpand = (date: string) => {
    setExpandedTimelineDates(prev => 
      prev.includes(date) ? prev.filter(x => x !== date) : [...prev, date]
    );
  };

  // 3. Extract Master Filter Options
  const filterOptions = useMemo(() => {
    const auditorsMap = new Map<string, string>(); // code -> name
    const uniqueItemsMap = new Map<string, string>(); // itemId -> name
    let minDate = "";
    let maxDate = "";

    pastSessions.forEach(session => {
      // Date extraction
      if (session.date) {
        const dStr = session.date.split("T")[0];
        if (!minDate || dStr < minDate) minDate = dStr;
        if (!maxDate || dStr > maxDate) maxDate = dStr;
      }

      // Items extraction
      (session.items || []).forEach((item: any) => {
        const id = item.itemId || item.id;
        const name = item.name || item.itemName;
        if (id && name) {
          uniqueItemsMap.set(String(id), String(name));
        }
        
        // Collect only storekeepers as auditors using original assignedTo (STRICT USER REQUEST)
        const code = item.assignedTo;
        if (code && code !== "عام" && code !== "general") {
          if (isUserStorekeeper(code)) {
            const nameStr = allUsers.find(u => String(u.code) === String(code))?.name || 
              `أمين مخزن (${code})`;
            auditorsMap.set(String(code), nameStr);
          }
        }
      });
    });

    return {
      auditors: Array.from(auditorsMap.entries()).map(([code, name]) => ({ code, name })),
      items: Array.from(uniqueItemsMap.entries()).map(([id, name]) => ({ id, name })),
      minDate,
      maxDate
    };
  }, [pastSessions, allUsers]);

  // 4. Flatten and Filter Data Dynamically
  const filteredData = useMemo(() => {
    // Filter sessions first by date and session ID
    const filteredSessions = pastSessions.filter(session => {
      if (selectedSessionIdFilter !== "all" && session.id !== selectedSessionIdFilter) return false;
      if (!session.date) return true;
      const dStr = session.date.split("T")[0];
      if (startDate && dStr < startDate) return false;
      if (endDate && dStr > endDate) return false;
      return true;
    });

    // Flatten items and apply remaining filters
    const allFilteredItems: any[] = [];
    filteredSessions.forEach(session => {
      const sessionDate = session.date ? session.date.split("T")[0] : "غير محدد";
      (session.items || []).forEach((item: any) => {
        const itemCode = String(item.itemId || item.id || "");
        const auditorCode = item.assignedTo; // ALWAYS filter by assignedTo (STRICT USER REQUEST)

        // Selection filter by item
        const matchesItem = selectedItemIdFilter === "all" || itemCode === selectedItemIdFilter;

        // Auditor filter (only matches storekeepers)
        const matchesAuditor = selectedAuditor === "all" || String(auditorCode) === selectedAuditor;

        if (matchesItem && matchesAuditor) {
          allFilteredItems.push({
            ...item,
            sessionDate,
            sessionId: session.id,
            sessionName: session.name,
            sessionModifications: session.modifications || [],
            sessionArchivedBy: session.archivedBy || "",
            sessionArchivedAt: session.archivedAt || session.date,
            sessionSupervisorApprovedBy: session.supervisorApprovedBy || "",
            sessionSupervisorApprovedAt: session.supervisorApprovedAt || ""
          });
        }
      });
    });

    return {
      sessions: filteredSessions,
      items: allFilteredItems
    };
  }, [pastSessions, selectedItemIdFilter, selectedAuditor, startDate, endDate, selectedSessionIdFilter]);

  // 5. Detect Cross-Session Modifications (Removed: Each session is independent as requested)

  // 6. Group and Process Items with History & Discrepancy Streaks
  const itemsDashboardData = useMemo(() => {
    const grouped = new Map<string, any>(); // itemId -> aggregation

    filteredData.items.forEach(item => {
      const id = String(item.itemId || item.id || "");
      const book = item.bookQty || 0;
      
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      
      const skVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
        ? item.storekeeperQty 
        : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);

      // Definitive physical count priority: Manager > Supervisor > Storekeeper
      const physical = managerVal !== null 
        ? managerVal 
        : (supervisorVal !== null ? supervisorVal : (skVal !== null ? skVal : 0));
      
      const diff = physical - book;
      
      // Detection of corrections
      const isSupervisorCorrection = supervisorVal !== null && supervisorVal !== skVal;
      const isManagerCorrection = managerVal !== null && ((supervisorVal !== null && managerVal !== supervisorVal) || (supervisorVal === null && managerVal !== skVal));
      
      const correctionAmount = Math.abs(physical - (skVal || 0));

        // Extract all specific modifications for this item from the session
        // We look through session.modifications and find entries that changed this specific item
        const itemVersionNum = getItemSessionVersion(id, item.sessionId);

        const sessionArchiveModifications = (item.sessionModifications || []).map((mod: any) => {
          const itemChange = mod.itemChanges?.find((change: any) => {
            // Robust matching: by ID, itemCode, or Name
            const cId = String(change.id || change.itemId || change.itemCode || "").trim();
            const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
            const cName = String(change.name || change.itemName || "").trim().toLowerCase();
            const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
            
            return (cId && cId === currentId) || (cName && cName === currentName);
          });

          if (!itemChange) return null;
          
          // Handle field name variations and check what actually changed
          const physNew = itemChange.newPhysicalQty !== undefined ? itemChange.newPhysicalQty : itemChange.newQty;
          const physOld = itemChange.oldPhysicalQty !== undefined ? itemChange.oldPhysicalQty : itemChange.oldQty;
          const superNew = itemChange.newSupervisorQty;
          const superOld = itemChange.oldSupervisorQty;

          const isPhysChanged = physNew !== undefined && physNew !== physOld;
          const isSuperChanged = superNew !== undefined && superNew !== superOld;

          // If nothing changed in the explicit fields, check if it's an old format entry with just 'newQty'
          if (!isPhysChanged && !isSuperChanged && physNew === undefined) return null;

          // Prioritize the value that actually changed in this modification entry. 
          const displayQty = isSuperChanged ? superNew : physNew;
          const displayOld = isSuperChanged ? superOld : physOld;
          
          // Resolve real name and role of modifier dynamically
          const rawModifier = mod.modifiedBy || mod.modifier || "مسئول";
          const details = getUserDetails(rawModifier, rawModifier, "مسئول البرنامج");
          
          return {
            modifier: details.name,
            modifierRole: details.role,
            newQty: displayQty,
            oldQty: displayOld,
            timestamp: mod.modifiedAt || mod.timestamp || Date.now(),
            sessionName: item.sessionName,
            sessionId: item.sessionId,
            sessionDate: item.sessionDate,
            versionNumber: itemVersionNum
          };
        }).filter(Boolean);

      let itemModifications: any[] = [];
      
      // 1. Get explicit Storekeeper Modifications from the item's own list
      const skMods = getStorekeeperModifications(item).map((mod: any) => ({
        ...mod,
        versionNumber: itemVersionNum
      }));
      itemModifications.push(...skMods);

      // 2. Supervisor Correction (Implicit or Explicit)
      if (isSupervisorCorrection) {
        // Check if this supervisor correction is already recorded in sessionArchiveModifications or explicit modifications
        const alreadyRecordedSupMod = sessionArchiveModifications.some((mod: any) => 
          mod.newQty === supervisorVal && mod.oldQty === skVal
        );
        
        if (!alreadyRecordedSupMod) {
          const supKey = "102"; // Strictly use supervisor's user code
          const details = getUserDetails(supKey, "مشرف مخازن", "مشرف مخازن");
          
          const baseDate = item.sessionSupervisorApprovedAt 
            ? new Date(item.sessionSupervisorApprovedAt)
            : (item.sessionArchivedAt ? new Date(item.sessionArchivedAt) : (item.inventoriedAt ? new Date(item.inventoriedAt) : null));
           
          if (baseDate && !isNaN(baseDate.getTime())) {
            itemModifications.push({
              modifier: details.name,
              modifierRole: details.role,
              newQty: supervisorVal,
              oldQty: skVal,
              timestamp: baseDate.getTime(),
              sessionName: item.sessionName,
              sessionId: item.sessionId,
              sessionDate: item.sessionDate,
              versionNumber: itemVersionNum
            });
          }
        }
      }

      // 3. Filter and Add Post-Archive Modifications, ensuring they belong to current version
      const currentVersionArchiveMods = sessionArchiveModifications.filter((mod: any) => 
        mod.versionNumber === itemVersionNum || mod.sessionName === item.sessionName
      );
      
      // Find the quantity at the moment of archiving
      let qtyAtArchive = managerVal;
      if (currentVersionArchiveMods.length > 0) {
        qtyAtArchive = currentVersionArchiveMods[0].oldQty;
      }

      // 4. Program Manager Pre-Archive Correction
      const preManagerQty = supervisorVal !== null ? supervisorVal : skVal;
      const isManagerActiveSessionCorrection = qtyAtArchive !== null && preManagerQty !== null && qtyAtArchive !== preManagerQty;

      if (isManagerActiveSessionCorrection) {
        // Check if this manager correction is already recorded in sessionArchiveModifications
        const alreadyRecordedPmMod = sessionArchiveModifications.some((mod: any) => 
          mod.newQty === qtyAtArchive && mod.oldQty === preManagerQty
        );

        if (!alreadyRecordedPmMod) {
          const pmKey = item.sessionArchivedBy || "101";
          const details = getUserDetails(pmKey, "مسئول برنامج", "مسئول البرنامج");
          
          const baseDate = item.sessionArchivedAt ? new Date(item.sessionArchivedAt) : null;
          
          if (baseDate && !isNaN(baseDate.getTime())) {
            itemModifications.push({
              modifier: details.name,
              modifierRole: details.role,
              newQty: qtyAtArchive,
              oldQty: preManagerQty,
              timestamp: baseDate.getTime(),
              sessionName: item.sessionName,
              sessionId: item.sessionId,
              sessionDate: item.sessionDate,
              versionNumber: itemVersionNum
            });
          }
        }
      }

      // 5. Post-Archive Modifications
      itemModifications.push(...currentVersionArchiveMods);

      // Final chronological sort of all modification steps
      itemModifications.sort((a: any, b: any) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        
        return timeA - timeB;
      });

      const sessionName = item.sessionName;
      const groupKey = id;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          itemId: id,
          sessionName: sessionName && sessionName !== "unknown" ? sessionName : undefined,
          name: item.name || item.itemName || "صنف غير معروف",
          category: item.category || "عام",
          unit: item.unit || "عدد",
          totalChecks: 0,
          totalBookQty: 0,
          totalPhysicalQty: 0,
          absoluteDiscrepancy: 0,
          netDiscrepancy: 0,
          totalStorekeeperModifications: 0,
          supervisorCorrectionsCount: 0,
          managerCorrectionsCount: 0,
          totalCorrectionVolume: 0,
          history: []
        });
      }

      const entry = grouped.get(groupKey);
      entry.totalChecks += 1;
      entry.totalBookQty += book;
      entry.totalPhysicalQty += physical;
      entry.absoluteDiscrepancy += Math.abs(diff);
      entry.netDiscrepancy += diff;
      
      const storekeeperModCount = skMods.length;
      const supervisorModCount = isSupervisorCorrection ? 1 : 0;
      const managerModCount = (isManagerActiveSessionCorrection ? 1 : 0) + sessionArchiveModifications.length;

      entry.totalStorekeeperModifications += storekeeperModCount;
      entry.supervisorCorrectionsCount += supervisorModCount;
      entry.managerCorrectionsCount += managerModCount;
      
      if (storekeeperModCount + supervisorModCount + managerModCount > 0) {
        entry.totalCorrectionVolume += correctionAmount;
      }
      
      entry.history.push({
        date: item.sessionArchivedAt || item.sessionDate,
        displayDate: item.sessionDate,
        book,
        storekeeper: skVal,
        supervisor: supervisorVal,
        manager: managerVal,
        physical,
        diff,
        isSupervisorCorrection,
        isManagerCorrection,
        correctionAmount,
        supervisorName: item.inventoriedByName || "مشرف",
        modifications: itemModifications,
        sessionName: item.sessionName,
        sessionId: item.sessionId,
        note: item.note || item.notes || "",
        modification: item.modification || "",
        versionNumber: itemVersionNum,
        auditor: allUsers.find(u => String(u.code) === String(item.assignedTo))?.name || `أمين رقم ${item.assignedTo || "عام"}`,
        storekeeperModCount,
        supervisorModCount,
        managerModCount
      });
    });

    const resultList = Array.from(grouped.values());
    resultList.forEach(item => {
      // Sort history records NEWEST TO OLDEST for display
      item.history.sort((a: any, b: any) => {
        // Step 1: Compare by the Inventory Date string (YYYY-MM-DD)
        const dateA = String(a.displayDate || "");
        const dateB = String(b.displayDate || "");
        
        if (dateA !== dateB) {
          return dateB.localeCompare(dateA); // Newest Date First (e.g. 2026-07-25 before 2026-06-25)
        }
        
        // Step 2: If same day, sort by the Archive Timestamp (ISO string with time)
        const timeA = new Date(a.date || 0).getTime();
        const timeB = new Date(b.date || 0).getTime();
        
        if (timeA !== timeB) {
          return timeB - timeA; // Newest Archive Time First
        }
        
        // Step 3: Fallback to version number
        return (b.versionNumber || 1) - (a.versionNumber || 1);
      });

      // Aggregate all modifications to the top level for easy access in reports/cards
      item.modifications = item.history.flatMap((h: any) => h.modifications || []);

      // Recalculate totalStorekeeperModifications
      item.totalStorekeeperModifications = item.history.reduce((acc: number, h: any) => {
        return acc + h.modifications.filter((m: any) => m.isStorekeeperModification).length;
      }, 0);

      // Ensure that for each history row, its modifications are sorted ASCENDING chronologically
      item.history.forEach((h: any) => {
        h.modifications.sort((a: any, b: any) => {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
      });

      const hLength = item.history.length;
      // The newest record is at index 0 because it's sorted descending
      item.latestDiff = hLength > 0 ? item.history[0].diff : 0;
      
      // Calculate Discrepancy Persistence Streak starting from the newest record (index 0) going older
      let streak = 0;
      if (item.latestDiff !== 0) {
        streak = 1;
        for (let i = 1; i < hLength; i++) {
          if (item.history[i].diff === item.latestDiff) {
            streak++;
          } else {
            break;
          }
        }
      }
      item.persistenceStreak = streak;
    });

    // Apply Streak filter if selected and sort by latest inventory date (Newest First)
    return resultList
      .filter(item => {
        if (streakFilter === "persistent") return item.persistenceStreak > 1;
        if (streakFilter === "new") return item.latestDiff !== 0 && item.persistenceStreak === 1;
        return true;
      })
      .sort((a, b) => {
        const getSortKey = (itemObj: any) => {
          if (itemObj.history.length === 0) return "";
          const top = itemObj.history[0];
          return String(top.displayDate || (top.date ? top.date.split('T')[0] : ""));
        };
        const dateA = getSortKey(a);
        const dateB = getSortKey(b);
        
        if (dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }
        
        // Same inventory date, use archive time
        const timeA = a.history.length > 0 ? new Date(a.history[0].date || 0).getTime() : 0;
        const timeB = b.history.length > 0 ? new Date(b.history[0].date || 0).getTime() : 0;
        return timeB - timeA;
      });
  }, [filteredData, streakFilter]);

  // 6. Compute High-Level Metrics
  const metrics = useMemo(() => {
    const totalItems = filteredData.items.length;
    let perfectCounts = 0;
    let totalOverageQty = 0;
    let totalShortageQty = 0;
    let totalAbsoluteVariance = 0;

    let totalSupervisorCorrections = 0;
    let totalManagerCorrections = 0;
    let totalCorrectionQtyValue = 0;

    filteredData.items.forEach(item => {
      const book = item.bookQty || 0;
      
      const skVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
        ? item.storekeeperQty 
        : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);
      
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;

      const physical = supervisorVal !== null 
        ? supervisorVal 
        : (skVal !== null ? skVal : (item.physicalQty || 0));
      
      const diff = physical - book;
      totalAbsoluteVariance += Math.abs(diff);

      if (diff === 0) {
        perfectCounts++;
      } else if (diff > 0) {
        totalOverageQty += diff;
      } else {
        totalShortageQty += Math.abs(diff);
      }

      // Check for supervisor recount override / correction
      const isSupervisorCorrection = supervisorVal !== null && supervisorVal !== skVal;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      let sessionModsCount = 0;
      let qtyAtArchiveForCount = managerVal;
      if (item.sessionModifications) {
        const itemMods = item.sessionModifications.filter((mod: any) => {
          return mod.itemChanges?.some((change: any) => {
            const cId = String(change.id || change.itemId || change.itemCode || "").trim();
            const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
            const cName = String(change.name || change.itemName || "").trim().toLowerCase();
            const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
            return (cId && cId === currentId) || (cName && cName === currentName);
          });
        });
        sessionModsCount = itemMods.length;
        
        // Find the quantity at archive to check if there was an active session edit by manager
        if (itemMods.length > 0) {
          const firstMod = itemMods.sort((a: any, b: any) => new Date(a.modifiedAt || a.timestamp || 0).getTime() - new Date(b.modifiedAt || b.timestamp || 0).getTime())[0];
          const itemChange = firstMod.itemChanges?.find((c: any) => {
             const cId = String(c.id || c.itemId || c.itemCode || "").trim();
             const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
             const cName = String(c.name || c.itemName || "").trim().toLowerCase();
             const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
             return (cId && cId === currentId) || (cName && cName === currentName);
          });
          if (itemChange) {
            qtyAtArchiveForCount = itemChange.oldPhysicalQty !== undefined ? itemChange.oldPhysicalQty : itemChange.oldQty;
          }
        }
      }

      const preManagerQtyForCount = supervisorVal !== null ? supervisorVal : skVal;
      const isManagerActiveSessionCorrection = qtyAtArchiveForCount !== null && preManagerQtyForCount !== null && qtyAtArchiveForCount !== preManagerQtyForCount;

      if (isSupervisorCorrection) {
        totalSupervisorCorrections += 1;
      }

      const hasManagerCorrection = (sessionModsCount > 0) || isManagerActiveSessionCorrection;
      if (hasManagerCorrection) {
        totalManagerCorrections += (sessionModsCount + (isManagerActiveSessionCorrection ? 1 : 0));
      }

      const totalModsForThisItem = (hasManagerCorrection ? 1 : 0) + (isSupervisorCorrection ? 1 : 0);
      if (totalModsForThisItem > 0) {
        totalCorrectionQtyValue += Math.abs((managerVal !== null ? managerVal : physical) - (skVal || 0));
      }
    });

    const accuracyRate = totalItems > 0 ? Math.round((perfectCounts / totalItems) * 100) : 100;

    // Discrepancy persistence count across items
    let persistentDiscrepanciesCount = 0;
    let totalStorekeeperModifications = 0;
    itemsDashboardData.forEach(item => {
      if (item.persistenceStreak > 1) {
        persistentDiscrepanciesCount++;
      }
      totalStorekeeperModifications += item.totalStorekeeperModifications || 0;
    });

    return {
      totalItems,
      perfectCounts,
      discrepantItems: totalItems - perfectCounts,
      totalOverageQty,
      totalShortageQty,
      totalAbsoluteVariance,
      accuracyRate,
      totalSupervisorCorrections,
      totalManagerCorrections,
      totalCorrectionQtyValue,
      persistentDiscrepanciesCount,
      totalStorekeeperModifications
    };
  }, [filteredData, itemsDashboardData]);

  // 8. Storekeepers performance (Tab 2 sub-tab 1) - EXCLUDE supervisors and managers
  const auditorsDashboardData = useMemo(() => {
    const grouped = new Map<string, any>(); // auditorCode -> aggregation

    filteredData.items.forEach(item => {
      // ALWAYS use the assigned storekeeper code instead of inventoriedByCode! (STRICT USER REQUEST)
      const code = String(item.assignedTo || "general");
      if (code === "عام" || code === "general") return; // Skip general assignment

      // Strictly evaluate if this code belongs to a storekeeper
      if (!isUserStorekeeper(code)) return;

      const name = allUsers.find(u => String(u.code) === String(code))?.name || 
        `أمين مخزن رقم ${code}`;
      const book = item.bookQty || 0;
      
      const storekeeperVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
        ? item.storekeeperQty 
        : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);
      
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      const physical = supervisorVal !== null 
        ? supervisorVal 
        : (storekeeperVal !== null ? storekeeperVal : (item.physicalQty || 0));

      const isCorrected = storekeeperVal !== null && (
        (supervisorVal !== null && supervisorVal !== storekeeperVal) ||
        (managerVal !== null && managerVal !== storekeeperVal)
      );
      const correctionAmount = isCorrected ? Math.abs((supervisorVal ?? managerVal ?? storekeeperVal) - storekeeperVal) : 0;

      // Find supervisor correction
      const isSupervisorCorrection = supervisorVal !== null && supervisorVal !== storekeeperVal;

      // Find manager corrections
      const session = filteredData.sessions.find(s => s.id === item.sessionId);
      const skMods = getStorekeeperModifications(item);
      const storekeeperModCount = skMods.length;
      const supervisorModCount = (supervisorVal !== null && supervisorVal !== storekeeperVal) ? 1 : 0;

      const preManagerQtyForCount = supervisorVal !== null ? supervisorVal : storekeeperVal;
      
      let managerModCount = 0;
      let lastValForManager = preManagerQtyForCount;

      if (session && session.modifications) {
        const itemMods = session.modifications.filter((mod: any) => {
          return mod.itemChanges?.some((change: any) => {
            const cId = String(change.id || change.itemId || change.itemCode || "").trim();
            const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
            const cName = String(change.name || change.itemName || "").trim().toLowerCase();
            const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
            return (cId && cId === currentId) || (cName && cName === currentName);
          });
        });
        
        const sortedMods = itemMods.sort((a: any, b: any) => new Date(a.modifiedAt || a.timestamp || 0).getTime() - new Date(b.modifiedAt || b.timestamp || 0).getTime());
        
        sortedMods.forEach((mod: any) => {
          const change = mod.itemChanges?.find((c: any) => {
            const cId = String(c.id || c.itemId || c.itemCode || "").trim();
            const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
            const cName = String(c.name || c.itemName || "").trim().toLowerCase();
            const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
            return (cId && cId === currentId) || (cName && cName === currentName);
          });
          if (change) {
            managerModCount += 1;
            lastValForManager = (change.newPhysicalQty !== undefined ? change.newPhysicalQty : (change.newQty ?? 0));
          }
        });
      }

      if (managerVal !== null && lastValForManager !== null && managerVal !== lastValForManager) {
        managerModCount += 1;
      }

      if (!grouped.has(code)) {
        grouped.set(code, {
          code,
          name,
          totalAssigned: 0,
          totalSubmitted: 0,
          totalShifts: 0,
          sessionIds: new Set<string>(),
          perfectMatches: 0,           // storekeeper count matched book value initially
          recheckedItemsCount: 0,      // Unique items with recount/correction events
          totalStorekeeperModifications: 0, // Storekeeper's recounts quantity
          totalSupervisorCorrections: 0,    // Supervisor's overrides quantity
          totalManagerCorrections: 0,       // Program Manager's overrides quantity
          totalRecheckVariance: 0,
          history: []
        });
      }

      const auditor = grouped.get(code);
      auditor.totalAssigned += 1;
      if (item.sessionId) {
        auditor.sessionIds.add(String(item.sessionId));
      }
      
      if (item.submitted || storekeeperVal !== null) {
        auditor.totalSubmitted += 1;
      }

      // Add to unique rechecks items count if this item had any modifications or was rechecked by supervisor/manager
      const isRechecked = skMods.length > 0 || supervisorVal !== null || managerVal !== null;
      if (isRechecked) {
        auditor.recheckedItemsCount += 1;
      }

      auditor.totalStorekeeperModifications += storekeeperModCount;
      auditor.totalSupervisorCorrections += supervisorModCount;
      auditor.totalManagerCorrections += managerModCount;

      if (isCorrected) {
        auditor.totalRecheckVariance += correctionAmount;
      }

      if (storekeeperVal !== null && storekeeperVal === book) {
        auditor.perfectMatches += 1;
      }

      auditor.history.push({
        itemId: item.itemId || item.id,
        name: item.name || item.itemName || "صنف غير معروف",
        date: item.sessionDate,
        book,
        storekeeper: storekeeperVal,
        supervisor: supervisorVal,
        physical,
        isCorrected,
        correctionAmount,
        sessionName: item.sessionName,
        sessionId: item.sessionId,
        note: item.note || item.notes || "",
        storekeeperModCount,
        supervisorModCount,
        managerModCount,
        storekeeperModifications: skMods
      });
    });

    return Array.from(grouped.values()).map(auditor => {
      auditor.totalShifts = (auditor as any).sessionIds?.size || 0;
      const totalEvaluated = auditor.totalSubmitted;
      const uniqueItemsWithCorrections = auditor.history.filter((h: any) => h.isCorrected || (h.storekeeperModCount && h.storekeeperModCount > 0)).length;

      // Storekeeper Recount Match Rate: percentage of checks that required no modifications
      const recountMatchRate = totalEvaluated > 0
        ? Math.max(0, Math.round(((totalEvaluated - uniqueItemsWithCorrections) / totalEvaluated) * 100))
        : 100;

      // Initial count book accuracy
      const initialBookAccuracy = totalEvaluated > 0
        ? Math.round((auditor.perfectMatches / totalEvaluated) * 100)
        : 100;

      // Group history by date/day and session (CRITICAL USER REQUEST: AGGREGATE ON DAYS LEVEL BUT SEPARATE BY SESSION)
      const dailyMap = new Map<string, any>();
      auditor.history.forEach((h: any) => {
        const groupKey = `${h.date}_${h.sessionName || "unknown"}`;
        if (!dailyMap.has(groupKey)) {
          dailyMap.set(groupKey, {
            date: h.date,
            totalItems: 0,
            bookMatches: 0,
            rechecksCount: 0,
            recheckVariance: 0,
            totalVariance: 0,
            sessionName: h.sessionName,
            notes: [],
            totalStorekeeperModifications: 0,
            totalSupervisorCorrections: 0,
            totalManagerCorrections: 0,
            storekeeperModifications: []
          });
        }
        const day = dailyMap.get(groupKey);
        day.totalItems += 1;
        // Count as re-inventory if supervisor corrected it OR if storekeeper had modifications
        if (h.isCorrected || (h.storekeeperModifications && h.storekeeperModifications.length > 0) || (h.storekeeperModCount && h.storekeeperModCount > 0)) {
          day.rechecksCount += 1;
          day.recheckVariance += h.correctionAmount;
        }
        if (h.storekeeper === h.book) {
          day.bookMatches += 1;
        }
        day.totalVariance += Math.abs(h.physical - h.book);
        if (h.note) {
          day.notes.push(h.note);
        }
        day.totalStorekeeperModifications += (h.storekeeperModCount || 0);
        day.totalSupervisorCorrections += (h.supervisorModCount || 0);
        day.totalManagerCorrections += (h.managerModCount || 0);
        if (h.storekeeperModifications) {
          day.storekeeperModifications.push(...h.storekeeperModifications);
        }
      });

      const dailyHistory = Array.from(dailyMap.values()).map(day => ({
        ...day,
        notes: Array.from(new Set(day.notes)).join(" • ")
      })).sort((a: any, b: any) => b.date.localeCompare(a.date));

      return {
        ...auditor,
        initialBookAccuracy,
        recountMatchRate,
        accuracyRate: recountMatchRate, // Primary sorting score
        dailyHistory
      };
    }).sort((a, b) => {
      const codeA = parseInt(String(a.code)) || 0;
      const codeB = parseInt(String(b.code)) || 0;
      return codeA - codeB;
    });
  }, [filteredData, allUsers]);

  // 8. Supervisors performance (Tab 2 sub-tab 2) - CRITICAL USER REQUEST
  const supervisorStats = useMemo(() => {
    const map = new Map<string, any>();

    pastSessions.forEach(session => {
      const isApproved = session.supervisorApproved || session.supervisorApprovedBy;
      if (isApproved) {
        const name = session.supervisorApprovedBy || "مشرف غير محدد";
        const supCode = allUsers.find(u => u.name === name || u.code === session.supervisorApprovedByCode)?.code || "";
        const dateStr = session.date ? session.date.split("T")[0] : "غير محدد";

        if (!map.has(name)) {
          map.set(name, {
            name,
            code: supCode,
            totalSessionsApproved: 0,
            totalItemsVerified: 0,
            recountsPerformed: 0,
            totalSupervisorCorrections: 0,
            totalCorrectionQty: 0,
            perfectBookMatches: 0,
            totalStorekeeperModifications: 0,
            totalSupervisorCorrections: 0,
            totalManagerCorrections: 0,
            totalOverageQty: 0,
            totalShortageQty: 0,
            sessionsList: [],
            history: [] // Unified chronological daily audits log
          });
        }

        const sup = map.get(name);
        sup.totalSessionsApproved += 1;
        
        const isExistSession = sup.sessionsList.some((s: any) => s.id === session.id);
        if (!isExistSession) {
          sup.sessionsList.push({
            id: session.id,
            name: session.name,
            date: dateStr
          });
        }

        (session.items || []).forEach((item: any) => {
          sup.totalItemsVerified += 1;
          const book = item.bookQty || 0;
          
          const skVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
            ? item.storekeeperQty 
            : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);
          
          const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
          const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

          const physical = supervisorVal !== null 
            ? supervisorVal 
            : (skVal !== null ? skVal : (item.physicalQty || 0));

          const diff = physical - book;
          
          if (diff === 0) {
            sup.perfectBookMatches += 1;
          } else if (diff > 0) {
            sup.totalOverageQty += diff;
          } else {
            sup.totalShortageQty += Math.abs(diff);
          }

          const hasRecountCorrection = skVal !== null && (
            (supervisorVal !== null && supervisorVal !== skVal) ||
            (managerVal !== null && managerVal !== skVal)
          );
          
          const isSupervisorCorrection = supervisorVal !== null && supervisorVal !== skVal;
          const skMods = getStorekeeperModifications(item);
          const storekeeperModCount = skMods.length;
          const supervisorModCount = isSupervisorCorrection ? 1 : 0;
          
          const itemMods = (session && session.modifications) ? session.modifications.filter((mod: any) => {
            return mod.itemChanges?.some((change: any) => {
              const cId = String(change.id || change.itemId || change.itemCode || "").trim();
              const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
              const cName = String(change.name || change.itemName || "").trim().toLowerCase();
              const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
              return (cId && cId === currentId) || (cName && cName === currentName);
            });
          }) : [];
          
          const lastValForManager = supervisorVal !== null ? supervisorVal : skVal;
          const isManagerActiveSessionCorrection = (managerVal !== null && lastValForManager !== null && managerVal !== lastValForManager);
          
          // Count manager modifications: 
          // 1. Modifications in session (itemMods)
          // 2. Active session correction by manager if managerVal differs from lastValForManager
          // We must be careful not to double count if the last mod in itemMods ALREADY resulted in the current managerVal.
          
          let managerModCount = itemMods.length;
          
          // Check if the last modification in itemMods already matches managerVal
          const sortedMods = itemMods.sort((a: any, b: any) => new Date(a.modifiedAt || a.timestamp || 0).getTime() - new Date(b.modifiedAt || b.timestamp || 0).getTime());
          
          let lastModVal = lastValForManager;
          if (sortedMods.length > 0) {
            const lastMod = sortedMods[sortedMods.length - 1];
            const change = lastMod.itemChanges?.find((c: any) => {
                const cId = String(c.id || c.itemId || c.itemCode || "").trim();
                const currentId = String(item.id || item.itemId || item.itemCode || "").trim();
                const cName = String(c.name || c.itemName || "").trim().toLowerCase();
                const currentName = String(item.name || item.itemName || "").trim().toLowerCase();
                return (cId && cId === currentId) || (cName && cName === currentName);
            });
            if (change) {
                lastModVal = (change.newPhysicalQty !== undefined ? change.newPhysicalQty : (change.newQty ?? 0));
            }
          }
          
          if (managerVal !== null && managerVal !== lastModVal) {
            managerModCount += 1;
          }

          sup.totalManagerCorrections += managerModCount;
          sup.totalStorekeeperModifications += storekeeperModCount;
          sup.totalSupervisorCorrections += supervisorModCount;

        const correctionAmount = hasRecountCorrection ? Math.abs((supervisorVal ?? managerVal ?? skVal) - skVal) : 0;

        if (supervisorVal !== null || managerVal !== null) {
          sup.recountsPerformed += 1;
        }

          sup.history.push({
            itemId: item.itemId || item.id,
            itemName: item.name || item.itemName || "صنف غير معروف",
            date: dateStr,
            sessionName: session.name,
            book,
            storekeeper: skVal,
            supervisor: supervisorVal,
            isCorrected: hasRecountCorrection,
            correctionAmount,
            diff,
            storekeeperName: allUsers.find(u => String(u.code) === String(item.assignedTo))?.name || `أمين (${item.assignedTo || "عام"})`,
            note: item.note || item.notes || "",
            totalStorekeeperModifications: storekeeperModCount,
            totalSupervisorCorrections: supervisorModCount,
            totalManagerCorrections: managerModCount
          });
        });
      }
    });

    return Array.from(map.values()).map(sup => {
      // Sort history chronologically
      sup.history.sort((a: any, b: any) => a.date.localeCompare(b.date));

      // Calculate shift audit correction percentage
      const recountEfficiency = sup.recountsPerformed > 0
        ? Math.max(0, Math.round(((sup.recountsPerformed - sup.recountCorrections) / sup.recountsPerformed) * 100))
        : 100;

      // Overall book matching percentage under this supervisor's watch
      const bookAccuracy = sup.totalItemsVerified > 0
        ? Math.round((sup.perfectBookMatches / sup.totalItemsVerified) * 100)
        : 100;

      // Supervisor overall quality score rating (CRITICAL USER REQUEST: supervisor overall shift performance)
      // Base on bookAccuracy (how accurate the warehouse is) and recount efficiency (how accurate their team is)
      const qualityScore = Math.max(10, Math.min(100, Math.round((bookAccuracy * 0.6) + (recountEfficiency * 0.4))));

      // Group history by date/day and session (CRITICAL USER REQUEST: AGGREGATE ON DAYS LEVEL BUT SEPARATE BY SESSION)
      const dailyMap = new Map<string, any>();
      sup.history.forEach((h: any) => {
        const groupKey = `${h.date}_${h.sessionName || "unknown"}`;
        if (!dailyMap.has(groupKey)) {
          dailyMap.set(groupKey, {
            date: h.date,
            totalItems: 0,
            bookMatches: 0,
            recountsCount: 0,
            totalCorrectionQty: 0,
            totalVariance: 0,
            sessionName: h.sessionName,
            notes: [],
            totalStorekeeperModifications: 0,
            totalSupervisorCorrections: 0,
            totalManagerCorrections: 0
          });
        }
        const day = dailyMap.get(groupKey);
        day.totalItems += 1;
        // Count as re-inventory if supervisor corrected it OR if storekeeper had modifications
        if (h.isCorrected || (h.totalStorekeeperModifications && h.totalStorekeeperModifications > 0)) {
          day.recountsCount += 1;
          day.totalCorrectionQty += h.correctionAmount;
        }
        if (h.diff === 0) {
          day.bookMatches += 1;
        }
        day.totalVariance += Math.abs(h.diff);
        if (h.note) {
          day.notes.push(h.note);
        }
        day.totalStorekeeperModifications += (h.totalStorekeeperModifications || 0);
        day.totalSupervisorCorrections += (h.totalSupervisorCorrections || 0);
        day.totalManagerCorrections += (h.totalManagerCorrections || 0);
      });

      const dailyHistory = Array.from(dailyMap.values()).map(day => ({
        ...day,
        notes: Array.from(new Set(day.notes)).join(" • ")
      })).sort((a: any, b: any) => b.date.localeCompare(a.date));

      return {
        ...sup,
        recountEfficiency,
        bookAccuracy,
        qualityScore,
        dailyHistory
      };
    }).sort((a, b) => {
      const codeA = parseInt(String(a.code)) || 0;
      const codeB = parseInt(String(b.code)) || 0;
      return codeA - codeB;
    });
  }, [pastSessions]);

  // 9. General Dashboard (Tab 3) - Daily Timelines (Without categories as requested)
  const generalDashboardData = useMemo(() => {
    const timelineMap = new Map<string, any>();

    filteredData.items.forEach(item => {
      const book = item.bookQty || 0;
      
      const skVal = item.storekeeperQty !== undefined && item.storekeeperQty !== null 
        ? item.storekeeperQty 
        : (item.physicalQty !== null && item.physicalQty !== undefined ? item.physicalQty : null);
      
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;

      const physical = supervisorVal !== null 
        ? supervisorVal 
        : (skVal !== null ? skVal : (item.physicalQty || 0));
      
      const diff = physical - book;
      const dStr = item.sessionDate;
      const sessionName = item.sessionName || "unknown";
      const groupKey = `${dStr}_${sessionName}`;

      // Daily Timeline aggregation (Granularity: Days and Sessions)
      if (!timelineMap.has(groupKey)) {
        timelineMap.set(groupKey, {
          id: groupKey,
          date: dStr,
          sessionName: sessionName !== "unknown" ? sessionName : undefined,
          count: 0,
          discrepancyCount: 0,
          variance: 0,
          net: 0,
          itemsList: []
        });
      }
      const timeStat = timelineMap.get(groupKey);
      timeStat.count += 1;
      timeStat.variance += Math.abs(diff);
      if (diff !== 0) timeStat.discrepancyCount += 1;
      timeStat.net += diff;
      
      timeStat.itemsList.push({
        itemId: item.itemId || item.id,
        name: item.name || item.itemName || "صنف غير معروف",
        book,
        physical,
        diff,
        auditor: allUsers.find(u => String(u.code) === String(item.assignedTo))?.name || `أمين (${item.assignedTo || "عام"})`
      });
    });

    const timelineList = Array.from(timelineMap.values()).map(time => {
      // Sort timeline items by size of discrepancy
      time.itemsList.sort((a: any, b: any) => Math.abs(b.diff) - Math.abs(a.diff));
      return time;
    }).sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.sessionName || "").localeCompare(a.sessionName || "");
    }); // Descending chronological (latest days first)

    return {
      timeline: timelineList
    };
  }, [filteredData]);

  // Reset Filters
  const handleClearFilters = () => {
    setSelectedItemIdFilter("all");
    setSelectedAuditor("all");
    setStartDate("");
    setEndDate("");
    setStreakFilter("all");
    setSelectedSessionIdFilter("all");
    setVisibleFilterSections([]);
  };

  // Ensure active filters are visible in UI sections
  React.useEffect(() => {
    const active = [];
    if (selectedItemIdFilter !== "all") active.push('item');
    if (startDate || endDate) active.push('date');
    if (selectedAuditor !== "all") active.push('auditor');
    if (streakFilter !== "all") active.push('streak');
    if (selectedSessionIdFilter !== "all") active.push('session');
    
    setVisibleFilterSections(prev => {
      const combined = [...new Set([...prev, ...active])];
      return combined;
    });
  }, [selectedItemIdFilter, startDate, endDate, selectedAuditor, streakFilter, selectedSessionIdFilter]);

  // Automatically expand the item if it's the only one selected in item dropdown!
  React.useEffect(() => {
    if (selectedItemIdFilter !== "all") {
      setExpandedItemIds([selectedItemIdFilter]);
    }
  }, [selectedItemIdFilter]);

  return (
    <div className="bg-slate-50 w-full min-h-0 text-right font-sans select-none pb-6" dir="rtl">
      
      {/* 📊 Unified Metric Row (5 Cards) - Vertical layout to save width */}
      <div className="grid grid-cols-5 gap-1 mb-1 px-2 mt-0">
        
        {/* Card 1: Sessions Count */}
        <motion.div 
          whileHover={{ y: -1 }}
          className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-3xs flex flex-col items-center justify-center gap-0.5 min-h-[42px]"
        >
          <span className="text-[6.5px] text-slate-500 font-extrabold leading-tight text-center">نسخ الجرد</span>
          <div className="text-[11px] font-black text-slate-800">{pastSessions.length}</div>
        </motion.div>

        {/* Card 2: Persistent Discrepancies */}
        <motion.div 
          whileHover={{ y: -1 }}
          className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-3xs flex flex-col items-center justify-center gap-0.5 min-h-[42px]"
        >
          <span className="text-[6.5px] text-slate-500 font-extrabold leading-tight text-center">انحرافات ثابتة</span>
          <div className="text-[11px] font-black text-amber-600">{metrics.persistentDiscrepanciesCount}</div>
        </motion.div>

        {/* Card 3: Storekeeper Mods */}
        <motion.div 
          whileHover={{ y: -1 }}
          className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-3xs flex flex-col items-center justify-center gap-0.5 min-h-[42px]"
        >
          <span className="text-[6.5px] text-slate-500 font-extrabold leading-tight text-center">تعديلات امين</span>
          <div className="text-[11px] font-black text-emerald-600">{metrics.totalStorekeeperModifications}</div>
        </motion.div>

        {/* Card 4: Supervisor Corrections */}
        <motion.div 
          whileHover={{ y: -1 }}
          className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-3xs flex flex-col items-center justify-center gap-0.5 min-h-[42px]"
        >
          <span className="text-[6.5px] text-slate-500 font-extrabold leading-tight text-center">تعديلات مشرف</span>
          <div className="text-[11px] font-black text-indigo-600">{metrics.totalSupervisorCorrections}</div>
        </motion.div>

        {/* Card 5: Manager Corrections */}
        <motion.div 
          whileHover={{ y: -1 }}
          className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-3xs flex flex-col items-center justify-center gap-0.5 min-h-[42px]"
        >
          <span className="text-[6.5px] text-slate-500 font-extrabold leading-tight text-center">تعديلات مسئول</span>
          <div className="text-[11px] font-black text-rose-600">{metrics.totalManagerCorrections}</div>
        </motion.div>
      </div>

      {/* 🔍 Dynamic Filters Control Console */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-3xs mt-0.5 space-y-2 relative">
        <div className="flex items-center justify-between">
          <div className="relative">
            <button 
              onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors cursor-pointer group"
            >
              <Search className="w-3 h-3 text-indigo-600 group-hover:scale-110 transition-transform" />
              <h3 className="text-[10px] font-extrabold text-indigo-700">تصفية البيانات</h3>
              <ChevronDown className={`w-3 h-3 text-indigo-400 transition-transform ${isFilterMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {isFilterMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute top-full right-0 mt-2 w-40 bg-white border border-slate-200 shadow-xl rounded-xl z-50 p-1.5 space-y-1"
                >
                  {[
                    { id: 'session', label: 'نسخة الجرد', icon: Layers },
                    { id: 'item', label: 'الصنف المستهدف', icon: Package },
                    { id: 'date', label: 'نطاق التاريخ', icon: Calendar },
                    { id: 'auditor', label: 'أمين المخزن', icon: UserCheck },
                    { id: 'streak', label: 'حالة الانحراف', icon: AlertCircle }
                  ].map((option) => (
                    <button
                      key={option.id}
                      disabled={visibleFilterSections.includes(option.id)}
                      onClick={() => {
                        setVisibleFilterSections(prev => [...prev, option.id]);
                        setIsFilterMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-right transition-colors ${
                        visibleFilterSections.includes(option.id) 
                          ? 'bg-slate-50 text-slate-300 cursor-not-allowed' 
                          : 'hover:bg-indigo-50 text-slate-700 cursor-pointer'
                      }`}
                    >
                      <option.icon className="w-3 h-3" />
                      {option.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(selectedItemIdFilter !== "all" || selectedAuditor !== "all" || startDate || endDate || streakFilter !== "all" || selectedSessionIdFilter !== "all") && (
            <button 
              onClick={handleClearFilters}
              className="text-[9px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              تعين الفلتر
            </button>
          )}
          
          <button 
            onClick={handleExportExcel}
            className="text-[9px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1 border border-emerald-100 ml-auto mr-2"
          >
            <FileText className="w-2.5 h-2.5" />
            تصدير تقرير Excel
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {/* Render Item, Session & Date filters normally */}
          <AnimatePresence mode="popLayout">
            {visibleFilterSections.filter(id => id === 'item' || id === 'date' || id === 'session').map(sectionId => (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-2 relative group flex items-center">
                  <div className="flex flex-1 items-center gap-2">
                    {sectionId === 'session' && (
                      <div className="w-full">
                        <select
                          value={selectedSessionIdFilter}
                          onChange={e => setSelectedSessionIdFilter(e.target.value)}
                          className="w-full px-3 py-1.5 text-[10px] font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer text-slate-700 font-sans"
                        >
                          <option value="all">كل نسخ الجرد التاريخية ({pastSessions.length})</option>
                          {pastSessions.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name || `نسخة جرد ${s.date?.split("T")[0]}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {sectionId === 'item' && (
                      <div className="w-full">
                        <select
                          value={selectedItemIdFilter}
                          onChange={e => setSelectedItemIdFilter(e.target.value)}
                          className="w-full px-3 py-1.5 text-[10px] font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer text-slate-700 font-sans"
                        >
                          <option value="all">كل الأصناف الجاهزة</option>
                          {filterOptions.items.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {sectionId === 'date' && (
                      <div className="flex flex-1 gap-2">
                        <div className="relative w-1/2">
                          <input 
                            type="date"
                            value={startDate}
                            min={filterOptions.minDate}
                            max={filterOptions.maxDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="w-full px-2 py-1.5 text-[9px] font-mono font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
                          />
                          {!startDate && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-bold pointer-events-none">
                              من تاريخ
                            </span>
                          )}
                        </div>
                        <div className="relative w-1/2">
                          <input 
                            type="date"
                            value={endDate}
                            min={filterOptions.minDate}
                            max={filterOptions.maxDate}
                            onChange={e => setEndDate(e.target.value)}
                            className="w-full px-2 py-1.5 text-[9px] font-mono font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
                          />
                          {!endDate && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-bold pointer-events-none">
                              إلى تاريخ
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <button 
                      onClick={() => {
                        setVisibleFilterSections(prev => prev.filter(id => id !== sectionId));
                        if (sectionId === 'item') setSelectedItemIdFilter('all');
                        if (sectionId === 'session') setSelectedSessionIdFilter('all');
                        if (sectionId === 'date') { setStartDate(''); setEndDate(''); }
                      }}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Group Auditor and Streak filters vertically if visible */}
          {(visibleFilterSections.includes('auditor') || visibleFilterSections.includes('streak')) && (
            <div className="flex flex-col gap-2">
              {visibleFilterSections.includes('auditor') && (
                <div className="w-full bg-slate-50/50 border border-slate-100 rounded-xl p-2 relative group flex items-center">
                  <div className="flex flex-1 items-center gap-2">
                    <div className="w-full">
                      <select
                        value={selectedAuditor}
                        onChange={e => setSelectedAuditor(e.target.value)}
                        className="w-full px-2 py-1.5 text-[9px] font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer text-slate-700 truncate"
                      >
                        <option value="all">كل أمناء المخازن</option>
                        {filterOptions.auditors.map(auditor => (
                          <option key={auditor.code} value={auditor.code}>{auditor.name}</option>
                        ))}
                      </select>
                    </div>
                    <button 
                      onClick={() => {
                        setVisibleFilterSections(prev => prev.filter(id => id !== 'auditor'));
                        setSelectedAuditor('all');
                      }}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {visibleFilterSections.includes('streak') && (
                <div className="w-full bg-slate-50/50 border border-slate-100 rounded-xl p-2 relative group flex items-center">
                  <div className="flex flex-1 items-center gap-2">
                    <div className="w-full">
                      <select
                        value={streakFilter}
                        onChange={e => setStreakFilter(e.target.value as any)}
                        className="w-full px-2 py-1.5 text-[9px] font-bold bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer text-rose-700 font-extrabold truncate"
                      >
                        <option value="all">كل الأصناف دون تصفية</option>
                        <option value="persistent">⚠️ انحراف مستمر</option>
                        <option value="new">🆕 انحراف حديث</option>
                      </select>
                    </div>
                    <button 
                      onClick={() => {
                        setVisibleFilterSections(prev => prev.filter(id => id !== 'streak'));
                        setStreakFilter('all');
                      }}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 📂 Unified Dashboard Content Renderer */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-4 min-h-0 mt-1">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: Item review with horizontal scroll fix & expandable inline history */}
          {activeSubTab === "items" && (
            <motion.div
              key="items_tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-slate-800">قائمة اصناف وتواريخ الجرد والتعديلات</h3>
                  </div>
                  <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                    عدد {itemsDashboardData.length} صنف
                  </span>
                </div>

                {/* Main Table with horizontal scroll container explicitly defined */}
                <div className="w-full overflow-x-auto scrollbar-thin border border-slate-200 rounded-2xl bg-white shadow-2xs">
                  <table className="w-full text-right text-[11px] font-sans border-collapse min-w-[850px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-slate-600 font-black h-9">
                        <th className="pr-4 py-1.5 w-10 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (expandedItemIds.length === itemsDashboardData.length && itemsDashboardData.length > 0) {
                                setExpandedItemIds([]);
                              } else {
                                setExpandedItemIds(itemsDashboardData.map(item => item.itemId));
                              }
                            }}
                            className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded outline-none"
                            title={expandedItemIds.length === itemsDashboardData.length && itemsDashboardData.length > 0 ? "طي الكل" : "توسيع الكل"}
                          >
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedItemIds.length === itemsDashboardData.length && itemsDashboardData.length > 0 ? 'rotate-180' : ''}`} />
                          </button>
                        </th>
                        <th className="px-3 py-1.5 w-24">كود الصنف</th>
                        <th className="px-3 py-1.5 min-w-[380px] text-right">اسم ووصف الصنف</th>
                        <th className="px-3 py-1.5 w-20 text-center">عدد الجرد</th>
                        <th className="px-3 py-1.5 w-24 text-center">تعديلات الأمين</th>
                        <th className="px-3 py-1.5 w-24 text-center">تعديلات المشرفين</th>
                        <th className="px-3 py-1.5 w-24 text-center">تعديلات المسؤول</th>
                        <th className="px-3 py-1.5 w-24 text-center">اجمالي التعديلات</th>
                        <th className="px-3 py-1.5 w-24 text-center">دفترى حالي</th>
                        <th className="px-3 py-1.5 w-24 text-center">معتمد حالي</th>
                        <th className="px-3 py-1.5 w-24 text-center">فرق جرد حالي</th>
                        <th className="px-3 py-1.5 w-24 text-center">فرق سابق</th>
                        <th className="pl-4 py-1.5 w-24 text-center">اجمالى الانحراف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsDashboardData.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="text-center py-8 text-slate-400 font-bold">لا توجد نتائج تطابق خيارات التصفية أو ترشيح ثبات الانحرافات الحالي</td>
                        </tr>
                      ) : (
                        itemsDashboardData.map(item => {
                          const isExpanded = expandedItemIds.includes(item.itemId);
                          return (
                            <React.Fragment key={item.itemId}>
                              {/* Parent Row */}
                              <tr 
                                onClick={() => toggleItemExpand(item.itemId)}
                                className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors h-9 ${
                                  isExpanded ? "bg-indigo-50/30 font-extrabold" : ""
                                }`}
                              >
                                <td className="pr-4 py-1 text-center text-slate-400">
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-indigo-600" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                                </td>
                                <td className="px-3 py-1 font-mono text-[10px] text-slate-500 font-bold flex flex-col gap-0.5 mt-1">
                                  <span>{item.itemId}</span>
                                  {item.sessionName && <span className="text-[8px] bg-slate-100 text-slate-400 px-1 py-0.5 rounded leading-none whitespace-nowrap self-start max-w-[80px] truncate">{item.sessionName}</span>}
                                </td>
                                <td className="px-3 py-1 text-slate-800 font-extrabold whitespace-nowrap text-right" title={item.name}>
                                  {item.name}
                                </td>
                                <td className="px-3 py-1 text-center text-slate-700 font-mono font-bold">
                                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px]">{item.totalChecks}</span>
                                </td>
                                
                                <td className="px-3 py-1 text-center">
                                  <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded text-[10px] font-black">{item.totalStorekeeperModifications}</span>
                                </td>
                                <td className="px-3 py-1 text-center">
                                  <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-black">{item.supervisorCorrectionsCount}</span>
                                </td>
                                <td className="px-3 py-1 text-center">
                                  <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded text-[10px] font-black">{item.managerCorrectionsCount}</span>
                                </td>
                                <td className="px-3 py-1 text-center">
                                  <span className="bg-slate-50 text-slate-600 px-2 py-0.5 rounded text-[10px] font-black">{item.totalStorekeeperModifications + item.supervisorCorrectionsCount + item.managerCorrectionsCount}</span>
                                </td>
                                <td className="px-3 py-1 text-center text-slate-700 font-mono font-bold">
                                  {item.history.length > 0 ? item.history[0].book : "—"}
                                </td>
                                <td className="px-3 py-1 text-center text-slate-700 font-mono font-bold">
                                  {item.history.length > 0 ? item.history[0].physical : "—"}
                                </td>

                                {/* Discrepancy persistence indicators */}
                                <td className={`px-3 py-1 text-center font-mono font-black ${
                                  item.latestDiff > 0 ? "text-emerald-600" : item.latestDiff < 0 ? "text-rose-600" : "text-slate-400"
                                }`}>
                                  {item.latestDiff > 0 ? `+${item.latestDiff}` : item.latestDiff}
                                </td>

                                <td className="px-3 py-1 text-center">
                                  {item.history.length > 1 ? (
                                    <span className={`text-[10px] font-mono font-bold ${
                                      item.history[1].diff > 0 ? "text-emerald-600" : item.history[1].diff < 0 ? "text-rose-600" : "text-slate-400"
                                    }`}>
                                      {item.history[1].diff > 0 ? `+${item.history[1].diff}` : item.history[1].diff}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-300">—</span>
                                  )}
                                </td>

                                <td className="pl-4 py-1 text-center text-rose-600 font-mono font-black">
                                  {item.absoluteDiscrepancy}
                                </td>
                              </tr>

                              {/* Expanded Historical Timeline Row */}
                              <AnimatePresence initial={false}>
                                {isExpanded && (
                                  <tr>
                                    <td colSpan={13} className="bg-slate-50/75 p-0 border-b border-slate-150">
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden px-4 py-2 space-y-2"
                                      >
                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-1">
                                          <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-2">
                                              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                                              <span className="text-[10px] font-black text-slate-800">التسلسل الزمني للجرد:</span>
                                            </div>
                                            <div className="text-[9px] font-extrabold text-slate-500 flex gap-4">
                                              <span>تعديلات الأمين: <b className="text-orange-600">{item.totalStorekeeperModifications}</b></span>
                                              <span>تعديلات المشرفين: <b className="text-indigo-600">{item.supervisorCorrectionsCount}</b></span>
                                              <span>تعديلات المسؤول: <b className="text-rose-600">{item.managerCorrectionsCount}</b></span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* History list on daily level */}
                                        <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin">
                                          {item.history.map((h: any, hidx: number) => {
                                            const prevDiff = item.history[hidx + 1]?.diff;
                                            return (
                                              <div 
                                                key={hidx} 
                                                className="bg-white px-3 py-1.5 rounded-lg border border-slate-150 flex items-center justify-between text-[10px] hover:bg-slate-50/50 transition-colors"
                                              >
                                                <div className="flex items-center gap-3">
                                                  <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center gap-2">
                                                      <span className="font-mono text-[9px] text-indigo-950 font-black flex items-center gap-1">
                                                        <Clock className="w-3 h-3 text-slate-400" />
                                                        {h.displayDate || h.date}
                                                      </span>
                                                      <span className="font-mono text-[7.5px] text-slate-500 font-bold opacity-70">
                                                        ({new Date(h.date).toLocaleString('ar-EG', {
                                                          year: 'numeric',
                                                          month: 'numeric',
                                                          day: 'numeric',
                                                          hour: '2-digit',
                                                          minute: '2-digit',
                                                          hour12: true
                                                        })})
                                                      </span>
                                                    </div>
                                                    <span className="text-slate-400 font-bold truncate max-w-[120px]" title={h.sessionName}>
                                                      {h.sessionName}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                      {h.versionNumber && (
                                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-150 px-1.5 py-0.5 rounded text-[8px] font-black leading-none shrink-0 w-fit" title={`نسخة جرد رقم ${h.versionNumber}`}>
                                                          نسخة: {h.versionNumber}
                                                        </span>
                                                      )}
                                                      {h.sessionId && (
                                                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-150 px-1.5 py-0.5 rounded text-[8px] font-black leading-none shrink-0 w-fit" title={`المعرف الفريد للجلسة: ${h.sessionId}`}>
                                                          ID: {h.sessionId}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                                
                                                <div className="flex-1 flex items-center justify-between gap-4 mr-4">
                                                  <div className="flex items-center gap-3 min-w-[240px]">
                                                    <div className="flex flex-col items-start gap-0.5 shrink-0 border-l border-slate-100 pl-3">
                                                      <span className="text-slate-400 text-[8px]">مسئول الجرد</span>
                                                      <b className="text-slate-700 truncate max-w-[100px] leading-tight text-[10px]">{h.auditor}</b>
                                                    </div>
                                                    
                                                    {(h.note || h.modification || h.isSupervisorCorrection || (h.modifications && h.modifications.length > 0)) && (
                                                      <div className="flex items-center gap-1 overflow-hidden flex-wrap">
                                                        {(h.note || h.modification) && (
                                                          <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 truncate max-w-[120px] text-[8px]" title={h.note || h.modification}>
                                                            {h.note || h.modification}
                                                          </span>
                                                        )}
                                                        
                                                        {/* Detailed Modification History */}
                                                        {h.modifications && h.modifications.map((m: any, midx: number) => {
                                                          const userColors = getUserColorClasses(m.modifier);
                                                          return (
                                                            <button 
                                                              key={midx} 
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedModDetails({
                                                                  modifier: m.modifier,
                                                                  role: m.modifierRole || "أمين مخزن",
                                                                  date: m.timestamp,
                                                                  oldQty: m.oldQty !== undefined ? m.oldQty : null,
                                                                  newQty: m.newQty !== undefined ? m.newQty : null,
                                                                  itemName: item.name,
                                                                  sessionName: m.sessionName || h.sessionName,
                                                                  sessionId: m.sessionId || h.sessionId,
                                                                  sessionDate: m.sessionDate || h.sessionDate,
                                                                  versionNumber: m.versionNumber || h.versionNumber
                                                                });
                                                              }}
                                                              className={`px-1 py-0.5 rounded border text-[7.5px] font-extrabold flex items-center gap-0.5 transition-all hover:scale-105 active:scale-95 cursor-pointer leading-none shadow-3xs ${userColors.bg}`}
                                                              title={`تعديل بواسطة: ${m.modifier} (${m.modifierRole || "أمين مخزن"}) - اضغط للتفاصيل`}
                                                            >
                                                              <span className="opacity-75">{m.modifier}:</span>
                                                              <span className="font-mono font-black">{m.newQty}</span>
                                                            </button>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                  </div>

                                                  <div className="flex items-center gap-6 text-center ml-2 shrink-0">
                                                    <div className="w-12 text-center">
                                                      <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">دفتري</div>
                                                      <div className="font-mono font-black text-[10px]">{h.book}</div>
                                                    </div>
                                                    <div className="w-12 text-center">
                                                      <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">جرد</div>
                                                      <div className="font-mono font-black text-[10px]">{h.storekeeper ?? "—"}</div>
                                                    </div>
                                                    <div className="w-12 text-center">
                                                      <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">معتمد</div>
                                                      <div className="font-mono font-black text-[10px]">{h.physical}</div>
                                                    </div>
                                                    <div className="w-14 text-center">
                                                      <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">الفرق</div>
                                                      <div className={`font-mono font-black text-[10px] px-1 py-0.5 rounded ${
                                                        h.diff > 0 
                                                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                                          : h.diff < 0 
                                                            ? "bg-rose-50 text-rose-700 border border-rose-100" 
                                                            : "bg-slate-100 text-slate-500"
                                                      }`}>
                                                        {h.diff > 0 ? `+${h.diff}` : h.diff}
                                                      </div>
                                                    </div>
                                                    <div className="w-14 text-center">
                                                      <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">فرق سابق</div>
                                                      <div className={`font-mono font-bold text-[9px] ${
                                                        prevDiff !== undefined 
                                                          ? (prevDiff > 0 ? "text-emerald-600" : prevDiff < 0 ? "text-rose-600" : "text-slate-400")
                                                          : "text-slate-300"
                                                      }`}>
                                                        {prevDiff !== undefined ? (prevDiff > 0 ? `+${prevDiff}` : prevDiff) : "—"}
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </motion.div>
                                    </td>
                                  </tr>
                                )}
                              </AnimatePresence>
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: Human resources performance (Storekeepers & Supervisors split) */}
          {activeSubTab === "auditors" && (
            <motion.div
              key="auditors_tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Inner sub-tab selectors */}
              <div className="flex gap-2 border-b border-slate-100 pb-2">
                <button
                  onClick={() => setActiveStaffSubTab("storekeepers")}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black transition-all cursor-pointer flex items-center gap-2 ${
                    activeStaffSubTab === "storekeepers"
                      ? "bg-indigo-600 text-white shadow-3xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  امناء المخازن 👤
                </button>
                <button
                  onClick={() => setActiveStaffSubTab("supervisors")}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black transition-all cursor-pointer flex items-center gap-2 ${
                    activeStaffSubTab === "supervisors"
                      ? "bg-indigo-600 text-white shadow-3xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Award className="w-4 h-4" />
                  مشرفين المخازن 👑
                </button>
              </div>

              {/* SECTION A: Storekeepers performance list */}
              {activeStaffSubTab === "storekeepers" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-slate-700">تقييم أداء الأمناء الميداني</h3>
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                      عدد {auditorsDashboardData.length} أمناء
                    </span>
                  </div>

                  {/* Horizontal Scroll wrapper */}
                  <div className="w-full overflow-x-auto scrollbar-thin border border-slate-200 rounded-2xl bg-white shadow-2xs">
                    <table className="w-full text-right text-[11px] font-sans border-collapse min-w-[850px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-slate-600 font-black h-11">
                          <th className="pr-4 py-2 w-10 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (expandedAuditorCodes.length === auditorsDashboardData.length && auditorsDashboardData.length > 0) {
                                  setExpandedAuditorCodes([]);
                                } else {
                                  setExpandedAuditorCodes(auditorsDashboardData.map(a => a.code));
                                }
                              }}
                              className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded outline-none"
                              title={expandedAuditorCodes.length === auditorsDashboardData.length && auditorsDashboardData.length > 0 ? "طي الكل" : "توسيع الكل"}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedAuditorCodes.length === auditorsDashboardData.length && auditorsDashboardData.length > 0 ? 'rotate-180' : ''}`} />
                            </button>
                          </th>
                          <th className="px-3 py-2 w-28">كود الأمين</th>
                          <th className="px-3 py-2 min-w-[200px]">الاسم الكامل</th>
                          <th className="px-3 py-2 w-32 text-center">الورديات المعتمدة</th>
                          <th className="px-3 py-2 w-28 text-center">الأصناف المسندة</th>
                          <th className="px-3 py-2 w-32 text-center">أصناف تم مراجعتها</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات الأمين</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات المشرفين</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات المسؤول</th>
                          <th className="px-3 py-2 w-32 text-center">اجمالي التعديلات</th>
                          <th className="pl-4 py-2 w-40 text-center">معامل مطابقة الجرد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditorsDashboardData.length === 0 ? (
                           <tr>
                             <td colSpan={11} className="text-center py-12 text-slate-400 font-bold">لا يوجد أمناء جرد مسجلين أو جرد متاح لهذه الفترة</td>
                           </tr>
                        ) : (
                           auditorsDashboardData.map(auditor => {
                             const isExpanded = expandedAuditorCodes.includes(auditor.code);
                             return (
                               <React.Fragment key={auditor.code}>
                                 <tr 
                                   onClick={() => toggleAuditorExpand(auditor.code)}
                                   className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors h-12 ${
                                     isExpanded ? "bg-indigo-50/30 font-extrabold" : ""
                                   }`}
                                 >
                                   <td className="pr-4 py-2 text-center text-slate-400">
                                     {isExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                   </td>
                                   <td className="px-3 py-2 font-mono text-[10px] text-slate-500 font-bold">{auditor.code}</td>
                                   <td className="px-3 py-2 text-slate-800 font-bold">{auditor.name}</td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-indigo-950">{auditor.totalShifts} ورديات</td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-slate-700">{auditor.totalAssigned} صنفاً</td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">{auditor.recheckedItemsCount}</td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-orange-600">
                                     <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-orange-100">
                                       {auditor.totalStorekeeperModifications}
                                     </span>
                                   </td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">
                                     <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-indigo-100">
                                       {auditor.totalSupervisorCorrections}
                                     </span>
                                   </td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-rose-600">
                                     <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-rose-100">
                                       {auditor.totalManagerCorrections}
                                     </span>
                                   </td>
                                   <td className="px-3 py-2 text-center font-mono font-bold text-slate-600">
                                     <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-slate-100">
                                       {auditor.totalStorekeeperModifications + auditor.totalSupervisorCorrections + auditor.totalManagerCorrections}
                                     </span>
                                   </td>
                                   <td className="pl-4 py-2 text-center">
                                     <div className="flex items-center justify-center gap-2">
                                       <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                                         <div 
                                           className={`h-full ${
                                             auditor.recountMatchRate >= 85 
                                               ? "bg-emerald-500" 
                                               : auditor.recountMatchRate >= 60 
                                                 ? "bg-amber-500" 
                                                 : "bg-rose-500"
                                           }`} 
                                           style={{ width: `${auditor.recountMatchRate}%` }} 
                                         />
                                       </div>
                                       <span className="font-mono font-black text-slate-800">{auditor.recountMatchRate}%</span>
                                     </div>
                                   </td>
                                 </tr>

                                  {/* Expandable Row: Auditor Assigned Items List (CRITICAL USER REQUEST) */}
                                  <AnimatePresence initial={false}>
                                    {isExpanded && (
                                      <tr>
                                        <td colSpan={13} className="bg-slate-50/75 p-0 border-b border-slate-150">
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: "auto", opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="overflow-hidden px-6 py-4 space-y-4"
                                        >
                                          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                                            <ClipboardList className="w-4 h-4 text-indigo-600" />
                                            <span className="text-xs font-black text-slate-800">سجل النشاط اليومي التفصيلي للامناء</span>
                                          </div>

                                          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                                            {auditor.dailyHistory.map((day: any, hidx: number) => (
                                              <div 
                                                key={hidx} 
                                                className="bg-white px-4 py-2 rounded-lg border border-slate-150 flex items-center justify-between text-[11px] hover:bg-slate-50/50 transition-colors"
                                              >
                                                <div className="flex items-center gap-4">
                                                  {/* Right Part: Date & Session */}
                                                  <div className="flex items-center gap-3 min-w-[130px] shrink-0">
                                                    <span className="font-mono text-[10.5px] text-indigo-950 font-black flex items-center gap-1">
                                                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                      {day.date}
                                                    </span>
                                                    <span className="text-slate-400 font-bold truncate max-w-[100px]">
                                                      {day.sessionName}
                                                    </span>
                                                  </div>

                                                  {/* Middle Part: Notes & Status */}
                                                  <div className="flex items-center gap-3 overflow-hidden">
                                                    {day.notes && (
                                                      <div className="min-w-[120px] max-w-[220px] shrink-0">
                                                        <div className="text-[7px] text-amber-500 font-black leading-none mb-0.5">الملاحظات</div>
                                                        <div className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 text-[8.5px] leading-tight truncate" title={day.notes}>
                                                          {day.notes}
                                                        </div>
                                                      </div>
                                                    )}

                                                    <div className="shrink-0 flex flex-col gap-1">
                                                      {day.rechecksCount > 0 ? (
                                                        <div className="flex flex-col gap-0.5">
                                                          <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded text-[9px] font-black border border-rose-100 whitespace-nowrap self-start">
                                                            تمت اعادة جرد {day.rechecksCount} صنف باجمالي تعديلات {day.totalStorekeeperModifications + day.totalSupervisorCorrections + day.totalManagerCorrections} صنف
                                                          </span>
                                                        </div>
                                                      ) : (
                                                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-bold border border-emerald-100 whitespace-nowrap">
                                                          ✓ لم يستدعِ أي تعديل من المشرف
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>

                                                {/* Left Part: Stats */}
                                                <div className="flex items-center gap-4 text-slate-500 font-medium shrink-0">
                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">الأصناف المجرودة</div>
                                                    <div className="font-mono font-black text-[10px] text-slate-700">{day.totalItems}</div>
                                                  </div>
                                                  
                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات الأمين</div>
                                                    <div className="font-mono font-black text-[10px] text-orange-600">{day.totalStorekeeperModifications}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات المشرفين</div>
                                                    <div className="font-mono font-black text-[10px] text-indigo-600">{day.totalSupervisorCorrections}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات المسئول</div>
                                                    <div className="font-mono font-black text-[10px] text-rose-600">{day.totalManagerCorrections}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">انحرافات اليوم</div>
                                                    <div className="font-mono font-black text-[10px] text-rose-600">{day.totalVariance}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </motion.div>
                                      </td>
                                    </tr>
                                  )}
                                </AnimatePresence>
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SECTION B: Supervisors performance list (CRITICAL USER REQUEST) */}
              {activeStaffSubTab === "supervisors" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-slate-700">مشرفين المخازن</h3>
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                      عدد {supervisorStats.length} مشرف
                    </span>
                  </div>

                  {/* Horizontal Scroll wrapper */}
                  <div className="w-full overflow-x-auto scrollbar-thin border border-slate-200 rounded-2xl bg-white shadow-2xs">
                    <table className="w-full text-right text-[11px] font-sans border-collapse min-w-[850px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-slate-600 font-black h-11">
                          <th className="pr-4 py-2 w-10 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (expandedSupervisorNames.length === supervisorStats.length && supervisorStats.length > 0) {
                                  setExpandedSupervisorNames([]);
                                } else {
                                  setExpandedSupervisorNames(supervisorStats.map(s => s.name));
                                }
                              }}
                              className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded outline-none"
                              title={expandedSupervisorNames.length === supervisorStats.length && supervisorStats.length > 0 ? "طي الكل" : "توسيع الكل"}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedSupervisorNames.length === supervisorStats.length && supervisorStats.length > 0 ? 'rotate-180' : ''}`} />
                            </button>
                          </th>
                          <th className="px-3 py-2 w-28">كود المشرف</th>
                          <th className="px-3 py-2 min-w-[200px]">الاسم الكامل</th>
                          <th className="px-3 py-2 w-32 text-center">الورديات المعتمدة</th>
                          <th className="px-3 py-2 w-32 text-center">الأصناف المسندة</th>
                          <th className="px-3 py-2 w-32 text-center">أصناف تم مراجعتها</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات الأمين</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات المشرفين</th>
                          <th className="px-3 py-2 w-32 text-center">تعديلات المسؤول</th>
                          <th className="px-3 py-2 w-32 text-center">اجمالي التعديلات</th>
                          <th className="pl-4 py-2 w-40 text-center">مؤشر جودة الإشراف</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supervisorStats.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="text-center py-12 text-slate-400 font-bold">لم يتم تسجيل أي اعتماد رسمي من قبل مشرفي المخازن حتى الآن</td>
                          </tr>
                        ) : (
                          supervisorStats.map(sup => {
                            const isExpanded = expandedSupervisorNames.includes(sup.name);
                            return (
                              <React.Fragment key={sup.name}>
                                <tr 
                                  onClick={() => toggleSupervisorExpand(sup.name)}
                                  className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors h-12 ${
                                    isExpanded ? "bg-indigo-50/30 font-extrabold" : ""
                                  }`}
                                >
                                  <td className="pr-4 py-2 text-center text-slate-400">
                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 font-bold">{sup.code}</td>
                                  <td className="px-3 py-2 text-slate-800 font-bold">{sup.name}</td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-indigo-950">{sup.totalSessionsApproved} ورديات</td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-slate-700">{sup.totalItemsVerified} صنفاً</td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">{sup.recountsPerformed}</td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-orange-600">
                                    <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-orange-100">
                                      {sup.totalStorekeeperModifications}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-indigo-600">
                                    <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-indigo-100">
                                      {sup.totalSupervisorCorrections}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-rose-600">
                                    <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-rose-100">
                                      {sup.totalManagerCorrections}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-slate-600">
                                    <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-slate-100">
                                      {sup.totalStorekeeperModifications + sup.totalSupervisorCorrections + sup.totalManagerCorrections}
                                    </span>
                                  </td>
                                  <td className="pl-4 py-2 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                      <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                                        <div 
                                          className={`h-full ${
                                            sup.qualityScore >= 80 
                                              ? "bg-emerald-500" 
                                              : sup.qualityScore >= 50 
                                                ? "bg-amber-500" 
                                                : "bg-rose-500"
                                          }`} 
                                          style={{ width: `${sup.qualityScore}%` }} 
                                        />
                                      </div>
                                      <span className="font-mono font-black text-slate-800">{sup.qualityScore}%</span>
                                    </div>
                                  </td>
                                </tr>

                                {/* Expandable Row: Supervisor Shift Log details (CRITICAL USER REQUEST) */}
                                <AnimatePresence initial={false}>
                                  {isExpanded && (
                                    <tr>
                                      <td colSpan={10} className="bg-slate-50/75 p-0 border-b border-slate-150">
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: "auto", opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="overflow-hidden px-6 py-4 space-y-4"
                                        >
                                          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                                            <Shield className="w-4 h-4 text-indigo-600" />
                                            <span className="text-xs font-black text-slate-800">سجل النشاط اليومي التفصيلي للمشرفين</span>
                                          </div>

                                          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                                            {sup.dailyHistory.map((day: any, hidx: number) => (
                                              <div 
                                                key={hidx} 
                                                className="bg-white px-4 py-2 rounded-lg border border-slate-150 flex items-center justify-between text-[11px] hover:bg-slate-50/50 transition-colors"
                                              >
                                                <div className="flex items-center gap-4">
                                                  {/* Right Part: Date & Session */}
                                                  <div className="flex items-center gap-3 min-w-[130px] shrink-0">
                                                    <span className="font-mono text-[10.5px] text-indigo-950 font-black flex items-center gap-1">
                                                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                      {day.date}
                                                    </span>
                                                    <span className="text-slate-400 font-bold truncate max-w-[100px]">
                                                      {day.sessionName}
                                                    </span>
                                                  </div>

                                                  {/* Middle Part: Notes & Status */}
                                                  <div className="flex items-center gap-3 overflow-hidden">
                                                    {day.notes && (
                                                      <div className="min-w-[120px] max-w-[220px] shrink-0">
                                                        <div className="text-[7px] text-amber-500 font-black leading-none mb-0.5">الملاحظات</div>
                                                        <div className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 text-[8.5px] leading-tight truncate" title={day.notes}>
                                                          {day.notes}
                                                        </div>
                                                      </div>
                                                    )}

                                                    <div className="shrink-0">
                                                      {day.recountsCount > 0 ? (
                                                        <div className="flex flex-col gap-0.5">
                                                          <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[9px] font-black border border-amber-100 whitespace-nowrap">
                                                            تمت اعادة جرد {day.recountsCount} صنف باجمالي تعديلات {day.totalStorekeeperModifications + day.totalSupervisorCorrections + day.totalManagerCorrections}
                                                          </span>
                                                          {/* Detailed supervisor mods if available (Show only supervisor mods as per user request) */}
                                                          {day.totalSupervisorCorrections > 0 && (
                                                            <div className="flex flex-wrap gap-1 max-w-[300px]">
                                                              {sup.history
                                                                .filter((h: any) => h.date === day.date && h.sessionName === day.sessionName && h.totalSupervisorCorrections > 0)
                                                                .map((h: any, midx: number) => (
                                                                  <span key={midx} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1 rounded text-[7px] font-bold">
                                                                    {h.storekeeper} ➔ {h.supervisor}
                                                                  </span>
                                                                ))}
                                                            </div>
                                                          )}
                                                        </div>
                                                      ) : (
                                                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-bold border border-emerald-100 whitespace-nowrap">
                                                          ✓ تطابق فوري وتصديق مع الأمناء
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>

                                                {/* Left Part: Stats */}
                                                <div className="flex items-center gap-4 text-slate-500 font-medium shrink-0">
                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">الأصناف المدققة</div>
                                                    <div className="font-mono font-black text-[10px] text-slate-700">{day.totalItems}</div>
                                                  </div>
                                                  
                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات الأمين</div>
                                                    <div className="font-mono font-black text-[10px] text-orange-600">{(day as any).totalStorekeeperModifications || 0}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات المشرفين</div>
                                                    <div className="font-mono font-black text-[10px] text-indigo-600">{(day as any).totalSupervisorCorrections || 0}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">تعديلات المسئول</div>
                                                    <div className="font-mono font-black text-[10px] text-rose-600">{(day as any).totalManagerCorrections || 0}</div>
                                                  </div>

                                                  <div className="w-16 text-center">
                                                    <div className="text-[7px] text-slate-400 font-bold leading-none mb-0.5">انحرافات الوردية</div>
                                                    <div className="font-mono font-black text-[10px] text-rose-600">{day.totalVariance}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </motion.div>
                                      </td>
                                    </tr>
                                  )}
                                </AnimatePresence>
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 3: Category Breakdowns & Daily Timeline with inline expansion */}
          {activeSubTab === "general" && (
            <motion.div
              key="general_tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* Daily Timeline breakdown with Expandable Items (CRITICAL USER REQUEST) */}
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-sm font-black text-slate-800">جدولة ومراجعة الجرد التفصيلي اليومي (Daily Timeline)</h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">💡 اضغط على التاريخ لتوسيع الأصناف والعمليات المجرودة في هذا اليوم بالتفصيل</p>
                </div>

                <div className="w-full overflow-x-auto scrollbar-thin border border-slate-200 rounded-2xl bg-white shadow-2xs">
                  <table className="w-full text-right text-[11px] font-sans border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-slate-600 font-black h-11">
                        <th className="pr-4 py-2 w-10 text-center"></th>
                        <th className="px-3 py-2 w-32">تاريخ اليوم المجرود</th>
                        <th className="px-3 py-2 w-32 text-center">عمليات الفحص اليومية</th>
                        <th className="px-3 py-2 w-32 text-center">الانحرافات المكتشفة</th>
                        <th className="px-3 py-2 w-32 text-center">إجمالي فارق الكمية اليومي</th>
                        <th className="pl-4 py-2 text-center">الرصد الإحصائي العام</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generalDashboardData.timeline.map(time => {
                        const isExpanded = expandedTimelineDates.includes(time.id);
                        return (
                          <React.Fragment key={time.id}>
                            <tr 
                              onClick={() => toggleTimelineExpand(time.id)}
                              className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors h-12 ${
                                isExpanded ? "bg-indigo-50/30 font-extrabold" : ""
                              }`}
                            >
                              <td className="pr-4 py-2 text-center text-slate-400">
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                              </td>
                              <td className="px-3 py-2 text-indigo-950 font-black flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-slate-400" />
                                <div className="flex flex-col">
                                  <span className="font-mono text-[11px]">{time.date}</span>
                                  {time.sessionName && <span className="text-[9px] text-slate-400 font-sans tracking-tight">{time.sessionName}</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-bold text-slate-700">{time.count} أصناف</td>
                              <td className="px-3 py-2 text-center">
                                <span className="bg-rose-50 text-rose-700 px-2.5 py-0.5 rounded-full text-[10px] font-black border border-rose-100 font-mono">
                                  {time.discrepancyCount} اختلافات
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-bold text-slate-600">{time.variance} وحدة</td>
                              <td className="pl-4 py-2 text-right">
                                <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${
                                  time.net >= 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"
                                }`}>
                                  صافي الوردية: {time.net >= 0 ? `+${time.net}` : time.net}
                                </span>
                              </td>
                            </tr>

                            {/* Expanded Timeline details (CRITICAL USER REQUEST) */}
                            <AnimatePresence initial={false}>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={6} className="bg-slate-50/75 p-0 border-b border-slate-150">
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden px-6 py-4 space-y-4"
                                    >
                                      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                                        <Package className="w-4 h-4 text-indigo-600" />
                                        <span className="text-xs font-black text-slate-800 font-sans">تفاصيل جرد الأصناف اليومي والعمليات المقيدة</span>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto scrollbar-thin pl-1 text-right">
                                        {time.itemsList.map((item: any, idx: number) => (
                                          <div key={idx} className="bg-white p-3 rounded-xl border border-slate-150 flex items-center justify-between text-[11px] font-sans hover:bg-slate-50/50 transition-colors">
                                            <div className="space-y-0.5 min-w-0">
                                              <span className="font-mono text-[9px] text-indigo-950 font-black block">كود: {item.itemId}</span>
                                              <h4 className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</h4>
                                              <span className="text-[9px] text-slate-400 block font-bold">بواسطة: {item.auditor}</span>
                                            </div>
                                            <div className="text-left shrink-0 font-mono font-bold">
                                              <div className="flex items-center gap-1.5 justify-end">
                                                <span className="text-slate-400 text-[10px]">الدفتر: {item.book}</span>
                                                <span className="text-slate-300">➔</span>
                                                <span className="text-indigo-950 font-extrabold">الفعلي: {item.physical}</span>
                                              </div>
                                              <span className={`text-[10px] font-black block mt-0.5 ${
                                                item.diff === 0 
                                                  ? "text-slate-500" 
                                                  : item.diff > 0 
                                                    ? "text-emerald-600" 
                                                    : "text-rose-600"
                                              }`}>
                                                {item.diff === 0 ? "✓ متطابق" : item.diff > 0 ? `+${item.diff} زيادة` : `${item.diff} عجز`}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </motion.div>
                                  </td>
                                </tr>
                              )}
                            </AnimatePresence>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: Smart AI & Predictive Analytics Dashboard (Power BI Style) */}
          {activeSubTab === "smart_analytics" && (
            <motion.div
              key="smart_analytics_tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6 font-sans text-right"
              dir="rtl"
            >
              {/* Header Card */}
              <div className="bg-linear-to-r from-indigo-950 via-slate-900 to-indigo-900 p-6 rounded-3xl border border-indigo-900/40 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 px-3 py-1 rounded-full text-[10px] font-black tracking-wider flex items-center gap-1.5 shadow-3xs animate-pulse">
                        <Sparkles className="w-3.5 h-3.5" />
                        نظام التحليل الإحصائي والتنبؤ المدعوم بالذكاء الاصطناعي
                      </span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-none text-transparent bg-clip-text bg-linear-to-r from-white via-indigo-100 to-emerald-200">
                      لوحة تقييم الجرد ومكافحة الانحرافات الذكية
                    </h2>
                    <p className="text-xs text-indigo-200/80 font-medium leading-relaxed max-w-2xl">
                      يستخدم هذا النظام تتبعاً تاريخياً مستمراً للأصناف والأفراد لعزل الانحرافات النظامية والمخالفات الدورية (مثل عجز الإنتاج والتنزيل) عن الأخطاء البشرية الحقيقية في الجرد، لتوفير تقييم ذكي وعادل دائم للأمناء والمشرفين.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl border border-white/10 text-xs font-bold font-mono text-emerald-300 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      مؤشر استقرار المستودع: {
                        smartAnalyticsData.storekeeperEvaluations.length > 0 
                          ? `${Math.round(smartAnalyticsData.storekeeperEvaluations.reduce((acc, curr) => acc + curr.score, 0) / smartAnalyticsData.storekeeperEvaluations.length)}%` 
                          : "100%"
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Power BI KPI Dashboard Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Overall Accuracy */}
                <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between h-[115px]">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-50 rounded-full blur-2xl pointer-events-none group-hover:bg-emerald-100/50 transition-colors" />
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-455 font-black">معدل دقة الجرد الإجمالي</span>
                    <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-black text-slate-800 leading-none">
                        {smartAnalyticsData.globalMetrics.accuracyTrend.length > 0 
                          ? `${smartAnalyticsData.globalMetrics.accuracyTrend[smartAnalyticsData.globalMetrics.accuracyTrend.length - 1].accuracy}%`
                          : "92%"
                        }
                      </span>
                      <span className="text-[9px] font-black text-emerald-600 bg-emerald-50/80 px-1.5 py-0.5 rounded">مستقر</span>
                    </div>
                    <p className="text-[9px] text-slate-400 font-bold mt-1">تتبع تاريخي لـ {smartAnalyticsData.globalMetrics.totalSessions} جلسات جردية متعاقبة</p>
                  </div>
                </div>

                {/* Card 2: Total Items */}
                <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between h-[115px]">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-50 rounded-full blur-2xl pointer-events-none group-hover:bg-indigo-100/50 transition-colors" />
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-455 font-black">إجمالي الأصناف المقيمة</span>
                    <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                      <Package className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-black text-slate-800 leading-none">
                        {smartAnalyticsData.globalMetrics.totalEvaluatedItems}
                      </span>
                      <span className="text-[9px] text-slate-400 font-bold">صنف فرعي</span>
                    </div>
                    <p className="text-[9px] text-indigo-500 font-bold mt-1">تم إخضاعها بالكامل للتحليل وتصفية القيم الشاذة</p>
                  </div>
                </div>

                {/* Card 3: Systemic Excused */}
                <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between h-[115px]">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-blue-50 rounded-full blur-2xl pointer-events-none group-hover:bg-blue-100/50 transition-colors" />
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-455 font-black">الانحرافات النظامية المستبعدة</span>
                    <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-black text-slate-800 leading-none">
                        {smartAnalyticsData.globalMetrics.totalSystemicExcused}
                      </span>
                      <span className="text-[9px] font-black text-blue-600 bg-blue-50/80 px-1.5 py-0.5 rounded">معفاة</span>
                    </div>
                    <p className="text-[9px] text-slate-400 font-bold mt-1">فروقات معزولة (أخطاء انتاج / خطأ تحميل) تم تبرئة الأمين منها</p>
                  </div>
                </div>

                {/* Card 4: Human Errors */}
                <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between h-[115px]">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-rose-50 rounded-full blur-2xl pointer-events-none group-hover:bg-rose-100/50 transition-colors" />
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-455 font-black">أخطاء جرد بشرية مرصودة</span>
                    <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-black text-slate-800 leading-none text-rose-600">
                        {smartAnalyticsData.globalMetrics.totalHumanErrors}
                      </span>
                      <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">انحراف غير مبرر</span>
                    </div>
                    <p className="text-[9px] text-slate-455 font-bold mt-1">تؤثر سلباً على تقييم الأمين نظراً لعدم وجود مبرر تاريخي</p>
                  </div>
                </div>
              </div>

              {/* EMPTY STATE COMPONENT (In case filters return nothing) */}
              {smartAnalyticsData.globalMetrics.totalEvaluatedItems === 0 ? (
                <div className="bg-white p-12 text-center rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mx-auto border border-slate-100 text-slate-400">
                    <Package className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-black text-slate-800">لا توجد سجلات تطابق التصفية المحددة</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto font-medium">
                      خيارات تصفية البيانات المحددة حالياً لم تسفر عن أي جرد متطابق إحصائياً. يرجى مراجعة محددات التصفية أو مسحها لإظهار لوحة التحليلات بالكامل.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedSessionIdFilter("all");
                      setSelectedAuditor("all");
                      setSelectedItemIdFilter("all");
                    }}
                    className="bg-indigo-950 text-white font-black text-xs px-5 py-2.5 rounded-xl transition-all hover:bg-indigo-900 active:scale-95 shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    إعادة ضبط التصفية ومسح الاختيارات
                  </button>
                </div>
              ) : (
                <>
                  {/* Category Divisions Sub-tabs Menu (تقسيمات الكادر والأصناف والمشرفين) */}
                  <div className="flex border-b border-slate-150">
                    <button
                      onClick={() => setSmartAnalyticsSubTab("items")}
                      className={`px-6 py-3 font-black text-xs border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                        smartAnalyticsSubTab === "items" 
                          ? "border-indigo-600 text-indigo-900 bg-indigo-50/20" 
                          : "border-transparent text-slate-450 hover:text-slate-850 hover:bg-slate-50/50"
                      }`}
                    >
                      <Package className="w-4 h-4" />
                      الأصناف والإنحرافات الإحصائية ({Object.keys(smartAnalyticsData.itemStats).length})
                    </button>
                    <button
                      onClick={() => setSmartAnalyticsSubTab("keepers")}
                      className={`px-6 py-3 font-black text-xs border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                        smartAnalyticsSubTab === "keepers" 
                          ? "border-indigo-600 text-indigo-900 bg-indigo-50/20" 
                          : "border-transparent text-slate-450 hover:text-slate-850 hover:bg-slate-50/50"
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      كفاءة وتقييم أمناء المستودعات ({smartAnalyticsData.storekeeperEvaluations.length})
                    </button>
                    <button
                      onClick={() => setSmartAnalyticsSubTab("supervisors")}
                      className={`px-6 py-3 font-black text-xs border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                        smartAnalyticsSubTab === "supervisors" 
                          ? "border-indigo-600 text-indigo-900 bg-indigo-50/20" 
                          : "border-transparent text-slate-450 hover:text-slate-850 hover:bg-slate-50/50"
                      }`}
                    >
                      <UserCheck className="w-4 h-4" />
                      جودة وتدقيق المشرفين ({smartAnalyticsData.supervisorEvaluations.length})
                    </button>
                  </div>

                  {/* SUB-TAB CONTENTS */}
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    
                    {/* LEFT CONTAINER FOR SUB-TABS (Takes 2/3 of space on large screens) */}
                    <div className="xl:col-span-2 space-y-6">
                      
                      {/* 1. ITEMS BREAKDOWN SUB-TAB */}
                      {smartAnalyticsSubTab === "items" && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 animate-fadeIn">
                          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                            <div>
                              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                                <Package className="w-4 h-4 text-indigo-600" />
                                لوحة تحليل الأصناف وعزل التباينات
                              </h3>
                              <p className="text-[10px] text-slate-455 font-bold mt-0.5">💡 جدول يعرض متوسط العجز والانحراف التاريخي المنظّم لكل صنف مستودعي.</p>
                            </div>
                            <span className="text-[10px] bg-slate-50 px-2.5 py-1 rounded-lg text-slate-500 font-bold font-mono">
                              {Object.keys(smartAnalyticsData.itemStats).length} صنف متاح
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-slate-150 rounded-xl bg-white overflow-hidden">
                            <table className="w-full text-right text-[11px] font-sans border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-black h-10">
                                  <th className="pr-4 py-2 w-20 text-center font-mono">كود الصنف</th>
                                  <th className="px-3 py-2">اسم الصنف المستودعي</th>
                                  <th className="px-3 py-2 text-center">متوسط الفارق التاريخي</th>
                                  <th className="px-3 py-2 text-center">انحراف مستقر (Std Dev)</th>
                                  <th className="px-3 py-2 text-center">حالة الصنف إحصائياً</th>
                                  <th className="pl-4 py-2 text-center">تأثير تفاعلي</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.values(smartAnalyticsData.itemStats).map((item: any) => {
                                  const isSelected = selectedItemIdFilter === item.itemId;
                                  return (
                                    <tr 
                                      key={item.itemId} 
                                      className={`border-b border-slate-100 hover:bg-indigo-50/10 h-11 font-medium transition-colors ${
                                        isSelected ? "bg-indigo-50/40 font-bold" : ""
                                      }`}
                                    >
                                      <td className="pr-4 py-2 text-center font-mono text-slate-500">{item.itemId}</td>
                                      <td className="px-3 py-2 text-slate-800 font-bold">{item.name}</td>
                                      <td className="px-3 py-2 text-center font-mono">
                                        <span className={`font-black ${
                                          item.historicalMeanDiff === 0 
                                            ? "text-slate-500" 
                                            : item.historicalMeanDiff > 0 
                                              ? "text-emerald-600" 
                                              : "text-rose-600"
                                        }`}>
                                          {item.historicalMeanDiff > 0 ? `+${item.historicalMeanDiff.toFixed(2)}` : item.historicalMeanDiff.toFixed(2)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-center font-mono text-slate-500">
                                        ± {item.historicalStdDev.toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${
                                          item.isInherentSystemicDiscrepancy 
                                            ? "bg-blue-50 text-blue-700 border-blue-150 animate-pulse" 
                                            : "bg-slate-100 text-slate-450 border-slate-200"
                                        }`}>
                                          {item.isInherentSystemicDiscrepancy ? "انحراف نظامي ثابت" : "طبيعي مستقر"}
                                        </span>
                                      </td>
                                      <td className="pl-4 py-2 text-center">
                                        <button
                                          onClick={() => setSelectedItemIdFilter(isSelected ? "all" : item.itemId)}
                                          className={`text-[9px] font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                                            isSelected 
                                              ? "bg-indigo-600 text-white border-indigo-600" 
                                              : "bg-indigo-50 text-indigo-700 border-indigo-150 hover:bg-indigo-100"
                                          }`}
                                        >
                                          {isSelected ? "إلغاء التركيز" : "تركيز التصفية"}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 2. STOREKEEPERS PERFORMANCE SUB-TAB */}
                      {smartAnalyticsSubTab === "keepers" && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 animate-fadeIn">
                          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                            <div>
                              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                                <Users className="w-4 h-4 text-indigo-600" />
                                تقييم جودة جرد أمناء العهدة (Storekeepers Quality Rating)
                              </h3>
                              <p className="text-[10px] text-slate-450 font-bold mt-0.5">💡 يمنح كل أمين مستودع درجة تقييم إحصائية مبنية على مطابقته للجرد ومعدل تعديلات الإدارة.</p>
                            </div>
                            <span className="text-[10px] bg-slate-50 px-2.5 py-1 rounded-lg text-slate-500 font-bold">
                              عدد {smartAnalyticsData.storekeeperEvaluations.length} أمناء عهدة
                            </span>
                          </div>

                          <div className="space-y-4">
                            {smartAnalyticsData.storekeeperEvaluations.map((keeper) => {
                              const isExpanded = selectedSmartKeeperCode === keeper.code;
                              return (
                                <div 
                                  key={keeper.code} 
                                  className={`border rounded-2xl transition-all duration-300 ${
                                    isExpanded ? "border-indigo-300 shadow-sm bg-indigo-50/5" : "border-slate-150 hover:border-slate-200"
                                  }`}
                                >
                                  {/* Header Row */}
                                  <div 
                                    onClick={() => setSelectedSmartKeeperCode(isExpanded ? "all" : keeper.code)}
                                    className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-black text-xs text-indigo-950 font-mono border border-slate-200 shrink-0">
                                        {keeper.code}
                                      </div>
                                      <div className="space-y-0.5">
                                        <h4 className="text-xs font-black text-slate-800">{keeper.name}</h4>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-450 font-bold font-mono">
                                          <span>جرد {keeper.totalItemsAudited} أصناف</span>
                                          <span>•</span>
                                          <span>{keeper.totalSessions} جلسات جرد</span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                      {/* Score Indicator & Gauge */}
                                      <div className="flex items-center gap-2.5">
                                        <div className="text-left">
                                          <span className="text-[10px] text-slate-400 font-bold block leading-none">مؤشر الدقة الذكي</span>
                                          <span className="font-mono text-sm font-black text-indigo-950 leading-none">{keeper.score}%</span>
                                        </div>
                                        <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200 shrink-0">
                                          <div 
                                            className={`h-full rounded-full ${
                                              keeper.score >= 90 ? "bg-emerald-500" : keeper.score >= 75 ? "bg-indigo-500" : keeper.score >= 60 ? "bg-amber-500" : "bg-rose-500"
                                            }`}
                                            style={{ width: `${keeper.score}%` }}
                                          />
                                        </div>
                                      </div>

                                      {/* Grade Badge */}
                                      <span className={`px-3 py-1 rounded-full text-[10px] font-black border flex items-center gap-1 ${keeper.gradeColor} shrink-0`}>
                                        <span>{keeper.gradeIcon}</span>
                                        <span>درجة {keeper.grade}</span>
                                      </span>

                                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isExpanded ? "rotate-180 text-indigo-600" : ""}`} />
                                    </div>
                                  </div>

                                  {/* Expanded AI Intelligence Details Panel */}
                                  <AnimatePresence>
                                    {isExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.25 }}
                                        className="overflow-hidden border-t border-slate-100 bg-slate-50/50"
                                      >
                                        <div className="p-5 space-y-5">
                                          
                                          {/* Evaluation Sub-Grid (Bento Style) */}
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div className="bg-white p-3.5 rounded-xl border border-slate-150 flex items-center justify-between">
                                              <div className="space-y-0.5">
                                                <span className="text-[9px] text-slate-455 font-bold block">مطابقات تامة</span>
                                                <b className="text-xs font-black text-slate-800 font-mono">{keeper.perfectMatchesCount}</b>
                                              </div>
                                              <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md font-mono">
                                                {keeper.totalItemsAudited > 0 ? `${Math.round((keeper.perfectMatchesCount / keeper.totalItemsAudited) * 100)}%` : "0%"}
                                              </span>
                                            </div>

                                            <div className="bg-white p-3.5 rounded-xl border border-slate-150 flex items-center justify-between">
                                              <div className="space-y-0.5">
                                                <span className="text-[9px] text-slate-455 font-bold block">انحرافات نظامية مبررة</span>
                                                <b className="text-xs font-black text-slate-800 font-mono">
                                                  {keeper.inherentExcusedCount + keeper.productionErrorsCount + keeper.loadingErrorsCount}
                                                </b>
                                              </div>
                                              <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md font-mono">
                                                معفوّ عنها
                                              </span>
                                            </div>

                                            <div className="bg-white p-3.5 rounded-xl border border-slate-150 flex items-center justify-between">
                                              <div className="space-y-0.5">
                                                <span className="text-[9px] text-slate-455 font-bold block">تعديلات/تصحيحات الجرد</span>
                                                <b className="text-xs font-black text-rose-600 font-mono">{keeper.modificationsCount}</b>
                                              </div>
                                              <span className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-md font-mono">
                                                تأثير سلبي
                                              </span>
                                            </div>
                                          </div>

                                          {/* AI Insights & Strengths/Weaknesses */}
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-emerald-50/20 p-4 rounded-xl border border-emerald-100 space-y-2">
                                              <h5 className="text-[11px] font-black text-emerald-800 flex items-center gap-1.5">
                                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                                                مؤشرات القوة والأداء (Strengths)
                                              </h5>
                                              <ul className="space-y-1 text-[10.5px] text-slate-700 font-semibold list-disc list-inside leading-relaxed pr-2">
                                                {keeper.strengths.map((str, idx) => (
                                                  <li key={idx}>{str}</li>
                                                ))}
                                              </ul>
                                            </div>

                                            <div className="bg-amber-50/20 p-4 rounded-xl border border-amber-100 space-y-2">
                                              <h5 className="text-[11px] font-black text-amber-800 flex items-center gap-1.5">
                                                <AlertCircle className="w-4 h-4 text-amber-600" />
                                                نقاط التطوير والمراجعة (Weaknesses)
                                              </h5>
                                              <ul className="space-y-1 text-[10.5px] text-slate-700 font-semibold list-disc list-inside leading-relaxed pr-2">
                                                {keeper.weaknesses.map((weak, idx) => (
                                                  <li key={idx}>{weak}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          </div>

                                          {/* Intelligent Forecasting / Early Warning */}
                                          <div className="bg-indigo-950 p-4 rounded-xl border border-indigo-900 shadow-sm relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
                                            <div className="flex items-start gap-3 relative z-10">
                                              <div className="p-1.5 rounded-lg bg-indigo-900 text-indigo-300 border border-indigo-800 shrink-0 mt-0.5">
                                                <Sparkles className="w-4 h-4 text-amber-400" />
                                              </div>
                                              <div className="space-y-1 text-right">
                                                <span className="text-[9px] font-black text-indigo-300 block tracking-wider uppercase">التنبؤ الرقمي والإنذار المبكر للأخطاء (Predictive Forecast)</span>
                                                <p className="text-[11px] text-indigo-100 font-bold leading-relaxed">
                                                  {keeper.forecastText}
                                                </p>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Detailed Item List Evaluated by AI */}
                                          <div className="space-y-2">
                                            <span className="text-[10px] font-black text-slate-500 block">تفاصيل تقييم الأصناف التي قام بجردها:</span>
                                            <div className="max-h-56 overflow-y-auto scrollbar-thin border border-slate-200 rounded-xl bg-white overflow-hidden">
                                              <table className="w-full text-right text-[10px] font-sans border-collapse">
                                                <thead>
                                                  <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-black h-8">
                                                    <th className="pr-3 py-1.5 w-16 text-center">كود الصنف</th>
                                                    <th className="px-3 py-1.5">اسم الصنف</th>
                                                    <th className="px-2 py-1.5 text-center font-mono">دفتري</th>
                                                    <th className="px-2 py-1.5 text-center font-mono">العد الفعلي</th>
                                                    <th className="px-2 py-1.5 text-center font-mono">الفرق</th>
                                                    <th className="px-3 py-1.5 text-center">نوع الانحراف (AI)</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {keeper.evaluatedItems.map((itm, idx) => (
                                                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50 h-8 font-medium">
                                                      <td className="pr-3 py-1.5 text-center font-mono text-slate-550">{itm.itemId}</td>
                                                      <td className="px-3 py-1.5 text-slate-800 font-bold truncate max-w-[150px]" title={itm.itemName}>{itm.itemName}</td>
                                                      <td className="px-2 py-1.5 text-center font-mono text-slate-500">{itm.bookQty}</td>
                                                      <td className="px-2 py-1.5 text-center font-mono font-bold text-slate-700">{itm.approvedQty}</td>
                                                      <td className={`px-2 py-1.5 text-center font-mono font-bold ${
                                                        itm.currentDiff === 0 ? "text-emerald-600" : "text-rose-600"
                                                      }`}>
                                                        {itm.currentDiff > 0 ? `+${itm.currentDiff}` : itm.currentDiff}
                                                      </td>
                                                      <td className="px-3 py-1 text-center">
                                                        <span className={`px-2.5 py-0.5 rounded-full text-[8.5px] font-black border ${itm.evaluationColor}`}>
                                                          {itm.evaluationLabel}
                                                        </span>
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>

                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 3. SUPERVISORS AUDITING SUB-TAB */}
                      {smartAnalyticsSubTab === "supervisors" && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 animate-fadeIn">
                          <div className="border-b border-slate-100 pb-3">
                            <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                              <UserCheck className="w-4 h-4 text-emerald-600" />
                              مؤشر كفاءة وتدقيق المشرفين (Supervisors Accuracy Rating)
                            </h3>
                            <p className="text-[10px] text-slate-455 font-bold mt-0.5">💡 يراقب دقة الاعتماد التي يقوم بها مشرفو المخازن، ويقيس نسبة التعديلات والقرارات التي تم تصحيحها لاحقاً من قبل المدير العام.</p>
                          </div>

                          {smartAnalyticsData.supervisorEvaluations.length === 0 ? (
                            <div className="bg-slate-50 p-6 text-center rounded-2xl border border-slate-150 text-xs text-slate-400 font-bold">
                              لا توجد جلسات معتمدة ومقفلة من قبل المشرفين حالياً للتقييم الإحصائي الإشرافي.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {smartAnalyticsData.supervisorEvaluations.map((superv) => (
                                <div key={superv.code} className="bg-slate-50/55 p-5 rounded-2xl border border-slate-150 hover:border-slate-200 transition-all space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-8 h-8 rounded-full bg-emerald-55 text-emerald-800 font-black flex items-center justify-center text-xs border border-emerald-150 font-mono">
                                        SU
                                      </div>
                                      <div className="space-y-0.5">
                                        <h4 className="text-xs font-black text-slate-850 leading-none">{superv.name}</h4>
                                        <span className="text-[9px] text-slate-400 font-black leading-none font-mono">كود: {superv.code}</span>
                                      </div>
                                    </div>
                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${superv.gradeColor}`}>
                                      درجة {superv.grade}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 text-center">
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-3xs">
                                      <span className="text-[8px] text-slate-400 font-bold block">معدل دقة المراجعة</span>
                                      <b className="text-xs font-black text-indigo-950 font-mono">{superv.verificationAccuracyRate}%</b>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-3xs">
                                      <span className="text-[8px] text-slate-400 font-bold block">تعديلات لاحقة للمدير</span>
                                      <b className="text-xs font-black text-rose-600 font-mono">{superv.managerOverridesCount}</b>
                                    </div>
                                  </div>

                                  <div className="bg-white p-3 rounded-xl border border-slate-100 space-y-1.5 text-right">
                                    <span className="text-[9px] font-black text-emerald-700 block">نقاط القوة الإشرافية:</span>
                                    <p className="text-[10px] text-slate-600 font-semibold leading-relaxed">
                                      {superv.strengths.join(" • ")}
                                    </p>
                                  </div>

                                  <div className="bg-rose-50/10 p-3 rounded-xl border border-rose-100/55 space-y-1.5 text-right">
                                    <span className="text-[9px] font-black text-rose-700 block">الملاحظات والتطوير الإشرافي:</span>
                                    <p className="text-[10px] text-slate-600 font-semibold leading-relaxed">
                                      {superv.weaknesses.join(" • ")}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                    </div>

                    {/* RIGHT CONTAINER FOR KPI CHARTS & STRATEGIC RECOMMENDATIONS (Takes 1/3 of space) */}
                    <div className="space-y-6">
                      
                      {/* KPI Donut Chart Card */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                        <div className="border-b border-slate-100 pb-2">
                          <h3 className="text-sm font-black text-slate-800">مخطط توزيع أسباب الانحرافات</h3>
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5">عزل طبيعة الفروق لتقليل المسؤولية الملقاة على عاتق الأمين</p>
                        </div>

                        {/* Modern SVG Donut / Segment representation */}
                        <div className="flex flex-col items-center justify-center py-4 space-y-4">
                          <div className="relative w-36 h-36 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                              {/* Background Circle */}
                              <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                              
                              {/* Segment calculations */}
                              {(() => {
                                let accumulatedPercent = 0;
                                const totalVal = smartAnalyticsData.globalMetrics.errorsDistribution.reduce((a, b) => a + b.value, 0);
                                
                                return smartAnalyticsData.globalMetrics.errorsDistribution.map((item, idx) => {
                                  const percent = totalVal > 0 ? (item.value / totalVal) * 100 : 0;
                                  const strokeDashArray = `${percent} ${100 - percent}`;
                                  const strokeDashOffset = 100 - accumulatedPercent;
                                  accumulatedPercent += percent;

                                  return (
                                    <circle
                                      key={idx}
                                      cx="50"
                                      cy="50"
                                      r="40"
                                      fill="none"
                                      stroke={item.color}
                                      strokeWidth="12"
                                      strokeDasharray={strokeDashArray}
                                      strokeDashoffset={strokeDashOffset}
                                      pathLength="100"
                                      className="transition-all duration-550 hover:stroke-[14px] cursor-pointer"
                                    />
                                  );
                                });
                              })()}
                            </svg>

                            <div className="absolute text-center">
                              <span className="text-[10px] text-slate-400 font-bold block leading-none">إجمالي الفروق</span>
                              <span className="font-mono text-xl font-black text-indigo-950">
                                {smartAnalyticsData.globalMetrics.errorsDistribution.reduce((a, b) => a + b.value, 0)}
                              </span>
                            </div>
                          </div>

                          {/* Legend */}
                          <div className="w-full space-y-1.5 text-xs font-semibold text-slate-650 pr-1">
                            {smartAnalyticsData.globalMetrics.errorsDistribution.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                  <span className="text-slate-600 font-black">{item.name}</span>
                                </div>
                                <span className="font-mono font-bold text-slate-800">{item.value} وحدة</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* STATS SUMMARY BOX FOR ITEM BASELINES */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                        <div className="border-b border-slate-100 pb-2">
                          <h3 className="text-sm font-black text-slate-800">المحددات الإحصائية للأصناف</h3>
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5">💡 متوسط عجز الصنف التاريخي الخالي من القيم الشاذة لتبرير الفروق المماثلة للأمناء</p>
                        </div>

                        <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-thin pl-1">
                          {Object.values(smartAnalyticsData.itemStats).map((item: any) => (
                            <div key={item.itemId} className="bg-slate-50/55 p-3 rounded-xl border border-slate-150 flex items-center justify-between text-xs gap-3">
                              <div className="space-y-0.5 min-w-0">
                                <span className="font-mono text-[9px] text-slate-400 font-black">كود: {item.itemId}</span>
                                <h4 className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</h4>
                              </div>
                              
                              <div className="text-left shrink-0">
                                <span className="text-[8px] text-slate-400 font-bold block">متوسط الفارق التاريخي</span>
                                <span className={`font-mono text-[10.5px] font-black ${
                                  item.historicalMeanDiff === 0 
                                    ? "text-slate-500" 
                                    : item.historicalMeanDiff > 0 
                                      ? "text-emerald-600" 
                                      : "text-rose-600"
                                }`}>
                                  {item.historicalMeanDiff > 0 ? `+${item.historicalMeanDiff.toFixed(1)}` : item.historicalMeanDiff.toFixed(1)}
                                </span>
                                
                                <span className={`text-[7px] font-black block px-1 rounded mt-0.5 ${
                                  item.isInherentSystemicDiscrepancy 
                                    ? "bg-blue-50 text-blue-700 border border-blue-100" 
                                    : "bg-slate-100 text-slate-450 border border-slate-200"
                                }`}>
                                  {item.isInherentSystemicDiscrepancy ? "انحراف نظامي ثابت" : "طبيعي مستقر"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                  </div>

                  {/* HIGH-IMPACT DECISION SUPPORT PANEL (توصيات الإدارة الإستراتيجية ودعم اتخاذ القرارات) */}
                  <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200 space-y-4">
                    <div className="border-b border-slate-200 pb-3 flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700">
                        <Award className="w-5 h-5" />
                      </span>
                      <div>
                        <h3 className="text-sm font-black text-slate-800">التوصيات الإستراتيجية ودعم اتخاذ القرار المالي والميداني (Decision Support)</h3>
                        <p className="text-[10.5px] text-slate-455 font-bold">💡 خوارزمية الرقابة تعزل المسؤوليات وتوجه المدير التنفيذي لأفضل القرارات بناءً على سلوك الأفراد والمصنع تاريخياً.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {smartRecommendations.map((rec, idx) => (
                        <div 
                          key={idx} 
                          className={`p-5 rounded-2xl border transition-all hover:shadow-xs flex flex-col justify-between ${
                            rec.type === "success" 
                              ? "bg-emerald-50/40 border-emerald-150 text-emerald-900" 
                              : rec.type === "danger"
                                ? "bg-rose-50/40 border-rose-150 text-rose-900"
                                : rec.type === "warning"
                                  ? "bg-amber-50/40 border-amber-150 text-amber-900"
                                  : "bg-indigo-50/40 border-indigo-150 text-indigo-900"
                          }`}
                        >
                          <div className="space-y-1 text-right">
                            <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full border inline-block mb-2 ${
                              rec.type === "success" 
                                ? "bg-emerald-100/80 border-emerald-200 text-emerald-800" 
                                : rec.type === "danger"
                                  ? "bg-rose-100/80 border-rose-200 text-rose-800"
                                  : rec.type === "warning"
                                    ? "bg-amber-100/80 border-amber-200 text-amber-850"
                                    : "bg-indigo-100/80 border-indigo-200 text-indigo-800"
                            }`}>
                              {rec.type === "success" ? "إنجاز وتميز" : rec.type === "danger" ? "تنبيه حرج" : rec.type === "warning" ? "تنبيه نظامي" : "توجيه تشغيلي"}
                            </span>
                            <h4 className="text-xs font-black leading-tight">{rec.title}</h4>
                            <p className="text-[10.5px] text-slate-600 font-semibold leading-relaxed mt-1">{rec.desc}</p>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-150/50 space-y-1">
                            <span className="text-[8.5px] font-black text-slate-400 block uppercase">التوجيه التشغيلي المقترح:</span>
                            <p className="text-[11px] font-black text-slate-800 leading-tight">➔ {rec.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Modification Details Modal (CRITICAL USER REQUEST) */}
      <AnimatePresence>
        {selectedModDetails && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[150] flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden font-sans"
            >
              {/* Header */}
              <div className="bg-indigo-950 px-6 py-4 flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-black">تفاصيل تعديل الصنف</h3>
                </div>
                <button 
                  onClick={() => setSelectedModDetails(null)}
                  className="text-white/80 hover:text-white transition-colors cursor-pointer bg-white/10 hover:bg-white/20 p-1.5 rounded-full"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4 text-right">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold">اسم الصنف:</span>
                  <p className="text-xs font-black text-slate-800 leading-tight">{selectedModDetails.itemName}</p>
                </div>
                
                {(selectedModDetails.sessionName || selectedModDetails.sessionId) && (
                  <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-[10px] text-indigo-500 font-bold block">تاريخ نسخة الجرد:</span>
                        <p className="text-xs font-black text-indigo-900 leading-tight">
                          {selectedModDetails.sessionName || (selectedModDetails.sessionDate ? new Date(selectedModDetails.sessionDate instanceof Object && 'seconds' in selectedModDetails.sessionDate ? selectedModDetails.sessionDate.seconds * 1000 : selectedModDetails.sessionDate).toLocaleDateString('ar-EG', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                          }) : "—")}
                        </p>
                      </div>
                      {selectedModDetails.versionNumber && (
                        <span className="bg-emerald-600 text-white font-black px-2.5 py-1 rounded-lg text-[9px] shadow-3xs shrink-0" title={`نسخة رقم ${selectedModDetails.versionNumber}`}>
                          {selectedModDetails.versionNumber}
                        </span>
                      )}
                    </div>
                    {selectedModDetails.sessionId && (
                      <div className="pt-2 border-t border-indigo-100/50">
                        <span className="text-[8px] text-indigo-400 font-bold block mb-0.5">الرقم المعرف الوحيد لنسخة الجرد:</span>
                        <p className="text-[8px] font-mono text-indigo-800/70 break-all bg-white/40 px-1.5 py-1 rounded-md border border-indigo-100/30 select-all" title="اضغط للنسخ">
                          {selectedModDetails.sessionId}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                      <User className="w-3.5 h-3.5 text-indigo-500" />
                      <span>اسم المستخدم:</span>
                    </div>
                    <p className="text-xs font-black text-slate-800">{selectedModDetails.modifier}</p>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                      <Shield className="w-3.5 h-3.5 text-indigo-500" />
                      <span>الصلاحية / الدور:</span>
                    </div>
                    <div>
                      <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full inline-block mt-0.5">
                        {selectedModDetails.role}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                      <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                      <span>تاريخ التعديل:</span>
                    </div>
                    <p className="text-xs font-black text-slate-800 font-mono">{formatModDate(selectedModDetails.date)}</p>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      <span>وقت التعديل:</span>
                    </div>
                    <p className="text-xs font-black text-slate-800 font-mono">{formatModTime(selectedModDetails.date)}</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-150 flex items-center justify-around text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-0.5">الكمية السابقة</span>
                    <span className="font-mono text-xs font-bold text-slate-500">{selectedModDetails.oldQty !== null ? `${selectedModDetails.oldQty}` : "—"}</span>
                  </div>
                  <div className="text-slate-300 text-lg">➔</div>
                  <div>
                    <span className="text-[10px] text-indigo-500 font-bold block mb-0.5">الكمية الجديدة</span>
                    <span className="font-mono text-sm font-black text-indigo-950 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-100">{selectedModDetails.newQty !== null ? `${selectedModDetails.newQty}` : "—"}</span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-150">
                <button 
                  onClick={() => setSelectedModDetails(null)}
                  className="bg-slate-200 text-slate-700 hover:bg-slate-300 text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer active:scale-95"
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
