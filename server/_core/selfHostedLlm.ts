import { ENV } from "./env";
import { getSelfHostedLlmConfig } from "../db";
import type { SelfHostedLlmConfig } from "../../drizzle/schema";

// Built-in default model id (kept for env-only deployers who set just SELF_HOSTED_LLM_URL).
export const DEFAULT_SELF_HOSTED_MODELS = ["Qwen3.6-35B-A3B-FP8"];

// Config now lives in the DB (admin-managed). We keep a short-TTL in-memory cache so the
// sync routing/gating helpers (resolveApiUrl/getApiKey/isSelfHostedLlmModel) stay sync.
// Env vars remain a fallback so existing env-only setups keep working.
function envConfig(): SelfHostedLlmConfig {
  if (!ENV.selfHostedLlmUrl.trim()) return { servers: [] };
  const ids = ENV.selfHostedLlmModels.length ? ENV.selfHostedLlmModels : DEFAULT_SELF_HOSTED_MODELS;
  return { servers: [{ url: ENV.selfHostedLlmUrl, apiKey: ENV.selfHostedLlmKey, models: ids.map((id: string) => ({ id, label: id })) }] };
}

let cache: SelfHostedLlmConfig | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    const dbCfg = await getSelfHostedLlmConfig();
    cache = dbCfg.servers.length ? dbCfg : envConfig(); // DB 配置优先，否则回退 env
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧缓存 / env 兜底 */ }
}
void refresh(); // 启动即异步预热

/** Current self-hosted LLM config (sync snapshot; background-refreshed; env fallback). */
export function getSelfHostedConfig(): SelfHostedLlmConfig {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期则后台刷新，本次仍返回旧值（非阻塞）
  return cache ?? envConfig();
}

/** Force an immediate cache refresh — call right after an admin save. */
export async function reloadSelfHostedConfig(): Promise<void> { await refresh(); }

/** 所有自建服务器的模型（拉平；id 去重，先出现者优先）——供选择器/门控用。 */
export function allSelfHostedModels(): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const s of getSelfHostedConfig().servers) {
    for (const m of s.models) { if (!seen.has(m.id)) { seen.add(m.id); out.push({ id: m.id, label: m.label }); } }
  }
  return out;
}

/** True when `model` is served by ANY configured self-hosted server. Standalone so
 *  both llm.ts (routing) and whitelist.ts (gating) can use it without a circular import. */
export function isSelfHostedLlmModel(model?: string): boolean {
  if (!model) return false;
  return getSelfHostedConfig().servers.some((s) => !!s.url.trim() && s.models.some((m) => m.id === model));
}

/** 按模型 id 找到其所属自建服务器的端点（多服务器路由核心）；找不到返回 null。 */
export function resolveSelfHostedEndpoint(model?: string): { url: string; apiKey: string } | null {
  if (!model) return null;
  for (const s of getSelfHostedConfig().servers) {
    if (s.url.trim() && s.models.some((m) => m.id === model)) return { url: s.url, apiKey: s.apiKey };
  }
  return null;
}

/** 自建 LLM 的 chat/completions 端点：URL 已含 `chat/completions`（如 Open WebUI 的
 *  `/api/chat/completions`，或用户直接粘了完整端点）就原样用；否则按 OpenAI 惯例补
 *  `/v1/chat/completions`（vLLM / Ollama / LM Studio 的默认形态，保持既有行为不变）。 */
export function selfHostedChatUrl(rawUrl: string): string {
  const u = (rawUrl ?? "").trim().replace(/\/+$/, "");
  if (!u) return u;
  return /\/chat\/completions$/i.test(u) ? u : `${u}/v1/chat/completions`;
}
