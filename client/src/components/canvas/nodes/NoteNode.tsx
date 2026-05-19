import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { NoteNodeData } from "../../../../../shared/types";
import { Textarea } from "@/components/ui/textarea";

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
    (value: string) => {
      updateNodeData(id, { content: value });
    },
    [id, updateNodeData]
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="note" title={data.title} minHeight={120}>
      <div className="p-3 h-full">
        <Textarea
          placeholder="在此记录想法..."
          value={payload.content}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full h-full resize-none text-sm bg-transparent border-none focus:ring-0 focus:outline-none nodrag placeholder:text-muted-foreground/40 leading-relaxed"
          style={{ minHeight: 80 }}
        />
      </div>
    </BaseNode>
  );
});
