import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PromptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, ChevronDown } from "lucide-react";

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

const BORDER_DEFAULT = "oklch(0.20 0.008 260)";

const IMAGE_MODELS = [
  { id: "manus_forge",      label: "Manus Forge",        tag: "内置",        group: "Manus" },
  { id: "poyo_flux",        label: "Flux 1.1 Pro",       tag: "Poyo",        group: "Poyo" },
  { id: "poyo_sdxl",        label: "SDXL",               tag: "Poyo",        group: "Poyo" },
  { id: "hf_soul_standard", label: "Soul Standard",      tag: "Higgsfield",  group: "Higgsfield" },
  { id: "hf_reve",          label: "Reve Text-to-Image", tag: "Higgsfield",  group: "Higgsfield" },
] as const;

type ImageModelId = typeof IMAGE_MODELS[number]["id"];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  background: "oklch(0.09 0.006 260)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
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
  const [showModelPicker, setShowModelPicker] = useState(false);
  const model: ImageModelId = (payload.imageModel as ImageModelId) ?? "manus_forge";
  const setModel = (m: ImageModelId) => { updateNodeData(id, { imageModel: m }); };

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
    genImageMutation.mutate({
      prompt: payload.positivePrompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
      model,
    });
  };

  const accentColor = "oklch(0.68 0.22 300)";
  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = `${accentColor.slice(0, -1)} / 0.6)`; };
  const onBlurAccent  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = `${accentColor.slice(0, -1)} / 0.3)`; };
  const onFocusNeg    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "oklch(0.45 0.008 260)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  const currentModel = IMAGE_MODELS.find((m) => m.id === model) ?? IMAGE_MODELS[0];

  return (
    <BaseNode id={id} selected={selected} nodeType="prompt" title={data.title} minHeight={200}>
      <div className="flex flex-col h-full p-2.5 gap-2">

        {/* Preview image */}
        {payload.imageUrl && (
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{
              height: 100,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: BORDER_DEFAULT,
            }}
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
                  background: `${accentColor.slice(0, -1)} / 0.2)`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `${accentColor.slice(0, -1)} / 0.5)`,
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
            style={{ ...monoStyle, borderColor: `${accentColor.slice(0, -1)} / 0.3)` }}
            onFocus={onFocusAccent}
            onBlur={onBlurAccent}
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
            onFocus={onFocusNeg}
            onBlur={onBlurDefault}
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
            onFocus={(e) => { e.currentTarget.style.borderColor = `${accentColor.slice(0, -1)} / 0.5)`; }}
            onBlur={onBlurDefault}
          />
          <input
            placeholder="比例 (16:9)"
            value={payload.aspectRatio ?? ""}
            onChange={(e) => handleChange("aspectRatio", e.target.value)}
            className="nodrag"
            style={{ ...fieldStyle, width: 90 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `${accentColor.slice(0, -1)} / 0.5)`; }}
            onBlur={onBlurDefault}
          />
        </div>

        {/* ── Model selector ── */}
        <div className="relative nodrag">
          <button
            onClick={() => setShowModelPicker((v) => !v)}
            className="nodrag flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: "oklch(0.09 0.006 260)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: `${accentColor.slice(0, -1)} / 0.30)`,
              color: accentColor,
            }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {currentModel.label}
              <span
                className="px-1 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: `${accentColor.slice(0, -1)} / 0.15)`, color: accentColor }}
              >
                {currentModel.tag}
              </span>
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" style={{ transform: showModelPicker ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
          </button>

          {showModelPicker && (
            <div
              className="absolute bottom-full left-0 right-0 mb-1 rounded-lg overflow-hidden z-50"
              style={{
                background: "oklch(0.12 0.007 260)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "oklch(0.22 0.008 260)",
                boxShadow: "0 8px 24px oklch(0 0 0 / 0.5)",
              }}
            >
              {["Manus", "Poyo", "Higgsfield"].map((group) => (
                <div key={group}>
                  <div className="px-2.5 py-1" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "oklch(0.38 0.006 260)", borderBottom: "1px solid oklch(0.20 0.008 260)" }}>
                    {group}
                  </div>
                  {IMAGE_MODELS.filter((m) => m.group === group).map((m) => (
                    <button
                      key={m.id}
                      className="nodrag flex items-center justify-between w-full px-2.5 py-2 text-xs transition-colors"
                      style={{
                        background: model === m.id ? `${accentColor.slice(0, -1)} / 0.10)` : "transparent",
                        color: model === m.id ? accentColor : "oklch(0.65 0.006 260)",
                      }}
                      onClick={() => { setModel(m.id); setShowModelPicker(false); }}
                      onMouseEnter={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; }}
                      onMouseLeave={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span>{m.label}</span>
                      <span
                        className="px-1 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: `${accentColor.slice(0, -1)} / 0.12)`, color: `${accentColor.slice(0, -1)} / 0.8)` }}
                      >
                        {m.tag}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !payload.positivePrompt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
          style={{
            background: generating || !payload.positivePrompt?.trim()
              ? "oklch(0.13 0.007 260)"
              : `${accentColor.slice(0, -1)} / 0.15)`,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: generating || !payload.positivePrompt?.trim()
              ? BORDER_DEFAULT
              : `${accentColor.slice(0, -1)} / 0.4)`,
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
