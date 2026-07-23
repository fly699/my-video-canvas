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
