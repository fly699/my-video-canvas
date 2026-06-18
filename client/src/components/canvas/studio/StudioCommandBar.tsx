import { useState, useRef } from "react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { NodeTextArea } from "../NodeTextInput";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { PROVIDER_PICKER_OPTIONS, videoProviderChangePatch } from "../nodes/VideoTaskNode";
import { IMAGE_MODEL_PARAMS, paramOptions } from "../../../lib/paramDefs";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { ArrowUp, Loader2, ImagePlus, Languages, Sparkles, X } from "lucide-react";
import type { NodeType, VideoProvider } from "../../../../../shared/types";

// Node types presented as a compact studio "command bar" (prompt on top + ONE
// horizontal row of inline compact controls — model, ratio, each main param),
// matching the LibLib layout. Media is OMITTED (the node card shows it). Others
// fall back to the full node body.
export const STUDIO_COMMAND_BAR_TYPES = new Set<NodeType>([
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

export function StudioCommandBar({ nodeId, onRun, canRun = true, running = false, hasResult = false }: Props) {
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
  const count = Number(payload.imageN ?? payload.batchSize ?? payload.fluxNumImages ?? 1) || 1;
  const cost = (nodeType === "image_gen" || nodeType === "storyboard") && imageModel ? estimateImageCost(imageModel, count) : null;

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

        {/* reference images — compact thumbnails + upload, fills the middle of the row */}
        {showAspect && <StudioRefImages nodeId={nodeId} payload={payload} />}

        {/* right group: cost (⚡) + send/generate (↑) — pushed to the far right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
          {cost && <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ui-amber, var(--c-t2))", whiteSpace: "nowrap" }}>⚡ {costEstimateLabel(cost)}</span>}
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
