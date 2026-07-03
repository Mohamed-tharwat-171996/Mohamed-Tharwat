import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { parseExcelText, DEMO_ITEMS } from "../demoData";
import { MasterItem } from "../types";
import { FileDown, X, ClipboardCheck, Sparkles, Check, Info, Upload, FileText, AlertCircle, Plus, Trash2 } from "lucide-react";

interface ImportItemsModalProps {
  onClose: () => void;
  onImport: (items: MasterItem[]) => void;
}

export default function ImportItemsModal({ onClose, onImport }: ImportItemsModalProps) {
  const [activeTab, setActiveTab] = useState<"file" | "paste">("file");
  const [pasteMode, setPasteMode] = useState<"grid" | "raw">("grid");
  const [pasteText, setPasteText] = useState("");
  const [previewItems, setPreviewItems] = useState<MasterItem[]>([]);
  const [importSource, setImportSource] = useState<"paste" | "demo" | "file" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // States for 4-column manual table entry
  const [manualRows, setManualRows] = useState<Array<{ id: string; name: string; bookQty: string; previousDiff: string }>>([
    { id: "", name: "", bookQty: "", previousDiff: "" },
    { id: "", name: "", bookQty: "", previousDiff: "" },
    { id: "", name: "", bookQty: "", previousDiff: "" },
    { id: "", name: "", bookQty: "", previousDiff: "" },
    { id: "", name: "", bookQty: "", previousDiff: "" },
  ]);

  const syncManualRowsToPreview = (rows: Array<{ id: string; name: string; bookQty: string; previousDiff: string }>) => {
    const items: MasterItem[] = rows
      .filter((r) => r.id.trim() !== "" || r.name.trim() !== "")
      .map((r) => {
        const parsedQty = parseFloat(r.bookQty);
        const parsedDiff = parseFloat(r.previousDiff);
        return {
          id: r.id.trim() || `صنف_${Math.random().toString(36).substring(2, 6)}`,
          name: r.name.trim() || "صنف بدون اسم",
          category: "عام",
          bookQty: isNaN(parsedQty) ? 0 : parsedQty,
          unit: "طن",
          previousDiff: isNaN(parsedDiff) ? 0 : parsedDiff,
        };
      });
    setPreviewItems(items);
    setImportSource("paste");
  };

  const handleRowChange = (index: number, field: string, value: string) => {
    const updated = [...manualRows];
    updated[index] = { ...updated[index], [field]: value };
    setManualRows(updated);
    syncManualRowsToPreview(updated);
  };

  const addNewRow = () => {
    const updated = [...manualRows, { id: "", name: "", bookQty: "", previousDiff: "" }];
    setManualRows(updated);
  };

  const removeRow = (index: number) => {
    const updated = manualRows.filter((_, i) => i !== index);
    const finalRows = updated.length > 0 ? updated : [{ id: "", name: "", bookQty: "", previousDiff: "" }];
    setManualRows(finalRows);
    syncManualRowsToPreview(finalRows);
  };

  const clearManualRows = () => {
    const reset = [
      { id: "", name: "", bookQty: "", previousDiff: "" },
      { id: "", name: "", bookQty: "", previousDiff: "" },
      { id: "", name: "", bookQty: "", previousDiff: "" },
      { id: "", name: "", bookQty: "", previousDiff: "" },
      { id: "", name: "", bookQty: "", previousDiff: "" },
    ];
    setManualRows(reset);
    setPreviewItems([]);
    setImportSource(null);
  };

  const handleGridPaste = (e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number) => {
    const pastedText = e.clipboardData.getData("text");
    if (!pastedText) return;

    // Check if it's multi-line or contains tab separators (typical Excel / spreadsheet data)
    if (pastedText.includes("\n") || pastedText.includes("\t") || pastedText.includes("/")) {
      e.preventDefault(); // Stop normal single-cell paste
      
      const parsed = parseExcelText(pastedText);
      if (parsed.length > 0) {
        const updated = [...manualRows];
        
        parsed.forEach((parsedItem, idx) => {
          const targetIdx = rowIndex + idx;
          const newRow = {
            id: parsedItem.id || "",
            name: parsedItem.name || "",
            bookQty: parsedItem.bookQty ? String(parsedItem.bookQty) : "",
            previousDiff: parsedItem.previousDiff ? String(parsedItem.previousDiff) : "",
          };

          if (targetIdx < updated.length) {
            updated[targetIdx] = newRow;
          } else {
            updated.push(newRow);
          }
        });

        setManualRows(updated);
        // Execute sync immediately with the updated rows
        syncManualRowsToPreview(updated);
      }
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPasteText(text);
    setParseError(null);
    setFileName(null);
    if (text.trim()) {
      const parsed = parseExcelText(text);
      setPreviewItems(parsed as MasterItem[]);
      setImportSource("paste");
    } else {
      setPreviewItems([]);
      setImportSource(null);
    }
  };

  const loadDemoData = () => {
    setPreviewItems(DEMO_ITEMS);
    setImportSource("demo");
    setParseError(null);
    setFileName("بيانات تجريبية نموذجية");
  };

  const handleFileParsing = (file: File) => {
    if (!file) return;
    setParseError(null);
    setFileName(file.name);
    setImportSource("file");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          throw new Error("فشل قراءة محتوى الملف المرفوع.");
        }

        // Parse file buffer into worksheet with SheetJS
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Format as a raw list of arrays (rows)
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

        if (!rows || rows.length === 0) {
          throw new Error("الملف المستورد فارغ أو بدون صفوف بيانات صالحة.");
        }

        const parsedItems: MasterItem[] = [];

        // Skip headers if the first row contains column labels (e.g. text labels instead of actual numerical ID data)
        let startIdx = 0;
        if (rows.length > 1) {
          const firstRow = rows[0];
          const hasHeader = firstRow.some(cell => {
            if (typeof cell === "string") {
              const cl = cell.trim().toLowerCase();
              return cl.includes("كود") || cl.includes("الاسم") || cl.includes("الصنف") || cl.includes("id") || cl.includes("name") || cl.includes("رقم");
            }
            return false;
          });
          if (hasHeader) {
            startIdx = 1;
          }
        }

        for (let i = startIdx; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const rawId = row[0];
          if (rawId === undefined || rawId === null || String(rawId).trim() === "") continue;

          let id = String(rawId).trim();
          let name = row[1] !== undefined && row[1] !== null ? String(row[1]).trim() : "";
          let bookQty = 0;
          let previousDiff = 0;
          let category = "عام";
          let unit = "طن"; // standard default for feed bags or tons

          // Detect Category or Unit if available in columns we expect
          // Col 2: book quantity
          if (row[2] !== undefined && row[2] !== null) {
            const q = parseFloat(row[2]);
            if (!isNaN(q)) bookQty = q;
          }

          // Col 3: previous difference
          if (row[3] !== undefined && row[3] !== null) {
            const pd = parseFloat(row[3]);
            if (!isNaN(pd)) previousDiff = pd;
          }

          if (!name) {
            name = `صنف رقم ${id}`;
          }

          parsedItems.push({
            id,
            name,
            category,
            bookQty,
            unit,
            previousDiff
          });
        }

        if (parsedItems.length === 0) {
          throw new Error("لم نتمكن من العثور على أي أصناف صالحة للجرد بالصيغة المطلوبة.");
        }

        setPreviewItems(parsedItems);
        setFileName(`${file.name} (تم جلب ${parsedItems.length} صنف بنجاح)`);
        
        // IMMEDIATE GC TRIGGER: Reset the input value to completely free raw file buffers
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (err: any) {
        setParseError(err.message || "حدث خطأ غير متوقع أثناء تفكيك وقراءة ملف الجرد.");
        setFileName(null);
        setPreviewItems([]);
      }
    };

    reader.onerror = () => {
      setParseError("تعذر قراءة ملف الإكسل بشكل مادي من وحدة التخزين.");
      setFileName(null);
      setPreviewItems([]);
    };

    reader.readAsArrayBuffer(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileParsing(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Validate sheet types
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "xlsx" || ext === "xls" || ext === "csv" || ext === "txt") {
        handleFileParsing(file);
      } else {
        setParseError("يرجى استخدام ملفات من نوع Excel أو CSV فقط (.xlsx, .xls, .csv)");
      }
    }
  };

  const handleConfirmImport = () => {
    if (previewItems.length > 0) {
      onImport(previewItems);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-lg">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-800">تحميل الجرد اليومي (الإيمان للأعلاف)</h3>
              <p className="text-xs text-slate-500 mt-0.5">ارفع ملف إكسيل مباشرة أو انسخ البيانات لطلب الرصيد الفعلي من أمناء الورشة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 transition-colors text-slate-400 hover:text-slate-600 cursor-pointer"
            id="modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5" dir="rtl">
          {/* Tab Switcher */}
          <div className="flex bg-slate-100 p-1.5 rounded-xl font-semibold text-xs border border-slate-200">
            <button
              onClick={() => {
                setActiveTab("file");
                setParseError(null);
              }}
              type="button"
              className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                activeTab === "file"
                  ? "bg-white text-blue-700 shadow-sm font-bold"
                  : "text-slate-600 hover:bg-slate-200/50"
              }`}
            >
              📥 رفع ملف Excel مباشر (.xlsx, .csv)
            </button>
            <button
              onClick={() => {
                setActiveTab("paste");
                setParseError(null);
              }}
              type="button"
              className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                activeTab === "paste"
                  ? "bg-white text-blue-700 shadow-sm font-bold"
                  : "text-slate-600 hover:bg-slate-200/50"
              }`}
            >
              📋 لصق يدوي تقليدي من الخلايا
            </button>
          </div>

          {activeTab === "file" ? (
            <div className="space-y-4">
              {/* Excel Drag and Drop box */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? "border-blue-500 bg-blue-50/75 scale-[0.99]"
                    : "border-slate-300 hover:border-blue-400 hover:bg-slate-50/55"
                }`}
              >
                <div className={`p-4 rounded-full ${isDragging ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"} transition-colors`}>
                  <Upload className="w-8 h-8 animate-bounce" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-slate-800">اسحب وأفلت ملف الـ (Excel) هنا</h4>
                  <p className="text-xs text-slate-400">أو اسحب ملف CSV / ملف نصي مفصول بفاصلة</p>
                  <p className="text-[10px] text-blue-500 bg-blue-50 inline-block px-2.5 py-1 rounded-md mt-1.5 font-medium">يدعم صيغ .xlsx | .xls | .csv | .txt</p>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx,.xls,.csv,.tsv,.txt"
                  className="hidden"
                />
              </div>

              {parseError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[11px] font-bold rounded-xl flex items-center gap-2 leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {fileName && (
                <div className="p-3 bg-blue-50/80 border border-blue-100 text-blue-800 text-[11px] font-bold rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                    <span>الملف النشط حالياً: {fileName}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileName(null);
                      setPreviewItems([]);
                      setImportSource(null);
                    }}
                    type="button"
                    className="text-red-500 hover:text-red-700 text-xs hover:underline"
                  >
                    إلغاء وتفريغ
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mode Switcher for the Paste Tab */}
              <div className="flex gap-2 p-1 bg-slate-200/60 rounded-xl max-w-sm">
                <button
                  type="button"
                  onClick={() => {
                    setPasteMode("grid");
                    syncManualRowsToPreview(manualRows);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-center text-xs font-bold transition-all cursor-pointer ${
                    pasteMode === "grid"
                      ? "bg-white text-blue-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  📊 جدول بأربعة أعمدة
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasteMode("raw");
                    if (pasteText.trim()) {
                      const parsed = parseExcelText(pasteText);
                      setPreviewItems(parsed);
                    } else {
                      setPreviewItems([]);
                    }
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-center text-xs font-bold transition-all cursor-pointer ${
                    pasteMode === "raw"
                      ? "bg-white text-blue-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  ✍️ لصق نصي مباشر
                </button>
              </div>

              {pasteMode === "grid" ? (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 rounded-xl border border-blue-100/70">
                    <p className="text-xs text-blue-800 leading-normal">
                      💡 <strong>ميزة الاستيراد السريع:</strong> يمكنك نسخ وبدء <strong>اللصق المباشر (Ctrl+V)</strong> لخلايا الإكسل داخل أي مربع نصي في الجدول، وسيرتب النظام وتتوزع البيانات تلقائياً على كافة الأعمدة الأربعة لملخص الجرد!
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-right text-xs min-w-[500px]">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                          <th className="py-2.5 px-2 text-center w-10">م</th>
                          <th className="py-2.5 px-2 w-28">كود الصنف</th>
                          <th className="py-2.5 px-2">اسم الصنف بالكامل</th>
                          <th className="py-2.5 px-2 w-24">الرصيد الدفتري</th>
                          <th className="py-2.5 px-2 w-28">فارق سابق (اختياري)</th>
                          <th className="py-2.5 px-2 text-center w-10">الخيار</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {manualRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/40 transition-colors">
                            <td className="py-2 px-1 text-center font-mono font-bold text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                value={row.id}
                                onChange={(e) => handleRowChange(idx, "id", e.target.value)}
                                onPaste={(e) => handleGridPaste(e, idx)}
                                placeholder="مثال: 1001"
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:outline-hidden bg-white text-right"
                              />
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => handleRowChange(idx, "name", e.target.value)}
                                onPaste={(e) => handleGridPaste(e, idx)}
                                placeholder="علف بادي تسمين 23%..."
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:outline-hidden bg-white text-right text-slate-800"
                              />
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                value={row.bookQty}
                                onChange={(e) => handleRowChange(idx, "bookQty", e.target.value)}
                                onPaste={(e) => handleGridPaste(e, idx)}
                                placeholder="0"
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-center focus:ring-1 focus:ring-blue-500 focus:outline-hidden bg-white"
                              />
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                value={row.previousDiff}
                                onChange={(e) => handleRowChange(idx, "previousDiff", e.target.value)}
                                onPaste={(e) => handleGridPaste(e, idx)}
                                placeholder="0"
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-center focus:ring-1 focus:ring-blue-500 focus:outline-hidden bg-white"
                              />
                            </td>
                            <td className="py-2 px-1 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="p-1 text-slate-450 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                title="حذف السطر"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-2" dir="rtl">
                    <button
                      type="button"
                      onClick={addNewRow}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-200/40"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-600" />
                      إضافة سطر جديد ➕
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearManualRows}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg text-xs transition-colors cursor-pointer border border-rose-100"
                      >
                        🧹 مسح الجدول بالكامل
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <span className="text-sm font-bold text-slate-700 block">قم بلصق أو كتابة بيانات الأصناف بالأعمدة الأربعة:</span>
                      <span className="text-xs text-slate-500">منسقة كجدول بفاصل مسافة (Tab) أو الشرطة المائلة (/) أو الفاصلة (,)</span>
                    </div>
                    <button
                      onClick={() => {
                        setPasteText("1001/علف بادي تسمين سوبر 23%/450/-15\n1002/علف نامي تسمين سوبر 21%/620/5\n1003/علف ناهي تسمين سوبر 19%/350/0");
                        const parsed = parseExcelText("1001/علف بادي تسمين سوبر 23%/450/-15\n1002/علف نامي تسمين سوبر 21%/620/5\n1003/علف ناهي تسمين سوبر 19%/350/0");
                        setPreviewItems(parsed as MasterItem[]);
                        setImportSource("paste");
                      }}
                      type="button"
                      className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      📝 تعبئة نموذج كتابة للتعديل عليه
                    </button>
                  </div>

                  {/* Visual Guide for the 4 expected columns */}
                  <div className="grid grid-cols-4 gap-2 text-center text-[10px] sm:text-xs font-bold text-slate-600 bg-slate-100/70 p-2 rounded-xl border border-slate-200">
                    <div className="bg-white p-1.5 rounded-lg border border-slate-200/50">
                      <span className="text-blue-600 block mb-0.5 text-[9px] sm:text-[10px]">العمود 1</span>
                      كود الصنف
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-slate-200/50">
                      <span className="text-blue-600 block mb-0.5 text-[9px] sm:text-[10px]">العمود 2</span>
                      اسم الصنف
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-slate-200/50">
                      <span className="text-blue-600 block mb-0.5 text-[9px] sm:text-[10px]">العمود 3</span>
                      الرصيد الدفتري
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-slate-200/50">
                      <span className="text-blue-600 block mb-0.5 text-[9px] sm:text-[10px]">العمود 4</span>
                      فارق سابق (اختياري)
                    </div>
                  </div>

                  <textarea
                    value={pasteText}
                    onChange={handlePasteChange}
                    placeholder={`الصق البيانات المنسوخة مباشرة من الإكسل هنا أو اكتب يدوياً...\nمثال للفاصل اليدوي المائل:\n1001/علف بادي تسمين 23%/450/-12\n1002/علف نامي تسمين 21%/620/5`}
                    className="w-full h-44 p-4 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono placeholder-slate-400 bg-slate-50/50 resize-none leading-relaxed text-right md:text-left"
                    id="excel-paste-area"
                  />
                </div>
              )}
            </div>
          )}

          {/* Preview Panel */}
          {previewItems.length > 0 && (
            <div className="border border-slate-100 rounded-xl overflow-hidden mt-2 animate-fadeIn">
              <div className="bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-600 border-b border-slate-100 flex justify-between items-center">
                <span>معاينة الأصناف الجاهزة للاستيراد ({previewItems.length} صنف)</span>
                <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-[10px] font-bold">جاهز للفرز الفوري</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {previewItems.slice(0, 10).map((item, index) => (
                  <div key={index} className="px-4 py-2.5 flex items-center justify-between text-xs text-slate-700 hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono font-medium">{item.id}</span>
                      <span className="font-semibold text-slate-800">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-slate-500">
                      <span>الكمية: <strong className="text-slate-800">{item.bookQty}</strong> {item.unit}</span>
                      {item.previousDiff !== undefined && item.previousDiff !== 0 && (
                        <span className={`px-1.5 rounded-sm font-semibold text-[10px] ${item.previousDiff > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                          فرق سابق: {item.previousDiff > 0 ? `+${item.previousDiff}` : item.previousDiff}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {previewItems.length > 10 && (
                  <div className="p-3 bg-slate-50 text-center text-[10px] text-slate-400 font-bold border-t border-slate-100/70">
                    ومتبقي {previewItems.length - 10} أصناف أخرى جاهزة للتنزيل...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between gap-3" dir="rtl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold rounded-xl text-sm transition-colors cursor-pointer"
            id="cancel-import-btn"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={previewItems.length === 0}
            className={`px-5 py-2 font-bold rounded-xl text-sm flex items-center gap-2 transition-all cursor-pointer ${
              previewItems.length > 0
                ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/10"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
            id="confirm-import-btn"
          >
            <Check className="w-4 h-4" />
            تأكيد استيراد {previewItems.length} صنفاً
          </button>
        </div>
      </div>
    </div>
  );
}
