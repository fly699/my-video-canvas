import { memo, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../../../shared/types";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

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
      <div className="flex flex-col h-full p-3 gap-2">
        <Input
          placeholder="故事梗概（可选）"
          value={payload.synopsis ?? ""}
          onChange={(e) => handleChange("synopsis", e.target.value)}
          className="h-7 text-xs bg-transparent border-border/40 focus:border-[oklch(0.62_0.18_240/0.6)] placeholder:text-muted-foreground/40 nodrag"
        />
        <Textarea
          placeholder="在此输入脚本内容...&#10;&#10;支持多行文本，双击标题可重命名节点。"
          value={payload.content}
          onChange={(e) => handleChange("content", e.target.value)}
          className="flex-1 resize-none text-xs bg-transparent border-border/40 focus:border-[oklch(0.62_0.18_240/0.6)] placeholder:text-muted-foreground/40 leading-relaxed nodrag"
          style={{ minHeight: 120 }}
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
          <span>{payload.content.length} 字</span>
          <span>脚本节点</span>
        </div>
      </div>
    </BaseNode>
  );
});
