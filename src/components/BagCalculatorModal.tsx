import React, { useState } from "react";
import { X, Plus, Trash2, Calculator, Scale } from "lucide-react";
import { AuditItem, BagCalculatorDetails, PalletConfig } from "../types";

interface BagCalculatorModalProps {
  key?: React.Key;
  item: AuditItem;
  isOpen: boolean;
  onClose: () => void;
  onSave: (calculatedQty: number, details: BagCalculatorDetails) => void;
  isReadOnly?: boolean;
}

interface PalletConfigStr {
  palletCountStr: string;
  bagsPerPalletStr: string;
}

const BAG_WEIGHTS = [50, 25, 20, 15, 10, 5];
const PREDEFINED_PALLET_CLASSES = ["36", "30", "60", "70", "75", "50", "100"];

export const extractWeightFromName = (name: string): number => {
  if (!name) return 50;
  const normalized = name.toLowerCase();
  
  // Pattern 1: e.g. "50 كجم" or "25كجم" or "20 kg" or "50ك"
  const kgMatch = normalized.match(/(\d+)\s*(كجم|كج|كيلو|ك|kg)/);
  if (kgMatch) {
    const w = parseInt(kgMatch[1], 10);
    if (BAG_WEIGHTS.includes(w)) return w;
  }

  // Pattern 2: match standard standalone weights
  const standaloneMatches = normalized.match(/\b(50|25|20|15|10|5)\b/g);
  if (standaloneMatches && standaloneMatches.length > 0) {
    return parseInt(standaloneMatches[0], 10);
  }

  // Pattern 3: substring weights check
  for (const w of BAG_WEIGHTS) {
    if (normalized.includes(String(w))) {
      return w;
    }
  }

  return 50; // default fallback
};

// Safe evaluator for mathematical addition and subtraction expressions (e.g., 50+10-5)
const parseMathExpression = (strToParse: string): number => {
  if (!strToParse) return 0;
  // Keep only numbers, decimals, addition (+) and subtraction (-) signs
  const clean = strToParse.replace(/[^0-9.+-]/g, "");
  
  // Clean double signs gracefully (e.g. ++, --, +-, -+) to prevent typos
  const processed = clean
    .replace(/\++/g, "+")
    .replace(/-+/g, "-")
    .replace(/\+-/g, "-")
    .replace(/-\+/g, "-");

  // Safe parsing by capturing numbers optionally prefixed by + or -
  const matches = processed.match(/[+-]?[0-9.]+/g);
  if (!matches) return 0;
  
  return matches.reduce((sum, match) => {
    const num = parseFloat(match);
    return sum + (isNaN(num) ? 0 : num);
  }, 0);
};

