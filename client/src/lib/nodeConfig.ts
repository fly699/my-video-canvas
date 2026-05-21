import type { NodeType } from "../../../shared/types";

export interface NodeConfig {
  type: NodeType;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultTitle: string;
}

export const NODE_CONFIGS: Record<NodeType, NodeConfig> = {
  script: {
    type: "script",
    label: "脚本",
    icon: "FileText",
    color: "oklch(0.62 0.18 240)",
    bgColor: "oklch(0.62 0.18 240 / 0.08)",
    borderColor: "oklch(0.62 0.18 240 / 0.4)",
    defaultWidth: 380,
    defaultHeight: 320,
    defaultTitle: "新脚本",
  },
  storyboard: {
    type: "storyboard",
    label: "分镜",
    icon: "Image",
    color: "oklch(0.65 0.20 160)",
    bgColor: "oklch(0.65 0.20 160 / 0.08)",
    borderColor: "oklch(0.65 0.20 160 / 0.4)",
    defaultWidth: 340,
    defaultHeight: 400,
    defaultTitle: "分镜 #1",
  },
  prompt: {
    type: "prompt",
    label: "提示词",
    icon: "Wand2",
    color: "oklch(0.68 0.22 300)",
    bgColor: "oklch(0.68 0.22 300 / 0.08)",
    borderColor: "oklch(0.68 0.22 300 / 0.4)",
    defaultWidth: 340,
    defaultHeight: 280,
    defaultTitle: "提示词",
  },
  image_gen: {
    type: "image_gen",
    label: "图像生成",
    icon: "Sparkles",
    color: "oklch(0.72 0.20 330)",
    bgColor: "oklch(0.72 0.20 330 / 0.08)",
    borderColor: "oklch(0.72 0.20 330 / 0.4)",
    defaultWidth: 360,
    defaultHeight: 420,
    defaultTitle: "图像生成",
  },
  asset: {
    type: "asset",
    label: "素材",
    icon: "Paperclip",
    color: "oklch(0.65 0.18 60)",
    bgColor: "oklch(0.65 0.18 60 / 0.08)",
    borderColor: "oklch(0.65 0.18 60 / 0.4)",
    defaultWidth: 300,
    defaultHeight: 260,
    defaultTitle: "素材",
  },
  video_task: {
    type: "video_task",
    label: "视频任务",
    icon: "Video",
    color: "oklch(0.62 0.20 25)",
    bgColor: "oklch(0.62 0.20 25 / 0.08)",
    borderColor: "oklch(0.62 0.20 25 / 0.4)",
    defaultWidth: 380,
    defaultHeight: 360,
    defaultTitle: "视频生成",
  },
  ai_chat: {
    type: "ai_chat",
    label: "AI 对话",
    icon: "Bot",
    color: "oklch(0.70 0.18 200)",
    bgColor: "oklch(0.70 0.18 200 / 0.08)",
    borderColor: "oklch(0.70 0.18 200 / 0.4)",
    defaultWidth: 400,
    defaultHeight: 460,
    defaultTitle: "AI 助手",
  },
  note: {
    type: "note",
    label: "便签",
    icon: "StickyNote",
    color: "oklch(0.60 0.10 90)",
    bgColor: "oklch(0.60 0.10 90 / 0.08)",
    borderColor: "oklch(0.60 0.10 90 / 0.4)",
    defaultWidth: 260,
    defaultHeight: 180,
    defaultTitle: "便签",
  },
};

export const NODE_TYPE_LIST = Object.values(NODE_CONFIGS);

export function getNodeConfig(type: NodeType): NodeConfig {
  return NODE_CONFIGS[type];
}

export const COLLABORATOR_COLORS = [
  "oklch(0.72 0.18 280)",
  "oklch(0.65 0.22 300)",
  "oklch(0.65 0.20 160)",
  "oklch(0.62 0.18 240)",
  "oklch(0.62 0.20 25)",
  "oklch(0.70 0.18 200)",
  "oklch(0.65 0.18 60)",
];
