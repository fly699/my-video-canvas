import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { NoteNodeData } from "../../../../../shared/types";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "note";
    title: string;
    payload: NoteNodeData;
    projectId: number;
  };
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^# (.+)$/gm, '<div style="font-size:13px;font-weight:700;color:oklch(0.92 0.005 260);margin:0 0 6px;line-height:1.3">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:12px;font-weight:600;color:oklch(0.85 0.005 260);margin:0 0 5px;line-height:1.3">$1</div>')
    .replace(/^### (.+)$/gm, '<div style="font-size:11px;font-weight:600;color:oklch(0.78 0.005 260);margin:0 0 4px;line-height:1.3">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:oklch(0.88 0.005 260)">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:oklch(0.70 0.008 260)">$1</em>')
    .replace(/`(.+?)`/g, '<code style="font-family:monospace;font-size:10px;background:oklch(0.16 0.008 260);padding:1px 5px;border-radius:3px;color:oklch(0.78 0.10 285)">$1</code>')
    .replace(/^- \[ \] (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;margin:2px 0"><span style="width:14px;height:14px;border:1.5px solid oklch(0.38 0.006 260);border-radius:3px;flex-shrink:0;margin-top:1px;display:inline-block"></span><span>$1</span></div>')
    .replace(/^- \[x\] (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;margin:2px 0"><span style="width:14px;height:14px;border:1.5px solid oklch(0.65 0.20 160);border-radius:3px;flex-shrink:0;margin-top:1px;display:inline-flex;align-items:center;justify-content:center;background:oklch(0.65 0.20 160 / 0.15)"><span style="width:8px;height:8px;background:oklch(0.65 0.20 160);clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)"></span></span><span style="text-decoration:line-through;color:oklch(0.42 0.006 260)">$1</span></div>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;margin:2px 0"><span style="color:oklch(0.55 0.12 85);margin-top:1px;flex-shrink:0">•</span><span>$1</span></div>')
    .replace(/^> (.+)$/gm, '<div style="border-left:2px solid oklch(0.65 0.12 85 / 0.5);padding-left:8px;color:oklch(0.62 0.008 260);margin:4px 0">$1</div>')
    .replace(/---/g, '<hr style="border:none;border-top:1px solid oklch(0.22 0.008 260);margin:8px 0"/>')
    .replace(/\n/g, "<br/>");
}

export const NoteNode = memo(function NoteNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;

  const handleChange = useCallback(
    (value: string) => { updateNodeData(id, { content: value }); },
    [id, updateNodeData]
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="note" title={data.title} minHeight={120} resizable>
      <div className="p-3.5 h-full" style={{ minHeight: 80 }}>
        {selected ? (
          <textarea
            placeholder={"在此记录想法...\n\n支持 Markdown：# 标题  **粗体**  `代码`  - 列表  - [ ] 待办"}
            value={payload.content}
            onChange={(e) => handleChange(e.target.value)}
            className="nodrag w-full h-full"
            style={{
              resize: "none",
              fontSize: 12,
              lineHeight: 1.75,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "oklch(0.75 0.006 260)",
              minHeight: 80,
              fontFamily: "var(--font-mono)",
            }}
          />
        ) : payload.content.trim() ? (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.75,
              color: "oklch(0.72 0.006 260)",
              minHeight: 80,
              cursor: "default",
              userSelect: "none",
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(payload.content) }}
          />
        ) : (
          <div
            style={{
              fontSize: 12,
              color: "oklch(0.35 0.006 260)",
              minHeight: 80,
              cursor: "text",
              fontStyle: "italic",
            }}
          >
            双击标题或点击编辑...
          </div>
        )}
      </div>
    </BaseNode>
  );
});
