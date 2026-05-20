import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PromptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "prompt";
    title: string;
    payload: PromptNodeData;
    projectId: number;
  };
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  background: "oklch(0.09 0.006 260)",
  border: "1px solid oklch(0.20 0.008 260)",
  borderRadius: 6,
  color: "oklch(0.80 0.006 260)",
  outline: "none",
  transition: "border-color 120ms ease",
};

const monoStyle: React.CSSProperties = {
  ...fieldStyle,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 10.5,
  resize: "none",
  lineHeight: 1.65,
};

export const PromptNode = memo(function PromptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { imageUrl: result.url });
      setGenerating(false);
      toast.success("图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("生成失败：" + err.message);
    },
  });

  const handleChange = useCallback(
    (field: keyof PromptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.positivePrompt?.trim()) { toast.error("请先填写正向提示词"); return; }
    setGenerating(true);
    genImageMutation.mutate({ prompt: payload.positivePrompt, negativePrompt: payload.negativePrompt, style: payload.style });
  };

  const accentColor = "oklch(0.68 0.22 300)";

  return (
    <BaseNode id={id} selected={selected} nodeType="prompt" title={data.title} minHeight={200}>
      <div className="flex flex-col h-full p-2.5 gap-2">

        {/* Preview image */}
        {payload.imageUrl && (
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{ height: 100, border: "1px solid oklch(0.20 0.008 260)" }}
          >
            <img src={payload.imageUrl} alt="preview" className="w-full h-full object-cover" draggable={false} />
            <div
              className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center"
              style={{ background: "oklch(0 0 0 / 0.55)" }}
            >
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: `${accentColor}20`,
                  border: `1px solid ${accentColor}50`,
                  color: accentColor,
                }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                重新生成
              </button>
            </div>
          </div>
        )}

        {/* Positive prompt */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>
            正向提示词
          </label>
          <textarea
            placeholder="masterpiece, best quality, cinematic lighting..."
            value={payload.positivePrompt}
            onChange={(e) => handleChange("positivePrompt", e.target.value)}
            rows={3}
            className="nodrag"
            style={{ ...monoStyle, borderColor: `${accentColor}30` }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}60`; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}30`; }}
          />
        </div>

        {/* Negative prompt */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>
            反向提示词
          </label>
          <textarea
            placeholder="blurry, low quality, distorted..."
            value={payload.negativePrompt ?? ""}
            onChange={(e) => handleChange("negativePrompt", e.target.value)}
            rows={2}
            className="nodrag"
            style={monoStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.45 0.008 260)"; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
        </div>

        {/* Style + ratio */}
        <div className="flex gap-1.5">
          <input
            placeholder="风格"
            value={payload.style ?? ""}
            onChange={(e) => handleChange("style", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}50`; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
          <input
            placeholder="比例 (16:9)"
            value={payload.aspectRatio ?? ""}
            onChange={(e) => handleChange("aspectRatio", e.target.value)}
            className="nodrag"
            style={{ ...fieldStyle, width: 90 }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}50`; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !payload.positivePrompt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
          style={{
            background: generating || !payload.positivePrompt?.trim()
              ? "oklch(0.13 0.007 260)"
              : `${accentColor}15`,
            border: `1px solid ${generating || !payload.positivePrompt?.trim() ? "oklch(0.20 0.008 260)" : `${accentColor}40`}`,
            color: generating || !payload.positivePrompt?.trim()
              ? "oklch(0.38 0.006 260)"
              : accentColor,
            cursor: generating || !payload.positivePrompt?.trim() ? "not-allowed" : "pointer",
          }}
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {generating ? "生成中..." : "AI 生成图像"}
        </button>
      </div>
    </BaseNode>
  );
});
