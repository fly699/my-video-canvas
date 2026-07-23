// 优化B 镜头表预览卡：规划落地前把 operations 里「会建节点」的 create 抽成可勾选的
// 预览行；用户取消勾选某些后，按选择筛掉对应 create + 引用它们的 connect/update/delete。
// 纯函数、framework-free、可单测。落地仍复用同一个 applyAgentOperations，只是喂筛后的 ops。
import type { AgentOperation } from "./types";

export interface ShotPreviewRow {
  /** 本批 create 的 tempId（勾选/筛选的键）。 */
  tempId: string;
  nodeType: string;
  /** 展示用标题（op.title → 类型中文名 → nodeType）。 */
  title: string;
  /** 镜头表字段（分镜/视频镜头才有）。 */
  sceneNumber?: number;
  shotType?: string;
  duration?: number;
  /** 画幅比例（aspectRatio → aspect），用于连续性「比例是否统一」检测。 */
  aspect?: string;
  /** 提示词摘要（promptText → prompt → description）。 */
  promptText?: string;
  dialogue?: string;
}

const TYPE_LABEL: Record<string, string> = {
  storyboard: "分镜", video_task: "视频", image_gen: "图像", comfyui_video: "ComfyUI视频",
  comfyui_image: "ComfyUI图像", comfyui_workflow: "ComfyUI工作流", character: "角色",
  audio: "音频", merge: "合并", clip: "剪辑", script: "脚本", prompt: "提示词", note: "便签",
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** 从规划 operations 抽出「可勾选落地」的 create 行（有 tempId 的建节点操作）。
 *  有 sceneNumber 的按镜号升序排在前，其余保持原顺序追加在后（镜头表读感更自然）。 */
export function previewableCreates(ops: AgentOperation[]): ShotPreviewRow[] {
  const withScene: ShotPreviewRow[] = [];
  const rest: ShotPreviewRow[] = [];
  for (const o of ops) {
    if (o.op !== "create" || !o.tempId) continue;
    const p = (o.payload ?? {}) as Record<string, unknown>;
    const nt = o.nodeType ?? "";
    const row: ShotPreviewRow = {
      tempId: o.tempId,
      nodeType: nt,
      title: o.title || TYPE_LABEL[nt] || nt || "节点",
      sceneNumber: num(p.sceneNumber),
      shotType: str(p.shotType),
      duration: num(p.duration),
      aspect: str(p.aspectRatio) ?? str(p.aspect),
      promptText: str(p.promptText) ?? str(p.prompt) ?? str(p.description),
      dialogue: str(p.dialogue),
    };
    (row.sceneNumber !== undefined ? withScene : rest).push(row);
  }
  withScene.sort((a, b) => (a.sceneNumber! - b.sceneNumber!));
  return [...withScene, ...rest];
}

/** 按取消勾选集（deselected = 不落地的 tempId）筛掉操作：去掉被取消的 create +
 *  任何 sourceRef/targetRef 指向它们的 connect/update/delete。纯函数。
 *  canvas/group/align 等全局动作不按 tempId 剔除（缺失成员由 applyAgentOperations 容错）。 */
export function filterPlanBySelection(ops: AgentOperation[], deselected: ReadonlySet<string>): AgentOperation[] {
  if (!deselected || deselected.size === 0) return ops;
  return ops.filter((o) => {
    if (o.op === "create" && o.tempId && deselected.has(o.tempId)) return false;
    if (o.op === "connect" && ((o.sourceRef && deselected.has(o.sourceRef)) || (o.targetRef && deselected.has(o.targetRef)))) return false;
    if ((o.op === "update" || o.op === "delete") && o.targetRef && deselected.has(o.targetRef)) return false;
    return true;
  });
}

// ── 优化① 连续性告警：落地前的纯规则体检（不调 LLM，逐行给可操作提示）。─────────────
/** 需要提示词描述画面的节点类型（工作流靠图节点参数，不在此列）。 */
const VISUAL_TYPES = new Set(["image_gen", "video_task", "storyboard", "comfyui_image", "comfyui_video"]);
const MAX_REASONABLE_DURATION = 30; // 单镜超过 30s 视为偏长（多数模型上限内）
const MIN_PROMPT_LEN = 6;           // 提示词短于此判「过简」

/** 对预览行做连续性/质量体检，返回 { tempId: [告警文案…] }（只含有告警的行）。
 *  规则：①比例混用（本批出现>1 种画幅 → 涉及行标注）②时长缺失/异常/偏长（仅视频镜）
 *  ③提示词过简（画面类节点）。全部为纯规则，可穷尽单测。 */
export function planContinuityWarnings(rows: ShotPreviewRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const push = (id: string, msg: string) => { (out[id] ??= []).push(msg); };
  const aspects = new Set<string>();
  for (const r of rows) if (r.aspect) aspects.add(r.aspect);
  const mixedAspect = aspects.size > 1;
  for (const r of rows) {
    if (mixedAspect && r.aspect) push(r.tempId, `比例不统一（${r.aspect}）`);
    if (r.nodeType === "video_task") {
      if (r.duration === undefined) push(r.tempId, "未设时长（将用默认）");
      else if (r.duration <= 0) push(r.tempId, "时长异常（≤0s）");
      else if (r.duration > MAX_REASONABLE_DURATION) push(r.tempId, `时长偏长（${r.duration}s）`);
    }
    if (VISUAL_TYPES.has(r.nodeType)) {
      const p = r.promptText?.trim() ?? "";
      if (p.length < MIN_PROMPT_LEN) push(r.tempId, "提示词过简，建议补充画面细节");
    }
  }
  return out;
}

/** 一条连线预览：源节点标题 → 目标节点标题（tempId 解析不到时回退显示 ref 本身）。 */
export interface EdgePreview { from: string; to: string; }

/** 从 operations 抽出「连线预览」：每条 connect 解析成 源标题→目标标题。
 *  tempId → 标题映射用本批 create 的 title（同 previewableCreates 口径），跨批引用回退显示 ref。 */
export function previewableEdges(ops: AgentOperation[]): EdgePreview[] {
  const titleOf = new Map<string, string>();
  for (const o of ops) {
    if (o.op !== "create" || !o.tempId) continue;
    const nt = o.nodeType ?? "";
    titleOf.set(o.tempId, o.title || TYPE_LABEL[nt] || nt || "节点");
  }
  const out: EdgePreview[] = [];
  for (const o of ops) {
    if (o.op !== "connect" || !o.sourceRef || !o.targetRef) continue;
    out.push({ from: titleOf.get(o.sourceRef) ?? o.sourceRef, to: titleOf.get(o.targetRef) ?? o.targetRef });
  }
  return out;
}

/** 把一批 operations 转成可读的镜头表大纲文本（含镜号/景别/时长/提示词/台词 + 连线），
 *  供「复制编排」一键拷贝给外部记录/交接。纯函数。 */
export function planOutline(ops: AgentOperation[]): string {
  const rows = previewableCreates(ops);
  const edges = previewableEdges(ops);
  const lines = [`镜头表（${rows.length} 个节点）`];
  for (const r of rows) {
    const scene = r.sceneNumber !== undefined ? `镜${r.sceneNumber} ` : "";
    const meta = [r.shotType, r.duration !== undefined ? `${r.duration}s` : ""].filter(Boolean).join(" ");
    lines.push(`- ${scene}${r.title}${meta ? `（${meta}）` : ""}${r.promptText ? `：${r.promptText}` : ""}${r.dialogue ? ` 💬${r.dialogue}` : ""}`);
  }
  if (edges.length) {
    lines.push("连线：");
    for (const e of edges) lines.push(`- ${e.from} → ${e.to}`);
  }
  return lines.join("\n");
}

/** 把预览行导出为 CSV 文本（表头中文、逐字段转义），供「导出镜头表」下载。纯函数。 */
export function shotRowsToCsv(rows: ShotPreviewRow[]): string {
  const esc = (v: unknown): string => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["镜号", "标题", "类型", "景别", "时长(s)", "比例", "提示词", "台词"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.sceneNumber ?? "", r.title, TYPE_LABEL[r.nodeType] ?? r.nodeType,
      r.shotType ?? "", r.duration ?? "", r.aspect ?? "", r.promptText ?? "", r.dialogue ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\r\n");
}
