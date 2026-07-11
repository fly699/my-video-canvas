import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import * as db from "../db";
import { invalidateAdminPermsCache } from "./adminPerms";

// #75 管理后台全量配置导入/导出。
// 导出 = 收集所有后台配置（含 SMTP 密码、日志邮送密码等敏感项）→ JSON → gzip 压缩 →
// AES-256-GCM 口令加密（scrypt 派生密钥）→ base64 单文件下载。敏感数据绝不明文出站。
// 导入 = 解密 → 解压 → 校验魔数/版本 → 按节写回（白名单条目为增量合并，其余整节覆盖）。
// 纯加解密函数无 IO，单测覆盖往返/错口令/防篡改。

export const CONFIG_BACKUP_VERSION = 1;
const MAGIC = Buffer.from("AVCCFG1\0"); // 8 字节文件头
const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;

export function encryptConfig(json: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  const enc = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, enc]).toString("base64");
}

export function decryptConfig(b64: string, passphrase: string): string {
  const buf = Buffer.from(b64.replace(/\s+/g, ""), "base64");
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1) throw new Error("文件过短或已损坏");
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("不是本系统的配置备份文件（魔数不符）");
  let o = MAGIC.length;
  const salt = buf.subarray(o, o + SALT_LEN); o += SALT_LEN;
  const iv = buf.subarray(o, o + IV_LEN); o += IV_LEN;
  const tag = buf.subarray(o, o + TAG_LEN); o += TAG_LEN;
  const enc = buf.subarray(o);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    throw new Error("解密失败：口令错误或文件被篡改");
  }
  return gunzipSync(compressed).toString("utf8");
}

// 去掉行记录里的 id/时间戳等非配置字段，写回时由各 setter 自行 upsert 单例行。
const strip = <T extends Record<string, unknown>>(row: T | null | undefined): Record<string, unknown> | null => {
  if (!row || typeof row !== "object") return null;
  const { id: _id, updatedAt: _u, createdAt: _c, ...rest } = row as Record<string, unknown>;
  return rest;
};

export interface ConfigBackup {
  version: number;
  exportedAt: string;
  sections: Record<string, unknown>;
}

/** 收集全部后台配置（含敏感项——调用方必须走加密管线出站）。 */
export async function collectAllConfig(): Promise<ConfigBackup> {
  const wl = await db.getWhitelistSettings();
  const sections: Record<string, unknown> = {
    auth: await db.getAuthSettings(),                       // 含 SMTP 账号/密码
    storage: await db.getStorageSettings(),
    whitelistFlags: wl ? {
      enabled: !!(wl as { enabled?: boolean }).enabled,
      comfyuiBypass: !!(wl as { comfyuiBypass?: boolean }).comfyuiBypass,
      llmBypass: !!(wl as { llmBypass?: boolean }).llmBypass,
      kieEnabled: !!(wl as { kieEnabled?: boolean }).kieEnabled,
    } : null,
    whitelistEntries: (await db.getWhitelistEntries()).map((e) => ({ type: e.type, value: e.value, note: e.note ?? null })),
    comfy: await db.getComfyGlobalSettings(),               // ComfyUI 服务器列表 + GPU 映射
    selfHostedLlm: await db.getSelfHostedLlmConfig(),       // 自建 LLM（可能含 apiKey）
    bridgeMcp: await db.getBridgeMcpConfig(),
    tunnel: strip(await db.getTunnelSettings() as Record<string, unknown>),
    chat: strip(await db.getChatSettings() as unknown as Record<string, unknown>),
    logEmail: strip(await db.getLogEmailSettings() as unknown as Record<string, unknown>), // 含收件箱/压缩包密码
    ops: strip(await db.getOpsSettings() as unknown as Record<string, unknown>),
    adminPerms: await db.getAdminPermsJson(),
    systemDefaultModels: await db.getSystemDefaultModels(),
  };
  return { version: CONFIG_BACKUP_VERSION, exportedAt: new Date().toISOString(), sections };
}

