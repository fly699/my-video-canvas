import { z } from "zod";
import { FACTORY_DEFAULT_MODELS } from "../../shared/nodeDefaultModels";
import { router, protectedProcedure } from "../_core/trpc";
import { assertProjectAccess } from "../_core/permissions";
import { assertLLMAllowed } from "../_core/whitelist";
import { isCustomLLMModel } from "../_core/customLlm";
import { extractTextContent, type Message, type MessageContent } from "../_core/llm";
import { invokeLLMWithKie } from "../_core/llmWithKie";
import type { TrpcContext } from "../_core/context";
import { catalogText, sanitizeOperationDetailed, templateKnowledgeText, modelKnowledgeText } from "../_core/agentCatalog";
import { selfCheckRule, includeGuideRule } from "../_core/agentPromptFlags";
import { buildAgentModelSkillSection } from "../_core/modelSkills";
import { assignServersRoundRobin } from "../_core/superAgent/serverAssign";
import { enforceImageFirst, enforceImageFirstComfy } from "../_core/imageFirst";
import { runLibraryAnalysis } from "../_core/templateAnalysis";
import { broadcastAgentHistoryUpdated } from "../_core/agentBus";
import { assertSafeUrl } from "../_core/videoEditor";
import { storagePut, assertObjectStorageWritable } from "../storage";
import { ENV } from "../_core/env";
import { peekComfyKnowledge, getComfyKnowledge, type ComfyKnowledge } from "../_core/comfyKnowledge";
import { recallWorkflowExperiences, recallPitfalls, recordPlanPitfall, AGENT_PLAN_MEMORY_BASE } from "../_core/comfyExperience";
import * as db from "../db";
// #259 规划质量打点：runAgentChat 主路径完成时落一条 action=agent_plan_quality 的操作日志，
// 管理后台「LLM 日志 → 规划质量」卡按开关组合聚合展示（拒因率/自愈率/平均操作数/耗时）。
import { writeAuditLog } from "../_core/auditLog";
import type { AgentOperation } from "../../shared/types";

/** 从模型文本里稳健抽出所有【顶层配平】的 { … } 对象——括号配平扫描，跳过字符串内的 {}/引号，
 *  避免贪婪 /\{[\s\S]*\}/ 把技能说明/散文里的花括号一起吃进来。返回按出现顺序的候选串。 */
