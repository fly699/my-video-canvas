import { memo, useCallback, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import type { PromptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, Upload, X, Languages, ScanText } from "lucide-react";
import { MediaImage } from "../MediaImage";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { NodeTextArea, NodeInput } from "../NodeTextInput";

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

const BORDER_DEFAULT = "var(--c-bd2)";
const accentColor = "oklch(0.68 0.22 300)";
const accentA = (a: number) => `oklch(0.68 0.22 300 / ${a})`;

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 12, background: "var(--c-input)",
  borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, borderRadius: 8,
  color: "var(--c-t1)", outline: "none", transition: "border-color 150ms ease, background 150ms ease", lineHeight: 1.5,
};
const monoStyle: React.CSSProperties = {
  ...fieldStyle, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, resize: "none", lineHeight: 1.7,
};

const DEFAULT_LLM: LLMModelId = "claude-sonnet-4-5-20250929";

export const PromptNode = memo(function PromptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const { mode: canvasMode } = useCanvasMode();
  const isCreative = canvasMode === "creative";
  const payload = data.payload;
  const expanded = Boolean(selected) || Boolean((payload as { pinned?: boolean }).pinned);

  const llmModel = (payload.llmModel as LLMModelId) ?? DEFAULT_LLM;
  const setLlmModel = (m: LLMModelId) => updateNodeData(id, { llmModel: m });

  const [uploadingRef, setUploadingRef] = useState(false);
  const [busy, setBusy] = useState<null | "analyze" | "expand" | "translate" | "pipeline">(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  const uploadRefMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => { updateNodeData(id, { referenceImageUrl: result.url }); setUploadingRef(false); toast.success("图片已上传"); },
    onError: (err) => { setUploadingRef(false); toast.error("图片上传失败：" + err.message); },
  });
  const enhanceMutation = trpc.aiEnhance.enhance.useMutation();
  const analyzeMutation = trpc.aiEnhance.analyzeImage.useMutation();

  const handleChange = useCallback(
    (field: keyof PromptNodeData, value: string) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );
  const toggle = (field: keyof PromptNodeData) => updateNodeData(id, { [field]: !payload[field] });

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); return; }
    setUploadingRef(true);
    const reader = new FileReader();
    reader.onload = () => { const base64 = (reader.result as string).split(",")[1]; uploadRefMutation.mutate({ base64, mimeType: file.type, filename: file.name }); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Individual ops (manual "run now" buttons) ──────────────────────────────
  const runAnalyze = async (): Promise<string | null> => {
    if (!payload.referenceImageUrl) { toast.error("请先上传或填写要分析的图片"); return null; }
    const r = await analyzeMutation.mutateAsync({ imageUrl: payload.referenceImageUrl, instruction: payload.positivePrompt?.trim() || undefined, model: llmModel });
    return r.result?.trim() || null;
  };
  const runEnhance = async (mode: "expand" | "translate_en", text: string): Promise<string | null> => {
    if (!text.trim()) { toast.error("提示词为空"); return null; }
    const r = await enhanceMutation.mutateAsync({ text, mode, model: llmModel });
    return r.result?.trim() || null;
  };

  const doManual = async (op: "analyze" | "expand" | "translate") => {
    if (busy) return;
    setBusy(op);
    try {
      let out: string | null = null;
      if (op === "analyze") out = await runAnalyze();
      else if (op === "expand") out = await runEnhance("expand", payload.positivePrompt ?? "");
      else out = await runEnhance("translate_en", payload.positivePrompt ?? "");
      if (out) {
        updateNodeData(id, { positivePrompt: out });
        toast.success(op === "analyze" ? "已从图片提取提示词" : op === "expand" ? "提示词已扩写" : "已翻译为英文");
      }
    } catch (e) { toast.error("处理失败：" + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };

  // ── Pipeline (node run button): analyze → expand → translate, per toggles ───
  const anyEnabled = !!(payload.enableAnalyze || payload.enableExpand || payload.enableTranslate);
  const handleRunPipeline = async () => {
    if (busy) return;
    setBusy("pipeline");
    try {
      let text = payload.positivePrompt ?? "";
      if (payload.enableAnalyze && payload.referenceImageUrl) { const r = await runAnalyze(); if (r) text = r; }
      if (payload.enableExpand && text.trim()) { const r = await runEnhance("expand", text); if (r) text = r; }
      if (payload.enableTranslate && text.trim()) { const r = await runEnhance("translate_en", text); if (r) text = r; }
      if (text && text !== payload.positivePrompt) updateNodeData(id, { positivePrompt: text });
      toast.success(anyEnabled ? "提示词处理完成" : "已使用当前提示词文本");
    } catch (e) { toast.error("处理失败：" + (e instanceof Error ? e.message : "")); }
    finally { setBusy(null); }
  };

  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = accentA(0.6); };
  const onBlurAccent  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = accentA(0.3); };
  const onFocusNeg    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "var(--c-t4)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  // ── Collapsed-state summary: show both positive & negative prompts ──────────
  const pos = payload.positivePrompt?.trim();
  const neg = payload.negativePrompt?.trim();
  const hasAnyPrompt = !!(pos || neg);
  const clampStyle: React.CSSProperties = {
    fontSize: 11, lineHeight: 1.6, fontFamily: "monospace", margin: 0,
    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
  };
  const promptSummary = hasAnyPrompt ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {pos && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accentColor, marginBottom: 2 }}>正向</div>
          <p style={{ ...clampStyle, color: "var(--c-t2)" }}>{pos}</p>
        </div>
      )}
      {neg && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-t4)", marginBottom: 2 }}>反向</div>
          <p style={{ ...clampStyle, color: "var(--c-t3)" }}>{neg}</p>
        </div>
      )}
    </div>
  ) : null;

  // Creative-mode collapsed preview only — the prompt text is an INPUT, not a
  // generated result, so in other modes it must NOT act as a hero (the global
  // collapse rule would otherwise hide the editor before anything is produced).
  const heroMedia = isCreative && hasAnyPrompt ? (
    <div className="node-hero-placeholder" style={{ minHeight: 80, padding: "14px 16px", alignItems: "flex-start", justifyContent: "flex-start" }}>
      {promptSummary}
    </div>
  ) : null;

  const canRun = !!payload.positivePrompt?.trim() || (!!payload.referenceImageUrl && !!payload.enableAnalyze);

  return (
    <BaseNode
      id={id} selected={selected} nodeType="prompt" title={data.title} minHeight={200} resizable heroMedia={heroMedia}
      onRun={handleRunPipeline} running={busy === "pipeline"} canRun={canRun} hasResult={!!payload.positivePrompt?.trim()}
    >
      <div className="flex flex-col h-full p-3.5 gap-3">
        {/* Collapsed summary (professional mode): fills the remaining node height and
            scrolls, so a resized-tall node has no dead space and long prompts are
            fully readable (no line clamp) by scrolling. */}
        {!expanded && (
          hasAnyPrompt ? (
            <div className="nodrag nowheel" style={{ flex: 1, minHeight: 0, maxHeight: 1000, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {pos && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accentColor, marginBottom: 3 }}>正向</div>
                  <p style={{ fontSize: 11, lineHeight: 1.65, fontFamily: "monospace", margin: 0, color: "var(--c-t2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{pos}</p>
                </div>
              )}
              {neg && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-t4)", marginBottom: 3 }}>反向</div>
                  <p style={{ fontSize: 11, lineHeight: 1.65, fontFamily: "monospace", margin: 0, color: "var(--c-t3)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{neg}</p>
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 11, color: "var(--c-t4)", fontFamily: "monospace", margin: 0 }}>未填写提示词</p>
          )
        )}
        <div className={expanded ? "nowheel" : undefined} style={{ overflow: expanded ? "auto" : "hidden", flex: expanded ? "1 1 auto" : undefined, minHeight: 0, maxHeight: expanded ? "100000px" : "0px", transition: expanded ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)" : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)" }}>
          <div className="flex flex-col gap-3 h-full">

            {/* Positive prompt — grows to fill the node's height when resized taller */}
            <div className="flex flex-col" style={{ flex: 1, minHeight: 90 }}>
              <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)", display: "block", marginBottom: 5 }}>正向提示词（输出至下游）</label>
              <NodeTextArea className="nodrag nowheel" placeholder="masterpiece, best quality, cinematic lighting..."
                value={payload.positivePrompt ?? ""} onValueChange={(v) => handleChange("positivePrompt", v)} rows={3}
                style={{ ...monoStyle, borderColor: accentA(0.3), flex: 1, minHeight: 64, height: "100%" }} onFocus={onFocusAccent} onBlur={onBlurAccent} />
            </div>

            {/* Negative prompt */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>反向提示词</label>
              <NodeTextArea className="nodrag nowheel" placeholder="blurry, low quality, distorted..."
                value={payload.negativePrompt ?? ""} onValueChange={(v) => handleChange("negativePrompt", v)} rows={2}
                style={monoStyle} onFocus={onFocusNeg} onBlur={onBlurDefault} />
            </div>

            {/* Input image (analysis only — never output downstream) */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>输入图片（仅用于分析提取提示词）</label>
              {payload.referenceImageUrl && (
                <div className="relative rounded-lg overflow-hidden mb-1.5" style={{ height: 80, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT }}>
                  <MediaImage src={payload.referenceImageUrl} alt="输入图" className="w-full h-full object-cover" draggable={false} />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <input ref={refInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefUpload} />
                <button onClick={() => refInputRef.current?.click()} disabled={uploadingRef}
                  className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all flex-1"
                  style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t3)", cursor: uploadingRef ? "not-allowed" : "pointer" }}>
                  {uploadingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {payload.referenceImageUrl ? "更换图片" : "上传图片"}
                </button>
                {payload.referenceImageUrl && (
                  <button onClick={() => updateNodeData(id, { referenceImageUrl: undefined })} className="nodrag p-1 rounded transition-all"
                    style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t3)" }} title="清除图片"><X className="w-3 h-3" /></button>
                )}
              </div>
              <input type="url" placeholder="或粘贴公网图片 URL（https://…）"
                value={payload.referenceImageUrl?.startsWith("http") ? payload.referenceImageUrl : ""}
                onChange={(e) => updateNodeData(id, { referenceImageUrl: e.target.value.trim() || undefined })}
                className="nodrag" style={{ ...fieldStyle, fontSize: 10.5, marginTop: 6 }} onFocus={onFocusAccent} onBlur={onBlurDefault} />
            </div>

            {/* AI model */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>AI 模型（分析 / 扩写 / 翻译）</label>
              <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={!!busy} />
            </div>

            {/* AI ops with workflow toggles */}
            <div className="flex flex-col gap-1.5">
              <div style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.5 }}>
                AI 处理（开关决定是否在工作流运行时参与；多个开启时按 分析→扩写→翻译 顺序执行；全部关闭则用上方文本框内容）
              </div>
              <OpRow icon={<ScanText className="w-3 h-3" />} label="分析提取（图→提示词）" busy={busy === "analyze"} disabled={!!busy}
                on={!!payload.enableAnalyze} onToggle={() => toggle("enableAnalyze")} onRun={() => doManual("analyze")} />
              <OpRow icon={<Sparkles className="w-3 h-3" />} label="AI 扩写" busy={busy === "expand"} disabled={!!busy}
                on={!!payload.enableExpand} onToggle={() => toggle("enableExpand")} onRun={() => doManual("expand")} />
              <OpRow icon={<Languages className="w-3 h-3" />} label="翻译英文" busy={busy === "translate"} disabled={!!busy}
                on={!!payload.enableTranslate} onToggle={() => toggle("enableTranslate")} onRun={() => doManual("translate")} />
            </div>

            {/* Style + ratio with downstream-pass checkboxes */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5 items-center">
                <NodeInput placeholder="风格" value={payload.style ?? ""} onValueChange={(v) => handleChange("style", v)}
                  className="nodrag flex-1" style={fieldStyle} onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.5); }} onBlur={onBlurDefault} />
                <PassCheck label="传递" on={!!payload.passStyle} onToggle={() => toggle("passStyle")} />
              </div>
              <div className="flex gap-1.5 items-center">
                <NodeInput placeholder="比例 (16:9)" value={payload.aspectRatio ?? ""} onValueChange={(v) => handleChange("aspectRatio", v)}
                  className="nodrag flex-1" style={fieldStyle} onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.5); }} onBlur={onBlurDefault} />
                <PassCheck label="传递" on={!!payload.passRatio} onToggle={() => toggle("passRatio")} />
              </div>
            </div>

          </div>
        </div>
      </div>
    </BaseNode>
  );
});

