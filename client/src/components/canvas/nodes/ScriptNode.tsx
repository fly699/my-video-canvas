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

const BORDER_DEFAULT = "oklch(0.20 0.008 260)";
const BORDER_FOCUS = "oklch(0.62 0.18 240 / 0.6)";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "oklch(0.09 0.006 260)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "oklch(0.86 0.006 260)",
  outline: "none",
  transition: "border-color 150ms ease, background 150ms ease",
  lineHeight: 1.5,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "none",
  lineHeight: 1.75,
  flex: 1,
  minHeight: 100,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 12,
};

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

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
      <div className="flex flex-col h-full p-3.5 gap-3">
        <input
          placeholder="故事梗概（可选）"
          value={payload.synopsis ?? ""}
          onChange={(e) => handleChange("synopsis", e.target.value)}
          className="nodrag"
          style={inputStyle}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <textarea
          placeholder={"在此输入脚本内容...\n\n支持多行文本，双击标题可重命名节点。"}
          value={payload.content}
          onChange={(e) => handleChange("content", e.target.value)}
          className="nodrag flex-1"
          style={textareaStyle}
          onFocus={onFocus}
          onBlur={onBlur}
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
