import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { NoteNodeData } from "../../../../../shared/types";
import { NodeTextArea } from "../NodeTextInput";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";

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
    .replace(/^# (.+)$/gm, '<div style="font-size:13px;font-weight:700;color:var(--c-t1);margin:0 0 6px;line-height:1.3">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:12px;font-weight:600;color:var(--c-t1);margin:0 0 5px;line-height:1.3">$1</div>')
    .replace(/^### (.+)$/gm, '<div style="font-size:11px;font-weight:600;color:var(--c-t2);margin:0 0 4px;line-height:1.3">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--c-t1)">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:var(--c-t2)">$1</em>')
    .replace(/`(.+?)`/g, '<code style="font-family:monospace;font-size:10px;background:var(--c-elevated);padding:1px 5px;border-radius:3px;color:oklch(0.78 0.10 285)">$1</code>')
    // #99 待办可点击：单遍替换保证 data-cb 索引与文中勾选框出现顺序一一对应（toggle 按同序改写源文本）
    .replace(/^- \[( |x)\] (.+)$/gm, (() => {
      let cb = 0;
      return (_m: string, c: string, t: string) => c === "x"
        ? `<div data-cb="${cb++}" title="点击取消勾选" style="display:flex;align-items:flex-start;gap:6px;margin:2px 0;cursor:pointer"><span style="width:14px;height:14px;border:1.5px solid oklch(0.65 0.20 160);border-radius:3px;flex-shrink:0;margin-top:1px;display:inline-flex;align-items:center;justify-content:center;background:oklch(0.65 0.20 160 / 0.15)"><span style="width:8px;height:8px;background:oklch(0.65 0.20 160);clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)"></span></span><span style="text-decoration:line-through;color:var(--c-t4)">${t}</span></div>`
        : `<div data-cb="${cb++}" title="点击勾选完成" style="display:flex;align-items:flex-start;gap:6px;margin:2px 0;cursor:pointer"><span style="width:14px;height:14px;border:1.5px solid var(--c-t4);border-radius:3px;flex-shrink:0;margin-top:1px;display:inline-block"></span><span>${t}</span></div>`;
    })())
    .replace(/^- (.+)$/gm, '<div style="display:flex;align-items:flex-start;gap:6px;margin:2px 0"><span style="color:oklch(0.55 0.12 85);margin-top:1px;flex-shrink:0">•</span><span>$1</span></div>')
    .replace(/^> (.+)$/gm, '<div style="border-left:2px solid oklch(0.65 0.12 85 / 0.5);padding-left:8px;color:var(--c-t2);margin:4px 0">$1</div>')
    .replace(/---/g, '<hr style="border:none;border-top:1px solid var(--c-bd2);margin:8px 0"/>')
    .replace(/\n/g, "<br/>");
}

export const NoteNode = memo(function NoteNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  // #98 LibTV：创意模式便签用大字无边框排版（与提示词节点净卡体同款观感）。
  const { isCreativeMode } = useCreativeAdvanced(selected);

  const handleChange = useCallback(
    (value: string) => { updateNodeData(id, { content: value }); },
    [id, updateNodeData]
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="note" title={data.title} minHeight={120} resizable>
      <div className="p-3.5 h-full" style={{ minHeight: 80 }}>
        {selected ? (
          <NodeTextArea className="nodrag w-full h-full nowheel"
            placeholder={"在此记录想法...\n\n支持 Markdown：# 标题  **粗体**  `代码`  - 列表  - [ ] 待办"}
            value={payload.content ?? ""}
            onValueChange={(v) => handleChange(v)}

            style={{
              resize: "none",
              fontSize: isCreativeMode ? 13.5 : 12,
              lineHeight: 1.75,
              background: "transparent",
              border: "none",
              outline: "none",
              color: isCreativeMode ? "var(--c-t1)" : "var(--c-t2)",
              minHeight: 80,
              fontFamily: isCreativeMode ? "inherit" : "var(--font-mono)",
            }}
          />
        ) : payload.content?.trim() ? (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.75,
              color: "var(--c-t2)",
              minHeight: 80,
              cursor: "default",
              userSelect: "none",
            }}
            // #99 待办可点击：预览态点勾选框即切换 - [ ] ↔ - [x]（按出现序精确改写源文本）。
            // pointerdown 拦截防止 React Flow 把这次点击当节点选中/拖拽起手。
            onPointerDown={(e) => { if ((e.target as HTMLElement).closest("[data-cb]")) e.stopPropagation(); }}
            onClick={(e) => {
              const el = (e.target as HTMLElement).closest("[data-cb]") as HTMLElement | null;
              if (!el) return;
              e.stopPropagation();
              const idx = Number(el.dataset.cb);
              let n = -1;
              const next = (payload.content ?? "").replace(/^- \[( |x)\] /gm, (m, c: string) => {
                n++;
                return n === idx ? (c === " " ? "- [x] " : "- [ ] ") : m;
              });
              updateNodeData(id, { content: next });
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(payload.content) }}
          />
        ) : (
          <div
            style={{
              fontSize: 12,
              color: "var(--c-t4)",
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
