// IndexedDB persistence for serverless chat:
//   - the user's E2E identity private key (as JWK)
//   - per-conversation decrypted message history (local-only; the server never
//     stores serverless content)
import type { ChatWireMessage } from "@shared/types";

const DB_NAME = "avc-chat";
const DB_VERSION = 1;
const STORE_KEYS = "keys";
const STORE_HISTORY = "history";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KEYS)) db.createObjectStore(STORE_KEYS);
      if (!db.objectStoreNames.contains(STORE_HISTORY)) db.createObjectStore(STORE_HISTORY);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── identity private key ────────────────────────────────────────────────────
export async function loadPrivateKeyJwk(): Promise<JsonWebKey | undefined> {
  return idbGet<JsonWebKey>(STORE_KEYS, "identityPrivateJwk");
}
export async function savePrivateKeyJwk(jwk: JsonWebKey): Promise<void> {
  await idbSet(STORE_KEYS, "identityPrivateJwk", jwk);
}

// ── serverless local message history (per conversation) ─────────────────────
const HISTORY_CAP = 500;

export async function loadLocalHistory(conversationId: number): Promise<ChatWireMessage[]> {
  return (await idbGet<ChatWireMessage[]>(STORE_HISTORY, String(conversationId))) ?? [];
}

export async function appendLocalHistory(conversationId: number, msg: ChatWireMessage): Promise<void> {
  const cur = await loadLocalHistory(conversationId);
  if (cur.some((m) => m.id === msg.id)) return;
  const next = [...cur, msg].slice(-HISTORY_CAP);
  await idbSet(STORE_HISTORY, String(conversationId), next);
}
