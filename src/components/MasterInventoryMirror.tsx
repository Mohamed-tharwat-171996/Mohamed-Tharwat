import React, { useState } from "react";
import { MasterItem } from "../types";
import { X, Search, Package, Hash, FileText, Database, Info, Layers, Trash2 } from "lucide-react";

interface MasterInventoryMirrorProps {
  items: MasterItem[];
  onClose: () => void;
  onSync?: () => void;
  userCanClear?: boolean;
}

export default function MasterInventoryMirror({ items, onClose, onSync, userCanClear = false }: MasterInventoryMirrorProps) {
  const [search, setSearch] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleClearDatabase = async () => {
    if (!window.confirm("🚨 إجراء خطير: هل أنت متأكد من مسح جميع الأصناف والباركودات (Mirror) نهائياً من قاعدة البيانات السحابية؟")) return;
    if (!window.confirm("تحذير أخير: هذا الفعل سيقوم بتصفير جميع الأصناف المسجلة! هل تريد الاستمرار؟")) return;

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
        alert("✅ تم تصفير قاعدة بيانات الأصناف بنجاح.");
        if (onSync) onSync();
        onClose();
      } else {
        const d = await res.json();
        alert(`❌ فشل: ${d.error || 'خطأ غير معروف'}`);
      }
    } catch (err) {
      console.error("Delete master error:", err);
      alert("❌ خطأ في الاتصال بالخادم.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-2 sm:p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-[0.75rem] shadow-2xl border border-slate-100 flex flex-col max-h-[70vh] overflow-hidden" dir="rtl">
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
              onClick={handleClearDatabase}
              disabled={isDeleting}
              className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 hover:bg-rose-100 transition-all cursor-pointer flex items-center justify-center gap-0.5 active:scale-95 disabled:opacity-50"
              title="تصفير ومسح قاعدة البيانات نهائياً"
            >
              <Trash2 className="w-2.5 h-2.5 outline-none border-none" />
              <span className="text-[7.5px] font-black">تصفير</span>
            </button>
          ) : (
            <div className="p-1 bg-slate-50 rounded-md border border-slate-100 flex items-center justify-center text-slate-400 text-[6.5px] font-bold select-none truncate">
              مغلق 🔒
            </div>
          )}
        </div>

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
    </div>
  );
}
