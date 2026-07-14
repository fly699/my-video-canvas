// ComfyUI 「工作流经验记忆体」——工程智能体每次成功搭通一份工作流就沉淀一条（任务 + 最终
// workflowJson + 用到的节点类/输出类型）。下次相似任务先召回这些成功范例注入上下文，少走多轮
// 推理，越用越快。与资源记忆体一样【永不自动过期】，只由用户手动管理（删除/清空）。
//
// 供多方调用：工程智能体（召回参考 + 成功沉淀）、画布助手（规划上下文注入）、管理 UI（列表/删除/清空）。
import { createHash } from "node:crypto";
import {
  insertComfyWorkflowMemory,
  listComfyWorkflowMemory,
  deleteComfyWorkflowMemory,
  clearComfyWorkflowMemory,
  type ComfyWorkflowMemoryRow,
} from "../db";
import type { ComfyWorkflowMemoryMeta } from "../../drizzle/schema";
import { tokenizeForMatch } from "./superAgent/comfyAdapters";

const norm = (u: string) => u.replace(/\/+$/, "").trim();

/** workflowJson 归一化指纹：能解析就按键排序重序列化（无关键序/空白差异），否则退回原串。用于去重。 */
export function hashWorkflow(workflowJson: string): string {
  let canon = workflowJson.trim();
  try {
    const obj = JSON.parse(workflowJson);
    canon = JSON.stringify(obj, Object.keys(flatten(obj)).sort());
  } catch { /* 非法 JSON：按原串算 */ }
  return createHash("sha1").update(canon).digest("hex");
}
// 收集所有键名用于稳定序列化（JSON.stringify 的 replacer 数组按给定键序输出）。
function flatten(o: unknown, acc: Record<string, true> = {}): Record<string, true> {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) { acc[k] = true; flatten(v, acc); }
  }
  return acc;
}

/** 从 API 格式工作流里抽出所有节点 class_type（去重）。解析失败返回空。 */
export function extractNodeClasses(workflowJson: string): string[] {
  try {
    const g = JSON.parse(workflowJson) as Record<string, { class_type?: string }>;
    const set = new Set<string>();
    for (const n of Object.values(g)) if (n && typeof n.class_type === "string") set.add(n.class_type);
    return Array.from(set);
  } catch { return []; }
}

/** 从工作流里抽出用到的模型文件名（checkpoint/lora/vae），按 inputs 里的常见键名 + .safetensors/.ckpt/.pt 后缀识别。 */
export function extractModels(workflowJson: string): { checkpoints: string[]; loras: string[]; vaes: string[] } {
  const ck = new Set<string>(), lo = new Set<string>(), va = new Set<string>();
  try {
    const g = JSON.parse(workflowJson) as Record<string, { inputs?: Record<string, unknown> }>;
    for (const n of Object.values(g)) {
      for (const [k, v] of Object.entries(n?.inputs ?? {})) {
        if (typeof v !== "string" || !/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(v)) continue;
        const key = k.toLowerCase();
        if (key.includes("lora")) lo.add(v);
        else if (key.includes("vae")) va.add(v);
        else if (key.includes("ckpt") || key.includes("checkpoint") || key.includes("unet") || key.includes("model")) ck.add(v);
        else ck.add(v); // 兜底归入 checkpoints（总比丢失好）
      }
    }
  } catch { /* 解析失败返回空 */ }
  return { checkpoints: Array.from(ck), loras: Array.from(lo), vaes: Array.from(va) };
}

export interface RecordExperienceInput {
  baseUrl: string; task: string; workflowJson: string;
  nodeClasses?: string[]; outputType?: string | null;
  /** 全量留存的附加信息（分析结果/样例产物/迭代轮数/LLM 等）；models 缺省则从工作流自动抽取。 */
  meta?: ComfyWorkflowMemoryMeta;
}

/** 沉淀一条成功经验（同服务器同图按 hash 去重），全量留存有用信息。返回是否新写入。 */
export async function recordWorkflowExperience(input: RecordExperienceInput): Promise<boolean> {
  const workflowJson = (input.workflowJson || "").trim();
  if (!workflowJson) return false;
  const baseUrl = norm(input.baseUrl);
  const task = (input.task || "").slice(0, 2000);
  const nodeClasses = (input.nodeClasses && input.nodeClasses.length ? input.nodeClasses : extractNodeClasses(workflowJson)).slice(0, 200);
  // meta 全量：模型缺省自动从图里抽取，确保「用到哪些模型」不丢。
  const meta: ComfyWorkflowMemoryMeta = { ...(input.meta ?? {}) };
  if (!meta.models) meta.models = extractModels(workflowJson);
  try {
    return await insertComfyWorkflowMemory({
      baseUrl, task, workflowJson, hash: hashWorkflow(workflowJson), status: "success",
      nodeClasses, outputType: input.outputType ?? null, meta, createdAt: Date.now(),
    });
  } catch { return false; }
}

export interface RecordFailureInput {
  baseUrl: string; task: string;
  /** "failed" | "exhausted"（不传按 failed）。aborted / 连接类噪声不应调本函数。 */
  status?: string;
  /** 拦路的问题/放弃原因（下次当作已知坑规避）。为空则不沉淀（无信息量）。 */
  failReasons: string[];
  /** 最后一版（未调通的）workflowJson，可选留存供复盘。 */
  workflowJson?: string;
  nodeClasses?: string[];
  meta?: ComfyWorkflowMemoryMeta;
}

