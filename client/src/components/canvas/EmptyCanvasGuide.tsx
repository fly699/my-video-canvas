import { useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { BookOpen, User, Film, Music, Plus, LayoutGrid, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { applyAgentOperations } from "@/lib/agentApply";
import { AGENT_RECIPES, buildRecipeOps, recipeDefaultConfig } from "@/lib/agentRecipes";
import { CanvasBuildWizard } from "./CanvasBuildWizard";
import type { AgentOperation } from "../../../../shared/types";

/**
 * 空画布引导（对标 LibTV）：中央提示「双击画布 添加节点」+ 四张工作流入口卡，
 * 点击即把整条工作流链落到画布（复用配方 buildRecipeOps / 手工 ops +
 * applyAgentOperations——与智能体/配方同一条应用管线，可撤销可协作同步）。
 * 画布一旦有节点即消失；加载期延迟显示避免闪现。
 */

type GuideCard = { id: string; label: string; desc: string; icon: React.ReactNode; ops: () => AgentOperation[] };

function recipeOps(recipeId: string): AgentOperation[] {
  const recipe = AGENT_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return [];
  return buildRecipeOps(recipe, recipeDefaultConfig(recipe));
}

const CARDS: GuideCard[] = [
  {
    id: "story", label: "故事短片", desc: "脚本 → 分镜 → 视频 → 成片",
    icon: <BookOpen size={16} />, ops: () => recipeOps("drama"),
  },
  {
    id: "charSheet", label: "角色三视图", desc: "角色设定 → 三视图设定图",
    icon: <User size={16} />,
    ops: () => [
      { op: "create", nodeType: "character", tempId: "c1", payload: { characterKind: "person", name: "主角" }, note: "角色设定" },
      {
        op: "create", nodeType: "image_gen", tempId: "i1", title: "角色三视图",
        // 「collage」措辞有意保留：三视图本就是多视图单图，触发防宫格守卫的跳过分支。
        payload: { prompt: "character design turnaround collage, front view + side view + back view, full body, consistent design, plain studio background, character reference sheet", aspectRatio: "16:9" },
        note: "三视图设定图",
      },
      { op: "connect", sourceRef: "c1", targetRef: "i1" },
    ],
  },
  {
    id: "i2v", label: "首帧图生视频", desc: "生成首帧图 → 图生视频",
    icon: <Film size={16} />,
    ops: () => [
      { op: "create", nodeType: "image_gen", tempId: "i1", title: "首帧图", payload: { prompt: "", aspectRatio: "16:9" }, note: "首帧关键画面" },
      { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "" }, note: "图生视频" },
      { op: "connect", sourceRef: "i1", targetRef: "v1" },
    ],
  },
  {
    id: "mv", label: "卡点音乐 MV", desc: "快切分镜 → 生图生视频 → 配乐",
    icon: <Music size={16} />, ops: () => recipeOps("music_mv"),
  },
];

export function EmptyCanvasGuide({ onAddNode, onImportWorkflow }: {
  /** 「添加第一个节点」按钮：打开节点选择器（Canvas 传 setShowNodePicker(true)）。 */
  onAddNode?: () => void;
  /** 「导入工作流」按钮：Canvas 传 addComfyWorkflowWithWizard。 */
  onImportWorkflow?: () => void;
} = {}) {
  const reactFlow = useReactFlow();
  const nodeCount = useCanvasStore((s) => s.nodes.length);
  const [showWizard, setShowWizard] = useState(false);
  // 加载期（boot 骨架/数据未回）画布短暂为空——延迟 1.2s 再显示，避免闪现误导。
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, []);
  if (!ready || nodeCount > 0) return null;

  const runCard = (card: GuideCard) => {
    const ops = card.ops();
    if (!ops.length) return;
    const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 560, y: window.innerHeight / 2 - 260 });
    const res = applyAgentOperations(ops, anchor, {});
    if (res.created > 0) {
      toast.success(`已按「${card.label}」搭好工作流（${res.created} 个节点）——填内容后即可逐个生成`);
      setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 400 }), 120);
    }
  };

  return (
    <div style={{
      position: "fixed", left: "50%", top: "44%", transform: "translate(-50%, -50%)", zIndex: 25,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 22, pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--c-t3)" }}>
        <span style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", fontSize: 11 }}>🖱</span>
        <span><strong style={{ color: "var(--c-t2)" }}>双击画布</strong> 添加节点 · 或用向导 / 工作流卡快速开始</span>
      </div>
      {/* #159 建立向导：分步选择需求 → 自动搭建节点链 + 功能分区群组。放在最显眼处。 */}
      <div style={{ pointerEvents: "auto" }}>
        <button
          onClick={() => setShowWizard(true)}
          className="nodrag"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 12, fontSize: 13.5, fontWeight: 800,
            border: "none", cursor: "pointer", color: "#fff",
            background: "linear-gradient(135deg, oklch(0.66 0.21 300), oklch(0.70 0.20 320))",
            boxShadow: "0 6px 20px oklch(0.66 0.21 300 / 0.35)",
          }}
        >
          <Wand2 size={17} /> 建立向导 · 分步搭建工作流
        </button>
      </div>
      {showWizard && <CanvasBuildWizard onClose={() => setShowWizard(false)} />}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: "min(92vw, 1080px)", pointerEvents: "auto" }}>
        {CARDS.map((card) => (
          <button
            key={card.id}
            onClick={() => runCard(card)}
            className="nodrag"
            style={{
              display: "flex", alignItems: "center", gap: 10, width: 236, padding: "13px 16px", textAlign: "left",
              borderRadius: 12, border: "1px solid var(--c-bd2)", background: "color-mix(in oklch, var(--c-surface) 88%, transparent)",
              color: "var(--c-t1)", cursor: "pointer", transition: "border-color 0.15s, transform 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "oklch(0.70 0.20 310 / 0.6)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; e.currentTarget.style.transform = "none"; }}
          >
            <span style={{ display: "inline-flex", width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, background: "oklch(0.70 0.20 310 / 0.14)", color: "oklch(0.75 0.18 310)", flexShrink: 0 }}>
              {card.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{card.label}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.desc}</span>
            </span>
          </button>
        ))}
      </div>
      {/* #152 单一空态：显式「添加第一个节点 / 导入工作流」按钮并入此处（原独立 CTA
          与本引导重叠、工作流卡盖住按钮致其点击失效——已合并，避免双层遮挡）。 */}
      {(onAddNode || onImportWorkflow) && (
        <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
          {onAddNode && (
            // stopPropagation：否则点击冒泡到画布 pane 的全局 click 会立即 setShowNodePicker(false)，
            // 净效果是「点了没反应」——这正是用户报的「添加节点按钮无效」根因（与重叠无关）。
            <button onClick={(e) => { e.stopPropagation(); onAddNode(); }} onPointerDown={(e) => e.stopPropagation()} className="nodrag"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: "var(--color-brand, oklch(0.62 0.2 285))", color: "#fff", border: "none", cursor: "pointer" }}>
              <Plus className="w-4 h-4" /> 添加第一个节点
            </button>
          )}
          {onImportWorkflow && (
            <button onClick={(e) => { e.stopPropagation(); onImportWorkflow(); }} onPointerDown={(e) => e.stopPropagation()} className="nodrag"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: "var(--c-surface)", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", cursor: "pointer" }}>
              <LayoutGrid className="w-4 h-4" /> 导入工作流
            </button>
          )}
        </div>
      )}
    </div>
  );
}