function OpRow({ icon, label, on, busy, disabled, onToggle, onRun }: {
  icon: React.ReactNode; label: string; on: boolean; busy: boolean; disabled: boolean; onToggle: () => void; onRun: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onRun} disabled={disabled}
        className="nodrag flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all"
        style={{ background: accentA(0.10), border: `1px solid ${accentA(0.30)}`, color: accentColor, cursor: disabled ? "not-allowed" : "pointer", justifyContent: "flex-start" }}
        title="立即执行一次（写入正向提示词）">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
        {label}
      </button>
      <button onClick={onToggle} disabled={disabled} title={on ? "工作流中参与（点击关闭）" : "工作流中不参与（点击开启）"}
        className="nodrag flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all flex-shrink-0"
        style={{ background: on ? accentA(0.18) : "var(--c-surface)", border: `1px solid ${on ? accentA(0.45) : BORDER_DEFAULT}`, color: on ? accentColor : "var(--c-t4)", cursor: disabled ? "not-allowed" : "pointer", minWidth: 56 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? accentColor : "var(--c-t4)", flexShrink: 0 }} />
        {on ? "工作流" : "关"}
      </button>
    </div>
  );
}

function PassCheck({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} title={on ? "传递至下游（点击关闭）" : "不传递至下游（点击开启）"}
      className="nodrag flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all flex-shrink-0"
      style={{ background: on ? accentA(0.18) : "var(--c-surface)", border: `1px solid ${on ? accentA(0.45) : BORDER_DEFAULT}`, color: on ? accentColor : "var(--c-t4)", minWidth: 56 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? accentColor : "var(--c-t4)", flexShrink: 0 }} />
      {label}
    </button>
  );
}
