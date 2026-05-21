import { memo, useCallback, useRef, useState } from "react";
import { IMAGE_MODELS } from "@/lib/models";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PromptNodeData, ImageGenModel } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, ChevronDown, Upload, X, Grid2X2, Check, Languages } from "lucide-react";
import { makeImageProxyFallback } from "@/lib/utils";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";

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

const accentColor = "oklch(0.68 0.22 300)";
const accentA = (a: number) => `oklch(0.68 0.22 300 / ${a})`;

const fieldStyle: React.CSSProperties = {
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

const monoStyle: React.CSSProperties = {
  ...fieldStyle,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 11,
  resize: "none",
  lineHeight: 1.7,
};

export const PromptNode = memo(function PromptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const model = (payload.imageModel as string) ?? IMAGE_MODELS[0].value;
  const setModel = (m: string) => { updateNodeData(id, { imageModel: m as ImageGenModel }); };

  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  const uploadRefMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { referenceImageUrl: result.url });
      setUploadingRef(false);
      toast.success("参考图已上传");
    },
    onError: (err) => {
      setUploadingRef(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const [expandingPrompt, setExpandingPrompt] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [llmModel, setLlmModel] = useState<LLMModelId>("gemini-2.5-flash");

  const aiExpandMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { positivePrompt: result.result });
      setExpandingPrompt(false);
      toast.success("提示词已扩写");
    },
    onError: (err) => {
      setExpandingPrompt(false);
      toast.error("扩写失败：" + err.message);
    },
  });

  const aiTranslateMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { positivePrompt: result.result });
      setTranslating(false);
      toast.success("已翻译为英文");
    },
    onError: (err) => {
      setTranslating(false);
      toast.error("翻译失败：" + err.message);
    },
  });

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); return; }
    setUploadingRef(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadRefMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      if (result.urls && result.urls.length > 1) {
        updateNodeData(id, { imageUrls: result.urls, imageUrl: result.urls[0], selectedImageIndex: 0 });
        toast.success(`${result.urls.length} 张图像已生成`);
      } else {
        updateNodeData(id, { imageUrl: result.url, imageUrls: undefined, selectedImageIndex: undefined });
        toast.success("图像已生成");
      }
    },
    onError: (err) => {
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
    genImageMutation.mutate({
      prompt: payload.positivePrompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
      referenceImageUrl: payload.referenceImageUrl,
      model: model as ImageGenModel,
      ...((model === "poyo_flux" || model === "poyo_sdxl") ? {
        poyoAspectRatio: payload.aspectRatio,
      } : {}),
      ...(model === "hf_soul_standard" && batchMode ? { batchSize: 2 } : {}),
    });
  };

  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = accentA(0.6); };
  const onBlurAccent  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = accentA(0.3); };
  const onFocusNeg    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "oklch(0.45 0.008 260)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  const currentModel = IMAGE_MODELS.find((m) => m.value === model) ?? IMAGE_MODELS[0];

  return (
    <BaseNode id={id} selected={selected} nodeType="prompt" title={data.title} minHeight={200} resizable>
      <div className="flex flex-col h-full p-3.5 gap-3">

        {/* Preview area — single or A/B compare */}
        {payload.imageUrls && payload.imageUrls.length > 1 ? (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <div className="flex gap-1.5">
              {payload.imageUrls.map((url, i) => (
                <div
                  key={i}
                  className="relative rounded-lg overflow-hidden flex-1"
                  style={{
                    height: 90,
                    border: `1.5px solid ${(payload.selectedImageIndex ?? 0) === i ? accentColor : "oklch(0.22 0.008 260)"}`,
                    cursor: "pointer",
                  }}
                  onClick={() => updateNodeData(id, { imageUrl: url, selectedImageIndex: i })}
                >
                  <img
                    src={url}
                    alt={`图像 ${i + 1}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                    onError={makeImageProxyFallback(url)}
                  />
                  {(payload.selectedImageIndex ?? 0) === i && (
                    <div
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: accentColor }}
                    >
                      <Check style={{ width: 9, height: 9, color: "white" }} />
                    </div>
                  )}
                  <div
                    className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-semibold"
                    style={{ background: "oklch(0 0 0 / 0.6)", color: "oklch(0.85 0.005 260)" }}
                  >
                    {i === 0 ? "A" : "B"}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: "oklch(0.40 0.006 260)", textAlign: "center" }}>
              点击选择图像 · 已选: {(payload.selectedImageIndex ?? 0) === 0 ? "A" : "B"}
            </p>
          </div>
        ) : payload.imageUrl ? (
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{
              height: 100,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: BORDER_DEFAULT,
            }}
          >
            <img
              src={payload.imageUrl}
              alt="preview"
              className="w-full h-full object-cover"
              draggable={false}
              onError={makeImageProxyFallback(payload.imageUrl ?? "")}
            />
            <div
              className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center"
              style={{ background: "oklch(0 0 0 / 0.55)" }}
            >
              <button
                onClick={handleGenerate}
                disabled={genImageMutation.isPending}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: accentA(0.2),
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: accentA(0.5),
                  color: accentColor,
                }}
              >
                {genImageMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                重新生成
              </button>
            </div>
          </div>
        ) : null}

        {/* Positive prompt */}
        <div>
          <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.45 0.008 260)", display: "block", marginBottom: 5 }}>
            正向提示词
          </label>
          <textarea
            placeholder="masterpiece, best quality, cinematic lighting..."
            value={payload.positivePrompt}
            onChange={(e) => handleChange("positivePrompt", e.target.value)}
            rows={3}
            className="nodrag"
            style={{ ...monoStyle, borderColor: accentA(0.3) }}
            onFocus={onFocusAccent}
            onBlur={onBlurAccent}
          />
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={expandingPrompt || translating} />
            <button
              onClick={() => {
                if (!payload.positivePrompt?.trim()) { toast.error("请先填写提示词"); return; }
                setExpandingPrompt(true);
                aiExpandMutation.mutate({ text: payload.positivePrompt, mode: "expand", model: llmModel });
              }}
              disabled={expandingPrompt || translating}
              className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
              style={{
                background: expandingPrompt ? "oklch(0.13 0.007 260)" : "oklch(0.68 0.22 300 / 0.10)",
                border: `1px solid ${expandingPrompt ? "oklch(0.20 0.008 260)" : "oklch(0.68 0.22 300 / 0.35)"}`,
                color: expandingPrompt || translating ? "oklch(0.38 0.006 260)" : "oklch(0.72 0.18 300)",
                cursor: expandingPrompt || translating ? "not-allowed" : "pointer",
              }}
            >
              {expandingPrompt ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
              AI 扩写
            </button>
            <button
              onClick={() => {
                if (!payload.positivePrompt?.trim()) { toast.error("请先填写提示词"); return; }
                setTranslating(true);
                aiTranslateMutation.mutate({ text: payload.positivePrompt, mode: "translate_en", model: llmModel });
              }}
              disabled={translating || expandingPrompt}
              className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
              style={{
                background: translating ? "oklch(0.13 0.007 260)" : "oklch(0.65 0.18 200 / 0.10)",
                border: `1px solid ${translating ? "oklch(0.20 0.008 260)" : "oklch(0.65 0.18 200 / 0.35)"}`,
                color: translating || expandingPrompt ? "oklch(0.38 0.006 260)" : "oklch(0.70 0.16 200)",
                cursor: translating || expandingPrompt ? "not-allowed" : "pointer",
              }}
            >
              {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
              翻译英文
            </button>
          </div>
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

        {/* Reference image upload */}
        <div className="flex items-center gap-1.5">
          <input
            ref={refInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleRefUpload}
          />
          <button
            onClick={() => refInputRef.current?.click()}
            disabled={uploadingRef}
            className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all flex-1"
            style={{
              background: "oklch(0.09 0.006 260)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "oklch(0.22 0.008 260)",
              color: "oklch(0.55 0.006 260)",
              cursor: uploadingRef ? "not-allowed" : "pointer",
            }}
          >
            {uploadingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {payload.referenceImageUrl ? "更换参考图" : "上传参考图"}
          </button>
          {payload.referenceImageUrl && (
            <button
              onClick={() => updateNodeData(id, { referenceImageUrl: undefined })}
              className="nodrag p-1 rounded transition-all"
              style={{ background: "oklch(0.09 0.006 260)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.22 0.008 260)", color: "oklch(0.50 0.006 260)" }}
              title="清除参考图"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Style + ratio */}
        <div className="flex gap-1.5">
          <input
            placeholder="风格"
            value={payload.style ?? ""}
            onChange={(e) => handleChange("style", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.5); }}
            onBlur={onBlurDefault}
          />
          <input
            placeholder="比例 (16:9)"
            value={payload.aspectRatio ?? ""}
            onChange={(e) => handleChange("aspectRatio", e.target.value)}
            className="nodrag"
            style={{ ...fieldStyle, width: 90 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.5); }}
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
              borderColor: accentA(0.30),
              color: accentColor,
            }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {currentModel.label}
              <span
                className="px-1 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: accentA(0.15), color: accentColor }}
              >
                {currentModel.desc}
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
                      key={m.value}
                      className="nodrag flex items-center justify-between w-full px-2.5 py-2 text-xs transition-colors"
                      style={{
                        background: model === m.value ? accentA(0.10) : "transparent",
                        color: model === m.value ? accentColor : "oklch(0.65 0.006 260)",
                      }}
                      onClick={() => { setModel(m.value); setShowModelPicker(false); }}
                      onMouseEnter={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; }}
                      onMouseLeave={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span>{m.label}</span>
                      <span
                        className="px-1 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: accentA(0.12), color: accentA(0.8) }}
                      >
                        {m.desc}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Batch toggle + Generate button */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setBatchMode((v) => !v)}
            className="nodrag flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all flex-shrink-0"
            style={{
              background: batchMode ? accentA(0.15) : "oklch(0.13 0.007 260)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: batchMode ? accentA(0.4) : BORDER_DEFAULT,
              color: batchMode ? accentColor : "oklch(0.45 0.008 260)",
              cursor: "pointer",
            }}
            title={batchMode ? "当前：生成2图 A/B对比" : "点击开启A/B对比模式"}
          >
            <Grid2X2 className="w-3 h-3" />
            {batchMode ? "A/B" : "1图"}
          </button>
          <button
            onClick={handleGenerate}
            disabled={genImageMutation.isPending || !payload.positivePrompt?.trim()}
            className="nodrag flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: genImageMutation.isPending || !payload.positivePrompt?.trim()
                ? "oklch(0.13 0.007 260)"
                : accentA(0.15),
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: genImageMutation.isPending || !payload.positivePrompt?.trim()
                ? BORDER_DEFAULT
                : accentA(0.4),
              color: genImageMutation.isPending || !payload.positivePrompt?.trim()
                ? "oklch(0.38 0.006 260)"
                : accentColor,
              cursor: genImageMutation.isPending || !payload.positivePrompt?.trim() ? "not-allowed" : "pointer",
            }}
          >
            {genImageMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {genImageMutation.isPending ? "生成中..." : batchMode ? "生成 2 图" : "AI 生成图像"}
          </button>
        </div>
      </div>
    </BaseNode>
  );
});
