import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { NodeTextArea } from "../NodeTextInput";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { PROVIDER_PICKER_OPTIONS, videoProviderChangePatch } from "../nodes/VideoTaskNode";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import type { VideoProvider } from "../../../../../shared/types";

// The "simple" curated set of a node's most-used controls, rendered in the studio
// floating panel below the node. Writes through the SAME store actions / handlers the
// node body uses (updateNodeData + the nodes' own exported change handlers), so it is
// always in sync and never duplicates logic. Everything else stays reachable under the
// panel's "完整设置" expander (the full node body). Simple by default, fully functional.
const TEXT_FIELD_PRIORITY = [
  "prompt", "content", "description", "positivePrompt", "promptText",
  "ttsText", "musicPrompt", "lyrics", "dialogue", "sceneDescription",
  "appearance", "text",
] as const;
const TEXT_FIELD_LABEL: Record<string, string> = {
  prompt: "提示词", content: "内容", description: "描述", positivePrompt: "正向提示词",
  promptText: "提示词", ttsText: "配音文本", musicPrompt: "音乐描述", lyrics: "歌词",
  dialogue: "对白", sceneDescription: "场景描述", appearance: "外观", text: "文本",
};
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export function StudioCuratedFields({ nodeId }: { nodeId: string }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  if (!node) return null;

  const nodeType = node.data.nodeType;
  const payload = node.data.payload as Record<string, unknown>;
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const textField = TEXT_FIELD_PRIORITY.find((k) => typeof payload[k] === "string");
  const imageModelField = nodeType === "image_gen" ? "model" : nodeType === "storyboard" ? "imageModel" : null;
  const hasAspect = typeof payload.aspectRatio === "string";
  const accent = "var(--ui-accent, var(--c-t2))";

  const box: React.CSSProperties = {
    width: "100%", fontSize: 13, padding: "9px 11px", borderRadius: 10,
    background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)",
    outline: "none", lineHeight: 1.55, resize: "vertical", minHeight: 64,
  };

  const hasModel = nodeType === "script" || !!imageModelField || nodeType === "video_task";
  // No curated control for this node type → render nothing (panel falls back to 完整设置).
  if (!textField && !hasModel && !hasAspect) return null;

  const modelControl = nodeType === "script" ? (
    <LLMModelPicker value={(LLM_MODELS.some((m) => m.id === payload.aiLlmModel) ? payload.aiLlmModel : resolve("script", "llm")) as LLMModelId} onChange={(v) => updateNodeData(nodeId, { aiLlmModel: v })} />
  ) : imageModelField ? (
    <ModelPicker value={str(imageModelField) || resolve(nodeType, "image")} onChange={(v) => updateNodeData(nodeId, { [imageModelField]: v })} options={IMAGE_MODEL_PICKER_OPTIONS} minWidth={150} />
  ) : nodeType === "video_task" ? (
    <ModelPicker value={str("provider")} onChange={(v) => updateNodeData(nodeId, videoProviderChangePatch(v as VideoProvider))} options={PROVIDER_PICKER_OPTIONS} minWidth={150} />
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* prompt — full width, compact */}
      {textField && (
        <NodeTextArea value={String(payload[textField] ?? "")} onValueChange={(v) => updateNodeData(nodeId, { [textField]: v })} rows={2}
          placeholder={TEXT_FIELD_LABEL[textField] ?? textField} style={box} />
      )}

      {/* command bar — one horizontal row: model + aspect (wide & short, not stacked) */}
      {(modelControl || hasAspect) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {modelControl}
          {hasAspect && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {RATIOS.map((r) => {
                const active = payload.aspectRatio === r;
                return (
                  <button key={r} onClick={() => updateNodeData(nodeId, { aspectRatio: r })}
                    style={{ fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                      background: active ? "var(--c-elevated)" : "var(--c-input)",
                      border: `1px solid ${active ? accent : "var(--c-bd2)"}`,
                      color: active ? "var(--c-t1)" : "var(--c-t2)" }}>{r}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
