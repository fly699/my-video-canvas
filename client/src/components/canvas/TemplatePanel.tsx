import { useCallback, useState, useMemo } from "react";
import { X, Search, Zap } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType, NodeData } from "../../../../shared/types";

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
  category: "starter" | "image" | "video" | "ai";
  nodes: TemplateNodeSpec[];
  edgeSpecs?: TemplateEdgeSpec[];
}

// ── Template definitions ──────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  // ── Starter ──────────────────────────────────────────────────────────────
  {
    id: "single-shot",
    name: "单镜头视频",
    desc: "脚本 → 分镜 → 图像 → 视频，最简单的完整流程",
    icon: "🎬",
    category: "starter",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "脚本" },
      { type: "storyboard", dx: 0,    dy: 380,  title: "分镖 #1", initialData: { description: "描述这个场景的视觉内容", duration: 5, cameraMovement: "static" } },
      { type: "image_gen",  dx: 0,    dy: 730,  title: "图像生成" },
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
    icon: "💡",
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
    icon: "✨",
    category: "starter",
    nodes: [
      { type: "prompt",    dx: 0,   dy: 0,   title: "提示词", initialData: { positivePrompt: "高质量摄影，电影级光线，专业构图" } },
      { type: "image_gen", dx: -200, dy: 380, title: "图像 A" },
      { type: "image_gen", dx: 220,  dy: 380, title: "图像 B" },
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
    icon: "🖼️",
    category: "image",
    nodes: [
      { type: "prompt",    dx: 0,    dy: 0,   title: "主提示词" },
      { type: "image_gen", dx: -570, dy: 380, title: "图像 1" },
      { type: "image_gen", dx: -190, dy: 380, title: "图像 2" },
      { type: "image_gen", dx: 190,  dy: 380, title: "图像 3" },
      { type: "image_gen", dx: 570,  dy: 380, title: "图像 4" },
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
    name: "连续分镖生成",
    desc: "脚本自动生成 4 格分镖，每格独立出图",
    icon: "🎞️",
    category: "image",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,   title: "故事脚本" },
      { type: "storyboard", dx: -570, dy: 400, title: "分镖 #1", initialData: { sceneNumber: 1, description: "开场镜头", cameraMovement: "static",  duration: 4 } },
      { type: "storyboard", dx: -190, dy: 400, title: "分镖 #2", initialData: { sceneNumber: 2, description: "情节发展", cameraMovement: "pan-right", duration: 4 } },
      { type: "storyboard", dx: 190,  dy: 400, title: "分镖 #3", initialData: { sceneNumber: 3, description: "高潮时刻", cameraMovement: "zoom-in",  duration: 4 } },
      { type: "storyboard", dx: 570,  dy: 400, title: "分镖 #4", initialData: { sceneNumber: 4, description: "结尾画面", cameraMovement: "static",  duration: 4 } },
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
    icon: "▶️",
    category: "video",
    nodes: [
      { type: "image_gen",  dx: 0,    dy: 0,   title: "参考图生成" },
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
    desc: "脚本 → 3 分镖 → 3 图像 → 3 视频，完整短片工作流",
    icon: "🎥",
    category: "video",
    nodes: [
      { type: "script",     dx: 0,    dy: 0,    title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 400,  title: "分镖 #1", initialData: { sceneNumber: 1, description: "开场", cameraMovement: "static",   duration: 5 } },
      { type: "storyboard", dx: 0,    dy: 400,  title: "分镖 #2", initialData: { sceneNumber: 2, description: "主体", cameraMovement: "pan-right", duration: 5 } },
      { type: "storyboard", dx: 420,  dy: 400,  title: "分镖 #3", initialData: { sceneNumber: 3, description: "结尾", cameraMovement: "zoom-out",  duration: 5 } },
      { type: "image_gen",  dx: -420, dy: 780,  title: "图像 1" },
      { type: "image_gen",  dx: 0,    dy: 780,  title: "图像 2" },
      { type: "image_gen",  dx: 420,  dy: 780,  title: "图像 3" },
      { type: "video_task", dx: -420, dy: 1160, title: "视频 1" },
      { type: "video_task", dx: 0,    dy: 1160, title: "视频 2" },
      { type: "video_task", dx: 420,  dy: 1160, title: "视频 3" },
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
    ],
  },
  {
    id: "video-compare",
    name: "视频模型对比",
    desc: "同一提示词同时提交多个视频模型，对比生成效果",
    icon: "⚖️",
    category: "video",
    nodes: [
      { type: "prompt",     dx: 0,    dy: 0,   title: "视频提示词", initialData: { positivePrompt: "电影级动态镜头，高质量画面" } },
      { type: "image_gen",  dx: 0,    dy: 380, title: "参考图" },
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

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: "ai-scriptwriter",
    name: "AI 剧本创作",
    desc: "AI 对话生成故事结构，自动扩展为分镖板",
    icon: "🤖",
    category: "ai",
    nodes: [
      { type: "ai_chat",    dx: 0,    dy: 0,   title: "AI 编剧助手", initialData: { systemPrompt: "你是专业电影编剧，帮助构思故事结构、对话和视觉场景描述。用中文回答，内容简洁有力。" } },
      { type: "script",     dx: 0,    dy: 420, title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 800, title: "分镖 #1", initialData: { sceneNumber: 1, cameraMovement: "static",   duration: 5 } },
      { type: "storyboard", dx: 0,    dy: 800, title: "分镖 #2", initialData: { sceneNumber: 2, cameraMovement: "pan-right", duration: 5 } },
      { type: "storyboard", dx: 420,  dy: 800, title: "分镖 #3", initialData: { sceneNumber: 3, cameraMovement: "zoom-in",  duration: 5 } },
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
    desc: "从 AI 对话到最终视频，完整 AI 辅助创作管线",
    icon: "🚀",
    category: "ai",
    nodes: [
      { type: "ai_chat",    dx: 0,    dy: 0,    title: "AI 创作助手", initialData: { systemPrompt: "你是专业视频制作顾问，帮助从创意到分镖板到最终视频的全流程制作。" } },
      { type: "script",     dx: 0,    dy: 420,  title: "故事脚本" },
      { type: "storyboard", dx: -420, dy: 820,  title: "分镖 #1", initialData: { sceneNumber: 1, cameraMovement: "static",   duration: 5 } },
      { type: "storyboard", dx: 0,    dy: 820,  title: "分镖 #2", initialData: { sceneNumber: 2, cameraMovement: "pan-right", duration: 5 } },
      { type: "storyboard", dx: 420,  dy: 820,  title: "分镖 #3", initialData: { sceneNumber: 3, cameraMovement: "zoom-in",  duration: 5 } },
      { type: "image_gen",  dx: -420, dy: 1200, title: "图像 1" },
      { type: "image_gen",  dx: 0,    dy: 1200, title: "图像 2" },
      { type: "image_gen",  dx: 420,  dy: 1200, title: "图像 3" },
      { type: "video_task", dx: -420, dy: 1580, title: "视频 1" },
      { type: "video_task", dx: 0,    dy: 1580, title: "视频 2" },
      { type: "video_task", dx: 420,  dy: 1580, title: "视频 3" },
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
};

// ── Mini flow diagram ─────────────────────────────────────────────────────────

function MiniDiagram({ template }: { template: Template }) {
  const W = 200;
  const H = 88;
  const PAD = 14;
  const R = 5;

  // Expand node specs into flat list
  const points: Array<{ type: NodeType; rawX: number; rawY: number }> = [];
  for (const spec of template.nodes) {
    const count = spec.count ?? 1;
    const spacing = spec.spacing ?? 0;
    for (let i = 0; i < count; i++) {
      const rawX = spec.dx + (count > 1 ? (i - (count - 1) / 2) * spacing : 0);
      points.push({ type: spec.type, rawX, rawY: spec.dy });
    }
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
      {/* Edges */}
      {(template.edgeSpecs ?? []).map((e, i) => {
        const from = svgPoints[e.fromIndex];
        const to = svgPoints[e.toIndex];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.cx} y1={from.cy}
            x2={to.cx} y2={to.cy}
            stroke="oklch(0.32 0.008 260)"
            strokeWidth={1.2}
            strokeDasharray="3 2"
          />
        );
      })}
      {/* Node dots */}
      {svgPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.cx} cy={p.cy} r={R}
          fill={NODE_DOT_COLORS[p.type] ?? "oklch(0.50 0.008 260)"}
          fillOpacity={0.9}
        />
      ))}
    </svg>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onApply,
}: {
  template: Template;
  onApply: (t: Template) => void;
}) {
  const cat = CATEGORIES.find((c) => c.id === template.category);
  const nodeCount = template.nodes.reduce((s, n) => s + (n.count ?? 1), 0);

  return (
    <button
      onClick={() => onApply(template)}
      className="group w-full text-left rounded-2xl overflow-hidden transition-all duration-150 flex flex-col"
      style={{
        background: "oklch(0.12 0.007 260)",
        border: "1px solid oklch(0.20 0.008 260)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "oklch(0.15 0.008 260)";
        el.style.borderColor = "oklch(0.68 0.22 285 / 0.40)";
        el.style.transform = "translateY(-1px)";
        el.style.boxShadow = "0 6px 24px oklch(0 0 0 / 0.35)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "oklch(0.12 0.007 260)";
        el.style.borderColor = "oklch(0.20 0.008 260)";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Mini diagram */}
      <div
        className="w-full flex items-center justify-center py-3"
        style={{ background: "oklch(0.095 0.006 260)", borderBottom: "1px solid oklch(0.16 0.007 260)" }}
      >
        <MiniDiagram template={template} />
      </div>

      {/* Card body */}
      <div className="px-3.5 pt-3 pb-3.5 flex flex-col gap-1.5 flex-1">
        {/* Icon + name */}
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{template.icon}</span>
          <span className="text-sm font-semibold truncate" style={{ color: "oklch(0.88 0.005 260)" }}>
            {template.name}
          </span>
        </div>

        {/* Description */}
        <p
          className="text-[11px] leading-relaxed line-clamp-2"
          style={{ color: "oklch(0.50 0.008 260)" }}
        >
          {template.desc}
        </p>

        {/* Tags */}
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
                background: "oklch(0.18 0.008 260)",
                border: "1px solid oklch(0.24 0.008 260)",
                color: "oklch(0.48 0.008 260)",
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

  const filtered = useMemo(() => {
    return TEMPLATES.filter((t) => {
      const matchesCat = category === "all" || t.category === category;
      const q = query.toLowerCase();
      const matchesQuery =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [category, query]);

  const applyTemplate = useCallback(
    (template: Template) => {
      const resolvedNodes: Array<{ id: string }> = [];

      for (const spec of template.nodes) {
        const count = spec.count ?? 1;
        const spacing = spec.spacing ?? 0;
        const rowStartX = count > 1 ? centerX + spec.dx - ((count - 1) * spacing) / 2 : centerX + spec.dx;

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
        const src = resolvedNodes[edgeSpec.fromIndex];
        const tgt = resolvedNodes[edgeSpec.toIndex];
        if (src && tgt) {
          onConnect({ source: src.id, target: tgt.id, sourceHandle: "output", targetHandle: "input" });
        }
      }

      onClose();
    },
    [addNode, onConnect, updateNodeData, centerX, centerY, onClose]
  );

  return (
    // Full-screen backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal panel */}
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{
          width: "min(860px, 95vw)",
          maxHeight: "88vh",
          background: "oklch(0.10 0.007 260)",
          border: "1px solid oklch(0.22 0.008 260)",
          boxShadow: "0 24px 80px oklch(0 0 0 / 0.65)",
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid oklch(0.18 0.008 260)" }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285 / 0.25), oklch(0.60 0.20 310 / 0.25))", border: "1px solid oklch(0.68 0.22 285 / 0.30)" }}
          >
            <Zap className="w-4 h-4" style={{ color: "oklch(0.72 0.20 285)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "oklch(0.90 0.005 260)" }}>
              快速模板
            </p>
            <p className="text-[11px]" style={{ color: "oklch(0.42 0.006 260)" }}>
              选择模板，一键创建完整工作流
            </p>
          </div>

          {/* Search */}
          <div
            className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl ml-4"
            style={{ background: "oklch(0.14 0.007 260)", border: "1px solid oklch(0.22 0.008 260)" }}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "oklch(0.42 0.006 260)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模板..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "oklch(0.85 0.005 260)" }}
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery("")} style={{ color: "oklch(0.42 0.006 260)" }}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
            style={{ color: "oklch(0.45 0.008 260)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.45 0.008 260)"; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Category tabs ── */}
        <div
          className="flex items-center gap-1 px-5 py-3 flex-shrink-0 overflow-x-auto"
          style={{ borderBottom: "1px solid oklch(0.16 0.008 260)" }}
        >
          {CATEGORIES.map((cat) => {
            const active = category === cat.id;
            const count = cat.id === "all" ? TEMPLATES.length : TEMPLATES.filter((t) => t.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap"
                style={{
                  background: active ? `${cat.color}18` : "transparent",
                  border: active ? `1px solid ${cat.color}35` : "1px solid transparent",
                  color: active ? cat.color : "oklch(0.50 0.008 260)",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "oklch(0.75 0.005 260)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)";
                }}
              >
                {cat.label}
                <span
                  className="text-[9px] px-1 py-0.5 rounded-full font-semibold"
                  style={{
                    background: active ? `${cat.color}25` : "oklch(0.18 0.008 260)",
                    color: active ? cat.color : "oklch(0.42 0.006 260)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Template grid ── */}
        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-3xl">🔍</span>
              <p className="text-sm" style={{ color: "oklch(0.42 0.006 260)" }}>没有找到匹配的模板</p>
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
            >
              {filtered.map((t) => (
                <TemplateCard key={t.id} template={t} onApply={applyTemplate} />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0 text-[10px]"
          style={{ borderTop: "1px solid oklch(0.16 0.008 260)", color: "oklch(0.38 0.006 260)" }}
        >
          <span>{TEMPLATES.length} 个模板 · 点击模板立即应用到画布中央</span>
          <kbd
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ background: "oklch(0.16 0.008 260)", border: "1px solid oklch(0.24 0.008 260)", color: "oklch(0.48 0.008 260)" }}
          >
            ESC 关闭
          </kbd>
        </div>
      </div>
    </div>
  );
}
