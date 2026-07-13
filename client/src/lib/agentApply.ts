import { toast } from "sonner";
import { useCanvasStore, aspectToComfyWH } from "../hooks/useCanvasStore";
import { NODE_CONFIGS } from "./nodeConfig";
import { getNodeImageOutput } from "./canvasPassthrough";
import { downloadMedia } from "./download";
import { isConnectionValid, defaultTargetHandle } from "./connectionRules";
import { charDisplayName, libraryOverlayByName, type CharacterImportMode } from "./characterConditioning";
import type { NodeType, NodeData, AgentOperation, WorkflowParamBinding, CharacterNodeData, CharacterKind } from "../../../shared/types";

/** Library template shape (subset of comfyTemplates.list output) used to
 *  materialize an agent-proposed comfyui_workflow node from a templateId. */
export interface AgentTemplate { id: number; label: string; payload: Record<string, unknown> }

/** Build a comfyui_workflow node payload from a template, writing the agent's
 *  prompts into the template's positive/negative role params.
 *  （也被镜头表「批量生成视频 · ComfyUI 模板」复用来物化逐镜工位。） */
export function materializeTemplate(tpl: AgentTemplate, prompt: string, negPrompt: string): Record<string, unknown> {
  const base: Record<string, unknown> = { ...tpl.payload, templateId: tpl.id, templateLabel: tpl.label };
  const bindings = (base.paramBindings as WorkflowParamBinding[] | undefined) ?? [];
  const paramValues: Record<string, unknown> = { ...((base.paramValues as Record<string, unknown>) ?? {}) };
  for (const b of bindings) {
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (b.role === "positive" && prompt) paramValues[key] = prompt;
    if (b.role === "negative" && negPrompt) paramValues[key] = negPrompt;
  }
  base.paramValues = paramValues;
  return base;
}

// ── Apply agent-proposed operations to the canvas store ───────────────────────
// Runs every op through the SAME store actions a manual edit uses (addNode /
// updateNodeData / updateNodeTitle / onConnect / deleteNode), so the whole batch
// is undoable, persisted and broadcast to collaborators like any other change.
// `tempId`s the agent assigned to freshly-created nodes are resolved to the real
// nanoid ids so subsequent `connect` ops wire the right nodes.

export interface ApplyResult {
  created: number;
  connected: number;
  updated: number;
  deleted: number;
  /** #112 画布级动作执行数（极简显示/整理布局/适应视图/批量下载）。 */
  canvasActions: number;
  failures: { index: number; op: string; reason: string }[];
  /** 本批操作实际触及的真实节点 id（create 的新节点 / update 目标 / connect 的下游
   *  target）。自愈闭环用它把重跑范围收窄到「失败节点+本次修复涉及节点」，避免
   *  全量重跑已成功节点烧钱。⚠️ 含被 update/connect 的【已有】节点——绝不能拿它做
   *  「撤销=删除」，会误删用户原有节点；删除撤销只能用 createdIds。 */
  touchedIds: string[];
  /** 本批【新建】的节点 id（仅 create）。可安全用于「撤销本次改动=删除新建节点」——
   *  只删本轮 AI 建的节点，不碰被 update/connect 的用户既有节点。 */
  createdIds: string[];
}

const COMFY_NODE_TYPES = new Set<string>(["comfyui_image", "comfyui_video", "comfyui_workflow"]);

/** Assign chosen ComfyUI server URLs onto a batch's comfy create ops (in place),
 *  spreading load by round-robin (顺序) or random. No-op when chosen is empty. */
export function distributeServers(ops: AgentOperation[], chosen: string[], strategy: "round" | "random"): void {
  if (chosen.length === 0) return;
  let i = 0;
  for (const o of ops) {
    if (o.op !== "create" || !o.nodeType || !COMFY_NODE_TYPES.has(o.nodeType)) continue;
    const url = strategy === "random" ? chosen[Math.floor(Math.random() * chosen.length)] : chosen[i % chosen.length];
    o.payload = { ...(o.payload ?? {}), customBaseUrl: url };
    i++;
  }
}

/** When enabled, set freeVramAfterRun=true on every comfy create op's payload, so
 *  the agent's planned ComfyUI nodes free VRAM after each run. Pure / in place. */
export function injectFreeVramIntoOps(ops: AgentOperation[], enabled: boolean): AgentOperation[] {
  if (!enabled) return ops;
  for (const o of ops) {
    if (o.op !== "create" || !o.nodeType || !COMFY_NODE_TYPES.has(o.nodeType)) continue;
    o.payload = { ...(o.payload ?? {}), freeVramAfterRun: true };
  }
  return ops;
}

/** 画面比例字段映射（单一真源）：按节点类型返回应写入的比例字段。各模型族读不同字段——
 *  kie→aspectRatio、Poyo 图→poyoAspectRatio、Reve/Seedream/Flux→reveAspectRatio——故同族
 *  节点把对应字段全写、互不影响。被配方（buildRecipeOps）与智能体应用层（applyAgentOperations）
 *  复用，保证两条路径的画面比例一致落地到下游生成节点。aspect 为空时返回空。 */
