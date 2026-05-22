import type { NodeType } from "../../../shared/types";

export const CONNECTION_MATRIX: Partial<Record<NodeType, NodeType[]>> = {
  script: ["storyboard", "prompt", "ai_chat", "character"],
  storyboard: ["image_gen", "video_task", "prompt"],
  prompt: ["image_gen", "video_task", "storyboard", "script"],
  character: ["storyboard", "image_gen", "video_task", "prompt"],
  image_gen: ["video_task", "asset", "clip"],
  video_task: ["clip", "asset"],
  audio: ["clip"],
  asset: ["image_gen", "video_task", "clip"],
  ai_chat: ["script", "storyboard", "prompt"],
  clip: ["asset"],
  post_process: ["video_task", "image_gen", "asset"],
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
  if (sourceType === targetType) return false;
  if (NOTE_TYPES.includes(sourceType) || NOTE_TYPES.includes(targetType)) return true;
  const targets = CONNECTION_MATRIX[sourceType];
  return targets != null && targets.includes(targetType);
}

export const CONNECTION_HINTS: Record<
  NodeType,
  { label: string; outgoing: string; incoming: string }
> = {
  script: {
    label: "脚本",
    outgoing: "→ 分镖 / 提示词 / AI对话 / 角色",
    incoming: "← AI对话 / 提示词",
  },
  storyboard: {
    label: "分镖",
    outgoing: "→ 图像生成 / 视频任务 / 提示词",
    incoming: "← 脚本 / 提示词 / 角色 / AI对话",
  },
  prompt: {
    label: "提示词",
    outgoing: "→ 图像生成 / 视频任务 / 分镖 / 脚本",
    incoming: "← 脚本 / 分镖 / 角色 / AI对话",
  },
  character: {
    label: "角色/场景",
    outgoing: "→ 分镖 / 图像生成 / 视频任务 / 提示词",
    incoming: "← 脚本",
  },
  image_gen: {
    label: "图像生成",
    outgoing: "→ 视频任务 / 素材 / 剪辑",
    incoming: "← 分镖 / 提示词 / 角色 / 素材",
  },
  video_task: {
    label: "视频任务",
    outgoing: "→ 剪辑 / 素材",
    incoming: "← 图像生成 / 分镖 / 提示词",
  },
  audio: {
    label: "音频",
    outgoing: "→ 剪辑（混音）",
    incoming: "无上游连接",
  },
  asset: {
    label: "素材",
    outgoing: "→ 图像生成 / 视频任务 / 剪辑",
    incoming: "← 图像生成 / 视频任务 / 剪辑",
  },
  ai_chat: {
    label: "AI对话",
    outgoing: "→ 脚本 / 分镖 / 提示词",
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
};
