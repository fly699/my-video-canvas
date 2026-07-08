import { useState, useEffect, useRef, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { Search, X, Crosshair, Play, Maximize2, Copy, Trash2, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore, type CanvasNode } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import { useUIStyle } from "../../contexts/UIStyleContext";
import { setStudioExpandAll } from "../../hooks/useStudioExpandAll";
import { RatioPicker, RATIOS } from "./studio/StudioCommandBar";

interface Props {
  onClose: () => void;
}

// ★12：⌘K 命令面板。第一层搜索节点；对某节点回车/→ 下钻到「节点命令」层——
// 定位 / 运行 / 展开参数 / 统一比例（工作室）/ 复制 / 删除，键盘全程可达。
// 所有动作复用 store 现有 action，无数据模型分叉。
const RATIO_FIELD: Record<string, string> = {
  image_gen: "aspectRatio", storyboard: "aspectRatio", prompt: "aspectRatio",
  comfyui_workflow: "aspectRatio",
};
const CLIP_RATIOS = ["9:16", "16:9", "1:1"];
const CLIP_RATIO_SET = new Set(CLIP_RATIOS);
function ratioFieldFor(nodeType: string): string | null {
  if (nodeType === "clip") return "aspect";
  return RATIO_FIELD[nodeType] ?? null;
}

interface Cmd { id: string; label: string; icon: React.ReactNode; run: () => void; danger?: boolean }

export function NodeSearch({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // null = 搜索层；节点 id = 该节点的命令层。
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { nodes } = useCanvasStore();
  const reactFlow = useReactFlow();
  const { uiStyle } = useUIStyle();
  const isStudio = uiStyle === "studio";

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered: CanvasNode[] = query.trim()
    ? nodes.filter((n) => {
        const q = query.toLowerCase();
        return (
          n.data.title.toLowerCase().includes(q) ||
          n.data.nodeType.toLowerCase().includes(q) ||
          getNodeConfig(n.data.nodeType).label.toLowerCase().includes(q)
        );
      })
    : nodes;

  const activeNode = activeId ? nodes.find((n) => n.id === activeId) ?? null : null;

  const focusNode = useCallback(
    (node: CanvasNode, close = true) => {
      const { nodes: cur, setNodes } = useCanvasStore.getState();
      setNodes(cur.map((n) => ({ ...n, selected: n.id === node.id })));
      const rfNode = reactFlow.getNode(node.id);
      if (rfNode) {
        const w = rfNode.measured?.width ?? rfNode.width ?? 240;
        const h = rfNode.measured?.height ?? rfNode.height ?? 120;
        reactFlow.setCenter(rfNode.position.x + w / 2, rfNode.position.y + h / 2, {
          zoom: Math.min(Math.max(reactFlow.getZoom(), 0.85), 1.5),
          duration: 500,
        });
      } else {
        reactFlow.fitView({ nodes: [{ id: node.id }], padding: 0.5, duration: 400 });
      }
      if (close) onClose();
    },
    [reactFlow, onClose]
  );

  // 打开某节点的命令层。
  const openCommands = useCallback((node: CanvasNode) => {
    setActiveId(node.id);
    setSelectedIndex(0);
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const backToSearch = useCallback(() => { setActiveId(null); setSelectedIndex(0); inputRef.current?.focus(); }, []);

  // 为当前节点构建命令。
  const buildCommands = (node: CanvasNode): Cmd[] => {
    const st = useCanvasStore.getState();
    const cmds: Cmd[] = [
      { id: "focus", label: "定位到画布", icon: <Crosshair size={14} />, run: () => focusNode(node) },
      { id: "run", label: "运行此节点", icon: <Play size={14} />, run: () => { st.requestRun(null, [node.id]); toast.success("已请求运行", { duration: 1200 }); onClose(); } },
    ];
    if (isStudio) {
      cmds.push({ id: "expand", label: "展开全部参数（所有节点）", icon: <Maximize2 size={14} />, run: () => { setStudioExpandAll(true); toast.success("已展开全部参数", { duration: 1200 }); onClose(); } });
    }
    cmds.push(
      { id: "dup", label: "复制节点", icon: <Copy size={14} />, run: () => { st.duplicateNode(node.id); toast.success("已复制节点", { duration: 1200 }); onClose(); } },
      { id: "del", label: "删除节点", icon: <Trash2 size={14} />, danger: true, run: () => { st.deleteNode(node.id); toast.success("已删除节点（可撤销）", { duration: 1500 }); onClose(); } },
    );
    return cmds;
  };

  const commands = activeNode ? buildCommands(activeNode) : [];
  const ratioField = activeNode ? ratioFieldFor(activeNode.data.nodeType) : null;

  // 命令层按查询过滤命令（可选）。
  const visCommands = activeNode
    ? (query.trim() ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : commands)
    : [];

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const applyRatio = (ratio: string) => {
    if (!activeNode || !ratioField) return;
    if (activeNode.data.nodeType === "clip" && !CLIP_RATIO_SET.has(ratio)) { toast.info("该节点不支持此比例"); return; }
    const patch: Record<string, unknown> = { [ratioField]: ratio };
    if (activeNode.data.nodeType === "comfyui_workflow") patch.overrideRatioSize = true;
    useCanvasStore.getState().updateNodeData(activeNode.id, patch);
    toast.success(`比例已设为 ${ratio}`, { duration: 1200 });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { if (activeId) backToSearch(); else onClose(); return; }
    // 命令层：空查询时 ← / Backspace 返回搜索层（有过滤词时 ← 留给输入框移动光标）。
    if (activeId && !query && (e.key === "ArrowLeft" || e.key === "Backspace")) { e.preventDefault(); backToSearch(); return; }
    const len = activeId ? visCommands.length : filtered.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, len - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "ArrowRight" && !activeId && filtered[selectedIndex]) { e.preventDefault(); openCommands(filtered[selectedIndex]); return; }
    if (e.key === "Enter") {
      if (activeId) { visCommands[selectedIndex]?.run(); }
      else if (filtered[selectedIndex]) { openCommands(filtered[selectedIndex]); }
    }
  };

  const kbd = (t: string) => (
    <kbd className="px-1 rounded" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", fontSize: 9, fontFamily: "monospace" }}>{t}</kbd>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "oklch(0 0 0 / 0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden animate-scale-in"
        style={{
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 24px 80px oklch(0 0 0 / 0.40), 0 4px 16px oklch(0 0 0 / 0.20)",
          backdropFilter: "blur(24px)",
        }}
      >
        {/* Search / breadcrumb input */}
        <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          {activeNode ? (
            <button onClick={backToSearch} title="返回搜索" style={{ color: "var(--c-t3)", display: "inline-flex", alignItems: "center" }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
          )}
          {activeNode && (
            <span className="flex items-center gap-1.5 flex-shrink-0 px-2 py-0.5 rounded-md text-xs" style={{ background: "var(--c-elevated)", color: "var(--c-t2)", maxWidth: 160 }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getNodeConfig(activeNode.data.nodeType).color }} />
              <span className="truncate">{activeNode.data.title}</span>
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeNode ? "输入命令…" : "搜索节点…"}
            className="flex-1 outline-none bg-transparent text-sm"
            style={{ color: "var(--c-t1)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--c-t4)" }}><X className="w-3.5 h-3.5" /></button>
          )}
          <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t4)" }}>Esc</kbd>
        </div>

        {/* ── Command layer ── */}
        {activeNode ? (
          <>
            {isStudio && ratioField && (
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t4)", marginBottom: 7 }}>画面比例</div>
                <RatioPicker value={(() => { const v = (activeNode.data.payload as Record<string, unknown>)[ratioField]; return typeof v === "string" ? v : ""; })()} options={activeNode.data.nodeType === "clip" ? CLIP_RATIOS : RATIOS} onChange={applyRatio} />
              </div>
            )}
            <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
              {visCommands.map((c, idx) => {
                const isSel = idx === selectedIndex;
                return (
                  <button key={c.id} onClick={() => c.run()} onMouseEnter={() => setSelectedIndex(idx)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                    style={{ background: isSel ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
                      borderLeft: isSel ? "2px solid oklch(0.68 0.22 285 / 0.7)" : "2px solid transparent" }}>
                    <span style={{ color: c.danger ? "var(--c-danger, oklch(0.62 0.2 20))" : "var(--c-t3)", display: "inline-flex", flexShrink: 0 }}>{c.icon}</span>
                    <span className="flex-1 text-sm truncate" style={{ color: c.danger ? "var(--c-danger, oklch(0.62 0.2 20))" : "var(--c-t1)" }}>{c.label}</span>
                    {isSel && <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}>↵</kbd>}
                  </button>
                );
              })}
              {visCommands.length === 0 && (
                <div className="px-4 py-6 text-center"><p className="text-sm" style={{ color: "var(--c-t4)" }}>没有匹配的命令</p></div>
              )}
            </div>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderTop: "1px solid var(--c-elevated)" }}>
              <span style={{ fontSize: 10, color: "var(--c-t4)" }}>
                {kbd("↑")} {kbd("↓")} 导航 · {kbd("↵")} 执行 · {kbd("←")} 返回
              </span>
            </div>
          </>
        ) : (
          <>
            {/* ── Search layer ── */}
            {filtered.length > 0 && (
              <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
                {filtered.map((node, idx) => {
                  const config = getNodeConfig(node.data.nodeType);
                  const isSelected = idx === selectedIndex;
                  return (
                    <button key={node.id} onClick={() => openCommands(node)} onMouseEnter={() => setSelectedIndex(idx)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                      style={{ background: isSelected ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
                        borderLeft: isSelected ? "2px solid oklch(0.68 0.22 285 / 0.7)" : "2px solid transparent" }}>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: config.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: "var(--c-t1)" }}>{node.data.title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>{config.label}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); focusNode(node); }} title="直接定位（不进命令）"
                        className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t4)" }}>定位</button>
                      <ChevronRight size={14} style={{ color: isSelected ? "var(--c-t3)" : "var(--c-t4)", flexShrink: 0 }} />
                    </button>
                  );
                })}
              </div>
            )}
            {query.trim() && filtered.length === 0 && (
              <div className="px-4 py-6 text-center"><p className="text-sm" style={{ color: "var(--c-t4)" }}>没有找到匹配的节点</p></div>
            )}
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderTop: "1px solid var(--c-elevated)" }}>
              <span style={{ fontSize: 10, color: "var(--c-t4)" }}>
                {kbd("↑")} {kbd("↓")} 导航 · {kbd("↵")}/{kbd("→")} 打开命令 · {nodes.length} 个节点
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
