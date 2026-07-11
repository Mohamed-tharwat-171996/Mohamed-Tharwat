import React, { useState, useEffect } from "react";
import { MasterItem } from "../types";
import { X, Search, Package, Hash, FileText, Database, Info, Layers, Trash2 } from "lucide-react";

interface MasterInventoryMirrorProps {
  items: MasterItem[];
  onClose: () => void;
  onSync?: () => void;
  userCanClear?: boolean;
  localActiveSession?: any | null;
  onImportActiveSession?: (session: any) => void;
}

export default function MasterInventoryMirror({ 
  items, 
  onClose, 
  onSync, 
  userCanClear = false,
  localActiveSession = null,
  onImportActiveSession
}: MasterInventoryMirrorProps) {
  const [search, setSearch] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [cloudMetadata, setCloudMetadata] = useState<any | null>(null);
  const [isLoadingCloudInfo, setIsLoadingCloudInfo] = useState(false);
  const [isClearingActive, setIsClearingActive] = useState(false);

  // Custom confirmation and toast states to bypass blocked native prompt iframe limitations
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Auto clear toast after 4s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchCloudInfo = async () => {
    setIsLoadingCloudInfo(true);
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const res = await fetch('/api/backup/info', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.metadata) {
        setCloudMetadata(data.metadata);
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch cloud metadata in mirror modal:", err);
    } finally {
      setIsLoadingCloudInfo(false);
    }
  };

  useEffect(() => {
    fetchCloudInfo();
  }, []);

  const cloudActive = cloudMetadata?.activeSessionInCloud;
  // It is orphaned if cloudActive has an ID, but localActiveSession has a different ID or is null
  const isOrphanedActiveSession = cloudActive && cloudActive.id && 
    (!localActiveSession || String(localActiveSession.id) !== String(cloudActive.id));

  const validItems = (items || []).filter(
    (item): item is MasterItem => item !== null && item !== undefined && typeof item === "object" && item.id !== undefined
  );

  const filtered = validItems.filter(item => {
    const itemName = item.name !== undefined && item.name !== null ? String(item.name).toLowerCase() : "";
    const itemId = item.id !== undefined && item.id !== null ? String(item.id).toLowerCase() : "";
    const itemCategory = item.category !== undefined && item.category !== null ? String(item.category).toLowerCase() : "";
    const s = search.toLowerCase();
    return itemName.includes(s) || itemId.includes(s) || itemCategory.includes(s);
  });

  const triggerClearDatabase = () => {
    setConfirmAction({
      title: "🚨 تصفير ومسح شامل للمستودع",
      message: "إجراء خطير للغاية! هل أنت متأكد من مسح قاعدة البيانات وتصفير جميع الأصناف والباركودات والجلسات وبقايا السحابة تماماً؟ هذا الإجراء قطعي ولا يمكن التراجع عنه.",
      onConfirm: async () => {
        setConfirmAction(null);
        setIsDeleting(true);
        try {
          const token = localStorage.getItem("inventory_jwt_token");
          const res = await fetch("/api/inventory/clear-master-database", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            }
          });
          if (res.ok) {
            setToast({ message: "✅ تم تصفير ومسح جميع الأصناف والبيانات بنجاح.", type: "success" });
            setTimeout(() => {
              if (onSync) onSync();
              onClose();
            }, 2000);
          } else {
            const d = await res.json();
            setToast({ message: `❌ فشل التصفير: ${d.error || 'خطأ غير معروف'}`, type: "error" });
          }
        } catch (err) {
          console.error("Delete master error:", err);
          setToast({ message: "❌ خطأ في الاتصال بالخادم.", type: "error" });
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-2 sm:p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-[0.75rem] shadow-2xl border border-slate-100 flex flex-col max-h-[75vh] overflow-hidden" dir="rtl">
        {/* Header - Ultra Compact */}
        <div className="p-1.5 sm:p-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="p-1 bg-blue-600 text-white rounded-md">
              <Layers className="w-3 h-3" />
            </div>
            <div>
              <h3 className="font-black text-[10.5px] text-slate-800 tracking-tight leading-none">مرآة المخزون السحابي</h3>
              <p className="text-[7px] text-slate-500 font-bold mt-0.5">{validItems.length} صنف</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-200 transition-all text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick Insights - Tiny */}
        <div className="px-2 py-1 bg-white grid grid-cols-4 gap-1 border-b border-slate-50">
          <div className="p-1 bg-blue-50/20 rounded-md border border-blue-50/50">
            <span className="text-[6.5px] font-bold text-blue-400 block truncate">أصناف</span>
            <span className="text-[9px] font-black text-blue-900 leading-none">{validItems.length}</span>
          </div>
          <div className="p-1 bg-emerald-50/20 rounded-md border border-emerald-50/50">
            <span className="text-[6.5px] font-bold text-emerald-400 block truncate">أقسام</span>
            <span className="text-[9px] font-black text-emerald-800 leading-none">{new Set(validItems.map(i => i.category || 'عام')).size}</span>
          </div>
          <div className="p-1 bg-amber-50/20 rounded-md border border-amber-50/50">
            <span className="text-[6.5px] font-bold text-amber-500 block truncate">كميات</span>
            <span className="text-[9px] font-black text-amber-900 leading-none">
              {Math.round(validItems.reduce((acc, i) => acc + (i.bookQty || 0), 0)).toLocaleString()}
            </span>
          </div>
          {userCanClear ? (
            <button 
              onClick={triggerClearDatabase}
              disabled={isDeleting}
              className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 hover:bg-rose-100 transition-all cursor-pointer flex items-center justify-center gap-0.5 active:scale-95 disabled:opacity-50 font-sans"
              title="تصفير ومسح قاعدة البيانات نهائياً"
            >
              <Trash2 className="w-2.5 h-2.5 outline-none border-none animate-bounce" />
              <span className="text-[7.5px] font-black">تصفير كلي ⚠️</span>
            </button>
          ) : (
            <div className="p-1 bg-slate-50 rounded-md border border-slate-100 flex items-center justify-center text-slate-400 text-[6.5px] font-bold select-none truncate">
              مغلق 🔒
            </div>
          )}
        </div>

        {/* Stray/Orphaned cloud active session warning card */}
        {isOrphanedActiveSession && (
          <div className="mx-2 my-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md shadow-3xs flex flex-col gap-1 text-right animate-fadeIn" dir="rtl">
            <div className="flex items-center gap-1.5 text-amber-800 font-black text-[9px]">
              <span className="animate-pulse inline-block w-1.5 h-1.5 bg-amber-600 rounded-full"></span>
              <span>⚠️ تم كشف بقايا جلسة جرد نشطة في السحاب (غير ظاهرة بالتطبيق)</span>
            </div>
            <p className="text-[7.5px] text-amber-700 leading-tight">
              هناك جلسة نشطة مسجلة في خادم السحابة ولكنها غير معروضة كجلسة نشطة على هذا الجهاز. يمكنك استيرادها الآن لإظهارها وإكمالها أو حذف بقاياها نهائياً.
            </p>
            <div className="bg-white/80 p-1 rounded border border-amber-100 text-[7px] text-slate-700 space-y-0.5">
              <div><strong>رقم الجلسة:</strong> <span className="font-mono text-blue-600 font-bold">{cloudActive.id}</span></div>
              <div><strong>التاريخ:</strong> {cloudActive.date}</div>
              <div><strong>أمين المخزن:</strong> {cloudActive.storekeeperName || 'غير محدد'} ({cloudActive.storekeeperCode || 'لا يوجد'})</div>
              {cloudActive.notes && <div className="truncate"><strong>الملاحظات:</strong> {cloudActive.notes}</div>}
            </div>
            <div className="flex gap-1 justify-end mt-1">
              <button
                onClick={() => {
                  setConfirmAction({
                    title: "📥 استيراد وتفعيل الجلسة",
                    message: "هل أنت متأكد من استيراد وتفعيل هذه الجلسة على هذا الجهاز لتصبح الجلسة النشطة الحالية؟",
                    onConfirm: () => {
                      setConfirmAction(null);
                      if (onImportActiveSession) {
                        onImportActiveSession(cloudActive);
                        setToast({ message: "✅ تم استيراد الجلسة وتفعيلها بنجاح.", type: "success" });
                        setTimeout(() => {
                          fetchCloudInfo();
                        }, 1500);
                      }
                    }
                  });
                }}
                className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[7.5px] font-black rounded shadow-3xs border-none cursor-pointer active:scale-95"
              >
                📥 استيراد وتفعيل
              </button>
              <button
                disabled={isClearingActive}
                onClick={() => {
                  setConfirmAction({
                    title: "🗑️ حذف وتصفير الجلسة اليتيمة",
                    message: "⚠️ هل أنت متأكد من تصفير وحذف هذه الجلسة النشطة اليتيمة نهائياً من السحاب؟ هذا الإجراء غير قابل للتراجع.",
                    onConfirm: async () => {
                      setConfirmAction(null);
                      setIsClearingActive(true);
                      try {
                        const token = localStorage.getItem("inventory_jwt_token");
                        const res = await fetch("/api/admin/clear-active-session", {
                          method: "POST",
                          headers: { 
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
                          }
                        });
                        if (res.ok) {
                          setToast({ message: "🗑️ تم تصفير وحذف الجلسة النشطة اليتيمة بنجاح.", type: "success" });
                          setTimeout(() => {
                            fetchCloudInfo();
                            if (onSync) onSync();
                          }, 1500);
                        } else {
                          const d = await res.json();
                          setToast({ message: `❌ فشل: ${d.error || 'خطأ غير معروف'}`, type: "error" });
                        }
                      } catch (err) {
                        setToast({ message: "❌ خطأ في الاتصال بالخادم.", type: "error" });
                      } finally {
                        setIsClearingActive(false);
                      }
                    }
                  });
                }}
                className="px-2 py-0.5 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-[7.5px] font-black rounded cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isClearingActive ? "جاري الحذف..." : "🗑️ تصفير هذه الجلسة فقط"}
              </button>
            </div>
          </div>
        )}

        {/* Search - Smaller */}
        <div className="px-2 py-1 bg-white border-b border-slate-50">
          <div className="relative w-full">
            <Search className="w-2.5 h-2.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="البحث بالاسم أو الباركود..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-6 pl-2 py-0.5 h-6 bg-slate-100 border-none rounded-sm text-[8.5px] font-bold focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* List - Micro Grid */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1 bg-slate-50/10">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-slate-300">
              <p className="font-bold text-[8px]">لا يوجد نتائج</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {filtered.map((item) => (
                <div key={item.id} className="bg-white px-1.5 py-1 rounded-md border border-slate-100 transition-all shadow-3xs flex flex-col gap-0 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="shrink-0 px-0.5 py-0 bg-slate-50 text-slate-400 rounded text-[6.5px] font-mono border border-slate-100">
                      {item.id}
                    </span>
                    <span className="text-[8px] font-black text-slate-800 truncate" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[7px] text-slate-400 font-bold overflow-hidden mt-0.5">
                    <span className="shrink-0 bg-amber-50 text-amber-700 px-0.5 rounded-xs">
                      {item.bookQty} {item.unit}
                    </span>
                    <span className="truncate opacity-50">{item.category || "عام"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-1.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <p className="text-[7px] text-slate-400 font-bold px-1 italic">نطاق السحابة النشط ☁️</p>
          <button
            onClick={onClose}
            className="px-2.5 py-0.5 bg-slate-800 hover:bg-slate-900 text-white font-black rounded text-[8px] transition-all cursor-pointer shadow-sm active:scale-95 border-none outline-none"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-xs rounded-lg shadow-xl border border-slate-100 p-4 text-right" dir="rtl">
            <h4 className="text-[10px] font-black text-slate-800 mb-2 flex items-center gap-1.5">
              <span>{confirmAction.title}</span>
            </h4>
            <p className="text-[8px] text-slate-600 leading-relaxed mb-4">
              {confirmAction.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[8.5px] font-black rounded cursor-pointer border-none"
              >
                تراجع إلغاء
              </button>
              <button
                onClick={confirmAction.onConfirm}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[8.5px] font-black rounded shadow-xs cursor-pointer border-none"
              >
                تأكيد الإجراء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Toast Popup */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[210] px-4 py-2 rounded-lg shadow-lg text-[9px] font-black text-white flex items-center gap-2 animate-bounce"
             style={{ backgroundColor: toast.type === "success" ? "#059669" : "#dc2626" }} dir="rtl">
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