export function aspectFieldsFor(nodeType: NodeType, aspect: string): Record<string, unknown> {
  if (!aspect) return {};
  switch (nodeType) {
    // storyboard 关键帧与 image_gen 走同一图像后端（generateImage）——按模型族读不同字段：
    // kie→aspectRatio、poyo→poyoAspectRatio、Reve/Seedream/Flux→reveAspectRatio，故三者都写。
    case "storyboard": return { aspectRatio: aspect, poyoAspectRatio: aspect, reveAspectRatio: aspect };
    case "image_gen": return { aspectRatio: aspect, poyoAspectRatio: aspect, reveAspectRatio: aspect };
    case "prompt": return { aspectRatio: aspect };
    case "comfyui_workflow": return { aspectRatio: aspect, overrideRatioSize: true };
    // ComfyUI 图像/视频节点直接读 payload.width/height（无 aspectRatio 概念）——按比例换算成
    // /64 对齐的生成尺寸，与「按镜头表批量装配」路径（aspectToComfyWH）一致，否则回退 512×512。
    case "comfyui_image":
    case "comfyui_video": return aspectToComfyWH(aspect);
    default: return {};
  }
}

// ── 防宫格兜底（确定性）────────────────────────────────────────────────────────
// 分镜/图像生成常把「多镜头描述」画成一张宫格/拼贴参考图，下游图生视频无法处理。
// 除了系统提示要求 LLM 单帧措辞外，这里对智能体新建的生成节点在 negativePrompt
// 里确定性追加反宫格词（fill-append：已含关键词则不重复）。
const ANTI_GRID_NEGATIVE = "multi-panel, grid, collage, storyboard, comic strip, split screen";
export function appendAntiGridNegative(existing: unknown): string {
  const cur = typeof existing === "string" ? existing.trim() : "";
  if (/multi-panel|宫格|拼贴|collage|storyboard/i.test(cur)) return cur; // 已有防宫格词，不重复
  return cur ? `${cur}, ${ANTI_GRID_NEGATIVE}` : ANTI_GRID_NEGATIVE;
}
// negativePrompt 的字段名按节点类型：storyboard/image_gen→negativePrompt，comfy 系→negPrompt。
// 配对的正向字段用于「用户就是要拼贴」时跳过注入（正反词冲突反而毁图）。
const ANTI_GRID_FIELD: Partial<Record<NodeType, { neg: string; pos: string }>> = {
  storyboard: { neg: "negativePrompt", pos: "promptText" },
  image_gen: { neg: "negativePrompt", pos: "prompt" },
  prompt: { neg: "negativePrompt", pos: "positivePrompt" },
  comfyui_image: { neg: "negPrompt", pos: "prompt" },
};
const GRID_INTENT_RE = /宫格|拼贴|连环画|分镜表|故事板|multi-panel|collage|contact sheet|comic strip|storyboard|split screen/i;

/** 生成类节点类型（快速设置「允许使用的生成节点」勾选的作用域）。 */
export const GEN_NODE_TYPES = ["image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow"] as const;

// ── #112 画布级动作（op:"canvas"）────────────────────────────────────────────
// 极简显示与 Canvas 的 Alt+Q 完全同一套信号（attr + localStorage + 事件）；
// fit_view 经自定义事件转交 Canvas 持有的 reactFlow 实例（本文件拿不到实例）。
export const CANVAS_FIT_VIEW_EVENT = "canvas:fit-view";

