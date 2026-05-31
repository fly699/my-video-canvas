import { useCallback, useState, useMemo } from "react";
import { toast } from "sonner";
import { X, Search, Zap, BookmarkPlus, Trash2, ArrowLeft, Check, Clapperboard, Lightbulb, Sparkles, LayoutGrid, Film, Play, Video, Scale, Megaphone, Mic, ShoppingBag, Bot, Rocket, FolderOpen, Star, Bookmark, Briefcase, Target, Flame, Sun, Palette, Layers, Trophy, Grid2x2, Smartphone, Scissors, AudioLines, type LucideIcon } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import type { NodeType, NodeData } from "../../../../shared/types";

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Clapperboard, Lightbulb, Sparkles, LayoutGrid, Film, Play, Video,
  Scale, Megaphone, Mic, ShoppingBag, Bot, Rocket, FolderOpen,
  Star, Bookmark, Briefcase, Target, Flame, Sun, Palette, Layers,
  Trophy, Grid2x2, Search, Zap,
  Smartphone, Scissors, AudioLines,
};

function TemplateIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = TEMPLATE_ICONS[name];
  if (Icon) return <Icon style={{ width: size, height: size }} />;
  return <span style={{ fontSize: size * 0.9 }}>{name}</span>;
}

// ── Template data types ───────────────────────────────────────────────────────

interface TemplateNodeSpec {
  type: NodeType;
  dx: number;
  dy: number;
  count?: number;
  spacing?: number;
  title?: string;
  initialData?: Partial<NodeData>;
}

interface TemplateEdgeSpec {
  fromIndex: number;
  toIndex: number;
}

interface Template {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: "starter" | "image" | "video" | "ai" | "custom";
  nodes: TemplateNodeSpec[];
  edgeSpecs?: TemplateEdgeSpec[];
  isCustom?: boolean;
  createdAt?: string;
}

