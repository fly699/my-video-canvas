import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, RotateCcw, X } from "lucide-react";
import type { NodeType } from "../../../../shared/types";
import {
  FACTORY_DEFAULT_MODELS,
  slotKey,
  type ModelSlot,
} from "../../../../shared/nodeDefaultModels";
import { useNodeDefaultModels } from "../../contexts/NodeDefaultModelsContext";
import { TRANSCRIBE_MODELS } from "../../lib/models";
import { useDisabledModels } from "../../lib/useDisabledModels";
import { LLMModelPicker, type LLMModelId } from "./LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "./ModelPicker";
import { PROVIDER_PICKER_OPTIONS } from "./nodes/VideoTaskNode";

// 拥有「文本模型」槽位的节点类型（含 ComfyUI 的提示词翻译 LLM）。
const LLM_NODES: { type: NodeType; label: string }[] = [
  { type: "script", label: "脚本" },
  { type: "ai_chat", label: "AI 对话" },
  { type: "storyboard", label: "分镜（文本）" },
  { type: "prompt", label: "提示词" },
  { type: "agent", label: "智能体" },
  { type: "comfyui_image", label: "ComfyUI 图像（翻译）" },
  { type: "comfyui_video", label: "ComfyUI 视频（翻译）" },
];

// 拥有「生图」槽位的节点类型。
const IMAGE_NODES: { type: NodeType; label: string }[] = [
  { type: "image_gen", label: "图像生成" },
  { type: "storyboard", label: "分镜（生图）" },
];

// 拥有「视频」槽位的节点类型（非 ComfyUI）。
const VIDEO_NODES: { type: NodeType; label: string }[] = [
  { type: "video_task", label: "视频任务" },
];

