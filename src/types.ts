export interface MasterItem {
  id: string; // Barcode or unique ID
  name: string; // SKU or Item name
  category: string; // Category (optional)
  bookQty: number; // Book quantity (الكمية الدفترية)
  unit: string; // Unit (e.g., pcs, kg, box)
  previousDiff?: number; // Previous difference (فرق سابق)
}

export interface PalletConfig {
  palletCount: number;
  bagsPerPallet: number;
  palletCountStr?: string;
  bagsPerPalletStr?: string;
}

export interface BagCalculatorDetails {
  bagWeight: number; // 50, 25, 20, 10, or 5
  pallets: PalletConfig[];
  looseBags: number;
  looseBagsStr?: string;
}

export interface AuditItem {
  itemId: string;
  itemName: string;
  category: string;
  bookQty: number;
  physicalQty: number | null; // null represents not inventoried yet
  unit: string;
  previousDiff?: number; // Previous difference (فرق سابق)
  assignedTo?: string; // Storekeeper user code assigned to do this audit
  submitted?: boolean; // Storekeeper has finalized and submitted
  submittedAt?: string;
  inventoriedByCode?: string; // Code of user who counted this item
  inventoriedByName?: string; // Name of user who counted this item
  inventoriedAt?: string; // Timestamp of the count
  storekeeperQty?: number | null; // Quantity submitted by storekeeper
  supervisorQty?: number | null;  // Quantity approved by supervisor
  managerQty?: number | null;     // Quantity finalized by program manager
  recheckRequested?: boolean;      // Recheck requested by supervisor
  storekeeperModifications?: { modifiedBy: string; modifiedByName?: string; modifiedAt: string; oldQty: number | null; newQty: number | null }[]; // Storekeeper modifications after supervisor requests re-inventory
  calculatorDetails?: BagCalculatorDetails; // Calculator details for review, deleted on archive
}

export interface LoggedInUser {
  code: string;
  name: string;
  phone?: string;
  password?: string;
  rememberMe?: boolean;
  role?: 'general_manager' | 'system_admin' | 'program_manager' | 'supervisor' | 'storekeeper';
  isUsingDefaultPassword?: boolean;
  isActivated?: boolean;
  isPrecoded?: boolean;
  isRegistered?: boolean;
  is_precoded?: boolean;
  is_registered?: boolean;
  is_activated?: boolean;
}

export interface AuditSession {
  id: string;
  date: string; // ISO String or YYYY-MM-DD
  notes: string;
  items: AuditItem[];
  isCompleted: boolean;
  storekeeperCode?: number | string; // Storekeeper Code (numeric or alphanumeric value)
  supervisorApproved?: boolean; // Approved by supervisor
  supervisorApprovedAt?: string;
  supervisorApprovedBy?: string;
  managerApproved?: boolean; // Ready to compile or archived
  archivedBy?: string; // Tracks the user code who completed/archived this session
  archivedAt?: string; // ISO timestamp of when it was completed
  isRestored?: boolean; // For restored session editing by manager only
  assignmentsCommitted?: boolean; // Supervisor committed assignments to server
  updatedAt?: number; // Client-side or server-side sync tracker
  modifications?: { modifiedBy: string; modifiedAt: string; itemChanges: { itemName: string; oldQty: number | null; newQty: number | null }[] }[]; // Edits history
}