/** 沉淀一条失败教训（踩过的坑），供下次同类任务规避。按「服务器 + 失败签名」去重（同样的坑不重复记）。
 *  failReasons 为空（无信息量，如纯连接失败已被过滤）则跳过。返回是否新写入。 */
export async function recordWorkflowFailure(input: RecordFailureInput): Promise<boolean> {
  const reasons = (input.failReasons ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
  if (!reasons.length) return false;
  const baseUrl = norm(input.baseUrl);
  const task = (input.task || "").slice(0, 2000);
  const status = input.status === "exhausted" ? "exhausted" : "failed";
  const workflowJson = (input.workflowJson || "").trim();
  const nodeClasses = (input.nodeClasses && input.nodeClasses.length ? input.nodeClasses : extractNodeClasses(workflowJson)).slice(0, 200);
  // 去重签名 = 服务器 + 失败原因集合（排序）——同样的坑（无论 workflow 是否相同）只记一次。
  const hash = createHash("sha1").update(reasons.slice().sort().join("\n")).digest("hex");
  const meta: ComfyWorkflowMemoryMeta = { ...(input.meta ?? {}), failReasons: reasons };
  try {
    return await insertComfyWorkflowMemory({
      baseUrl, task, workflowJson, hash, status,
      nodeClasses, outputType: null, meta, createdAt: Date.now(),
    });
  } catch { return false; }
}

export interface RecalledExperience { id: number; label: string; workflowJson: string; nodeClasses: string[]; createdAt: number }

/** 召回与任务最相关的若干条成功经验（按任务 + 节点类关键词重合度打分）。裁剪 workflowJson 防撑爆上下文。 */
export async function recallWorkflowExperiences(
  baseUrl: string, task: string, n = 2, maxJsonLen = 2600,
): Promise<RecalledExperience[]> {
  const taskTokens = tokenizeForMatch(task);
  if (!taskTokens.size) return [];
  let rows: ComfyWorkflowMemoryRow[];
  try { rows = await listComfyWorkflowMemory(norm(baseUrl)); } catch { return []; }
  const scored = rows
    .filter((r) => r.status === "success") // 只把「成功工作流」当可复用范例召回
    .map((r) => {
      const ct = tokenizeForMatch(`${r.task} ${r.nodeClasses.join(" ")}`);
      let score = 0, strong = false;
      ct.forEach((t) => { if (taskTokens.has(t)) { score++; if (/^[a-z0-9]{3,}$/.test(t)) strong = true; } });
      return { r, score, strong };
    })
    .filter((x) => x.strong || x.score >= 2)
    .sort((a, b) => (b.score - a.score) || (b.r.createdAt - a.r.createdAt))
    .slice(0, n);
  return scored.map((x) => ({
    id: x.r.id,
    label: x.r.task || "（未命名任务）",
    workflowJson: x.r.workflowJson.length > maxJsonLen ? x.r.workflowJson.slice(0, maxJsonLen) + "…（已截断）" : x.r.workflowJson,
    nodeClasses: x.r.nodeClasses,
    createdAt: x.r.createdAt,
  }));
}

/** 召回与任务相关的「失败教训/已知坑」（只看失败记录），去重后返回若干条，供注入引擎主动规避。 */
export async function recallPitfalls(baseUrl: string, task: string, limit = 10): Promise<string[]> {
  const taskTokens = tokenizeForMatch(task);
  if (!taskTokens.size) return [];
  let rows: ComfyWorkflowMemoryRow[];
  try { rows = await listComfyWorkflowMemory(norm(baseUrl)); } catch { return []; }
  const relevant = rows
    .filter((r) => r.status !== "success" && r.meta?.failReasons?.length)
    .map((r) => {
      const ct = tokenizeForMatch(`${r.task} ${r.nodeClasses.join(" ")}`);
      let score = 0, strong = false;
      ct.forEach((t) => { if (taskTokens.has(t)) { score++; if (/^[a-z0-9]{3,}$/.test(t)) strong = true; } });
      return { r, score, strong };
    })
    .filter((x) => x.strong || x.score >= 2)
    .sort((a, b) => (b.score - a.score) || (b.r.createdAt - a.r.createdAt));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { r } of relevant) {
    for (const reason of r.meta!.failReasons!) {
      const key = reason.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(reason.trim());
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** 列出经验（管理 UI / 多方查询）。 */
export function listWorkflowExperiences(baseUrl?: string): Promise<ComfyWorkflowMemoryRow[]> {
  return listComfyWorkflowMemory(baseUrl ? norm(baseUrl) : undefined);
}

/** 关键词检索经验（子串命中 task 或 nodeClasses，大小写不敏感）。 */
export async function searchWorkflowExperiences(query: string, baseUrl?: string, limit = 50): Promise<ComfyWorkflowMemoryRow[]> {
  const rows = await listComfyWorkflowMemory(baseUrl ? norm(baseUrl) : undefined);
  const q = query.trim().toLowerCase();
  if (!q) return rows.slice(0, limit);
  return rows.filter((r) => r.task.toLowerCase().includes(q) || r.nodeClasses.some((c) => c.toLowerCase().includes(q))).slice(0, limit);
}

export function deleteWorkflowExperience(id: number): Promise<void> {
  return deleteComfyWorkflowMemory(id);
}

export function clearWorkflowExperiences(baseUrl?: string): Promise<void> {
  return clearComfyWorkflowMemory(baseUrl ? norm(baseUrl) : undefined);
}
