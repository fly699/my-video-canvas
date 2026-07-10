import { useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { X, Clapperboard, Palette, Workflow, Search } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import {
  CINEMATOGRAPHY_TEMPLATES,
  applyCinematographyToPrompt,
  applyCinematographyParams,
  clearCinematographyParamsPatch,
  type CinematographyTemplate,
} from "../../lib/cinematographyTemplates";
import { PROMPT_PRESETS, type PresetPrompt } from "../../lib/promptLibraryPresets";
import { AGENT_RECIPES, buildRecipeOps, recipeDefaultConfig, type AgentRecipe } from "../../lib/agentRecipes";
import { applyAgentOperations } from "../../lib/agentApply";
import type { VideoProvider, NodeData } from "../../../../shared/types";

/**
 * 阶段四 4.2：特效广场（内部聚合版）——把散落各处的内置创作资源聚成一个
 * 可浏览「广场」：运镜模板（30+ 电影级）/ 画风·特效提示词预设 / 工作流配方。
 * 点选即应用：运镜 → 选中的视频节点；画风特效 → 选中的带提示词节点（无选中
 * 则落一个提示词节点）；工作流 → 配方链落画布（与空画布引导卡同一管线）。
 * 不新造数据源，全部复用 cinematographyTemplates / promptLibraryPresets /
 * agentRecipes 三份既有资产。
 */
export function EffectsPlaza({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"camera" | "style" | "workflow">("camera");
  const [q, setQ] = useState("");
  const reactFlow = useReactFlow();
  const query = q.trim().toLowerCase();

  const cameras = useMemo(
    () => CINEMATOGRAPHY_TEMPLATES.filter((t) =>
      !query || t.label.toLowerCase().includes(query) || t.englishLabel.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)),
    [query],
  );
  const styles = useMemo(
    () => PROMPT_PRESETS.map((cat) => ({
      category: cat.category,
      items: cat.items.filter((i) => !query || i.label.toLowerCase().includes(query) || i.text.toLowerCase().includes(query)),
    })).filter((c) => c.items.length),
    [query],
  );
  const recipes = useMemo(
    () => AGENT_RECIPES.filter((r) => !query || r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query)),
    [query],
  );

  const applyCamera = (tpl: CinematographyTemplate) => {
    const st = useCanvasStore.getState();
    const sel = st.nodes.find((n) => n.selected && n.data.nodeType === "video_task");
    if (!sel) { toast.info("请先在画布上选中一个「视频任务」节点，再点运镜卡应用"); return; }
    const p = sel.data.payload as { prompt?: string; provider: VideoProvider; params?: Record<string, unknown> };
    st.updateNodeData(sel.id, {
      prompt: applyCinematographyToPrompt(p.prompt ?? "", tpl),
      params: { ...(p.params ?? {}), ...clearCinematographyParamsPatch(), ...applyCinematographyParams(p.provider, tpl) },
    } as Partial<NodeData>);
    toast.success(`已应用运镜「${tpl.label}」→ ${sel.data.title || "视频节点"}`);
  };

  // 各类型的提示词字段名（与画布助手 aspect/prompt 口径一致）
  const PROMPT_FIELD: Record<string, string> = {
    image_gen: "prompt", video_task: "prompt", comfyui_image: "prompt",
    comfyui_video: "prompt", storyboard: "promptText", prompt: "positivePrompt",
  };
  const applyStyle = (item: PresetPrompt) => {
    const st = useCanvasStore.getState();
    const sel = st.nodes.find((n) => n.selected && PROMPT_FIELD[n.data.nodeType]);
    if (sel) {
      const field = PROMPT_FIELD[sel.data.nodeType];
      const cur = String((sel.data.payload as Record<string, unknown>)[field] ?? "");
      if (cur.includes(item.text)) { toast.info("该效果词已在提示词里"); return; }
      const next = cur.trim() ? `${cur.replace(/\s+$/, "")}, ${item.text}` : item.text;
      st.updateNodeData(sel.id, { [field]: next } as Partial<NodeData>);
      toast.success(`已叠加「${item.label}」→ ${sel.data.title || sel.data.nodeType}`);
    } else {
      // 无合适选中 → 落一个提示词节点，可自行连到任意生成节点
      const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      try {
        const node = st.addNode("prompt", anchor);
        st.updateNodeData(node.id, { positivePrompt: item.text } as Partial<NodeData>);
        st.updateNodeTitle(node.id, item.label);
        toast.success(`已创建提示词节点「${item.label}」——连到生成节点即可生效`);
      } catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); }
    }
  };

  const applyRecipe = (r: AgentRecipe) => {
    const ops = buildRecipeOps(r, recipeDefaultConfig(r));
    const anchor = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 560, y: window.innerHeight / 2 - 260 });
    const res = applyAgentOperations(ops, anchor, {});
    if (res.created > 0) {
      toast.success(`已落地「${r.name}」工作流（${res.created} 个节点）——填内容后即可逐个生成`);
      onClose();
      setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 400 }), 120);
    }
  };

  const TabBtn = ({ k, label, Icon }: { k: typeof tab; label: string; Icon: typeof Clapperboard }) => (
    <button
      onClick={() => setTab(k)}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-colors"
      style={{ fontSize: 12.5, fontWeight: 700, background: tab === k ? "var(--c-elevated)" : "transparent", color: tab === k ? "var(--c-t1)" : "var(--c-t3)", border: `1px solid ${tab === k ? "var(--c-bd2)" : "transparent"}`, cursor: "pointer" }}
    >
      <Icon size={14} /> {label}
    </button>
  );

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 12px",
    borderRadius: 12, background: "var(--c-surface)", border: "1px solid var(--c-bd1)",
    cursor: "pointer", textAlign: "left", transition: "border-color 120ms ease, background 120ms ease",
  };
  const hoverOn = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)"; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; };
  const hoverOff = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "oklch(0 0 0 / 0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(94vw, 920px)", height: "min(86vh, 640px)", display: "flex", flexDirection: "column", borderRadius: 16, background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 24px 80px oklch(0 0 0 / 0.55)", overflow: "hidden" }}>
        {/* 头部：标题 + tabs + 搜索 + 关闭 */}
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--c-t1)", marginRight: 6 }}>✨ 特效广场</span>
          <TabBtn k="camera" label={`运镜 ${CINEMATOGRAPHY_TEMPLATES.length}`} Icon={Clapperboard} />
          <TabBtn k="style" label="画风 · 特效" Icon={Palette} />
          <TabBtn k="workflow" label={`工作流 ${AGENT_RECIPES.length}`} Icon={Workflow} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 rounded-lg px-2" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
            <Search size={12} style={{ color: "var(--c-t4)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…"
              className="bg-transparent outline-none py-1.5" style={{ fontSize: 12, color: "var(--c-t1)", width: 140 }} />
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: "var(--c-t4)", cursor: "pointer" }} title="关闭">
            <X size={15} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {tab === "camera" && (
            <>
              <p style={{ fontSize: 11, color: "var(--c-t4)", margin: "0 0 10px" }}>点卡片应用到当前选中的「视频任务」节点（写入提示词 + 按模型映射原生运镜参数）</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {cameras.map((t) => (
                  <button key={t.id} style={cardStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => applyCamera(t)}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)" }}>{t.emoji} {t.label} <span style={{ fontSize: 10, color: "var(--c-t4)", fontWeight: 500 }}>{t.englishLabel}</span></span>
                    <span style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.5 }}>{t.description}</span>
                  </button>
                ))}
                {cameras.length === 0 && <p style={{ fontSize: 12, color: "var(--c-t4)" }}>无匹配运镜</p>}
              </div>
            </>
          )}
          {tab === "style" && (
            <>
              <p style={{ fontSize: 11, color: "var(--c-t4)", margin: "0 0 10px" }}>点卡片叠加到当前选中节点的提示词；未选中节点则创建独立提示词节点</p>
              {styles.map((cat) => (
                <div key={cat.category} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--c-t3)", margin: "0 0 6px" }}>{cat.category}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
                    {cat.items.map((it) => (
                      <button key={it.label} style={cardStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => applyStyle(it)} title={it.text}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)" }}>{it.label}</span>
                        <span style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {styles.length === 0 && <p style={{ fontSize: 12, color: "var(--c-t4)" }}>无匹配预设</p>}
            </>
          )}
          {tab === "workflow" && (
            <>
              <p style={{ fontSize: 11, color: "var(--c-t4)", margin: "0 0 10px" }}>点卡片把整条工作流链落到画布（脚本→分镜→视频→合并，可撤销）</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
                {recipes.map((r) => (
                  <button key={r.id} style={cardStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => applyRecipe(r)}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--c-t1)" }}>
                      {r.name}
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}>{r.category}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.5 }}>{r.desc}</span>
                    <span style={{ fontSize: 10, color: "var(--c-t4)" }}>默认 {r.defaults.shots} 镜 · {r.defaults.aspect} · 每镜 {r.defaults.durationEach}s</span>
                  </button>
                ))}
                {recipes.length === 0 && <p style={{ fontSize: 12, color: "var(--c-t4)" }}>无匹配工作流</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
