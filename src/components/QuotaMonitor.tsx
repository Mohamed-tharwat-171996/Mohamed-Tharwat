import React, { useState, useEffect } from "react";
import { Database, Cloud, HardDrive, Users, Activity, Play, Pause, AlertTriangle } from "lucide-react";

const QUOTAS = {
  reads: 50000,
  writes: 40000,
  deletes: 20000,
  storageBytes: 1 * 1024 * 1024 * 1024, // 1 GB
};

interface UserConsumption {
  code: string;
  name: string;
  reads: number;
  writes: number;
  actions: Record<string, number>;
}

interface QuotaMonitorProps {
  isFirebaseSyncDisabled?: boolean;
  onToggleFirebaseSync?: (disabled: boolean) => void;
}

export default function QuotaMonitor({ 
  isFirebaseSyncDisabled: propIsFirebaseSyncDisabled, 
  onToggleFirebaseSync 
}: QuotaMonitorProps = {}) {
  const [usage, setUsage] = useState({ reads: 0, writes: 0, deletes: 0, storageBytes: 0, isLive: false });
  const [userCons, setUserCons] = useState<UserConsumption[]>([]);
  const [localSyncDisabled, setLocalSyncDisabled] = useState(() => {
    return localStorage.getItem("inventory_firebase_sync_disabled") === "true";
  });

  const isSyncDisabled = propIsFirebaseSyncDisabled ?? localSyncDisabled;

  const handleToggleSync = () => {
    const newValue = !isSyncDisabled;
    setLocalSyncDisabled(newValue);
    localStorage.setItem("inventory_firebase_sync_disabled", String(newValue));
    if (onToggleFirebaseSync) {
      onToggleFirebaseSync(newValue);
    }
  };

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

  const [isRecalculating, setIsRecalculating] = useState(false);

  const fetchQuota = async () => {
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      if (!token) return;
      
      const res = await fetch("/api/quota", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const result = await res.json();
      
      if (result.status === "ok" && result.quota) {
        const q = result.quota;
        setUsage({
          reads: q.reads || 0,
          writes: q.writes || 0,
          deletes: q.deletes || 0,
          storageBytes: q.storageBytes || 0,
          isLive: !!q.isLive
        });

        if (q.users) {
          const list = Object.entries(q.users).map(([code, data]: [string, any]) => ({
            code,
            name: data.name || code,
            reads: data.reads || 0,
            writes: data.writes || 0,
            actions: {} // Detailed actions are not tracked server-side yet
          })).sort((a, b) => (b.writes + b.reads) - (a.writes + a.reads));
          setUserCons(list);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch global quota from server:", err);
    }
  };

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      const token = localStorage.getItem("inventory_jwt_token");
      const res = await fetch("/api/quota/recalculate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        await fetchQuota();
      }
    } catch (err) {
      console.warn("Failed to recalculate storage:", err);
    }
    setIsRecalculating(false);
  };

  useEffect(() => {
    fetchQuota();
    const interval = setInterval(fetchQuota, 30000); 
    return () => clearInterval(interval);
  }, []);

  const getPercentage = (used: number, total: number) => Math.min(100, Math.round((used / total) * 100));

  return (
    <div className="space-y-6">
      {/* Primary Quotas Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-3xs space-y-5">


        {/* Firestore Section */}
        <div className="space-y-3.5">
          <div className="flex justify-between items-center">
              <h3 className="text-[10.5px] font-bold text-slate-700 flex items-center gap-2">
                  <Cloud className="w-3.5 h-3.5 text-indigo-600" />
                  متابعة استهلاك Firestore (Live Quota Metrics)
              </h3>
              {usage.isLive && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full animate-pulse">
                  <Activity className="w-2.5 h-2.5" />
                  Live Console Data
                </span>
              )}
          </div>

          <div className="space-y-2.5">
              {[
              { label: "قراءات", used: usage.reads, total: QUOTAS.reads, icon: "🔍", color: "bg-indigo-600" },
              { label: "كتابة", used: usage.writes, total: QUOTAS.writes, icon: "📝", color: "bg-amber-500" },
              { label: "حذف (تقديري)", used: usage.deletes, total: QUOTAS.deletes, icon: "🗑️", color: "bg-rose-500" },
              ].map((item, idx) => (
              <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center">
                      <div className="text-[9.5px] font-bold text-slate-500">{item.icon} {item.label}</div>
                      <div className="text-xs font-black text-slate-900">
                          {item.used.toLocaleString()} <span className="text-[9px] font-normal text-slate-400">/ {item.total.toLocaleString()}</span>
                      </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1 mt-1.5">
                  <div className={`${item.color} h-1 rounded-full`} style={{ width: `${getPercentage(item.used, item.total)}%` }}></div>
                  </div>
              </div>
              ))}
          </div>

          <div className={`p-3 rounded-2xl border transition-all duration-500 relative overflow-hidden ${getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 ? "bg-red-50 border-red-300 shadow-[0_0_15px_rgba(220,38,38,0.1)] ring-1 ring-red-400/50" : "bg-slate-50 border-slate-100"}`}>
              {getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 && (
                <div className="absolute top-0 right-0 w-1.5 h-full bg-red-500 animate-pulse"></div>
              )}
              
              <div className="flex justify-between items-center relative z-10">
                  <div className={`text-[10px] font-black flex items-center gap-2 ${getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 ? "text-red-700" : "text-slate-600"}`}>
                    <Database className={`w-3.5 h-3.5 ${getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 ? "text-red-600" : "text-indigo-500"}`} />
                    <span>💾 اجمالي تخزين Firestore</span>
                    <button 
                      onClick={handleRecalculate}
                      disabled={isRecalculating}
                      className="p-1 hover:bg-slate-200 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                      title="إعادة حساب المساحة التخزينية يدوياً"
                    >
                      <Activity className={`w-3 h-3 ${isRecalculating ? 'animate-spin' : 'text-slate-400'}`} />
                    </button>
                    {getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 && (
                      <span className="flex items-center gap-1 bg-red-600 text-white px-2 py-0.5 rounded-md text-[8px] animate-bounce shadow-sm font-black">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        حرِج: المساحة ممتلئة!
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-[11px] font-black ${getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 ? "text-red-700" : "text-slate-900"}`}>
                        {(usage.storageBytes / (1024 * 1024)).toFixed(2)} MB <span className="text-[9px] font-normal text-slate-400">/ 1024 MB</span>
                    </div>
                    <div className="text-[8px] font-bold text-slate-400 mt-0.5">
                      {getPercentage(usage.storageBytes, QUOTAS.storageBytes)}% مستهلك
                    </div>
                  </div>
              </div>
              
              <div className="w-full bg-slate-200 rounded-full h-2 mt-2.5 overflow-hidden border border-slate-100">
                  <div 
                    className={`h-full rounded-full transition-all duration-700 ease-out ${getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 ? "bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)]" : "bg-indigo-600 shadow-[0_0_5px_rgba(79,70,229,0.2)]"}`} 
                    style={{ width: `${getPercentage(usage.storageBytes, QUOTAS.storageBytes)}%` }}
                  ></div>
              </div>
              
              {getPercentage(usage.storageBytes, QUOTAS.storageBytes) >= 75 && (
                <div className="bg-red-100/50 p-2 rounded-lg mt-3 border border-red-200/50">
                  <div className="text-[9px] font-black text-red-600 text-right flex items-start gap-1.5 leading-relaxed">
                    <span className="mt-0.5 shrink-0">⚠️</span>
                    <span>تحذير: لقد تجاوزت 75% من المساحة المتاحة. يرجى أرشفة البيانات القديمة أو تصفير السجلات غير الضرورية فوراً لتجنب توقف خدمات المزامنة السحابية.</span>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* User consumption tracker listing card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-3xs space-y-4">
        <h2 className="text-[11px] font-black text-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          المستخدمون الأكثر استهلاكاً اليوم
        </h2>
        
        {userCons.length === 0 ? (
          <div className="text-[10px] text-slate-400 bg-slate-50 p-5 rounded-2xl border border-dashed border-slate-200 text-center">
            لا توجد سجلات استهلاك للمستخدمين حالياً لهذا اليوم.
          </div>
        ) : (
          <div className="space-y-3.5">
            {userCons.map((item) => {
              const totalOp = item.reads + item.writes;
              return (
                <div key={item.code} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-[10.5px] font-black text-slate-800">{item.name}</span>
                      <span className="text-[9px] text-slate-400 font-mono bg-slate-200 px-1.5 py-0.5 rounded ml-2">کود: {item.code}</span>
                    </div>
                    <span className="text-[10.5px] font-black text-indigo-700 font-mono">
                      {totalOp.toLocaleString()} عملية
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[9px] font-bold text-slate-500">
                    <div className="bg-white p-2 rounded-lg border border-slate-100 flex justify-between">
                      <span>قراءات 🔍:</span>
                      <span className="font-mono text-slate-800">{item.reads}</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-100 flex justify-between">
                      <span>كتابة 📝:</span>
                      <span className="font-mono text-slate-800">{item.writes}</span>
                    </div>
                  </div>

                  {/* Actions details list */}
                  <div className="space-y-1">
                    <span className="text-[9px] text-slate-400 font-bold block">تفاصيل العمليات المسحوبة:</span>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(item.actions).map(([action, count]) => (
                        <span 
                          key={action} 
                          className="text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"
                        >
                          <Activity className="w-2.5 h-2.5 stroke-[3px]" />
                          {action} (x{count})
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
