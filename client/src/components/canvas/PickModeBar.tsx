import { useEffect } from "react";
import { createPortal } from "react-dom";
import { MousePointerClick, Upload } from "lucide-react";
import { toast } from "sonner";
import { usePickStore } from "../../hooks/usePickStore";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeImageOutput } from "../../lib/canvasPassthrough";

/**
 * 画布拾取模式浮条（LibTV）：「从画布选择参考 / 元素选择模式」——
 * 顶部浮条 + window capture 点击拦截：点画布节点即取其产物图，派回发起节点。
 * ref 可连选；mark 选一张即结束（进入元素分析）。挂在 Canvas 一份。
 */
export function PickModeBar() {
  const { kind, forNodeId, end } = usePickStore();

  useEffect(() => {
    if (!kind || !forNodeId) return;
    const onClick = (e: MouseEvent) => {
      const nodeEl = (e.target as HTMLElement).closest?.(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return; // 点空白/浮条不拦截
      const nodeId = nodeEl.getAttribute("data-id");
      if (!nodeId || nodeId === forNodeId) return;
      const st = useCanvasStore.getState();
      const n = st.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      const p = n.data.payload as Record<string, unknown>;
      // 产物图优先，参考图兜底（角色/素材节点也能被拾取）
      const url = getNodeImageOutput(n.data.nodeType, p as never)
        || (typeof p.imageUrl === "string" ? p.imageUrl : undefined)
        || (typeof p.referenceImageUrl === "string" ? p.referenceImageUrl : undefined)
        || (typeof p.url === "string" && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(p.url) ? p.url : undefined);
      if (!url) { e.preventDefault(); e.stopPropagation(); toast.info("该节点没有可用的图像产物，换一个试试"); return; }
      e.preventDefault(); e.stopPropagation();
      window.dispatchEvent(new CustomEvent("canvas:pick-result", { detail: { forNodeId, kind, url, sourceTitle: n.data.title } }));
      if (kind === "mark") { usePickStore.getState().end(); }
      else { toast.success(`已添加参考：${n.data.title}（可继续点选，完成后「返回节点」）`, { duration: 1600 }); }
    };
    // capture 阶段抢在 React Flow 选中之前
    window.addEventListener("click", onClick, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); end(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("click", onClick, true); window.removeEventListener("keydown", onKey, true); };
  }, [kind, forNodeId, end]);

  if (!kind || !forNodeId) return null;

  const backToNode = () => {
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => (n.selected !== (n.id === forNodeId) ? { ...n, selected: n.id === forNodeId } : n)) }));
    end();
  };

  return createPortal(
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 90, display: "flex", alignItems: "center", gap: 10, padding: "9px 10px 9px 12px", borderRadius: 14, background: "color-mix(in oklch, var(--c-base) 94%, transparent)", backdropFilter: "blur(16px)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 40px oklch(0 0 0 / 0.5)" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--c-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-t2)", flexShrink: 0 }}>
        <MousePointerClick size={15} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, marginRight: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)", whiteSpace: "nowrap" }}>
          {kind === "ref" ? "从画布选择参考" : "元素选择模式"}
        </span>
        <span style={{ fontSize: 10.5, color: "var(--c-t3)", whiteSpace: "nowrap" }}>
          {kind === "ref" ? "点击节点产物加为参考，可连选" : "点击图片选择局部元素"}
        </span>
      </div>
      {kind === "ref" && (
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent("canvas:pick-upload", { detail: { forNodeId } })); end(); }}
          title="改为本地上传参考图"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 32, padding: "0 11px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <Upload size={13} /> 本地上传
        </button>
      )}
      <button onClick={backToNode}
        style={{ height: 32, padding: "0 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer", whiteSpace: "nowrap" }}>
        返回节点
      </button>
      <button onClick={end}
        style={{ height: 32, padding: "0 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "var(--c-t1)", border: "none", color: "var(--c-base)", cursor: "pointer", whiteSpace: "nowrap" }}>
        退出
      </button>
    </div>,
    document.body,
  );
}
