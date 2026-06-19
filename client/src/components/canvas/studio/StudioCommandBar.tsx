import { useState, useRef } from "react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { NodeTextArea } from "../NodeTextInput";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { PROVIDER_PICKER_OPTIONS, videoProviderChangePatch, PROVIDER_PARAMS, withParamDefaults } from "../nodes/VideoTaskNode";
import { IMAGE_MODEL_PARAMS, paramOptions } from "../../../lib/paramDefs";
import { estimateImageCost, estimateVideoCost, costEstimateLabel } from "../../../lib/costEstimate";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { ArrowUp, Loader2, ImagePlus, Languages, Sparkles, X } from "lucide-react";
import type { NodeType, VideoProvider } from "../../../../../shared/types";

// The 4 "generative" nodes keep a bespoke bar (model pickers + image/video param
// schemas + cost). All OTHER nodes are driven by SIMPLE_FORMS (config-driven bar,
// defined below). STUDIO_COMMAND_BAR_TYPES (exported at the bottom) is the union.
const GENERATIVE_TYPES = new Set<NodeType>([
  "image_gen", "storyboard", "video_task", "script",
]);

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

// Compact inline control styling — small "pill" dropdowns/inputs that sit in one row.
const chip: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, height: 32, padding: "0 9px", borderRadius: 9,
  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)",
  outline: "none", cursor: "pointer", maxWidth: 170,
};

// Inline AI prompt-tool button (扩写 / 翻译), pinned to the prompt's top-right.
const enhanceBtn: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 7, border: "1px solid var(--c-bd2)", flexShrink: 0,
  background: "var(--c-elevated)", color: "var(--c-t2)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

interface Props {
  nodeId: string;
  onRun?: () => void;
  canRun?: boolean;
  running?: boolean;
  hasResult?: boolean;
}

// ── Dispatcher: generative nodes → GenerativeBar; everything else → SimpleBar ──
export function StudioCommandBar(props: Props) {
  const nodeType = useCanvasStore((s) => s.nodes.find((n) => n.id === props.nodeId)?.data.nodeType);
  if (!nodeType) return null;
  if (GENERATIVE_TYPES.has(nodeType)) return <GenerativeBar {...props} />;
  if (SIMPLE_FORMS[nodeType]) return <SimpleBar {...props} form={SIMPLE_FORMS[nodeType]!} />;
  return null;
}