/** 与批量下载同规则的成品提取：视频优先 resultVideoUrl/videoUrl → outputUrl → 图片输出。 */
const CANVAS_VIDEO_OUT_TYPES = new Set(["clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "overlay", "video_task", "comfyui_video", "comfyui_workflow", "lip_sync", "avatar"]);
function nodeResultMedia(nodeType: string, payload: Record<string, unknown>): { url: string; type: "image" | "video" } | null {
  const v = (payload.resultVideoUrl ?? payload.videoUrl) as unknown;
  if (typeof v === "string" && v) return { url: v, type: "video" };
  const out = payload.outputUrl as unknown;
  if (typeof out === "string" && out) return { url: out, type: /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(out) || CANVAS_VIDEO_OUT_TYPES.has(nodeType) ? "video" : "image" };
  const img = getNodeImageOutput(nodeType as NodeType, payload as never);
  return img ? { url: img, type: "image" } : null;
}

/** 执行一个画布级动作；返回失败原因（null=成功）。 */
function runCanvasAction(action: AgentOperation["action"]): string | null {
  const el = document.documentElement;
  switch (action) {
    case "minimal_on":
    case "minimal_off": {
      if (el.getAttribute("data-canvas-mode") !== "creative") return "极简显示仅在创意模式可用";
      const on = action === "minimal_on";
      if (on) el.setAttribute("data-canvas-minimal", "1");
      else el.removeAttribute("data-canvas-minimal");
      window.dispatchEvent(new CustomEvent("canvas:minimal-change"));
      try { localStorage.setItem("avc:canvas-minimal", on ? "1" : "0"); } catch { /* restricted */ }
      toast.success(on ? "已切换到极简显示（Alt+Q 恢复）" : "已恢复标准显示", { duration: 1600 });
      return null;
    }
    case "arrange_layout": {
      // 助手固定用确定性的「流向分层」（#124 的循环切换是给按钮连点交互用的）。
      const r = useCanvasStore.getState().autoLayout("flow");
      window.dispatchEvent(new CustomEvent(CANVAS_FIT_VIEW_EVENT));
      toast.success(r.count > 0 ? `已按「${r.label}」整理 ${r.count} 个节点` : "没有可整理的自由节点（群组内节点不参与）", { duration: 1600 });
      return null;
    }
    case "fit_view":
      window.dispatchEvent(new CustomEvent(CANVAS_FIT_VIEW_EVENT));
      return null;
    case "download_all": {
      const st = useCanvasStore.getState();
      let k = 0;
      for (const n of st.nodes) {
        if (n.data.nodeType === "group") continue;
        const m = nodeResultMedia(n.data.nodeType, (n.data.payload ?? {}) as Record<string, unknown>);
        if (!m) continue;
        void downloadMedia(m.url, `${n.data.title || n.data.nodeType}.${m.type === "video" ? "mp4" : "png"}`, m.type);
        k++;
      }
      if (k === 0) return "画布上还没有已生成的成品可下载";
      toast.success(`开始下载 ${k} 个成品`, { duration: 1800 });
      return null;
    }
    default:
      return `未知的画布动作「${String(action)}」`;
  }
}

export function applyAgentOperations(
  ops: AgentOperation[],
  anchor: { x: number; y: number },
  opts: {
    templates?: AgentTemplate[]; freeVramAfterRun?: boolean; ownerAgentId?: string; characterImportMode?: CharacterImportMode; aspect?: string;
    /** 快速设置指定的图像模型（fill-only 写入新建 image_gen.model / storyboard.imageModel）。 */
    imageModel?: string;
    /** 快速设置指定的视频模型（fill-only 写入新建 video_task.provider）。 */
    videoProvider?: string;
    /** 快速设置勾选的「允许使用的生成节点类型」；提供且非空时，清单外的生成类 create 直接判失败。 */
    allowedGenNodes?: string[];
    /** 快速设置勾选的「允许引用的工作流模板 id」；提供且非空时，comfyui_workflow 只能引用其中的模板。 */
    allowedTemplateIds?: number[];
    /** 快速设置「排除分镜节点」（#138）：为真时 storyboard 的 create 直接判失败（镜头信息应改由 prompt 节点承载）。 */
    excludeStoryboard?: boolean;
  } = {},
): ApplyResult {
  injectFreeVramIntoOps(ops, opts.freeVramAfterRun === true);
  const store = useCanvasStore.getState();
  const idMap = new Map<string, string>(); // tempId → real node id
  const resolve = (ref?: string): string | undefined => (ref ? idMap.get(ref) ?? ref : undefined);
  // Track live node ids (existing + created this batch) and their types so connect
  // ops can be validated — otherwise a connect to a hallucinated/uncreated ref
  // would create a dangling edge, and an illegal pairing would bypass the rules.
  const liveIds = new Set(store.nodes.map((n) => n.id));
  const typeById = new Map<string, NodeType>(store.nodes.map((n) => [n.id, n.data.nodeType as NodeType]));
  const res: ApplyResult = { created: 0, connected: 0, updated: 0, deleted: 0, canvasActions: 0, failures: [], touchedIds: [], createdIds: [] };
  const fail = (index: number, op: AgentOperation, reason: string) => {
    op.status = "failed"; op.error = reason;
    res.failures.push({ index, op: op.op, reason });
  };

  // ── Scene-aware layout planning ──────────────────────────────────────────
  // When create ops carry `sceneGroup` (duration-aware scene planning), lay each
  // scene out as its own vertical column and wrap it in a `group` "场景" box.
  // Otherwise fall back to the original 3-per-row fan-out (unchanged behavior).
  // Generous spacing so connection edges stay visible between (often tall) nodes —
  // node ≈340w and image/video nodes run 400–600px tall, so columns/rows need room.
  const SCENE_COL_W = 560, ROW_H = 480, PAD = 40, HEADER = 48, NODE_W = 340;
  const createOps = ops.filter((o) => o.op === "create");
  const sceneKeys: string[] = [];
  for (const o of createOps) {
    const k = o.sceneGroup?.trim();
    if (k && !sceneKeys.includes(k)) sceneKeys.push(k);
  }
  const useScenes = sceneKeys.length > 0;
  const posByOp = new Map<AgentOperation, { x: number; y: number }>();
  const sceneBoxes: { x: number; y: number; width: number; height: number; title: string }[] = [];
  if (useScenes) {
    sceneKeys.forEach((key, sIdx) => {
      const sceneOps = createOps.filter((o) => o.sceneGroup?.trim() === key);
      const baseX = anchor.x + 560 + sIdx * (SCENE_COL_W + PAD);
      sceneOps.forEach((o, i) => posByOp.set(o, { x: baseX + PAD, y: anchor.y + HEADER + i * ROW_H }));
      sceneBoxes.push({ x: baseX, y: anchor.y, width: NODE_W + PAD * 2, height: HEADER + sceneOps.length * ROW_H, title: `场景${sIdx + 1}` });
    });
    // Scene-less create ops (e.g. shared script / merge) go in a trailing column.
    const tailX = anchor.x + 560 + sceneKeys.length * (SCENE_COL_W + PAD);
    let tailIdx = 0;
    for (const o of createOps) {
      if (!o.sceneGroup?.trim()) { posByOp.set(o, { x: tailX, y: anchor.y + HEADER + tailIdx * ROW_H }); tailIdx++; }
    }
  }

  // Apply order: all `create` first (preserving their relative order), then the
  // rest (connect/update/delete) in their original relative order. The LLM's op
  // array isn't guaranteed to be topologically sorted — a connect/update that
  // references a node created later in the array would otherwise resolve to an
  // unknown id and be wrongly dropped. Each op keeps its ORIGINAL index for
  // failure reporting. (Manual UI / recipes already emit create-first; this just
  // hardens the LLM path.)
  const ordered: Array<readonly [AgentOperation, number]> = [
    ...ops.map((o, i) => [o, i] as const).filter(([o]) => o.op === "create"),
    ...ops.map((o, i) => [o, i] as const).filter(([o]) => o.op !== "create"),
  ];
  // Seed with existing edges so a connect that duplicates an already-present edge
  // (store.onConnect dedupes by source+target and silently no-ops) is not counted
  // as a freshly established connection — keeps `res.connected` truthful.
  const edgeKeys = new Set(store.edges.map((e) => `${e.source} ${e.target}`));
  // Whole plan = one undo step.
  store.runBatch(() => {
    let createdIdx = 0;
    ordered.forEach(([op, index]) => {
      try {
        if (op.op === "create") {
          if (!op.nodeType) { fail(index, op, "缺少 nodeType"); return; }
          // 未知节点类型（服务端 sanitize 漏网 / 非官方客户端）——友好拦截，避免 store.addNode
          // 读 NODE_CONFIGS[未知].defaultTitle 抛「Cannot read properties of undefined」内部错误。
          if (!(op.nodeType in NODE_CONFIGS)) { fail(index, op, `未知节点类型：${op.nodeType}`); return; }
          // 快速设置「排除分镜节点」硬约束（#138）：LLM 违规创建 storyboard → 判失败
          // （失败原因随自愈回路喂回 LLM，促使改用 prompt 节点承载镜头信息）。
          if (opts.excludeStoryboard && op.nodeType === "storyboard") {
            fail(index, op, "规划设置已排除分镜节点（storyboard）——镜头信息请改用 prompt 提示词节点承载");
            return;
          }
          // 快速设置「允许使用的生成节点」硬约束：LLM 违规选了未勾选的生成节点类型 → 判失败
          // （失败原因会随自愈回路喂回 LLM，促使换成允许的类型），非生成类节点不受限。
          if (opts.allowedGenNodes && opts.allowedGenNodes.length && (GEN_NODE_TYPES as readonly string[]).includes(op.nodeType) && !opts.allowedGenNodes.includes(op.nodeType)) {
            fail(index, op, `规划设置不允许使用 ${op.nodeType} 节点（允许：${opts.allowedGenNodes.join("/")}）`);
            return;
          }
          // 快速设置「允许的工作流模板」硬约束：comfyui_workflow 必须引用所选模板之一
          //（未带 templateId 的空壳节点在限定模式下同样拒绝——空壳跑不了也没意义）。
          if (op.nodeType === "comfyui_workflow" && opts.allowedTemplateIds && opts.allowedTemplateIds.length) {
            const tid = Number((op.payload as Record<string, unknown> | undefined)?.templateId);
            if (!Number.isInteger(tid) || !opts.allowedTemplateIds.includes(tid)) {
              fail(index, op, `规划设置只允许使用模板 id ∈ [${opts.allowedTemplateIds.join(", ")}]（本操作 templateId=${String((op.payload as Record<string, unknown> | undefined)?.templateId ?? "缺失")}）`);
              return;
            }
          }
          // comfyui_workflow with a templateId → materialize from the library.
          let payload = op.payload as Record<string, unknown> | undefined;
          if (op.nodeType === "comfyui_workflow" && payload?.templateId != null) {
            const tpl = opts.templates?.find((t) => t.id === Number(payload!.templateId));
            if (!tpl) { fail(index, op, `未找到模板 id=${String(payload.templateId)}`); return; }
            // Guard: only comfyui_workflow templates carry a workflowJson. Referencing
            // a comfyui_image/video template id here would produce an empty workflow
            // node (no params/model) — fail clearly instead of creating a blank node.
            if (!tpl.payload || typeof tpl.payload.workflowJson !== "string" || !(tpl.payload.workflowJson as string).trim()) {
              fail(index, op, `模板「${tpl.label}」(id=${tpl.id}) 不是工作流模板（无 workflowJson），无法作为 comfyui_workflow 节点`);
              return;
            }
            // Preserve client-side overrides (set before apply) — materializeTemplate
            // rebuilds payload from the template and would otherwise drop them.
            const serverOverride = typeof payload.customBaseUrl === "string" ? payload.customBaseUrl : undefined;
            const freeVramOverride = payload.freeVramAfterRun === true;
            // 画面比例（LLM 经 catalog 设的，或配方/opts.aspect fill 进来的）也要跨物化保留，
            // 否则 ComfyuiWorkflowNode 拿不到 aspectRatio/overrideRatioSize、无法覆盖 latent 尺寸。
            const aspectOverride = typeof payload.aspectRatio === "string" ? payload.aspectRatio : undefined;
            const ratioSizeOverride = payload.overrideRatioSize === true;
            payload = materializeTemplate(tpl, String(payload.prompt ?? ""), String(payload.negPrompt ?? ""));
            if (serverOverride) payload.customBaseUrl = serverOverride;
            if (freeVramOverride) payload.freeVramAfterRun = true;
            if (aspectOverride) payload.aspectRatio = aspectOverride;
            if (ratioSizeOverride) payload.overrideRatioSize = true;
          }
          // 分镜兜底（实测 bug）：LLM/配方常把生成提示词整段写进 description（场景描述框），
          // promptText（提示词框）留空。批量生产本就按 promptText||description 回退——这里
          // 在创建时把回退显式化：promptText 为空则补 description，提示词框不再空置。
          // 仅创建时填空，绝不覆盖 LLM 已分别给出的两个字段。
          if (op.nodeType === "storyboard" && payload) {
            const d = typeof payload.description === "string" ? payload.description.trim() : "";
            const pt = typeof payload.promptText === "string" ? payload.promptText.trim() : "";
            if (!pt && d) payload = { ...payload, promptText: d };
          }
          // Scene layout when planned, else fan out 3 per row to the agent's right.
          const pos = posByOp.get(op) ?? {
            x: anchor.x + 560 + (createdIdx % 3) * 540,
            y: anchor.y + Math.floor(createdIdx / 3) * 480,
          };
          const node = store.addNode(op.nodeType as NodeType, pos);
          res.touchedIds.push(node.id);
          res.createdIds.push(node.id);
          if (op.tempId) idMap.set(op.tempId, node.id);
          liveIds.add(node.id);
          typeById.set(node.id, op.nodeType as NodeType);
          if (op.title) store.updateNodeTitle(node.id, op.title);
          // @角色 代入：智能体新建的 character 节点只有文字字段——按显示名匹配角色库，
          // 把参考图/LoRA/语音等（按用户选的代入力度）合并进来，让它真正"代入"库中角色。
          if (op.nodeType === "character" && payload) {
            const cp = payload as CharacterNodeData;
            const overlay = libraryOverlayByName(
              charDisplayName(cp),
              (cp.characterKind ?? "person") as CharacterKind,
              opts.characterImportMode ?? "conditioning",
              cp,
            );
            if (overlay) payload = { ...payload, ...overlay };
          }
          // 防宫格兜底：智能体新建的分镜/图像生成节点，negativePrompt 确定性追加反宫格词
          // （宫格参考图下游图生视频无法处理；LLM 忘写时由这里补齐）。
          {
            const ag = ANTI_GRID_FIELD[op.nodeType as NodeType];
            const cur = (payload ?? {}) as Record<string, unknown>;
            const pos = ag ? cur[ag.pos] : undefined;
            const wantsGrid = typeof pos === "string" && GRID_INTENT_RE.test(pos); // 正向明确要拼贴 → 不注入
            if (ag && !wantsGrid) payload = { ...cur, [ag.neg]: appendAntiGridNegative(cur[ag.neg]) };
          }
          // 画面比例确定性透传：LLM 自己给的 aspectRatio 或「规划设置」统一比例（LLM 值优先），
          // 展开成该节点类型的全部比例字段（kie/poyo/reve 各族读不同字段），fill-only 不覆盖已设值。
          {
            const cur = (payload ?? {}) as Record<string, unknown>;
            const aspectSeed = (typeof cur.aspectRatio === "string" && cur.aspectRatio) || opts.aspect || "";
            if (aspectSeed) {
              const af = aspectFieldsFor(op.nodeType as NodeType, aspectSeed);
              const add: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(af)) if (cur[k] === undefined || cur[k] === "") add[k] = v;
              if (Object.keys(add).length) payload = { ...(payload ?? {}), ...add };
            }
          }
          // 快速设置指定模型：fill-only 写入新建生成节点（LLM 显式选的模型优先）。
          if (op.nodeType === "image_gen" && opts.imageModel && !(payload as Record<string, unknown> | undefined)?.model) {
            payload = { ...(payload ?? {}), model: opts.imageModel };
          }
          if (op.nodeType === "storyboard" && opts.imageModel && !(payload as Record<string, unknown> | undefined)?.imageModel) {
            payload = { ...(payload ?? {}), imageModel: opts.imageModel };
          }
          if (op.nodeType === "video_task" && opts.videoProvider && !(payload as Record<string, unknown> | undefined)?.provider) {
            payload = { ...(payload ?? {}), provider: opts.videoProvider };
          }
          // video_task 的 duration 在智能体目录是【顶层字段】，但节点实际读 payload.params.duration
          // ——落地时映射进 params，让智能体设的时长真正生效（连了分镜则由提交时的上游继承兜底）。
          if (op.nodeType === "video_task" && payload && typeof (payload as { duration?: unknown }).duration === "number") {
            const { duration, ...rest } = payload as Record<string, unknown> & { duration: number };
            payload = { ...rest, params: { ...((rest.params as Record<string, unknown>) ?? {}), duration } };
          }
          // video_task 的统一比例落进 params.aspect_ratio（fill-only；不支持该键的模型在提交层
          // 会被各 provider 的参数 allow-list 自动剔除，写了也无害）。
          if (op.nodeType === "video_task" && opts.aspect) {
            const rest = (payload ?? {}) as Record<string, unknown>;
            const params = { ...((rest.params as Record<string, unknown>) ?? {}) };
            if (params.aspect_ratio === undefined || params.aspect_ratio === "") {
              params.aspect_ratio = opts.aspect;
              payload = { ...rest, params };
            }
          }
          // Stamp ownership (multi-agent) + scene membership (so a Character can
          // "应用到本场景所有镜头"). Both stored in payload like `createdBy`.
          const ownedPayload = {
            ...(payload ?? {}),
            ...(opts.ownerAgentId ? { ownerAgentId: opts.ownerAgentId } : {}),
            ...(op.sceneGroup?.trim() ? { sceneGroup: op.sceneGroup.trim() } : {}),
          };
          if (Object.keys(ownedPayload).length) {
            store.updateNodeData(node.id, ownedPayload as Partial<NodeData>, true);
          }
          op.status = "applied";
          res.created++;
          createdIdx++;
        } else if (op.op === "connect") {
          const source = resolve(op.sourceRef);
          const target = resolve(op.targetRef);
          if (!source || !target) { fail(index, op, `连接的节点未找到（${op.sourceRef}→${op.targetRef}）`); return; }
          if (source === target) { fail(index, op, "不能连接到自身"); return; }
          // The refs must resolve to REAL nodes (existing or created this batch) —
          // a hallucinated/uncreated ref otherwise becomes a dangling edge.
          if (!liveIds.has(source) || !liveIds.has(target)) { fail(index, op, `连接引用了不存在的节点（${op.sourceRef}→${op.targetRef}）`); return; }
          // Enforce the same connection rules as the manual UI so the agent can't
          // build illegal pairings (e.g. merge → script).
          const st = typeById.get(source), tt = typeById.get(target);
          if (st && tt && !isConnectionValid(st, tt)) { fail(index, op, `不允许的连接：${st} → ${tt}`); return; }
          const edgeKey = `${source} ${target}`;
          const isNewEdge = !edgeKeys.has(edgeKey);
          // clip 无 `input` 桩——LLM 通常省略 targetHandle，缺省时按目标类型推默认输入桩
          // （clip→video-in；音频源→audio-in），否则边落到不存在的桩、剪辑入边不渲染。
          // 与手动/模板/自动连线统一走 defaultTargetHandle（单一真源）。
          store.onConnect({ source, target, sourceHandle: op.sourceHandle ?? "output", targetHandle: op.targetHandle ?? defaultTargetHandle(tt, st) });
          op.status = "applied";
          // Only count + flag-for-rerun when an edge was actually added; a duplicate
          // (source→target already wired) is a no-op in the store, so counting it
          // would inflate `connected` and needlessly re-run the downstream node.
          if (isNewEdge) {
            edgeKeys.add(edgeKey);
            res.touchedIds.push(target); // 补了输入连线的下游节点需要重跑
            res.connected++;
          }
        } else if (op.op === "update") {
          const target = resolve(op.targetRef);
          if (!target) { fail(index, op, `要更新的节点未找到（${op.targetRef}）`); return; }
          // 与 connect 一致：ref 必须解析到真实节点。resolve 对未知 ref 会原样返回字符串（非空 →
          // 上面的检查通不掉），若不校验 liveIds，幻觉/已删 id 会被 updateNodeData 静默空转，却仍
          // 记为成功 → 自愈循环（按 failures 重试）永远不重试这条本该失败的改动。
          if (!liveIds.has(target)) { fail(index, op, `要更新的节点不存在（${op.targetRef}）`); return; }
          if (op.title) store.updateNodeTitle(target, op.title);
          if (op.payload && Object.keys(op.payload).length) {
            // Guard: an update must not inject a templateId for a node whose template
            // isn't a real workflow template (would blank the node) — strip it.
            const up = { ...(op.payload as Record<string, unknown>) };
            if (up.templateId != null) {
              const tpl = opts.templates?.find((t) => t.id === Number(up.templateId));
              if (!tpl || typeof tpl.payload?.workflowJson !== "string" || !(tpl.payload.workflowJson as string).trim()) delete up.templateId;
            }
            // 截断回写守卫：画布摘要里长文本以「…」截断，LLM 增量编辑时可能把截断值
            // 原样抄回 update——写入会把用户的长文本砍掉。识别特征：新值以…结尾、
            // 恰为现有值的前缀且现有值更长 → 丢弃该字段，保住原文。
            const curPayload = (useCanvasStore.getState().nodes.find((n) => n.id === target)?.data.payload ?? {}) as Record<string, unknown>;
            for (const k of Object.keys(up)) {
              const nv = up[k], cv = curPayload[k];
              if (typeof nv === "string" && typeof cv === "string" && nv.endsWith("…")) {
                const prefix = nv.slice(0, -1);
                if (cv.length > prefix.length && cv.startsWith(prefix)) delete up[k];
              }
            }
            if (Object.keys(up).length) store.updateNodeData(target, up as Partial<NodeData>, true);
          }
          op.status = "applied";
          res.updated++;
          res.touchedIds.push(target);
        } else if (op.op === "delete") {
          const target = resolve(op.targetRef);
          if (!target) { fail(index, op, `要删除的节点未找到（${op.targetRef}）`); return; }
          if (!liveIds.has(target)) { fail(index, op, `要删除的节点不存在（${op.targetRef}）`); return; }
          store.deleteNode(target);
          // 删后同步 live 集合：否则同一批里「先删 X、再 connect 到 X」会因 liveIds 仍含 X 而通过
          // 校验、建出一条指向已删节点的悬空边（正是 connect 守卫想拦的）。
          liveIds.delete(target); typeById.delete(target);
          op.status = "applied";
          res.deleted++;
        } else if (op.op === "canvas") {
          // #112 画布级动作：不针对单个节点。失败原因（如非创意模式）走统一 failures 通道。
          const err = runCanvasAction(op.action);
          if (err) { fail(index, op, err); return; }
          op.status = "applied";
          res.canvasActions++;
        }
      } catch (e) {
        fail(index, op, e instanceof Error ? e.message : String(e));
      }
    });
    // Wrap each planned scene's shots in a 「场景」group container (behind nodes).
    for (const box of sceneBoxes) store.addGroupBox(box, box.title);
  });
  res.touchedIds = Array.from(new Set(res.touchedIds));
  res.createdIds = Array.from(new Set(res.createdIds));
  return res;
}

// ── Compact graph summary for the agent's context ─────────────────────────────
// A few headline payload fields per node type so the model knows what already
// exists (for incremental edits) without shipping the whole node data.
const SUMMARY_FIELDS: Partial<Record<NodeType, string[]>> = {
  script: ["aiGenre", "aiStyle", "aiMood", "aiSceneCount", "aiTargetModel", "synopsis"],
  // 镜号/转场/对白是镜头表与装配的核心字段，增量编辑必须可见（否则智能体盲改/重复）。
  storyboard: ["sceneNumber", "description", "promptText", "negativePrompt", "dialogue", "transition", "cameraMovement", "duration", "aspectRatio", "skipAutoImage"],
  prompt: ["positivePrompt", "negativePrompt", "style", "aspectRatio"],
  image_gen: ["prompt", "negativePrompt", "model", "aspectRatio"],
  comfyui_image: ["prompt", "negPrompt", "templateLabel", "templateId"],
  comfyui_video: ["prompt", "negPrompt", "templateLabel", "templateId"],
  comfyui_workflow: ["templateLabel", "templateId", "aspectRatio"],
  video_task: ["prompt", "negativePrompt", "provider", "params"],
  merge: ["transition"],
  audio: ["audioCategory", "ttsText", "musicPrompt"],
  note: ["content"],
  // 角色：此前完全缺失——智能体看不到已建角色，跨镜一致性/后续编辑无从协调。
  character: ["characterKind", "name", "role", "appearance", "outfit", "signature", "sceneName", "sceneDescription"],
};

/**
 * 规划可解释：从操作列表确定性推导一行「计划大纲」——场景/节点统计、模板引用、
 * 连接/更新/删除计数（删除醒目标注）、时长拆解（plan 对象）。不依赖 LLM 的自述，
 * 用户在应用前一眼看懂这个计划要对画布做什么。
 */
export function summarizePlanOps(
  ops: AgentOperation[],
  plan?: { targetSeconds: number; perShotSeconds: number; shots: number; templateLabel?: string },
): string {
  const creates = ops.filter((o) => o.op === "create");
  const byType = new Map<string, number>();
  for (const o of creates) {
    const label = NODE_CONFIGS[o.nodeType as NodeType]?.label ?? o.nodeType ?? "节点";
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }
  const scenes = new Set(creates.map((o) => o.sceneGroup?.trim()).filter(Boolean)).size;
  const templates = new Set(creates.map((o) => (o.payload as { templateId?: unknown } | undefined)?.templateId).filter((v) => v != null).map(String)).size;
  const connects = ops.filter((o) => o.op === "connect").length;
  const updates = ops.filter((o) => o.op === "update").length;
  const deletes = ops.filter((o) => o.op === "delete").length;
  const parts: string[] = [];
  if (plan && plan.perShotSeconds > 0) parts.push(`${plan.targetSeconds}s ÷ ${plan.perShotSeconds}s/镜 ≈ ${plan.shots} 镜${plan.templateLabel ? `（${plan.templateLabel}）` : ""}`);
  if (scenes > 0) parts.push(`${scenes} 个场景`);
  if (byType.size > 0) parts.push(Array.from(byType.entries()).map(([l, n]) => `${l}×${n}`).join(" + "));
  if (templates > 0) parts.push(`引用 ${templates} 个模板`);
  if (connects > 0) parts.push(`${connects} 条连线`);
  if (updates > 0) parts.push(`更新 ${updates} 处`);
  if (deletes > 0) parts.push(`⚠️ 删除 ${deletes} 个节点`);
  return parts.join(" · ");
}

export function buildGraphSummary(excludeNodeId: string, opts: { focusNodeIds?: string[] } = {}): string {
  const { nodes, edges } = useCanvasStore.getState();
  const focus = opts.focusNodeIds && opts.focusNodeIds.length ? new Set(opts.focusNodeIds) : null;
  // 分级截断：小范围（微调选中/小画布，≤12 节点）放宽到 400 字——增量编辑需要看到
  // 原文全貌才能精准改写；大画布维持 60 字防摘要爆 token（18000 硬帽兜底）。
  const scopedCount = focus ? focus.size : nodes.length;
  const clipLen = scopedCount <= 12 ? 400 : 60;
  const clip = (v: unknown) => (typeof v === "string" ? (v.length > clipLen ? v.slice(0, clipLen) + "…" : v) : v);
  const nodeLines = nodes
    .filter((n) => n.id !== excludeNodeId && (!focus || focus.has(n.id)))
    .map((n) => {
      const type = n.data.nodeType as NodeType;
      const fields = SUMMARY_FIELDS[type] ?? [];
      const p = (n.data.payload ?? {}) as Record<string, unknown>;
      const kv: Record<string, unknown> = {};
      for (const f of fields) if (p[f] != null && p[f] !== "") kv[f] = clip(p[f]);
      // Surface generation status so the agent knows what's done/failed.
      if (typeof p.status === "string" && p.status !== "idle") kv.status = p.status;
      // 失败原因直达：自愈要对症下药，光知道 failed 不知道为什么修不准。错误文本
      // 用更宽的截断（根因常在 60 字之后，如 ComfyUI 返回的节点级报错）。
      if (p.status === "failed" && typeof p.errorMessage === "string" && p.errorMessage.trim()) {
        kv.error = p.errorMessage.length > 160 ? p.errorMessage.slice(0, 160) + "…" : p.errorMessage;
      }
      return { id: n.id, type, title: n.data.title, ...kv };
    });
  const edgeLines = edges
    .filter((e) => e.source !== excludeNodeId && e.target !== excludeNodeId)
    .map((e) => {
      const o: Record<string, unknown> = { from: e.source, to: e.target };
      if (e.sourceHandle && e.sourceHandle !== "output") o.fromHandle = e.sourceHandle;
      if (e.targetHandle && e.targetHandle !== "input") o.toHandle = e.targetHandle;
      return o;
    });
  if (nodeLines.length === 0 && edgeLines.length === 0) return "";
  const json = JSON.stringify({ nodes: nodeLines, edges: edgeLines });
  // Hard cap to stay well under the chat input's 20000-char graphSummary limit.
  return json.length > 18000 ? json.slice(0, 18000) : json;
}
