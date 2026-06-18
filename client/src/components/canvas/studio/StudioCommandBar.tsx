import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { NodeTextArea } from "../NodeTextInput";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { PROVIDER_PICKER_OPTIONS, videoProviderChangePatch } from "../nodes/VideoTaskNode";
import { IMAGE_MODEL_PARAMS, paramOptions } from "../../../lib/paramDefs";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { ArrowUp, Loader2 } from "lucide-react";
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
  if (!node) return null;

  const nodeType = node.data.nodeType;
  const payload = node.data.payload as Record<string, unknown>;
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const set = (patch: Record<string, unknown>) => updateNodeData(nodeId, patch);

  const textField = nodeType === "script" ? "content"
    : nodeType === "storyboard" ? (typeof payload.description === "string" ? "description" : "promptText")
    : "prompt";
  const placeholder = nodeType === "script" ? "脚本主题 / 内容…" : nodeType === "video_task" ? "描述你想生成的视频…" : "描述你想生成的内容…";

  const imageModel = nodeType === "image_gen" ? (str("model") || resolve("image_gen", "image"))
    : nodeType === "storyboard" ? (str("imageModel") || resolve("storyboard", "image")) : "";
  const imageModelField = nodeType === "image_gen" ? "model" : nodeType === "storyboard" ? "imageModel" : "";
  const imageDefs = imageModel ? (IMAGE_MODEL_PARAMS[imageModel] ?? []) : [];
  const showAspect = nodeType === "image_gen" || nodeType === "storyboard";
  const count = Number(payload.imageN ?? payload.batchSize ?? payload.fluxNumImages ?? 1) || 1;
  const cost = (nodeType === "image_gen" || nodeType === "storyboard") && imageModel ? estimateImageCost(imageModel, count) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {/* prompt — full width, no label */}
      <NodeTextArea value={str(textField)} onValueChange={(v) => set({ [textField]: v })} rows={3} placeholder={placeholder}
        style={{ width: "100%", fontSize: 13.5, padding: "10px 12px", borderRadius: 11, background: "var(--c-input)",
          border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", lineHeight: 1.55, resize: "vertical", minHeight: 58 }} />

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