function GenerativeBar({ nodeId, onRun, canRun = true, running = false, hasResult = false }: Props) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  const enhanceMutation = trpc.aiEnhance.enhance.useMutation();
  const [enhancing, setEnhancing] = useState<null | "expand" | "translate_en">(null);
  if (!node) return null;

  const nodeType = node.data.nodeType;
  const payload = node.data.payload as Record<string, unknown>;
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const set = (patch: Record<string, unknown>) => updateNodeData(nodeId, patch);

  const textField = nodeType === "script" ? "content"
    : nodeType === "storyboard" ? (typeof payload.description === "string" ? "description" : "promptText")
    : "prompt";
  const placeholder = nodeType === "script" ? "脚本主题 / 内容…" : nodeType === "video_task" ? "描述你想生成的视频…" : "描述你想生成的内容…";

  // AI 提示词增强（扩写 / 翻译为英文）—— 复用通用 aiEnhance.enhance（model 可选，
  // 后端 invokeLLMWithKie 在运行时统一做权限/计费门控，皮肤层不触碰）。脚本节点带自
  // 己的 LLM 模型，其余用服务端默认。
  const enhanceModel = nodeType === "script" && LLM_MODELS.some((m) => m.id === payload.aiLlmModel)
    ? (payload.aiLlmModel as string) : undefined;
  const doEnhance = async (mode: "expand" | "translate_en") => {
    if (enhancing) return;
    const text = str(textField).trim();
    if (!text) { toast.error("提示词为空"); return; }
    setEnhancing(mode);
    try {
      const r = await enhanceMutation.mutateAsync({ text, mode, model: enhanceModel });
      const out = r.result?.trim();
      if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) return;
      if (out) { set({ [textField]: out }); toast.success(mode === "expand" ? "提示词已扩写" : "已翻译为英文"); }
    } catch (e) { toast.error("处理失败：" + (e instanceof Error ? e.message : "")); }
    finally { setEnhancing(null); }
  };

  const imageModel = nodeType === "image_gen" ? (str("model") || resolve("image_gen", "image"))
    : nodeType === "storyboard" ? (str("imageModel") || resolve("storyboard", "image")) : "";
  const imageModelField = nodeType === "image_gen" ? "model" : nodeType === "storyboard" ? "imageModel" : "";
  const imageDefs = imageModel ? (IMAGE_MODEL_PARAMS[imageModel] ?? []) : [];
  const showAspect = nodeType === "image_gen" || nodeType === "storyboard";
  // 参考图：图像/分镜/视频任务（图生视频）都用同一套 referenceImages 模型。
  const showRefImages = nodeType === "image_gen" || nodeType === "storyboard" || nodeType === "video_task";
  const count = Number(payload.imageN ?? payload.batchSize ?? payload.fluxNumImages ?? 1) || 1;

  // video_task：按 provider 的 PROVIDER_PARAMS（时长/分辨率/宽高比/镜头等）渲染紧凑控件，
  // 写入 payload.params（与节点同一真源，节点每次渲染 fresh 读取，零分叉）。
  const videoProvider = nodeType === "video_task" ? str("provider") : "";
  const videoDefs = videoProvider ? (PROVIDER_PARAMS[videoProvider] ?? []) : [];
  const videoParams = (payload.params as Record<string, unknown> | undefined) ?? {};
  const setVideoParam = (key: string, value: unknown) => set({ params: { ...videoParams, [key]: value } });

  const cost = (nodeType === "image_gen" || nodeType === "storyboard") && imageModel ? estimateImageCost(imageModel, count)
    : nodeType === "video_task" && videoProvider ? estimateVideoCost(videoProvider, withParamDefaults(videoProvider, videoParams))
    : null;
  const costLabel = cost ? costEstimateLabel(cost) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {/* prompt — full width, no label; AI 扩写/翻译 工具固定在右上角（LibLib 式内嵌工具） */}
      <div style={{ position: "relative" }}>
        <NodeTextArea value={str(textField)} onValueChange={(v) => set({ [textField]: v })} rows={3} placeholder={placeholder}
          style={{ width: "100%", fontSize: 13.5, padding: "10px 78px 10px 12px", borderRadius: 11, background: "var(--c-input)",
            border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", lineHeight: 1.55, resize: "vertical", minHeight: 58 }} />
        <div className="nodrag" style={{ position: "absolute", top: 7, right: 8, display: "flex", gap: 5 }}>
          <button onClick={(e) => { e.stopPropagation(); void doEnhance("expand"); }} disabled={!!enhancing} title="AI 扩写提示词"
            style={enhanceBtn}>{enhancing === "expand" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}</button>
          <button onClick={(e) => { e.stopPropagation(); void doEnhance("translate_en"); }} disabled={!!enhancing} title="翻译为英文"
            style={enhanceBtn}>{enhancing === "translate_en" ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}</button>
        </div>
      </div>

      {/* command bar — ONE horizontal row of compact inline controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {/* model */}
        {nodeType === "script" ? (
          <LLMModelPicker value={(LLM_MODELS.some((m) => m.id === payload.aiLlmModel) ? payload.aiLlmModel : resolve("script", "llm")) as LLMModelId} onChange={(v) => set({ aiLlmModel: v })} />
        ) : nodeType === "video_task" ? (
          <ModelPicker value={str("provider")} onChange={(v) => set(videoProviderChangePatch(v as VideoProvider))} options={PROVIDER_PICKER_OPTIONS} minWidth={140} />
        ) : (
          <ModelPicker value={imageModel} onChange={(v) => set({ [imageModelField]: v })} options={IMAGE_MODEL_PICKER_OPTIONS} minWidth={140} />
        )}

        {/* aspect — compact dropdown */}
        {showAspect && (
          <select className="nodrag" title="画面比例" value={typeof payload.aspectRatio === "string" ? payload.aspectRatio : "16:9"}
            onChange={(e) => set({ aspectRatio: e.target.value })} style={chip}>
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}

        {/* model main params — each as a compact inline control in the SAME row */}
        {imageDefs.map((def) => {
          if (def.type === "select") {
            const opts = paramOptions(def);
            const cur = (payload[def.key] as string | undefined) ?? def.default ?? opts[0]?.value ?? "";
            return (
              <select key={def.key} className="nodrag" title={def.label} value={cur} onChange={(e) => set({ [def.key]: e.target.value })} style={chip}>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          }
          if (def.type === "number") {
            const cur = (payload[def.key] as number | undefined) ?? def.default ?? def.min ?? 1;
            return (
              <input key={def.key} type="number" className="nodrag" title={def.label} value={cur} min={def.min} max={def.max} step={def.step ?? 1}
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ [def.key]: n }); }} style={{ ...chip, width: 72, maxWidth: 72 }} />
            );
          }
          const cur = (payload[def.key] as boolean | undefined) ?? def.default ?? false;
          return (
            <label key={def.key} className="nodrag" title={def.label} style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={cur} onChange={(e) => set({ [def.key]: e.target.checked })} />
              <span style={{ fontSize: 11.5, color: "var(--c-t2)" }}>{def.label}</span>
            </label>
          );
        })}

        {/* video provider params — duration/resolution/aspect/… each as a compact control */}
        {videoDefs.map((def) => {
          const curRaw = videoParams[def.key] ?? def.default;
          if (def.type === "select") {
            return (
              <select key={def.key} className="nodrag" title={def.label} value={String(curRaw ?? "")}
                onChange={(e) => { const raw = e.target.value; const num = Number(raw); setVideoParam(def.key, raw === "" || Number.isNaN(num) ? raw : num); }} style={chip}>
                {def.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
              </select>
            );
          }
          if (def.type === "number" || def.type === "range") {
            const cur = typeof curRaw === "number" ? curRaw : (def.default ?? def.min);
            return (
              <input key={def.key} type="number" className="nodrag" title={def.label + (def.type === "range" && def.unit ? `（${def.unit}）` : "")}
                value={cur} min={def.min} max={def.max} step={def.step}
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setVideoParam(def.key, n); }} style={{ ...chip, width: 76, maxWidth: 76 }} />
            );
          }
          const cur = typeof curRaw === "boolean" ? curRaw : (def.default ?? false);
          return (
            <label key={def.key} className="nodrag" title={def.label} style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={cur} onChange={(e) => setVideoParam(def.key, e.target.checked)} />
              <span style={{ fontSize: 11.5, color: "var(--c-t2)" }}>{def.label}</span>
            </label>
          );
        })}

        {/* reference images — compact thumbnails + upload, fills the middle of the row */}
        {showRefImages && <StudioRefImages nodeId={nodeId} payload={payload} />}

        {/* right group: cost (⚡) + send/generate (↑) — pushed to the far right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
          {costLabel && <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ui-amber, var(--c-t2))", whiteSpace: "nowrap" }}>⚡ {costLabel}</span>}
          {onRun && (
            <button onClick={(e) => { e.stopPropagation(); if (canRun && !running) onRun(); }} disabled={!canRun || running}
              title={running ? "生成中…" : hasResult ? "重新生成" : "生成"}
              style={{ width: 34, height: 34, borderRadius: "50%", border: "none", flexShrink: 0,
                background: canRun && !running ? "#fff" : "var(--c-surface)",
                color: canRun && !running ? "#111" : "var(--c-t4)",
                cursor: canRun && !running ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* negative prompt (compact, when supported) */}
      {typeof payload.negativePrompt === "string" && (
        <NodeTextArea value={str("negativePrompt")} onValueChange={(v) => set({ negativePrompt: v })} rows={1} placeholder="反向提示词（可选）"
          style={{ width: "100%", fontSize: 12.5, padding: "8px 11px", borderRadius: 10, background: "var(--c-input)",
            border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", resize: "vertical", minHeight: 38 }} />
      )}
    </div>
  );
}

