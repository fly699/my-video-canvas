import { useState, useEffect, useRef, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { Search, X } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";

interface Props {
  onClose: () => void;
}

export function NodeSearch({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { nodes } = useCanvasStore();
  const reactFlow = useReactFlow();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter nodes by query
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

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view when navigating
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const focusNode = useCallback(
    (node: CanvasNode) => {
      reactFlow.fitView({
        nodes: [{ id: node.id }],
        padding: 0.5,
        duration: 400,
      });
      onClose();
    },
    [reactFlow, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && filtered[selectedIndex]) {
      focusNode(filtered[selectedIndex]);
    }
  };

  return (
    // Overlay backdrop
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
        {/* Search input */}
        <div
          className="flex items-center gap-2.5 px-4 py-3"
          style={{ borderBottom: filtered.length > 0 ? "1px solid var(--c-bd1)" : "none" }}
        >
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索节点..."
            className="flex-1 outline-none bg-transparent text-sm"
            style={{ color: "var(--c-t1)" }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ color: "var(--c-t4)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd
            className="px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0"
            style={{
              background: "var(--c-elevated)",
              border: "1px solid var(--c-bd3)",
              color: "var(--c-t4)",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        {filtered.length > 0 && (
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
            {filtered.map((node, idx) => {
              const config = getNodeConfig(node.data.nodeType);
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={node.id}
                  onClick={() => focusNode(node)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                  style={{
                    background: isSelected ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
                    borderLeft: isSelected ? `2px solid oklch(0.68 0.22 285 / 0.7)` : "2px solid transparent",
                  }}
                >
                  {/* Color dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: config.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--c-t1)" }}>
                      {node.data.title}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>
                      {config.label}
                    </p>
                  </div>
                  {isSelected && (
                    <kbd
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                      style={{
                        background: "var(--c-elevated)",
                        border: "1px solid var(--c-bd3)",
                        color: "var(--c-t3)",
                      }}
                    >
                      ↵
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {query.trim() && filtered.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm" style={{ color: "var(--c-t4)" }}>
              没有找到匹配的节点
            </p>
          </div>
        )}

        {/* Footer hint */}
        <div
          className="px-4 py-2 flex items-center gap-3"
          style={{ borderTop: "1px solid var(--c-elevated)" }}
        >
          <span style={{ fontSize: 10, color: "var(--c-t4)" }}>
            <kbd className="px-1 rounded" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", fontSize: 9, fontFamily: "monospace" }}>↑</kbd>
            {" "}<kbd className="px-1 rounded" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", fontSize: 9, fontFamily: "monospace" }}>↓</kbd>
            {" "}导航 ·
            {" "}<kbd className="px-1 rounded" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", fontSize: 9, fontFamily: "monospace" }}>↵</kbd>
            {" "}跳转 · {nodes.length} 个节点
          </span>
        </div>
      </div>
    </div>
  );
}
