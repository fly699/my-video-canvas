// ComfyUI 「知识记忆体」——按服务器（baseUrl）缓存一份可复用的资源与节点 schema 记忆，
// 让工程智能体 / ComfyUI 节点 / 画布助手都能「记住」某台服务器上有哪些 checkpoint/LoRA/VAE/
// 采样器/节点类及其精确输入 schema，不必每次都重新拉 /object_info + /models 检索一遍。
//
// 设计：进程内 Map（key=归一化 baseUrl）+ TTL 新鲜度 + 显式刷新。首次/过期时拉真机，之后命中缓存。
// 纯读取（listResources/describeNodes）都改走这里，天然跨「一次会话/一次生成」复用。DB 持久化可后续再加
// （现为进程内，重启即重建；对「同一会话反复调、多节点共享」已足够）。
import { fetchComfyModels } from "./comfyui";

export interface ComfyResourceMemory {
  checkpoints: string[];
  loras: string[];
  vaes: string[];
  samplers: string[];
  schedulers: string[];
  /** 已安装节点 class_type 列表（/object_info 的键）。 */
  nodeClasses: string[];
}

export interface ComfyKnowledge {
  /** 归一化后的服务器地址（缓存键）。 */
  baseUrl: string;
  /** /object_info 全量原始记录（每个节点类的输入/输出 schema），拉不到为 null。 */
  objectInfo: Record<string, unknown> | null;
  /** 资源清单（模型/LoRA/采样器 + 节点类名目录）。 */
  resources: ComfyResourceMemory;
  /** 记忆写入时刻（ms）。 */
  fetchedAt: number;
}

const norm = (u: string) => u.replace(/\/+$/, "").trim();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 分钟新鲜度：内网 ComfyUI 装/删模型不频繁，够用又不至太陈

const cache = new Map<string, ComfyKnowledge>();

/** 可注入的抓取器（便于单测；生产用默认真机抓取）。 */
export interface KnowledgeFetchers {
  fetchModels?: (baseUrl: string) => Promise<{ ckpts?: string[]; loras?: string[]; vaes?: string[]; samplers?: string[]; schedulers?: string[] } | null>;
  fetchObjectInfo?: (baseUrl: string) => Promise<Record<string, unknown> | null>;
}

async function defaultFetchObjectInfo(baseUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(norm(baseUrl) + "/object_info", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch { return null; }
}

/** 抓取并写入记忆（覆盖同一 baseUrl 的旧记忆）。 */
async function refetch(baseUrl: string, f: KnowledgeFetchers): Promise<ComfyKnowledge> {
  const key = norm(baseUrl);
  const fetchModels = f.fetchModels ?? ((b: string) => fetchComfyModels(b).catch(() => null));
  const fetchObjectInfo = f.fetchObjectInfo ?? defaultFetchObjectInfo;
  const [models, objectInfo] = await Promise.all([
    fetchModels(key).catch(() => null),
    fetchObjectInfo(key).catch(() => null),
  ]);
  const knowledge: ComfyKnowledge = {
    baseUrl: key,
    objectInfo,
    resources: {
      checkpoints: models?.ckpts ?? [],
      loras: models?.loras ?? [],
      vaes: models?.vaes ?? [],
      samplers: models?.samplers ?? [],
      schedulers: models?.schedulers ?? [],
      nodeClasses: objectInfo ? Object.keys(objectInfo) : [],
    },
    fetchedAt: Date.now(),
  };
  cache.set(key, knowledge);
  return knowledge;
}

/** 取某服务器的知识记忆：新鲜则命中缓存，过期/未有/force 则重新抓取真机并写回记忆。 */
export async function getComfyKnowledge(
  baseUrl: string,
  opts: { force?: boolean; maxAgeMs?: number } & KnowledgeFetchers = {},
): Promise<ComfyKnowledge> {
  const key = norm(baseUrl);
  const hit = cache.get(key);
  const maxAge = opts.maxAgeMs ?? DEFAULT_TTL_MS;
  if (!opts.force && hit && Date.now() - hit.fetchedAt < maxAge) return hit;
  return refetch(key, opts);
}

/** 只读命中的记忆，绝不发起抓取（未缓存返回 null）。供「有则用记忆、无则不阻塞」的场景。 */
export function peekComfyKnowledge(baseUrl: string): ComfyKnowledge | null {
  return cache.get(norm(baseUrl)) ?? null;
}

/** 在记忆里按关键词检索各类资源（子串、大小写不敏感），每类截断 limit。 */
export function searchComfyKnowledge(
  k: ComfyKnowledge,
  query: string,
  limit = 60,
): { checkpoints: string[]; loras: string[]; vaes: string[]; nodeClasses: string[]; samplers: string[]; schedulers: string[]; total: number } {
  const q = query.trim().toLowerCase();
  const hit = (arr: string[]) => (q ? arr.filter((s) => s.toLowerCase().includes(q)) : arr).slice(0, limit);
  const r = k.resources;
  const out = {
    checkpoints: hit(r.checkpoints), loras: hit(r.loras), vaes: hit(r.vaes),
    nodeClasses: hit(r.nodeClasses), samplers: hit(r.samplers), schedulers: hit(r.schedulers),
  };
  return { ...out, total: Object.values(out).reduce((a, b) => a + b.length, 0) };
}

/** 清空记忆（不传 baseUrl 清全部）。装/删模型或换服务器后调用，强制下次重新学习。 */
export function invalidateComfyKnowledge(baseUrl?: string): void {
  if (baseUrl) cache.delete(norm(baseUrl));
  else cache.clear();
}