// Compact reference-image control for the studio command bar: existing refs as
// small thumbnails (click × to remove) + an upload chip. Reuses the SHARED
// useReferenceImages hook (single source of truth — same list the pro node edits)
// and the same trpc.upload.uploadImage mutation, so there is zero data-model
// divergence and no gating change.
function StudioRefImages({ nodeId, payload }: { nodeId: string; payload: Record<string, unknown> }) {
  const refImages = useReferenceImages(nodeId, payload as Parameters<typeof useReferenceImages>[1]);
  const uploadMutation = trpc.upload.uploadImage.useMutation();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { toast.error("请选择图片文件"); return; }
    setUploading(true);
    try {
      for (const file of imgs) {
        if (file.size > 16 * 1024 * 1024) { toast.error(`${file.name} 超过 16MB`); continue; }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        const result = await uploadMutation.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) return;
        refImages.addUrls([result.url], "upload");
      }
      toast.success("参考图上传成功");
    } catch (err) {
      toast.error("参考图上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally { setUploading(false); }
  };

  return (
    <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {refImages.images.slice(0, 4).map((img) => (
        <div key={img.id} style={{ position: "relative", width: 32, height: 32, borderRadius: 7, overflow: "hidden", border: "1px solid var(--c-bd2)", flexShrink: 0 }}>
          <img src={img.url} alt="参考图" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button onClick={(e) => { e.stopPropagation(); refImages.removeId(img.id); }} title="移除参考图"
            style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, border: "none", borderRadius: "0 0 0 5px",
              background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={9} />
          </button>
        </div>
      ))}
      {refImages.images.length > 4 && (
        <span style={{ fontSize: 11, color: "var(--c-t3)", fontWeight: 700, flexShrink: 0 }}>+{refImages.images.length - 4}</span>
      )}
      <button onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }} disabled={uploading} title="添加参考图（可多张）"
        style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "none" }}>
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={14} />}
        <span style={{ fontSize: 11.5 }}>参考图</span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void onFiles(fs); }} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Config-driven command bar for the NON-generative nodes. Each node declares a
