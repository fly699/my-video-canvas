import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, RefreshCw } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "storyboard";
    title: string;
    payload: StoryboardNodeData;
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

export const StoryboardNode = memo(function StoryboardNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { imageUrl: result.url });
      setGenerating(false);
      toast.success("分镜图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  const handleChange = useCallback(
    (field: keyof StoryboardNodeData, value: string | number) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.promptText?.trim()) { toast.error("请先填写提示词"); return; }
    setGenerating(true);
    genImageMutation.mutate({ prompt: payload.promptText, negativePrompt: payload.negativePrompt, style: payload.colorTone });
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="storyboard" title={data.title} minHeight={280}>
      <div className="flex flex-col h-full p-2.5 gap-2">

        {/* ── Image preview ── */}
        <div
          className="relative rounded-lg overflow-hidden flex-shrink-0"
          style={{
            height: 150,
            background: "oklch(0.09 0.006 260)",
            border: "1px solid oklch(0.20 0.008 260)",
          }}
        >
          {payload.imageUrl ? (
            <>
              <img src={payload.imageUrl} alt="分镜" className="w-full h-full object-cover" draggable={false} />
              {/* Overlay gradient */}
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: "oklch(0.65 0.20 160 / 0.20)",
                    border: "1px solid oklch(0.65 0.20 160 / 0.5)",
                    color: "oklch(0.75 0.18 160)",
                  }}
                >
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {generating ? "生成中..." : "重新生成"}
                </button>
              </div>
              {/* Scene badge */}
              {payload.sceneNumber && (
                <div
                  className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    background: "oklch(0 0 0 / 0.65)",
                    color: "oklch(0.75 0.18 160)",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  #{payload.sceneNumber}
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <ImageIcon className="w-7 h-7" style={{ color: "oklch(0.30 0.008 260)" }} />
              <button
                onClick={handleGenerate}
                disabled={generating || !payload.promptText?.trim()}
                className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: generating || !payload.promptText?.trim()
                    ? "oklch(0.15 0.008 260)"
                    : "oklch(0.65 0.20 160 / 0.15)",
                  border: `1px solid ${generating || !payload.promptText?.trim() ? "oklch(0.22 0.008 260)" : "oklch(0.65 0.20 160 / 0.45)"}`,
                  color: generating || !payload.promptText?.trim()
                    ? "oklch(0.40 0.006 260)"
                    : "oklch(0.72 0.18 160)",
                  cursor: generating || !payload.promptText?.trim() ? "not-allowed" : "pointer",
                }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? "生成中..." : "AI 生成分镜"}
              </button>
              {!payload.promptText?.trim() && (
                <p className="text-[10px]" style={{ color: "oklch(0.35 0.006 260)" }}>请先填写提示词</p>
              )}
            </div>
          )}
        </div>

        {/* ── Scene meta ── */}
        <div className="flex gap-1.5">
          {[
            { placeholder: "场景#", type: "number", field: "sceneNumber" as keyof StoryboardNodeData, width: 52 },
            { placeholder: "时长(s)", type: "number", field: "duration" as keyof StoryboardNodeData, width: 56 },
          ].map(({ placeholder, type, field, width }) => (
            <input
              key={field}
              type={type}
              placeholder={placeholder}
              value={(payload[field] as string | number) ?? ""}
              onChange={(e) => handleChange(field, type === "number" ? Number(e.target.value) : e.target.value)}
              className="nodrag"
              style={{ ...fieldStyle, width }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
            />
          ))}
          <input
            placeholder="运镜方式"
            value={payload.cameraMovement ?? ""}
            onChange={(e) => handleChange("cameraMovement", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
        </div>

        {/* ── Description ── */}
        <textarea
          placeholder="场景描述..."
          value={payload.description}
          onChange={(e) => handleChange("description", e.target.value)}
          className="nodrag"
          rows={2}
          style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
        />

        {/* ── Prompt ── */}
        <textarea
          placeholder="正向提示词（用于 AI 生图）..."
          value={payload.promptText ?? ""}
          onChange={(e) => handleChange("promptText", e.target.value)}
          className="nodrag"
          rows={2}
          style={{
            ...fieldStyle,
            resize: "none",
            lineHeight: 1.6,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
        />

        {/* ── Style row ── */}
        <div className="flex gap-1.5">
          <input
            placeholder="色调/风格"
            value={payload.colorTone ?? ""}
            onChange={(e) => handleChange("colorTone", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
          <input
            placeholder="镜头"
            value={payload.lens ?? ""}
            onChange={(e) => handleChange("lens", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.65 0.20 160 / 0.6)"; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.20 0.008 260)"; }}
          />
        </div>
      </div>
    </BaseNode>
  );
});