/** 按节写回配置。白名单条目增量合并（重复 type+value 为 no-op），其余整节覆盖。
 *  返回成功应用的节名列表；单节失败不阻断其它节（记入 skipped）。 */
export async function applyConfig(cfg: ConfigBackup, opts: { userId: number }): Promise<{ applied: string[]; skipped: string[] }> {
  if (!cfg || typeof cfg !== "object" || cfg.version !== CONFIG_BACKUP_VERSION || !cfg.sections) {
    throw new Error(`不支持的备份版本（期望 v${CONFIG_BACKUP_VERSION}）`);
  }
  const s = cfg.sections;
  const applied: string[] = [];
  const skipped: string[] = [];
  const run = async (name: string, fn: () => Promise<void>) => {
    if (s[name] == null) return;
    try { await fn(); applied.push(name); } catch { skipped.push(name); }
  };

  await run("auth", () => db.setAuthSettings(s.auth as Parameters<typeof db.setAuthSettings>[0]));
  await run("storage", () => db.setStorageSettings(s.storage as Parameters<typeof db.setStorageSettings>[0]));
  await run("whitelistFlags", async () => {
    const f = s.whitelistFlags as { enabled?: boolean; comfyuiBypass?: boolean; llmBypass?: boolean; kieEnabled?: boolean };
    if (typeof f.enabled === "boolean") await db.setWhitelistEnabled(f.enabled);
    if (typeof f.comfyuiBypass === "boolean") await db.setWhitelistComfyuiBypass(f.comfyuiBypass);
    if (typeof f.llmBypass === "boolean") await db.setWhitelistLlmBypass(f.llmBypass);
    if (typeof f.kieEnabled === "boolean") await db.setWhitelistKieEnabled(f.kieEnabled);
  });
  await run("whitelistEntries", async () => {
    const list = s.whitelistEntries as Array<{ type: "ip" | "user"; value: string; note: string | null }>;
    for (const e of Array.isArray(list) ? list : []) {
      if ((e.type === "ip" || e.type === "user") && typeof e.value === "string" && e.value) {
        await db.addWhitelistEntry(e.type, e.value.slice(0, 256), e.note ?? null, opts.userId);
      }
    }
  });
  await run("comfy", async () => {
    const c = s.comfy as { servers?: string[]; gpuIndex?: Record<string, number> };
    if (Array.isArray(c.servers)) await db.setComfyGlobalServers(c.servers.filter((u) => typeof u === "string"));
    if (c.gpuIndex && typeof c.gpuIndex === "object") await db.setComfyGlobalGpuIndex(c.gpuIndex);
  });
  await run("selfHostedLlm", () => db.setSelfHostedLlmConfig(s.selfHostedLlm as Parameters<typeof db.setSelfHostedLlmConfig>[0]));
  await run("bridgeMcp", () => db.setBridgeMcpConfig(s.bridgeMcp as Parameters<typeof db.setBridgeMcpConfig>[0]));
  await run("tunnel", () => db.setTunnelSettings(s.tunnel as Parameters<typeof db.setTunnelSettings>[0]));
  await run("chat", async () => { await db.setChatSettings(s.chat as Parameters<typeof db.setChatSettings>[0]); });
  await run("logEmail", async () => { await db.setLogEmailSettings(s.logEmail as Parameters<typeof db.setLogEmailSettings>[0]); });
  await run("ops", () => db.setOpsSettings(s.ops as Parameters<typeof db.setOpsSettings>[0]));
  await run("adminPerms", async () => {
    if (typeof s.adminPerms === "string") { await db.setAdminPermsJson(s.adminPerms); invalidateAdminPermsCache(); }
  });
  await run("systemDefaultModels", () => db.setSystemDefaultModels(s.systemDefaultModels as Record<string, string>));

  return { applied, skipped };
}