// `Form`; every control writes a top-level payload field via updateNodeData (all
// payload-safe per the node audit — the node reads the same field fresh). Tabs
// generalise the audio (配乐/配音/音效) and character (人物/场景) sub-modes.
// ───────────────────────────────────────────────────────────────────────────
type Opt = string | { value: string; label: string };
type Ctrl =
  | { key: string; type: "select"; label: string; options: Opt[]; numeric?: boolean; default?: string | number }
  | { key: string; type: "number"; label: string; min?: number; max?: number; step?: number; default?: number; width?: number }
  | { key: string; type: "toggle"; label: string; default?: boolean }
  | { key: string; type: "text"; label: string; placeholder?: string; width?: number };
interface TextSpec { field: string; placeholder: string; enhance?: boolean }
interface Tab { value: string; label: string; text?: TextSpec; controls?: Ctrl[] }
interface Form {
  text?: TextSpec;
  neg?: { field: string; placeholder: string };
  llm?: string;          // payload field for an LLMModelPicker
  controls?: Ctrl[];
  refImages?: boolean;
  noRun?: boolean;       // nodes with no run handler (note)
  tabsField?: string;    // sub-mode tabs (audio category / character kind)
  tabs?: Tab[];
}

const optList = (opts: Opt[]) => opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o));

function renderCtrl(c: Ctrl, payload: Record<string, unknown>, set: (p: Record<string, unknown>) => void) {
  if (c.type === "select") {
    const opts = optList(c.options);
    const cur = (payload[c.key] as string | number | undefined) ?? c.default ?? opts[0]?.value ?? "";
    return (
      <select key={c.key} className="nodrag" title={c.label} value={String(cur)}
        onChange={(e) => { const v = e.target.value; set({ [c.key]: c.numeric ? Number(v) : v }); }} style={chip}>
        {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  }
  if (c.type === "number") {
    const cur = (payload[c.key] as number | undefined) ?? c.default ?? c.min ?? 0;
    return (
      <input key={c.key} type="number" className="nodrag" title={c.label} value={cur} min={c.min} max={c.max} step={c.step ?? 1}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ [c.key]: n }); }}
        style={{ ...chip, width: c.width ?? 76, maxWidth: c.width ?? 76 }} />
    );
  }
  if (c.type === "text") {
    const cur = (payload[c.key] as string | undefined) ?? "";
    return (
      <input key={c.key} type="text" className="nodrag" title={c.label} value={cur} placeholder={c.placeholder ?? c.label}
        onChange={(e) => set({ [c.key]: e.target.value })} style={{ ...chip, width: c.width ?? 130, maxWidth: c.width ?? 130, fontWeight: 500 }} />
    );
  }
  const cur = (payload[c.key] as boolean | undefined) ?? c.default ?? false;
  return (
    <label key={c.key} className="nodrag" title={c.label} style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={cur} onChange={(e) => set({ [c.key]: e.target.checked })} />
      <span style={{ fontSize: 11.5, color: "var(--c-t2)" }}>{c.label}</span>
    </label>
  );
}

