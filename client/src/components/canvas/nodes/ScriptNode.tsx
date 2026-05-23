import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, ChevronDown, Clapperboard, Minus, Plus } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "script";
    title: string;
    payload: ScriptNodeData;
    projectId: number;
  };
}

// ── Static data ───────────────────────────────────────────────────────────────

const GENRES  = ["短视频", "电影", "动作片", "广告片", "短剧", "纪录片", "MV", "宣传片", "微电影", "动画"];
const STYLES  = ["电影感", "写实", "动漫", "复古胶片", "赛博朋克", "史诗", "极简", "梦幻"];
const MOODS   = ["温暖治愈", "紧张刺激", "浪漫唯美", "神秘悬疑", "壮阔震撼", "轻松幽默"];
const RATIOS  = ["16:9", "9:16", "1:1", "4:3", "2.35:1"];
const TARGET_MODELS = [
  { value: "",         label: "通用",     desc: "不针对特定模型" },
  { value: "kling",    label: "Kling",    desc: "快手·运镜精准" },
  { value: "veo",      label: "Veo 3",    desc: "Google·自然语言" },
  { value: "runway",   label: "Runway",   desc: "风格简洁" },
  { value: "wan",      label: "WAN 2.5",  desc: "阿里·结构化" },
  { value: "seedance", label: "Seedance", desc: "字节·写实" },
  { value: "dop",      label: "DoP",      desc: "Higgsfield·电影级" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ChipRow({ label, options, value, onChange, color }: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
        {label}
      </span>
      <div className="flex gap-1 overflow-x-auto nodrag" style={{ scrollbarWidth: "none" }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="nodrag flex-shrink-0 px-2 py-0.5 rounded-full transition-all"
            style={{
              fontSize: 9,
              fontWeight: value === opt ? 700 : 400,
              background: value === opt ? `${color}18` : "var(--c-base)",
              border: `1px solid ${value === opt ? `${color}55` : "var(--c-bd2)"}`,
              color: value === opt ? color : "var(--c-t4)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_FOCUS   = "oklch(0.62 0.18 240 / 0.6)";
const ACCENT         = "oklch(0.62 0.18 240)";
const PANEL_ACCENT   = "oklch(0.72 0.20 55)";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--c-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "none",
  lineHeight: 1.75,
  flex: 1,
  minHeight: 100,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 12,
};

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

// ── Main component ────────────────────────────────────────────────────────────

export const ScriptNode = memo(function ScriptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;

  // LLM model (shared by all AI operations)
  const [llmModel, setLlmModel] = useState<LLMModelId>("claude-sonnet-4-6");

  // AI 剧本创作 panel state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [genre,       setGenre]       = useState(GENRES[0]);
  const [style,       setStyle]       = useState(STYLES[0]);
  const [mood,        setMood]        = useState(MOODS[0]);
  const [targetModel, setTargetModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [sceneCount,  setSceneCount]  = useState(5);
  const [duration,    setDuration]    = useState(60);
  const [durationText, setDurationText] = useState("60");

  const handleChange = useCallback(
    (field: keyof ScriptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  // ── Existing mutations ────────────────────────────────────────────────────

  const generateMutation = trpc.scripts.generateStoryboards.useMutation({
    onSuccess: (result) => {
      const { nodes: currentNodes, batchAddSceneNodes, projectId } = useCanvasStore.getState();
      if (!projectId) { toast.error("画布尚未加载，请稍后重试"); return; }
      const ownPos = currentNodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
      batchAddSceneNodes(result.scenes, id, ownPos);
      toast.success("分镜已生成", {
        description: `共 ${result.scenes.length} 个场景节点已添加到画布`,
        duration: 4000,
      });
    },
    onError: (err) => { toast.error("AI 生成分镜失败：" + err.message); },
  });

  const polishMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { content: result.result });
      toast.success("脚本已润色");
    },
    onError: (err) => { toast.error("AI 润色失败：" + err.message); },
  });

  // ── New: full script generation ───────────────────────────────────────────

  const fullScriptMutation = trpc.scripts.generateFullScript.useMutation({
    onSuccess: (result) => {
      // Fill script text area
      if (result.scriptText) {
        updateNodeData(id, { content: result.scriptText });
      }
      // Auto-create storyboard nodes
      let nodesCreated = 0;
      if (result.scenes.length > 0) {
        const { nodes: currentNodes, batchAddSceneNodes, projectId } = useCanvasStore.getState();
        if (!projectId) {
          toast.error("画布尚未加载，分镜节点创建失败");
          return;
        }
        const ownPos = currentNodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
        batchAddSceneNodes(result.scenes, id, ownPos);
        nodesCreated = result.scenes.length;
      }
      toast.success("AI 剧本已生成", {
        description: nodesCreated > 0 ? `剧本已填入，${nodesCreated} 个分镜节点已创建` : "剧本已填入",
        duration: 5000,
      });
    },
    onError: (err) => { toast.error("AI 剧本生成失败：" + err.message); },
  });

  const anyPending = generateMutation.isPending || polishMutation.isPending || fullScriptMutation.isPending;

  const handleFullGenerate = () => {
    const synopsis = payload.synopsis?.trim() || payload.content?.trim();
    if (!synopsis) { toast.error("请先填写故事梗概或脚本内容"); return; }
    fullScriptMutation.mutate({
      synopsis,
      genre,
      style,
      mood,
      sceneCount,
      totalDuration: duration,
      targetVideoModel: targetModel || undefined,
      aspectRatio,
      model: llmModel,
    });
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="script" title={data.title} minHeight={200} resizable>
      <div className="flex flex-col h-full p-3.5 gap-3">

        {/* Synopsis */}
        <input
          placeholder="故事梗概（一句话概括，也是 AI 剧本创作的核心素材）"
          value={payload.synopsis ?? ""}
          onChange={(e) => handleChange("synopsis", e.target.value)}
          className="nodrag"
          style={inputStyle}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* Script content */}
        <textarea
          placeholder={"在此输入或粘贴脚本内容...\n\n也可直接使用下方「AI 剧本创作」一键生成。"}
          value={payload.content}
          onChange={(e) => handleChange("content", e.target.value)}
          className="nodrag flex-1"
          style={textareaStyle}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* Quick AI buttons row */}
        <div className="flex items-center gap-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={anyPending} />
          <button
            onClick={() => {
              if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
              polishMutation.mutate({ text: payload.content ?? "", mode: "polish", model: llmModel });
            }}
            disabled={anyPending}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: polishMutation.isPending ? "var(--c-surface)" : `${ACCENT}18`,
              border: `1px solid ${polishMutation.isPending ? BORDER_DEFAULT : `${ACCENT}40`}`,
              color: anyPending ? "var(--c-t4)" : `${ACCENT}`,
              cursor: anyPending ? "not-allowed" : "pointer",
            }}
          >
            {polishMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI 润色
          </button>
          <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: "auto" }}>
            {(payload.content ?? "").length} 字
          </span>
        </div>

        {/* Generate storyboards from existing script */}
        <button
          onClick={() => {
            if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
            generateMutation.mutate({ content: payload.content ?? "", synopsis: payload.synopsis, model: llmModel, count: Math.min(sceneCount, 8) });
          }}
          disabled={anyPending}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: generateMutation.isPending ? "var(--c-surface)" : `${ACCENT}12`,
            border: `1px solid ${generateMutation.isPending ? BORDER_DEFAULT : `${ACCENT}40`}`,
            color: anyPending ? "var(--c-t4)" : ACCENT,
            cursor: anyPending ? "not-allowed" : "pointer",
          }}
        >
          {generateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {generateMutation.isPending ? "AI 生成分镜中..." : "AI 生成分镜（从现有脚本）"}
        </button>

        {/* ── AI 剧本创作 panel ── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: `1px solid ${showAiPanel ? `${PANEL_ACCENT}40` : "var(--c-bd2)"}`, transition: "border-color 200ms ease" }}
        >
          {/* Panel header */}
          <button
            onClick={() => setShowAiPanel((v) => !v)}
            className="nodrag flex items-center gap-2 w-full px-3 py-2 transition-all"
            style={{
              background: showAiPanel ? `${PANEL_ACCENT}10` : "var(--c-base)",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Clapperboard style={{ width: 12, height: 12, color: PANEL_ACCENT, flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, color: showAiPanel ? PANEL_ACCENT : "var(--c-t3)", flex: 1, letterSpacing: "0.02em" }}>
              AI 剧本创作
            </span>
            <span style={{ fontSize: 9, color: "var(--c-t4)" }}>
              {showAiPanel ? "" : "一键生成多模态分镜剧本"}
            </span>
            <ChevronDown
              style={{
                width: 10, height: 10,
                color: "var(--c-t4)",
                transform: showAiPanel ? "rotate(180deg)" : "none",
                transition: "transform 200ms ease",
                flexShrink: 0,
              }}
            />
          </button>

          {/* Panel body */}
          {showAiPanel && (
            <div className="flex flex-col gap-3 px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${PANEL_ACCENT}20` }}>

              <ChipRow label="视频类型" options={GENRES} value={genre} onChange={setGenre} color={PANEL_ACCENT} />
              <ChipRow label="画面风格" options={STYLES} value={style} onChange={setStyle} color="oklch(0.68 0.18 280)" />
              <ChipRow label="情感基调" options={MOODS}  value={mood}  onChange={setMood}  color="oklch(0.68 0.18 340)" />

              {/* Target model + Aspect ratio */}
              <div className="flex gap-2 items-start">
                <div className="flex flex-col gap-1 flex-1">
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                    目标视频模型
                  </span>
                  <select
                    value={targetModel}
                    onChange={(e) => setTargetModel(e.target.value)}
                    className="nodrag"
                    style={{
                      fontSize: 10,
                      background: "var(--c-base)",
                      border: "1px solid var(--c-bd2)",
                      borderRadius: 7,
                      color: "var(--c-t2)",
                      padding: "4px 6px",
                      outline: "none",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    {TARGET_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Aspect ratio chips */}
              <div className="flex flex-col gap-1">
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                  画面比例
                </span>
                <div className="flex gap-1 flex-wrap">
                  {RATIOS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className="nodrag px-2 py-0.5 rounded-md transition-all"
                      style={{
                        fontSize: 9,
                        fontWeight: aspectRatio === r ? 700 : 400,
                        background: aspectRatio === r ? `${PANEL_ACCENT}18` : "var(--c-base)",
                        border: `1px solid ${aspectRatio === r ? `${PANEL_ACCENT}55` : "var(--c-bd2)"}`,
                        color: aspectRatio === r ? PANEL_ACCENT : "var(--c-t4)",
                        cursor: "pointer",
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scene count + Duration */}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                    场景数量
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setSceneCount((n) => Math.max(2, n - 1))} className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all" style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                      <Minus style={{ width: 10, height: 10 }} />
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: PANEL_ACCENT, minWidth: 20, textAlign: "center" }}>{sceneCount}</span>
                    <button onClick={() => setSceneCount((n) => Math.min(12, n + 1))} className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all" style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
                      <Plus style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                    总时长（秒）
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        const step = duration < 30 ? 5 : duration < 120 ? 15 : duration < 300 ? 30 : 60;
                        const v = Math.max(10, duration - step);
                        setDuration(v); setDurationText(String(v));
                      }}
                      className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                    >
                      <Minus style={{ width: 10, height: 10 }} />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={durationText}
                      onChange={(e) => setDurationText(e.target.value)}
                      onBlur={() => {
                        const v = parseInt(durationText, 10);
                        const clamped = isNaN(v) ? duration : Math.max(10, Math.min(600, v));
                        setDuration(clamped); setDurationText(String(clamped));
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      className="nodrag"
                      style={{
                        fontSize: 13, fontWeight: 700, color: PANEL_ACCENT,
                        width: 40, textAlign: "center",
                        background: "var(--c-surface)",
                        border: "1px solid var(--c-bd2)",
                        borderRadius: 6, outline: "none",
                        padding: "1px 4px",
                      }}
                    />
                    <button
                      onClick={() => {
                        const step = duration < 30 ? 5 : duration < 120 ? 15 : duration < 300 ? 30 : 60;
                        const v = Math.min(600, duration + step);
                        setDuration(v); setDurationText(String(v));
                      }}
                      className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                    >
                      <Plus style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Model picker + Generate button */}
              <div className="flex items-center gap-1.5 mt-0.5">
                <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={anyPending} />
                <button
                  onClick={handleFullGenerate}
                  disabled={anyPending}
                  className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all"
                  style={{
                    background: fullScriptMutation.isPending
                      ? "var(--c-surface)"
                      : `linear-gradient(135deg, ${PANEL_ACCENT}22, oklch(0.68 0.18 280 / 0.15))`,
                    border: `1px solid ${fullScriptMutation.isPending ? BORDER_DEFAULT : `${PANEL_ACCENT}50`}`,
                    color: anyPending ? "var(--c-t4)" : PANEL_ACCENT,
                    cursor: anyPending ? "not-allowed" : "pointer",
                  }}
                >
                  {fullScriptMutation.isPending
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> AI 创作中，请稍候...</>
                    : <><Clapperboard className="w-3 h-3" /> 一键生成剧本 + 分镜</>
                  }
                </button>
              </div>

              <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5 }}>
                将根据上方梗概及参数，生成完整中文剧本并自动创建 {sceneCount} 个针对{" "}
                {TARGET_MODELS.find((m) => m.value === targetModel)?.label ?? "通用"}{" "}
                优化的分镜节点
              </p>
            </div>
          )}
        </div>
      </div>
    </BaseNode>
  );
});
