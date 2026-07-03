import React, { useState, useEffect } from "react";
import { LoggedInUser } from "../types";
import SalatMessage from "./SalatMessage";
import { 
  User, 
  Shield, 
  Lock, 
  Trash2, 
  Plus, 
  Edit2, 
  Check, 
  X, 
  Search, 
  Phone, 
  UserCheck, 
  Info,
  ChevronLeft,
  ArrowLeft,
  Settings,
  HelpCircle,
  XCircle,
  CheckCircle,
  ChevronDown
} from "lucide-react";

interface Props {
  users: LoggedInUser[];
  onAddUser: (user: LoggedInUser) => void;
  onDeleteUser: (code: string) => void;
  onUpdateUser: (user: LoggedInUser) => void;
  forbiddenCodes?: string[];
  currentUser?: LoggedInUser | null;
  setIsSubTabOpen?: (isOpen: boolean) => void;
}

export default function UserManagement({ users, onAddUser, onDeleteUser, onUpdateUser, forbiddenCodes, currentUser, setIsSubTabOpen }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<'add' | 'edit' | null>(null);

  useEffect(() => {
    setIsSubTabOpen?.(!!activeSubTab);
  }, [activeSubTab, setIsSubTabOpen]);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("123456");
  const [newRole, setNewRole] = useState<'general_manager' | 'system_admin' | 'program_manager' | 'supervisor' | 'storekeeper' | 'stores_manager'>("storekeeper");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // States for inline editing
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<'general_manager' | 'system_admin' | 'program_manager' | 'supervisor' | 'storekeeper' | 'stores_manager'>("storekeeper");
  const [editIsActivated, setEditIsActivated] = useState(true);

  const [formError, setFormError] = useState("");
  const [deleteConfirmCode, setDeleteConfirmCode] = useState<string | null>(null);

  const validateEgyptianPhone = (phone: string): boolean => {
    const p = phone.trim();
    if (!p) return true;
    return /^01\d{9}$/.test(p);
  };

  const sanitizePhoneInput = (val: string): string => {
    return val.replace(/[^0-9]/g, "").slice(0, 11);
  };

  const handleAdd = () => {
    setFormError("");
    const codeClean = newCode.trim();
    const nameClean = newName.trim();
    const passwordClean = newPassword.trim();

    if (!codeClean || !nameClean || !passwordClean) {
      setFormError("يرجى ملء كافة الحقول الأساسية.");
      return;
    }

    if (newPhone.trim() && !validateEgyptianPhone(newPhone)) {
      setFormError("رقم هاتف غير صحيح.");
      return;
    }

    const searchCode = codeClean.toLowerCase();
    const exists = users.some(u => String(u.code).trim().toLowerCase() === searchCode) ||
                   (forbiddenCodes && forbiddenCodes.some(c => String(c).trim().toLowerCase() === searchCode));
    if (exists) {
      setFormError("كود الحساب مستخدم مسبقاً.");
      return;
    }

    onAddUser({
      code: codeClean,
      name: nameClean,
      phone: newPhone.trim(),
      password: passwordClean,
      role: newRole,
      rememberMe: true
    });

    setNewCode("");
    setNewName("");
    setNewPhone("");
    setNewPassword("123456");
    setNewRole("storekeeper");
    setFormError("");
    setActiveSubTab(null);
  };

  const handleSaveEdit = () => {
    if (!editingUserId) return;
    if (!editName.trim()) {
      alert("الاسم مطلوب");
      return;
    }
    const finalPassword = editPassword.trim() ? editPassword.trim() : undefined;
    onUpdateUser({
      code: editCode.trim() || editingUserId,
      name: editName.trim(),
      phone: editPhone.trim(),
      password: finalPassword,
      role: editRole,
      isActivated: editIsActivated,
      rememberMe: true
    });
    setEditingUserId(null);
  };

  const startEdit = (user: LoggedInUser) => {
    setEditingUserId(user.code);
    setEditName(user.name);
    setEditCode(user.code);
    let hp = (user.phone || "").replace(/[^0-9]/g, "");
    setEditPhone(hp.slice(0, 11));
    setEditPassword("");
    setEditRole(user.role || "storekeeper");
    setEditIsActivated(user.isActivated !== false);
  };

  const filteredUsers = users.filter((u) => 
    searchQuery.trim() === "" ||
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.code.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => {
    const codeA = parseInt(String(a.code)) || 0;
    const codeB = parseInt(String(b.code)) || 0;
    return codeA - codeB;
  });

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'general_manager': return "المدير العام";
      case 'system_admin': return "مسئول نظام";
      case 'program_manager': return "مسئول البرنامج";
      case 'supervisor': return "مشرف المخازن";
      case 'stores_manager': return "مدير مخازن";
      case 'storekeeper': return "أمين مخزن";
      default: return "أمين مخزن";
    }
  };

  const getRoleBadgeClasses = (role?: string) => {
    switch (role) {
      case 'general_manager': return "bg-gray-100 text-gray-800 border-gray-200";
      case 'system_admin': return "bg-purple-100 text-purple-800 border-purple-200";
      case 'program_manager': return "bg-rose-100 text-rose-800 border-rose-200";
      case 'supervisor': return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case 'stores_manager': return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case 'storekeeper': return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <div className="space-y-4 text-right font-sans" dir="rtl" id="user-management-panel">
      
      {/* Header Compact - Dropdown + Action Button */}
      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-3xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="relative w-48 shrink-0">
            <select 
              className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs font-black focus:ring-1 focus:ring-emerald-500 bg-slate-50 appearance-none cursor-pointer text-right"
              value={activeSubTab || ""}
              onChange={e => {
                const val = e.target.value as any || null;
                setActiveSubTab(val);
                setEditingUserId(null);
                setSearchQuery("");
              }}
            >
              <option value="">خيارات إدارة المستخدمين</option>
              <option value="add">➕ تكويد مستخدم جديد</option>
              <option value="edit">📝 تعديل مستخدم حالي</option>
            </select>
            <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </div>
          </div>

          {!activeSubTab && (
            <div className="flex items-center gap-1 text-blue-600 animate-pulse ltr">
               <ArrowLeft className="w-3 h-3 rotate-180" />
               <span className="text-[10px] font-black">قم بالاختيار</span>
            </div>
          )}

          {activeSubTab === 'add' && (
            <button 
              onClick={() => {
                setSearchQuery("");
                setNewCode("");
                setNewName("");
                setNewPhone("");
                setNewPassword("123456");
                setNewRole("storekeeper");
                setActiveSubTab(null);
              }}
              className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Search className="w-3 h-3" /> تعيين فلتر
            </button>
          )}

          {activeSubTab === 'edit' && (
            <button 
              onClick={() => {
                setSearchQuery("");
                setEditingUserId(null);
                setActiveSubTab(null);
              }}
              className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Search className="w-3 h-3" /> تعيين فلتر
            </button>
          )}
        </div>

        <div className="hidden md:block">
           {/* Removed redundant label to prevent confusion */}
        </div>
      </div>
      
      {activeSubTab === 'add' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-3xs space-y-3 animate-fadeIn">
          {formError && (
             <div className="text-[10px] font-bold text-red-600 bg-red-50 p-2 rounded-lg border border-red-100 flex items-center gap-2">
                <Info className="w-3 h-3" /> {formError}
             </div>
          )}
          
          <div className="space-y-3">
             {/* Row 1: Code and Role */}
             <div className="flex gap-3">
                <input 
                  placeholder="كود HR" 
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[11px] font-black focus:border-emerald-500 outline-none"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                />
                <select 
                  className="w-1/2 px-2 py-2 border border-slate-200 rounded-lg text-[11px] font-black focus:border-emerald-500 outline-none bg-white text-right"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as any)}
                >
                  <option value="general_manager">المدير العام</option>
                  <option value="system_admin">مسئول النظام</option>
                  <option value="program_manager">مسئول البرنامج</option>
                  <option value="supervisor">مشرف المخازن</option>
                  <option value="stores_manager">مدير مخازن</option>
                  <option value="storekeeper">أمين مخزن</option>
                </select>
             </div>

             {/* Row 2: Name */}
             <input 
               placeholder="اسم الموظف" 
               className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[11px] font-black focus:border-emerald-500 outline-none"
               value={newName}
               onChange={e => setNewName(e.target.value)}
             />

             {/* Row 3: Pass and Phone */}
             <div className="flex gap-3">
                <input 
                  type="password"
                  placeholder="كلمة المرور" 
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[11px] font-black focus:border-emerald-500 outline-none"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
                <input 
                  placeholder="رقم الهاتف" 
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[11px] font-black focus:border-emerald-500 outline-none text-left"
                  value={newPhone}
                  onChange={e => setNewPhone(sanitizePhoneInput(e.target.value))}
                />
             </div>

             <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button 
                  onClick={handleAdd}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> إضافة مستخدم جديد
                </button>
                <button 
                  onClick={() => {
                    setNewCode("");
                    setNewName("");
                    setNewPhone("");
                    setNewPassword("123456");
                    setNewRole("storekeeper");
                    setFormError("");
                    setActiveSubTab(null);
                  }}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-black rounded-xl border border-slate-200 transition-all cursor-pointer"
                >
                  إلغاء التكويد
                </button>
             </div>
          </div>
        </div>
      )}

      {!activeSubTab && (
        <SalatMessage />
      )}

      {activeSubTab === 'edit' && (
        <div className="space-y-3 animate-fadeIn">
          {/* Search Box & Reset */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="ابحث بالكود أو الاسم لإظهار النتائج..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setEditingUserId(null);
                }}
                className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 outline-none font-bold text-right shadow-3xs bg-white"
              />
            </div>
            <button 
              onClick={() => {
                setSearchQuery("");
                setEditingUserId(null);
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5"
            >
              <X className="w-3 h-3" /> تعيين الفلتر
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredUsers.length === 0 && searchQuery.trim() !== "" && (
              <p className="col-span-full text-center text-slate-400 text-[10px] font-bold py-4">لا توجد نتائج مطابقة...</p>
            )}

            {filteredUsers.map(u => {
              const isEditing = editingUserId === u.code;
              return (
                <div key={u.code} className={`p-3 border rounded-xl bg-white transition-all ${isEditing ? 'border-blue-500 bg-blue-50/20' : 'border-slate-150 hover:border-slate-300 shadow-3xs'}`}>
                  {isEditing ? (
                    <div className="space-y-2.5 animate-fadeIn">
                       <div className="flex gap-2">
                          <input 
                            readOnly 
                            className="flex-1 px-2 py-1.5 border border-slate-100 bg-slate-50 text-slate-400 rounded-lg text-[11px] font-black outline-none cursor-not-allowed" 
                            value={editCode} 
                            placeholder="كود HR" 
                          />
                          <select className="flex-1 px-2 py-1.5 border border-blue-200 rounded-lg text-[11px] font-black outline-none text-right bg-white" value={editRole} onChange={e => setEditRole(e.target.value as any)}>
                            <option value="general_manager">المدير العام</option>
                            <option value="system_admin">مسئول النظام</option>
                            <option value="program_manager">مسئول البرنامج</option>
                            <option value="supervisor">مشرف المخازن</option>
                            <option value="stores_manager">مدير مخازن</option>
                            <option value="storekeeper">أمين مخزن</option>
                          </select>
                       </div>
                       <input className="w-full px-2 py-1.5 border border-blue-200 rounded-lg text-[11px] font-black outline-none" value={editName} onChange={e => setEditName(e.target.value)} placeholder="اسم الموظف" />
                       <div className="flex gap-2">
                          <div className="flex-1 flex flex-col gap-1">
                             <button 
                               type="button"
                               onClick={() => {
                                 setEditPassword("123456");
                                 alert("تم ضبط كلمة المرور إلى 123456 - يرجى حفظ التعديل لتطبيق التغيير.");
                               }}
                               className={`w-full px-2 py-1.5 border rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 ${
                                 editPassword === "123456" 
                                   ? "bg-amber-50 border-amber-300 text-amber-700" 
                                   : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                               }`}
                             >
                               <Lock className="w-3 h-3" />
                               {editPassword === "123456" ? "كلمة المرور الجديدة: 123456" : "إعادة تعين كلمة مرور"}
                             </button>
                          </div>
                          <input className="flex-1 px-2 py-1.5 border border-blue-200 rounded-lg text-[11px] font-black outline-none text-left" value={editPhone} onChange={e => setEditPhone(sanitizePhoneInput(e.target.value))} placeholder="رقم الهاتف" />
                       </div>
                        <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-blue-100 gap-2">
                          <button 
                            type="button"
                            onClick={() => {
                              if (deleteConfirmCode === editCode) {
                                onDeleteUser(editCode);
                                setEditingUserId(null);
                                setDeleteConfirmCode(null);
                              } else {
                                setDeleteConfirmCode(editCode);
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all flex items-center gap-1.5 ${
                              deleteConfirmCode === editCode 
                                ? "bg-red-600 text-white border-red-700 animate-pulse" 
                                : "bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100"
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            {deleteConfirmCode === editCode ? "تأكيد الحذف النهائي؟" : "حذف الحساب"}
                          </button>

                          <div className="flex items-center gap-2">
                            <button 
                              type="button"
                              onClick={() => setEditIsActivated(!editIsActivated)}
                              className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${
                                editIsActivated ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"
                              }`}
                            >
                              {editIsActivated ? "الحساب نشط (مفعل)" : "الحساب موقوف (معطل)"}
                            </button>
                          </div>
                        </div>

                       <div className="flex gap-2 mt-1">
                          <button 
                            onClick={handleSaveEdit}
                            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-md text-[10px] font-black rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                             <CheckCircle className="w-3.5 h-3.5" /> حفظ التعديل
                          </button>
                          <button 
                            onClick={() => {
                              setEditingUserId(null);
                              setDeleteConfirmCode(null);
                            }} 
                            className="flex-1 py-1.5 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-all"
                          >
                            الغاء التعديل
                          </button>
                       </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                       <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                             <div className="flex flex-col items-start gap-0.5">
                                <span className="font-black text-slate-900 text-xs">{u.name}</span>
                             </div>
                            {!u.isActivated && (
                              <span className="text-[8px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-md font-black border border-red-100">موقوف ❌</span>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${getRoleBadgeClasses(u.role)}`}>{getRoleLabel(u.role)}</span>
                       </div>
                       <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold border-t border-slate-50 pt-2 mt-1">
                          <div className="flex items-center gap-1">
                             <span className="text-slate-300">#</span>
                             <span className="font-black text-slate-500">{u.code}</span>
                          </div>

                          {u.phone && (
                            <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold">
                              <Phone className="w-2.5 h-2.5" />
                              <span dir="ltr">{u.phone}</span>
                            </div>
                          )}

                          <button 
                            onClick={() => startEdit(u)} 
                            className="px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 rounded-lg text-[9px] font-black transition-all flex items-center gap-1.5"
                          >
                            <Settings className="w-3 h-3" />
                            تعديل اليوزر
                          </button>
                       </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
