import { useState } from "react";
import { X, FileText, ChevronUp, ChevronDown } from "lucide-react";
import { useNodeId } from "@xyflow/react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useUIStyle } from "../../contexts/UIStyleContext";

interface Props {
  open: boolean;
  /** 当前节点「最终选择使用」的正向提示词。 */
  text: string;
  /** 可选的负向提示词。 */
  negText?: string;
  /** 来源标注（如「上游」「本地」「上游+角色」），用于一眼看清这条提示词从哪来。 */
  source?: string;
  /** 框内简要说明（小字常驻一行，解释这段文字是什么 / 用途），可选。 */
  note?: string;
  /** 标题文案，默认「最终提示词」。 */
  label?: string;
  accent?: string;
  onClose: () => void;
  /** 收缩态下正文区高度（≈提示词节点收缩后的高度），点击可向上展开。 */
  collapsedHeight?: number;
  /** 鼠标进/出本吸附窗（用于「悬停临时展开」期间保持展开，便于点击钉住）。 */
  onHoverChange?: (hovering: boolean) => void;
  /** 点击吸附窗（非关闭按钮）→ 钉住持久展开。 */
  onPin?: () => void;
}

/**
 * 顶部吸附「最终提示词」预览窗（与节点同宽，浮在节点上方、向上展开）。
 * 用于一眼确认当前节点真正会用到的提示词（上游优先 / 本地 / 角色注入后的结果），
 * 节点收缩后也常驻可见。收缩态只露一两行，点击标题/正文向上展开（限高 500，超出滚动）。
 * 开关由节点标题栏「参考图/提示词」循环按钮统一控制（见 useNodeDocks）。
 */
export function PromptDock({
  open, text, negText, source, note, label = "最终提示词", accent = "oklch(0.68 0.18 250)", onClose, collapsedHeight = 34,
  onHoverChange, onPin,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  // 工作室皮肤下，选中/钉住的非 ai_chat 节点会在顶部浮出操作工具条（NodeToolbar，
  // offset 10、约 40 高），与本「最终提示词」窗争抢节点上方空间，导致提示词被遮盖。
  // → 当该工具条会出现时，把本窗再向上让位，避免被覆盖。仅多算一个常量高度，不依赖
  // 工具条实际渲染时机（toolbar 自身固定在节点上沿，dock 在其之上即可）。
  const nodeId = useNodeId();
  const { uiStyle } = useUIStyle();
  const reserveForToolbar = useCanvasStore((s) => {
    if (uiStyle !== "studio") return 0;
    const n = nodeId ? s.nodes.find((x) => x.id === nodeId) : undefined;
    if (!n || n.data.nodeType === "ai_chat") return 0;
    const sel = !!n.selected || Boolean((n.data.payload as Record<string, unknown> | undefined)?.pinned);
    return sel ? 48 : 0;
  });
  if (!open) return null;
  const hasText = !!text.trim();
  const hasNeg = !!negText?.trim();

  return (
    <div
      className="nodrag nowheel"
      style={{
        position: "absolute", bottom: `calc(100% + ${8 + reserveForToolbar}px)`, left: 0, right: 0,
        display: "flex", flexDirection: "column",
        borderRadius: 12, border: `1px solid ${expanded ? accent : "var(--c-bd2)"}`,
        background: "color-mix(in oklch, var(--c-base) 94%, transparent)",
        backdropFilter: "blur(16px)", boxShadow: "0 12px 36px oklch(0 0 0 / 0.4)",
        overflow: "hidden", zIndex: 30,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onClick={() => onPin?.()}
    >
      {/* 标题栏：点击向上展开 / 收起 */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "5px 8px", cursor: "pointer", flexShrink: 0, gap: 6 }}
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "点击收起" : "点击展开查看完整提示词"}
      >
        <span style={{ fontSize: 10, color: "var(--c-t3)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <FileText style={{ width: 11, height: 11, flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap" }}>{label}</span>
          {source && (
            <span style={{ color: accent, fontWeight: 700, whiteSpace: "nowrap" }}>· {source}</span>
          )}
        </span>
        <div className="flex items-center" style={{ gap: 2, flexShrink: 0 }}>
          {expanded
            ? <ChevronDown style={{ width: 13, height: 13, color: "var(--c-t4)" }} />
            : <ChevronUp style={{ width: 13, height: 13, color: "var(--c-t4)" }} />}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="nodrag"
            style={{ color: "var(--c-t4)", lineHeight: 0 }}
            title="收起"
          >
            <X style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>

      {/* 框内简要说明（常驻一行，解释这段文字的用途） */}
      {note && (
        <div style={{ padding: "0 10px 4px", fontSize: 9.5, lineHeight: 1.4, color: "var(--c-t4)", flexShrink: 0 }}>
          {note}
        </div>
      )}

      {/* 正文：收缩态露一两行，展开态限高 500 滚动 */}
      <div
        className="nowheel"
        style={{
          padding: "0 10px 8px",
          maxHeight: expanded ? 500 : collapsedHeight,
          overflowY: expanded ? "auto" : "hidden",
          cursor: expanded ? "auto" : "pointer",
          maskImage: !expanded && (hasText || hasNeg) ? "linear-gradient(to bottom, #000 60%, transparent)" : undefined,
          WebkitMaskImage: !expanded && (hasText || hasNeg) ? "linear-gradient(to bottom, #000 60%, transparent)" : undefined,
        }}
        onClick={() => { if (!expanded) setExpanded(true); }}
      >
        {hasText
          ? <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</div>
          : <div style={{ fontSize: 11, color: "var(--c-t4)", fontStyle: "italic" }}>（暂无提示词，运行时将使用空提示词）</div>}
        {hasNeg && (
          <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: "var(--c-t3)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: "oklch(0.62 0.20 25)", fontWeight: 600 }}>负向：</span>{negText}
          </div>
        )}
      </div>
    </div>
  );
}
