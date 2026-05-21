import { memo, useCallback, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ImageGenNodeData, ImageGenModel } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Check, Grid2X2 } from "lucide-react";

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

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "oklch(0.42 0.006 260)",
  display: "block",
  marginBottom: 4,
};

const STYLES = ["写实", "动漫", "插画", "3D渲染", "水彩", "油画", "素描", "赛博朋克", "复古胶片"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"];

// Soul Standard supported sizes (from official SDK)
const SOUL_SIZES = [
  "512x512", "512x768", "512x1024",
  "768x512", "768x768", "768x1024",
  "1024x512", "1024x768", "1024x1024",
  "1024x1280", "1024x1536", "1280x1024", "1536x1024",
];

const MODELS: { value: ImageGenModel; label: string; desc: string; group: string }[] = [
  { value: "manus_forge",      label: "Manus Forge",        desc: "内置 · 稳定",   group: "Manus" },
  { value: "poyo_flux",        label: "Flux 1.1 Pro",       desc: "高质量 · 写实", group: "Poyo" },
  { value: "poyo_sdxl",        label: "SDXL",               desc: "快速 · 多风格", group: "Poyo" },
  { value: "hf_soul_standard", label: "Soul Standard",      desc: "旗舰 · 电影级", group: "Higgsfield" },
  { value: "hf_reve",          label: "Reve Text-to-Image", desc: "通用 · 快速",   group: "Higgsfield" },
];

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if we are in batch/grid mode
  const hasMultiple = (payload.imageUrls?.length ?? 0) > 1;

  const genMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      if (result.urls && result.urls.length > 1) {
        // Batch mode: store all urls, set first as selected imageUrl
        updateNodeData(id, { imageUrls: result.urls, imageUrl: result.urls[0] });
        toast.success(`批量生成完成，共 ${result.urls.length} 张图像`);
      } else {
        // Single mode: clear imageUrls, set imageUrl
        updateNodeData(id, { imageUrl: result.url, imageUrls: undefined });
        toast.success("图像生成成功");
      }
      setGenerating(false);
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { referenceImageUrl: result.url });
      setUploading(false);
      toast.success("参考图上传成功");
    },
    onError: (err) => {
      setUploading(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const update = useCallback(
    (field: keyof ImageGenNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
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
      // Soul Standard specific params
      ...(payload.model === "hf_soul_standard" ? {
        widthAndHeight: payload.widthAndHeight,
        quality: payload.soulQuality,
        batchSize: payload.batchSize,
        seed: payload.seed,
        enhancePrompt: payload.enhancePrompt,
      } : {}),
      // Reve specific params
      ...(payload.model === "hf_reve" ? {
        reveAspectRatio: payload.reveAspectRatio,
        reveResolution: payload.reveResolution,
      } : {}),
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16 MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSelectImage = (url: string) => {
    update("imageUrl", url);
    toast.success("已选择此图像");
  };

  const handleClearBatch = () => {
    updateNodeData(id, { imageUrls: undefined, imageUrl: undefined });
  };

  const isSoul = payload.model === "hf_soul_standard";
  const isReve = payload.model === "hf_reve";

  return (
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300}>
      <div className="flex flex-col h-full p-2.5 gap-2 overflow-auto">

        {/* ── Batch grid result ── */}
        {hasMultiple ? (
          <div className="flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 10, color: "oklch(0.42 0.006 260)", display: "flex", alignItems: "center", gap: 4 }}>
                <Grid2X2 style={{ width: 10, height: 10 }} />
                {payload.imageUrls!.length} 张图像 · 点击选择
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "oklch(0.72 0.20 330 / 0.12)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent, fontSize: 10 }}
                >
                  {generating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                  重新生成
                </button>
                <button
                  onClick={handleClearBatch}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "oklch(0.14 0.007 260)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, color: "oklch(0.50 0.006 260)", fontSize: 10 }}
                >
                  <X className="w-2.5 h-2.5" />
                  清空
                </button>
              </div>
            </div>

            {/* Grid */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
            >
              {payload.imageUrls!.map((url, idx) => {
                const isSelected = url === payload.imageUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectImage(url)}
                    className="nodrag relative rounded-lg overflow-hidden group"
                    style={{
                      aspectRatio: "1/1",
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: isSelected ? accent : "transparent",
                      background: "oklch(0.08 0.005 260)",
                      padding: 0,
                      cursor: "pointer",
                      transition: "border-color 150ms ease, opacity 150ms ease",
                      opacity: isSelected ? 1 : 0.72,
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = "0.72"; }}
                  >
                    <img src={url} alt={`generated-${idx}`} className="w-full h-full object-cover" draggable={false} />
                    {/* Selected checkmark */}
                    {isSelected && (
                      <div
                        className="absolute top-1 right-1 rounded-full flex items-center justify-center"
                        style={{ width: 16, height: 16, background: accent }}
                      >
                        <Check style={{ width: 10, height: 10, color: "oklch(0.08 0.005 260)" }} />
                      </div>
                    )}
                    {/* Hover overlay */}
                    {!isSelected && (
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        style={{ background: "oklch(0.72 0.20 330 / 0.15)" }}
                      >
                        <span style={{ fontSize: 9, color: accent, fontWeight: 600, letterSpacing: "0.05em" }}>选择</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected image preview (larger) */}
            {payload.imageUrl && (
              <div
                className="mt-1.5 rounded-lg overflow-hidden"
                style={{ borderWidth: 1, borderStyle: "solid", borderColor: `oklch(0.72 0.20 330 / 0.3)`, background: "oklch(0.08 0.005 260)" }}
              >
                <div style={{ fontSize: 9, color: accent, padding: "3px 8px", borderBottom: `1px solid oklch(0.72 0.20 330 / 0.15)`, letterSpacing: "0.05em", fontWeight: 600 }}>
                  ✓ 已选择
                </div>
                <img src={payload.imageUrl} alt="selected" className="w-full object-contain" style={{ maxHeight: 120 }} draggable={false} />
              </div>
            )}
          </div>
        ) : (
          /* ── Single image result ── */
          payload.imageUrl ? (
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
                  style={{ background: "oklch(0.72 0.20 330 / 0.2)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent }}
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
          )
        )}

        {/* Model selector */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
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
          <label style={labelStyle}>提示词 *</label>
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
          <label style={labelStyle}>反向提示词</label>
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

        {/* Reve specific params */}
        {isReve && (
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label style={labelStyle}>宽高比</label>
              <select
                value={payload.reveAspectRatio ?? "16:9"}
                onChange={(e) => update("reveAspectRatio", e.target.value)}
                className="nodrag"
                style={{ ...fieldBase, cursor: "pointer" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              >
                <option value="21:9">21:9 超宽</option>
                <option value="16:9">16:9 横屏</option>
                <option value="4:3">4:3 标准</option>
                <option value="1:1">1:1 方形</option>
                <option value="3:4">3:4 竖屏</option>
                <option value="9:16">9:16 竖屏</option>
              </select>
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>分辨率</label>
              <select
                value={payload.reveResolution ?? "720p"}
                onChange={(e) => update("reveResolution", e.target.value as "720p" | "1080p")}
                className="nodrag"
                style={{ ...fieldBase, cursor: "pointer" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </div>
          </div>
        )}

        {/* Style + Ratio (non-Soul, non-Reve models) */}
        {!isSoul && !isReve && (
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label style={labelStyle}>风格</label>
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
              <label style={labelStyle}>比例</label>
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
        )}

        {/* Soul Standard specific params */}
        {isSoul && (
          <>
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label style={labelStyle}>尺寸</label>
                <select
                  value={payload.widthAndHeight ?? "1024x1024"}
                  onChange={(e) => update("widthAndHeight", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  {SOUL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>质量</label>
                <select
                  value={payload.soulQuality ?? "720p"}
                  onChange={(e) => update("soulQuality", e.target.value as "720p" | "1080p")}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>
            <div className="flex gap-1.5">
              <div style={{ width: 80 }}>
                <label style={labelStyle}>批量</label>
                <select
                  value={String(payload.batchSize ?? 1)}
                  onChange={(e) => update("batchSize", Number(e.target.value))}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="1">1 张</option>
                  <option value="4">4 张</option>
                </select>
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Seed（可选）</label>
                <input
                  type="number"
                  placeholder="随机"
                  value={payload.seed ?? ""}
                  onChange={(e) => update("seed", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag"
                  style={fieldBase}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`enhance-${id}`}
                checked={Boolean(payload.enhancePrompt)}
                onChange={(e) => update("enhancePrompt", e.target.checked)}
                className="nodrag"
                style={{ accentColor: accent, width: 12, height: 12 }}
              />
              <label htmlFor={`enhance-${id}`} style={{ fontSize: 11, color: "oklch(0.60 0.006 260)", cursor: "pointer" }}>
                AI 增强提示词
              </label>
            </div>
          </>
        )}

        {/* Reference image upload */}
        <div>
          <label style={labelStyle}>参考图（可选）</label>
          {payload.referenceImageUrl ? (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{ height: 80, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "oklch(0.08 0.005 260)" }}
            >
              <img src={payload.referenceImageUrl} alt="reference" className="w-full h-full object-cover" draggable={false} />
              <button
                onClick={() => update("referenceImageUrl", undefined)}
                className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                style={{ background: "oklch(0 0 0 / 0.7)", color: "oklch(0.80 0.006 260)" }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="nodrag w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors"
              style={{
                borderWidth: 1, borderStyle: "dashed",
                borderColor: uploading ? BORDER_DEFAULT : "oklch(0.30 0.008 260)",
                background: "oklch(0.09 0.006 260)",
                color: uploading ? "oklch(0.38 0.006 260)" : "oklch(0.55 0.006 260)",
                fontSize: 11, cursor: uploading ? "not-allowed" : "pointer",
              }}
            >
              {uploading
                ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</>
                : <><Upload style={{ width: 13, height: 13 }} /> 点击上传参考图</>
              }
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
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
            borderWidth: 1, borderStyle: "solid",
            borderColor: generating || !payload.prompt?.trim() ? BORDER_DEFAULT : BORDER_ACCENT,
            color: generating || !payload.prompt?.trim() ? "oklch(0.38 0.006 260)" : accent,
            cursor: generating || !payload.prompt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating
            ? (isSoul && (payload.batchSize ?? 1) > 1 ? `批量生成中 (${payload.batchSize} 张)...` : "AI 生成中...")
            : (isSoul && (payload.batchSize ?? 1) > 1 ? `批量生成 ${payload.batchSize} 张` : "生成图像")}
        </button>
      </div>
    </BaseNode>
  );
});
