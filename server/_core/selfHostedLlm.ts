import { ENV } from "./env";
import { getSelfHostedLlmConfig } from "../db";
import type { SelfHostedLlmConfig } from "../../drizzle/schema";

// Built-in default model id (kept for env-only deployers who set just SELF_HOSTED_LLM_URL).
export const DEFAULT_SELF_HOSTED_MODELS = ["Qwen3.6-35B-A3B-FP8"];

// Config now lives in the DB (admin-managed). We keep a short-TTL in-memory cache so the
// sync routing/gating helpers (resolveApiUrl/getApiKey/isSelfHostedLlmModel) stay sync.
// Env vars remain a fallback so existing env-only setups keep working.
function envConfig(): SelfHostedLlmConfig {
  if (!ENV.selfHostedLlmUrl.trim()) return { url: "", apiKey: "", models: [] };
  const ids = ENV.selfHostedLlmModels.length ? ENV.selfHostedLlmModels : DEFAULT_SELF_HOSTED_MODELS;
  return { url: ENV.selfHostedLlmUrl, apiKey: ENV.selfHostedLlmKey, models: ids.map((id) => ({ id, label: id })) };
}

let cache: SelfHostedLlmConfig | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    const dbCfg = await getSelfHostedLlmConfig();
    cache = dbCfg.url.trim() ? dbCfg : envConfig(); // DB 配置优先，否则回退 env
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

/** True when `model` is served by the configured self-hosted endpoint. Standalone so
 *  both llm.ts (routing) and whitelist.ts (gating) can use it without a circular import. */
export function isSelfHostedLlmModel(model?: string): boolean {
  if (!model) return false;
  const c = getSelfHostedConfig();
  return !!c.url.trim() && c.models.some((m) => m.id === model);
}

/** 自建 LLM 的 chat/completions 端点：URL 已含 `chat/completions`（如 Open WebUI 的
 *  `/api/chat/completions`，或用户直接粘了完整端点）就原样用；否则按 OpenAI 惯例补
 *  `/v1/chat/completions`（vLLM / Ollama / LM Studio 的默认形态，保持既有行为不变）。 */
export function selfHostedChatUrl(rawUrl: string): string {
  const u = (rawUrl ?? "").trim().replace(/\/+$/, "");
  if (!u) return u;
  return /\/chat\/completions$/i.test(u) ? u : `${u}/v1/chat/completions`;
}
