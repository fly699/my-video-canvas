import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, RefreshCw, ChevronDown, Upload, X, Wand2, History, Languages } from "lucide-react";
import { IMAGE_MODELS, type ImageModelId } from "@/lib/models";
import { makeImageProxyFallback } from "@/lib/utils";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";

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

const BORDER_DEFAULT = "oklch(0.20 0.008 260)";
const BORDER_FOCUS   = "oklch(0.65 0.20 160 / 0.6)";

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

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

export const StoryboardNode = memo(function StoryboardNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(!!selected);
  const [llmModel, setLlmModel] = useState<LLMModelId>("gemini-2.5-flash");
  const [showHistory, setShowHistory] = useState(false);

  // Auto-collapse inputs when deselected, expand when selected
  useEffect(() => {
    setInputExpanded(!!selected);
  }, [selected]);
  const model: ImageModelId = (payload.imageModel as ImageModelId) ?? "manus_forge";
  const setModel = (m: ImageModelId) => { updateNodeData(id, { imageModel: m }); };

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
      const imageUrl = result.url ?? result.urls?.[0];
      if (!imageUrl) { setGenerating(false); toast.error("生成完成但未返回图像"); return; }
      const currentHistory = (useCanvasStore.getState().nodes.find(n => n.id === id)?.data.payload as StoryboardNodeData)?.imageHistory ?? [];
      const newHistory = [imageUrl, ...currentHistory].filter((u): u is string => !!u).slice(0, 5);
      updateNodeData(id, { imageUrl, imageHistory: newHistory });
      setGenerating(false);
      toast.success("分镜图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  // AI prompt expansion
  const [expandingPrompt, setExpandingPrompt] = useState(false);
  const aiExpandMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setExpandingPrompt(false);
      toast.success("提示词已扩写");
    },
    onError: (err) => {
      setExpandingPrompt(false);
      toast.error("AI 扩写失败：" + err.message);
    },
  });

  const [expandingDesc, setExpandingDesc] = useState(false);
  const aiExpandDescMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { description: result.result });
      setExpandingDesc(false);
      toast.success("场景描述已扩写");
    },
    onError: (err) => {
      setExpandingDesc(false);
      toast.error("AI 扩写失败：" + err.message);
    },
  });

  const [translating, setTranslating] = useState(false);
  const aiTranslateMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setTranslating(false);
      toast.success("已翻译为英文提示词");
    },
    onError: (err) => {
      setTranslating(false);
      toast.error("翻译失败：" + err.message);
    },
  });

  const handleExpandPrompt = useCallback(() => {
    if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
    setExpandingPrompt(true);
    aiExpandMutation.mutate({ text: payload.description, mode: "storyboard_prompt", model: llmModel });
  }, [payload.description, aiExpandMutation]);

  const handleChange = useCallback(
    (field: keyof StoryboardNodeData, value: string | number | undefined) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.promptText?.trim()) { toast.error("请先填写提示词"); return; }
    setGenerating(true);
    genImageMutation.mutate({
      prompt: payload.promptText,
      negativePrompt: payload.negativePrompt,
      style: payload.colorTone,
      referenceImageUrl: payload.referenceImageUrl,
      model,
    });
  };

  const currentModel = IMAGE_MODELS.find((m) => m.value === model) ?? IMAGE_MODELS[0];

  return (
    <BaseNode id={id} selected={selected} nodeType="storyboard" title={data.title} minHeight={280}>
      <div className="flex flex-col h-full p-3.5 gap-3">

        {/* ── Image preview ── always visible ──*/}
        <div
          className="relative rounded-lg overflow-hidden flex-shrink-0"
          style={{
            height: 150,
            background: "oklch(0.09 0.006 260)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: BORDER_DEFAULT,
          }}
        >
          {payload.imageUrl ? (
            <>
              <img
                src={payload.imageUrl}
                alt="分镜"
                className="w-full h-full object-cover"
                draggable={false}
                onError={makeImageProxyFallback(payload.imageUrl ?? "")}
              />
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: "oklch(0.65 0.20 160 / 0.20)",
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "oklch(0.65 0.20 160 / 0.5)",
                    color: "oklch(0.75 0.18 160)",
                  }}
                >
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {generating ? "生成中..." : "重新生成"}
                </button>
                {(payload.imageHistory?.length ?? 0) > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all mt-1"
                    style={{
                      background: "oklch(0.68 0.22 285 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.68 0.22 285 / 0.5)",
                      color: "oklch(0.75 0.18 285)",
                    }}
                  >
                    <History className="w-3 h-3" />
                    历史 ({payload.imageHistory!.length})
                  </button>
                )}
              </div>
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
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: generating || !payload.promptText?.trim()
                    ? "oklch(0.22 0.008 260)"
                    : "oklch(0.65 0.20 160 / 0.45)",
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

        {/* ── Generation history panel ── */}
        {showHistory && (payload.imageHistory?.length ?? 0) > 1 && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.42 0.006 260)" }}>
                生成历史
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="nodrag"
                style={{ fontSize: 10, color: "oklch(0.40 0.006 260)", cursor: "pointer", background: "none", border: "none" }}
              >
                收起
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {payload.imageHistory!.map((url, i) => (
                <button
                  key={i}
                  onClick={() => { updateNodeData(id, { imageUrl: url }); setShowHistory(false); }}
                  className="nodrag flex-shrink-0 rounded overflow-hidden"
                  style={{
                    width: 60, height: 45,
                    border: url === payload.imageUrl
                      ? "1.5px solid oklch(0.65 0.20 160)"
                      : "1.5px solid oklch(0.22 0.008 260)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title={i === 0 ? "当前版本" : `版本 ${i + 1}`}
                >
                  <img
                    src={url}
                    alt={`历史 ${i + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={makeImageProxyFallback(url)}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Collapsible inputs ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: inputExpanded ? 2000 : 0,
            opacity: inputExpanded ? 1 : 0,
            transition: "max-height 250ms cubic-bezier(0.23,1,0.32,1), opacity 200ms ease",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
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
              onChange={(e) => handleChange(field, type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
              className="nodrag"
              style={{ ...fieldStyle, width }}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          ))}
          <input
            placeholder="运镜方式"
            value={payload.cameraMovement ?? ""}
            onChange={(e) => handleChange("cameraMovement", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
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
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={expandingDesc || expandingPrompt || translating} />
          <button
            onClick={() => {
              if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
              setExpandingDesc(true);
              aiExpandDescMutation.mutate({ text: payload.description, mode: "expand", model: llmModel });
            }}
            disabled={expandingDesc}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: expandingDesc ? "oklch(0.13 0.007 260)" : "oklch(0.65 0.20 160 / 0.10)",
              border: `1px solid ${expandingDesc ? "oklch(0.20 0.008 260)" : "oklch(0.65 0.20 160 / 0.35)"}`,
              color: expandingDesc ? "oklch(0.38 0.006 260)" : "oklch(0.65 0.20 160)",
              cursor: expandingDesc ? "not-allowed" : "pointer",
            }}
          >
            {expandingDesc ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI 扩写描述
          </button>
        </div>

        {/* ── Prompt ── */}
        <div className="flex flex-col gap-1">
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
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 9.5, color: "oklch(0.38 0.006 260)" }}>
              {(payload.promptText ?? "").length} 字
            </span>
          </div>
          <button
            onClick={handleExpandPrompt}
            disabled={expandingPrompt || !payload.description?.trim()}
            className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
            style={{
              background: expandingPrompt || !payload.description?.trim()
                ? "oklch(0.13 0.007 260)"
                : "oklch(0.65 0.20 160 / 0.12)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: expandingPrompt || !payload.description?.trim()
                ? "oklch(0.22 0.008 260)"
                : "oklch(0.65 0.20 160 / 0.35)",
              color: expandingPrompt || !payload.description?.trim()
                ? "oklch(0.38 0.006 260)"
                : "oklch(0.65 0.20 160)",
              cursor: expandingPrompt || !payload.description?.trim() ? "not-allowed" : "pointer",
            }}
          >
            {expandingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {expandingPrompt ? "AI 扩写中..." : "✨ AI 扩写提示词"}
          </button>
          <button
            onClick={() => {
              const text = payload.promptText?.trim() || payload.description?.trim();
              if (!text) { toast.error("请先填写内容"); return; }
              setTranslating(true);
              aiTranslateMutation.mutate({ text, mode: "translate_en", model: llmModel });
            }}
            disabled={translating}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: translating ? "oklch(0.13 0.007 260)" : "oklch(0.68 0.22 300 / 0.10)",
              border: `1px solid ${translating ? "oklch(0.20 0.008 260)" : "oklch(0.68 0.22 300 / 0.35)"}`,
              color: translating ? "oklch(0.38 0.006 260)" : "oklch(0.72 0.18 300)",
              cursor: translating ? "not-allowed" : "pointer",
            }}
          >
            {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
            翻译英文
          </button>
        </div>

        {/* ── Style row ── */}
        <div className="flex gap-1.5">
          <input
            placeholder="色调/风格"
            value={payload.colorTone ?? ""}
            onChange={(e) => handleChange("colorTone", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <input
            placeholder="镜头"
            value={payload.lens ?? ""}
            onChange={(e) => handleChange("lens", e.target.value)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </div>

        {/* ── Reference image upload ── */}
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

        {/* ── Model selector ── */}
        <div className="relative nodrag">
          <button
            onClick={() => setShowModelPicker((v) => !v)}
            className="nodrag flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: "oklch(0.09 0.006 260)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "oklch(0.65 0.20 160 / 0.30)",
              color: "oklch(0.72 0.18 160)",
            }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {currentModel.label}
              <span
                className="px-1 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: "oklch(0.65 0.20 160 / 0.15)", color: "oklch(0.65 0.20 160)" }}
              >
                {currentModel.group}
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
                        background: model === m.value ? "oklch(0.65 0.20 160 / 0.10)" : "transparent",
                        color: model === m.value ? "oklch(0.72 0.18 160)" : "oklch(0.65 0.006 260)",
                      }}
                      onClick={() => { setModel(m.value); setShowModelPicker(false); }}
                      onMouseEnter={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; }}
                      onMouseLeave={(e) => { if (model !== m.value) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span>{m.label}</span>
                      <span
                        className="px-1 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: "oklch(0.65 0.20 160 / 0.12)", color: "oklch(0.55 0.15 160)" }}
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
        {/* End collapsible inputs */}
        </div>

      </div>
    </BaseNode>
  );
});