/** 工具栏「节点默认模型」设置弹层。类别级默认 + 按节点类型覆盖，持久化到项目。 */
export function NodeDefaultModelsButton({ orient = "h" }: { orient?: "h" | "v" }) {
  const { config, setConfig, readOnly } = useNodeDefaultModels();
  const [open, setOpen] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const catLlm = config?.categories?.llm ?? FACTORY_DEFAULT_MODELS.llm;
  const catImage = config?.categories?.image ?? FACTORY_DEFAULT_MODELS.image;
  const catVideo = config?.categories?.video ?? FACTORY_DEFAULT_MODELS.video;
  const catTranscribe = config?.categories?.transcribe ?? FACTORY_DEFAULT_MODELS.transcribe;
  const disabledModels = useDisabledModels();

  const setCategory = (slot: ModelSlot, modelId: string) =>
    setConfig({ ...config, categories: { ...config?.categories, [slot]: modelId } });

  const setOverride = (t: NodeType, slot: ModelSlot, modelId: string) =>
    setConfig({ ...config, perSlot: { ...config?.perSlot, [slotKey(t, slot)]: modelId } });

  const clearOverride = (t: NodeType, slot: ModelSlot) => {
    const next = { ...(config?.perSlot ?? {}) };
    delete next[slotKey(t, slot)];
    setConfig({ ...config, perSlot: next });
  };

  const overrideCount = Object.keys(config?.perSlot ?? {}).length;
  const customized = !!config?.categories?.llm || !!config?.categories?.image || !!config?.categories?.video || overrideCount > 0;

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--c-t2)", marginBottom: 5 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 7 };
  const rowLabel: React.CSSProperties = { fontSize: 11, color: "var(--c-t3)", width: 130, flexShrink: 0 };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="设置每种节点的默认模型（项目级，持久化）"
        data-active={open || undefined}
        className="topbar-btn"
        style={open ? { background: "var(--c-elevated)", color: "var(--c-t1)" } : undefined}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {customized && (
          <span
            style={{
              position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "50%",
              background: "oklch(0.68 0.20 285)", boxShadow: "0 0 5px oklch(0.68 0.20 285 / 0.7)",
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="animate-scale-in"
          style={{
            position: "absolute",
            bottom: orient === "v" ? "auto" : "calc(100% + 10px)",
            top: orient === "v" ? 0 : "auto",
            right: orient === "v" ? "calc(100% + 10px)" : 0,
            width: 330,
            maxHeight: "60vh",
            overflowY: "auto",
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            borderRadius: 14,
            boxShadow: "0 12px 40px oklch(0 0 0 / 0.45)",
            padding: 14,
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>节点默认模型</div>
            <button onClick={() => setOpen(false)} className="topbar-btn" style={{ width: 24, height: 24 }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {readOnly && (
            <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 10 }}>
              只读模式——仅项目协作者（编辑者+）可修改默认模型。
            </div>
          )}

          {/* ── 类别默认 ── */}
          <div style={{ marginBottom: 12, opacity: readOnly ? 0.6 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
            <div style={labelStyle}>文本模型 · LLM（除 ComfyUI 外所有文本/对话/规划 + ComfyUI 翻译）</div>
            <LLMModelPicker
              value={catLlm as LLMModelId}
              onChange={(v) => setCategory("llm", v)}
            />
          </div>
          <div style={{ marginBottom: 12, opacity: readOnly ? 0.6 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
            <div style={labelStyle}>生图模型</div>
            <ModelPicker
              value={catImage}
              onChange={(v) => setCategory("image", v)}
              options={IMAGE_MODEL_PICKER_OPTIONS}
            />
          </div>
          <div style={{ marginBottom: 12, opacity: readOnly ? 0.6 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
            <div style={labelStyle}>视频模型（非 ComfyUI 视频任务节点）</div>
            <ModelPicker
              value={catVideo}
              onChange={(v) => setCategory("video", v)}
              options={PROVIDER_PICKER_OPTIONS}
              accent="oklch(0.7 0.18 25)"
            />
          </div>
          <div style={{ marginBottom: 12, opacity: readOnly ? 0.6 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
            <div style={labelStyle}>字幕转录模型（语音识别 STT · 字幕 / 动态字幕节点）</div>
            <select
              value={catTranscribe}
              onChange={(e) => setCategory("transcribe", e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "7px 8px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
            >
              {TRANSCRIBE_MODELS.filter((m) => !disabledModels.has(m.value)).map((m) => (
                <option key={m.value} value={m.value}>{m.label} · {m.desc}</option>
              ))}
            </select>
          </div>

          {/* ── 按节点类型覆盖 ── */}
          <button
            onClick={() => setShowOverrides((v) => !v)}
            style={{
              width: "100%", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--c-t2)",
              background: "var(--c-surface)", border: "1px solid var(--c-bd1)", borderRadius: 8,
              padding: "7px 10px", cursor: "pointer", marginBottom: showOverrides ? 10 : 0,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <span>按节点类型单独覆盖{overrideCount > 0 ? `（${overrideCount}）` : ""}</span>
            <span style={{ color: "var(--c-t4)" }}>{showOverrides ? "收起 ›" : "展开 ‹"}</span>
          </button>

          {showOverrides && (
            <div style={{ opacity: readOnly ? 0.6 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
              <div style={{ ...labelStyle, marginTop: 4 }}>文本 / LLM</div>
              {LLM_NODES.map(({ type, label }) => {
                const k = slotKey(type, "llm");
                const overridden = !!config?.perSlot?.[k];
                return (
                  <div style={rowStyle} key={k}>
                    <span style={rowLabel}>{label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <LLMModelPicker
                        value={(config?.perSlot?.[k] ?? catLlm) as LLMModelId}
                        onChange={(v) => setOverride(type, "llm", v)}
                      />
                    </div>
                    <OverrideReset shown={overridden} onClick={() => clearOverride(type, "llm")} />
                  </div>
                );
              })}

              <div style={{ ...labelStyle, marginTop: 8 }}>生图</div>
              {IMAGE_NODES.map(({ type, label }) => {
                const k = slotKey(type, "image");
                const overridden = !!config?.perSlot?.[k];
                return (
                  <div style={rowStyle} key={k}>
                    <span style={rowLabel}>{label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ModelPicker
                        value={config?.perSlot?.[k] ?? catImage}
                        onChange={(v) => setOverride(type, "image", v)}
                        options={IMAGE_MODEL_PICKER_OPTIONS}
                        minWidth={300}
                      />
                    </div>
                    <OverrideReset shown={overridden} onClick={() => clearOverride(type, "image")} />
                  </div>
                );
              })}

              <div style={{ ...labelStyle, marginTop: 8 }}>视频</div>
              {VIDEO_NODES.map(({ type, label }) => {
                const k = slotKey(type, "video");
                const overridden = !!config?.perSlot?.[k];
                return (
                  <div style={rowStyle} key={k}>
                    <span style={rowLabel}>{label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ModelPicker
                        value={config?.perSlot?.[k] ?? catVideo}
                        onChange={(v) => setOverride(type, "video", v)}
                        options={PROVIDER_PICKER_OPTIONS}
                        accent="oklch(0.7 0.18 25)"
                        minWidth={300}
                      />
                    </div>
                    <OverrideReset shown={overridden} onClick={() => clearOverride(type, "video")} />
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 恢复默认 ── */}
          {customized && !readOnly && (
            <button
              onClick={() => setConfig({})}
              style={{
                marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontSize: 11, color: "var(--c-t3)", background: "var(--c-surface)",
                border: "1px solid var(--c-bd1)", borderRadius: 8, padding: "7px 10px", cursor: "pointer",
              }}
            >
              <RotateCcw className="w-3 h-3" />
              恢复出厂默认（Opus 4.7 / GPT Image 2 / Grok 图生）
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverrideReset({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  if (!shown) return <span style={{ width: 18, flexShrink: 0 }} />;
  return (
    <button
      onClick={onClick}
      title="跟随类别默认"
      style={{
        width: 18, height: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--c-t1)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--c-t4)")}
    >
      <RotateCcw className="w-3 h-3" />
    </button>
  );
}
