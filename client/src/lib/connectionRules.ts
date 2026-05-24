import type { NodeType } from "../../../shared/types";

export const CONNECTION_MATRIX: Partial<Record<NodeType, NodeType[]>> = {
  script: ["storyboard", "prompt", "ai_chat", "character", "avatar"],
  storyboard: ["image_gen", "video_task", "prompt"],
  prompt: ["image_gen", "video_task", "storyboard", "script"],
  character: ["storyboard", "image_gen", "video_task", "prompt"],
  image_gen: ["video_task", "asset", "clip", "pose_control"],
  video_task: ["clip", "asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut", "lip_sync"],
  audio: ["clip", "lip_sync", "avatar"],
  asset: ["image_gen", "video_task", "clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "pose_control"],
  ai_chat: ["script", "storyboard", "prompt"],
  clip: ["asset", "overlay", "merge", "subtitle", "subtitle_motion", "smart_cut"],
  post_process: ["video_task", "image_gen", "asset"],
  overlay: ["asset"],
  subtitle: ["asset"],
  subtitle_motion: ["asset"],
  smart_cut: ["asset", "merge"],
  pose_control: ["image_gen", "asset"],
  voice_clone: ["asset", "clip", "lip_sync"],
  lip_sync: ["asset"],
  avatar: ["asset", "clip"],
  merge: ["asset"],
  note: [],
  group: [],
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
  if (sourceType === targetType) return false;
  const targets = CONNECTION_MATRIX[sourceType];
  return targets != null && targets.includes(targetType);
}

export const CONNECTION_HINTS: Record<
  NodeType,
  { label: string; outgoing: string; incoming: string }
> = {
  script: {
    label: "脚本",
    outgoing: "→ 分镜 / 提示词 / AI对话 / 角色",
    incoming: "← AI对话 / 提示词",
  },
  storyboard: {
    label: "分镜",
    outgoing: "→ 图像生成 / 视频任务 / 提示词",
    incoming: "← 脚本 / 提示词 / 角色 / AI对话",
  },
  prompt: {
    label: "提示词",
    outgoing: "→ 图像生成 / 视频任务 / 分镜 / 脚本",
    incoming: "← 脚本 / 分镜 / 角色 / AI对话",
  },
  character: {
    label: "角色/场景",
    outgoing: "→ 分镜 / 图像生成 / 视频任务 / 提示词",
    incoming: "← 脚本",
  },
  image_gen: {
    label: "图像生成",
    outgoing: "→ 视频任务 / 素材 / 剪辑",
    incoming: "← 分镜 / 提示词 / 角色 / 素材",
  },
  video_task: {
    label: "视频任务",
    outgoing: "→ 剪辑 / 素材 / 叠加 / 合并 / 字幕 / 动态字幕 / 智能剪辑 / 唇形同步",
    incoming: "← 图像生成 / 分镜 / 提示词",
  },
  audio: {
    label: "音频",
    outgoing: "→ 剪辑 / 唇形同步 / 数字人",
    incoming: "无上游连接",
  },
  asset: {
    label: "素材",
    outgoing: "→ 图像生成 / 视频任务 / 剪辑",
    incoming: "← 图像生成 / 视频任务 / 剪辑",
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
  group: {
    label: "分组",
    outgoing: "容器节点，不参与数据流",
    incoming: "容器节点，不参与数据流",
  },
  merge: {
    label: "合并",
    outgoing: "→ 素材（保存）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  subtitle: {
    label: "字幕",
    outgoing: "→ 素材（保存）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  overlay: {
    label: "视频叠加",
    outgoing: "→ 素材（保存）",
    incoming: "← 剪辑 / 视频任务 / 素材",
  },
  subtitle_motion: {
    label: "动态字幕",
    outgoing: "→ 素材（保存）",
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
    outgoing: "→ 素材 / 剪辑 / 唇形同步",
    incoming: "无上游连接",
  },
  lip_sync: {
    label: "唇形同步",
    outgoing: "→ 素材（保存）",
    incoming: "← 视频任务 / 音频 / 声音克隆",
  },
  avatar: {
    label: "数字人",
    outgoing: "→ 素材 / 剪辑",
    incoming: "← 脚本 / 音频",
  },
};
