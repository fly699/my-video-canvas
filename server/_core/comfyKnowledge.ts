// ComfyUI 「知识记忆体」——按服务器（baseUrl）缓存一份可复用的资源与节点 schema 记忆，
// 让工程智能体 / ComfyUI 节点 / 画布助手都能「记住」某台服务器上有哪些 checkpoint/LoRA/VAE/
// 采样器/节点类及其精确输入 schema，不必每次都重新拉 /object_info + /models 检索一遍。
//
// 设计：进程内 Map（key=归一化 baseUrl）+ TTL 新鲜度 + 显式刷新。首次/过期时拉真机，之后命中缓存。
// 纯读取（listResources/describeNodes）都改走这里，天然跨「一次会话/一次生成」复用。DB 持久化可后续再加
// （现为进程内，重启即重建；对「同一会话反复调、多节点共享」已足够）。
import { fetchComfyModels, emptyModelList, type ComfyModelList } from "./comfyui";
import { getComfyKnowledgeRow, setComfyKnowledgeRow, deleteComfyKnowledgeRow, deleteAllComfyKnowledgeRows } from "../db";

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
  /** 全量模型清单（含 ckpts/loras/vaes/unets/controlnets/clips/... 全部类目），供 ComfyUI 节点模型选择器复用。
   *  比 resources 更全（resources 只是给智能体用的精简子集）；进程内缓存，不入 DB（重启后首取重拉）。 */
  modelList: ComfyModelList | null;
  /** 记忆写入时刻（ms）。 */
  fetchedAt: number;
}

const norm = (u: string) => u.replace(/\/+$/, "").trim();
// 记忆默认【永不自动过期】：ComfyUI 的模型/节点不会老变，10 分钟 TTL 反而让内网服务器
// 被反复重拉、还常打断正在跑的会话。改为完全由用户手动保鲜——顶栏「复位全部记忆」清空
// 后下次调用重学；每次调用都会提醒「N 前学习」，由用户判断是否需要复位。仍保留 maxAgeMs
// 逃生阀（传具体毫秒可临时启用过期，主要给单测/特殊场景）。

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

/** 抓取真机并写入记忆（进程内缓存 + DB 持久化，覆盖同一 baseUrl 的旧记忆）。 */
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
    // 全量模型清单（生产的 fetchComfyModels 返回全类目；注入的测试 fetcher 可能只有子集）。
    modelList: (models as ComfyModelList | null) ?? null,
    fetchedAt: Date.now(),
  };
  cache.set(key, knowledge);
  // 写穿到 DB 持久化（跨重启复用）；best-effort，不阻塞返回、失败不影响记忆使用。
  void setComfyKnowledgeRow(key, { objectInfo: knowledge.objectInfo, resources: knowledge.resources, fetchedAt: knowledge.fetchedAt }).catch(() => { /* DB 不可用无妨 */ });
  return knowledge;
}

/** 取某服务器的知识记忆：内存新鲜→命中；否则查 DB 持久化（重启后免真机重拉）；再否则抓真机。
 *  force / 过期都会跳过内存与 DB、直抓真机（复位后重建走这条）。 */
export async function getComfyKnowledge(
  baseUrl: string,
  opts: { force?: boolean; maxAgeMs?: number } & KnowledgeFetchers = {},
): Promise<ComfyKnowledge> {
  const key = norm(baseUrl);
  const maxAge = opts.maxAgeMs ?? Infinity; // 默认永不过期，只认 force / 手动复位
  const fresh = (t: number) => Date.now() - t < maxAge;
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && fresh(hit.fetchedAt)) return hit;
    // 内存未命中/过期：查 DB 持久化——重启后第一手从 DB 复用，不必真机重拉。
    try {
      const row = await getComfyKnowledgeRow(key);
      if (row && fresh(row.fetchedAt)) {
        // DB 不持久化全量 modelList（仅精简 resources），从 DB 复用时 modelList=null，
        // 首次需要全量模型清单的调用会按需重拉真机（见 getComfyModelList）。
        const k: ComfyKnowledge = { baseUrl: key, objectInfo: row.objectInfo, resources: row.resources, modelList: null, fetchedAt: row.fetchedAt };
        cache.set(key, k);
        return k;
      }
    } catch { /* DB 读失败：退回抓真机 */ }
  }
  return refetch(key, opts);
}

/** 只读命中的记忆，绝不发起抓取（未缓存返回 null）。供「有则用记忆、无则不阻塞」的场景。 */
export function peekComfyKnowledge(baseUrl: string): ComfyKnowledge | null {
  return cache.get(norm(baseUrl)) ?? null;
}

/** 取某服务器的全量模型清单（供 ComfyUI 节点模型选择器）。命中记忆则直接返回（永不过期，手动复位才重学）；
 *  记忆里没有全量 modelList（如刚从 DB 复用、或从未学过）时按需重拉真机一次并写入记忆。force=强制重拉。 */
export async function getComfyModelList(baseUrl: string, opts: { force?: boolean } = {}): Promise<ComfyModelList> {
  const key = norm(baseUrl);
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit?.modelList) return { ...emptyModelList(), ...hit.modelList };
  }
  const k = await refetch(key, {}); // 全量重拉（含 modelList），写穿记忆
  return { ...emptyModelList(), ...(k.modelList ?? {}) };
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

/** 清空记忆（不传 baseUrl 清全部）+ 删 DB 持久化。装/删模型或手动「复位记忆体」后调用，
 *  强制下次重新学习（getComfyKnowledge 内存/DB 皆落空 → 抓真机重建）。全清同时清内存与 DB 全表。 */
export function invalidateComfyKnowledge(baseUrl?: string): void {
  if (baseUrl) {
    const key = norm(baseUrl);
    cache.delete(key);
    void deleteComfyKnowledgeRow(key).catch(() => { /* DB 不可用无妨 */ });
  } else {
    cache.clear();
    void deleteAllComfyKnowledgeRows().catch(() => { /* DB 不可用无妨 */ });
  }
}
