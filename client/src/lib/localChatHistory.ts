/**
 * Browser-local LAN chat history. After the P2P E2E architecture switch
 * the server no longer stores message content — each peer keeps its own
 * history in IndexedDB. You only see messages from time periods where
 * your tab was open and connected (deliberate trade-off for the "data
 * never leaves your machine" guarantee).
 *
 * Schema: one row per message, keyed by an autoincrement id. Indexed by
 * (groupId, createdAt) so we can quickly load the latest N for a group.
 */

const DB_NAME = "ai-canvas-lan-chat";
const DB_VERSION = 1;
const STORE = "messages";

export interface LocalChatMessage {
  id: string;            // crypto.randomUUID() — generated client-side, no server-side id
  groupId: string;
  roomName?: string;     // optional room/channel within a group
  nickname: string;
  color: string;
  content: string;
  attachments?: Array<{ type: "image" | "file"; url: string; name: string; mimeType: string }>;
  createdAt: number;     // ms epoch
  /** True for messages this client itself originated; false when received from a peer. */
  ownByMe: boolean;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_group_time", ["groupId", "createdAt"]);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => { _dbPromise = null; reject(req.error); };
  });
  return _dbPromise;
}

export async function appendMessage(msg: LocalChatMessage): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* swallow — chat still works in memory, just no persistence */
  }
}

/** Load up to `limit` most recent messages for the group, newest last. */
export async function loadRecentMessages(groupId: string, limit = 200): Promise<LocalChatMessage[]> {
  try {
    const db = await openDb();
    return await new Promise<LocalChatMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("by_group_time");
      const range = IDBKeyRange.bound([groupId, 0], [groupId, Number.MAX_SAFE_INTEGER]);
      const req = idx.openCursor(range, "prev"); // newest first
      const out: LocalChatMessage[] = [];
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && out.length < limit) {
          out.push(cursor.value as LocalChatMessage);
          cursor.continue();
        } else {
          // newest-first → reverse for chronological display
          resolve(out.reverse());
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Clear all stored history (e.g. user wants a clean slate). */
export async function clearHistory(groupId?: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (!groupId) {
        store.clear();
      } else {
        const idx = store.index("by_group_time");
        const range = IDBKeyRange.bound([groupId, 0], [groupId, Number.MAX_SAFE_INTEGER]);
        const req = idx.openCursor(range);
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* swallow */
  }
}
