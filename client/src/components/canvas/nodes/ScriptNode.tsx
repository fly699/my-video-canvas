import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../../../shared/types";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "script";
    title: string;
    payload: ScriptNodeData;
    projectId: number;
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 11,
  background: "oklch(0.09 0.006 260)",
  border: "1px solid oklch(0.20 0.008 260)",
  borderRadius: 7,
  color: "oklch(0.80 0.006 260)",
  outline: "none",
  transition: "border-color 120ms ease",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "none",
  lineHeight: 1.7,
  flex: 1,
  minHeight: 100,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 11.5,
};

export const ScriptNode = memo(function ScriptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;

  const handleChange = useCallback(
    (field: keyof ScriptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="script" title={data.title} minHeight={200}>
      <div className="flex flex-col h-full p-3 gap-2.5">
        <input
          placeholder="故事梗概（可选）"
          value={payload.synopsis ?? ""}
          onChange={(e) => handleChange("synopsis", e.target.value)}
          className="nodrag"
          style={inputStyle}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.62 0.18 240 / 0.6)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
        />
        <textarea
          placeholder={"在此输入脚本内容...\n\n支持多行文本，双击标题可重命名节点。"}
          value={payload.content}
          onChange={(e) => handleChange("content", e.target.value)}
          className="nodrag flex-1"
          style={textareaStyle}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.62 0.18 240 / 0.6)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
        />
        <div
          className="flex items-center justify-between"
          style={{ fontSize: 10, color: "oklch(0.38 0.006 260)" }}
        >
          <span>{payload.content.length} 字</span>
          <div className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "oklch(0.62 0.18 240 / 0.5)" }}
            />
            <span>脚本</span>
          </div>
        </div>
      </div>
    </BaseNode>
  );
});