// ── Template definitions ──────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  // ── Starter ──────────────────────────────────────────────────────────────
  {
    id: "single-shot",
    name: "单镜头视频",
    desc: "脚本 → 分镜 → 图像 → 视频，最简单的完整流程",
    icon: "Clapperboard",
    category: "starter",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "脚本" },
      { type: "storyboard", dx: 0,    dy: 380,  title: "分镜 #1", initialData: { description: "描述这个场景的视觉内容", duration: 5, cameraMovement: "static", lens: "标准 50mm", colorTone: "自然真实" } },
      { type: "image_gen",  dx: 0,    dy: 730,  title: "图像生成", initialData: { aspectRatio: "16:9" } },
      { type: "video_task", dx: 0,    dy: 1080, title: "视频生成" },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 2, toIndex: 3 },
    ],
  },
  {
    id: "quick-brainstorm",
    name: "创意工作区",
    desc: "便签 + AI 对话 + 脚本，适合头脑风暴与创意起草",
    icon: "Lightbulb",
    category: "starter",
    nodes: [
      { type: "note",    dx: -480, dy: 0,   title: "创意灵感", initialData: { content: "在这里记录创意想法..." } },
      { type: "ai_chat", dx: 0,    dy: 0,   title: "AI 创作助手", initialData: { systemPrompt: "你是一位专业的视频创作顾问，帮助用户开发剧本创意、分析故事结构并优化视觉表达。" } },
      { type: "script",  dx: 480,  dy: 0,   title: "脚本" },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
  },
  {
    id: "prompt-to-image",
    name: "提示词生图",
    desc: "提示词节点驱动图像生成，快速迭代视觉方案",
    icon: "Sparkles",
    category: "starter",
    nodes: [
      { type: "prompt",    dx: 0,    dy: 0,   title: "提示词", initialData: { positivePrompt: "高质量摄影，电影级光线，专业构图", negativePrompt: "模糊，失真，噪点，低质量", aspectRatio: "16:9" } },
      { type: "image_gen", dx: -200, dy: 380, title: "图像 A", initialData: { aspectRatio: "16:9" } },
      { type: "image_gen", dx: 220,  dy: 380, title: "图像 B", initialData: { aspectRatio: "16:9" } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
    ],
  },

  // ── Image ─────────────────────────────────────────────────────────────────
  {
    id: "image-batch",
    name: "批量图像生成",
    desc: "一个提示词驱动 4 个并行图像生成节点，对比效果",
    icon: "LayoutGrid",
    category: "image",
    nodes: [
      { type: "prompt",    dx: 0,    dy: 0,   title: "主提示词", initialData: { positivePrompt: "高质量摄影，电影级光线，专业构图", negativePrompt: "模糊，失真，低质量", aspectRatio: "16:9" } },
      { type: "image_gen", dx: -570, dy: 380, title: "图像 1", initialData: { aspectRatio: "16:9" } },
      { type: "image_gen", dx: -190, dy: 380, title: "图像 2", initialData: { aspectRatio: "16:9" } },
      { type: "image_gen", dx: 190,  dy: 380, title: "图像 3", initialData: { aspectRatio: "16:9" } },
      { type: "image_gen", dx: 570,  dy: 380, title: "图像 4", initialData: { aspectRatio: "16:9" } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 0, toIndex: 4 },
    ],
  },
  {
    id: "storyboard-series",
    name: "连续分镜生成",
    desc: "脚本自动生成 4 格分镜，每格独立出图",
    icon: "Film",
    category: "image",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,   title: "故事脚本" },
      { type: "storyboard", dx: -570, dy: 400, title: "分镜 #1", initialData: { sceneNumber: 1, description: "开场镜头，建立场景氛围", cameraMovement: "static",   duration: 4, colorTone: "冷色调，蓝灰",   lens: "广角 24mm" } },
      { type: "storyboard", dx: -190, dy: 400, title: "分镜 #2", initialData: { sceneNumber: 2, description: "情节发展，推进故事",   cameraMovement: "pan-right", duration: 4, colorTone: "自然真实",       lens: "标准 50mm" } },
      { type: "storyboard", dx: 190,  dy: 400, title: "分镜 #3", initialData: { sceneNumber: 3, description: "高潮时刻，情感爆发",   cameraMovement: "zoom-in",   duration: 4, colorTone: "高饱和，鲜艳",   lens: "标准 50mm" } },
      { type: "storyboard", dx: 570,  dy: 400, title: "分镜 #4", initialData: { sceneNumber: 4, description: "结尾画面，留有余韵",   cameraMovement: "static",    duration: 4, colorTone: "低饱和，电影感", lens: "长焦 85mm" } },
      { type: "image_gen",  dx: -570, dy: 780, title: "图像 1" },
      { type: "image_gen",  dx: -190, dy: 780, title: "图像 2" },
      { type: "image_gen",  dx: 190,  dy: 780, title: "图像 3" },
      { type: "image_gen",  dx: 570,  dy: 780, title: "图像 4" },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 0, toIndex: 4 },
      { fromIndex: 1, toIndex: 5 },
      { fromIndex: 2, toIndex: 6 },
      { fromIndex: 3, toIndex: 7 },
      { fromIndex: 4, toIndex: 8 },
    ],
  },

  // ── Video ─────────────────────────────────────────────────────────────────
  {
    id: "image-to-video",
    name: "图像转视频",
    desc: "生成参考图后直接驱动多个视频模型，快速对比",
    icon: "Play",
    category: "video",
    nodes: [
      { type: "image_gen",  dx: 0,    dy: 0,   title: "参考图生成", initialData: { aspectRatio: "16:9" } },
      { type: "video_task", dx: -420, dy: 380, title: "视频 A" },
      { type: "video_task", dx: 0,    dy: 380, title: "视频 B" },
      { type: "video_task", dx: 420,  dy: 380, title: "视频 C" },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
    ],
  },
  {
    id: "short-film",
    name: "短片制作流程",
    desc: "脚本 → 3 分镜 → 3 图像 → 3 视频 → 合并，完整短片工作流",
    icon: "Video",
    category: "video",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 400,  title: "分镜 #1", initialData: { sceneNumber: 1, description: "开场，建立故事世界观与氛围", cameraMovement: "static",   duration: 5, lens: "广角 24mm", colorTone: "冷色调，蓝灰"   } },
      { type: "storyboard", dx: 0,    dy: 400,  title: "分镜 #2", initialData: { sceneNumber: 2, description: "主体，情节推进与冲突展开",   cameraMovement: "pan-right", duration: 5, lens: "标准 50mm", colorTone: "自然真实"       } },
      { type: "storyboard", dx: 420,  dy: 400,  title: "分镜 #3", initialData: { sceneNumber: 3, description: "结尾，情感收束与余韵留白",   cameraMovement: "zoom-out",  duration: 5, lens: "长焦 85mm", colorTone: "暖色调，橙金"   } },
      { type: "image_gen",  dx: -420, dy: 780,  title: "图像 1" },
      { type: "image_gen",  dx: 0,    dy: 780,  title: "图像 2" },
      { type: "image_gen",  dx: 420,  dy: 780,  title: "图像 3" },
      { type: "video_task", dx: -420, dy: 1160, title: "视频 1" },
      { type: "video_task", dx: 0,    dy: 1160, title: "视频 2" },
      { type: "video_task", dx: 420,  dy: 1160, title: "视频 3" },
      { type: "merge",      dx: 0,    dy: 1540, title: "合并剪辑", initialData: { transition: "fade", bgMusicVolume: 0.25 } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 1, toIndex: 4 },
      { fromIndex: 2, toIndex: 5 },
      { fromIndex: 3, toIndex: 6 },
      { fromIndex: 4, toIndex: 7 },
      { fromIndex: 5, toIndex: 8 },
      { fromIndex: 6, toIndex: 9 },
      { fromIndex: 7, toIndex: 10 },
      { fromIndex: 8, toIndex: 10 },
      { fromIndex: 9, toIndex: 10 },
    ],
  },
  {
    id: "video-compare",
    name: "视频模型对比",
    desc: "同一提示词同时提交多个视频模型，对比生成效果",
    icon: "Scale",
    category: "video",
    nodes: [
      { type: "prompt",     dx: 0,    dy: 0,   title: "视频提示词", initialData: { positivePrompt: "电影级动态镜头，高质量画面", negativePrompt: "模糊，抖动，失真，低质量", aspectRatio: "16:9" } },
      { type: "image_gen",  dx: 0,    dy: 380, title: "参考图", initialData: { aspectRatio: "16:9" } },
      { type: "video_task", dx: -420, dy: 760, title: "视频 · 模型 A" },
      { type: "video_task", dx: 0,    dy: 760, title: "视频 · 模型 B" },
      { type: "video_task", dx: 420,  dy: 760, title: "视频 · 模型 C" },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 1, toIndex: 4 },
    ],
  },

  // ── Ad / Commercial ───────────────────────────────────────────────────────
  {
    id: "ad-film",
    name: "广告片工作流",
    desc: "AI 剧本 → 角色/场景 → 4 分镜 → 图像 → 视频 → 合并，完整广告片制作流程",
    icon: "Megaphone",
    category: "video",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "广告脚本" },                                                                // 0
      { type: "character",  dx: -420, dy: 380,  title: "品牌角色", initialData: { characterKind: "person", role: "品牌代言人", gender: "女", age: "25-35", appearance: "专业、时尚、亲切，着品牌色服装", personality: "自信、活力、值得信赖" } }, // 1
      { type: "character",  dx: 0,    dy: 380,  title: "主场景",   initialData: { characterKind: "scene", locationType: "室内", sceneDescription: "现代简洁的室内空间，配合品牌色调，高端质感", atmosphere: "明亮", timeOfDay: "上午" } }, // 2
      { type: "audio",      dx: 420,  dy: 380,  title: "背景音乐", initialData: { audioCategory: "music", musicPrompt: "充满活力的现代商业配乐，节奏感强，积极向上，适合品牌广告", musicStyle: "流行" } }, // 3
      { type: "storyboard", dx: -630, dy: 760,  title: "开场钩子", initialData: { sceneNumber: 1, description: "产品特写镜头，3秒内抓住眼球，突出视觉冲击力",  cameraMovement: "zoom-in",   duration: 4, lens: "广角 24mm", colorTone: "高饱和，品牌主色" } }, // 4
      { type: "storyboard", dx: -210, dy: 760,  title: "问题场景", initialData: { sceneNumber: 2, description: "真实场景展示用户痛点，引发目标受众共鸣",         cameraMovement: "static",    duration: 5, lens: "标准 50mm", colorTone: "冷色调，偏灰" } }, // 5
      { type: "storyboard", dx: 210,  dy: 760,  title: "解决方案", initialData: { sceneNumber: 3, description: "产品介入解决问题，用户表情由困惑转为满意",       cameraMovement: "pan-right", duration: 5, lens: "标准 50mm", colorTone: "暖色调，温暖明亮" } }, // 6
      { type: "storyboard", dx: 630,  dy: 760,  title: "行动号召", initialData: { sceneNumber: 4, description: "产品Logo+口号特写，CTA文字入画，引导点击购买",  cameraMovement: "zoom-out",  duration: 3, lens: "长焦 85mm", colorTone: "高饱和，品牌主色" } }, // 7
      { type: "image_gen",  dx: -630, dy: 1140, title: "图像 1" },   // 8
      { type: "image_gen",  dx: -210, dy: 1140, title: "图像 2" },   // 9
      { type: "image_gen",  dx: 210,  dy: 1140, title: "图像 3" },   // 10
      { type: "image_gen",  dx: 630,  dy: 1140, title: "图像 4" },   // 11
      { type: "video_task", dx: -630, dy: 1520, title: "视频片段 1" }, // 12
      { type: "video_task", dx: -210, dy: 1520, title: "视频片段 2" }, // 13
      { type: "video_task", dx: 210,  dy: 1520, title: "视频片段 3" }, // 14
      { type: "video_task", dx: 630,  dy: 1520, title: "视频片段 4" }, // 15
      { type: "merge",      dx: 0,    dy: 1900, title: "合并剪辑", initialData: { transition: "fade", bgMusicVolume: 0.3 } }, // 16
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 4 },   // 脚本 → 4 个分镜
      { fromIndex: 0, toIndex: 5 },
      { fromIndex: 0, toIndex: 6 },
      { fromIndex: 0, toIndex: 7 },
      { fromIndex: 1, toIndex: 4 },   // 品牌角色 → 所有分镜
      { fromIndex: 1, toIndex: 5 },
      { fromIndex: 1, toIndex: 6 },
      { fromIndex: 1, toIndex: 7 },
      { fromIndex: 2, toIndex: 4 },   // 主场景 → 所有分镜
      { fromIndex: 2, toIndex: 5 },
      { fromIndex: 2, toIndex: 6 },
      { fromIndex: 2, toIndex: 7 },
      { fromIndex: 4, toIndex: 8 },   // 分镜 → 图像
      { fromIndex: 5, toIndex: 9 },
      { fromIndex: 6, toIndex: 10 },
      { fromIndex: 7, toIndex: 11 },
      { fromIndex: 8, toIndex: 12 },  // 图像 → 视频
      { fromIndex: 9, toIndex: 13 },
      { fromIndex: 10, toIndex: 14 },
      { fromIndex: 11, toIndex: 15 },
      { fromIndex: 12, toIndex: 16 }, // 视频片段 → 合并
      { fromIndex: 13, toIndex: 16 },
      { fromIndex: 14, toIndex: 16 },
      { fromIndex: 15, toIndex: 16 },
      { fromIndex: 3, toIndex: 16 },  // 背景音乐 → 合并
    ],
  },
  {
    id: "vlog",
    name: "Vlog 制作流程",
    desc: "脚本 → 配音旁白 → 背景音乐 → 多段视频 → 合并，适合日常 Vlog",
    icon: "Mic",
    category: "video",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "Vlog 脚本", initialData: { content: "今天我来分享..." } },             // 0
      { type: "audio",      dx: -300, dy: 380,  title: "旁白配音",  initialData: { audioCategory: "dubbing", ttsSpeed: 1.0 } },  // 1
      { type: "audio",      dx: 300,  dy: 380,  title: "背景音乐",  initialData: { audioCategory: "music", musicStyle: "轻音乐", musicPrompt: "轻松愉快的治愈系轻音乐，日常Vlog风格，清新自然" } }, // 2
      { type: "storyboard", dx: -450, dy: 760,  title: "片段 #1",  initialData: { sceneNumber: 1, description: "开场自我介绍，镜头前轻松打招呼，建立亲切感", cameraMovement: "static",   duration: 8,  lens: "广角 24mm", colorTone: "温暖明亮" } }, // 3
      { type: "storyboard", dx: -150, dy: 760,  title: "片段 #2",  initialData: { sceneNumber: 2, description: "主要内容展示，跟拍或手持拍摄，真实感强",     cameraMovement: "tracking",  duration: 10, lens: "标准 50mm", colorTone: "自然真实" } }, // 4
      { type: "storyboard", dx: 150,  dy: 760,  title: "片段 #3",  initialData: { sceneNumber: 3, description: "细节特写，突出重点物品或表情细节",           cameraMovement: "zoom-in",   duration: 6,  lens: "微距/长焦", colorTone: "清晰细节" } }, // 5
      { type: "storyboard", dx: 450,  dy: 760,  title: "片段 #4",  initialData: { sceneNumber: 4, description: "结尾总结，面向镜头总结并引导关注",           cameraMovement: "zoom-out",  duration: 5,  lens: "广角 24mm", colorTone: "温暖明亮" } }, // 6
      { type: "image_gen",  dx: -450, dy: 1140, title: "图像 1" }, // 7
      { type: "image_gen",  dx: -150, dy: 1140, title: "图像 2" }, // 8
      { type: "image_gen",  dx: 150,  dy: 1140, title: "图像 3" }, // 9
      { type: "image_gen",  dx: 450,  dy: 1140, title: "图像 4" }, // 10
      { type: "video_task", dx: -450, dy: 1520, title: "Vlog 片段 1" }, // 11
      { type: "video_task", dx: -150, dy: 1520, title: "Vlog 片段 2" }, // 12
      { type: "video_task", dx: 150,  dy: 1520, title: "Vlog 片段 3" }, // 13
      { type: "video_task", dx: 450,  dy: 1520, title: "Vlog 片段 4" }, // 14
      { type: "merge",      dx: 0,    dy: 1900, title: "合并剪辑", initialData: { transition: "dissolve", bgMusicVolume: 0.35 } }, // 15
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },   // 脚本 → 旁白配音（TTS 输入）
      { fromIndex: 0, toIndex: 3 },   // 脚本 → 4 个分镜
      { fromIndex: 0, toIndex: 4 },
      { fromIndex: 0, toIndex: 5 },
      { fromIndex: 0, toIndex: 6 },
      { fromIndex: 3, toIndex: 7 },   // 分镜 → 图像
      { fromIndex: 4, toIndex: 8 },
      { fromIndex: 5, toIndex: 9 },
      { fromIndex: 6, toIndex: 10 },
      { fromIndex: 7, toIndex: 11 },  // 图像 → 视频
      { fromIndex: 8, toIndex: 12 },
      { fromIndex: 9, toIndex: 13 },
      { fromIndex: 10, toIndex: 14 },
      { fromIndex: 11, toIndex: 15 }, // 视频片段 → 合并
      { fromIndex: 12, toIndex: 15 },
      { fromIndex: 13, toIndex: 15 },
      { fromIndex: 14, toIndex: 15 },
      { fromIndex: 1, toIndex: 15 },  // 旁白配音 → 合并
      { fromIndex: 2, toIndex: 15 },  // 背景音乐 → 合并
    ],
  },
  {
    id: "product-promo",
    name: "产品介绍视频",
    desc: "产品角色 + 场景 → 3 角度分镜 → 图像参考 → 视频，适合电商/发布会",
    icon: "ShoppingBag",
    category: "video",
    nodes: [
      { type: "character",  dx: -300, dy: 0,    title: "产品主体",  initialData: { characterKind: "person", role: "产品展示", appearance: "产品外观精致，设计感强，材质质感优良", notes: "重点展示产品核心功能与设计亮点，突出差异化卖点" } }, // 0
      { type: "character",  dx: 300,  dy: 0,    title: "展示场景",  initialData: { characterKind: "scene", locationType: "室内", sceneDescription: "简洁明亮的白色摄影棚，突出产品质感与轮廓", atmosphere: "明亮", timeOfDay: "正午" } }, // 1
      { type: "prompt",     dx: 0,    dy: 0,    title: "产品提示词", initialData: { positivePrompt: "professional product photography, studio lighting, white background, 8K quality", negativePrompt: "blurry, dark" } }, // 2
      { type: "storyboard", dx: -420, dy: 380,  title: "正面全景",   initialData: { sceneNumber: 1, description: "产品正面静态展示", cameraMovement: "static",   duration: 5 } },     // 3
      { type: "storyboard", dx: 0,    dy: 380,  title: "360°旋转",   initialData: { sceneNumber: 2, description: "产品旋转展示细节", cameraMovement: "pan-right", duration: 6 } },    // 4
      { type: "storyboard", dx: 420,  dy: 380,  title: "使用场景",   initialData: { sceneNumber: 3, description: "产品实际使用画面", cameraMovement: "zoom-in",   duration: 5 } },    // 5
      { type: "image_gen",  dx: -420, dy: 760,  title: "参考图 1" }, // 6
      { type: "image_gen",  dx: 0,    dy: 760,  title: "参考图 2" }, // 7
      { type: "image_gen",  dx: 420,  dy: 760,  title: "参考图 3" }, // 8
      { type: "video_task", dx: -420, dy: 1140, title: "产品视频 1" }, // 9
      { type: "video_task", dx: 0,    dy: 1140, title: "产品视频 2" }, // 10
      { type: "video_task", dx: 420,  dy: 1140, title: "产品视频 3" }, // 11
      { type: "audio",      dx: 0,    dy: 1520, title: "产品音乐",  initialData: { audioCategory: "music", musicStyle: "流行", musicPrompt: "简洁现代的商业配乐，品质感强，适合高端产品发布" } }, // 12
      { type: "merge",      dx: 0,    dy: 1900, title: "合并剪辑", initialData: { transition: "none", bgMusicVolume: 0.4 } }, // 13
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 3 },   // 产品主体 → 所有分镜
      { fromIndex: 0, toIndex: 4 },
      { fromIndex: 0, toIndex: 5 },
      { fromIndex: 1, toIndex: 3 },   // 展示场景 → 所有分镜
      { fromIndex: 1, toIndex: 4 },
      { fromIndex: 1, toIndex: 5 },
      { fromIndex: 2, toIndex: 3 },   // 提示词 → 所有分镜
      { fromIndex: 2, toIndex: 4 },
      { fromIndex: 2, toIndex: 5 },
      { fromIndex: 3, toIndex: 6 },   // 分镜 → 图像
      { fromIndex: 4, toIndex: 7 },
      { fromIndex: 5, toIndex: 8 },
      { fromIndex: 6, toIndex: 9 },   // 图像 → 视频
      { fromIndex: 7, toIndex: 10 },
      { fromIndex: 8, toIndex: 11 },
      { fromIndex: 9,  toIndex: 13 }, // 视频 → 合并
      { fromIndex: 10, toIndex: 13 },
      { fromIndex: 11, toIndex: 13 },
      { fromIndex: 12, toIndex: 13 }, // 产品音乐 → 合并
    ],
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: "ai-scriptwriter",
    name: "AI 剧本创作",
    desc: "AI 对话生成故事结构，自动扩展为分镜板",
    icon: "Bot",
    category: "ai",
    nodes: [
      { type: "ai_chat",    dx: 0,    dy: 0,   title: "AI 编剧助手", initialData: { systemPrompt: "你是专业电影编剧，帮助构思故事结构、对话和视觉场景描述。用中文回答，内容简洁有力。" } },
      { type: "script",     dx: 0,    dy: 420, title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 800, title: "分镜 #1", initialData: { sceneNumber: 1, description: "视觉化故事开场，建立场景和氛围", cameraMovement: "static",   duration: 5 } },
      { type: "storyboard", dx: 0,    dy: 800, title: "分镜 #2", initialData: { sceneNumber: 2, description: "情节推进，主角行动或冲突展开",   cameraMovement: "pan-right", duration: 5 } },
      { type: "storyboard", dx: 420,  dy: 800, title: "分镜 #3", initialData: { sceneNumber: 3, description: "高潮或结局，情感升华收束",       cameraMovement: "zoom-in",  duration: 5 } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 1, toIndex: 4 },
    ],
  },
  {
    id: "ai-full-pipeline",
    name: "AI 全流程制作",
    desc: "从 AI 对话到最终合并视频，完整 AI 辅助创作管线",
    icon: "Rocket",
    category: "ai",
    nodes: [
      { type: "ai_chat",    dx: 0,    dy: 0,    title: "AI 创作助手", initialData: { systemPrompt: "你是专业视频制作顾问，帮助从创意到分镜板到最终视频的全流程制作。" } },
      { type: "script",     dx: 0,    dy: 420,  title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 820,  title: "分镜 #1", initialData: { sceneNumber: 1, description: "视觉化故事开场，建立场景氛围", cameraMovement: "static",   duration: 5 } },
      { type: "storyboard", dx: 0,    dy: 820,  title: "分镜 #2", initialData: { sceneNumber: 2, description: "情节推进，核心内容展示",         cameraMovement: "pan-right", duration: 5 } },
      { type: "storyboard", dx: 420,  dy: 820,  title: "分镜 #3", initialData: { sceneNumber: 3, description: "高潮与结局，情感升华收束",       cameraMovement: "zoom-in",  duration: 5 } },
      { type: "image_gen",  dx: -420, dy: 1200, title: "图像 1" },
      { type: "image_gen",  dx: 0,    dy: 1200, title: "图像 2" },
      { type: "image_gen",  dx: 420,  dy: 1200, title: "图像 3" },
      { type: "video_task", dx: -420, dy: 1580, title: "视频 1" },
      { type: "video_task", dx: 0,    dy: 1580, title: "视频 2" },
      { type: "video_task", dx: 420,  dy: 1580, title: "视频 3" },
      { type: "merge",      dx: 0,    dy: 1960, title: "合并剪辑", initialData: { transition: "fade", bgMusicVolume: 0.25 } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 1, toIndex: 4 },
      { fromIndex: 2, toIndex: 5 },
      { fromIndex: 3, toIndex: 6 },
      { fromIndex: 4, toIndex: 7 },
      { fromIndex: 5, toIndex: 8 },
      { fromIndex: 6, toIndex: 9 },
      { fromIndex: 7, toIndex: 10 },
      { fromIndex: 8,  toIndex: 11 },
      { fromIndex: 9,  toIndex: 11 },
      { fromIndex: 10, toIndex: 11 },
    ],
  },

  // ── New templates ─────────────────────────────────────────────────────────
  {
    id: "vertical-short",
    name: "竖版短视频",
    desc: "9:16 竖屏格式，3个分镜生成视频后合并字幕，适合抖音/快手",
    icon: "Smartphone",
    category: "video",
    nodes: [
      { type: "script",     dx: -680, dy: 0,    title: "脚本" },
      { type: "storyboard", dx: -320, dy: -180, title: "分镜1", initialData: { sceneNumber: 1, description: "前3秒钩子，视觉冲击抓住注意力", cameraMovement: "static",   colorTone: "高饱和，吸睛", duration: 3 } },
      { type: "storyboard", dx: -320, dy: 0,    title: "分镜2", initialData: { sceneNumber: 2, description: "核心内容展示，信息密集节奏快",   cameraMovement: "tracking",  colorTone: "自然明亮",     duration: 5 } },
      { type: "storyboard", dx: -320, dy: 180,  title: "分镜3", initialData: { sceneNumber: 3, description: "收尾引导互动，引导点赞关注评论", cameraMovement: "zoom-out",  colorTone: "温暖明亮",     duration: 3 } },
      { type: "video_task", dx: 60,   dy: -180, title: "视频1" },
      { type: "video_task", dx: 60,   dy: 0,    title: "视频2" },
      { type: "video_task", dx: 60,   dy: 180,  title: "视频3" },
      { type: "merge",      dx: 420,  dy: 0,    title: "合并剪辑", initialData: { transition: "none" } },
      { type: "subtitle",   dx: 700,  dy: 0,    title: "字幕烧录", initialData: { burnInEnabled: true, fontSize: 22, fontColor: "white", language: "zh" } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 1, toIndex: 4 },
      { fromIndex: 2, toIndex: 5 },
      { fromIndex: 3, toIndex: 6 },
      { fromIndex: 4, toIndex: 7 },
      { fromIndex: 5, toIndex: 7 },
      { fromIndex: 6, toIndex: 7 },
      { fromIndex: 7, toIndex: 8 },
    ],
  },
  {
    id: "video-remix",
    name: "视频混剪",
    desc: "多段素材合并剪辑，叠加字幕与特效水印，适合二创混剪",
    icon: "Scissors",
    category: "video",
    nodes: [
      { type: "asset",    dx: -560, dy: -160, title: "素材1" },
      { type: "asset",    dx: -560, dy: 0,    title: "素材2" },
      { type: "asset",    dx: -560, dy: 160,  title: "素材3" },
      { type: "merge",    dx: -160, dy: 0,    title: "合并", initialData: { transition: "none" } },
      { type: "overlay",  dx: 160,  dy: 0,    title: "水印叠加", initialData: { mode: "watermark", overlayPosition: "bottom-right", overlayScale: 0.12, overlayOpacity: 0.8 } },
      { type: "subtitle", dx: 460,  dy: 0,    title: "字幕", initialData: { burnInEnabled: true, fontSize: 20, fontColor: "white" } },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 2, toIndex: 3 },
      { fromIndex: 3, toIndex: 4 },
      { fromIndex: 4, toIndex: 5 },
    ],
  },
  {
    id: "ai-dubbing",
    name: "AI 配音短片",
    desc: "AI生成脚本+图像视频，配合 TTS 配音与背景音乐合成",
    icon: "AudioLines",
    category: "ai",
    nodes: [
      { type: "ai_chat",    dx: -900, dy: 0,    title: "AI 创作" },                          // 0
      { type: "script",     dx: -600, dy: 0,    title: "脚本" },                              // 1
      { type: "storyboard", dx: -280, dy: -140, title: "分镜1", initialData: { sceneNumber: 1, description: "第一段视觉场景，与配音前半段对应", cameraMovement: "static"   } }, // 2
      { type: "storyboard", dx: -280, dy: 140,  title: "分镜2", initialData: { sceneNumber: 2, description: "第二段视觉场景，与配音后半段对应", cameraMovement: "pan-right" } }, // 3
      { type: "image_gen",  dx: 40,   dy: -140, title: "图像1" },  // 4
      { type: "image_gen",  dx: 40,   dy: 140,  title: "图像2" },  // 5
      { type: "video_task", dx: 360,  dy: -140, title: "视频1" },  // 6
      { type: "video_task", dx: 360,  dy: 140,  title: "视频2" },  // 7
      { type: "audio",      dx: 360,  dy: 380,  title: "配音",    initialData: { audioCategory: "dubbing", ttsSpeed: 1.0 } }, // 8
      { type: "merge",      dx: 660,  dy: 0,    title: "合并",    initialData: { transition: "fade" } },            // 9
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },  // AI → 脚本
      { fromIndex: 1, toIndex: 2 },  // 脚本 → 分镜
      { fromIndex: 1, toIndex: 3 },
      { fromIndex: 1, toIndex: 8 },  // 脚本 → 配音（TTS 文本来源）
      { fromIndex: 2, toIndex: 4 },  // 分镜 → 图像
      { fromIndex: 3, toIndex: 5 },
      { fromIndex: 4, toIndex: 6 },  // 图像 → 视频
      { fromIndex: 5, toIndex: 7 },
      { fromIndex: 6, toIndex: 9 },  // 视频 + 配音 → 合并
      { fromIndex: 7, toIndex: 9 },
      { fromIndex: 8, toIndex: 9 },
    ],
  },
];

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "all",     label: "全部",   color: "oklch(0.68 0.22 285)" },
  { id: "starter", label: "入门",   color: "oklch(0.72 0.18 155)" },
  { id: "image",   label: "图像",   color: "oklch(0.72 0.20 330)" },
  { id: "video",   label: "视频",   color: "oklch(0.62 0.20 25)"  },
  { id: "ai",      label: "AI 辅助", color: "oklch(0.68 0.22 285)" },
  { id: "custom",  label: "我的",   color: "oklch(0.72 0.18 45)"  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

// ── Node type mini-colors ─────────────────────────────────────────────────────

const NODE_DOT_COLORS: Partial<Record<NodeType, string>> = {
  script:       "oklch(0.62 0.18 240)",
  storyboard:   "oklch(0.65 0.20 160)",
  prompt:       "oklch(0.68 0.22 300)",
  image_gen:    "oklch(0.72 0.20 330)",
  asset:        "oklch(0.65 0.18 60)",
  video_task:   "oklch(0.62 0.20 25)",
  ai_chat:      "oklch(0.70 0.18 200)",
  note:         "oklch(0.60 0.10 90)",
  audio:        "oklch(0.68 0.20 340)",
  post_process: "oklch(0.65 0.18 190)",
  group:        "oklch(0.55 0.08 260)",
  character:    "oklch(0.66 0.18 140)",
  clip:         "oklch(0.68 0.20 55)",
  merge:        "oklch(0.62 0.20 270)",
  subtitle:        "oklch(0.65 0.18 170)",
  overlay:         "oklch(0.68 0.18 75)",
  subtitle_motion: "oklch(0.68 0.20 175)",
  smart_cut:       "oklch(0.68 0.22 65)",
  pose_control:    "oklch(0.65 0.20 310)",
  voice_clone:     "oklch(0.65 0.18 350)",
  lip_sync:        "oklch(0.62 0.20 220)",
  avatar:          "oklch(0.65 0.20 290)",
};

const NODE_TYPE_LABELS: Partial<Record<NodeType, string>> = {
  script:       "脚本",
  storyboard:   "分镜",
  prompt:       "提示词",
  image_gen:    "图像生成",
  asset:        "素材",
  video_task:   "视频生成",
  ai_chat:      "AI 对话",
  note:         "便签",
  audio:        "音频",
  post_process: "后处理",
  group:        "分组",
  character:    "角色/场景",
  clip:         "剪辑",
  merge:        "视频合并",
  subtitle:        "字幕",
  overlay:         "叠加特效",
  subtitle_motion: "动态字幕",
  smart_cut:       "智能剪辑",
  pose_control:    "构图控制",
  voice_clone:     "声音克隆",
  lip_sync:        "唇形同步",
  avatar:          "数字人",
};

// ── Custom template localStorage ──────────────────────────────────────────────

const CUSTOM_STORAGE_KEY = "ai-video-canvas:custom-templates";

function loadCustomTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

function persistCustomTemplates(templates: Template[]): void {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(templates));
}

