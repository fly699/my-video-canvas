import { useEffect, useRef } from "react";
import { NODE_TYPE_LIST } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import {
  FileText,
  Image,
  Wand2,
  Paperclip,
  Video,
  Bot,
  StickyNote,
  Copy,
  Trash2,
  Scissors,
  Link,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileText,
  Image,
  Wand2,
  Paperclip,
  Video,
  Bot,
  StickyNote,
};

interface ContextMenuProps {
  x: number;
  y: number;
  type: "canvas" | "node";
  nodeId?: string;
  onClose: () => void;
  onAddNode?: (type: NodeType) => void;
  onDeleteNode?: () => void;
  onDuplicateNode?: () => void;
}

export function ContextMenu({
  x,
  y,
  type,
  nodeId,
  onClose,
  onAddNode,
  onDeleteNode,
  onDuplicateNode,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 300),
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      className="glass rounded-xl border border-border/60 shadow-2xl py-1.5 min-w-[180px] animate-scale-in"
      style={menuStyle}
    >
      {type === "canvas" ? (
        <>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
            添加节点
          </div>
          {NODE_TYPE_LIST.map((config) => {
            const Icon = ICONS[config.icon] ?? FileText;
            return (
              <button
                key={config.type}
                onClick={() => {
                  onAddNode?.(config.type);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground/80 hover:bg-white/5 hover:text-foreground transition-colors text-left"
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                  style={{ background: `${config.color}22` }}
                >
                  <Icon className="w-3 h-3" style={{ color: config.color }} />
                </div>
                <span>{config.label}</span>
              </button>
            );
          })}
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
            节点操作
          </div>
          <button
            onClick={() => {
              onDuplicateNode?.();
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground/80 hover:bg-white/5 hover:text-foreground transition-colors text-left"
          >
            <Copy className="w-4 h-4 text-muted-foreground" />
            复制节点
          </button>
          <div className="my-1 border-t border-border/30" />
          <button
            onClick={() => {
              onDeleteNode?.();
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
          >
            <Trash2 className="w-4 h-4" />
            删除节点
          </button>
        </>
      )}
    </div>
  );
}
