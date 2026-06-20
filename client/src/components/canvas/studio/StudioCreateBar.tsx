import { useState } from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { makeRefImage, refPatch } from "../../../lib/referenceImages";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { RatioPicker, RATIOS } from "./StudioCommandBar";

// Parse the canvas asset-drag payload → image URLs (mirrors BaseNode's reader).
function imageUrlsFromAssetDrag(dt: DataTransfer): string[] {
  const raw = dt.getData("application/x-asset-list");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{ url?: string; type?: string }>;
    return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
  } catch { return []; }
}

// Liblib-style global "creation bar": a persistent bottom-center prompt → 生成 surface.
// Studio-only and shown only when NOTHING is selected (so it never fights the per-node
// command bar or the multi-select bar). Generating spawns a pre-filled image_gen node at
// the viewport center and runs it — reuses addNode / updateNodeData / requestRun.
export function StudioCreateBar() {
  const { uiStyle } = useUIStyle();
  const anySelected = useCanvasStore((s) => s.nodes.some((n) => n.selected));
  const reactFlow = useReactFlow();
  const { resolve } = useNodeDefaultModels();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [refUrl, setRefUrl] = useState("");      // dropped reference image → 图生图
  const [dragOver, setDragOver] = useState(false);

  if (uiStyle !== "studio" || anySelected) return null;
  const mdl = model || resolve("image_gen", "image");
  const text = prompt.trim();

  const create = (run: boolean) => {
    const vp = reactFlow.getViewport();
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    const st = useCanvasStore.getState();
    let node;
    try {
      node = st.addNode("image_gen", { x: cx - 150, y: cy - 110 });
    } catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); return; }
    st.updateNodeData(node.id, {
      prompt: text, model: mdl, aspectRatio: ratio,
      ...(refUrl ? refPatch([makeRefImage(refUrl, "upload")]) : {}),
    });
    st.setNodes(st.nodes.map((n) => ({ ...n, selected: n.id === node!.id })));
    if (run && text) { st.requestRun(null, [node.id]); toast.success(refUrl ? "已创建图生图并开始生成" : "已创建并开始生成", { duration: 1200 }); }
    setPrompt(""); setRefUrl("");
  };

  return (
    <div
      className="nodrag"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-asset-list")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => {
        setDragOver(false);
        const urls = imageUrlsFromAssetDrag(e.dataTransfer);
        if (urls.length) { e.preventDefault(); e.stopPropagation(); setRefUrl(urls[0]); }
      }}
      style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 44,
        width: "min(680px, 92vw)", display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 16,
        background: "color-mix(in oklch, var(--c-elevated) 94%, transparent)", backdropFilter: "blur(20px)",
        border: `1px solid ${dragOver ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, boxShadow: "var(--c-node-shadow-hover)" }}
    >
      <div style={{ position: "relative" }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text) create(true); } }}
          rows={1}
          placeholder="描述你想生成的画面，回车 ⌘/Ctrl+Enter 直接生成…"
          className="nodrag"
          style={{ width: "100%", fontSize: 13.5, padding: "9px 11px", borderRadius: 11, background: "var(--c-input)",
            border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", resize: "none", lineHeight: 1.5, minHeight: 38 }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--ui-accent, var(--c-t2))" }}>
          <Sparkles size={13} /> 快速创作
        </span>
        {refUrl ? (
          <span title="图生图参考图（拖入替换）" style={{ position: "relative", width: 30, height: 30, borderRadius: 7, overflow: "hidden", border: "1px solid var(--c-bd2)", flexShrink: 0 }}>
            <img src={refUrl} alt="参考图" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button onClick={() => setRefUrl("")} title="移除参考图"
              style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, border: "none", borderRadius: "0 0 0 5px", background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={9} /></button>
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "var(--c-t4)" }}>（可拖入图片做图生图）</span>
        )}
        <ModelPicker value={mdl} onChange={setModel} options={IMAGE_MODEL_PICKER_OPTIONS} minWidth={140} />
        <RatioPicker value={ratio} options={RATIOS} onChange={setRatio} />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => create(false)}
            title="仅创建节点（不立即生成）"
            className="studio-toolbtn"
            style={{ height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid var(--c-bd2)", cursor: "pointer",
              fontSize: 12, fontWeight: 600, background: "var(--c-surface)", color: "var(--c-t2)" }}
          >仅创建</button>
          <button
            onClick={() => create(true)}
            disabled={!text}
            title="创建并生成"
            className="studio-send" data-state={text ? "run" : "off"}
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", flexShrink: 0,
              background: text ? "#fff" : "var(--c-surface)", color: text ? "#111" : "var(--c-t4)",
              cursor: text ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}
          ><ArrowUp size={17} /></button>
        </div>
      </div>
    </div>
  );
}
