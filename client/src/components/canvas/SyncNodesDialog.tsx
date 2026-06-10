import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Workflow, CheckSquare, Square } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";

/** 从源节点出发，沿边（视为无向）求连通分量——即「同一工作流」内的所有节点 id。 */
function connectedNodeIds(sourceId: string, edges: { source: string; target: string }[]): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
  for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }
  const seen = new Set<string>([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
  }
  return seen;
}

/** 取节点的「模型标识」用于列表展示（provider / model / imageModel）。 */
function modelOf(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  return String(payload.provider ?? payload.model ?? payload.imageModel ?? "");
}

/**
 * 「同步模型与参数到同类节点」对话框。列出本画布内所有同类节点，默认勾选与源节点
 * 处于同一工作流（连通）的同类节点，支持全选，确认后把 patch 批量同步到所选节点。
 */
export function SyncNodesDialog({
  sourceId, nodeType, typeLabel, patch, onClose,
}: {
  sourceId: string;
  nodeType: NodeType;
  typeLabel: string;
  patch: Record<string, unknown>;
  onClose: () => void;
}) {
  const accent = getNodeConfig(nodeType)?.color ?? "oklch(0.66 0.18 30)";

  // 打开时取一次快照：同类节点（排除自己）+ 连通分量。
  const { targets, connSet } = useMemo(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const conn = connectedNodeIds(sourceId, edges);
    const list = nodes
      .filter((n) => n.data.nodeType === nodeType && n.id !== sourceId)
      .map((n, i) => ({
        id: n.id,
        name: (n.data.title?.trim()) || modelOf(n.data.payload as Record<string, unknown>) || `${typeLabel} ${i + 1}`,
        model: modelOf(n.data.payload as Record<string, unknown>),
        inFlow: conn.has(n.id),
      }));
    // 同工作流内的排前面。
    list.sort((a, b) => (b.inFlow ? 1 : 0) - (a.inFlow ? 1 : 0));
    return { targets: list, connSet: conn };
  }, [sourceId, nodeType, typeLabel]);

  // 默认勾选：同一工作流内的同类节点。
  const [checked, setChecked] = useState<Set<string>>(() => new Set(targets.filter((t) => t.inFlow).map((t) => t.id)));
  const allChecked = targets.length > 0 && checked.size === targets.length;
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(targets.map((t) => t.id)));

  const apply = () => {
    const ids = Array.from(checked);
    if (ids.length === 0) { onClose(); return; }
    useCanvasStore.getState().batchUpdateNodeData(ids.map((id) => ({ id, payload: { ...patch } })));
    onClose();
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100060, background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        className="nodrag nowheel"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--c-base)", border: "1px solid var(--c-bd1)", borderRadius: 14, boxShadow: "0 24px 70px oklch(0 0 0 / 0.5)", overflow: "hidden" }}
      >
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", borderBottom: "1px solid var(--c-bd2)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `${accent}22`, color: accent, flexShrink: 0 }}><Workflow style={{ width: 16, height: 16 }} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--c-t1)" }}>同步模型与参数</div>
            <div style={{ fontSize: 11.5, color: "var(--c-t3)" }}>把当前{typeLabel}的模型 / 参数同步到所选{typeLabel}节点</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {targets.length === 0 ? (
          <div style={{ padding: "34px 20px", textAlign: "center", fontSize: 12.5, color: "var(--c-t3)" }}>
            当前画布只有这一个{typeLabel}节点，没有可同步的同类节点。
          </div>
        ) : (
          <>
            {/* 全选条 */}
            <button onClick={toggleAll} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 18px", background: "var(--c-elevated)", border: "none", borderBottom: "1px solid var(--c-bd2)", cursor: "pointer", color: "var(--c-t2)", fontSize: 12.5, fontWeight: 700, width: "100%", textAlign: "left" }}>
              {allChecked ? <CheckSquare style={{ width: 16, height: 16, color: accent }} /> : <Square style={{ width: 16, height: 16 }} />}
              全选（共 {targets.length} 个{typeLabel}节点 · 已选 {checked.size}）
            </button>
            {/* 列表 */}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {targets.map((t) => {
                const on = checked.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggle(t.id)}
                    className="nodrag"
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 9, border: "1px solid transparent", background: on ? `${accent}14` : "transparent", cursor: "pointer", marginBottom: 2 }}
                    onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                  >
                    {on ? <CheckSquare style={{ width: 16, height: 16, color: accent, flexShrink: 0 }} /> : <Square style={{ width: 16, height: 16, color: "var(--c-t4)", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      {t.model && <div style={{ fontSize: 10.5, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>当前模型：{t.model}</div>}
                    </div>
                    {t.inFlow && <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700, color: accent, background: `${accent}1c`, border: `1px solid ${accent}40`, padding: "2px 7px", borderRadius: 20 }}><Workflow style={{ width: 9, height: 9 }} />同工作流</span>}
                  </button>
                );
              })}
            </div>
            {/* 底部 */}
            <div style={{ display: "flex", gap: 10, padding: "13px 18px", borderTop: "1px solid var(--c-bd2)" }}>
              <button onClick={onClose} style={{ flex: "0 0 auto", padding: "8px 16px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>取消</button>
              <button onClick={apply} disabled={checked.size === 0} style={{ flex: 1, padding: "8px 16px", borderRadius: 8, border: "none", background: checked.size ? accent : "var(--c-bd2)", color: checked.size ? "#fff" : "var(--c-t4)", cursor: checked.size ? "pointer" : "not-allowed", fontSize: 12.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Check style={{ width: 15, height: 15 }} />同步到 {checked.size} 个节点
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