// ── Canvas → Template conversion ──────────────────────────────────────────────

const RUNTIME_FIELDS = new Set([
  "imageUrl", "imageStorageKey", "imageHistory", "imageUrls", "selectedImageIndex",
  "resultVideoUrl", "errorMessage", "progress", "taskId", "externalTaskId",
  "status", "messages", "url", "storageKey",
]);

function sanitizeNodeData(data: Record<string, unknown>): Partial<NodeData> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!RUNTIME_FIELDS.has(k) && v !== undefined && v !== null && v !== "") {
      result[k] = v;
    }
  }
  return result as Partial<NodeData>;
}

function canvasToTemplate(
  nodes: Array<{ id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
  name: string,
  icon: string,
): Template {
  const cx = nodes.length > 0 ? nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length : 0;
  const cy = nodes.length > 0 ? nodes.reduce((s, n) => s + n.position.y, 0) / nodes.length : 0;

  const nodeSpecs: TemplateNodeSpec[] = nodes.map((n) => ({
    type: (n.type as NodeType) ?? "script",
    dx: Math.round(n.position.x - cx),
    dy: Math.round(n.position.y - cy),
    initialData: sanitizeNodeData(n.data),
  }));

  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const edgeSpecs: TemplateEdgeSpec[] = edges
    .filter((e) => idToIndex.has(e.source) && idToIndex.has(e.target))
    .map((e) => ({ fromIndex: idToIndex.get(e.source)!, toIndex: idToIndex.get(e.target)! }));

  return {
    id: `custom-${Date.now()}`,
    name,
    desc: `${nodes.length} 个节点，${edgeSpecs.length} 条连接`,
    icon,
    category: "custom",
    nodes: nodeSpecs,
    edgeSpecs,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };
}

// ── Node data summary for preview ─────────────────────────────────────────────

function getNodeDataSummary(type: NodeType, data: Record<string, unknown>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const add = (label: string, val: unknown) => {
    if (val !== undefined && val !== null && val !== "") {
      const str = String(val);
      pairs.push([label, str.length > 55 ? str.slice(0, 55) + "…" : str]);
    }
  };
  switch (type) {
    case "script":
      add("内容", (data.content as string | undefined)?.slice(0, 80));
      break;
    case "storyboard":
      add("场景描述", data.description);
      add("时长", data.duration != null ? `${data.duration}s` : undefined);
      add("运镜", data.cameraMovement);
      break;
    case "prompt":
      add("正向提示词", data.positivePrompt);
      add("负向提示词", data.negativePrompt);
      break;
    case "image_gen":
      add("提示词", data.prompt);
      add("模型", data.model);
      add("比例", data.aspectRatio);
      break;
    case "video_task":
      add("提供商", data.provider);
      add("提示词", data.prompt);
      break;
    case "ai_chat":
      add("系统提示词", data.systemPrompt);
      break;
    case "note":
      add("内容", data.content);
      break;
  }
  return pairs;
}

// ── Mini flow diagram ─────────────────────────────────────────────────────────

function MiniDiagram({ template, width = 200, height = 88 }: { template: Template; width?: number; height?: number }) {
  const W = width;
  const H = height;
  const PAD = 14;
  const R = 5;

  const points: Array<{ type: NodeType; rawX: number; rawY: number }> = [];
  for (const spec of template.nodes) {
    const count = spec.count ?? 1;
    const spacing = spec.spacing ?? 0;
    for (let i = 0; i < count; i++) {
      const rawX = spec.dx + (count > 1 ? (i - (count - 1) / 2) * spacing : 0);
      points.push({ type: spec.type, rawX, rawY: spec.dy });
    }
  }

  if (points.length === 0) {
    return <svg width={W} height={H} style={{ display: "block" }} />;
  }

  const xs = points.map((p) => p.rawX);
  const ys = points.map((p) => p.rawY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const toSvg = (rawX: number, rawY: number) => ({
    cx: PAD + ((rawX - minX) / rangeX) * (W - PAD * 2),
    cy: PAD + ((rawY - minY) / rangeY) * (H - PAD * 2),
  });

  const svgPoints = points.map((p) => ({ ...p, ...toSvg(p.rawX, p.rawY) }));

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {(template.edgeSpecs ?? []).map((e, i) => {
        const from = svgPoints[e.fromIndex];
        const to = svgPoints[e.toIndex];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.cx} y1={from.cy}
            x2={to.cx} y2={to.cy}
            stroke="var(--c-bd3)"
            strokeWidth={1.2}
            strokeDasharray="3 2"
          />
        );
      })}
      {svgPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.cx} cy={p.cy} r={R}
          fill={NODE_DOT_COLORS[p.type] ?? "var(--c-t3)"}
          fillOpacity={0.9}
        />
      ))}
    </svg>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onSelect,
  onDelete,
}: {
  template: Template;
  onSelect: (t: Template) => void;
  onDelete?: (id: string) => void;
}) {
  const cat = CATEGORIES.find((c) => c.id === template.category);
  const nodeCount = template.nodes.reduce((s, n) => s + (n.count ?? 1), 0);

  return (
    <button
      onClick={() => onSelect(template)}
      className="group w-full text-left rounded-2xl overflow-hidden transition-all duration-150 flex flex-col relative"
      style={{
        background: "var(--c-base)",
        border: "1px solid var(--c-bd2)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "var(--c-surface)";
        el.style.borderColor = "oklch(0.68 0.22 285 / 0.40)";
        el.style.transform = "translateY(-1px)";
        el.style.boxShadow = "0 6px 24px oklch(0 0 0 / 0.35)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "var(--c-base)";
        el.style.borderColor = "var(--c-bd2)";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Delete button for custom templates */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(template.id); }}
          className="absolute top-2 right-2 z-10 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "var(--c-bd2)", color: "oklch(0.55 0.15 25)" }}
          title="删除模板"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}

      {/* Mini diagram */}
      <div
        className="w-full flex items-center justify-center py-3"
        style={{ background: "var(--c-base)", borderBottom: "1px solid var(--c-elevated)" }}
      >
        <MiniDiagram template={template} />
      </div>

      {/* Card body */}
      <div className="px-3.5 pt-3 pb-3.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-2">
          <TemplateIcon name={template.icon} size={18} />
          <span className="text-sm font-semibold truncate" style={{ color: "var(--c-t1)" }}>
            {template.name}
          </span>
        </div>

        <p
          className="text-[11px] leading-relaxed line-clamp-2"
          style={{ color: "var(--c-t3)" }}
        >
          {template.desc}
        </p>

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {cat && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
              style={{
                background: `${cat.color}18`,
                border: `1px solid ${cat.color}30`,
                color: cat.color,
              }}
            >
              {cat.label}
            </span>
          )}
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              background: "oklch(0.68 0.22 285 / 0.10)",
              border: "1px solid oklch(0.68 0.22 285 / 0.20)",
              color: "oklch(0.68 0.22 285 / 0.80)",
            }}
          >
            {nodeCount} 节点
          </span>
          {(template.edgeSpecs?.length ?? 0) > 0 && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: "var(--c-bd1)",
                border: "1px solid var(--c-bd3)",
                color: "var(--c-t4)",
              }}
            >
              {template.edgeSpecs!.length} 连接
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Save dialog ───────────────────────────────────────────────────────────────

