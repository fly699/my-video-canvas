import type { NodeType } from "../../../shared/types";

export const CONNECTION_MATRIX: Partial<Record<NodeType, NodeType[]>> = {
  // script → note：专业审查（Coverage）报告一键存为便签节点留档。
  script: ["storyboard", "prompt", "ai_chat", "character", "note"],
  // storyboard → audio：分镜的「对白/旁白」字段自动喂给下游音频节点作配音文案。
  storyboard: ["image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video", "comfyui_workflow", "audio"],
  prompt: ["image_gen", "video_task", "storyboard", "script", "comfyui_image", "comfyui_video", "comfyui_workflow"],
  character: ["storyboard", "image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video", "comfyui_workflow"],
  // image_gen → storyboard：精修工位回链——分镜「送精修」后图像节点连回分镜，
  // 出图仅作为「关键帧候选」供分镜显式点「采用此图」，无任何自动写入。
  image_gen: ["video_task", "asset", "clip", "pose_control", "character", "image_gen", "image_edit", "comfyui_video", "comfyui_workflow", "storyboard"],
  // image_edit 输出仍是一张图：可作 i2v 首帧、存素材、当角色/参考图、回链分镜关键帧、或再串一次编辑。
  image_edit: ["video_task", "asset", "clip", "pose_control", "character", "image_gen", "image_edit", "comfyui_video", "comfyui_workflow", "storyboard"],
  video_task: ["clip", "asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut"],
  // audio → audio: 把一段音频作为本地 VoxCPM 配音的参考音色喂给下游音频节点。
  // audio → comfyui_workflow: 作为自定义工作流的音频参数来源（VHS_LoadAudioUpload 等）。
  // audio → merge：合并节点自动把连入的音频节点用作整片背景音乐（MergeNode 的
  // detectedBgMusicUrl），智能体「整体配乐连入 merge」与手动拖线都走这条。
  audio: ["clip", "audio", "comfyui_workflow", "merge"],
  asset: ["image_gen", "image_edit", "video_task", "clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "pose_control", "character", "comfyui_image", "comfyui_video", "comfyui_workflow", "audio"],
  ai_chat: ["script", "storyboard", "prompt"],
  clip: ["asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut"],
  post_process: ["video_task", "image_gen", "asset"],
  // overlay → merge：叠加合成后的视频是一路视频源，可直接连入合并节点参与成片
  // （MergeNode 的 VIDEO_SOURCE_TYPES 已认 overlay 为视频源）。此前 overlay 仅允许
  // → asset，导致「叠加 → 合并」拖线与智能体建线判定失败。
  overlay: ["asset", "merge"],
  // subtitle / subtitle_motion → merge：字幕节点输出的「已挂字幕视频」可直接连入
  // 合并节点参与成片（MergeNode 的 VIDEO_SOURCE_TYPES 已认这两类为视频源）。配方
  // 「视频→字幕→合并」链路与手动拖线都走这条；此前缺失导致 字幕→合并 连线判定失败。
  subtitle: ["asset", "merge"],
  subtitle_motion: ["asset", "merge"],
  smart_cut: ["asset", "merge"],
  pose_control: ["image_gen", "image_edit", "asset"],
  // voice_clone / lip_sync / avatar are "即将上线" placeholders (no payload logic,
  // handles disabled) — keep them out of the matrix so we don't advertise
  // connections that can't actually be made. Restore their edges (see git
  // history) when the underlying API integration ships.
  voice_clone: [],
  lip_sync: [],
  avatar: [],
  // merge → merge：合并链——把若干子序列各自合并后再汇入一个总合并节点（MergeNode 的
  // VIDEO_SOURCE_TYPES 已认 merge 为视频源）。此前 merge 仅允许 → asset/clip，导致
  // 「合并 → 合并」串联与智能体建线判定失败。
  merge: ["asset", "clip", "merge"],
  comfyui_image: ["video_task", "asset", "clip", "pose_control", "character", "image_gen", "image_edit", "comfyui_image", "comfyui_video", "comfyui_workflow", "storyboard"],
  comfyui_video: ["clip", "asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "comfyui_image", "comfyui_video", "comfyui_workflow"],
  comfyui_workflow: ["video_task", "asset", "clip", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "character", "image_gen", "image_edit", "comfyui_workflow", "comfyui_image", "comfyui_video"],
  note: [],
  group: [],
  // The agent (Copilot) orchestrates by CREATING nodes via chat, not via edges —
  // it has no connection handles, so no outgoing graph connections.
  agent: [],
};

export const NOTE_TYPES: NodeType[] = ["note"];

export function getCompatibleTargets(sourceType: NodeType): NodeType[] {
  if (NOTE_TYPES.includes(sourceType)) {
    return Object.keys(CONNECTION_MATRIX) as NodeType[];
  }
  return CONNECTION_MATRIX[sourceType] ?? [];
}

export function getCompatibleSources(targetType: NodeType): NodeType[] {
  if (NOTE_TYPES.includes(targetType)) {
    return Object.keys(CONNECTION_MATRIX) as NodeType[];
  }
  return (Object.keys(CONNECTION_MATRIX) as NodeType[]).filter((src) => {
    const targets = CONNECTION_MATRIX[src];
    return targets != null && targets.includes(targetType);
  });
}

export function isConnectionValid(
  sourceType: NodeType | null,
  targetType: NodeType | null
): boolean {
  if (sourceType === null || targetType === null) return true;
  if (NOTE_TYPES.includes(sourceType) || NOTE_TYPES.includes(targetType)) return true;
  // The matrix is authoritative — it already omits same-type pairs that must not
  // self-chain (e.g. prompt→prompt) and explicitly lists the ones that should
  // (comfy 图像/视频/自定义 串并联). Self-loops on the *same node* are blocked
  // separately in Canvas's isValidConnection (source === target).
  const targets = CONNECTION_MATRIX[sourceType];
  return targets != null && targets.includes(targetType);
}

// 自动建边/自动连线（拖到空白处建节点、快捷创建下游节点、模板库放置等）时，目标节点
// 的默认「输入桩」id。绝大多数节点用 BaseNode 自带的单一 `input` 桩；唯独剪辑(clip)节点
// 用 showHandles={false} 自绘了两个独立输入 `video-in` / `audio-in`，并无 `input` 桩。
// 若自动连线沿用硬编码的 "input"，边会落到 clip 上不存在的桩 → ReactFlow 找不到该桩、
// 边无法渲染（表现为「创建了节点却没有连线」，而拖到其它节点正常）。这里按源类型分流：
// 音频源 → audio-in，其余（视频/素材等）→ video-in。其它目标类型一律沿用 `input`。
export function defaultTargetHandle(
  targetType: NodeType | undefined,
  sourceType?: NodeType | null,
): string {
  if (targetType === "clip") return sourceType === "audio" ? "audio-in" : "video-in";
  return "input";
}

export const CONNECTION_HINTS: Record<
  NodeType,
  { label: string; outgoing: string; incoming: string }
> = {
  script: {
    label: "脚本",
    outgoing: "→ 分镜 / 提示词 / AI对话 / 角色 / 便签(审查报告)",
    incoming: "← AI对话 / 提示词",
  },
  storyboard: {
    label: "分镜",
    outgoing: "→ 图像生成 / 视频任务 / 提示词 / 音频(对白配音)",
    incoming: "← 脚本 / 提示词 / 角色 / AI对话 / 图像生成(精修回填)",
  },
  prompt: {
    label: "提示词",
    outgoing: "→ 图像生成 / 视频任务 / 分镜 / 脚本",
    incoming: "← 脚本 / 分镜 / 角色 / AI对话",
  },
  character: {
    label: "角色/场景",
    outgoing: "→ 分镜 / 图像生成 / 视频任务 / 提示词",
    incoming: "← 脚本 / 素材 / 图像生成 / ComfyUI 图像 / ComfyUI 自定义（参考图）",
  },
  image_gen: {
    label: "图像生成",
    outgoing: "→ 视频任务 / 素材 / 剪辑 / 角色 / 图像生成（参考图）/ 分镜(关键帧候选)",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成 / ComfyUI 图像 / ComfyUI 自定义（参考图）",
  },
  video_task: {
    label: "视频任务",
    outgoing: "→ 剪辑 / 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑",
    incoming: "← 图像生成 / 分镜 / 提示词",
  },
  audio: {
    label: "音频",
    outgoing: "→ 剪辑 / 合并（整片配乐）/ 音频（作参考音色）/ ComfyUI 自定义（音频参数）",
    incoming: "← 分镜（对白→配音文案）/ 音频 / 素材（本地 VoxCPM 参考音色）",
  },
  asset: {
    label: "素材",
    outgoing: "→ 图像生成 / 视频任务 / 剪辑 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 构图控制 / 角色 / 音频（参考音色）",
    incoming: "← 图像生成 / 视频任务 / 剪辑 / 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 合并",
  },
  ai_chat: {
    label: "AI对话",
    outgoing: "→ 脚本 / 分镜 / 提示词",
    incoming: "← 脚本",
  },
  clip: {
    label: "剪辑",
    outgoing: "→ 素材（保存）",
    incoming: "← 视频任务 / 音频 / 素材",
  },
  note: {
    label: "便签",
    outgoing: "→ 任何节点（注释）",
    incoming: "← 任何节点",
  },
  post_process: {
    label: "后处理",
    outgoing: "→ 视频任务 / 图像生成 / 素材（效果注入）",
    incoming: "← 图像 / 视频 / 素材",
  },
  image_edit: {
    label: "图像编辑",
    outgoing: "→ 视频任务（i2v 首帧）/ 素材 / 角色 / 图像生成（参考图）/ 分镜（关键帧）/ 图像编辑（再串）",
    incoming: "← 图像生成 / ComfyUI 图像·自定义 / 素材 / 构图控制",
  },
  group: {
    label: "分组",
    outgoing: "容器节点，不参与数据流",
    incoming: "容器节点，不参与数据流",
  },
  merge: {
    label: "合并",
    outgoing: "→ 素材（保存）/ 合并（合并链）",
    incoming: "← 视频任务 / 剪辑 / 叠加 / 字幕 / 动态字幕 / 智能剪辑 / 合并 / ComfyUI 视频·自定义 / 素材 / 音频（整片配乐）",
  },
  subtitle: {
    label: "字幕",
    outgoing: "→ 素材（保存）/ 合并（成片）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  overlay: {
    label: "视频叠加",
    outgoing: "→ 素材（保存）/ 合并（成片）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  subtitle_motion: {
    label: "动态字幕",
    outgoing: "→ 素材（保存）/ 合并（成片）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  smart_cut: {
    label: "智能剪辑",
    outgoing: "→ 素材 / 合并",
    incoming: "← 视频任务 / 剪辑 / 素材",
  },
  pose_control: {
    label: "构图控制",
    outgoing: "→ 图像生成 / 素材",
    incoming: "← 图像生成 / 素材",
  },
  voice_clone: {
    label: "声音克隆",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  lip_sync: {
    label: "唇形同步",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  avatar: {
    label: "数字人",
    outgoing: "即将上线（暂不可连接）",
    incoming: "即将上线（暂不可连接）",
  },
  comfyui_image: {
    label: "ComfyUI 图像",
    outgoing: "→ 视频任务 / 素材 / 剪辑 / 构图控制 / ComfyUI 视频 / 角色",
    incoming: "← 分镜 / 提示词 / 角色 / 素材",
  },
  comfyui_video: {
    label: "ComfyUI 视频",
    outgoing: "→ 剪辑 / 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成 / ComfyUI 图像",
  },
  comfyui_workflow: {
    label: "ComfyUI 自定义",
    outgoing: "→ 视频任务 / 素材 / 剪辑 / 叠加 / 合并 / 字幕 / 角色",
    incoming: "← 分镜 / 提示词 / 角色 / 素材 / 图像生成",
  },
  agent: {
    label: "智能体",
    outgoing: "通过对话直接在画布生成节点（不经连线）",
    incoming: "对话式描述需求，自动编排工作流",
  },
};
