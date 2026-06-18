import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { getNodeConfig } from "../../../lib/nodeConfig";
import { NodeInput, NodeTextArea } from "../NodeTextInput";
import { X } from "lucide-react";

// Studio-only right-side inspector. Renders the selected node's primary editable
// fields in a docked panel. It writes through the SAME store actions the node body
// uses (updateNodeData / updateNodeTitle), so edits stay perfectly in sync with the
// node and auto-apply to any future node — zero logic duplication. Returns null in
// "pro" or when not exactly one node is selected, so it is purely additive.
const TEXT_FIELD_PRIORITY = [
  "prompt", "content", "description", "positivePrompt", "promptText",
  "ttsText", "musicPrompt", "text",
] as const;

const TEXT_FIELD_LABEL: Record<string, string> = {
  prompt: "提示词", content: "内容", description: "描述", positivePrompt: "正向提示词",
  promptText: "提示词", ttsText: "配音文本", musicPrompt: "音乐描述", text: "文本",
};

export function StudioInspector() {
  const { uiStyle } = useUIStyle();
  // Select PRIMITIVES / stable refs only — returning a fresh array/object from a
  // zustand selector on every render triggers an infinite update loop.
  const selectedId = useCanvasStore((s) => {
    let id: string | null = null, count = 0;
    for (const n of s.nodes) { if (n.selected) { count++; id = n.id; } }
    return count === 1 ? id : null;
  });
  const node = useCanvasStore((s) => (selectedId ? s.nodes.find((n) => n.id === selectedId) : undefined));
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeTitle = useCanvasStore((s) => s.updateNodeTitle);
  const setNodes = useCanvasStore((s) => s.setNodes);

  if (uiStyle !== "studio" || !node) return null;

  const cfg = getNodeConfig(node.data.nodeType);
  const payload = node.data.payload as Record<string, unknown>;
  const textField = TEXT_FIELD_PRIORITY.find((k) => typeof payload[k] === "string");

  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const videoUrl = str("videoUrl") || str("resultVideoUrl") || str("outputVideoUrl");
  const imageUrl = str("imageUrl") || str("resultImageUrl") || str("outputImageUrl");
  const hasAspect = typeof payload.aspectRatio === "string";
  const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

  const deselect = () => setNodes(useCanvasStore.getState().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)));

  const box: React.CSSProperties = {
    width: "100%", fontSize: 13, padding: "9px 11px", borderRadius: 10,
    background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)",
    outline: "none", lineHeight: 1.55,
  };

  return (
    <div
      className="nodrag"
      data-studio-inspector
      style={{
        position: "absolute", top: 64, right: 14, bottom: 14, width: 312, zIndex: 40,
        background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 16,
        boxShadow: "var(--c-node-shadow-selected)", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 15px", borderBottom: "1px solid var(--c-bd1)" }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: `${cfg.color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: cfg.color, display: "inline-block" }} />
        </span>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--c-t1)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg.label}</div>
        <button onClick={deselect} title="收起" style={{ border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer", display: "flex", padding: 2 }}><X size={16} /></button>
      </div>

      {/* body */}
      <div style={{ padding: 15, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
        {/* media-first preview (read-only) */}
        {(videoUrl || imageUrl) && (
          <div style={{ borderRadius: 12, overflow: "hidden", background: "var(--c-canvas)", border: "1px solid var(--c-bd1)" }}>
            {videoUrl
              ? <video src={videoUrl} controls style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "contain", background: "#000" }} />
              : <img src={imageUrl} alt="" style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "contain", background: "#000" }} />}
          </div>
        )}

        <label style={{ display: "block" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t3)", marginBottom: 7 }}>标题</div>
          <NodeInput value={node.data.title} onValueChange={(v) => updateNodeTitle(node.id, v)} style={box} />
        </label>

        {textField ? (
          <label style={{ display: "block" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t3)", marginBottom: 7 }}>{TEXT_FIELD_LABEL[textField] ?? textField}</div>
            <NodeTextArea
              value={String(payload[textField] ?? "")}
              onValueChange={(v) => updateNodeData(node.id, { [textField]: v })}
              rows={7}
              style={{ ...box, resize: "vertical", minHeight: 120 }}
            />
          </label>
        ) : (videoUrl || imageUrl) ? null : (
          <div style={{ fontSize: 12.5, color: "var(--c-t3)", lineHeight: 1.6 }}>该节点的参数请在节点卡片上直接编辑；右栏会随更多节点逐步支持。</div>
        )}

        {/* negative prompt (only when present) */}
        {typeof payload.negativePrompt === "string" && (
          <label style={{ display: "block" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t3)", marginBottom: 7 }}>反向提示词</div>
            <NodeTextArea
              value={String(payload.negativePrompt ?? "")}
              onValueChange={(v) => updateNodeData(node.id, { negativePrompt: v })}
              rows={3}
              style={{ ...box, resize: "vertical", minHeight: 60 }}
            />
          </label>
        )}

        {/* aspect ratio (only when the node has the field) */}
        {hasAspect && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t3)", marginBottom: 7 }}>画面比例</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {RATIOS.map((r) => {
                const active = payload.aspectRatio === r;
                return (
                  <button key={r} onClick={() => updateNodeData(node.id, { aspectRatio: r })}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
                      background: active ? `${cfg.color}22` : "var(--c-input)",
                      border: `1px solid ${active ? cfg.color : "var(--c-bd2)"}`,
                      color: active ? cfg.color : "var(--c-t2)",
                    }}>{r}</button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--c-t4)", lineHeight: 1.6, marginTop: "auto", paddingTop: 8 }}>
          在此编辑会实时同步到画布节点（读写同一份数据）。
        </div>
      </div>
    </div>
  );
}