export default function BagCalculatorModal({
  item,
  isOpen,
  onClose,
  onSave,
  isReadOnly = false,
}: BagCalculatorModalProps) {
  // Initialize state with existing details if they exist, or empty defaults
  const [bagWeight, setBagWeight] = useState<number>(() => {
    if (item.calculatorDetails?.bagWeight !== undefined) {
      return item.calculatorDetails.bagWeight;
    }
    return extractWeightFromName(item.itemName);
  });

  // Load existing pallets or start with an EMPTY list as requested
  const [pallets, setPallets] = useState<PalletConfigStr[]>(() => {
    if (item.calculatorDetails?.pallets && item.calculatorDetails.pallets.length > 0) {
      return item.calculatorDetails.pallets.map(p => ({
        palletCountStr: p.palletCountStr ?? (p.palletCount === 0 ? "" : String(p.palletCount)),
        bagsPerPalletStr: p.bagsPerPalletStr ?? (p.bagsPerPallet === 0 ? "" : String(p.bagsPerPallet)),
      }));
    }
    return []; // Start completely empty as requested!
  });

  const [looseBagsStr, setLooseBagsStr] = useState<string>(() => {
    if (item.calculatorDetails?.looseBagsStr !== undefined) {
      return item.calculatorDetails.looseBagsStr;
    }
    if (item.calculatorDetails?.looseBags !== undefined && item.calculatorDetails.looseBags !== 0) {
      return String(item.calculatorDetails.looseBags);
    }
    return ""; // Empty by default
  });

  const [activeInput, setActiveInput] = useState<{
    target: 'loose' | 'palletCount' | 'bagsPerPallet';
    index?: number;
  }>({ target: 'loose' });

  if (!isOpen) return null;

  // Helper to get default bags per pallet based on weight and row count
  const getDefaultBagsPerPallet = (weight: number, rowIndex: number): string => {
    if (weight === 50) {
      return rowIndex === 0 ? "36" : (rowIndex === 1 ? "30" : "");
    }
    if (weight === 25) {
      if (rowIndex === 0) return "75";
      if (rowIndex === 1) return "70";
      if (rowIndex === 2) return "60";
      return "";
    }
    if (weight === 20) return "50";
    if ([15, 10, 5].includes(weight)) return "100";
    return "";
  };

  // Add a new pallet row with completely empty strings
  const addPalletRow = () => {
    if (isReadOnly) return;
    const defaultBags = getDefaultBagsPerPallet(bagWeight, pallets.length);
    setPallets([...pallets, { palletCountStr: "", bagsPerPalletStr: defaultBags }]);
    // Select the new pallet-count row immediately
    setActiveInput({ target: 'palletCount', index: pallets.length });
  };

  // Remove a pallet row
  const removePalletRow = (index: number) => {
    if (isReadOnly) return;
    const updated = pallets.filter((_, idx) => idx !== index);
    setPallets(updated);
    if (activeInput.index === index) {
      setActiveInput({ target: 'loose' });
    }
  };

  const updatePalletRawDirect = (index: number, key: keyof PalletConfigStr, strValue: string) => {
    if (isReadOnly) return;
    const updated = pallets.map((p, idx) => {
      if (idx === index) {
        return { ...p, [key]: strValue };
      }
      return p;
    });
    setPallets(updated);
  };

  // Update specific pallet cell as raw string
  const updatePalletRaw = (index: number, key: keyof PalletConfigStr, strValue: string) => {
    if (isReadOnly) return;
    // For pallet inputs, only allow digits, plus (+), and dots (.) - NO subtraction (minus) sign allowed for pallets as requested!
    const cleanStr = strValue.replace(/[^0-9.+]/g, "");
    updatePalletRawDirect(index, key, cleanStr);
  };

  const handleKeyPress = (key: string) => {
    if (isReadOnly) return;
    
    let currentValue = "";
    let setValue: (val: string) => void = () => {};

    if (activeInput.target === 'loose') {
      currentValue = looseBagsStr;
      setValue = setLooseBagsStr;
    } else if (activeInput.target === 'palletCount' && activeInput.index !== undefined) {
      const p = pallets[activeInput.index];
      if (p) {
        currentValue = p.palletCountStr;
        setValue = (val) => {
          const filtered = val.replace(/[^0-9.+]/g, "");
          updatePalletRawDirect(activeInput.index!, "palletCountStr", filtered);
        };
      }
    } else if (activeInput.target === 'bagsPerPallet' && activeInput.index !== undefined) {
      const p = pallets[activeInput.index];
      if (p) {
        currentValue = p.bagsPerPalletStr;
        setValue = (val) => {
          const filtered = val.replace(/[^0-9.+]/g, "");
          updatePalletRawDirect(activeInput.index!, "bagsPerPalletStr", filtered);
        };
      }
    }

    if (key === "BACKSPACE") {
      setValue(currentValue.slice(0, -1));
    } else if (key === "CLEAR") {
      setValue("");
    } else {
      setValue(currentValue + key);
    }
  };

  // Parse strings to numbers in real-time
  const looseBagsVal = parseMathExpression(looseBagsStr);
  const totalPalletBags = pallets.reduce((sum, p) => {
    const pCount = parseMathExpression(p.palletCountStr);
    const bPerP = parseMathExpression(p.bagsPerPalletStr);
    return sum + (pCount * bPerP);
  }, 0);

  const totalBags = totalPalletBags + looseBagsVal;
  const totalWeightKg = totalBags * bagWeight;

  // Real-time calculation and typo/error prevention states
  const isDanglingLoose = /[-+]$/.test(looseBagsStr);
  const isDoubleLoose = /[-+]{2,}/.test(looseBagsStr);
  const isNegativeLoose = looseBagsVal < 0;

  const palletWarnings = pallets.map((p) => {
    const dCount = /[-+]$/.test(p.palletCountStr);
    const dPer = /[-+]$/.test(p.bagsPerPalletStr);
    const dbCount = /[-+]{2,}/.test(p.palletCountStr);
    const dbPer = /[-+]{2,}/.test(p.bagsPerPalletStr);
    
    const countVal = parseMathExpression(p.palletCountStr);
    const perVal = parseMathExpression(p.bagsPerPalletStr);
    const isNegCount = countVal < 0;
    const isNegPer = perVal < 0;
    const isNegRow = (countVal * perVal) < 0;

    const isMissingPer = !p.bagsPerPalletStr.trim() || perVal <= 0;

    return {
      dangling: dCount || dPer,
      double: dbCount || dbPer,
      negative: isNegCount || isNegPer || isNegRow,
      missingPer: isMissingPer
    };
  });

  const hasAnyDangling = isDanglingLoose || palletWarnings.some(w => w.dangling);
  const hasAnyDouble = isDoubleLoose || palletWarnings.some(w => w.double);
  const hasAnyNegative = isNegativeLoose || palletWarnings.some(w => w.negative) || totalBags < 0;
  const hasMissingFiaa = pallets.some(p => !p.bagsPerPalletStr.trim() || parseMathExpression(p.bagsPerPalletStr) <= 0);

  const handleApply = () => {
    if (isReadOnly) return;
    if (hasAnyNegative || hasMissingFiaa) return; // Prevent saving if negative or missing required input!
    const finalPallets: PalletConfig[] = pallets.map(p => ({
      palletCount: parseMathExpression(p.palletCountStr),
      bagsPerPallet: parseMathExpression(p.bagsPerPalletStr),
      palletCountStr: p.palletCountStr,
      bagsPerPalletStr: p.bagsPerPalletStr,
    }));

    const finalDetails: BagCalculatorDetails = {
      bagWeight,
      pallets: finalPallets,
      looseBags: looseBagsVal,
      looseBagsStr: looseBagsStr,
    };
    onSave(totalWeightKg, finalDetails);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 bg-slate-900/70 backdrop-blur-xs transition-opacity duration-300 animate-fade-in" dir="rtl">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[96vh]">
        {/* Header - Compact */}
        <div className="bg-indigo-900 text-white px-4 py-2.5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-white/10 rounded-lg">
              <Calculator className="w-4 h-4 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="font-extrabold text-xs md:text-sm leading-tight text-right">حاسبة الجرد الفعلية</h2>
              <p className="text-[10px] text-blue-100/90 mt-0.5 text-right">الصنف: <span className="font-black text-amber-300 text-[11px]">{item.itemName}</span></p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-white/10 text-white/95 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content - Compact Scrollable */}
        <div className="p-2.5 overflow-y-auto space-y-2 flex-1 text-right">

          {/* Step 1: Bag Weight Selection - Very Compact */}
          <div className="space-y-1 p-2 border border-slate-200 rounded-xl">
            <span className="block text-[10px] font-black text-slate-700 flex items-center gap-1 justify-start">
              <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-150 text-blue-700 text-[9px] font-extrabold leading-none">١</span>
              فئة الوزن المحددة للصنف :
            </span>
            <div className="grid grid-cols-6 gap-1">
              {BAG_WEIGHTS.map((weight) => (
                <button
                  type="button"
                  key={weight}
                  disabled={isReadOnly}
                  onClick={() => setBagWeight(weight)}
                  className={`py-0.5 px-0.5 rounded-lg font-bold font-sans text-[11px] transition-all border flex flex-col items-center justify-center cursor-pointer ${
                    bagWeight === weight
                      ? "bg-blue-600 border-blue-600 text-white shadow-xs scale-[1.01]"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-[11px] font-black">{weight} ك</span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Pallets details - Optimized Height */}
          <div className="space-y-1 p-2 border border-slate-200 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="block text-[10px] font-black text-slate-700 flex items-center gap-1 justify-start">
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-150 text-blue-700 text-[9px] font-extrabold leading-none">٢</span>
                عدد البلتات الكاملة ( يدعم الجمع فقط ) :
              </span>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={addPalletRow}
                  className="px-1.5 py-0.5 text-[9px] font-extrabold text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 rounded-md flex items-center gap-0.5 transition-all cursor-pointer border border-blue-100 hover:border-blue-600"
                >
                  <Plus className="w-2.5 h-2.5" />
                  إضافة سطر
                </button>
              )}
            </div>

            {pallets.length === 0 ? (
              <div className="text-center py-2 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-250 text-[10px] font-bold">
                لا توجد بلتات حية مضافة حالياً.
              </div>
            ) : (
              <div className="space-y-1 max-h-[120px] overflow-y-auto pr-0.5">
                {pallets.map((pallet, pIdx) => {
                  const pCount = parseMathExpression(pallet.palletCountStr);
                  const bPerP = parseMathExpression(pallet.bagsPerPalletStr);
                  const rowTotalBags = pCount * bPerP;
                  const warnings = palletWarnings[pIdx];

                  const isActiveCount = activeInput.target === 'palletCount' && activeInput.index === pIdx;
                  const isActivePer = activeInput.target === 'bagsPerPallet' && activeInput.index === pIdx;

                  return (
                    <div 
                      key={pIdx} 
                      className={`p-1.5 rounded-lg border transition-all space-y-1 ${
                        warnings.negative
                          ? "bg-rose-50/70 border-rose-300"
                          : warnings.dangling || warnings.double
                            ? "bg-amber-50/70 border-amber-305"
                            : "bg-slate-50/75 border-slate-200"
                      }`}
                    >
                      {/* Flex layout for compact pallet data */}
                      <div className="flex items-center gap-1.5">
                        {/* Number of Pallets Input */}
                        <div className="flex-1 min-w-[120px] text-right">
                          <label className="block text-[8px] font-extrabold text-slate-500 mb-0.5 select-none text-right">عدد البلتات</label>
                          <input
                            type="text"
                            dir="ltr"
                            inputMode="none"
                            disabled={isReadOnly}
                            value={pallet.palletCountStr}
                            onFocus={() => setActiveInput({ target: 'palletCount', index: pIdx })}
                            onChange={(e) => updatePalletRaw(pIdx, "palletCountStr", e.target.value)}
                            className={`w-full bg-white border rounded-md px-1.5 py-0.5 font-bold font-mono text-[11px] text-left focus:outline-none ${
                              isActiveCount ? "ring-2 ring-blue-500 border-blue-500 bg-blue-50/20" : "border-slate-300"
                            } ${warnings.negative ? "border-rose-300 text-rose-700" : ""}`}
                            placeholder=""
                          />
                        </div>

                        {/* Bags per Pallet Selection */}
                        <div className="w-11 text-right shrink-0">
                          <label className="block text-[8px] font-extrabold text-slate-500 mb-0.5 select-none text-right">فئة</label>
                          {(() => {
                            const isPredefined = PREDEFINED_PALLET_CLASSES.includes(pallet.bagsPerPalletStr) || pallet.bagsPerPalletStr === '';
                            
                            if (isPredefined && !isReadOnly) {
                              return (
                                <select
                                  dir="rtl"
                                  value={pallet.bagsPerPalletStr}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === 'manual') {
                                      updatePalletRawDirect(pIdx, "bagsPerPalletStr", " ");
                                    } else {
                                      updatePalletRawDirect(pIdx, "bagsPerPalletStr", val);
                                    }
                                  }}
                                  className={`w-full bg-white border rounded-md px-0 py-0.5 font-bold text-[9px] text-center focus:outline-none appearance-none cursor-pointer ${
                                    isActivePer ? "ring-1 ring-blue-500 border-blue-500 bg-blue-50/10" : "border-slate-300"
                                  }`}
                                >
                                  <option value="">--</option>
                                  {PREDEFINED_PALLET_CLASSES.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                  <option value="manual">يدوي</option>
                                </select>
                              );
                            }

                            return (
                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  dir="ltr"
                                  inputMode="none"
                                  maxLength={3}
                                  disabled={isReadOnly}
                                  value={pallet.bagsPerPalletStr.trim()}
                                  onFocus={() => setActiveInput({ target: 'bagsPerPallet', index: pIdx })}
                                  onChange={(e) => {
                                    let val = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                                    if (val.startsWith('0')) val = val.slice(1);
                                    updatePalletRawDirect(pIdx, "bagsPerPalletStr", val || " ");
                                  }}
                                  className={`w-full bg-white border rounded-md px-0.5 py-0.5 font-bold font-mono text-[9px] text-center focus:outline-none ${
                                    isActivePer ? "ring-1 ring-blue-500 border-blue-500 bg-blue-50/10" : "border-slate-300"
                                  } ${warnings.missingPer ? "border-amber-300 bg-amber-50/10 text-amber-900" : ""}`}
                                  placeholder="فئة"
                                />
                                {!isReadOnly && !isPredefined && (
                                  <button 
                                    onClick={() => updatePalletRawDirect(pIdx, "bagsPerPalletStr", "")}
                                    className="absolute -right-1 -top-1 p-0.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-400 cursor-pointer shadow-sm border border-slate-200"
                                    title="رجوع"
                                  >
                                    <X className="w-2 h-2" />
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Total bags in this row */}
                        <div className="w-13 text-center pt-3.5">
                          <div className={`border py-0.5 px-1 rounded-md text-center font-black font-mono text-[10px] select-none ${
                            rowTotalBags < 0 ? "bg-rose-100 border-rose-200 text-rose-700" : "bg-blue-50/70 border-blue-100 text-blue-700"
                          }`} title="إجمالي الشكاير للسطر">
                            {rowTotalBags.toLocaleString("ar-EG")}
                          </div>
                        </div>

                        {/* Delete Button */}
                        {!isReadOnly && (
                          <div className="pt-3.5">
                            <button
                              type="button"
                              onClick={() => removePalletRow(pIdx)}
                              className="p-1 text-rose-500 hover:text-white hover:bg-rose-600 bg-white border border-slate-250 hover:border-rose-600 rounded-md transition-colors cursor-pointer flex items-center justify-center h-[24px] w-[24px]"
                              title="حذف السطر"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Warnings if any */}
                      {(warnings.double || warnings.negative) && (
                        <div className="text-[8px] font-black select-none text-right flex items-center gap-1 justify-start">
                          {warnings.negative && <span className="text-rose-600">⚠️ تنبيه: ناتج السطر سلبي!</span>}
                          {!warnings.negative && warnings.double && <span className="text-amber-700">⚠️ تنبيه: علامات تشغيل متكررة.</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3: Loose Bags - Compact inline inputs */}
          <div className="space-y-1 p-2 border border-slate-200 rounded-xl">
            <span className="block text-[10px] font-black text-slate-700 flex items-center gap-1 justify-start">
              <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-150 text-blue-700 text-[9px] font-extrabold leading-none">٣</span>
              عدد الشكائر المنفردة ( يدعم الجمع والطرح ) :
            </span>
            <div className={`p-1 rounded-lg border flex items-center gap-1.5 ${
              isNegativeLoose ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200"
            }`}>
              <div className="flex-1">
                <input
                  type="text"
                  dir="ltr"
                  inputMode="none"
                  disabled={isReadOnly}
                  value={looseBagsStr}
                  onFocus={() => setActiveInput({ target: 'loose' })}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.+-]/g, "");
                    setLooseBagsStr(val);
                  }}
                  className={`w-full bg-white border rounded-md px-1.5 py-1 font-bold font-mono text-[11px] text-left focus:outline-none ${
                    activeInput.target === 'loose' ? "ring-2 ring-blue-500 border-blue-500 bg-blue-50/20" : "border-slate-300"
                  } ${isNegativeLoose ? "border-rose-300 text-rose-700" : ""}`}
                  placeholder=""
                />
              </div>
              <div className="w-16 shrink-0">
                <div className={`border py-1 px-1 rounded-md text-center font-black font-mono text-[10px] h-[26px] flex items-center justify-center select-none ${
                  looseBagsVal < 0 
                    ? "bg-rose-100 border-rose-200 text-rose-700" 
                    : "bg-blue-50 border-blue-100 text-blue-700"
                }`}>
                  {looseBagsVal}
                </div>
              </div>
            </div>

            {/* Loose Bags feedback */}
            {(isDoubleLoose || isNegativeLoose) && (
              <div className="text-[8px] font-bold px-1 select-none flex items-center gap-1 justify-start">
                {isNegativeLoose && <span className="text-rose-650 font-black">❌ تنبيه: الشكاير السائبة الكلية لا يمكن أن تكون أقل من الصفر!</span>}
                {!isNegativeLoose && isDoubleLoose && <span className="text-amber-750">⚠️ تنبيه: تم رصد علامتي تشغيل متتاليتين.</span>}
              </div>
            )}
          </div>

          {/* CUSTOM BUILT-IN NUMERIC TOUCHPAD - BEAUTIFUL COMPACT GRAPHIC PANEL UNDER STEP 3 */}
          {!isReadOnly && (
            <div className="bg-slate-50 px-2 py-1.5 rounded-xl border border-slate-200 shadow-xs space-y-1 mt-0.5">
              <div className="flex items-center justify-between px-0.5 leading-none">
                <span className="text-[9px] font-black text-slate-800">
                  لوحة أرقام الجرد الذكية :
                </span>
              </div>
              
              <div className="flex gap-1 text-center select-none" dir="ltr">
                <div className="grid grid-cols-4 gap-1 flex-1">
                  {[
                    { value: "1", label: "1", isAction: false },
                    { value: "2", label: "2", isAction: false },
                    { value: "3", label: "3", isAction: false },
                    { value: "+", label: "+", isAction: true, className: "row-span-2 bg-amber-500 border border-amber-600 hover:bg-amber-600 text-white font-black text-xl" },
                    
                    { value: "4", label: "4", isAction: false },
                    { value: "5", label: "5", isAction: false },
                    { value: "6", label: "6", isAction: false },
                    
                    { value: "7", label: "7", isAction: false },
                    { value: "8", label: "8", isAction: false },
                    { value: "9", label: "9", isAction: false },
                    { value: "0", label: "0", isAction: false },
                  ].map((btn, bIdx) => (
                    <button
                       type="button"
                       key={bIdx}
                       onClick={() => handleKeyPress(btn.value)}
                       className={`py-2 px-0.5 rounded-md font-bold font-sans text-sm transition-all flex items-center justify-center cursor-pointer ${
                        btn.className 
                          ? btn.className 
                          : "bg-white border border-slate-200 text-slate-800 hover:border-slate-350 hover:bg-slate-50 h-10"
                       }`}
                    >
                       {btn.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-rows-3 gap-1 w-[42px] shrink-0">
                  <button
                    type="button"
                    onClick={() => handleKeyPress("BACKSPACE")}
                    className="row-span-2 bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 font-extrabold rounded-md flex flex-col items-center justify-center transition-all cursor-pointer h-20"
                  >
                    <span className="text-sm leading-none mb-1">⌫</span>
                    <span className="text-[10px] leading-none">مسح</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeyPress("-")}
                    className="bg-purple-600 border border-purple-700 hover:bg-purple-700 text-white font-black rounded-md flex items-center justify-center transition-all cursor-pointer text-xl h-10"
                  >
                    -
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error and Alert States */}
          {hasAnyNegative && (
            <div className="bg-rose-50 border border-rose-200 p-1 rounded-lg text-right">
              <p className="font-bold text-rose-850 text-[10px]">
                ⚠️ خطأ: ناتج الاحتساب سلبي (أقل من الصفر كإجمالي جرد، يرجى المراجعة).
              </p>
            </div>
          )}

          {hasMissingFiaa && pallets.length > 0 && (
            <div className="bg-amber-50 border border-amber-250 p-1 rounded-lg text-right">
              <p className="font-bold text-amber-850 text-[10px]">
                ⚠️ تنبيه: يرجى كتابة فئة بلتة صحيحة لجميع الأسطر (الرقم فارغ أو صفر).
              </p>
            </div>
          )}

          {/* Compact calculation line summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] flex justify-between items-center flex-wrap gap-1 leading-tight shrink-0">
            <div className="font-sans font-bold text-slate-600 text-right">
              إجمالي الكمية :
            </div>
            <div className="font-sans font-black text-blue-800 bg-blue-50 border border-blue-105 px-2 py-0.5 rounded-lg text-left">
              <span className="font-mono text-[10px]">{totalBags} × {bagWeight} كجم = </span>
              <span className="font-mono text-xs font-black text-blue-700">{totalWeightKg.toLocaleString("ar-EG")} كجم</span>
            </div>
          </div>
        </div>

        {/* Footer actions - Very Compact */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex gap-2 shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-[11px] font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-all cursor-pointer"
          >
            إغلاق
          </button>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleApply}
              disabled={hasAnyNegative || hasMissingFiaa}
              className={`px-5 py-2.5 text-[11px] font-extrabold text-white rounded-lg flex items-center gap-1 transition-all shadow-xs ${
                (hasAnyNegative || hasMissingFiaa)
                  ? "bg-slate-350 text-slate-450 cursor-not-allowed" 
                  : "bg-blue-600 hover:bg-blue-750 hover:scale-[1.01] cursor-pointer"
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              {hasAnyNegative 
                ? "الحساب معطل ⚠️" 
                : hasMissingFiaa 
                  ? "حدد فئة البلتة ⚠️" 
                  : `اعتماد (${totalWeightKg} كجم) ✓`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