const QUICK_ICONS = ["Film", "Star", "Bookmark", "Briefcase", "Target", "Flame", "Sparkles", "Sun", "Palette", "Layers", "Trophy", "Grid2x2"];

function SaveDialog({
  onSave,
  onCancel,
}: {
  onSave: (name: string, icon: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("我的模板");
  const [icon, setIcon] = useState("Film");

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl"
      style={{ background: "oklch(0 0 0 / 0.70)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{
          width: 320,
          background: "var(--c-surface)",
          border: "1px solid var(--c-bd3)",
          boxShadow: "0 16px 48px oklch(0 0 0 / 0.50)",
        }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>
          保存为模板
        </p>

        {/* Emoji picker */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px]" style={{ color: "var(--c-t3)" }}>图标</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ICONS.map((e) => (
              <button
                key={e}
                onClick={() => setIcon(e)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: icon === e ? "oklch(0.68 0.22 285 / 0.20)" : "var(--c-elevated)",
                  border: icon === e ? "1px solid oklch(0.68 0.22 285 / 0.50)" : "1px solid var(--c-bd2)",
                  color: icon === e ? "oklch(0.78 0.18 285)" : "var(--c-t3)",
                }}
              >
                <TemplateIcon name={e} size={14} />
              </button>
            ))}
          </div>
        </div>

        {/* Name input */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px]" style={{ color: "var(--c-t3)" }}>名称</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim(), icon); }}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none"
            style={{
              background: "var(--c-elevated)",
              border: "1px solid var(--c-bd3)",
              color: "var(--c-t1)",
            }}
            autoFocus
            maxLength={30}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
          >
            取消
          </button>
          <button
            onClick={() => { if (name.trim()) onSave(name.trim(), icon); }}
            disabled={!name.trim()}
            className="flex-1 py-2 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-1.5"
            style={{
              background: name.trim() ? "oklch(0.68 0.22 285 / 0.20)" : "var(--c-surface)",
              border: name.trim() ? "1px solid oklch(0.68 0.22 285 / 0.40)" : "1px solid var(--c-bd2)",
              color: name.trim() ? "oklch(0.78 0.18 285)" : "var(--c-t4)",
            }}
          >
            <Check className="w-3.5 h-3.5" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  centerX: number;
  centerY: number;
}

