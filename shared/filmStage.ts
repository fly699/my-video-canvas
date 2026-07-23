// 成片阶段推导：从画布节点状态判断当前处在「规划 → 生成 → 装配 → 导出」哪一步，
// 给向导式推进条高亮当前步 + 提示下一步。纯函数、framework-free、可单测。
// 判定与画布真实数据同源：生成类节点是否存在 / 是否已有产物 / 是否有合并节点及其产物。

export type FilmStage = "plan" | "generate" | "assemble" | "export";

export interface FilmStageInfo {
  stage: FilmStage;
  /** 各里程碑是否达成（用于推进条把已完成步打勾）。 */
  hasGenNode: boolean;      // 已有生成类节点（规划已落地）
  hasAnyResult: boolean;    // 任一生成节点已出图/出片
  hasVideoResult: boolean;  // 已有视频产物（可装配）
  hasMergeNode: boolean;    // 已有合并/成片节点
  hasFilm: boolean;         // 合并节点已产出成片
  /** 面向用户的下一步提示（新手不迷路）。 */
  hint: string;
}

type StageNode = { data: { nodeType: string; payload?: Record<string, unknown> } };

const GEN_TYPES = new Set(["image_gen", "video_task", "storyboard", "comfyui_image", "comfyui_video", "comfyui_workflow", "character"]);
const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** 节点是否已产出结果（口径同 costEstimate 的 DONE_OUTPUT_FIELDS + image/character 图）。 */
function nodeHasResult(t: string, p: Record<string, unknown>): boolean {
  if (nonEmpty(p.resultVideoUrl)) return true;                    // video_task / comfyui_video / merge
  if (nonEmpty(p.outputUrl)) return true;                          // comfyui_workflow / image_edit
  if (nonEmpty(p.imageUrl)) return true;                           // image_gen / storyboard / comfyui_image
  if (Array.isArray(p.imageUrls) && p.imageUrls.some(nonEmpty)) return true;
  if (t === "character" && nonEmpty(p.referenceImageUrl)) return true;
  return false;
}

const MERGE_TYPES = new Set(["merge", "clip", "subtitle", "subtitle_motion", "overlay", "smart_cut"]);

/** 从画布节点推导成片阶段。空画布 → plan。 */
export function deriveFilmStage(nodes: StageNode[]): FilmStageInfo {
  let hasGenNode = false, hasAnyResult = false, hasVideoResult = false, hasMergeNode = false, hasFilm = false;
  for (const n of nodes) {
    const t = n.data.nodeType;
    const p = (n.data.payload ?? {}) as Record<string, unknown>;
    if (GEN_TYPES.has(t)) hasGenNode = true;
    if (MERGE_TYPES.has(t)) hasMergeNode = true;
    const done = nodeHasResult(t, p);
    if (done) {
      hasAnyResult = true;
      if ((t === "video_task" || t === "comfyui_video") && nonEmpty(p.resultVideoUrl)) hasVideoResult = true;
      if (MERGE_TYPES.has(t) && nonEmpty(p.resultVideoUrl)) hasFilm = true;
    }
  }
  let stage: FilmStage, hint: string;
  if (!hasGenNode) {
    stage = "plan";
    hint = "用画布助手一句话描述你想要的短片，或点「建立向导」搭建工作流。";
  } else if (!hasAnyResult) {
    stage = "generate";
    hint = "工作流已就位，逐个（或「运行全部」）触发生成节点出图/出片。";
  } else if (!hasFilm) {
    stage = hasVideoResult ? "assemble" : "generate";
    hint = hasVideoResult
      ? "镜头已出片，用合并节点按镜头表装配成片，可加转场/字幕/配乐。"
      : "已有图像产物，继续生成视频镜头，再进入装配。";
  } else {
    stage = "export";
    hint = "成片已合成，可放大预览、下载导出，或继续精修剪辑。";
  }
  return { stage, hasGenNode, hasAnyResult, hasVideoResult, hasMergeNode, hasFilm, hint };
}

/** 推进条四步的静态定义（顺序即流程）。 */
export const FILM_STAGES: { key: FilmStage; label: string }[] = [
  { key: "plan", label: "规划" },
  { key: "generate", label: "生成" },
  { key: "assemble", label: "装配" },
  { key: "export", label: "导出" },
];