// Prompt textarea with optional inline AI 扩写/翻译 tools (reused by all bars).
function PromptBox({ nodeId, field, placeholder, enhance }: { nodeId: string; field: string; placeholder: string; enhance?: boolean }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const enhanceMutation = trpc.aiEnhance.enhance.useMutation();
  const [enhancing, setEnhancing] = useState<null | "expand" | "translate_en">(null);
  const pl = node?.data.payload as Record<string, unknown> | undefined;
  const value = typeof pl?.[field] === "string" ? (pl[field] as string) : "";
  const doEnhance = async (mode: "expand" | "translate_en") => {
    if (enhancing) return;
    if (!value.trim()) { toast.error("内容为空"); return; }
    setEnhancing(mode);
    try {
      const r = await enhanceMutation.mutateAsync({ text: value, mode });
      const out = r.result?.trim();
      if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) return;
      if (out) { updateNodeData(nodeId, { [field]: out }); toast.success(mode === "expand" ? "已扩写" : "已翻译为英文"); }
    } catch (e) { toast.error("处理失败：" + (e instanceof Error ? e.message : "")); }
    finally { setEnhancing(null); }
  };
  return (
    <div style={{ position: "relative" }}>
      <NodeTextArea value={value} onValueChange={(v) => updateNodeData(nodeId, { [field]: v })} rows={3} placeholder={placeholder}
        style={{ width: "100%", fontSize: 13.5, padding: `10px ${enhance ? 78 : 12}px 10px 12px`, borderRadius: 11, background: "var(--c-input)",
          border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", lineHeight: 1.55, resize: "vertical", minHeight: 58 }} />
      {enhance && (
        <div className="nodrag" style={{ position: "absolute", top: 7, right: 8, display: "flex", gap: 5 }}>
          <button onClick={(e) => { e.stopPropagation(); void doEnhance("expand"); }} disabled={!!enhancing} title="AI 扩写" style={enhanceBtn}>
            {enhancing === "expand" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}</button>
          <button onClick={(e) => { e.stopPropagation(); void doEnhance("translate_en"); }} disabled={!!enhancing} title="翻译为英文" style={enhanceBtn}>
            {enhancing === "translate_en" ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}</button>
        </div>
      )}
    </div>
  );
}

function SendButton({ onRun, canRun = true, running = false, hasResult = false }: { onRun?: () => void; canRun?: boolean; running?: boolean; hasResult?: boolean }) {
  if (!onRun) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); if (canRun && !running) onRun(); }} disabled={!canRun || running}
      title={running ? "运行中…" : hasResult ? "重新运行" : "运行"}
      style={{ width: 34, height: 34, borderRadius: "50%", border: "none", flexShrink: 0,
        background: canRun && !running ? "#fff" : "var(--c-surface)", color: canRun && !running ? "#111" : "var(--c-t4)",
        cursor: canRun && !running ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {running ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
    </button>
  );
}

function SimpleBar({ nodeId, onRun, canRun = true, running = false, hasResult = false, form }: Props & { form: Form }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  if (!node) return null;
  const payload = node.data.payload as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => updateNodeData(nodeId, patch);

  // resolve active tab (if any) and merge its text/controls onto the base form
  const tabs = form.tabs ?? [];
  const activeTabVal = form.tabsField ? ((payload[form.tabsField] as string) ?? tabs[0]?.value) : undefined;
  const activeTab = tabs.find((t) => t.value === activeTabVal) ?? tabs[0];
  const text = activeTab?.text ?? form.text;
  const controls = [...(form.controls ?? []), ...(activeTab?.controls ?? [])];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {form.tabsField && tabs.length > 0 && (
        <div className="nodrag" style={{ display: "flex", gap: 6 }}>
          {tabs.map((t) => {
            const on = t.value === activeTabVal;
            return (
              <button key={t.value} onClick={(e) => { e.stopPropagation(); set({ [form.tabsField!]: t.value }); }}
                style={{ ...chip, maxWidth: "none", background: on ? "var(--ui-accent, var(--c-elevated))" : "var(--c-input)",
                  color: on ? "#fff" : "var(--c-t2)", borderColor: on ? "transparent" : "var(--c-bd2)" }}>{t.label}</button>
            );
          })}
        </div>
      )}

      {text && <PromptBox nodeId={nodeId} field={text.field} placeholder={text.placeholder} enhance={text.enhance} />}

      {(controls.length > 0 || form.llm || form.refImages || !form.noRun) && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {form.llm && (
            <LLMModelPicker
              value={(LLM_MODELS.some((m) => m.id === payload[form.llm!]) ? payload[form.llm!] : LLM_MODELS[0]?.id) as LLMModelId}
              onChange={(v) => set({ [form.llm!]: v })} />
          )}
          {controls.map((c) => renderCtrl(c, payload, set))}
          {form.refImages && <StudioRefImages nodeId={nodeId} payload={payload} />}
          {!form.noRun && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
              <SendButton onRun={onRun} canRun={canRun} running={running} hasResult={hasResult} />
            </div>
          )}
        </div>
      )}

      {form.neg && typeof payload[form.neg.field] === "string" && (
        <NodeTextArea value={(payload[form.neg.field] as string) ?? ""} onValueChange={(v) => set({ [form.neg!.field]: v })} rows={1} placeholder={form.neg.placeholder}
          style={{ width: "100%", fontSize: 12.5, padding: "8px 11px", borderRadius: 10, background: "var(--c-input)",
            border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", resize: "vertical", minHeight: 38 }} />
      )}
    </div>
  );
}

