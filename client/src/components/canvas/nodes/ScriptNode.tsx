import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";

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
  const [llmModel, setLlmModel] = useState<LLMModelId>("gemini-2.5-flash");

  const handleChange = useCallback(
    (field: keyof ScriptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const generateMutation = trpc.scripts.generateStoryboards.useMutation({
    onSuccess: (result) => {
      const { nodes: currentNodes, batchAddSceneNodes } = useCanvasStore.getState();
      const ownPos = currentNodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
      batchAddSceneNodes(result.scenes, id, ownPos);
      toast.success("分镜已生成", {
        description: `共 ${result.scenes.length} 个场景节点已添加到画布`,
        duration: 4000,
      });
    },
    onError: (err) => {
      toast.error("AI 生成分镜失败：" + err.message);
    },
  });

  const polishMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { content: result.result });
      toast.success("脚本已润色");
    },
    onError: (err) => { toast.error("AI 润色失败：" + err.message); },
  });

  const anyPending = generateMutation.isPending || polishMutation.isPending;

  return (
    <BaseNode id={id} selected={selected} nodeType="script" title={data.title} minHeight={200} resizable>
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
        <div className="flex items-center gap-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={anyPending} />
          <button
            onClick={() => {
              if (!payload.content.trim()) { toast.error("请先填写脚本内容"); return; }
              polishMutation.mutate({ text: payload.content, mode: "polish", model: llmModel });
            }}
            disabled={anyPending}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: polishMutation.isPending ? "oklch(0.13 0.007 260)" : "oklch(0.62 0.18 240 / 0.10)",
              border: `1px solid ${polishMutation.isPending ? "oklch(0.20 0.008 260)" : "oklch(0.62 0.18 240 / 0.35)"}`,
              color: anyPending ? "oklch(0.38 0.006 260)" : "oklch(0.72 0.16 240)",
              cursor: anyPending ? "not-allowed" : "pointer",
            }}
          >
            {polishMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI 润色
          </button>
          <span style={{ fontSize: 10, color: "oklch(0.32 0.006 260)", marginLeft: "auto" }}>
            {payload.content.length} 字
          </span>
        </div>
        <button
          onClick={() => {
            if (!payload.content.trim()) { toast.error("请先填写脚本内容"); return; }
            generateMutation.mutate({ content: payload.content, synopsis: payload.synopsis, model: llmModel });
          }}
          disabled={anyPending}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: generateMutation.isPending ? "oklch(0.13 0.007 260)" : "oklch(0.62 0.18 240 / 0.12)",
            border: `1px solid ${generateMutation.isPending ? "oklch(0.20 0.008 260)" : "oklch(0.62 0.18 240 / 0.40)"}`,
            color: anyPending ? "oklch(0.38 0.006 260)" : "oklch(0.72 0.16 240)",
            cursor: anyPending ? "not-allowed" : "pointer",
          }}
        >
          {generateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {generateMutation.isPending ? "AI 生成分镜中..." : "AI 生成分镜"}
        </button>
      </div>
    </BaseNode>
  );
});
