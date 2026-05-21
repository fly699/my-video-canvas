import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ImageGenNodeData, ImageGenModel } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Link, Cpu } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "image_gen";
    title: string;
    payload: ImageGenNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.72 0.20 330)";
const BORDER_DEFAULT = "oklch(0.20 0.008 260)";
const BORDER_ACCENT = `oklch(0.72 0.20 330 / 0.5)`;

const fieldBase: React.CSSProperties = {
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
  fontFamily: "var(--font-sans)",
  transition: "border-color 120ms ease",
};

const STYLES = ["写实", "动漫", "插画", "3D渲染", "水彩", "油画", "素描", "赛博朋克", "复古胶片"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"];
const MODELS: { value: ImageGenModel; label: string; desc: string; group: string }[] = [
  { value: "manus_forge",      label: "Manus Forge",              desc: "内置 · 稳定",      group: "Manus" },
  { value: "poyo_flux",        label: "Flux 1.1 Pro",             desc: "高质量 · 写实",    group: "Poyo" },
  { value: "poyo_sdxl",        label: "SDXL",                     desc: "快速 · 多风格",    group: "Poyo" },
  { value: "hf_soul_standard", label: "Soul Standard",            desc: "旗舰 · 电影级",    group: "Higgsfield" },
  { value: "hf_reve",          label: "Reve Text-to-Image",       desc: "通用 · 快速",      group: "Higgsfield" },
];

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);

  const genMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { imageUrl: result.url });
      setGenerating(false);
      toast.success("图像生成成功");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  const update = useCallback(
    (field: keyof ImageGenNodeData, value: string) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    setGenerating(true);
    genMutation.mutate({
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
      referenceImageUrl: payload.referenceImageUrl,
      model: payload.model,
    });
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300}>
      <div className="flex flex-col h-full p-2.5 gap-2 overflow-auto">

        {/* Result image */}
        {payload.imageUrl ? (
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "oklch(0.08 0.005 260)" }}
          >
            <img src={payload.imageUrl} alt="generated" className="w-full h-full object-contain" draggable={false} />
            <div
              className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
              style={{ background: "oklch(0 0 0 / 0.55)" }}
            >
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: "oklch(0.72 0.20 330 / 0.2)",
                  borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent,
                }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                重新生成
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "dashed", borderColor: `oklch(0.72 0.20 330 / 0.25)`, background: `oklch(0.72 0.20 330 / 0.04)` }}
          >
            <div className="flex flex-col items-center gap-1.5" style={{ color: "oklch(0.72 0.20 330 / 0.5)" }}>
              <Sparkles style={{ width: 24, height: 24 }} />
              <span style={{ fontSize: 11 }}>生成图像将显示在这里</span>
            </div>
          </div>
        )}

        {/* Model selector */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            模型
          </label>
          <select
            value={payload.model ?? ""}
            onChange={(e) => update("model", e.target.value)}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="">自动选择</option>
            {["Manus", "Poyo", "Higgsfield"].map((group) => (
              <optgroup key={group} label={`── ${group} ──`} style={{ background: "oklch(0.12 0.007 260)" }}>
                {MODELS.filter((m) => m.group === group).map((m) => (
                  <option key={m.value} value={m.value} style={{ background: "oklch(0.12 0.007 260)" }}>
                    {m.label} — {m.desc}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Prompt */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>
            提示词 *
          </label>
          <textarea
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onChange={(e) => update("prompt", e.target.value)}
            rows={3}
            className="nodrag"
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Negative prompt */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>
            反向提示词
          </label>
          <textarea
            placeholder="blurry, low quality..."
            value={payload.negativePrompt ?? ""}
            onChange={(e) => update("negativePrompt", e.target.value)}
            rows={2}
            className="nodrag"
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.45 0.008 260)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Style + Ratio */}
        <div className="flex gap-1.5">
          <div className="flex-1">
            <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>风格</label>
            <select
              value={payload.style ?? ""}
              onChange={(e) => update("style", e.target.value)}
              className="nodrag"
              style={{ ...fieldBase, cursor: "pointer" }}
            >
              <option value="">默认</option>
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ width: 80 }}>
            <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>比例</label>
            <select
              value={payload.aspectRatio ?? ""}
              onChange={(e) => update("aspectRatio", e.target.value)}
              className="nodrag"
              style={{ ...fieldBase, cursor: "pointer" }}
            >
              {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Reference image */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.42 0.006 260)", display: "block", marginBottom: 4 }}>
            参考图 URL（可选）
          </label>
          <div className="relative">
            <Link style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: "oklch(0.40 0.006 260)" }} />
            <input
              placeholder="https://..."
              value={payload.referenceImageUrl ?? ""}
              onChange={(e) => update("referenceImageUrl", e.target.value)}
              className="nodrag"
              style={{ ...fieldBase, paddingLeft: 24 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
            />
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !payload.prompt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all mt-auto"
          style={{
            background: generating || !payload.prompt?.trim()
              ? "oklch(0.13 0.007 260)"
              : "linear-gradient(135deg, oklch(0.72 0.20 330 / 0.18), oklch(0.68 0.22 285 / 0.18))",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: generating || !payload.prompt?.trim()
              ? BORDER_DEFAULT
              : BORDER_ACCENT,
            color: generating || !payload.prompt?.trim()
              ? "oklch(0.38 0.006 260)"
              : accent,
            cursor: generating || !payload.prompt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? "AI 生成中..." : "生成图像"}
        </button>
      </div>
    </BaseNode>
  );
});