export function TemplatePanel({ onClose, centerX, centerY }: Props) {
  const { addNode, onConnect, updateNodeData } = useCanvasStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<Template[]>(() => loadCustomTemplates());

  const allTemplates = useMemo(() => [...TEMPLATES, ...customTemplates], [customTemplates]);

  const filtered = useMemo(() => {
    return allTemplates.filter((t) => {
      const matchesCat = category === "all" || t.category === category;
      const q = query.toLowerCase();
      const matchesQuery = !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [allTemplates, category, query]);

  const applyTemplate = useCallback(
    (template: Template) => {
      const resolvedNodes: Array<{ id: string }> = [];

      try {
      // Map from spec index → first resolvedNodes index for that spec
      const specStartIndex: number[] = [];
      for (const spec of template.nodes) {
        const count = spec.count ?? 1;
        const spacing = spec.spacing ?? 0;
        const rowStartX = count > 1 ? centerX + spec.dx - ((count - 1) * spacing) / 2 : centerX + spec.dx;

        specStartIndex.push(resolvedNodes.length);
        for (let i = 0; i < count; i++) {
          const x = count > 1 ? rowStartX + i * spacing : centerX + spec.dx;
          const y = centerY + spec.dy;
          const newNode = addNode(spec.type, { x, y });

          if (spec.title) {
            const { updateNodeTitle } = useCanvasStore.getState();
            updateNodeTitle(newNode.id, spec.title);
          }
          if (spec.initialData) {
            updateNodeData(newNode.id, spec.initialData as Parameters<typeof updateNodeData>[1]);
          }

          resolvedNodes.push({ id: newNode.id });
        }
      }

      for (const edgeSpec of template.edgeSpecs ?? []) {
        const srcIdx = specStartIndex[edgeSpec.fromIndex];
        const tgtIdx = specStartIndex[edgeSpec.toIndex];
        const src = srcIdx !== undefined ? resolvedNodes[srcIdx] : undefined;
        const tgt = tgtIdx !== undefined ? resolvedNodes[tgtIdx] : undefined;
        if (src && tgt) {
          const srcType = template.nodes[edgeSpec.fromIndex]?.type;
          const tgtType = template.nodes[edgeSpec.toIndex]?.type;
          const sourceHandle = srcType === "clip" ? "clip-out" : "output";
          const targetHandle = tgtType === "clip" ? "video-in" : "input";
          onConnect({ source: src.id, target: tgt.id, sourceHandle, targetHandle });
        }
      }

      onClose();
      } catch (err) {
        toast.error("应用模板失败：" + (err instanceof Error ? err.message : String(err)));
      }
    },
    [addNode, onConnect, updateNodeData, centerX, centerY, onClose]
  );

  const handleSaveCanvas = useCallback((name: string, icon: string) => {
    const { nodes, edges } = useCanvasStore.getState();
    const template = canvasToTemplate(
      nodes.map((n) => ({ id: n.id, type: n.data.nodeType as string, position: n.position, data: n.data.payload as Record<string, unknown> })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      name,
      icon,
    );
    const updated = [...customTemplates, template];
    setCustomTemplates(updated);
    persistCustomTemplates(updated);
    setShowSaveDialog(false);
    setCategory("custom");
  }, [customTemplates]);

  const handleDeleteCustom = useCallback((id: string) => {
    const updated = customTemplates.filter((t) => t.id !== id);
    setCustomTemplates(updated);
    persistCustomTemplates(updated);
  }, [customTemplates]);

  const customCount = customTemplates.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{
          width: "min(860px, 95vw)",
          maxHeight: "88vh",
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 24px 80px oklch(0 0 0 / 0.65)",
        }}
      >
        {/* Save dialog overlay */}
        {showSaveDialog && (
          <SaveDialog
            onSave={handleSaveCanvas}
            onCancel={() => setShowSaveDialog(false)}
          />
        )}

        {selectedTemplate ? (
          // ── Preview view ──────────────────────────────────────────────────
          <>
            {/* Preview header */}
            <div
              className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--c-bd1)" }}
            >
              <button
                onClick={() => setSelectedTemplate(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                style={{ color: "var(--c-t3)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <TemplateIcon name={selectedTemplate.icon} size={20} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>
                  {selectedTemplate.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--c-t4)" }}>
                  {selectedTemplate.desc}
                </p>
              </div>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ color: "var(--c-t4)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview body */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
              {/* Large diagram */}
              <div
                className="w-full flex items-center justify-center py-6 rounded-2xl"
                style={{ background: "var(--c-base)", border: "1px solid var(--c-elevated)" }}
              >
                <MiniDiagram template={selectedTemplate} width={480} height={160} />
              </div>

              {/* Node list */}
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-t4)" }}>
                  节点详情 ({selectedTemplate.nodes.length})
                </p>
                <div className="flex flex-col gap-2">
                  {selectedTemplate.nodes.map((spec, i) => {
                    const color = NODE_DOT_COLORS[spec.type] ?? "var(--c-t3)";
                    const label = NODE_TYPE_LABELS[spec.type] ?? spec.type;
                    const summary = getNodeDataSummary(spec.type, (spec.initialData ?? {}) as Record<string, unknown>);
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-3 px-3.5 py-3 rounded-xl"
                        style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                          style={{ background: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold" style={{ color: "var(--c-t1)" }}>
                              {spec.title ?? label}
                            </span>
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: `${color}18`, color }}
                            >
                              {label}
                            </span>
                          </div>
                          {summary.length > 0 && (
                            <div className="mt-1.5 flex flex-col gap-0.5">
                              {summary.map(([k, v]) => (
                                <div key={k} className="flex gap-1.5 text-[10px] leading-relaxed">
                                  <span style={{ color: "var(--c-t4)", flexShrink: 0 }}>{k}:</span>
                                  <span style={{ color: "var(--c-t2)" }} className="truncate">{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Preview footer with apply */}
            <div
              className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderTop: "1px solid var(--c-elevated)" }}
            >
              <button
                onClick={() => setSelectedTemplate(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
              >
                返回
              </button>
              <button
                onClick={() => applyTemplate(selectedTemplate)}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
                style={{
                  background: "linear-gradient(135deg, oklch(0.55 0.22 285), oklch(0.48 0.20 310))",
                  color: "var(--c-t1)",
                  boxShadow: "0 4px 16px oklch(0.55 0.22 285 / 0.30)",
                }}
              >
                <Zap className="w-3.5 h-3.5" />
                应用到画布
              </button>
            </div>
          </>
        ) : (
          // ── Grid view ─────────────────────────────────────────────────────
          <>
            {/* Header */}
            <div
              className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--c-bd1)" }}
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285 / 0.25), oklch(0.60 0.20 310 / 0.25))", border: "1px solid oklch(0.68 0.22 285 / 0.30)" }}
              >
                <Zap className="w-4 h-4" style={{ color: "oklch(0.72 0.20 285)" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>
                  快速模板
                </p>
                <p className="text-[11px]" style={{ color: "var(--c-t4)" }}>
                  选择模板，一键创建完整工作流
                </p>
              </div>

              {/* Search */}
              <div
                className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl ml-4"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)" }}
              >
                <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模板..."
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: "var(--c-t1)" }}
                  autoFocus
                />
                {query && (
                  <button onClick={() => setQuery("")} style={{ color: "var(--c-t4)" }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Save canvas button */}
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0"
                style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = "oklch(0.72 0.18 45 / 0.40)";
                  el.style.color = "oklch(0.72 0.18 45)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = "var(--c-bd3)";
                  el.style.color = "var(--c-t3)";
                }}
                title="将当前画布保存为模板"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                保存画布
              </button>

              {/* Close */}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                style={{ color: "var(--c-t4)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category tabs */}
            <div
              className="flex items-center gap-1 px-5 py-3 flex-shrink-0 overflow-x-auto"
              style={{ borderBottom: "1px solid var(--c-elevated)" }}
            >
              {CATEGORIES.map((cat) => {
                const active = category === cat.id;
                const count = cat.id === "all"
                  ? allTemplates.length
                  : cat.id === "custom"
                  ? customCount
                  : TEMPLATES.filter((t) => t.category === cat.id).length;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap"
                    style={{
                      background: active ? `${cat.color}18` : "transparent",
                      border: active ? `1px solid ${cat.color}35` : "1px solid transparent",
                      color: active ? cat.color : "var(--c-t3)",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
                    }}
                  >
                    {cat.label}
                    <span
                      className="text-[9px] px-1 py-0.5 rounded-full font-semibold"
                      style={{
                        background: active ? `${cat.color}25` : "var(--c-bd1)",
                        color: active ? cat.color : "var(--c-t4)",
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Template grid */}
            <div className="flex-1 overflow-y-auto p-5">
              {filtered.length === 0 ? (
                category === "custom" && customCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <FolderOpen style={{ width: 40, height: 40, color: "var(--c-t4)" }} />
                    <p className="text-sm" style={{ color: "var(--c-t4)" }}>还没有保存的模板</p>
                    <p className="text-xs" style={{ color: "var(--c-t4)" }}>
                      点击右上角「保存画布」将当前工作流另存为模板
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Search style={{ width: 40, height: 40, color: "var(--c-t4)" }} />
                    <p className="text-sm" style={{ color: "var(--c-t4)" }}>没有找到匹配的模板</p>
                  </div>
                )
              ) : (
                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
                >
                  {filtered.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onSelect={setSelectedTemplate}
                      onDelete={t.isCustom ? handleDeleteCustom : undefined}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-5 py-3 flex-shrink-0 text-[10px]"
              style={{ borderTop: "1px solid var(--c-elevated)", color: "var(--c-t4)" }}
            >
              <span>{allTemplates.length} 个模板 · 点击卡片预览后应用</span>
              <kbd
                className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t4)" }}
              >
                ESC 关闭
              </kbd>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
