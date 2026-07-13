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
import { enforceImageFirst, enforceImageFirstComfy } from "../_core/imageFirst";
import { runLibraryAnalysis } from "../_core/templateAnalysis";
import { broadcastAgentHistoryUpdated } from "../_core/agentBus";
import { assertSafeUrl } from "../_core/videoEditor";
import { storagePut, assertObjectStorageWritable } from "../storage";
import * as db from "../db";
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
        model: z.string().optional(),
        comfyOnly: z.boolean().optional(),
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
type AgentChatJob = { userId: number; createdAt: number; done: boolean; result?: Awaited<ReturnType<typeof runAgentChat>>; error?: string };
const agentChatJobs = new Map<string, AgentChatJob>();
const AGENT_JOB_TTL_MS = 30 * 60_000; // 完成后 30 分钟内没被取走（客户端崩了）就清理
function sweepAgentChatJobs(): void {
  const now = Date.now();
  agentChatJobs.forEach((j, k) => { if (now - j.createdAt > AGENT_JOB_TTL_MS) agentChatJobs.delete(k); });
}

async function runAgentChat(ctx: AuthedCtx, input: z.infer<typeof agentChatInput>) {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // 自定义模型走自带 key 体系：门控收敛到 invokeLLMWithKie（自带 key 放行 / env 兜底门控）。
      if (!isCustomLLMModel(input.model)) await assertLLMAllowed(ctx, input.model);

      const model = input.model ?? FACTORY_DEFAULT_MODELS.llm;

      // 上下文总量预算动态分配（正文永不截断），避免大输入单次生成撞 LLM fetch 超时。
      const ctxBudget = allocateContextBudget(input);

      // Before planning, refresh template knowledge: incrementally analyze any
      // newly-added / changed templates (capped so a turn isn't blocked on a big
      // backlog), then read the latest analyses to feed the model. Best-effort.
      // Refresh template knowledge before planning. comfyOnly REQUIRES the full
      // library be analyzed (otherwise the agent only "knows" a partial subset and
      // picks the wrong templates), so analyze many per turn there; results are
      // cached so only new/changed templates re-run on later turns.
      try { await runLibraryAnalysis(ctx, model, { max: input.comfyOnly ? 40 : 6 }); } catch { /* non-fatal */ }
      let templateSection = "";
      const validTemplateIds = new Set<number>();
      let hasImageTemplate = false;
      let hasVideoTemplate = false;
      let imageTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      let videoTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      try {
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
      const attachmentHint = attachments.length
        ? `\n\n# 用户附带的参考附件（重要）\n${[imageAtts.length ? `${imageAtts.length} 张参考图` : "", docAtts.length ? `${docAtts.length} 份参考文档` : ""].filter(Boolean).join("、")}已随本条消息提供。请据此规划画面风格/构图/角色外观/分镜与文案。注意：你无法把二进制图片直接写进节点，只能据图产出对应的提示词、参数与节点结构（如据参考图写 promptText/appearance）；若用户要把某张图当作某节点的输入素材，提示他用「素材节点」上传后连线。`
        : "";

      const system = `你是「AI 视频画布」的智能体副驾（Copilot）。用户用自然语言描述想做的视频，你负责把它拆解为画布上的节点工作流。

# 可用节点目录（只能使用下面列出的节点类型与字段，禁止编造任何不存在的节点或字段）
${catalogText({ comfyOnly: input.comfyOnly })}${templateSection}${comfyConstraint}${input.comfyOnly ? "" : `\n\n# 云端生成模型清单（与节点选择器同源；模型 id 与 params 键/取值【严格】从此清单取，清单外一律视为编造）\n${modelKnowledgeText()}`}

# 当前画布
${ctxBudget.graphSummary || "（空画布）"}${characterSection}${input.prefs?.trim() ? `\n\n# 用户偏好/约束（必须遵守）\n${input.prefs.trim()}` : ""}${input.persona?.trim() ? `\n\n# 创作风格 / 人设（最高优先级：按此风格与视角构思画面、文案、镜头语言；但绝不能因此破坏下面的 JSON 输出格式）\n${input.persona.trim()}` : ""}${attachmentHint}

# 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构如下：
{
  "reply": "给用户的简短中文说明（你打算怎么做 / 或直接回答）",
  "operations": [
    { "op": "create", "tempId": "n1", "nodeType": "prompt", "title": "可选标题", "payload": { "positivePrompt": "..." }, "note": "为什么这么做" },
    { "op": "connect", "sourceRef": "n1", "targetRef": "n2", "note": "..." },
    { "op": "update", "targetRef": "已存在节点的id", "payload": { } },
    { "op": "delete", "targetRef": "节点id" },
    { "op": "canvas", "action": "minimal_on|minimal_off|arrange_layout|fit_view|download_all", "note": "画布级动作" }
  ]
}

规则：
- 新建节点用 "create" 并赋唯一 tempId；之后的 "connect" 用 tempId 或画布中已存在的节点 id 互相连接（sourceRef→targetRef）。
- 每个节点的 payload 只能使用目录中该节点类型列出的字段名。
- 按创作链路合理编排：脚本/分镜 → 提示词/图像/视频 → 合并/字幕/配乐。
- 模板智能匹配：选用 comfyui_workflow 模板时，按需求匹配 outputType（生图选 image、生视频选 video），并参考 capabilities 标签挑最贴合的模板；视频优先 hasVideoOutput 的模板。
- 时长感知拆镜（重要）：视频模板/模型每镜有最长时长（上面括号里的「每镜≈Ns」就是单个镜头能生成的秒数上限）。当用户的目标总时长 T 大于所选模板的每镜上限 d 时，绝不能只做几个镜头，必须按 镜头数 = ceil(T / d) 规划足够多的镜头，使 镜头数 × d ≈ T（例：目标 60s、每镜 5s → 需 12 个镜头）。把这些镜头组织成若干「场景」（叙事段落），每个场景包含一个或多个镜头。
- 场景分组：为每个生成节点加 sceneGroup 字段标注它属于哪个场景（如 "s1"/"s2"…，同一场景的镜头用同一个值），画布会据此把同场景的镜头框进一个「场景」分组容器。所有镜头仍各自连入 merge 合并成片。
- 角色一致性：当故事有反复出现的人物/主角时，为每个主要角色创建一个 character 节点（填 name/role/appearance/outfit/signature），并把该 character 连接到它出现的每一个分镜/生成节点（character → storyboard/comfyui_image/image_gen/video_task）。这样跨镜的脸/服装/特征会保持一致（连到 ComfyUI 图像节点会自动用作 IPAdapter 人脸参考）。同一角色只建一个节点、复用连接到多个镜头，不要每镜各建一个。
- 单帧构图（重要，防宫格图）：每个分镜/图像提示词（promptText / image_gen.prompt / prompt 节点）都只描述【一个镜头的单幅画面】，措辞必须是单帧视角；严禁出现会诱导模型输出宫格/拼贴的词（如 分镜表/故事板/四宫格/九宫格/多画面/连环画/storyboard/grid/collage/multi-panel/comic strip）。同时在 negativePrompt 里加上 "multi-panel, grid, collage, storyboard, comic strip, split screen" 兜底——下游图生视频节点无法处理宫格参考图，一张图必须只含一个画面。
- 镜头表完备（重要）：创建 storyboard 时必须【同时】给 description（中文画面描述，给人看）和 promptText（详细生成提示词，直接喂生图/生视频模型，禁止留空、也不要把提示词堆进 description）；必须给连续镜号 sceneNumber（1,2,3…，装配成片按它排序）；有人声内容（台词/旁白/口播/解说）的镜头填 dialogue（多人对话每行一句「角色名：台词」，纯旁白直接写文本）；按叙事节奏给 transition（常规切换 cut、时间/地点跳跃 dissolve、开场收尾 fade、强调匹配 match-cut）；尽量补 duration/shotType。这些字段会被镜头表批量生产与装配直接消费，缺了用户就要手工补。
- 分镜→成片管线：每镜建一个 video_task（或 ComfyUI 视频）工位并连入 merge——后续「镜头表面板」的批量生图/生视频会复用这些工位；逐镜配音【不要】建 audio 节点（批量配音按 dialogue 自动生成），只有整体配乐才建一个 audio(music) 连入 merge。视频出片后用户在合并节点点「按镜头表装配」即可自动完成镜号排序、逐镜转场与配音对位——请在 reply 末尾用一句话提醒该操作路径。
- 运行与计费规则（回答预算/执行类问题时按此为准，勿凭猜测）：①「运行全部」会把每个可运行节点当生成工位执行，分镜也会兜底生关键帧图——但分镜若已连了下游 image_gen 出图工位、或设了 skipAutoImage=true，系统会自动跳过分镜生图（不出图、不计费），标准的 分镜→image_gen→video_task 管线不存在重复计费；②运行确认弹窗的估价按同一口径：被自动跳过的分镜与设了 disabled 的节点都不计价；未设模型的其它生成节点按平台默认模型估价；③分镜设了 imageModel 后，只有在「镜头表面板」手动点『批量生关键帧图』才会用分镜自己再生一遍图（与 image_gen 工位重复），运行全部不会；④kie 平台按任务计费——如 Grok Imagine 一次固定返回约 6 张候选图仍只算一次的钱，张数无参数可控；⑤任何节点可由用户右键「跳过执行」（payload.disabled=true，你也可以 update 设置/解除），运行与估价都会整体跳过它。
- 规划摘要：当涉及视频时长拆分时，在返回 JSON 顶层additionally给出 plan 对象：{"targetSeconds":目标总秒数,"perShotSeconds":每镜秒数,"templateLabel":"所选模板名","shots":镜头总数}，供前端做时长校验与提示。
- 运行自愈（精准修复）：画布摘要里 status=failed 的节点会带 error 字段（失败原因），修复必须针对 error 文本的根因，禁止与根因无关的乱改。原则：最小化操作——优先 update 单个缺失/错误字段或补一条 connect，绝不删除重建节点（会丢用户已生成的结果与连线）。常见错误对照：提示词为空/缺参 → update 补该字段；缺上游输入 → connect 补连线；引用的模板/模型不存在 → update 换成目录或模板知识里真实存在的；「未配置 ComfyUI 服务器地址」→ 若摘要中其他节点有 customBaseUrl 可复用则 update 补上，否则属于环境问题；环境/外部问题（服务器离线、余额不足、网络错误、密钥未配置等）→ 无法用画布操作修复，不要动参数，在 reply 中说明原因与用户需要手动做的步骤。每项修复在 reply 里一句话交代「哪个节点、什么原因、改了什么」；确实无法修复的明确说修不了，不要假装修好。
- 增量编辑（修改现有画布时，重要）：优先对已有节点发 update，禁止删除重建或另建重复链路；update 的 payload 只放确实要改的字段，绝不回写没改的字段——画布摘要里的长文本以「…」截断，原样抄回会损坏用户原文；需要"基于原文改写"时必须输出完整的新文本，不能以截断值凑数；批量修改（如"所有镜头加雨天氛围"）对每个目标节点各发一个 update。
- 成片参与范围（#134，用户说「只用镜头 1-6 成片」「把第 3 镜排除/禁用」「恢复所有节点参与」这类指令时按此执行）：节点的 payload.disabled=true 是「参与工作」总开关——运行全部、估价、按镜头表装配三条链路都会跳过它。做法：对要排除的节点各发一个 update {"disabled":true}（恢复=false）；「只用镜头 N-M」= 把范围外的分镜节点设 disabled:true（其专属下游工位的段会随分镜一起被装配跳过，无需逐个禁用工位）；操作后在 reply 用一句话说明当前参与范围（如「已排除镜头 7-12，成片只含镜头 1-6」）。禁止用删除节点实现排除。
- 画布级动作（#112）：用户让你「切到/退出极简显示、整理布局、看全图/适应视图、把所有成品都下载下来」这类针对整张画布的操作时，输出 "canvas" 操作（action 取 minimal_on / minimal_off / arrange_layout / fit_view / download_all 之一），不需要 tempId/targetRef；可与节点操作混用（如先建节点再 arrange_layout）。极简显示仅创意模式可用；download_all 会把画布上所有已生成的图片/视频各下载一份。
- 若用户只是提问、或当前无需改动画布，operations 给空数组 []，把回答写进 reply。
- 工具/技能（若可用）：如果运行环境提供了技能（Skill）或 MCP 工具，你可以在构思阶段调用它们来提升规划质量（如查资料、按某技能的方法论组织镜头/文案）；但最终回复仍必须只输出上面规定的 JSON（reply+operations），绝不能把工具的中间输出、日志或非 JSON 内容混进最终回复。
- 规划可解释：reply 开头用 1-2 句讲清方案结构与关键选择（如「60s÷5s/镜=12 镜、3 个场景，图像用模板 X、视频用模板 Y——因为它支持首帧引导」）；每个 create/update/delete 操作都填 note（≤20 字的理由，如「开场全景定调」「补缺失的提示词」），connect 的 note 可省略。用户要能不点开任何节点就看懂这个计划做什么、为什么。
- 应用操作答疑（#112：用户问「怎么用 / 在哪里 / 有没有某功能」时按此作答，禁止编造不存在的入口）：快捷键 Alt+Q=创意模式「极简显示」（所有节点只留预览框，再按恢复）、Alt+W=「速览」（临时展开全部参考图/提示词窗）、A=选中节点展开高级参数、F=缩放到选中、Tab=新建节点、Ctrl+Enter=生成、Ctrl+K=搜索节点、?=快捷键面板；任何有视频结果的节点操作条有「快剪」（底部时间轴截取，I/O 出入点、Enter 确认）与「对比」；智能剪辑节点有「检测场景切点」（ffmpeg 视觉切点吸附剪辑边界）；叠加节点支持水印/画中画九宫格位置与实时预览；姿势控制节点与角色节点可打开「姿势库」（导演台 22 款 3D 摆姿截图作参考；画布上有分镜节点时，弹窗底部「应用到分镜」行可把截图直接写入所选分镜的参考图）；导演台含多机位系统、真 3D 灯光（8 款布光预设 + 可保存「我的布光」）、相机截图库、全景背景与场景模板；底部工具栏有风格库/运镜库/角色库；「更多 → 操作指南 / 新手导览」可回看引导；/tutorial 页有图文详细教程（各章「亲手试一试」可深链回画布导览）。双击节点空白或图片/视频预览=聚焦放大居中、再次双击=还原视口（双击标题=改名）；图像节点预览的「放大」按钮在右上角（悬停浮现），3D 换视角/真3D 在选中节点的上浮工具条；「整理布局」连点循环四种排法（流向分层/紧凑网格/横向一排/垂直一列）；群组工具条有 横向/垂直/宫格 组内排列；极简显示的多产物平铺可在网格右上角「收起/展开」；快剪条含 变速(0.5~2×)/静音/截取当前帧（帧图自动入素材库）。纯答疑时 operations 给空数组；但若用户是让你【执行】切极简/整理布局/适应视图/批量下载，请直接输出对应 canvas 操作而不是只口头指路。
- 你只负责把工作流搭好并填好参数；是否触发生成由用户在画布上确认。`;

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
      const response = await invokeLLMWithKie(ctx, { messages, model, maxTokens: ctxBudget.maxTokens });
      const text = extractTextContent(response);

      let reply = text.trim();
      let operations: AgentOperation[] = [];
      const dropped: string[] = []; // reasons for ops the LLM proposed but we discarded
      let plan: { targetSeconds: number; perShotSeconds: number; templateLabel?: string; shots: number } | undefined;
      // Strip an accidental ```json fence (belt-and-suspenders; json_object mode
      // shouldn't add one) before matching the outermost { … } object.
      const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      // 括号配平抽取所有顶层对象，优先取含 "operations" 的那个（技能/散文里的 { 不会污染），
      // 再退而取含 "reply" 的、最后取最末一个完整对象。替代原贪婪 /\{[\s\S]*\}/。
      const candidates = extractJsonObjects(cleaned);
      const jsonStr = candidates.find((c) => /"operations"\s*:/.test(c))
        ?? candidates.find((c) => /"reply"\s*:/.test(c))
        ?? candidates[candidates.length - 1];
      let parsedOk = false;
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr) as { reply?: unknown; operations?: unknown; plan?: unknown };
          parsedOk = true;
          reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "已规划完成。";
          if (Array.isArray(parsed.operations)) {
            // Sanitize each op, collecting *why* any were dropped so the user isn't
            // left wondering where a hallucinated/invalid step went.
            for (const o of parsed.operations) {
              const r = sanitizeOperationDetailed(o, { comfyOnly: input.comfyOnly, validTemplateIds });
              if ("op" in r) operations.push(r.op);
              else dropped.push(r.drop);
            }
            // 生图→生视频：确定性强制——即使 LLM 没照做也保证生效。
            // 非 ComfyUI：插 image_gen（文本→image_gen→视频）。
            // 仅 ComfyUI：插出图 comfyui_workflow（prompt→出图→图生视频），用识别到的出图/视频模板。
            if (input.imageFirst) {
              if (input.comfyOnly && chosenImg && chosenVid) {
                operations = enforceImageFirstComfy(operations, new Set(imageTpls.map((t) => t.id)), new Set(videoTpls.map((t) => t.id)), chosenImg.id);
              } else if (!input.comfyOnly) {
                operations = enforceImageFirst(operations);
              }
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
          /* malformed/truncated JSON — handled below */
        }
      }
      // Graceful fallback: never dump a raw/truncated JSON blob into the chat.
      // If the model clearly attempted a plan (has "operations") but it didn't
      // parse, it was almost certainly truncated → ask the user to retry smaller.
      // Otherwise the model answered in plain prose (a question/explanation) → keep it.
      if (!parsedOk) {
        if (/"operations"\s*:/.test(cleaned) || /^\s*[`{]/.test(text)) {
          reply = "规划结果过长，未能完整返回（可能被截断）。请重试，或减少镜头数 / 缩短目标时长后再试。";
          operations = [];
        } else {
          reply = text.trim();
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
        const allUrls = Array.from(new Set([...inOps, ...inReply])).slice(0, 6); // 单轮上限 6 个，防滥用
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

      const droppedReasons = Array.from(new Set(dropped)).slice(0, 6);
      return { reply, operations, plan, dropped: droppedReasons, droppedCount: dropped.length };
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
      void runAgentChat(ctx, input)
        .then((r) => { job.result = r; job.done = true; })
        .catch((e) => { job.error = e instanceof Error ? e.message : String(e); job.done = true; });
      return { jobId };
    }),

  // 轮询任务状态；done 后取走即删（结果一次性消费，客户端拿到后自行持久化到会话）。
  chatStatus: protectedProcedure
    .input(z.object({ jobId: z.string().max(64) }))
    .query(({ ctx, input }) => {
      sweepAgentChatJobs(); // 轮询频繁，顺带清理过期任务（不只依赖 submit 时清扫）
      const j = agentChatJobs.get(input.jobId);
      if (!j || j.userId !== ctx.user.id) return { state: "missing" as const };
      if (!j.done) return { state: "running" as const };
      agentChatJobs.delete(input.jobId);
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
