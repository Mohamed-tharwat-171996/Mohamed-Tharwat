import { MasterItem } from "./types";

export const DEMO_ITEMS: MasterItem[] = [
  {
    id: "1001",
    name: "علف بادي تسمين سوبر 23%",
    category: "أعلاف دواجن",
    bookQty: 450,
    unit: "طن",
    previousDiff: -15,
  },
  {
    id: "1002",
    name: "علف نامي تسمين سوبر 21%",
    category: "أعلاف دواجن",
    bookQty: 620,
    unit: "طن",
    previousDiff: 5,
  },
  {
    id: "1003",
    name: "علف ناهي تسمين سوبر 19%",
    category: "أعلاف دواجن",
    bookQty: 350,
    unit: "طن",
    previousDiff: 0,
  },
  {
    id: "1004",
    name: "علف بياض إنتاجي 18%",
    category: "أعلاف بياض",
    bookQty: 280,
    unit: "طن",
    previousDiff: -2,
  },
  {
    id: "1005",
    name: "علف بياض إنتاجي 16%",
    category: "أعلاف بياض",
    bookQty: 190,
    unit: "طن",
    previousDiff: 8,
  },
  {
    id: "1006",
    name: "علف مواشي تسمين 14% سوبر",
    category: "أعلاف مواشي",
    bookQty: 540,
    unit: "طن",
    previousDiff: -25,
  },
  {
    id: "1007",
    name: "علف مواشي حلايب 16%",
    category: "أعلاف مواشي",
    bookQty: 310,
    unit: "طن",
    previousDiff: 12,
  },
];

/**
 * Parsers helper to convert copied Excel rows to MasterItems
 * Supported layouts from paste area:
 * Line-by-line. Tabs or commas separation.
 * Format 1: [ID] [Name] [Category] [BookQty] [Unit]
 * Format 2: [Name] [BookQty]
 * Format 3: [ID] [Name] [BookQty]
 */
export function parseExcelText(text: string): MasterItem[] {
  const result: MasterItem[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    // Split by slash (/), tab (Excel copy default), comma or semicolon
    let parts = line.split(/\/|\t|,|;/);
    parts = parts.map((p) => p.trim());

    if (parts.length === 0 || !parts[0]) continue;

    let id = "";
    let name = "";
    let category = "عام";
    let bookQty = 0;
    let unit = "كيلو";
    let previousDiff = 0;

    if (parts.length >= 4) {
      // Format: [كود الصنف/ID] [وصف الصنف/Name] [الرصيد الدفتري/BookQty] [فرق سابق/PreviousDiff]
      id = parts[0];
      name = parts[1];
      const parsedQty = parseFloat(parts[2]);
      if (!isNaN(parsedQty)) {
        bookQty = parsedQty;
      }
      const parsedPrevDiff = parseFloat(parts[3]);
      if (!isNaN(parsedPrevDiff)) {
        previousDiff = parsedPrevDiff;
      }
    } else if (parts.length === 3) {
      // [ID] [Name] [BookQty] OR [Name] [BookQty] [PreviousDiff]
      const qty2 = parseFloat(parts[2]);
      const qty1 = parseFloat(parts[1]);

      if (!isNaN(qty2)) {
        id = parts[0];
        name = parts[1];
        bookQty = qty2;
      } else if (!isNaN(qty1)) {
        name = parts[0];
        bookQty = qty1;
        unit = parts[2];
      } else {
        id = parts[0];
        name = parts[1];
        category = parts[2];
      }
    } else if (parts.length === 2) {
      // Name and Qty OR Barcode and Name
      const num = parseFloat(parts[1]);
      if (!isNaN(num)) {
        name = parts[0];
        bookQty = num;
      } else {
        id = parts[0];
        name = parts[1];
      }
    } else if (parts.length === 1) {
      name = parts[0];
    }

    // Default ID if missing
    if (!id) {
      id = "item_" + Math.random().toString(36).substring(2, 7);
    }

    result.push({
      id,
      name,
      category,
      bookQty,
      unit,
      previousDiff,
    });
  }

  return result;
}