const COLORS: Opt[] = [{ value: "white", label: "白" }, { value: "yellow", label: "黄" }, { value: "red", label: "红" }, { value: "green", label: "绿" }, { value: "orange", label: "橙" }];
const FONT_CTRLS: Ctrl[] = [
  { key: "fontSize", type: "number", label: "字号", min: 12, max: 40, step: 1, default: 22 },
  { key: "fontColor", type: "select", label: "颜色", options: COLORS },
  { key: "language", type: "text", label: "语言", placeholder: "自动", width: 86 },
];

const SIMPLE_FORMS: Partial<Record<NodeType, Form>> = {
  prompt: {
    text: { field: "positivePrompt", placeholder: "提示词…", enhance: true },
    neg: { field: "negativePrompt", placeholder: "反向提示词（可选）" },
    llm: "llmModel",
    controls: [
      { key: "style", type: "text", label: "风格", placeholder: "风格", width: 110 },
      { key: "aspectRatio", type: "select", label: "比例", options: RATIOS },
    ],
  },
  note: { text: { field: "content", placeholder: "在此记录想法…（支持 Markdown）" }, noRun: true },
  pose_control: {
    text: { field: "prompt", placeholder: "描述新画面内容（保持参考构图）…" },
    controls: [{ key: "guidanceScale", type: "number", label: "引导强度", min: 1, max: 10, step: 0.5, default: 3.5, width: 84 }],
    refImages: true,
  },
  audio: {
    tabsField: "audioCategory",
    tabs: [
      { value: "music", label: "配乐", text: { field: "musicPrompt", placeholder: "描述配乐风格 / 情绪…", enhance: true }, controls: [{ key: "musicInstrumental", type: "toggle", label: "纯音乐" }] },
      { value: "tts", label: "配音", text: { field: "ttsText", placeholder: "输入要配音的文字…" }, controls: [{ key: "ttsSpeed", type: "number", label: "语速", min: 0.5, max: 2, step: 0.1, default: 1, width: 84 }] },
      { value: "sfx", label: "音效", text: { field: "sfxPrompt", placeholder: "描述音效…", enhance: true }, controls: [{ key: "sfxDuration", type: "number", label: "时长", min: 1, max: 30, step: 1, default: 5 }] },
    ],
  },
  character: {
    tabsField: "characterKind",
    tabs: [
      { value: "person", label: "人物", text: { field: "appearance", placeholder: "外貌：身高、发色、服饰…" },
        controls: [{ key: "name", type: "text", label: "姓名", placeholder: "角色姓名", width: 120 }, { key: "gender", type: "select", label: "性别", options: [{ value: "", label: "不限" }, { value: "男", label: "男" }, { value: "女", label: "女" }, { value: "中性", label: "中性" }] }] },
      { value: "scene", label: "场景", text: { field: "sceneDescription", placeholder: "场景描述…" },
        controls: [{ key: "sceneName", type: "text", label: "场景名", placeholder: "场景名称", width: 120 }] },
    ],
    refImages: true,
  },
  merge: {
    controls: [
      { key: "transition", type: "select", label: "转场", options: [{ value: "none", label: "直切" }, { value: "fade", label: "淡入淡出" }, { value: "dissolve", label: "叠化" }] },
      { key: "transitionDuration", type: "number", label: "转场时长", min: 0.1, max: 2, step: 0.1, default: 0.5, width: 84 },
      { key: "bgMusicVolume", type: "number", label: "配乐音量", min: 0, max: 1, step: 0.1, default: 0.3, width: 84 },
    ],
  },
  subtitle: { controls: FONT_CTRLS },
  subtitle_motion: {
    controls: [
      { key: "motionStyle", type: "select", label: "动效", options: [{ value: "fade", label: "淡入" }, { value: "roll", label: "滚动" }, { value: "karaoke", label: "卡拉OK" }, { value: "bounce", label: "弹跳" }] },
      ...FONT_CTRLS,
    ],
  },
  overlay: {
    controls: [
      { key: "mode", type: "select", label: "模式", options: [{ value: "watermark", label: "水印" }, { value: "pip", label: "画中画" }, { value: "color_correction", label: "色彩校正" }] },
      { key: "overlayPosition", type: "select", label: "位置", options: [{ value: "top-left", label: "左上" }, { value: "top-right", label: "右上" }, { value: "bottom-left", label: "左下" }, { value: "bottom-right", label: "右下" }, { value: "center", label: "居中" }] },
      { key: "overlayScale", type: "number", label: "缩放", min: 0.05, max: 1, step: 0.05, default: 0.2, width: 80 },
    ],
  },
  smart_cut: {
    controls: [{ key: "aggressiveness", type: "select", label: "力度", options: [{ value: "low", label: "保守" }, { value: "medium", label: "适中" }, { value: "high", label: "激进" }] }],
  },
  clip: {
    controls: [
      { key: "speed", type: "select", label: "速度", numeric: true, options: [{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }] },
      { key: "aspect", type: "select", label: "比例", options: [{ value: "original", label: "原始" }, { value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }] },
      { key: "colorPreset", type: "select", label: "调色", options: [{ value: "none", label: "无" }, { value: "cinematic", label: "电影" }, { value: "warm", label: "暖色" }, { value: "cool", label: "冷色" }, { value: "bw", label: "黑白" }, { value: "vintage", label: "复古" }, { value: "vivid", label: "鲜艳" }] },
    ],
  },
  comfyui_image: {
    text: { field: "prompt", placeholder: "描述你想生成的图像…" },
    neg: { field: "negPrompt", placeholder: "反向提示词（可选）" },
    controls: [
      { key: "workflowTemplate", type: "select", label: "工作流", options: [{ value: "txt2img", label: "文生图" }, { value: "img2img", label: "图生图" }, { value: "inpaint", label: "局部重绘" }] },
      { key: "arch", type: "select", label: "架构", options: ["sd", "flux", "sd3", "qwen"] },
      { key: "steps", type: "number", label: "步数", min: 1, max: 100, step: 1, default: 20 },
      { key: "cfg", type: "number", label: "CFG", min: 1, max: 30, step: 0.5, default: 7 },
      { key: "seed", type: "number", label: "种子", default: -1, width: 96 },
    ],
    refImages: true,
  },
  comfyui_video: {
    text: { field: "prompt", placeholder: "描述视频内容…" },
    neg: { field: "negPrompt", placeholder: "反向提示词（可选）" },
    controls: [
      { key: "workflowTemplate", type: "select", label: "工作流", options: [{ value: "animatediff", label: "AnimateDiff" }, { value: "svd", label: "SVD" }, { value: "wan_t2v", label: "Wan 文生视频" }, { value: "wan_i2v", label: "Wan 图生视频" }, { value: "ltxv", label: "LTX-Video" }] },
      { key: "frames", type: "number", label: "帧数", min: 1, max: 240, step: 1, default: 16 },
      { key: "fps", type: "number", label: "帧率", min: 1, max: 60, step: 1, default: 8 },
      { key: "steps", type: "number", label: "步数", min: 1, max: 100, step: 1, default: 20 },
      { key: "seed", type: "number", label: "种子", default: -1, width: 96 },
    ],
    refImages: true,
  },
  comfyui_workflow: {
    controls: [
      { key: "aspectRatio", type: "select", label: "比例", options: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "4:5"] },
      { key: "randomizeSeed", type: "toggle", label: "随机种子", default: true },
      { key: "useCloudComfy", type: "toggle", label: "云端运行" },
    ],
  },
};

// Exported union consumed by BaseNode to decide which nodes get a command bar.
export const STUDIO_COMMAND_BAR_TYPES = new Set<NodeType>([
  ...Array.from(GENERATIVE_TYPES),
  ...(Object.keys(SIMPLE_FORMS) as NodeType[]),
]);
