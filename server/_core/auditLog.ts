import axios from "axios";
import * as db from "../db";
import type { TrpcContext } from "./context";

// ── Geo lookup ────────────────────────────────────────────────────────────────

interface GeoResult {
  country?: string;
  region?: string;
  city?: string;
}

const geoCache = new Map<string, { geo: GeoResult; expiry: number }>();
const GEO_TTL_MS = 60 * 60 * 1000; // 1 hour
const GEO_CACHE_MAX = 2_000; // prevent unbounded growth from scanner traffic

const PRIVATE_IP = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|::ffff:|localhost$|unknown$|^$)/;
// Only allow characters that appear in valid IPv4/IPv6 addresses to prevent path/query injection
const VALID_IP_CHARS = /^[0-9a-fA-F.:]{3,45}$/;

async function lookupGeo(ip: string): Promise<GeoResult> {
  if (PRIVATE_IP.test(ip)) return { country: "内网", region: "", city: "" };
  if (!VALID_IP_CHARS.test(ip)) return {};

  const hit = geoCache.get(ip);
  if (hit && Date.now() < hit.expiry) return hit.geo;

  try {
    const { data } = await axios.get(`http://ip-api.com/json/${ip}`, {
      params: { fields: "status,country,regionName,city", lang: "zh-CN" },
      timeout: 3000,
    });
    if (data?.status === "success") {
      const geo: GeoResult = { country: data.country, region: data.regionName, city: data.city };
      geoCache.set(ip, { geo, expiry: Date.now() + GEO_TTL_MS });
      // Evict all expired entries; if still over cap, remove the oldest insertion
      if (geoCache.size > GEO_CACHE_MAX) {
        const now = Date.now();
        for (const [k, v] of Array.from(geoCache.entries())) {
          if (v.expiry < now) geoCache.delete(k);
        }
        if (geoCache.size > GEO_CACHE_MAX) {
          const oldest = geoCache.keys().next().value;
          if (oldest !== undefined) geoCache.delete(oldest);
        }
      }
      return geo;
    }
  } catch { /* network error — return empty */ }

  return {};
}

// ── Public API ────────────────────────────────────────────────────────────────

export type AuditAction =
  | "login_email"
  | "login_oauth"
  | "image_gen"
  | "image_edit"
  | "video_gen"
  | "audio_music"
  | "audio_dubbing"
  | "audio_sfx"
  | "subtitle_transcribe"
  | "logs_cleared"
  | "comfyui_image_gen"
  | "comfyui_video_gen"
  | "comfyui_workflow_exec"
  | "collab:invite_email"
  | "collab:update_role"
  | "collab:remove"
  | "collab:leave"
  | "collab:public_toggle"
  | "collab:create_link"
  | "collab:revoke_link"
  | "collab:accept_link"
  | "lan_chat:join"
  | "lan_chat:ip_mismatch"
  | "asset_import_url"
  | "asset_admin_delete"
  | "asset_admin_hard_delete"
  | "download:request"
  | "download:approve"
  | "download:deny"
  | "download:grant"
  | "download:revoke"
  | "download:served"
  | "download:denied"
  | "editor:create"
  | "editor:delete"
  | "editor:export"
  | "editor:aiCut"
  | "poyo_stage"
  | "kie_key_add"
  | "kie_key_toggle"
  | "kie_key_delete"
  | "kie_bind"
  | "kie_binding_toggle"
  | "kie_unbind"
  | "system_restart"
  | "user_reset_password"
  | "user_set_disabled"
  | "user_delete"
  | "admin_set_level"
  | "user_change_password"
  | "ops:server_add"
  | "ops:server_update"
  | "ops:server_delete"
  | "ops:exec"
  | "ops:script_run"
  | "ops:terminal_open"
  | "ops:install_model"
  | "ops:install_node"
  | "ops:ai_generate"
  | "ops:trust_toggle"
  | "superagent_comfy_build"
  | "superagent_code_task";

export interface AuditOpts {
  ctx?: TrpcContext;
  /** Override IP (used for login routes that don't go through tRPC context) */
  ip?: string;
  userId?: number | null;
  userEmail?: string | null;
  userName?: string | null;
  action: AuditAction;
  detail?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit logger. Does NOT block the calling request.
 * Resolves IP geolocation asynchronously before writing to DB.
 */
export function writeAuditLog(opts: AuditOpts): void {
  const ip = opts.ip ?? opts.ctx?.clientIp ?? "unknown";
  const userId = opts.userId ?? opts.ctx?.user?.id ?? null;
  const userEmail = opts.userEmail ?? opts.ctx?.user?.email ?? null;
  const userName = opts.userName ?? opts.ctx?.user?.name ?? null;

  lookupGeo(ip)
    .then((geo) =>
      db.insertAuditLog({
        userId,
        userEmail,
        userName,
        ip,
        country: geo.country ?? null,
        region: geo.region ?? null,
        city: geo.city ?? null,
        action: opts.action,
        detail: opts.detail ?? null,
      })
    )
    .catch((err) => console.error("[AuditLog] write failed — action=%s userId=%s ip=%s err=%s",
      opts.action, userId, ip, err instanceof Error ? err.message : String(err)));
}

/** Truncate long strings for detail fields (keep prompts readable but short) */
export function truncate(s: string | undefined | null, max = 120): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max) + "…";
}

/**
 * 视频任务终态（succeeded/failed）审计日志 — 提交时的 video_gen 日志只记录
 * 「是否提交成功」，真正的生成结果在异步轮询里才知道，因此在每个终态转移点调用
 * 本函数补一条带 success 标志 + 预估点数（params._estimatedCost，创建时随请求
 * 存入）的结果日志。轮询器无用户上下文 → 按 task.userId 反查用户后写入。
 */
export function auditVideoTaskResult(
  task: { id: number; userId: number; nodeId: string; provider: string; params?: unknown },
  success: boolean,
  errorMessage?: string | null,
): void {
  const estimatedCost = (task.params as { _estimatedCost?: unknown } | null)?._estimatedCost;
  void (async () => {
    let userEmail: string | null = null;
    let userName: string | null = null;
    try {
      const u = await db.getUserById(task.userId);
      userEmail = u?.email ?? null;
      userName = u?.name ?? null;
    } catch { /* 用户查询失败不阻塞日志 */ }
    writeAuditLog({
      ip: "system",
      userId: task.userId,
      userEmail,
      userName,
      action: "video_gen",
      detail: {
        phase: "result",
        provider: task.provider,
        taskId: task.id,
        nodeId: task.nodeId,
        ...(typeof estimatedCost === "string" && estimatedCost ? { estimatedCost } : {}),
        success,
        ...(errorMessage ? { error: truncate(errorMessage) } : {}),
      },
    });
  })();
}
