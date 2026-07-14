// 新建画布「建立向导」(#159) 的纯规划器：把用户分步选择编译成一串 AgentOperation（建节点 + 连线），
// 交给 applyAgentOperations 落地；再按功能分区自动群组化。纯函数，便于单测。
import type { AgentOperation, NodeType } from "../../../shared/types";

export type WizardGoal = "film" | "images" | "video" | "audio";
export type WizardSource = "cloud" | "comfy";

export interface WizardChoices {
  goal: WizardGoal;
  aspect: string;            // 16:9 / 9:16 / 1:1 …（空=不指定）
  style: string;             // 风格前缀（空=不加）
  shots: number;             // 镜头/张数
  durationSec: number;       // 每镜时长（视频用）
  source: WizardSource;      // 画面来源：云端 / 自建 ComfyUI
  imageFirst: boolean;       // 生图 → 再图生视频
  addMusic: boolean;         // 配乐
  addSubtitle: boolean;      // 字幕
  addVoice: boolean;         // 配音（旁白）
  useStoryboard: boolean;    // 用分镜节点承载（否则逐镜 prompt 节点）
  addMerge: boolean;         // 合成成片
  // ── 生成模型/模板（#159 增强）──
  imageModel?: string;       // 云端来源：生图模型（写入 image_gen.model / storyboard.imageModel）
  videoProvider?: string;    // 云端来源：生视频模型（写入 video_task.provider）
  comfyImagePayload?: Record<string, unknown>; // 自建来源：选中的 ComfyUI 生图模版 payload（并入 comfyui_image 节点）
  comfyVideoPayload?: Record<string, unknown>; // 自建来源：选中的 ComfyUI 生视频模版 payload（并入 comfyui_video 节点）
}

export const WIZARD_DEFAULT: WizardChoices = {
  goal: "film", aspect: "16:9", style: "", shots: 4, durationSec: 5, source: "cloud",
  imageFirst: true, addMusic: true, addSubtitle: false, addVoice: false, useStoryboard: true, addMerge: true,
};

const clampShots = (n: number) => Math.max(1, Math.min(30, Math.round(n || 1)));
const stylePrefix = (s: string) => (s.trim() ? `${s.trim()}, ` : "");

function imageNodeType(source: WizardSource): NodeType { return source === "comfy" ? "comfyui_image" : "image_gen"; }
function videoNodeType(source: WizardSource): NodeType { return source === "comfy" ? "comfyui_video" : "video_task"; }

/** 生图节点 payload：云端 image_gen 写 model；自建 comfyui_image 并入选中模版 payload。 */
function imagePayload(c: WizardChoices, base: Record<string, unknown>): Record<string, unknown> {
  if (c.source === "comfy") return { ...(c.comfyImagePayload ?? {}), ...base };
  return c.imageModel ? { ...base, model: c.imageModel } : base;
}
/** 生视频节点 payload：云端 video_task 写 provider；自建 comfyui_video 并入选中模版 payload。 */
function videoPayload(c: WizardChoices, base: Record<string, unknown>): Record<string, unknown> {
  if (c.source === "comfy") return { ...(c.comfyVideoPayload ?? {}), ...base };
  return c.videoProvider ? { ...base, provider: c.videoProvider } : base;
}

