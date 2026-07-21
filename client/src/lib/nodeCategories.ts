import type { NodeType } from "../../../shared/types";

/**
 * Grouping for the bottom NodePicker palette. Categories render in this order;
 * within each, types render in the listed order. Every NodeType must appear in
 * exactly one category (guarded by a test) so nothing silently disappears from
 * the picker when a new node type is added.
 */
export interface NodeCategory {
  id: string;
  label: string;
  types: NodeType[];
}

export const NODE_CATEGORIES: NodeCategory[] = [
  { id: "director", label: "导演台 · NEW", types: ["director"] },
  { id: "ai", label: "AI 编排", types: ["agent", "super_agent"] },
  { id: "create", label: "创作 / 脚本", types: ["script", "storyboard", "prompt", "character", "ai_chat"] },
  { id: "image", label: "图像生成", types: ["image_gen", "image_edit", "pose_control"] },
  { id: "video", label: "视频生成", types: ["video_task"] },
  { id: "comfyui", label: "ComfyUI", types: ["comfyui_image", "comfyui_video", "comfyui_workflow"] },
  { id: "audio", label: "音频 / 配音", types: ["audio", "voice_clone", "lip_sync", "avatar"] },
  { id: "edit", label: "剪辑 / 合成", types: ["clip", "merge", "smart_cut", "subtitle", "subtitle_motion", "overlay", "post_process"] },
  { id: "util", label: "素材 / 工具", types: ["asset", "note", "compare", "group"] },
];

/** Category id for a node type (or "util" as a safe fallback). */
export function categoryOf(type: NodeType): string {
  return NODE_CATEGORIES.find((c) => c.types.includes(type))?.id ?? "util";
}

/**
 * #93 主流程快捷区：成片生产的主干管线，按创作顺序排列，置顶展示在
 * NodePicker「全部节点」分组之前。这里只是快捷入口——每个类型仍出现在
 * 上面所属分类里（与「最近使用」同理，允许重复出现）。
 */
export const MAIN_FLOW_TYPES: NodeType[] = [
  "script",      // 剧本
  "storyboard",  // 分镜
  "character",   // 角色
  "image_gen",   // 生图
  "video_task",  // 生视频
  "audio",       // 配音
  "merge",       // 合并成片
];