export function extractJsonObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { if (depth > 0 && --depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

/** 是否值得对规划结果做一次「自愈」修复重试。纯函数，便于单测。
 *  仅两种「原本就要放弃 / 给不出有用结果」的情形触发；正常成功规划一律 false（不拖慢正常请求）：
 *  1) 解析失败，但模型明显在尝试给 operations（含该键、或以 { / ``` 开头）→ 多半截断或轻微格式错，值得修；
 *     纯散文回答（提问/解释，无 operations）不触发——保留其原文。
 *  2) 解析成功但所有操作都被目录/模型清单校验拒绝、且确有被拒项 → 用户什么也拿不到，回喂拒因让模型改正。 */
export function shouldRepairPlan(res: { parsedOk: boolean; operations: unknown[]; dropped: unknown[]; cleaned: string; text: string }): boolean {
  if (!res.parsedOk) return /"operations"\s*:/.test(res.cleaned) || /^\s*[`{]/.test(res.text);
  return res.operations.length === 0 && res.dropped.length > 0;
}

/** 构造回喂给模型的修复指令（对应 shouldRepairPlan 的两种情形）。纯函数，便于单测。 */
export function buildRepairInstruction(parsedOk: boolean, dropped: unknown[]): string {
  if (!parsedOk) {
    return "你上一条回复未能被解析为合法 JSON（可能被截断，或含多余文字/未闭合括号）。请【只】输出一个完整、合法、可被 JSON.parse 的对象，形如 {\"reply\":\"…\",\"operations\":[…]}，不要任何代码围栏或额外说明；若操作太多导致过长，请减少镜头/步骤数量以保证 JSON 完整闭合。";
  }
  const reasons = Array.from(new Set(dropped.map((d) => String(d)))).slice(0, 8).join("；");
  return `你上一条规划里的操作全部被系统按「节点目录 / 字段白名单 / 模型清单」校验拒绝，原因：${reasons}。请严格只用前文清单中真实存在的节点类型、字段名、模型 id 与 params 键重新输出 {"reply","operations"}，不要编造任何清单外的值。`;
}

/** 上下文总量预算动态分配：30k 级大纲 + 完整历史/画布摘要 + 16000 输出预算会让自建 27B 级
 *  模型单次生成耗时数分钟，撞上 llm.ts 的 fetch 超时（自建 300s / 云端 120s）而报「请求超时」。
 *
 *  规则（正文 message 永不截断）：
 *  - message+history+graphSummary 总字符数 ≤ AGENT_INPUT_CHAR_BUDGET → 全部原样，不动。
 *  - 超预算时，扣除正文后的剩余预算在两者间分配：graphSummary 拿剩余的一半（下限
 *    GRAPH_MIN_CHARS），历史用余下额度从最新往旧装（整条装不下且已有 ≥2 条时截断/停止）；
 *    无论多挤都保底最近 HISTORY_MIN_KEEP 条、每条至少 HISTORY_MIN_ENTRY_CHARS 字符。
 *  - 正文越短剩余越多，历史/摘要保留就越多——不再是旧版「一刀切 2 条×1000 + 4000」。
 *  - 输出预算按正文长度分两档：>LONG_INPUT_THRESHOLD 时 16000→6000（自建模型 llm.ts 有
 *    8192 思维链下限，实际生效 8192，仍约减半），缩短大输入下的单次生成耗时。 */
export const AGENT_INPUT_CHAR_BUDGET = 40_000;
export const LONG_INPUT_THRESHOLD = 8000;
export const GRAPH_MIN_CHARS = 4000;
export const HISTORY_MIN_KEEP = 2;
export const HISTORY_MIN_ENTRY_CHARS = 1000;

type AgentTurn = { role: "user" | "assistant"; content: string };

/** ③ 对话/规划分流：解析意图分类器输出。**强偏 plan**——只有明确判为纯闲聊/问答（含 chat 且不含
 *  任何要动画布的信号）才回 "chat"；空/异常/拿不准一律回 "plan"（= 原完整规划路径，绝不比原来差）。
 *  纯函数便于单测。 */
export function parseIntentDecision(raw: string | null | undefined): "chat" | "plan" {
  const t = (raw ?? "").toLowerCase().trim();
  if (!t) return "plan";
  const planHit = /\bplan\b|规划|建节点|做视频|生成|加节点|改节点|删节点|连线|整理布局|动画布/.test(t);
  const chatHit = /\bchat\b|闲聊|纯问答|无需|不需要/.test(t);
  return chatHit && !planHit ? "chat" : "plan";
}

export function allocateContextBudget(args: {
  message: string;
  history?: AgentTurn[];
  graphSummary?: string;
}): { trimmed: boolean; history: AgentTurn[]; graphSummary: string; maxTokens: number } {
  const graphSummary = args.graphSummary?.trim() ?? "";
  const history = args.history ?? [];
  const maxTokens = args.message.length > LONG_INPUT_THRESHOLD ? 6000 : 16000;
  const histTotal = history.reduce((a, m) => a + m.content.length, 0);
  if (args.message.length + histTotal + graphSummary.length <= AGENT_INPUT_CHAR_BUDGET) {
    return { trimmed: false, history, graphSummary, maxTokens };
  }
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…（已截断）" : s);
  // 正文优先占用；剩余预算保底能装下 graph 下限 + 历史保底条数。
  const remaining = Math.max(
    AGENT_INPUT_CHAR_BUDGET - args.message.length,
    GRAPH_MIN_CHARS + HISTORY_MIN_KEEP * HISTORY_MIN_ENTRY_CHARS,
  );
  const graphBudget = Math.min(graphSummary.length, Math.max(GRAPH_MIN_CHARS, Math.floor(remaining / 2)));
  const graph = clip(graphSummary, graphBudget);
  let histBudget = remaining - graphBudget;
  const kept: AgentTurn[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const mustKeep = kept.length < HISTORY_MIN_KEEP;
    // 保底条目即使预算耗尽也至少给 HISTORY_MIN_ENTRY_CHARS；预算所剩无几时不再装非保底条目。
    const allow = mustKeep ? Math.max(histBudget, HISTORY_MIN_ENTRY_CHARS) : histBudget;
    if (!mustKeep && allow < 500) break;
    const content = clip(history[i].content, allow);
    kept.unshift({ role: history[i].role, content });
    histBudget = Math.max(0, histBudget - content.length);
  }
  return { trimmed: true, history: kept, graphSummary: graph, maxTokens };
}

// ── Higgsfield MCP 产物落地 ───────────────────────────────────────────────────
/** Higgsfield MCP 产物链接判定。真实产物常挂 CloudFront（如
 *  d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260710_….png），域名不含品牌词（真机截图实锤）——
 *  故除主机名含 higgsfield 外，还识别「*.cloudfront.net + 路径含 hf_/higgsfield」。
 *  其余 URL 一律不动；将来换 CDN 可用 MCP_ASSET_HOST_HINTS（逗号分隔主机名子串）追加。 */
export function isHiggsfieldUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    if (host.includes("higgsfield")) return true;
    if (host.endsWith(".cloudfront.net") && /\/(hf_|higgsfield)/i.test(url.pathname)) return true;
    const hints = (process.env.MCP_ASSET_HOST_HINTS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    return hints.some((h) => host.includes(h));
  } catch { return false; }
}
/** 从文本抽出全部 Higgsfield URL（去重、去尾部标点）。 */
export function extractHiggsfieldUrls(text: string): string[] {
  const out = new Set<string>();
  // URL 只含 ASCII——用白名单字符集，避免中文语境里全角标点/汉字被粘进链接（如「…a.png，视频」）。
  const matches = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/g) ?? [];
  for (const m of matches) {
    const u = m.replace(/[.,;:!?]+$/, "");
    if (isHiggsfieldUrl(u)) out.add(u);
  }
  return Array.from(out);
}

/** 把一条 Higgsfield 外链下载转存到自有存储并记入素材库（外链约 24h 过期）。
 *  失败返回 null（保留原链，不影响回复）。100MB 上限、60s 超时、SSRF 守卫（含重定向后）。
 *  导出供聊天室 AI 助手复用（sendToAssistant 同款落地：隐藏外链 + 入素材库 + 门控渲染）；
 *  聊天场景无项目上下文，projectId 传 null。 */
export async function rehostMcpAsset(userId: number, projectId: number | null, url: string): Promise<{ url: string; type: "image" | "video" | "audio" | "other"; name: string; mimeType: string; size: number } | null> {
  try {
    assertSafeUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
    if (res.url) assertSafeUrl(res.url); // 重定向后复检，防公网 302 到内网
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const MAX = 100 * 1024 * 1024;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { total += value.length; if (total > MAX) { try { await reader.cancel(); } catch { /* ignore */ } return null; } chunks.push(value); }
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const type = mime.startsWith("video/") ? "video" as const : mime.startsWith("audio/") ? "audio" as const : mime.startsWith("image/") ? "image" as const : "other" as const;
    const rawName = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "") || "higgsfield";
    const name = rawName.replace(/[^\w.\-一-龥]/g, "_").slice(0, 80) || "higgsfield";
    await assertObjectStorageWritable();
    const { url: own, key } = await storagePut(`u/${userId}/mcp/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${name}`, buffer, mime);
    await db.recordGeneratedAsset({ userId, projectId, type, source: "generated", provider: "higgsfield", model: "mcp", url: own, storageKey: key, name, mimeType: mime, size: buffer.length });
    return { url: own, type, name, mimeType: mime, size: buffer.length };
  } catch { return null; }
}

// ── Agent (Copilot) router ────────────────────────────────────────────────────
// `chat` is the agent's "planning brain": it turns a natural-language request +
// the current graph into a set of canvas operations (create/connect/update/
// delete). It NEVER mutates the canvas server-side — the client applies the
// returned operations through the canvas store, so every change is undoable,
// persisted and broadcast exactly like a manual edit. LLM-gated (respects the
// admin "open LLM" toggle); editor access required.
const agentChatInput = z.object({
        projectId: z.number(),
        message: z.string().min(1).max(32000),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .max(20)
          .optional(),
        graphSummary: z.string().max(20000).optional(),
        /** A3 增量规划：用户框选的节点 id 列表。非空时服务端启用硬约束——system prompt
         *  明示只改选中节点，且 sanitize 拦截对框选外既有节点的 update/delete（本轮新建
         *  tempId 豁免）。此前 selection 只影响前端摘要裁剪，模型仍可能越界改无关节点。 */
        selectedNodeIds: z.array(z.string().max(64)).max(200).optional(),
        model: z.string().optional(),
        comfyOnly: z.boolean().optional(),
        /** #140 跳过 ComfyUI 模板知识：客户端确定本轮不会用 ComfyUI（快速设置「节点」
         *  未勾任何 comfyui_* 复选框）时传 true——不触发后台模板分析、不读模板表、
         *  不注入模板知识段，省 DB 读与提示词体积。与 comfyOnly 互斥（comfyOnly 优先）。 */
        skipComfyTemplates: z.boolean().optional(),
        /** 是否使用 ComfyUI 记忆体（资源记忆 + 工作流经验）注入规划上下文。默认 true；关掉则不注入。 */
        useComfyMemory: z.boolean().optional(),
        /** #141 模型清单按需注入：快速设置锁定的图/视频模型 id——对应类别只注入所锁模型
         *  的完整参数条目（其余压成名字目录），提示词大幅缩身。空/无效值 = 该类别全量。 */
        pinnedImageModel: z.string().max(128).optional(),
        pinnedVideoModel: z.string().max(128).optional(),
        /** #211 模型技能（快速设置开关，默认关）：开启且锁定了图/视频模型时，把技能库
         *  （管理后台「模型→技能库」）中该模型的提示词技法附在模型清单后作写作参考。
         *  关闭/未锁定/无技能 → 完全不注入，提示词与现状逐字一致。 */
        useModelSkills: z.boolean().optional(),
        /** 交互式规划（快速设置开关，默认关）：开启后进入分步交互模式——每轮只聚焦一个
         *  决策点、给编号选项、operations 留空，直到用户确认「开始落地」才输出完整操作。 */
        interactive: z.boolean().optional(),
        /** #258 ⑦ 按对话类型精简提示词（快速设置开关，默认关）：开启且本轮消息为明确的
         *  生产指令（无任何疑问/求助特征）时，省略「应用操作答疑」段；拿不准一律全量注入。 */
        leanPrompt: z.boolean().optional(),
        /** #258 ⑧ 输出前自查清单（快速设置开关，默认关）：开启时在 # 输出要求 规则清单
         *  末尾追加一条自查规则（纯追加行，不动既有内容）。 */
        selfCheck: z.boolean().optional(),
        /** #145 对白语种（快速设置）：所有人声文本统一语言。独立字段而非只靠 prefs 文本——
         *  注入 system 输出要求区的最高优先级硬规则（prefs 尾部弱约束曾被模型无视，中文
         *  设置仍出英文对白）。 */
        dialogueLang: z.string().max(32).optional(),
        /** Pre-rendered 用户偏好/约束 block from the agent node's 规划设置 dialog. */
        prefs: z.string().max(2000).optional(),
        /** 画布助手「模板」人设/风格（选中的 AI 模板 prompt）——引导构思风格，但不得破坏 JSON 输出。 */
        persona: z.string().max(1500).optional(),
        /** 生图→生视频偏好：开启后服务端确定性地把 文本→视频 改写为 文本→图像→视频。 */
        imageFirst: z.boolean().optional(),
        /** 用户在「模板选择」里指定的 comfyui_workflow 模板（留空=自动选择）。 */
        imageTemplateId: z.number().optional(),
        videoTemplateId: z.number().optional(),
        /** 让智能体「知道」角色库：系统提示里列出已有角色/场景名，要求按原名复用。默认开启。 */
        includeCharacterLibrary: z.boolean().optional(),
        /** ③ 对话/规划分流（快速设置「简单问答免规划」，默认关）：开启后，先用一次极短分类判定
         *  本轮是【纯闲聊/问答】还是【要动画布】；判为闲聊时走轻量短回答（不注入目录/模型清单/模板，
         *  跳过全部模板与记忆读取），简单问答快数倍、省次数。分类拿不准或涉及做视频/加改节点一律走
         *  完整规划（与原行为一致，不会更差）；带参考附件时同样直接走规划。 */
        fastChatRoute: z.boolean().optional(),
        /** 参考附件（图/文档）：url 为 data: URI 或 http(s)。图片走 image_url、文档走 file_url，
         *  由底层 invokeLLM/桥接统一喂给多模态模型；纯文本模型仅能读文档文本、忽略图。 */
        attachments: z
          .array(
            z.object({
              url: z.string().min(1).max(14_000_000),
              mimeType: z.string().max(120).optional(),
              name: z.string().max(300).optional(),
            }),
          )
          .max(4)
          .optional(),
      });

type AuthedCtx = TrpcContext & { user: NonNullable<TrpcContext["user"]> };

// ── 后台任务化的画布助手规划 ────────────────────────────────────────────────
// 长生成（本机 Claude/GPT 大计划 3~10 分钟）靠一条 HTTP 长连接等结果太脆：网络抖动/代理
// 掐线/服务重启都会让客户端白等——真实翻车：回复已生成完，连接中途断了报「网络请求失败」。
// 改为 submitChat 提交 → chatStatus 轮询（同图生 3D 的两端点模式），彻底不依赖长连接。
type AgentChatJob = { userId: number; createdAt: number; done: boolean; stage?: string; result?: Awaited<ReturnType<typeof runAgentChat>>; error?: string };
const agentChatJobs = new Map<string, AgentChatJob>();
const AGENT_JOB_TTL_MS = 30 * 60_000; // 完成后 30 分钟内没被取走（客户端崩了）就清理
// #251 跨进出画布续跑：按项目记「进行中/已完成未取走」的规划任务。此前 jobId 只在前端
// 组件 state 里——退出画布即失联，服务端任务白跑、结果 30 分钟后被清。重进画布凭
// projectId 找回 jobId 接着轮询。内存 Map 与 agentChatJobs 同生命周期（服务重启同丢）。
const pendingJobByProject = new Map<number, { jobId: string; userId: number; prompt: string }>();
function clearPendingByJobId(jobId: string): void {
  pendingJobByProject.forEach((p, projectId) => { if (p.jobId === jobId) pendingJobByProject.delete(projectId); });
}
let _lastRowSweep = 0;
function sweepAgentChatJobs(): void {
  const now = Date.now();
  agentChatJobs.forEach((j, k) => {
    if (now - j.createdAt > AGENT_JOB_TTL_MS) { agentChatJobs.delete(k); clearPendingByJobId(k); }
  });
  // #252 持久层清扫节流（chatStatus 高频调用，别每次都发 DELETE）：每 10 分钟一次，
  // 清 24 小时前的旧行（结果一次性消费，久未取走视为弃单）。
  if (now - _lastRowSweep > 10 * 60_000) {
    _lastRowSweep = now;
    void db.sweepAgentChatJobRows(24 * 3600_000).catch(() => { /* 持久层清扫失败无碍主流程 */ });
  }
}

// #136 规划提速：非 comfyOnly 的模板增量分析改为后台执行（不阻塞规划链路）。
// 在飞守卫：多轮对话/多用户并发时不重复起分析（runLibraryAnalysis 本身是增量的，
// 但并发两份会对同一批新模板各跑一遍 LLM 分析，白花钱）。
let libraryAnalysisInFlight: Promise<unknown> | null = null;

// ── ComfyUI 知识记忆体接入画布助手 ─────────────────────────────────────────────
// 工程智能体每次检索 ComfyUI 服务器的 checkpoint/LoRA/VAE/采样器/节点类都会写入「知识记忆体」
// （server/_core/comfyKnowledge.ts，内存 + DB 持久化）。画布助手是「一次性 JSON 规划」智能体，
// 无法在生成中途调用工具，所以「接成可查询的工具」= 规划前把记忆体里该服务器真实装有的资源直接
// 注入规划上下文——助手据此按真实存在的 checkpoint/LoRA/节点来规划（如为 comfyui_image 选真实
// 存在的 ckpt、避免编造），与工程智能体、ComfyUI 节点共享同一份记忆，天然复用不重复检索。
async function resolveAgentComfyBase(): Promise<string> {
  if (ENV.comfyuiBaseUrl) return ENV.comfyuiBaseUrl;
  try { return (await db.getComfyGlobalServers())[0] ?? ""; } catch { return ""; }
}

export function buildComfyResourceSection(k: ComfyKnowledge): string {
  const r = k.resources;
  const list = (arr: string[], cap: number) =>
    arr.length ? arr.slice(0, cap).join("、") + (arr.length > cap ? ` …(共 ${arr.length} 项)` : "") : "（无）";
  const ageMs = Date.now() - k.fetchedAt;
  const mins = Math.round(ageMs / 60000);
  const when = mins <= 0 ? "刚学习" : mins < 60 ? `${mins} 分钟前学习` : `${Math.round(mins / 60)} 小时前学习`;
  const lines = [
    `- checkpoints（大模型，共 ${r.checkpoints.length}）：${list(r.checkpoints, 40)}`,
    `- LoRA（共 ${r.loras.length}）：${list(r.loras, 40)}`,
  ];
  if (r.vaes.length) lines.push(`- VAE（共 ${r.vaes.length}）：${list(r.vaes, 20)}`);
  if (r.samplers.length) lines.push(`- 采样器：${list(r.samplers, 30)}`);
  if (r.schedulers.length) lines.push(`- 调度器：${list(r.schedulers, 30)}`);
  if (r.nodeClasses.length) lines.push(`- 已安装节点类（共 ${r.nodeClasses.length}）：${list(r.nodeClasses, 80)}`);
  return `\n\n# ComfyUI 服务器已装资源（知识记忆体·${when}）\n（以下是工程智能体从你的 ComfyUI 服务器真实检索并记住的资源清单，与工程智能体/ComfyUI 节点共享同一份记忆。规划涉及 ComfyUI 的节点时，checkpoint/LoRA/VAE/采样器/节点类【只能从下面真实存在的项里选】，禁止编造清单外的名称；若这里为空或与实际不符，可到画布顶栏服务器面板点「复位全部记忆」重新学习。）\n${lines.join("\n")}`;
}

/** 取该 ComfyUI 服务器的记忆体资源段（供规划注入）。优先命中记忆（内存/DB，即时），
 *  冷启动的真机抓取不阻塞规划——超时则本轮返回空段（后台抓取仍在预热，下轮即可用）。 */
async function loadComfyResourceSection(): Promise<string> {
  const base = (await resolveAgentComfyBase()).trim();
  if (!base) return "";
  const hit = peekComfyKnowledge(base);
  const k = hit ?? (await Promise.race([
    getComfyKnowledge(base).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]));
  if (!k) return "";
  const r = k.resources;
  // 全空（既没模型也没节点类）多半是没连上/记忆无效，注入空段无意义，跳过。
  if (!r.checkpoints.length && !r.loras.length && !r.nodeClasses.length) return "";
  return buildComfyResourceSection(k);
}

/** 取该 ComfyUI 服务器上、与本次任务相似的「成功工作流经验」摘要段（供规划参考，不含完整 JSON）。 */
async function loadComfyExperienceSection(task: string): Promise<string> {
  const base = (await resolveAgentComfyBase()).trim();
  if (!base) return "";
  const exps = await recallWorkflowExperiences(base, task, 3).catch(() => []);
  if (!exps.length) return "";
  const lines = exps.map((e) => {
    const cls = e.nodeClasses.slice(0, 12).join("、") + (e.nodeClasses.length > 12 ? " …" : "");
    return `- 「${e.label}」${cls ? `（关键节点：${cls}）` : ""}`;
  });
  return `\n\n# ComfyUI 工作流经验记忆体（工程智能体已成功搭通的相似工作流）\n（工程智能体在你这台 ComfyUI 上真实搭建并跑通过下列工作流；说明这些效果在本服务器上「可实现」。若规划需要用到 ComfyUI 自定义工作流，可据此判断哪些方案可行、优先复用已验证的路子；具体套用可让工程智能体按同类任务再建。）\n${lines.join("\n")}`;
}

/** A4 失败经验反哺：召回与本次任务相关的「以往规划踩过的坑」（sanitize 拒因沉淀，
 *  作用域独立于各 ComfyUI 服务器），注入规划上下文让模型主动规避重蹈。无相关坑返回空串。 */
async function loadPlanPitfallSection(task: string): Promise<string> {
  const pitfalls = await recallPitfalls(AGENT_PLAN_MEMORY_BASE, task, 6).catch(() => [] as string[]);
  if (!pitfalls.length) return "";
  return `\n\n# 以往规划踩过的坑（历史规划中被系统拒绝的操作，务必规避，不要再犯同类错误）\n${pitfalls.map((p) => `- ${p}`).join("\n")}`;
}

async function runAgentChat(ctx: AuthedCtx, input: z.infer<typeof agentChatInput>, onStage?: (stage: string) => void) {
      const planStartedAt = Date.now(); // #259 规划质量打点：全程耗时
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // 自定义模型走自带 key 体系：门控收敛到 invokeLLMWithKie（自带 key 放行 / env 兜底门控）。
      if (!isCustomLLMModel(input.model)) await assertLLMAllowed(ctx, input.model);

      const model = input.model ?? FACTORY_DEFAULT_MODELS.llm;
      // 工程智能体（super_agent）需 L3+ 才能运行——只有够权限时才向规划器开放该节点（目录 + 校验双重把关）。
      const allowSuperAgent = (ctx.user.adminLevel ?? 0) >= 3;

      // 上下文总量预算动态分配（正文永不截断），避免大输入单次生成撞 LLM fetch 超时。
      const ctxBudget = allocateContextBudget(input);

      // ③ 对话/规划分流（opt-in，快速设置「简单问答免规划」）：开启且无参考附件时，先用一次极短分类
      // 判定意图；判为纯闲聊/问答就走轻量短回答——跳过目录/模型清单/模板/记忆的全部拼装与 DB 读取，
      // 简单问答快数倍、省一次大规划。分类拿不准/异常一律 fall through 到下方完整规划（绝不比原来差）。
      // 带附件（图/文档）时用户多半想「据此做点什么」，直接走完整规划、不快路。
      // #230：交互式规划开启时禁用快路——分步决策的中间轮次（「选 2：治愈日系」「1」等
      // 纯选项回复）极易被意图分类器判成 chat，走轻量问答就绕开了交互协议段（丢共识推进、
      // 不给下一个决策点选项、更不会落地）。交互模式的每一轮都必须走完整规划链路。
      if (input.fastChatRoute && !input.interactive && !(input.attachments && input.attachments.length)) {
        try {
          onStage?.("判定意图");
          const clsMessages: Message[] = [
            { role: "system", content: "你是意图分类器。判断用户这轮消息是【纯闲聊或一般问答，无需在画布上增删改节点/连线/执行画布动作】，还是【需要动画布：做视频、加/改/删节点、连线、整理布局、批量生成等】。只输出一个词：chat 或 plan。拿不准，或涉及做视频/加改节点/画布动作，一律输出 plan。" },
            ...ctxBudget.history.slice(-2).map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: input.message },
          ];
          const clsResp = await invokeLLMWithKie(ctx, { messages: clsMessages, model, maxTokens: 8 });
          if (parseIntentDecision(extractTextContent(clsResp)) === "chat") {
            onStage?.("回答中");
            const chatSystem = `你是「AI 视频画布」的智能助手，用简洁中文回答用户的问题或闲聊。
# 当前画布（仅供参考，不要编造画布上没有的东西）
${ctxBudget.graphSummary || "（空画布）"}${input.prefs?.trim() ? `\n\n# 用户偏好/约束\n${input.prefs.trim()}` : ""}${input.persona?.trim() ? `\n\n# 创作风格 / 人设\n${input.persona.trim()}` : ""}
直接用自然语言回答，不要输出 JSON、不要凭空捏造画布内容。若用户其实想在画布上做点什么（建节点/做视频等），用一句话提示他直接说需求，你会为他编排。`;
            const chatResp = await invokeLLMWithKie(ctx, {
              messages: [
                { role: "system", content: chatSystem },
                ...ctxBudget.history.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: input.message },
              ],
              model,
              maxTokens: Math.min(ctxBudget.maxTokens, 1500),
            });
            const reply = extractTextContent(chatResp).trim() || "（我这边没有生成有效回答，请再说一次或换个问法。）";
            return { reply, operations: [] as AgentOperation[], repaired: false };
          }
        } catch (e) {
          console.warn("[agent] fast chat route failed, fall through to full plan:", e instanceof Error ? e.message : e);
        }
      }

      // Refresh template knowledge before planning. comfyOnly REQUIRES the full
      // library be analyzed (otherwise the agent only "knows" a partial subset and
      // picks the wrong templates), so there we still await (many per turn, cached).
      // #136 非 comfyOnly：分析改后台跑、绝不阻塞规划——此前每逢新增/变更模板，规划前要
      // 串行等最多 6 次 LLM 分析调用（实测数十秒到分钟级），这是「规划太慢」的头号元凶。
      // 本轮直接用现有分析结果（新模板下一轮自然可见），后台增量分析继续补齐。
      // #140 跳过模板知识：客户端确定本轮不会用 ComfyUI（快速设置未勾任何 comfyui_*）时
      // 完全绕开模板链路——不触发分析、不读模板表、不注入模板知识段。comfyOnly 优先生效。
      // A3 批2：框选节点 = 增量编辑意图的确定性信号（不靠 LLM 分类，零误判）。编辑模式下
      // 裁剪 system prompt 静态骨干：模型清单压成 id 目录（见 modelKnowledgeText.compact）；
      // 框选子图摘要里没有任何 comfyui 节点（且非 comfyOnly、未显式指定模板）时，本轮编辑
      // 用不到模板知识 → 走 #140 同一跳过路径（不读模板表、不注入模板段与 comfy 记忆段）。
      const editMode = (input.selectedNodeIds?.length ?? 0) > 0;
      const editSkipsTemplates = editMode && !input.comfyOnly
        && !input.imageTemplateId && !input.videoTemplateId
        && !/comfyui/i.test(input.graphSummary ?? "");
      const skipTemplates = (!input.comfyOnly && input.skipComfyTemplates === true) || editSkipsTemplates;
      if (input.comfyOnly) {
        onStage?.("分析模板库");
        try { await runLibraryAnalysis(ctx, model, { max: 40 }); } catch { /* non-fatal */ }
      } else if (!skipTemplates && !libraryAnalysisInFlight) {
        libraryAnalysisInFlight = runLibraryAnalysis(ctx, model, { max: 6 })
          .catch((e) => console.warn("[agent] bg template analysis failed:", e instanceof Error ? e.message : e))
          .finally(() => { libraryAnalysisInFlight = null; });
      }
      onStage?.("读取画布与知识");
      let templateSection = "";
      const validTemplateIds = new Set<number>();
      let hasImageTemplate = false;
      let hasVideoTemplate = false;
      let imageTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      let videoTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      if (!skipTemplates) try {
        const [templates, analyses] = await Promise.all([db.listComfyNodeTemplates(), db.listComfyTemplateAnalysis()]);
        // Only comfyui_workflow templates carry a workflowJson + paramBindings, and
        // only the comfyui_workflow node references templates by payload.templateId
        // (comfyui_image / comfyui_video templates have NO templateId field in the
        // catalog). Referencing a non-workflow template id from a comfyui_workflow
        // node materializes to an EMPTY node (no workflow, no params/model), so the
        // agent's template set MUST be restricted to comfyui_workflow templates.
        const labelById = new Map(templates.filter((t) => t.nodeType === "comfyui_workflow").map((t) => [t.id, t.label]));
        const rows = analyses
          .filter((a) => labelById.has(a.templateId))
          .sort((a, b) => (b.hasVideoOutput ? 1 : 0) - (a.hasVideoOutput ? 1 : 0))
          .map((a) => ({ id: a.templateId, label: labelById.get(a.templateId)!, functionSummary: a.functionSummary ?? "", capabilities: (a.capabilities as string[] | null) ?? [], outputType: a.outputType ?? undefined, hasVideoOutput: a.hasVideoOutput ?? undefined, shotSeconds: a.maxFrames && a.fps ? Math.round((a.maxFrames / a.fps) * 10) / 10 : null }));
        for (const r of rows) validTemplateIds.add(r.id);
        imageTpls = rows.filter((r) => r.outputType === "image" || r.outputType === "mixed").map((r) => ({ id: r.id, label: r.label, shotSeconds: r.shotSeconds, caps: r.capabilities }));
        videoTpls = rows.filter((r) => r.hasVideoOutput || r.outputType === "video" || r.outputType === "mixed").map((r) => ({ id: r.id, label: r.label, shotSeconds: r.shotSeconds, caps: r.capabilities }));
        hasImageTemplate = imageTpls.length > 0;
        hasVideoTemplate = videoTpls.length > 0;
        if (rows.length > 0) {
          templateSection = `\n\n# 已分析的 ComfyUI 自定义工作流模板（comfyui_workflow 可用 payload.templateId 引用其 id）\n${templateKnowledgeText(rows)}`;
        }
      } catch (e) {
        // Surface (don't silently swallow) — most likely the analysis table is
        // missing (migration 0037 not applied), which otherwise looks like an
        // "empty library" to the agent.
        console.warn("[agent] template analysis unavailable:", e instanceof Error ? e.message : e);
      }

      // 让智能体「知道」角色库（可选）：列出用户保存的角色/场景名 + 简介，引导它按原名
      // 复用、不重编外观。参考图/LoRA/语音由客户端在应用时按用户选择的力度自动代入。
      let characterSection = "";
      if (input.includeCharacterLibrary !== false) {
        try {
          const chars = await db.listCharacterLibrary(ctx.user.id);
          if (chars.length) {
            const trunc = (s: string) => (s.length > 40 ? s.slice(0, 40) + "…" : s);
            const lines = chars.slice(0, 60).map((c) => {
              const p = (c.payload ?? {}) as Record<string, unknown>;
              const kind = c.characterKind === "scene" ? "scene" : "person";
              const brief = kind === "scene"
                ? String(p.sceneDescription ?? p.atmosphere ?? "").trim()
                : [p.role, p.appearance].filter((x) => typeof x === "string" && x.trim()).map(String).join("·");
              return `- 「${c.name}」(${kind})${brief ? " — " + trunc(brief) : ""}`;
            });
            characterSection = `\n\n# 已有角色库（用户保存的可复用角色/场景）\n${lines.join("\n")}\n（若用户用 @名字 引用、或剧情需要这些角色/场景，创建 character 节点时务必用与库中完全一致的 name/sceneName，并沿用其设定、不要另行编造外观；其参考图/LoRA/语音会在应用时自动代入，你无需也无法填写这些字段。）`;
          }
        } catch (e) {
          console.warn("[agent] character library unavailable:", e instanceof Error ? e.message : e);
        }
      }

      // 工程智能体编排指引（仅 L3+ 开放）：告诉规划器何时该建 super_agent 节点并让它自动干活。
      const superAgentHint = allowSuperAgent
        ? "\n\n# 工程智能体编排（可选，你有权限使用）\n当用户要用【自建 ComfyUI】、而「已分析模板」里没有现成合适模板、或需要定制/复杂工作流时，" +
          "可创建 super_agent 节点：在 task 写清要搭什么工作流（出图/出视频、用什么大模型/LoRA/风格/分辨率/关键节点等），并设 autoRun=true 让它建好后自动搭建调通。" +
          "一个 super_agent 节点对应一份工作流（如「每镜一份图生视频工作流」可建多个）。" +
          "【接收上游】把相关的 prompt（提示词）、character（角色/场景）、storyboard（分镜）、图像节点【连线到 super_agent】（connect: 源→super_agent），这些提示词/角色设定/参考图会自动并入它的工程任务——务必把每镜的提示词/角色连给对应的工程智能体，不要只写在 task 文本里。" +
          "【成片汇入】要把工程智能体的产物汇入成片时，直接 connect: super_agent→merge——系统会把它转成「产物目标」，工程智能体调通后【自动】把产出的 comfyui_workflow 节点接到该 merge（无需你连 comfyui_workflow）。一个 super_agent 只设一个产物目标（连一条到 merge 即可）。" +
          "（super_agent 本身无输出桩，除了这条『→merge 表意产物汇入』外，不要从 super_agent 连去其它节点。）" +
          "若模板库已有可用模板，优先用 comfyui_workflow 引用模板（更快），不必事事都派工程智能体。"
        : "";
      // 知识记忆体接入：把工程智能体学过的 ComfyUI 服务器真实资源 + 成功工作流经验注入规划上下文
      //（best-effort）。跳过模板链路（客户端确定本轮不用 ComfyUI）时无需注入，省上下文与记忆读取。
      let comfyResourceSection = "";
      let comfyExperienceSection = "";
      let planPitfallSection = "";
      if (!skipTemplates && input.useComfyMemory !== false) {
        try {
          [comfyResourceSection, comfyExperienceSection, planPitfallSection] = await Promise.all([
            loadComfyResourceSection(),
            loadComfyExperienceSection(input.message),
            loadPlanPitfallSection(input.message), // A4：以往规划拒因反哺（避坑注入）
          ]);
        } catch (e) { console.warn("[agent] comfy knowledge unavailable:", e instanceof Error ? e.message : e); }
      }

      // 仅 ComfyUI 模式但没有任何「已分析模板」可用：拒绝并明确指引，避免 LLM 编造模板生成空壳节点。
      if (input.comfyOnly && validTemplateIds.size === 0) {
        return {
          reply: "已开启「仅 ComfyUI 生成」，但模板知识库为空——我没有任何可引用的已分析工作流模板。请先点工具栏的「新增节点模板库分析」分析你的模板库；若分析后仍为空，多半是数据库尚未应用模板分析表迁移（管理后台「系统更新」跑一次即可）。完成后再让我编排。",
          operations: [],
        };
      }

      // 仅 ComfyUI + 生图→生视频，但缺出图或缺图生视频模板：无法串联，明确指引而非硬凑。
      if (input.comfyOnly && input.imageFirst && (!hasImageTemplate || !hasVideoTemplate)) {
        const missing = !hasImageTemplate ? "「出图（文生图）」" : "「图生视频 / 出视频」";
        return {
          reply: `已开启「仅 ComfyUI 生成」+「生图→生视频」，但模板库里缺少${missing}的工作流模板，无法把"先生图再图生视频"串起来。请在模板库添加并分析一个对应的工作流，或在「规划设置」里关闭「生图→生视频」。（当前已识别：出图模板 ${imageTpls.length} 个、视频模板 ${videoTpls.length} 个。）`,
          operations: [],
        };
      }

      // Prefer the user's explicitly-chosen templates (「模板选择」对话框); else auto-pick.
      const chosenVid = videoTpls.find((t) => t.id === input.videoTemplateId) ?? videoTpls[0];
      // Image template must differ from the video one (a "mixed" template appears in
      // both lists — using the same for both defeats 出图→图生视频).
      const chosenImg = imageTpls.find((t) => t.id === input.imageTemplateId && t.id !== chosenVid?.id)
        ?? imageTpls.find((t) => t.id !== chosenVid?.id)
        ?? imageTpls[0];
      // 按所选模板的特性参数（每镜时长、能力标签）指导分镜规划。
      const capsOf = (t?: { caps?: string[] }) => (t?.caps?.length ? `[${t.caps.join("/")}]` : "");
      const durPlanHint = (t?: { shotSeconds?: number | null }) =>
        t?.shotSeconds && t.shotSeconds > 0 ? `请按该视频模板每镜≈${t.shotSeconds}s 规划镜头数（镜头数≈ceil(目标总时长/${t.shotSeconds})）。` : "";
      const imgVidHint = input.comfyOnly && input.imageFirst && chosenImg && chosenVid
        ? `\n- 本次出图请用模板 id=${chosenImg.id}「${chosenImg.label}」${capsOf(chosenImg)}；图生视频请用模板 id=${chosenVid.id}「${chosenVid.label}」${capsOf(chosenVid)}${chosenVid.shotSeconds ? `（每镜≈${chosenVid.shotSeconds}s）` : ""}。每个镜头各建这两个 comfyui_workflow 并串联（出图 → 图生视频）。${durPlanHint(chosenVid)} 请结合上述模板的能力标签与时长特性来设计分镜（数量、节奏、每镜内容）。`
        : "";

      const comfyConstraint = input.comfyOnly
        ? `\n\n# 仅 ComfyUI 生成（当前已开启）\n- 所有图像/视频/音频生成只能使用 comfyui_workflow 自定义工作流节点；禁止使用 image_gen / video_task / audio / comfyui_image / comfyui_video / storyboard。\n- create comfyui_workflow 时必须用 payload.templateId 引用上面「已分析模板」中真实存在的某个 id（禁止编造 id 或只写名字），并把正向提示词放入 payload.prompt、反向放 payload.negPrompt。${
            input.imageFirst
              ? `\n- 【生图→生视频，已开启】每个镜头必须分两步、串联两个 comfyui_workflow 节点：先用一个「出图模板」(上面 outputType=image 的模板) 的 comfyui_workflow 生成静帧，再用一个「图生视频模板」(outputType=video / hasVideoOutput 的模板) 的 comfyui_workflow 把静帧转成视频；并连接 出图节点 → 图生视频节点（链路：script → prompt → 出图comfyui_workflow → 图生视频comfyui_workflow → merge）。出图与图生视频必须各用对应 outputType 的模板，不能用同一个；两个节点的 payload.prompt 都写该镜头提示词。${imgVidHint}`
              : `\n- 每个镜头用一个「prompt 提示词」节点承载该镜头的提示词，再连接到对应的 comfyui_workflow 节点（script → prompt → comfyui_workflow）。${chosenVid ? `\n- 本次生成请优先使用模板 id=${chosenVid.id}「${chosenVid.label}」${capsOf(chosenVid)}${chosenVid.shotSeconds ? `（每镜≈${chosenVid.shotSeconds}s）` : ""}。${durPlanHint(chosenVid)} 请结合该模板的能力与时长特性设计分镜。` : ""}`
          }`
        : "";

      // 参考附件：图片走 image_url、其余（文档等）走 file_url，一起拼进 user 消息的多模态 content。
      const attachments = input.attachments ?? [];
      const isImageAtt = (a: { url: string; mimeType?: string }) =>
        (a.mimeType ?? "").toLowerCase().startsWith("image/") || /^data:image\//i.test(a.url);
      const imageAtts = attachments.filter(isImageAtt);
      const docAtts = attachments.filter((a) => !isImageAtt(a));
      // #260 附件即可引用：图片附件按【消息中的图片顺序】编号 ref1..refN（客户端替换时
      // 用同一规则构建映射，两端编号必须一致——都是「过滤出图片后按序」）。LLM 只写
      // {{refN}} 占位符，真实 URL 由客户端应用层确定性替换；sanitize 会剥除一切非占位符值。
      const attachRefList = imageAtts.map((a, i) => `- {{ref${i + 1}}} = 第 ${i + 1} 张参考图${a.name ? `「${a.name}」` : ""}`).join("\n");
      const attachmentHint = attachments.length
        ? `\n\n# 用户附带的参考附件（重要）\n${[imageAtts.length ? `${imageAtts.length} 张参考图` : "", docAtts.length ? `${docAtts.length} 份参考文档` : ""].filter(Boolean).join("、")}已随本条消息提供。请据此规划画面风格/构图/角色外观/分镜与文案。${imageAtts.length ? `\n【附件引用清单】\n${attachRefList}\n【附件即可被节点引用】需要把某张参考图直接作为节点的输入图时，在该节点 payload 的 referenceImageUrl 字段写对应占位符（原样含双花括号，如 "{{ref1}}"）——系统会在应用时替换为真实地址。可用于：image_gen（图生图参考）、video_task（首帧，所选模型须吃图）、character（角色/场景主体图锁脸）、storyboard（该镜参考画面）。同一张图可在多个节点引用同一占位符；【严禁】编造 URL 或写清单外的编号（会被剥除）。\n【附件入库】用户要求把附件图存入角色库/场景库并命名时（如「将此图加入角色库，名称为李宁」「加入场景库名为足球场」），输出入库操作：{"op":"library","libraryKind":"person"或"scene","name":"用户指定的名称原文","sourceRef":"{{ref1}}"}——person=人物角色、scene=场景；入库成功后用户即可在后续对话用 @名称 引用；同时不必再为它创建画布节点（除非用户另有要求）。` : ""}注意：除上述占位符机制外，你无法把二进制图片直接写进节点；据图写提示词、参数与节点结构（如据参考图写 promptText/appearance）仍是主要方式。`
        : "";

      // #211 模型技能注入（默认关 = 空串 = 提示词逐字不变）：开关开启且非 comfyOnly
      // （comfyOnly 无云端模型清单，技能无处挂靠）时，取锁定图/视频模型的技能文本。
      // 段落插在「云端生成模型清单」之后、「# 当前画布」之前——与 #141 按需注入同区，
      // # 输出要求 保持在提示词末尾（prompt caching 复盘的 wire-format 红线）。
      const modelSkillSection = input.useModelSkills && !input.comfyOnly
        ? await buildAgentModelSkillSection([input.pinnedImageModel, input.pinnedVideoModel])
        : "";

      // #258 ⑦ 答疑段按需注入：开关关（默认）永远保留（提示词逐字一致）；开了且本轮是
      // 明确生产指令才省略（省 ~600 字）。整段有/无与 #140/#141 同机制，不挪动任何段落。
      const guideRuleText = includeGuideRule(input.leanPrompt, input.message)
        ? `- 应用操作答疑（#112：用户问「怎么用 / 在哪里 / 有没有某功能」时按此作答，禁止编造不存在的入口）：快捷键 Alt+Q=创意模式「极简显示」（所有节点只留预览框，再按恢复）、Alt+W=「速览」（临时展开全部参考图/提示词窗）、A=选中节点展开高级参数、F=缩放到选中、Tab=新建节点、Ctrl+Enter=生成、Ctrl+K=搜索节点、?=快捷键面板；任何有视频结果的节点操作条有「快剪」（底部时间轴截取，I/O 出入点、Enter 确认）与「对比」；智能剪辑节点有「检测场景切点」（ffmpeg 视觉切点吸附剪辑边界）；叠加节点支持水印/画中画九宫格位置与实时预览；姿势控制节点与角色节点可打开「姿势库」（导演台 22 款 3D 摆姿截图作参考；画布上有分镜节点时，弹窗底部「应用到分镜」行可把截图直接写入所选分镜的参考图）；导演台含多机位系统、真 3D 灯光（8 款布光预设 + 可保存「我的布光」）、相机截图库、全景背景与场景模板；底部工具栏有风格库/运镜库/角色库；「更多 → 操作指南 / 新手导览」可回看引导；/tutorial 页有图文详细教程（各章「亲手试一试」可深链回画布导览）。双击节点空白或图片/视频预览=聚焦放大居中、再次双击=还原视口（双击标题=改名）；图像节点预览的「放大」按钮在右上角（悬停浮现），3D 换视角/真3D 在选中节点的上浮工具条；「整理布局」连点循环四种排法（流向分层/紧凑网格/横向一排/垂直一列）；群组工具条有 横向/垂直/宫格 组内排列；极简显示的多产物平铺可在网格右上角「收起/展开」；快剪条含 变速(0.5~2×)/静音/截取当前帧（帧图自动入素材库）。纯答疑时 operations 给空数组；但若用户是让你【执行】切极简/整理布局/适应视图/批量下载，请直接输出对应 canvas 操作而不是只口头指路。\n`
        : "";
      const system = `你是「AI 视频画布」的智能体副驾（Copilot）。用户用自然语言描述想做的视频，你负责把它拆解为画布上的节点工作流。

# 可用节点目录（只能使用下面列出的节点类型与字段，禁止编造任何不存在的节点或字段）
${catalogText({ comfyOnly: input.comfyOnly, allowSuperAgent })}${templateSection}${comfyResourceSection}${comfyExperienceSection}${planPitfallSection}${superAgentHint}${comfyConstraint}${input.comfyOnly ? "" : `\n\n# 云端生成模型清单（与节点选择器同源；模型 id 与 params 键/取值【严格】从此清单取，清单外一律视为编造）\n${modelKnowledgeText({ pinnedImageModel: input.pinnedImageModel, pinnedVideoModel: input.pinnedVideoModel, compact: editMode || undefined })}`}${modelSkillSection}${input.interactive ? `

# 交互式规划模式（用户已开启「交互式规划」开关）
- 复杂编排不要一次性出完整方案：先分步与用户确认关键决策。每轮 reply 只聚焦【一个决策点】，给出 2-4 个编号选项（每个选项独立一行、以「1. 」「2. 」开头，推荐项在行尾加「（推荐）」），reply 最后一行固定提示：「回复序号选择，也可以直接说出你的想法；说『开始落地』即按当前共识生成节点。」
- 在用户明确表示「开始落地 / 执行 / 就这样做」或所有关键决策都已确认之前，operations 必须是空数组 []——绝不提前创建任何节点。
- 建议决策顺序（用户已明确的直接跳过）：① 内容与结构（叙事线/分几幕/风格基调）→ ② 规模与规格（镜头数、每镜时长、画幅、生图/生视频模型）→ ③ 角色与场景设定 → ④ 汇总已确认共识并请用户确认落地。
- 用户任意时刻说「不用问了 / 直接做」→ 立即按已确认信息 + 合理默认值输出完整 operations。
- 每轮 reply 开头用一句话累积复述已确认的共识（如「已定：竖屏 9:16 · 6 镜 · 悬疑风」），用户不回翻也能看到进展。
- 简单请求（改单个字段、加一个节点、纯问答）不必分步——直接给 operations 或直接回答。` : ""}

# 当前画布
${ctxBudget.graphSummary || "（空画布）"}${input.selectedNodeIds?.length ? `\n\n# 用户已框选节点（本轮硬约束）\n用户框选了 ${input.selectedNodeIds.length} 个节点：${input.selectedNodeIds.slice(0, 60).join("、")}。本轮的 update/delete 只允许作用于这些节点（或本轮新建节点的 tempId）——框选外的既有节点一律不要修改、不要删除（系统会直接拒绝这类操作）。除非用户明确要求新增内容，否则不要 create 新节点。` : ""}${characterSection}${input.prefs?.trim() ? `\n\n# 用户偏好/约束（必须遵守）\n${input.prefs.trim()}` : ""}${input.persona?.trim() ? `\n\n# 创作风格 / 人设（最高优先级：按此风格与视角构思画面、文案、镜头语言；但绝不能因此破坏下面的 JSON 输出格式）\n${input.persona.trim()}` : ""}${attachmentHint}

# 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构如下：
{
  "reply": "给用户的简短中文说明（你打算怎么做 / 或直接回答）",
  "operations": [
    { "op": "create", "tempId": "n1", "nodeType": "prompt", "title": "可选标题", "payload": { "positivePrompt": "..." }, "note": "为什么这么做" },
    { "op": "connect", "sourceRef": "n1", "targetRef": "n2", "note": "..." },
    { "op": "update", "targetRef": "已存在节点的id", "payload": { } },
    { "op": "delete", "targetRef": "节点id" },
    { "op": "canvas", "action": "minimal_on|minimal_off|arrange_layout|fit_view|download_all|assemble|run_all|run_node", "targetRef": "可选：assemble 的合并节点id / run_node 的目标节点id", "note": "画布级动作" },
    { "op": "group", "targetRefs": ["节点id或tempId", "..."], "title": "可选组名", "note": "把多个节点编成群组" },
    { "op": "duplicate", "targetRef": "要复制的节点id", "tempId": "副本引用名(可选)", "note": "复制节点" }
  ]
}

规则：
- 新建节点用 "create" 并赋唯一 tempId；之后的 "connect" 用 tempId 或画布中已存在的节点 id 互相连接（sourceRef→targetRef）。
- 每个节点的 payload 只能使用目录中该节点类型列出的字段名。
- 按创作链路合理编排：脚本/分镜 → 提示词/图像/视频 → 合并/字幕/配乐。
- 模板智能匹配：选用 comfyui_workflow 模板时，按需求匹配 outputType（生图选 image、生视频选 video），并参考 capabilities 标签挑最贴合的模板；视频优先 hasVideoOutput 的模板。
- 时长感知拆镜（重要）：视频模板/模型每镜有最长时长（上面括号里的「每镜≈Ns」就是单个镜头能生成的秒数上限）。当用户的目标总时长 T 大于所选模板的每镜上限 d 时，绝不能只做几个镜头，必须按 镜头数 = ceil(T / d) 规划足够多的镜头，使 镜头数 × d ≈ T（例：目标 60s、每镜 5s → 需 12 个镜头）。把这些镜头组织成若干「场景」（叙事段落），每个场景包含一个或多个镜头。
- 场景分组：为每个生成节点加 sceneGroup 字段标注它属于哪个场景（如 "s1"/"s2"…，同一场景的镜头用同一个值），画布会据此把同场景的镜头框进一个「场景」分组容器。所有镜头仍各自连入 merge 合并成片。
- 角色一致性：当故事有反复出现的人物/主角时，为每个主要角色创建一个 character 节点（填 name/role/appearance/outfit/signature），并把该 character 连接到它出现的每一个分镜/生成节点（character → storyboard/comfyui_image/image_gen/video_task）。这样跨镜的脸/服装/特征会保持一致（连到 ComfyUI 图像节点会自动用作 IPAdapter 人脸参考）。同一角色只建一个节点、复用连接到多个镜头，不要每镜各建一个。【外观描述单一来源】角色的外观（长相/发型/服装/体貌）只写在 character 节点的 appearance/outfit/signature 字段里——各镜头提示词（promptText/prompt）中【用角色名指代该角色，不要再逐镜重写外观描述】：生成时系统会把角色节点的外观以「[角色N：…]」前缀确定性注入每个连线镜头的提示词，逐镜重写会与注入内容冲突、且措辞漂移正是跨镜长相不一致的主因；镜头提示词只写该镜的动作/表情/构图/镜头语言。若主角需要跨镜强一致但没有参考图，请在 reply 里建议用户先为该角色生成一张定妆照并右键「存为角色主体」，后续镜头将以此图锁脸。
- 单帧构图（重要，防宫格图）：每个分镜/图像提示词（promptText / image_gen.prompt / prompt 节点）都只描述【一个镜头的单幅画面】，措辞必须是单帧视角；严禁出现会诱导模型输出宫格/拼贴的词（如 分镜表/故事板/四宫格/九宫格/多画面/连环画/storyboard/grid/collage/multi-panel/comic strip）。同时在 negativePrompt 里加上 "multi-panel, grid, collage, storyboard, comic strip, split screen" 兜底——下游图生视频节点无法处理宫格参考图，一张图必须只含一个画面。
- 视频提示词写作规范（重要，video_task / comfyui_video 的 promptText/prompt）：视频提示词描述的是一段【随时间演进的动态】，严禁只写一句静态画面了事。每条视频提示词必须写全五要素：①主体与开场画面（谁/什么、在哪、以什么状态开场）；②动作演进（这 N 秒里主体做什么、如何变化，按时间顺序写；时长 ≥8s 的镜头用时间节拍分段，如「0-3s …；3-6s …」）；③镜头语言（景别 + 明确的运镜动词：推近/拉远/横摇/跟随/环绕/升降/手持晃动/固定机位 等，写清摄影机怎么动）；④场景氛围与光影（时段、天气、色调、光源方向）；⑤风格质感（电影感/写实/胶片/动画等，全片统一）。详细度不得低于同镜头的图像提示词（一般 3-5 句）；动作量必须与镜头时长匹配——短镜头聚焦一个连贯动作，长镜头才铺多段动作，避免 5 秒镜头塞三个场景变化。
${input.dialogueLang?.trim() ? `- 【强制·对白语种，最高优先级】所有人声文本——storyboard.dialogue、台词、旁白、口播、字幕文案——一律用${input.dialogueLang.trim()}书写，即使用户消息、历史对话或参考内容是其它语言。**特别重要·生视频节点（video_task / comfyui_video）**：这类模型（如 Grok Imagine / 可发声的视频模型）会把提示词里的台词/对白【直接念出来】，语言跟着提示词走——所以凡是「会被角色说出/念出来的文字」（台词、对白、旁白、口播、需上屏的字幕）在视频提示词（promptText / prompt）里也【必须用${input.dialogueLang.trim()}书写】，并且要把该镜头的完整对白【原样、完整地】写进对应视频节点的提示词（不要只写画面、把台词漏掉或缩水——否则视频没词可念，或按英文提示词念出错误语言的配音，正是「设了${input.dialogueLang.trim()}却出英文」的根因）。仅【纯画面视觉描述】（镜头/景别、光影、构图、动作、场景、风格、negativePrompt）的语言不受此限制。输出前逐条自查：每个 dialogue 字段、以及每个含台词的视频提示词，发现非${input.dialogueLang.trim()}的人声内容或漏掉对白的视频节点，必须补全并改写后再输出。\n` : ""}- 镜头表完备（重要）：创建 storyboard 时必须【同时】给 description（中文画面描述，给人看）和 promptText（详细生成提示词，直接喂生图/生视频模型，禁止留空、也不要把提示词堆进 description）；必须给连续镜号 sceneNumber（1,2,3…，装配成片按它排序）；有人声内容（台词/旁白/口播/解说）的镜头填 dialogue（多人对话每行一句「角色名：台词」，纯旁白直接写文本）；按叙事节奏给 transition（常规切换 cut、时间/地点跳跃 dissolve、开场收尾 fade、强调匹配 match-cut）；尽量补 duration/shotType。这些字段会被镜头表批量生产与装配直接消费，缺了用户就要手工补。
- 分镜→成片管线：每镜建一个 video_task（或 ComfyUI 视频）工位并连入 merge——后续「镜头表面板」的批量生图/生视频会复用这些工位；逐镜配音【不要】建 audio 节点（批量配音按 dialogue 自动生成），只有整体配乐才建一个 audio(music) 连入 merge。视频出片后用户在合并节点点「按镜头表装配」即可自动完成镜号排序、逐镜转场与配音对位——请在 reply 末尾用一句话提醒该操作路径。
- 运行与计费规则（回答预算/执行类问题时按此为准，勿凭猜测）：①「运行全部」会把每个可运行节点当生成工位执行，分镜也会兜底生关键帧图——但分镜若已连了下游 image_gen 出图工位、或设了 skipAutoImage=true，系统会自动跳过分镜生图（不出图、不计费），标准的 分镜→image_gen→video_task 管线不存在重复计费；②运行确认弹窗的估价按同一口径：被自动跳过的分镜与设了 disabled 的节点都不计价；未设模型的其它生成节点按平台默认模型估价；③分镜设了 imageModel 后，只有在「镜头表面板」手动点『批量生关键帧图』才会用分镜自己再生一遍图（与 image_gen 工位重复），运行全部不会；④kie 平台按任务计费——如 Grok Imagine 一次固定返回约 6 张候选图仍只算一次的钱，张数无参数可控；⑤任何节点可由用户右键「跳过执行」（payload.disabled=true，你也可以 update 设置/解除），运行与估价都会整体跳过它。
- 规划摘要：当涉及视频时长拆分时，在返回 JSON 顶层additionally给出 plan 对象：{"targetSeconds":目标总秒数,"perShotSeconds":每镜秒数,"templateLabel":"所选模板名","shots":镜头总数}，供前端做时长校验与提示。
- 运行自愈（精准修复）：画布摘要里 status=failed 的节点会带 error 字段（失败原因），修复必须针对 error 文本的根因，禁止与根因无关的乱改。原则：最小化操作——优先 update 单个缺失/错误字段或补一条 connect，绝不删除重建节点（会丢用户已生成的结果与连线）。常见错误对照：提示词为空/缺参 → update 补该字段；缺上游输入 → connect 补连线；引用的模板/模型不存在 → update 换成目录或模板知识里真实存在的；「未配置 ComfyUI 服务器地址」→ 若摘要中其他节点有 customBaseUrl 可复用则 update 补上，否则属于环境问题；环境/外部问题（服务器离线、余额不足、网络错误、密钥未配置等）→ 无法用画布操作修复，不要动参数，在 reply 中说明原因与用户需要手动做的步骤。每项修复在 reply 里一句话交代「哪个节点、什么原因、改了什么」；确实无法修复的明确说修不了，不要假装修好。
- 增量编辑（修改现有画布时，重要）：优先对已有节点发 update，禁止删除重建或另建重复链路；update 的 payload 只放确实要改的字段，绝不回写没改的字段——画布摘要里的长文本以「…」截断，原样抄回会损坏用户原文；需要"基于原文改写"时必须输出完整的新文本，不能以截断值凑数；批量修改（如"所有镜头加雨天氛围"）对每个目标节点各发一个 update。
- 成片参与范围（#134，用户说「只用镜头 1-6 成片」「把第 3 镜排除/禁用」「恢复所有节点参与」这类指令时按此执行）：节点的 payload.disabled=true 是「参与工作」总开关——运行全部、估价、按镜头表装配三条链路都会跳过它。做法：对要排除的节点各发一个 update {"disabled":true}（恢复=false）；「只用镜头 N-M」= 把范围外的分镜节点设 disabled:true（其专属下游工位的段会随分镜一起被装配跳过，无需逐个禁用工位）；操作后在 reply 用一句话说明当前参与范围（如「已排除镜头 7-12，成片只含镜头 1-6」）。禁止用删除节点实现排除。
- 画布级动作（#112）：用户让你「切到/退出极简显示、整理布局、看全图/适应视图、把所有成品都下载下来」这类针对整张画布的操作时，输出 "canvas" 操作（action 取 minimal_on / minimal_off / arrange_layout / fit_view / download_all / assemble / run_all / run_node 之一）；可与节点操作混用（如先建节点再 arrange_layout）。极简显示仅创意模式可用；download_all 会把画布上所有已生成的图片/视频各下载一份。#266 新增三个动作的使用规则：assemble=按镜头表装配合并节点（用户说「装配成片/按镜头表拼起来/把视频拼成片」时用；targetRef 填合并节点 id，画布只有一个合并节点时可省略；上游视频未出片时装配会失败，reply 里要提醒）；run_all=运行全部（targetRef 省略）、run_node=运行单个节点（targetRef 必填目标节点 id）——【仅当用户明确说「运行/开始生成/跑起来」这类指令时才输出 run_all/run_node，规划搭建类请求绝不能附带运行动作】；运行会进入画布的费用确认流程，由用户最终确认，reply 里说明「已发起运行请求，请在画布确认」。
- 编组与复制（#267）：用户说「把这些节点编个组/归到一起」时输出 "group"（targetRefs 填 ≥2 个节点 id，可混用本批新建节点的 tempId；title 填组名如「场景1」）；用户说「复制某节点/把镜1复制一份当镜3的底子」时输出 "duplicate"（targetRef 填源节点 id；若后续操作要引用副本，给 tempId 并用它 connect/update——副本会自动剥离原节点的生成结果与任务状态，绝不会复制出「已完成」的假状态）。两者都是本地画布操作、不花钱、可撤销；除非用户明确要求，不要主动编组或复制。
- 若用户只是提问、或当前无需改动画布，operations 给空数组 []，把回答写进 reply。
- 工具/技能（若可用）：如果运行环境提供了技能（Skill）或 MCP 工具，你可以在构思阶段调用它们来提升规划质量（如查资料、按某技能的方法论组织镜头/文案）；但最终回复仍必须只输出上面规定的 JSON（reply+operations），绝不能把工具的中间输出、日志或非 JSON 内容混进最终回复。
- 规划可解释：reply 开头用 1-2 句讲清方案结构与关键选择（如「60s÷5s/镜=12 镜、3 个场景，图像用模板 X、视频用模板 Y——因为它支持首帧引导」）；每个 create/update/delete 操作都填 note（≤20 字的理由，如「开场全景定调」「补缺失的提示词」），connect 的 note 可省略。用户要能不点开任何节点就看懂这个计划做什么、为什么。
${guideRuleText}- 你只负责把工作流搭好并填好参数；是否触发生成由用户在画布上确认。${selfCheckRule(input.selfCheck)}`;

      const userContent: MessageContent[] | string = attachments.length
        ? [
            { type: "text", text: input.message },
            ...imageAtts.map((a) => ({ type: "image_url" as const, image_url: { url: a.url } })),
            ...docAtts.map((a) => ({ type: "file_url" as const, file_url: { url: a.url } })),
          ]
        : input.message;
      const messages: Message[] = [
        { role: "system", content: system },
        ...ctxBudget.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userContent },
      ];

      // A full multi-shot plan (script + N storyboards + connects + merge) is a
      // large JSON object. 4000 tokens truncated it → JSON.parse failed → the raw
      // (truncated) JSON leaked into the chat as "乱码". Give it plenty of room
      // (capped per-model by resolveMaxTokens; 超长输入时由 adaptToLongInput 压到 6000
      // 以缩短单次生成耗时). NB: we deliberately do NOT force
      // response_format json_object — the default model is Claude (proxied), where
      // the OpenAI-style flag isn't reliably supported; the robust parse below
      // handles fences/prose instead.
      // 单次规划尝试：调 LLM → 抽取文本 → 括号配平取 JSON → 逐条 sanitize（收集被拒原因）。
      // 抽成闭包，好让「自愈」时用不同 messages 再跑一遍，而不重复上面的上下文拼装。
      // 注意：imageFirst 强制与截断兜底移到闭包外，只作用于最终选定的那次结果（避免修复后被覆盖）。
      const attemptPlan = async (msgs: Message[]) => {
        const response = await invokeLLMWithKie(ctx, { messages: msgs, model, maxTokens: ctxBudget.maxTokens });
        const text = extractTextContent(response);
        // Strip an accidental ```json fence (belt-and-suspenders; json_object mode
        // shouldn't add one) before matching the outermost { … } object.
        const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
        // 括号配平抽取所有顶层对象，优先取含 "operations" 的那个（技能/散文里的 { 不会污染），
        // 再退而取含 "reply" 的、最后取最末一个完整对象。替代原贪婪 /\{[\s\S]*\}/。
        const candidates = extractJsonObjects(cleaned);
        const jsonStr = candidates.find((c) => /"operations"\s*:/.test(c))
          ?? candidates.find((c) => /"reply"\s*:/.test(c))
          ?? candidates[candidates.length - 1];
        let reply = text.trim();
        const operations: AgentOperation[] = [];
        const dropped: string[] = []; // reasons for ops the LLM proposed but we discarded
        let plan: { targetSeconds: number; perShotSeconds: number; templateLabel?: string; shots: number } | undefined;
        let parsedOk = false;
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr) as { reply?: unknown; operations?: unknown; plan?: unknown };
            parsedOk = true;
            reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "已规划完成。";
            if (Array.isArray(parsed.operations)) {
              // A3 增量规划：框选时构造允许目标集 = 选中节点 ∪ 本轮 create 的 tempId
              // （先整体预扫 tempId，避免依赖 create 在数组中的先后顺序）。未框选=不启用。
              let allowedTargetIds: Set<string> | undefined;
              if (input.selectedNodeIds?.length) {
                allowedTargetIds = new Set(input.selectedNodeIds);
                for (const o of parsed.operations) {
                  const t = (o as Record<string, unknown> | null)?.tempId;
                  if (typeof t === "string" && t) allowedTargetIds.add(t);
                }
              }
              // Sanitize each op, collecting *why* any were dropped so the user isn't
              // left wondering where a hallucinated/invalid step went.
              for (const o of parsed.operations) {
                const r = sanitizeOperationDetailed(o, { comfyOnly: input.comfyOnly, validTemplateIds, allowSuperAgent, allowedTargetIds });
                if ("op" in r) operations.push(r.op);
                else dropped.push(r.drop);
              }
            }
            // Optional planning summary (duration-aware shot split) for the client's
            // capacity dialog. Only accept well-formed numeric fields.
            const p = parsed.plan as Record<string, unknown> | undefined;
            if (p && typeof p.targetSeconds === "number" && typeof p.perShotSeconds === "number" && typeof p.shots === "number") {
              plan = {
                targetSeconds: p.targetSeconds,
                perShotSeconds: p.perShotSeconds,
                shots: p.shots,
                templateLabel: typeof p.templateLabel === "string" ? p.templateLabel : undefined,
              };
            }
          } catch {
            /* malformed/truncated JSON — handled by caller */
          }
        }
        return { text, cleaned, reply, operations, plan, parsedOk, dropped };
      };

      onStage?.("模型规划中");
      let res = await attemptPlan(messages);
      let repaired = false; // 自愈是否实际生效（供前端透明反馈「已自动修正规划」）
      // 自愈回环（#更智能）：仅在「原本就要放弃/给不出有用结果」的失败路径触发一次修复重试——
      // 把上一轮输出与失败原因回喂给模型让它自己改正（截断/非法 JSON，或所有操作都被目录校验拒绝）。
      // 成功规划路径一律不触发，故不拖慢正常请求；最多重试 1 次，不成环。修复调用本身失败则保留首轮结果。
      if (shouldRepairPlan(res)) {
        onStage?.("规划自检修复中");
        try {
          const repairMsgs: Message[] = [
            ...messages,
            { role: "assistant", content: res.text.slice(0, 4000) },
            { role: "user", content: buildRepairInstruction(res.parsedOk, res.dropped) },
          ];
          const retry = await attemptPlan(repairMsgs);
          // 只在修复确实更优时采用：修复后能解析，且（原本没解析成功，或修复拿到了非空操作）。
          if (retry.parsedOk && (!res.parsedOk || retry.operations.length > 0)) { res = retry; repaired = true; }
        } catch { /* 修复调用失败：保留首轮结果，走下方兜底 */ }
      }

      onStage?.("整理规划结果");
      let reply = res.reply;
      let operations = res.operations;
      const plan = res.plan;
      const dropped = res.dropped;

      // 生图→生视频：确定性强制——即使 LLM 没照做也保证生效（作用于最终选定的 operations）。
      // 非 ComfyUI：插 image_gen（文本→image_gen→视频）。
      // 仅 ComfyUI：插出图 comfyui_workflow（prompt→出图→图生视频），用识别到的出图/视频模板。
      if (input.imageFirst && res.parsedOk) {
        if (input.comfyOnly && chosenImg && chosenVid) {
          operations = enforceImageFirstComfy(operations, new Set(imageTpls.map((t) => t.id)), new Set(videoTpls.map((t) => t.id)), chosenImg.id);
        } else if (!input.comfyOnly) {
          operations = enforceImageFirst(operations);
        }
      }
      // Graceful fallback: never dump a raw/truncated JSON blob into the chat.
      // If the model clearly attempted a plan (has "operations") but it didn't
      // parse, it was almost certainly truncated → ask the user to retry smaller.
      // Otherwise the model answered in plain prose (a question/explanation) → keep it.
      if (!res.parsedOk) {
        if (/"operations"\s*:/.test(res.cleaned) || /^\s*[`{]/.test(res.text)) {
          reply = "规划结果过长，未能完整返回（可能被截断）。请重试，或减少镜头数 / 缩短目标时长后再试。";
          operations = [];
        } else {
          reply = res.text.trim();
        }
      }
      // Dedupe + cap the drop reasons (same reason often repeats across many ops).
      // ── Higgsfield MCP 产物落地（本机 Claude 挂 MCP 时回复里常带其外链，约 24h 过期）：
      // ① 转存自有存储 + 记入素材库；② 操作里的外链替换为自有 URL；③ 回复文本过滤裸链
      // （其余域名的 URL 一律不动）；④ 操作里没引用的产物自动补 asset 节点落画布。
      // 转存失败的链接原样保留（用户至少还能点）。
      try {
        const inOps = extractHiggsfieldUrls(JSON.stringify(operations));
        const inReply = extractHiggsfieldUrls(reply);
        // 单轮上限 6 个防滥用；按长度【降序】替换：split/join 是全子串替换，若 URL-A 是 URL-B
        // 的前缀（如 x.png 与 x.png?w=512），先替 A 会把 B 里的 A 段一并换掉、B 被腐蚀成坏链且其
        // 转存 URL 永不写回。先替长的 B、再替短的 A（此时 B 已整体换成我方存储 URL、不含 A）即可根治。
        const allUrls = Array.from(new Set([...inOps, ...inReply])).slice(0, 6).sort((a, b) => b.length - a.length);
        if (allUrls.length > 0) {
          let assetIdx = 0;
          for (const oldUrl of allUrls) {
            const r = await rehostMcpAsset(ctx.user.id, input.projectId, oldUrl);
            if (!r) continue;
            if (inOps.includes(oldUrl)) {
              operations = JSON.parse(JSON.stringify(operations).split(oldUrl).join(r.url)) as AgentOperation[];
            } else {
              // 优先把结果图挂到本轮新建且还没有图的图像节点上（模型常建「图像节点记录
              // 提示词」但不带图——真机截图实锤「图片节点无图像」）；没有合适节点再补 asset 节点。
              const ops = operations as Array<{ op?: string; nodeType?: string; payload?: Record<string, unknown> }>;
              const target = r.type === "image"
                ? ops.find((o) => o?.op === "create" && (o.nodeType === "image_gen" || o.nodeType === "comfyui_image") && !(o.payload as { imageUrl?: string } | undefined)?.imageUrl)
                : undefined;
              if (target) target.payload = { ...(target.payload ?? {}), imageUrl: r.url };
              else operations.push({ op: "create", tempId: `mcp_asset_${++assetIdx}`, nodeType: "asset", payload: { url: r.url, name: r.name, type: r.type } } as unknown as AgentOperation);
            }
            reply = reply.split(oldUrl).join(`〔${r.type === "video" ? "视频" : r.type === "image" ? "图片" : "文件"}已转存到素材库并放入画布〕`);
          }
        }
      } catch { /* 落地失败不影响正常回复 */ }

      // 服务器自动分配（#170）：画布助手一次建多个 super_agent 时，把全局服务器列表轮询分配到各节点
      // 的 customBaseUrl（未显式指定者），避免全挤第一台。有权限且确有 super_agent 节点时才拉列表。
      if (allowSuperAgent && operations.some((o) => (o as { op?: string; nodeType?: string }).op === "create" && (o as { nodeType?: string }).nodeType === "super_agent")) {
        try {
          const servers = await db.getComfyGlobalServers();
          if (servers.length > 1) assignServersRoundRobin(operations as unknown as { op?: string; nodeType?: string; payload?: Record<string, unknown> }[], servers);
        } catch { /* 拉列表失败不影响规划；运行时仍会回退全局默认 */ }
      }

      const droppedReasons = Array.from(new Set(dropped)).slice(0, 6);
      // A4 失败经验自动入库：本轮（含自愈重试后）仍有操作被目录校验拒绝 → 拒因沉淀为
      // 「规划坑」，下轮相似任务经 loadPlanPitfallSection 注入规避。fire-and-forget，
      // 按拒因签名去重 + 容量上限，权限类拒因在 filterPlanPitfallReasons 里剔除不入全局。
      if (dropped.length) void recordPlanPitfall(input.message, Array.from(new Set(dropped))).catch(() => undefined);
      // #259 规划质量打点（仅完整规划主路径；fastChat 短路/comfyOnly 拒绝等提前 return 不打点）：
      // 落操作日志 action=agent_plan_quality，管理后台「规划质量」视图按开关组合聚合展示
      // 拒因率/自愈率/平均操作数——数据化评估 leanPrompt/selfCheck 等开关的真实效果。
      writeAuditLog({
        ctx,
        action: "agent_plan_quality",
        detail: {
          model,
          ops: operations.length,
          droppedCount: dropped.length,
          repaired,
          parsedOk: res.parsedOk,
          durationMs: Date.now() - planStartedAt,
          leanPrompt: !!input.leanPrompt,
          selfCheck: !!input.selfCheck,
          interactive: !!input.interactive,
          comfyOnly: !!input.comfyOnly,
          pinnedVideo: input.pinnedVideoModel || undefined,
          pinnedImage: input.pinnedImageModel || undefined,
        },
      });
      return { reply, operations, plan, dropped: droppedReasons, droppedCount: dropped.length, repaired };
}

export const agentRouter = router({
  chat: protectedProcedure
    .input(agentChatInput)
    .mutation(async ({ ctx, input }) => runAgentChat(ctx, input)),

  // 提交后台规划任务：立即返回 jobId，客户端轮询 chatStatus 取结果——轮询是短请求，
  // 断连/隧道掐线/服务端慢都不会丢「等待中」的状态（服务重启会丢任务→missing，客户端明确提示）。
  submitChat: protectedProcedure
    .input(agentChatInput)
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor"); // 快速失败；runAgentChat 内还会再校验
      sweepAgentChatJobs();
      const jobId = `acj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const job: AgentChatJob = { userId: ctx.user.id, createdAt: Date.now(), done: false };
      agentChatJobs.set(jobId, job);
      // #251：登记项目级 pending——用户中途退出画布也能重进后凭 projectId 找回本任务续跑。
      pendingJobByProject.set(input.projectId, { jobId, userId: ctx.user.id, prompt: (input.message ?? "").slice(0, 300) });
      // #252 落库兜底：内存 Map 服务重启即丢，DB 行让「已完成的结果」重启后仍可取回。
      // 写失败不阻断主流程（dev 无 DB 时 helper 本身就是 no-op）。
      void db.insertAgentChatJobRow({ jobId, projectId: input.projectId, userId: ctx.user.id, prompt: (input.message ?? "").slice(0, 300) }).catch(() => {});
      void runAgentChat(ctx, input, (s) => { job.stage = s; })
        .then((r) => {
          job.result = r; job.done = true;
          void db.finishAgentChatJobRow(jobId, { result: r }).catch(() => {});
        })
        .catch((e) => {
          job.error = e instanceof Error ? e.message : String(e); job.done = true;
          void db.finishAgentChatJobRow(jobId, { error: job.error }).catch(() => {});
        });
      return { jobId };
    }),

  // #251 跨进出画布续跑：查本项目是否有「进行中/已完成未取走」的规划任务（仅提交者本人可见
  // ——恢复即会把结果应用到画布并计入其历史，不能替别人续）。job 已被取走/过期则顺带清登记。
  pendingChat: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const p = pendingJobByProject.get(input.projectId);
      if (!p || p.userId !== ctx.user.id) {
        // #252 内存登记随重启丢失 → 查持久层最近一行：done 的结果重启后仍可恢复应用；
        // running 行=任务已随重启中断，也返回给前端（chatStatus 会给出明确的中断报错）。
        const row = await db.getLatestAgentChatJobForProject(input.projectId, ctx.user.id).catch(() => undefined);
        if (!row) return { job: null };
        return { job: { jobId: row.jobId, prompt: row.prompt ?? "", running: row.status === "running" } };
      }
      const j = agentChatJobs.get(p.jobId);
      if (!j) { pendingJobByProject.delete(input.projectId); return { job: null }; }
      return { job: { jobId: p.jobId, prompt: p.prompt, running: !j.done } };
    }),

  // 轮询任务状态；done 后取走即删（结果一次性消费，客户端拿到后自行持久化到会话）。
  chatStatus: protectedProcedure
    .input(z.object({ jobId: z.string().max(64) }))
    .query(async ({ ctx, input }) => {
      sweepAgentChatJobs(); // 轮询频繁，顺带清理过期任务（不只依赖 submit 时清扫）
      const j = agentChatJobs.get(input.jobId);
      if (!j || j.userId !== ctx.user.id) {
        // #252 内存 miss → 查持久层：服务重启后「已完成的结果」仍能取回；
        // 行状态仍是 running 说明任务随重启中断（后台 promise 已死），明确报错别让客户端干等。
        const row = await db.getAgentChatJobRow(input.jobId).catch(() => undefined);
        if (!row || row.userId !== ctx.user.id) return { state: "missing" as const };
        void db.deleteAgentChatJobRow(input.jobId).catch(() => {}); // 一次性消费，取走即删
        clearPendingByJobId(input.jobId);
        if (row.status === "done" && row.result) {
          return { state: "done" as const, result: row.result as Awaited<ReturnType<typeof runAgentChat>> };
        }
        if (row.status === "error") return { state: "error" as const, error: row.error || "规划失败" };
        return { state: "error" as const, error: "服务重启导致本次规划中断，请重新发送" };
      }
      // #136 running 时带上阶段与耗时，前端等待行显示「模型规划中 · 已 Ns」而非干等。
      if (!j.done) return { state: "running" as const, stage: j.stage, elapsedMs: Date.now() - j.createdAt };
      agentChatJobs.delete(input.jobId);
      clearPendingByJobId(input.jobId); // #251 结果被取走 → 项目级 pending 登记同步清除
      void db.deleteAgentChatJobRow(input.jobId).catch(() => {}); // #252 持久层行同步删除
      return j.error
        ? { state: "error" as const, error: j.error }
        : { state: "done" as const, result: j.result };
    }),

  // Generate per-shot descriptions for a 成片配方 from a topic, so the recipe's
  // shots get topic-specific content instead of fixed placeholder beats. Returns
  // a plain string[]; the client builds the node chain deterministically.
  recipeShots: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        recipeName: z.string().min(1).max(100),
        topic: z.string().max(2000).optional(),
        shots: z.number().int().min(1).max(20),
        style: z.string().max(200).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      if (!isCustomLLMModel(input.model)) await assertLLMAllowed(ctx, input.model);
      const model = input.model ?? FACTORY_DEFAULT_MODELS.llm;
      const system = `你是短视频分镜编剧。根据给定的视频类型与主题，输出恰好 ${input.shots} 个镜头的中文画面描述。要求：每条 15-40 字，具体可拍（画面主体 / 动作 / 环境 / 镜头语言），按叙事顺序连贯推进，不要编号前缀。严格只输出一个 JSON 字符串数组，例如 ["镜头1描述","镜头2描述"]，不要 markdown、不要任何多余文字。`;
      const user = `视频类型：${input.recipeName}\n主题：${input.topic?.trim() || "（未指定，请自拟一个吸引人的主题）"}${input.style?.trim() ? `\n风格：${input.style.trim()}` : ""}\n镜头数：${input.shots}`;
      const response = await invokeLLMWithKie(ctx, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        model, maxTokens: 1500,
      });
      const text = extractTextContent(response);
      let shots: string[] = [];
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const arr = JSON.parse(m[0]) as unknown;
          if (Array.isArray(arr)) shots = arr.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
        } catch { /* fall through — empty shots → client uses default beats */ }
      }
      return { shots };
    }),

  // ── 画布助手对话持久化（项目级共享——全体协作者同一份历史）──
  // 读：viewer 权限即可。db 层用 userId=0 共享行；无共享行时回退请求者的旧个人行（平滑迁移）。
  getHistory: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      return { turns: await db.getCanvasAgentSession(input.projectId, ctx.user.id) };
    }),

  // 写：整段覆盖（含「新对话/清空」= 传空数组）。editor 权限。turns 结构校验从宽（客户端拥有
  // applied/createdIds/undone 等应用后状态），只强约束 role/content 与体量上限。
  saveHistory: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      turns: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20000),
        applied: z.string().max(4000).optional(),
        failed: z.string().max(4000).optional(),
        error: z.boolean().optional(),
        createdIds: z.array(z.string().max(64)).max(200).optional(),
        undone: z.boolean().optional(),
      })).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await db.setCanvasAgentSession(input.projectId, ctx.user.id, input.turns);
      // 通知同项目其他协作者重载共享对话（客户端收到后走 getHistory 权威重载）。
      broadcastAgentHistoryUpdated(input.projectId, ctx.user.id);
      return { success: true };
    }),
});
