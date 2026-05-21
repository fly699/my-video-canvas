import { useCallback } from "react";
import { nanoid } from "nanoid";
import { X } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import type { NodeType } from "../../../../shared/types";

interface TemplateNode {
  type: NodeType;
  dx: number;
  dy: number;
  count?: number;
  spacing?: number;
}

interface TemplateEdgeSpec {
  fromIndex: number; // index in the flat resolved nodes list
  toIndex: number;
}

interface Template {
  id: string;
  name: string;
  desc: string;
  icon: string;
  nodes: TemplateNode[];
  edgeSpecs?: TemplateEdgeSpec[];
}

const TEMPLATES: Template[] = [
  {
    id: "short-film",
    name: "短片制作流程",
    desc: "脚本 → 4分镜 → 4图像 → 4视频",
    icon: "🎬",
    nodes: [
      { type: "script", dx: 0, dy: 0 },
      { type: "storyboard", dx: 0, dy: 400, count: 4, spacing: 380 },
      { type: "image_gen", dx: 0, dy: 750, count: 4, spacing: 380 },
      { type: "video_task", dx: 0, dy: 1100, count: 4, spacing: 380 },
    ],
    // edges: script(0) → each storyboard(1..4), storyboard_i → image_gen_i, image_gen_i → video_task_i
    edgeSpecs: [
      // script → storyboard 0..3
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 0, toIndex: 4 },
      // storyboard_i → image_gen_i
      { fromIndex: 1, toIndex: 5 },
      { fromIndex: 2, toIndex: 6 },
      { fromIndex: 3, toIndex: 7 },
      { fromIndex: 4, toIndex: 8 },
      // image_gen_i → video_task_i
      { fromIndex: 5, toIndex: 9 },
      { fromIndex: 6, toIndex: 10 },
      { fromIndex: 7, toIndex: 11 },
      { fromIndex: 8, toIndex: 12 },
    ],
  },
  {
    id: "image-batch",
    name: "批量图像生成",
    desc: "提示词 → 4图像生成节点",
    icon: "🖼️",
    nodes: [
      { type: "prompt", dx: 0, dy: 0 },
      { type: "image_gen", dx: 0, dy: 350, count: 4, spacing: 380 },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 0, toIndex: 2 },
      { fromIndex: 0, toIndex: 3 },
      { fromIndex: 0, toIndex: 4 },
    ],
  },
  {
    id: "ai-storyboard",
    name: "AI 辅助分镜",
    desc: "AI对话 → 分镜 → 图像",
    icon: "🤖",
    nodes: [
      { type: "ai_chat", dx: 0, dy: 0 },
      { type: "storyboard", dx: 0, dy: 400 },
      { type: "image_gen", dx: 0, dy: 750 },
      { type: "video_task", dx: 0, dy: 1100 },
    ],
    edgeSpecs: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 2, toIndex: 3 },
    ],
  },
];

interface Props {
  onClose: () => void;
  centerX: number;
  centerY: number;
}

export function TemplatePanel({ onClose, centerX, centerY }: Props) {
  const { addNode, onConnect } = useCanvasStore();

  const applyTemplate = useCallback(
    (template: Template) => {
      // Resolve all node specs into a flat list of { type, x, y }
      const resolvedNodes: Array<{ type: NodeType; x: number; y: number; id: string }> = [];

      // Compute total width of the widest row to center it
      const totalWidth = 4 * 380; // max row width (4 nodes with 380 spacing)
      const startX = centerX - totalWidth / 2;

      for (const spec of template.nodes) {
        const count = spec.count ?? 1;
        const spacing = spec.spacing ?? 0;
        const rowWidth = count > 1 ? (count - 1) * spacing : 0;
        const rowStartX = startX + spec.dx - rowWidth / 2;

        for (let i = 0; i < count; i++) {
          const x = count > 1 ? rowStartX + i * spacing : startX + spec.dx;
          const y = centerY + spec.dy;
          const newNode = addNode(spec.type, { x, y });
          resolvedNodes.push({ type: spec.type, x, y, id: newNode.id });
        }
      }

      // Create edges
      if (template.edgeSpecs) {
        for (const edgeSpec of template.edgeSpecs) {
          const sourceNode = resolvedNodes[edgeSpec.fromIndex];
          const targetNode = resolvedNodes[edgeSpec.toIndex];
          if (sourceNode && targetNode) {
            onConnect({
              source: sourceNode.id,
              target: targetNode.id,
              sourceHandle: "output",
              targetHandle: "input",
            });
          }
        }
      }

      onClose();
    },
    [addNode, onConnect, centerX, centerY, onClose]
  );

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "oklch(0.10 0.007 260)", borderLeft: "1px solid oklch(0.18 0.008 260)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid oklch(0.18 0.008 260)" }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: "oklch(0.88 0.005 260)" }}>
            工作流模板
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.42 0.006 260)" }}>
            点击模板一键创建节点
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: "oklch(0.45 0.008 260)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.45 0.008 260)"; }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Template cards */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => applyTemplate(template)}
            className="w-full text-left rounded-xl p-3.5 transition-all"
            style={{
              background: "oklch(0.13 0.007 260)",
              border: "1px solid oklch(0.20 0.008 260)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)";
              (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.35)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "oklch(0.13 0.007 260)";
              (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)";
            }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0 mt-0.5">{template.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "oklch(0.85 0.005 260)" }}>
                  {template.name}
                </p>
                <p className="text-[11px] mt-1" style={{ color: "oklch(0.50 0.008 260)" }}>
                  {template.desc}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
