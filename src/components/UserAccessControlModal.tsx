import React, { useState } from "react";
import { LoggedInUser } from "../types";
import { 
  X, 
  Search, 
  UserCheck, 
  UserX, 
  Users, 
  CheckCircle2, 
  XCircle,
  ShieldCheck,
  ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  registeredUsers: LoggedInUser[];
  precodedUsers: LoggedInUser[];
  onUpdateUsers: (
    updatedRegistered: LoggedInUser[], 
    updatedPrecoded: LoggedInUser[],
    targetUserCode?: string,
    newStatus?: boolean
  ) => void;
}

export default function UserAccessControlModal({ 
  isOpen, 
  onClose, 
  registeredUsers, 
  precodedUsers,
  onUpdateUsers 
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("all");

  const allUsers = [
    ...(registeredUsers || []).map(u => ({ ...u, _source: 'registered' })),
    ...(precodedUsers || []).filter(pu => !(registeredUsers || []).some(ru => String(ru?.code || "") === String(pu?.code || "")))
                    .map(u => ({ ...u, _source: 'precoded' }))
  ];

  const filteredUsers = allUsers.filter(u => {
    const nameStr = String(u?.name || "").toLowerCase();
    const codeStr = String(u?.code || "").toLowerCase();
    const queryStr = (searchQuery || "").toLowerCase();
    const matchesSearch = nameStr.includes(queryStr) || codeStr.includes(queryStr);
    const matchesRole = selectedRole === "all" || u?.role === selectedRole;
    return matchesSearch && matchesRole;
  }).sort((a, b) => {
    const codeA = parseInt(String(a?.code || "")) || 0;
    const codeB = parseInt(String(b?.code || "")) || 0;
    return codeA - codeB;
  });

  const handleToggle = (userCode: string, currentStatus: boolean | undefined) => {
    const isManager = allUsers.find(u => String(u?.code) === String(userCode))?.role === 'general_manager';
    if (isManager && currentStatus) {
       // Prevent deactivating General Manager
       return;
    }

    const newStatus = !currentStatus;
    
    const updatedRegistered = (registeredUsers || []).map(u => 
      String(u.code) === String(userCode) ? { ...u, isActivated: newStatus, is_activated: newStatus } : u
    );
    const updatedPrecoded = (precodedUsers || []).map(u => 
      String(u.code) === String(userCode) ? { ...u, isActivated: newStatus, is_activated: newStatus } : u
    );

    onUpdateUsers(updatedRegistered, updatedPrecoded, userCode, newStatus);
  };

  const handleBulkUpdate = (activate: boolean) => {
    const updatedRegistered = (registeredUsers || []).map(u => {
      if (u.role === 'general_manager') return u; // Never deactivate manager
      return { ...u, isActivated: activate, is_activated: activate };
    });
    const updatedPrecoded = (precodedUsers || []).map(u => {
      if (u.role === 'general_manager') return u;
      return { ...u, isActivated: activate, is_activated: activate };
    });

    onUpdateUsers(updatedRegistered, updatedPrecoded, undefined, activate);
  };

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'general_manager': return "المدير العام";
      case 'system_admin': return "مسئول نظام";
      case 'program_manager': return "مسئول البرنامج";
      case 'supervisor': return "مشرف المخازن";
      case 'stores_manager': return "مدير مخازن";
      case 'storekeeper': return "أمين مخزن";
      default: return "مستخدم";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm font-sans" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20, transition: { duration: 0.2 } }}
        className="bg-white w-full max-w-2xl rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[90vh] border border-white/20 relative"
      >
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800">إدارة تنشيط المستخدمين الفردي</h2>
              <p className="text-[10px] text-slate-500 font-bold">تفعيل أو تعطيل دخول المستخدمين للنظام بشكل مستقل</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-50 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="ابحث بالكود أو الاسم..."
                className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500 transition-all font-sans"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Role Filter Dropdown */}
            <div className="w-28 sm:w-32">
              <select
                value={selectedRole}
                onChange={e => setSelectedRole(e.target.value)}
                className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black outline-none focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer text-slate-700 font-sans"
              >
                <option value="all">كل الأدوار</option>
                <option value="general_manager">المدير العام</option>
                <option value="system_admin">مسئول نظام</option>
                <option value="program_manager">مسئول البرنامج</option>
                <option value="supervisor">مشرف المخازن</option>
                <option value="stores_manager">مدير مخازن</option>
                <option value="storekeeper">أمين مخزن</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={() => handleBulkUpdate(true)}
              className="flex-1 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              تفعيل جميع اليوزرات
            </button>
            <button 
              onClick={() => handleBulkUpdate(false)}
              className="flex-1 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-black hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <XCircle className="w-3.5 h-3.5" />
              تعطيل جميع اليوزرات
            </button>
          </div>
        </div>

        {/* User List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/30">
          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
               <Users className="w-12 h-12 opacity-20 mb-2" />
               <p className="text-xs font-bold">لا يوجد مستخدمين مطابقين للبحث</p>
            </div>
          ) : (
            filteredUsers.map((u, index) => {
              const isActive = u?.isActivated !== false;
              const isManager = u?.role === 'general_manager';
              const nameValue = String(u?.name || (u as any)?.username || "مستخدم").trim();
              const codeValue = String(u?.code || "");
              
              return (
                <div 
                  key={codeValue || index} 
                  className={`p-3 rounded-2xl border transition-all flex items-center justify-between group ${
                    isActive 
                      ? "bg-white border-slate-150 hover:border-blue-200" 
                      : "bg-slate-100/50 border-slate-200 grayscale-[0.5]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {codeValue && <span className="font-mono text-slate-400 ml-1.5 text-[10px] shrink-0">[{codeValue}]</span>}
                        <span className="text-[11px] font-black text-slate-800">{nameValue}</span>
                      </div>
                      <div className="flex items-center flex-wrap gap-2 mt-1">
                        <span className={`text-[8px] font-bold px-1.5 py-px rounded-md border ${
                           u?.role === 'general_manager' ? "bg-gray-100 text-gray-700 border-gray-200" :
                           u?.role === 'system_admin' ? "bg-purple-50 text-purple-700 border-purple-100" :
                           u?.role === 'program_manager' ? "bg-rose-50 text-rose-700 border-rose-100" :
                           "bg-blue-50 text-blue-700 border-blue-100"
                        }`}>
                          {getRoleLabel(u?.role)}
                        </span>
                        {!isActive && (
                          <span className="text-[8px] font-black text-rose-600 flex items-center gap-0.5">
                            <ShieldAlert className="w-2.5 h-2.5" />
                            وصول محظور
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => handleToggle(codeValue, isActive)}
                    disabled={isManager && isActive}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all cursor-pointer font-black text-[10px] border ${
                      isActive 
                        ? (isManager ? "bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed" : "bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100") 
                        : "bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100 shadow-sm"
                    }`}
                  >
                    {isActive ? (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>نشط (مفعل)</span>
                      </>
                    ) : (
                      <>
                        <UserX className="w-3.5 h-3.5" />
                        <span>معطل (محظور)</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-center">
          <button 
            onClick={onClose}
            className="px-10 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-black rounded-xl transition-all shadow-md cursor-pointer active:scale-95"
          >
            إغلاق شاشة التحكم
          </button>
        </div>
      </motion.div>
    </div>
  );
}
