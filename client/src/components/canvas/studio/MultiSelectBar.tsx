import { useState } from "react";
import { Play, Combine, Download, X, Clapperboard, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { getNodeImageOutput } from "../../../lib/canvasPassthrough";
import { planAutoAssemble } from "../../../lib/autoAssemble";
import { downloadMedia } from "../../../lib/download";
import { RatioPicker, RATIOS } from "./StudioCommandBar";
import { useStudioExpandAll } from "../../../hooks/useStudioExpandAll";

// ★10：多选批量改参数——把「统一画面比例 / 展开全部参数」一次性应用到所有选中节点。
// 不同节点的比例字段名不同，按类型映射；只写它真正支持的字段，避免污染无关 payload。
const RATIO_FIELD: Record<string, string> = {
  image_gen: "aspectRatio", storyboard: "aspectRatio", prompt: "aspectRatio",
  comfyui_image: "aspectRatio", comfyui_workflow: "aspectRatio",
};
const CLIP_RATIOS = new Set(["9:16", "16:9", "1:1"]); // clip 节点的 aspect 仅支持这几种

// Studio-only floating action bar shown when ≥2 nodes are selected: run-all / group /
// download-all / clear. Additive & presentation-layer — every action reuses an existing
// store action (requestRun / groupSelected / setNodes) so it can't diverge from normal use.

const VIDEO_OUT_TYPES = new Set(["clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "overlay", "video_task", "comfyui_video", "comfyui_workflow", "lip_sync", "avatar"]);
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

function nodeMedia(nodeType: string, payload: Record<string, unknown>): { url: string; type: "image" | "video" } | null {
  const v = (payload.resultVideoUrl ?? payload.videoUrl) as unknown;
  if (typeof v === "string" && v) return { url: v, type: "video" };
  const out = payload.outputUrl as unknown;
  if (typeof out === "string" && out) {
    return { url: out, type: isVideoUrl(out) || VIDEO_OUT_TYPES.has(nodeType) ? "video" : "image" };
  }
  const img = getNodeImageOutput(nodeType, payload as never);
  return img ? { url: img, type: "image" } : null;
}

export function MultiSelectBar() {
  const { uiStyle } = useUIStyle();
  // Re-render only when the selected (non-group) set changes — cheap stable key.
  const selectedKey = useCanvasStore((s) => s.nodes.filter((n) => n.selected && n.data.nodeType !== "group").map((n) => n.id).join(","));
  const [showParams, setShowParams] = useState(false);
  const [expandAll, setExpandAll] = useStudioExpandAll();
  const ids = selectedKey ? selectedKey.split(",") : [];
  if (uiStyle !== "studio" || ids.length < 2) return null;

  // ★10：把画面比例统一写入所有支持该字段的选中节点（clip 用 aspect 且仅限 9:16/16:9/1:1，
  // comfyui_workflow 需联动 overrideRatioSize，否则比例覆盖不生效）。
  const applyRatio = (ratio: string) => {
    const st = useCanvasStore.getState();
    const sel = new Set(ids);
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    for (const n of st.nodes) {
      if (!sel.has(n.id)) continue;
      const t = n.data.nodeType;
      if (t === "clip") {
        if (CLIP_RATIOS.has(ratio)) updates.push({ id: n.id, payload: { aspect: ratio } });
      } else if (RATIO_FIELD[t]) {
        const patch: Record<string, unknown> = { [RATIO_FIELD[t]]: ratio };
        if (t === "comfyui_workflow") patch.overrideRatioSize = true;
        updates.push({ id: n.id, payload: patch });
      }
    }
    if (!updates.length) { toast.info("所选节点没有可统一比例的项"); return; }
    st.batchUpdateNodeData(updates);
    toast.success(`已将 ${updates.length} 个节点比例统一为 ${ratio}`, { duration: 1500 });
  };

  const runAll = () => { useCanvasStore.getState().requestRun(null, ids); toast.success(`运行所选 ${ids.length} 个节点`, { duration: 1200 }); };
  // 一键自动成片：把选中的多段已完成视频自动建一个合并节点、连好线（+ 选中的配乐音频）、
  // 设默认转场并运行。排序与配乐识别交给 MergeNode。
  const autoAssemble = () => {
    const st = useCanvasStore.getState();
    const sel = st.nodes.filter((n) => ids.includes(n.id));
    const plan = planAutoAssemble(sel.map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, payload: n.data.payload as Record<string, unknown> } })));
    if (plan.videoNodeIds.length < 2) { toast.error("请至少选中 2 段「已完成」的视频再自动成片"); return; }
    const vidNodes = sel.filter((n) => plan.videoNodeIds.includes(n.id));
    const maxX = Math.max(...vidNodes.map((n) => n.position.x));
    const avgY = vidNodes.reduce((s, n) => s + n.position.y, 0) / vidNodes.length;
    const merge = st.addNode("merge", { x: maxX + 440, y: Math.round(avgY) });
    for (const vid of plan.videoNodeIds) {
      st.onConnect({ source: vid, target: merge.id, sourceHandle: null, targetHandle: "input" });
    }
    if (plan.audioNodeId) {
      st.onConnect({ source: plan.audioNodeId, target: merge.id, sourceHandle: null, targetHandle: "input" });
    }
    st.updateNodeData(merge.id, { transition: "fade", transitionDuration: 0.5 });
    // 选中新合并节点、取消其它，便于用户立刻看到/调整。
    st.setNodes(st.nodes.map((n) => (n.selected !== (n.id === merge.id) ? { ...n, selected: n.id === merge.id } : n)));
    st.requestRun(null, [merge.id]);
    toast.success(`自动成片：装配 ${plan.videoNodeIds.length} 段${plan.audioNodeId ? " + 配乐" : ""} · 淡入淡出转场，开始合成…`, { duration: 3000 });
  };
  const group = () => { const gid = useCanvasStore.getState().groupSelected(ids); if (gid) toast.success(`已组合 ${ids.length} 个节点`, { duration: 1200 }); };
  const clear = () => { const st = useCanvasStore.getState(); st.setNodes(st.nodes.map((n) => (n.selected ? { ...n, selected: false } : n))); };
  const downloadAll = () => {
    const st = useCanvasStore.getState();
    const sel = new Set(ids);
    let k = 0;
    for (const n of st.nodes) {
      if (!sel.has(n.id)) continue;
      const m = nodeMedia(n.data.nodeType, n.data.payload as Record<string, unknown>);
      if (!m) continue;
      const ext = m.type === "video" ? "mp4" : "png";
      void downloadMedia(m.url, `${n.data.title || n.data.nodeType}.${ext}`, m.type);
      k++;
    }
    toast[k > 0 ? "success" : "info"](k > 0 ? `开始下载 ${k} 个结果` : "所选节点暂无可下载的结果");
  };

  return (
    <div
      className="nodrag"
      style={{ position: "fixed", bottom: 84, left: "50%", transform: "translateX(-50%)", zIndex: 45,
        display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 14,
        background: "color-mix(in oklch, var(--c-elevated) 92%, transparent)", backdropFilter: "blur(18px)",
        border: "1px solid var(--c-bd2)", boxShadow: "var(--c-node-shadow-hover)" }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t2)", padding: "0 6px" }}>{ids.length} 个已选</span>
      <span style={{ width: 1, height: 18, background: "var(--c-bd2)" }} />
      <BarBtn onClick={runAll} icon={<Play size={13} />} label="运行全部" primary />
      <BarBtn onClick={autoAssemble} icon={<Clapperboard size={13} />} label="自动成片" />
      <div style={{ position: "relative" }}>
        <BarBtn onClick={() => setShowParams((v) => !v)} icon={<SlidersHorizontal size={13} />} label="批量参数" active={showParams} />
        {showParams && (
          <div className="nodrag" onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
              width: 232, padding: 12, borderRadius: 12, display: "flex", flexDirection: "column", gap: 12,
              background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "var(--c-node-shadow-hover)" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginBottom: 7 }}>统一画面比例</div>
              <RatioPicker value="" options={RATIOS} onChange={applyRatio} />
              <p style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 6, lineHeight: 1.5 }}>应用到所有支持比例的选中节点</p>
            </div>
            <label className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--c-t2)", fontWeight: 600 }}>
              <input type="checkbox" checked={expandAll} onChange={(e) => setExpandAll(e.target.checked)} />
              展开全部参数（所有节点）
            </label>
          </div>
        )}
      </div>
      <BarBtn onClick={group} icon={<Combine size={13} />} label="成组" />
      <BarBtn onClick={downloadAll} icon={<Download size={13} />} label="下载全部" />
      <BarBtn onClick={() => { setShowParams(false); clear(); }} icon={<X size={13} />} label="取消" />
    </div>
  );
}

function BarBtn({ onClick, icon, label, primary, active }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean; active?: boolean }) {
  return (
    <button
      className="studio-toolbtn"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 11px", borderRadius: 9,
        border: primary ? "none" : `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, cursor: "pointer", fontSize: 12, fontWeight: 600,
        background: primary ? "var(--ui-accent, var(--c-accent))" : active ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)",
        color: primary ? "#0b0d12" : active ? "var(--c-t1)" : "var(--c-t2)" }}
    >
      {icon}{label}
    </button>
  );
}
