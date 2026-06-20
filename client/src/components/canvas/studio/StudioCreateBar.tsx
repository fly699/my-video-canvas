import { useState } from "react";
import { ArrowUp, Sparkles, X, History, Trash2, ChevronDown } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { makeRefImage, refPatch } from "../../../lib/referenceImages";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { RatioPicker, RATIOS } from "./StudioCommandBar";

interface HistItem { prompt: string; model: string; ratio: string; refUrl?: string; t: number }
const HIST_KEY = "avc:studio-create-history";
const COLLAPSE_KEY = "avc:studio-createbar-collapsed";
const readHist = (): HistItem[] => { try { const r = localStorage.getItem(HIST_KEY); return r ? (JSON.parse(r) as HistItem[]) : []; } catch { return []; } };
const writeHist = (h: HistItem[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch { /* quota */ } };

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
  const isEmptyCanvas = useCanvasStore((s) => s.nodes.length === 0);
  const reactFlow = useReactFlow();
  const { resolve } = useNodeDefaultModels();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [refUrl, setRefUrl] = useState("");      // dropped reference image → 图生图
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<HistItem[]>(readHist);
  const [showHist, setShowHist] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } });
  const toggleCollapsed = (v: boolean) => { setCollapsed(v); try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* quota */ } };

  if (uiStyle !== "studio" || anySelected) return null;

  // Collapsed → a small pill, so the always-on bar never gets in the way.
  if (collapsed) {
    return (
      <button className="nodrag studio-toolbtn" onClick={() => toggleCollapsed(false)} title="展开快速创作栏"
        style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 44,
          display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 17,
          background: "color-mix(in oklch, var(--c-elevated) 94%, transparent)", backdropFilter: "blur(20px)",
          border: "1px solid var(--c-bd2)", boxShadow: "var(--c-node-shadow-hover)", color: "var(--ui-accent, var(--c-t2))",
          fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        <Sparkles size={14} /> 快速创作
      </button>
    );
  }
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
    if (text) {
      const item: HistItem = { prompt: text, model: mdl, ratio, refUrl: refUrl || undefined, t: Date.now() };
      setHistory((prev) => {
        const next = [item, ...prev.filter((h) => !(h.prompt === item.prompt && h.model === item.model && h.ratio === item.ratio))].slice(0, 12);
        writeHist(next);
        return next;
      });
    }
    setPrompt(""); setRefUrl("");
  };

  const applyHist = (h: HistItem) => { setPrompt(h.prompt); setModel(h.model); setRatio(h.ratio); setRefUrl(h.refUrl ?? ""); setShowHist(false); };
  const clearHist = () => { setHistory([]); writeHist([]); setShowHist(false); };

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
      {isEmptyCanvas && !showHist && (
        <div className="nodrag" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0, textAlign: "center",
          fontSize: 12, color: "var(--c-t3)", pointerEvents: "none" }}>
          画布是空的 —— 输入提示词生成第一张，或用顶部「添加」放置节点
        </div>
      )}
      {showHist && history.length > 0 && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto",
            background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "var(--c-node-shadow-hover)", padding: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 6px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)" }}>创作历史</span>
            <button onClick={clearHist} title="清空历史" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--c-t4)", background: "none", border: "none", cursor: "pointer" }}><Trash2 size={11} /> 清空</button>
          </div>
          {history.map((h, i) => (
            <button key={i} onClick={() => applyHist(h)}
              className="studio-toolbtn"
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 9,
                border: "none", background: "transparent", cursor: "pointer", color: "var(--c-t1)" }}>
              {h.refUrl && <img src={h.refUrl} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid var(--c-bd2)" }} />}
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.prompt}</span>
              <span style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>{h.ratio}</span>
            </button>
          ))}
        </div>
      )}

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
        <button className="studio-toolbtn" title="收起创作栏" onClick={() => toggleCollapsed(true)}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7,
            border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" }}>
          <ChevronDown size={14} />
        </button>
        {history.length > 0 && (
          <button className="studio-toolbtn" title="创作历史" onClick={() => setShowHist((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 30, padding: "0 9px", borderRadius: 9,
              border: `1px solid ${showHist ? "var(--ui-accent)" : "var(--c-bd2)"}`, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
              background: "var(--c-surface)", color: "var(--c-t2)" }}>
            <History size={13} /> 历史
          </button>
        )}
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
