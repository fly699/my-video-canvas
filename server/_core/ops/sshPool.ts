import { Client, type ConnectConfig } from "ssh2";
import { getOpsServer } from "../../db";
import { decryptSshSecret } from "./sshCrypto";
import type { ComfyOpsServer } from "../../../drizzle/schema";

// SSH connection pool for the ops center. One live ssh2.Client per serverId,
// lazily connected and reused across exec/shell calls, torn down after idle.
// Credentials are decrypted only at connect time and never leave this process.

interface PoolEntry {
  client: Client;
  lastUsed: number;
  connecting: Promise<Client> | null;
}

const POOL = new Map<number, PoolEntry>();
const IDLE_TTL_MS = 5 * 60 * 1000;
const MAX_CONNECTIONS = 16;
const CONNECT_TIMEOUT_MS = 15_000;

let sweeper: NodeJS.Timeout | null = null;
function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, e] of Array.from(POOL.entries())) {
      if (!e.connecting && now - e.lastUsed > IDLE_TTL_MS) {
        try { e.client.end(); } catch { /* ignore */ }
        POOL.delete(id);
      }
    }
  }, 60_000);
  sweeper.unref?.();
}

/** Validate an SSH host string (IPv4/IPv6/hostname). Guards against command/option
 *  injection into ssh args. Intentionally does NOT block private/internal ranges —
 *  the ops center targets internal ComfyUI hosts by design. */
export function isValidSshHost(host: string): boolean {
  if (!host || host.length > 255) return false;
  return /^[a-zA-Z0-9.\-:_]+$/.test(host) && !host.startsWith("-");
}

function buildConnectConfig(server: ComfyOpsServer): ConnectConfig {
  if (!isValidSshHost(server.sshHost)) throw new Error("SSH 主机格式非法");
  const secret = decryptSshSecret(server.encryptedSecret);
  const cfg: ConnectConfig = {
    host: server.sshHost,
    port: server.sshPort || 22,
    username: server.sshUser,
    readyTimeout: CONNECT_TIMEOUT_MS,
    keepaliveInterval: 20_000,
    keepaliveCountMax: 3,
  };
  if (server.authType === "privateKey") {
    cfg.privateKey = secret;
    if (server.encryptedPassphrase) cfg.passphrase = decryptSshSecret(server.encryptedPassphrase);
  } else {
    cfg.password = secret;
  }
  return cfg;
}

function connect(server: ComfyOpsServer): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const cfg = buildConnectConfig(server);
    const onError = (err: Error) => { try { client.end(); } catch { /* ignore */ } reject(err); };
    client.once("error", onError);
    client.once("ready", () => {
      client.removeListener("error", onError);
      client.on("error", () => { /* keep process alive; pool sweep cleans up */ });
      resolve(client);
    });
    client.connect(cfg);
  });
}

/** Get a connected, pooled client for a server id (connects lazily, reuses). */
export async function getConnectedClient(serverId: number): Promise<Client> {
  ensureSweeper();
  const existing = POOL.get(serverId);
  if (existing) {
    if (existing.connecting) return existing.connecting;
    existing.lastUsed = Date.now();
    return existing.client;
  }
  if (POOL.size >= MAX_CONNECTIONS) {
    // Evict the least-recently-used idle entry to make room.
    let lruId = -1; let lru = Infinity;
    for (const [id, e] of Array.from(POOL.entries())) if (!e.connecting && e.lastUsed < lru) { lru = e.lastUsed; lruId = id; }
    if (lruId >= 0) { try { POOL.get(lruId)!.client.end(); } catch { /* ignore */ } POOL.delete(lruId); }
    else throw new Error("SSH 连接数已达上限，请稍后再试");
  }
  const server = await getOpsServer(serverId);
  if (!server) throw new Error("服务器不存在");
  if (!server.enabled) throw new Error("该服务器已停用");
  const entry: PoolEntry = { client: null as unknown as Client, lastUsed: Date.now(), connecting: null };
  entry.connecting = connect(server).then((client) => {
    entry.client = client;
    entry.connecting = null;
    entry.lastUsed = Date.now();
    client.once("close", () => { if (POOL.get(serverId) === entry) POOL.delete(serverId); });
    return client;
  }).catch((err) => { POOL.delete(serverId); throw err; });
  POOL.set(serverId, entry);
  return entry.connecting;
}

/** Close and drop a server's pooled connection (e.g. after credential change). */
export function dropClient(serverId: number): void {
  const e = POOL.get(serverId);
  if (e) { try { e.client?.end(); } catch { /* ignore */ } POOL.delete(serverId); }
}

/** One-shot connectivity test using a throwaway client (does not pool). */
export async function testConnection(server: ComfyOpsServer): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await connect(server);
    try { client.end(); } catch { /* ignore */ }
    return { ok: true, message: "连接成功" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