/** 把向导选择编译为画布操作（create + connect）。纯函数。 */
export function buildWizardOps(c: WizardChoices): AgentOperation[] {
  const ops: AgentOperation[] = [];
  const shots = clampShots(c.shots);
  const aspect = c.aspect.trim();
  const withAspectImg = (p: Record<string, unknown>) => (aspect ? { ...p, aspectRatio: aspect } : p);

  // 只音频：单音频节点（配乐或配音）。
  if (c.goal === "audio") {
    ops.push({ op: "create", nodeType: "audio", tempId: "a1", title: "音频", payload: c.addVoice ? { audioCategory: "tts", ttsText: "" } : { audioCategory: "music", musicPrompt: stylePrefix(c.style) + "background music" }, note: "音频生成" });
    return ops;
  }

  // 只出图：N 个图像节点（可选一个脚本/角色统领）。
  if (c.goal === "images") {
    const imgType = imageNodeType(c.source);
    for (let i = 1; i <= shots; i++) {
      ops.push({ op: "create", nodeType: imgType, tempId: `img${i}`, title: `图 ${i}`, payload: imagePayload(c, withAspectImg({ prompt: stylePrefix(c.style) })), note: `第 ${i} 张` });
    }
    return ops;
  }

  // 完整短片 / 只出视频：脚本 → 分镜(或逐镜 prompt) → 生图 →（图生视频）→ 合成 (+配乐/字幕/配音)。
  ops.push({ op: "create", nodeType: "script", tempId: "script", title: "剧本", payload: { synopsis: "", aiSceneCount: shots, ...(aspect ? { aiAspectRatio: aspect } : {}), ...(c.style ? { aiStyle: c.style } : {}) }, note: "剧本/大纲" });

  const imgType = imageNodeType(c.source);
  const vidType = videoNodeType(c.source);
  const isFilm = c.goal === "film";
  const wantVideo = isFilm || c.goal === "video";
  const perShotImage = c.imageFirst; // 先生图（images 目标已在上方提前返回）

  const mergeInputs: string[] = [];
  for (let i = 1; i <= shots; i++) {
    // 分镜承载：storyboard 或 prompt。
    const carrierType: NodeType = c.useStoryboard ? "storyboard" : "prompt";
    const carrierId = `sb${i}`;
    ops.push({
      op: "create", nodeType: carrierType, tempId: carrierId, title: `镜 ${i}`,
      payload: c.useStoryboard
        ? { sceneNumber: i, description: "", duration: c.durationSec, ...(aspect ? { aspectRatio: aspect } : {}) }
        : { positivePrompt: stylePrefix(c.style), ...(aspect ? { aspectRatio: aspect } : {}) },
      note: `第 ${i} 镜`,
    });
    ops.push({ op: "connect", sourceRef: "script", targetRef: carrierId });

    let tail = carrierId; // 链尾（连到 merge / 下游）
    if (perShotImage) {
      const imgId = `img${i}`;
      ops.push({ op: "create", nodeType: imgType, tempId: imgId, title: `图 ${i}`, payload: imagePayload(c, withAspectImg({ prompt: stylePrefix(c.style) })), note: `第 ${i} 镜出图` });
      ops.push({ op: "connect", sourceRef: carrierId, targetRef: imgId });
      tail = imgId;
    }
    if (wantVideo) {
      const vidId = `vid${i}`;
      ops.push({ op: "create", nodeType: vidType, tempId: vidId, title: `视频 ${i}`, payload: videoPayload(c, { prompt: stylePrefix(c.style), ...(c.durationSec ? { duration: c.durationSec } : {}) }), note: `第 ${i} 镜生视频` });
      ops.push({ op: "connect", sourceRef: tail, targetRef: vidId });
      tail = vidId;
    }
    mergeInputs.push(tail);
  }

  // 配音（旁白）+ 配乐：音频节点。
  if (c.addVoice) ops.push({ op: "create", nodeType: "audio", tempId: "voice", title: "配音", payload: { audioCategory: "tts", ttsText: "" }, note: "旁白配音" });
  if (c.addMusic) ops.push({ op: "create", nodeType: "audio", tempId: "music", title: "配乐", payload: { audioCategory: "music", musicPrompt: stylePrefix(c.style) + "background music" }, note: "背景音乐" });

  // 合成成片：把各镜末端 + 音频接入 merge。
  if (c.addMerge && (mergeInputs.length > 0)) {
    ops.push({ op: "create", nodeType: "merge", tempId: "merge", title: "合成成片", payload: {}, note: "装配成片" });
    for (const ref of mergeInputs) ops.push({ op: "connect", sourceRef: ref, targetRef: "merge" });
    if (c.addVoice) ops.push({ op: "connect", sourceRef: "voice", targetRef: "merge" });
    if (c.addMusic) ops.push({ op: "connect", sourceRef: "music", targetRef: "merge" });
    if (c.addSubtitle) {
      ops.push({ op: "create", nodeType: "subtitle", tempId: "sub", title: "字幕", payload: {}, note: "字幕" });
      ops.push({ op: "connect", sourceRef: "merge", targetRef: "sub" });
    }
  }
  return ops;
}

// ── 功能分区自动群组化：按节点类型归入功能组 ──────────────────────────────────
export type FnGroupKey = "script" | "storyboard" | "character" | "image" | "video" | "audio" | "compose";
const GROUP_META: Record<FnGroupKey, { title: string }> = {
  script: { title: "📝 剧本" }, storyboard: { title: "🎬 分镜" }, character: { title: "👤 角色" },
  image: { title: "🖼️ 生图" }, video: { title: "🎞️ 生视频" }, audio: { title: "🔊 音频" }, compose: { title: "🎬 合成" },
};
const TYPE_TO_GROUP: Partial<Record<NodeType, FnGroupKey>> = {
  script: "script", storyboard: "storyboard", prompt: "storyboard", character: "character",
  image_gen: "image", comfyui_image: "image", comfyui_workflow: "image",
  video_task: "video", comfyui_video: "video",
  audio: "audio",
  merge: "compose", subtitle: "compose", subtitle_motion: "compose", clip: "compose",
};

/** 把新建节点按功能分组：返回 [{title, ids}]，每组 ≥2 个才值得成组（单节点不建组框）。纯函数。 */
export function groupCreatedByFunction(
  createdIds: string[],
  typeOf: (id: string) => NodeType | undefined,
): { key: FnGroupKey; title: string; ids: string[] }[] {
  const buckets = new Map<FnGroupKey, string[]>();
  for (const id of createdIds) {
    const t = typeOf(id);
    const g = t ? TYPE_TO_GROUP[t] : undefined;
    if (!g) continue;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(id);
  }
  const order: FnGroupKey[] = ["script", "storyboard", "character", "image", "video", "audio", "compose"];
  return order
    .filter((k) => (buckets.get(k)?.length ?? 0) >= 2)
    .map((k) => ({ key: k, title: GROUP_META[k].title, ids: buckets.get(k)! }));
}
