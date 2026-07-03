import { openDB, IDBPDatabase } from 'idb';

export interface OfflineOperation {
  id: string;
  type: 'SYNC_DATA';
  payload: any;
  timestamp: number;
  retryCount: number;
}

const DB_NAME = 'InventoryOfflineDB';
const STORE_NAME = 'operations';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export const offlineService = {
  async queueOperation(payload: any): Promise<string> {
    const db = await getDB();
    const id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const operation: OfflineOperation = {
      id,
      type: 'SYNC_DATA',
      payload,
      timestamp: Date.now(),
      retryCount: 0,
    };
    await db.put(STORE_NAME, operation);
    return id;
  },

  async getPendingOperations(): Promise<OfflineOperation[]> {
    const db = await getDB();
    return await db.getAll(STORE_NAME);
  },

  async removeOperation(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
  },

  async updateRetryCount(id: string): Promise<void> {
    const db = await getDB();
    const op = await db.get(STORE_NAME, id);
    if (op) {
      op.retryCount += 1;
      await db.put(STORE_NAME, op);
    }
  },

  async clearQueue(): Promise<void> {
    const db = await getDB();
    await db.clear(STORE_NAME);
  }
};
