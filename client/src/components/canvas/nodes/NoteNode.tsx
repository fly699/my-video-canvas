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

export const NoteNode = memo(function NoteNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;

  const handleChange = useCallback(
    (value: string) => { updateNodeData(id, { content: value }); },
    [id, updateNodeData]
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="note" title={data.title} minHeight={120}>
      <div className="p-2.5 h-full">
        <textarea
          placeholder="在此记录想法..."
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
            fontFamily: "inherit",
          }}
        />
      </div>
    </BaseNode>
  );
});
