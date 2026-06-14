import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles, Loader2, ChevronDown, Clapperboard,
  Minus, Plus, Copy, FileText, Check, Wand2, MessageSquare,
  Search, Layers2, GitBranch, Image, BookOpen, X, Languages,
  Route, ClipboardCheck, Film, History, AlertTriangle, Mic,
} from "lucide-react";
import { LLMModelPicker, LLM_MODELS, type LLMModelId } from "../LLMModelPicker";
import { ScriptDevFlowPanel, ScriptCoveragePanel } from "../ScriptSidePanels";
import { ScriptHistoryPanel } from "../ScriptHistoryPanel";
import { ScriptCastPanel } from "../ScriptCastPanel";
import { snapshotContent } from "@/lib/scriptHistory";
import { hashContent, hasDownstreamStoryboardForId, isStoryboardStale } from "@/lib/scriptStoryboardSync";
import { SCRIPT_TEMPLATE_CATEGORIES, getScriptTemplate, type ScriptTemplate } from "@/lib/scriptCreationTemplates";
import { NodeTextArea, NodeInput } from "../NodeTextInput";

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
const TARGET_MODELS: { value: string; label: string; desc: string; group: string }[] = [
  { value: "",          label: "通用",         desc: "不针对特定模型",      group: "通用" },
  // 云端视频
  { value: "kling",     label: "Kling",        desc: "快手·运镜精准",       group: "云端视频" },
  { value: "veo",       label: "Veo 3",        desc: "Google·自然语言",     group: "云端视频" },
  { value: "runway",    label: "Runway",       desc: "风格简洁",            group: "云端视频" },
  { value: "wan",       label: "WAN 2.5",      desc: "阿里·结构化",         group: "云端视频" },
  { value: "seedance",  label: "Seedance",     desc: "字节·写实",           group: "云端视频" },
  { value: "dop",       label: "DoP",          desc: "Higgsfield·电影级",   group: "云端视频" },
  // ComfyUI 图像
  { value: "qwen",      label: "Qwen-Image",   desc: "通义·双语/文字渲染",  group: "ComfyUI 图像" },
  { value: "flux",      label: "Flux.1",       desc: "密集自然语言·强遵循", group: "ComfyUI 图像" },
  { value: "sdxl",      label: "SDXL / Pony",  desc: "标签式+反向词",       group: "ComfyUI 图像" },
  // ComfyUI 视频
  { value: "wan_local", label: "Wan 2.2 本地", desc: "结构化运动",          group: "ComfyUI 视频" },
  { value: "hunyuan",   label: "HunyuanVideo", desc: "腾讯·电影化",         group: "ComfyUI 视频" },
  { value: "ltxv",      label: "LTX-Video",    desc: "快速·聚焦动作",       group: "ComfyUI 视频" },
  { value: "cogvideox", label: "CogVideoX",    desc: "时序运动细节",        group: "ComfyUI 视频" },
];
const TARGET_MODEL_GROUPS = ["通用", "云端视频", "ComfyUI 图像", "ComfyUI 视频"];

const POLISH_MODES = [
  { value: "polish",   label: "润色" },
  { value: "condense", label: "精简" },
] as const;

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
      <div className="flex flex-wrap gap-1 nodrag">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="nodrag px-2 py-0.5 rounded-full transition-all"
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

const BORDER_DEFAULT  = "var(--c-bd2)";
const BORDER_FOCUS    = "oklch(0.62 0.18 240 / 0.6)";
const ACCENT          = "oklch(0.62 0.18 240)";
const PANEL_ACCENT    = "oklch(0.72 0.20 55)";
const ADV_ACCENT      = "oklch(0.65 0.20 295)";
const ADV_ACCENT_A    = (a: number) => `oklch(0.65 0.20 295 / ${a})`;

const SCRIPT_STYLES = ["硬派", "文艺", "商业", "悬疑", "温情", "幽默"] as const;
type ScriptStyle = typeof SCRIPT_STYLES[number];

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
  overflowY: "auto",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 12,
};

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

// ── Main component ────────────────────────────────────────────────────────────

export const ScriptNode = memo(function ScriptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const { resolve } = useNodeDefaultModels();
  const payload = data.payload;

  // LLM model — persisted to payload; validate against known IDs to handle stale/removed model IDs
  const _validLlmModel = LLM_MODELS.some((m) => m.id === payload.aiLlmModel) ? (payload.aiLlmModel as LLMModelId) : (resolve("script", "llm") as LLMModelId);
  const [llmModel, setLlmModel] = useState<LLMModelId>(_validLlmModel);
  const handleLlmModelChange = useCallback((m: LLMModelId) => {
    setLlmModel(m);
    updateNodeData(id, { aiLlmModel: m });
  }, [id, updateNodeData]);

  // AI 剧本创作 panel state — all persisted to payload
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const templatePickerRef = useRef<HTMLDivElement>(null);

  // Advanced panel state
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  // 侧向展开面板（创作向导 / 专业审查）——新功能横向弹出，不再向下堆叠拉长节点。
  const [sidePanel, setSidePanel] = useState<null | "flow" | "coverage" | "history" | "cast">(null);
  const [advTab, setAdvTab] = useState<"variants" | "style" | "dialogue" | "moodboard">("variants");
  const [variantCount, setVariantCount] = useState(3);
  const [variantResults, setVariantResults] = useState<Array<{ label: string; text: string }>>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [selectedStyle, setSelectedStyle] = useState<ScriptStyle>("文艺");
  const [dialogueResult, setDialogueResult] = useState<string>("");
  const [moodBoardResult, setMoodBoardResult] = useState<Array<{ sceneIndex: number; sceneTitle: string; prompt: string; negPrompt?: string }>>([]);
  const [genre,       setGenre]       = useState(payload.aiGenre       ?? GENRES[0]);
  const [style,       setStyle]       = useState(payload.aiStyle       ?? STYLES[0]);
  const [mood,        setMood]        = useState(payload.aiMood        ?? MOODS[0]);
  const [targetModel, setTargetModel] = useState(payload.aiTargetModel ?? "");
  const [aspectRatio, setAspectRatio] = useState(payload.aiAspectRatio ?? "16:9");
  const [sceneCount,  setSceneCount]  = useState(Math.max(2, Math.min(12, payload.aiSceneCount ?? 5)));

  // Polish mode selector
  const [polishMode, setPolishMode] = useState<"polish" | "condense">("polish");

  // Copy-to-clipboard state with unmount-safe timer
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  // Refs for synopsis input focus guard
  const synopsisInputRef = useRef<HTMLInputElement>(null);

  // Helpers to update AI panel param both locally and in payload — all memoized
  const setAndSaveGenre = useCallback((v: string) => {
    setGenre(v); updateNodeData(id, { aiGenre: v });
  }, [id, updateNodeData]);
  const setAndSaveStyle = useCallback((v: string) => {
    setStyle(v); updateNodeData(id, { aiStyle: v });
  }, [id, updateNodeData]);
  const setAndSaveMood = useCallback((v: string) => {
    setMood(v); updateNodeData(id, { aiMood: v });
  }, [id, updateNodeData]);
  const setAndSaveTargetModel = useCallback((v: string) => {
    setTargetModel(v); updateNodeData(id, { aiTargetModel: v });
  }, [id, updateNodeData]);
  const setAndSaveAspectRatio = useCallback((v: string) => {
    setAspectRatio(v); updateNodeData(id, { aiAspectRatio: v });
  }, [id, updateNodeData]);
  // Which downstream node type to auto-create from generated scenes.
  const [storyboardTarget, setStoryboardTarget] = useState<"storyboard" | "comfyui_image">(payload.aiStoryboardTarget ?? "storyboard");
  const setAndSaveStoryboardTarget = useCallback((v: "storyboard" | "comfyui_image") => {
    setStoryboardTarget(v); updateNodeData(id, { aiStoryboardTarget: v });
  }, [id, updateNodeData]);
  // Language the downstream scene promptText is generated in.
  const [promptLang, setPromptLang] = useState<"zh" | "en">(payload.aiPromptLang ?? "en");
  const setAndSavePromptLang = useCallback((v: "zh" | "en") => {
    setPromptLang(v); updateNodeData(id, { aiPromptLang: v });
  }, [id, updateNodeData]);

  // One-click template apply: fills genre/style/mood/targetModel/aspectRatio/
  // sceneCount/duration/llmModel + records the template id so generate calls
  // can attach its systemPromptAddon. Replaces existing values (no opt-in
  // merge) since the picker is an explicit user action.
  const applyScriptTemplate = useCallback((t: ScriptTemplate) => {
    const patch: Record<string, unknown> = { aiScriptTemplate: t.id };
    if (t.presets.genre !== undefined) { setGenre(t.presets.genre); patch.aiGenre = t.presets.genre; }
    if (t.presets.style !== undefined) { setStyle(t.presets.style); patch.aiStyle = t.presets.style; }
    if (t.presets.mood !== undefined) { setMood(t.presets.mood); patch.aiMood = t.presets.mood; }
    if (t.presets.targetVideoModel !== undefined) {
      setTargetModel(t.presets.targetVideoModel); patch.aiTargetModel = t.presets.targetVideoModel;
    }
    if (t.presets.aspectRatio !== undefined) {
      setAspectRatio(t.presets.aspectRatio); patch.aiAspectRatio = t.presets.aspectRatio;
    }
    if (t.presets.sceneCount !== undefined) {
      setSceneCount(t.presets.sceneCount); patch.aiSceneCount = t.presets.sceneCount;
    }
    if (t.presets.totalDuration !== undefined) {
      setDuration(t.presets.totalDuration); setDurationText(String(t.presets.totalDuration));
      patch.totalDuration = t.presets.totalDuration;
    }
    // Switch LLM to the recommended one — central to the feature value.
    const recommendedLlm = LLM_MODELS.some((m) => m.id === t.recommendedLlm)
      ? (t.recommendedLlm as LLMModelId)
      : null;
    if (recommendedLlm) { setLlmModel(recommendedLlm); patch.aiLlmModel = recommendedLlm; }
    updateNodeData(id, patch);
    setShowTemplatePicker(false);
    const llmLabel = LLM_MODELS.find((m) => m.id === t.recommendedLlm)?.label ?? t.recommendedLlm;
    toast.success(`已套用：${t.label}（写作模型 → ${llmLabel}）`);
  }, [id, updateNodeData]);

  // Close template picker on outside click
  useEffect(() => {
    if (!showTemplatePicker) return;
    const handler = (e: MouseEvent) => {
      if (templatePickerRef.current && !templatePickerRef.current.contains(e.target as Node)) {
        setShowTemplatePicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplatePicker]);

  // Scene count with functional updater to prevent stale closure on rapid clicks
  const handleSceneCountChange = useCallback((delta: 1 | -1) => {
    setSceneCount((prev) => {
      const next = Math.max(2, Math.min(12, prev + delta));
      updateNodeData(id, { aiSceneCount: next });
      return next;
    });
  }, [id, updateNodeData]);

  // Duration state — persisted to payload.totalDuration
  const _durNum = Number(payload.totalDuration);
  const initDuration = (payload.totalDuration !== undefined && !isNaN(_durNum)) ? Math.max(10, Math.min(600, _durNum)) : 60;
  const [duration,     setDuration]    = useState(initDuration);
  const [durationText, setDurationText] = useState(String(initDuration));
  const durationInputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (field: keyof ScriptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const applyDuration = useCallback((v: number) => {
    setDuration(v);
    setDurationText(String(v));
    updateNodeData(id, { totalDuration: v });
  }, [id, updateNodeData]);

  // Commit pending durationText and return the clamped value (for use before mutation)
  const commitDuration = useCallback((): number => {
    const parsed = parseInt(durationText, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(10, Math.min(600, parsed));
      if (clamped !== duration) applyDuration(clamped);
      return clamped;
    }
    return duration;
  }, [duration, durationText, applyDuration]);

  // Sync duration when payload changes externally (collab / undo-redo)
  useEffect(() => {
    if (durationInputRef.current !== null && durationInputRef.current === document.activeElement) return;
    const _n = Number(payload.totalDuration);
    const v = (payload.totalDuration !== undefined && !isNaN(_n)) ? Math.max(10, Math.min(600, _n)) : 60;
    setDuration(v);
    setDurationText(String(v));
  }, [payload.totalDuration]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync AI panel params when payload changes externally (collab / undo-redo)
  // Use !== undefined so empty-string resets propagate correctly
  useEffect(() => { if (payload.aiGenre       !== undefined) setGenre(payload.aiGenre       || GENRES[0]);  }, [payload.aiGenre]);
  useEffect(() => { if (payload.aiStyle       !== undefined) setStyle(payload.aiStyle       || STYLES[0]);  }, [payload.aiStyle]);
  useEffect(() => { if (payload.aiMood        !== undefined) setMood(payload.aiMood         || MOODS[0]);   }, [payload.aiMood]);
  useEffect(() => { if (payload.aiTargetModel !== undefined) setTargetModel(payload.aiTargetModel); },          [payload.aiTargetModel]);
  useEffect(() => { if (payload.aiAspectRatio !== undefined) setAspectRatio(payload.aiAspectRatio || "16:9"); }, [payload.aiAspectRatio]);
  useEffect(() => {
    if (typeof payload.aiSceneCount === "number") setSceneCount(Math.max(2, Math.min(12, payload.aiSceneCount)));
  }, [payload.aiSceneCount]);
  useEffect(() => {
    if (payload.aiLlmModel !== undefined) {
      const isValid = LLM_MODELS.some((m) => m.id === payload.aiLlmModel);
      setLlmModel(isValid ? (payload.aiLlmModel as LLMModelId) : "claude-sonnet-4-6");
    }
  }, [payload.aiLlmModel]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Create downstream nodes from generated scenes. Reads target type fresh from
  // the node payload so both generate paths share one code path. The prompt
  // language is chosen at generation time (server writes promptText in it), so
  // no client-side translation is needed here.
  const addScenesFromResult = useCallback((
    scenes: Array<{ description?: string; promptText?: string; negativePrompt?: string; cameraMovement?: string; duration?: number; lens?: string; colorGrade?: string; shotType?: string; lighting?: string }>,
  ): { count: number; target: "storyboard" | "comfyui_image" } => {
    const store = useCanvasStore.getState();
    const ownNode = store.nodes.find((n) => n.id === id);
    if (!store.projectId || !ownNode) { toast.error("画布尚未加载，节点创建失败"); return { count: 0, target: "storyboard" }; }
    const p = ownNode.data.payload as ScriptNodeData;
    const target = p.aiStoryboardTarget ?? "storyboard";
    const ownPos = ownNode.position ?? { x: 0, y: 0 };
    store.batchAddSceneNodes(scenes, id, ownPos, target);
    return { count: scenes.length, target };
  }, [id]);

  // 记录「上次拆分镜时的脚本正文」基线 hash，供后续检测脚本是否被改动（→ 分镜过期）。
  // 从 store 读最新 content（onSuccess 里 content 可能刚被写入）。
  const recordStoryboardBaseline = useCallback(() => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
    const c = (node?.data.payload as ScriptNodeData | undefined)?.content ?? "";
    updateNodeData(id, { lastStoryboardContentHash: hashContent(c), lastStoryboardAt: Date.now() }, true);
  }, [id, updateNodeData]);

  const generateMutation = trpc.scripts.generateStoryboards.useMutation({
    onSuccess: (result) => {
      const { count, target } = addScenesFromResult(result.scenes);
      if (count === 0) return;
      recordStoryboardBaseline();
      toast.success(target === "comfyui_image" ? "ComfyUI 图像节点已生成" : "分镜已生成", {
        description: `共 ${count} 个${target === "comfyui_image" ? "ComfyUI 图像" : "场景"}节点已添加到画布`,
        duration: 4000,
      });
    },
    onError: (err) => { toast.error("AI 生成分镜失败：" + err.message); },
  });

  // Use variables.mode (the actual sent mode) for the toast, not the closure value
  const polishMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result, variables) => {
      snapshotContent(id, variables.mode === "condense" ? "精简前" : "润色前");
      updateNodeData(id, { content: result.result });
      toast.success(variables.mode === "condense" ? "脚本已精简" : "脚本已润色");
    },
    onError: (err) => { toast.error("AI 操作失败：" + err.message); },
  });

  // AI 提取梗概 — guarded against clobbering mid-edit synopsis
  const summarizeMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      if (synopsisInputRef.current !== null && synopsisInputRef.current === document.activeElement) {
        toast.warning("梗概已提取，但检测到输入框正在编辑，未自动填入，请手动粘贴：\n" + result.result, { duration: 8000 });
        return;
      }
      updateNodeData(id, { synopsis: result.result });
      toast.success("梗概已提取");
    },
    onError: (err) => { toast.error("AI 提取梗概失败：" + err.message); },
  });

  const fullScriptMutation = trpc.scripts.generateFullScript.useMutation({
    onSuccess: (result) => {
      const scriptFilled = !!result.scriptText;
      if (scriptFilled) {
        snapshotContent(id, "整本生成前");
        updateNodeData(id, { content: result.scriptText });
      }
      let nodesCreated = 0;
      let target: "storyboard" | "comfyui_image" = "storyboard";
      if (result.scenes.length > 0) {
        const res = addScenesFromResult(result.scenes);
        nodesCreated = res.count;
        target = res.target;
        if (res.count > 0) recordStoryboardBaseline();
      }
      const tgtLabel = target === "comfyui_image" ? "ComfyUI 图像" : "分镜";
      toast.success("AI 剧本已生成", {
        description: nodesCreated > 0
          ? `${scriptFilled ? "剧本已填入，" : ""}${nodesCreated} 个${tgtLabel}节点已创建`
          : scriptFilled ? "剧本已填入" : `${tgtLabel}节点已创建`,
        duration: 5000,
      });
    },
    onError: (err) => { toast.error("AI 剧本生成失败：" + err.message); },
  });

  // ── Advanced panel mutations ──────────────────────────────────────────────

  const variantsMutation = trpc.scripts.generateVariants.useMutation({
    onSuccess: (result) => {
      setVariantResults(result.variants);
      setSelectedVariant(0);
      toast.success(`已生成 ${result.variants.length} 个剧本变体`);
    },
    onError: (err) => { toast.error("变体生成失败：" + err.message); },
  });

  const styleTransferMutation = trpc.scripts.applyStyleTransfer.useMutation({
    onSuccess: (result) => {
      snapshotContent(id, "风格迁移前");
      updateNodeData(id, { content: result.result });
      toast.success(`文风已迁移为「${selectedStyle}」`);
    },
    onError: (err) => { toast.error("文风迁移失败：" + err.message); },
  });

  const extractDialogueMutation = trpc.scripts.extractDialogue.useMutation({
    onSuccess: (result) => {
      setDialogueResult(result.result);
      toast.success("对白提取完成");
    },
    onError: (err) => { toast.error("对白提取失败：" + err.message); },
  });

  const moodBoardMutation = trpc.scripts.generateMoodBoard.useMutation({
    onSuccess: (result) => {
      setMoodBoardResult(result.scenes);
      toast.success(`Mood Board 已生成，共 ${result.scenes.length} 个场景提示词`);
    },
    onError: (err) => { toast.error("Mood Board 生成失败：" + err.message); },
  });

  const anyAdvancedPending = variantsMutation.isPending
    || styleTransferMutation.isPending || extractDialogueMutation.isPending || moodBoardMutation.isPending;

  // styleTransfer writes to payload.content — it must block polish/generate to prevent concurrent overwrites.
  // Other advanced mutations (review, variants, dialogue, moodboard) only read or write separate state.
  const anyPending = generateMutation.isPending || polishMutation.isPending
    || fullScriptMutation.isPending || summarizeMutation.isPending || styleTransferMutation.isPending;

  // extra：创作向导传入的节拍表/角色档案约束（Story Bible 前置注入）。
  const handleFullGenerate = useCallback((extra?: { beatSheetText?: string; characterProfiles?: string; scriptOnly?: boolean }) => {
    if (anyPending) return;
    let synopsis = (payload.synopsis?.trim() || payload.logline?.trim() || payload.content?.trim()) ?? "";
    if (!synopsis) { toast.error("请先填写故事梗概或脚本内容"); return; }
    if (synopsis.length > 2000) {
      synopsis = synopsis.slice(0, 2000);
      toast.warning("梗概过长，已自动截断至 2000 字");
    }
    // Commit any pending text in duration input before reading the value
    const committedDuration = commitDuration();
    const appliedTemplate = getScriptTemplate(payload.aiScriptTemplate);
    fullScriptMutation.mutate({
      synopsis,
      genre,
      style,
      mood,
      sceneCount,
      totalDuration: committedDuration,
      targetVideoModel: targetModel || undefined,
      aspectRatio,
      model: llmModel,
      promptLang,
      templatePromptOverride: appliedTemplate?.systemPromptAddon,
      beatSheetText: extra?.beatSheetText,
      characterProfiles: extra?.characterProfiles,
      scriptOnly: extra?.scriptOnly,
    });
  }, [anyPending, payload.synopsis, payload.content, payload.aiScriptTemplate, commitDuration, genre, style, mood, sceneCount, targetModel, aspectRatio, llmModel, promptLang, fullScriptMutation.mutate]);

  const handleCopy = useCallback(async () => {
    // Copy the full script content (trimmed of leading/trailing whitespace) —
    // never length-capped.
    const text = (payload.content ?? "").trim();
    if (!text) { toast.error("脚本内容为空"); return; }
    const markCopied = () => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      toast.success(`已复制全部 ${text.length} 字`);
    };
    // Preferred path: async Clipboard API (requires a secure context — HTTPS or
    // localhost). On plain-HTTP / LAN access it's undefined, so fall back below.
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        markCopied();
        return;
      } catch {
        // fall through to legacy path
      }
    }
    // Legacy fallback: a hidden <textarea> + execCommand('copy') works over
    // plain HTTP, so the "复制" button reliably copies the whole script even on
    // a LAN/HTTP deployment.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("execCommand copy returned false");
      markCopied();
    } catch {
      toast.error("复制失败，请手动选中文字复制（提示：HTTP 访问下浏览器限制剪贴板，建议改用 HTTPS）");
    }
  }, [payload.content]);

  const handleSummarize = useCallback(() => {
    if (anyPending) return;
    const text = payload.content?.trim();
    if (!text) { toast.error("请先填写脚本内容"); return; }
    const safeText = text.length > 8000 ? text.slice(0, 8000) : text;
    if (text.length > 8000) toast.warning("脚本过长，已截断至 8000 字进行梗概提取");
    summarizeMutation.mutate({ text: safeText, mode: "summarize", model: llmModel });
  }, [anyPending, payload.content, llmModel, summarizeMutation.mutate]);

  // ── Per-scene duration estimate ───────────────────────────────────────────
  const perSceneSecs = Math.round(duration / Math.max(1, sceneCount));
  const charCount = (payload.content ?? "").length;
  // Actual cap for generateStoryboards (server max is 8)
  const storyboardCount = Math.min(sceneCount, 8);

  return (
    <BaseNode id={id} selected={selected} nodeType="script" title={data.title} minHeight={200} resizable
      leftDock={
        <>
          {sidePanel === "flow" && (
            <ScriptDevFlowPanel
              id={id} payload={payload} llmModel={llmModel}
              fullGenPending={fullScriptMutation.isPending}
              storyboardsPending={generateMutation.isPending}
              onGenerateScript={(extra) => handleFullGenerate(extra)}
              onGenerateStoryboards={() => {
                if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
                generateMutation.mutate({ content: payload.content ?? "", synopsis: payload.synopsis, model: llmModel, count: storyboardCount, promptLang, targetVideoModel: targetModel || undefined });
              }}
              onOpenCoverage={() => setSidePanel("coverage")}
              onClose={() => setSidePanel(null)}
            />
          )}
          {sidePanel === "coverage" && (
            <ScriptCoveragePanel id={id} payload={payload} llmModel={llmModel} onClose={() => setSidePanel(null)} />
          )}
          {sidePanel === "history" && (
            <ScriptHistoryPanel id={id} payload={payload} onClose={() => setSidePanel(null)} />
          )}
          {sidePanel === "cast" && (
            <ScriptCastPanel id={id} payload={payload} onClose={() => setSidePanel(null)} />
          )}
        </>
      }>
      <div className="flex flex-col h-full p-3.5 gap-3">

        {/* Synopsis row */}
        <div className="flex gap-1.5 items-center">
          <NodeInput
            ref={synopsisInputRef}
            placeholder="故事梗概（一句话概括，也是 AI 剧本创作的核心素材）"
            value={payload.synopsis ?? ""}
            onValueChange={(v) => handleChange("synopsis", v)}
            className="nodrag"
            style={{ ...inputStyle, flex: 1 }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <button
            onClick={handleSummarize}
            disabled={anyPending || !payload.content?.trim()}
            title="从脚本内容 AI 提取梗概"
            className="nodrag flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all"
            style={{
              fontSize: 10, fontWeight: 600,
              background: summarizeMutation.isPending ? "var(--c-surface)" : "oklch(0.68 0.20 160 / 0.12)",
              border: `1px solid oklch(0.68 0.20 160 / ${summarizeMutation.isPending ? "0.15" : "0.35"})`,
              color: anyPending ? "var(--c-t4)" : "oklch(0.72 0.18 160)",
              cursor: anyPending || !payload.content?.trim() ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {summarizeMutation.isPending
              ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
              : <FileText style={{ width: 10, height: 10 }} />
            }
            提取梗概
          </button>
        </div>

        {/* Script content */}
        <NodeTextArea className="nodrag nowheel flex-1 nowheel"
          placeholder={"在此输入或粘贴脚本内容...\n\n也可直接使用下方「AI 剧本创作」一键生成。"}
          value={payload.content ?? ""}
          onValueChange={(v) => handleChange("content", v)}
          style={textareaStyle}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* 脚本↔分镜过期提示：脚本在拆分镜后又被修改时出现，提示而非自动覆盖已有分镜 */}
        {isStoryboardStale(payload, hasDownstreamStoryboardForId(id)) && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg nodrag" style={{ background: "oklch(0.72 0.16 70 / 0.12)", border: "1px solid oklch(0.72 0.16 70 / 0.4)" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "oklch(0.72 0.16 70)", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--c-t2)", flex: 1, lineHeight: 1.5 }}>脚本已修改，下游分镜可能已过期</span>
            <button
              onClick={() => {
                if (anyPending) return;
                if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
                generateMutation.mutate({ content: payload.content ?? "", synopsis: payload.synopsis, model: llmModel, count: storyboardCount, promptLang, targetVideoModel: targetModel || undefined });
              }}
              disabled={generateMutation.isPending}
              title="按当前脚本重新拆分镜（新增分镜节点，不覆盖已有分镜）"
              className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold transition-all flex-shrink-0"
              style={{ background: "oklch(0.72 0.16 70 / 0.2)", border: "1px solid oklch(0.72 0.16 70 / 0.5)", color: "oklch(0.72 0.16 70)", cursor: generateMutation.isPending ? "default" : "pointer" }}
            >
              {generateMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Film className="w-2.5 h-2.5" />}
              重新拆分镜
            </button>
          </div>
        )}

        {/* Quick AI buttons row */}
        <div className="flex items-center gap-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={handleLlmModelChange} disabled={anyPending} />

          {/* Polish mode segmented control */}
          <div className="flex rounded-md overflow-hidden nodrag" style={{ border: "1px solid var(--c-bd2)" }}>
            {POLISH_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setPolishMode(m.value)}
                className="nodrag px-1.5 py-0.5 transition-all"
                style={{
                  fontSize: 9, fontWeight: polishMode === m.value ? 700 : 400,
                  background: polishMode === m.value ? `${ACCENT}18` : "transparent",
                  border: "none",
                  color: polishMode === m.value ? ACCENT : "var(--c-t4)",
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (anyPending) return;
              if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
              const rawText = payload.content ?? "";
              const text = rawText.length > 8000 ? rawText.slice(0, 8000) : rawText;
              if (rawText.length > 8000) toast.warning("脚本过长，已截断至 8000 字进行润色");
              polishMutation.mutate({ text, mode: polishMode, model: llmModel });
            }}
            disabled={anyPending}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: polishMutation.isPending ? "var(--c-surface)" : `${ACCENT}18`,
              border: `1px solid ${polishMutation.isPending ? BORDER_DEFAULT : `${ACCENT}40`}`,
              color: anyPending ? "var(--c-t4)" : ACCENT,
              cursor: anyPending ? "not-allowed" : "pointer",
            }}
          >
            {polishMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI {POLISH_MODES.find(m => m.value === polishMode)?.label ?? "润色"}
          </button>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            disabled={!payload.content?.trim()}
            title="复制脚本内容"
            className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-all"
            style={{
              fontSize: 9, fontWeight: 500,
              background: "transparent",
              border: "1px solid var(--c-bd2)",
              color: copied ? "oklch(0.72 0.18 160)" : "var(--c-t4)",
              cursor: payload.content?.trim() ? "pointer" : "not-allowed",
            }}
          >
            {copied
              ? <Check style={{ width: 9, height: 9 }} />
              : <Copy style={{ width: 9, height: 9 }} />
            }
            {copied ? "已复制" : "复制"}
          </button>

          {/* 侧向面板开关：创作向导（行业开发管线）/ 专业审查（Coverage） */}
          <button
            onClick={() => setSidePanel((v) => (v === "flow" ? null : "flow"))}
            title="创作向导：想法 → Logline → 梗概 → 节拍表 → 剧本 → 分镜（侧向展开）"
            className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-all"
            style={{ fontSize: 9, fontWeight: sidePanel === "flow" ? 700 : 500, background: sidePanel === "flow" ? "oklch(0.66 0.18 250 / 0.18)" : "transparent", border: `1px solid ${sidePanel === "flow" ? "oklch(0.66 0.18 250 / 0.5)" : "var(--c-bd2)"}`, color: sidePanel === "flow" ? "oklch(0.66 0.18 250)" : "var(--c-t4)", cursor: "pointer" }}
          >
            <Route style={{ width: 9, height: 9 }} /> 向导
          </button>
          <button
            onClick={() => setSidePanel((v) => (v === "coverage" ? null : "coverage"))}
            title="专业审查：六维评分 + 裁决 + 一键修复闭环（侧向展开）"
            className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-all"
            style={{ fontSize: 9, fontWeight: sidePanel === "coverage" ? 700 : 500, background: sidePanel === "coverage" ? "oklch(0.68 0.20 295 / 0.18)" : "transparent", border: `1px solid ${sidePanel === "coverage" ? "oklch(0.68 0.20 295 / 0.5)" : "var(--c-bd2)"}`, color: sidePanel === "coverage" ? "oklch(0.68 0.20 295)" : "var(--c-t4)", cursor: "pointer" }}
          >
            <ClipboardCheck style={{ width: 9, height: 9 }} /> 审查
          </button>
          <button
            onClick={() => setSidePanel((v) => (v === "history" ? null : "history"))}
            title="版本历史：AI 改写前的正文快照，逐行 diff 对比 + 一键还原（侧向展开）"
            className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-all"
            style={{ fontSize: 9, fontWeight: sidePanel === "history" ? 700 : 500, background: sidePanel === "history" ? "oklch(0.70 0.15 165 / 0.18)" : "transparent", border: `1px solid ${sidePanel === "history" ? "oklch(0.70 0.15 165 / 0.5)" : "var(--c-bd2)"}`, color: sidePanel === "history" ? "oklch(0.70 0.15 165)" : "var(--c-t4)", cursor: "pointer" }}
          >
            <History style={{ width: 9, height: 9 }} />
            历史{(payload.scriptHistory?.length ?? 0) > 0 ? ` ${payload.scriptHistory!.length}` : ""}
          </button>
          <button
            onClick={() => setSidePanel((v) => (v === "cast" ? null : "cast"))}
            title="角色配音：从脚本识别角色，逐个指定配音模型 + 音色（与镜头表共享，侧向展开）"
            className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-all"
            style={{ fontSize: 9, fontWeight: sidePanel === "cast" ? 700 : 500, background: sidePanel === "cast" ? "oklch(0.70 0.18 340 / 0.18)" : "transparent", border: `1px solid ${sidePanel === "cast" ? "oklch(0.70 0.18 340 / 0.5)" : "var(--c-bd2)"}`, color: sidePanel === "cast" ? "oklch(0.70 0.18 340)" : "var(--c-t4)", cursor: "pointer" }}
          >
            <Mic style={{ width: 9, height: 9 }} /> 配音
          </button>

          {/* Character count + duration */}
          <span style={{ fontSize: 10, color: "var(--c-t4)", marginLeft: "auto" }}>
            {charCount} 字 · {duration}s 视频
          </span>
        </div>

        {/* Downstream node type selector — applies to BOTH generate paths below */}
        <div className="flex items-center gap-1.5" style={{ marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>生成为</span>
          <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid var(--c-bd2)` }}>
            {([["storyboard", "分镜节点"], ["comfyui_image", "ComfyUI 图像"]] as const).map(([val, label]) => {
              const active = storyboardTarget === val;
              return (
                <button
                  key={val}
                  onClick={() => setAndSaveStoryboardTarget(val)}
                  className="nodrag"
                  style={{
                    padding: "3px 10px", fontSize: 10.5, fontWeight: active ? 600 : 400,
                    background: active ? `${ACCENT}1e` : "transparent",
                    color: active ? ACCENT : "var(--c-t3)",
                    cursor: "pointer", border: "none",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Downstream prompt language — model writes promptText directly in this language */}
          <div className="flex items-center gap-1.5" style={{ marginLeft: "auto" }} title="下游节点提示词(promptText)的语言：由生成模型直接按所选语言书写。中文=下发中文提示词，英文=下发英文提示词（图像/视频模型通常对英文更友好）。">
            <Languages className="w-2.5 h-2.5" style={{ color: "var(--c-t4)" }} />
            <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid var(--c-bd2)` }}>
              {([["zh", "中文"], ["en", "英文"]] as const).map(([val, label]) => {
                const active = promptLang === val;
                return (
                  <button
                    key={val}
                    onClick={() => setAndSavePromptLang(val)}
                    className="nodrag"
                    style={{
                      padding: "3px 9px", fontSize: 10.5, fontWeight: active ? 600 : 400,
                      background: active ? `${ACCENT}1e` : "transparent",
                      color: active ? ACCENT : "var(--c-t3)",
                      cursor: "pointer", border: "none",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Generate storyboards from existing script — shows actual capped count */}
        <button
          onClick={() => {
            if (anyPending) return;
            if (!payload.content?.trim()) { toast.error("请先填写脚本内容"); return; }
            generateMutation.mutate({ content: payload.content ?? "", synopsis: payload.synopsis, model: llmModel, count: storyboardCount, promptLang, targetVideoModel: targetModel || undefined });
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
          {generateMutation.isPending ? "AI 生成分镜中..." : `AI 生成分镜（从现有脚本，共 ${storyboardCount} 个）`}
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

              {/* ── Template apply ── */}
              <div ref={templatePickerRef} className="relative">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", minWidth: 56 }}>
                    模板
                  </span>
                  <button
                    onClick={() => setShowTemplatePicker((v) => !v)}
                    className="nodrag flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all text-left"
                    style={{
                      fontSize: 11,
                      background: showTemplatePicker ? `${PANEL_ACCENT}14` : "var(--c-surface)",
                      border: `1px solid ${showTemplatePicker ? `${PANEL_ACCENT}55` : "var(--c-bd2)"}`,
                      color: payload.aiScriptTemplate ? PANEL_ACCENT : "var(--c-t3)",
                      cursor: "pointer",
                    }}
                  >
                    <BookOpen style={{ width: 11, height: 11, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>
                      {payload.aiScriptTemplate
                        ? `已套用：${getScriptTemplate(payload.aiScriptTemplate)?.label ?? payload.aiScriptTemplate}`
                        : "选择专业模板（一键填充参数 + 切换推荐 LLM）"}
                    </span>
                    <ChevronDown style={{ width: 10, height: 10, transform: showTemplatePicker ? "rotate(180deg)" : "none", transition: "transform 180ms" }} />
                  </button>
                  {payload.aiScriptTemplate && (
                    <button
                      onClick={() => updateNodeData(id, { aiScriptTemplate: undefined })}
                      className="nodrag w-6 h-6 rounded flex items-center justify-center"
                      style={{ color: "var(--c-t4)", border: "1px solid var(--c-bd2)" }}
                      title="清除已套用模板"
                    >
                      <X style={{ width: 10, height: 10 }} />
                    </button>
                  )}
                </div>

                {showTemplatePicker && (
                  <div
                    className="absolute left-0 right-0 z-50 rounded-xl overflow-hidden nodrag nopan nowheel"
                    style={{
                      top: "calc(100% + 4px)",
                      background: "var(--c-base)",
                      border: "1px solid var(--c-bd2)",
                      boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                      maxHeight: 360,
                      overflowY: "auto",
                    }}
                  >
                    {SCRIPT_TEMPLATE_CATEGORIES.map((cat, idx) => (
                      <div key={cat.id}>
                        <div
                          className="px-3 py-1.5 sticky top-0 z-10"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            color: "var(--c-t3)",
                            background: "color-mix(in oklch, var(--c-base) 92%, transparent)",
                            backdropFilter: "blur(8px)",
                            borderTop: idx > 0 ? "1px solid var(--c-bd1)" : "none",
                            borderBottom: "1px solid var(--c-bd1)",
                          }}
                        >
                          {cat.label}
                        </div>
                        {cat.templates.map((t) => {
                          const Icon = t.icon;
                          const llmLabel = LLM_MODELS.find((m) => m.id === t.recommendedLlm)?.label ?? t.recommendedLlm;
                          const llmMatches = llmModel === t.recommendedLlm;
                          const isApplied = payload.aiScriptTemplate === t.id;
                          return (
                            <button
                              key={t.id}
                              className="nodrag w-full flex items-center gap-2 px-3 py-2 text-left transition-all"
                              style={{
                                borderBottom: "1px solid var(--c-bd1)",
                                cursor: "pointer",
                                background: isApplied ? `${PANEL_ACCENT}10` : "transparent",
                              }}
                              onClick={() => applyScriptTemplate(t)}
                              onMouseEnter={(e) => { if (!isApplied) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                              onMouseLeave={(e) => { if (!isApplied) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: PANEL_ACCENT }} />
                              <div className="flex flex-col flex-1 min-w-0">
                                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--c-t1)" }}>{t.label}</span>
                                <span style={{ fontSize: 9.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.blurb}</span>
                              </div>
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: 99,
                                  background: llmMatches ? "oklch(0.72 0.18 155 / 0.18)" : "var(--c-input)",
                                  color: llmMatches ? "oklch(0.72 0.18 155)" : "var(--c-t3)",
                                  border: `1px solid ${llmMatches ? "oklch(0.72 0.18 155 / 0.4)" : "var(--c-bd2)"}`,
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                {llmMatches && <Check style={{ width: 8, height: 8, display: "inline", marginRight: 2 }} />}
                                {llmLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <ChipRow label="视频类型" options={GENRES} value={genre} onChange={setAndSaveGenre} color={PANEL_ACCENT} />
              <ChipRow label="画面风格" options={STYLES} value={style} onChange={setAndSaveStyle} color="oklch(0.68 0.18 280)" />
              <ChipRow label="情感基调" options={MOODS}  value={mood}  onChange={setAndSaveMood}  color="oklch(0.68 0.18 340)" />

              {/* Target model */}
              <div className="flex flex-col gap-1">
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                  目标视频模型
                </span>
                <select
                  value={targetModel}
                  onChange={(e) => setAndSaveTargetModel(e.target.value)}
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
                  {TARGET_MODEL_GROUPS.map((g) => {
                    const items = TARGET_MODELS.filter((m) => m.group === g);
                    if (items.length === 0) return null;
                    // "通用" is a single ungrouped entry; the rest get optgroups.
                    if (g === "通用") {
                      return items.map((m) => (
                        <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                      ));
                    }
                    return (
                      <optgroup key={g} label={g}>
                        {items.map((m) => (
                          <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
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
                      onClick={() => setAndSaveAspectRatio(r)}
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
                    <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--c-t4)", textTransform: "none" }}>
                      ≈ {perSceneSecs}s/场景
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleSceneCountChange(-1)}
                      className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                    >
                      <Minus style={{ width: 10, height: 10 }} />
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: PANEL_ACCENT, minWidth: 20, textAlign: "center" }}>{sceneCount}</span>
                    <button
                      onClick={() => handleSceneCountChange(1)}
                      className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                    >
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
                        const committed = parseInt(durationText, 10);
                        const base = isNaN(committed) ? duration : Math.max(10, Math.min(600, committed));
                        const step = base < 30 ? 5 : base < 120 ? 15 : base < 300 ? 30 : 60;
                        applyDuration(Math.max(10, base - step));
                      }}
                      className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                      style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                    >
                      <Minus style={{ width: 10, height: 10 }} />
                    </button>
                    <input
                      ref={durationInputRef}
                      type="text"
                      inputMode="numeric"
                      value={durationText}
                      onChange={(e) => setDurationText(e.target.value)}
                      onBlur={() => {
                        const v = parseInt(durationText, 10);
                        applyDuration(isNaN(v) ? duration : Math.max(10, Math.min(600, v)));
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
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
                        const committed = parseInt(durationText, 10);
                        const base = isNaN(committed) ? duration : Math.max(10, Math.min(600, committed));
                        const step = base < 30 ? 5 : base < 120 ? 15 : base < 300 ? 30 : 60;
                        applyDuration(Math.min(600, base + step));
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
                <LLMModelPicker value={llmModel} onChange={handleLlmModelChange} disabled={anyPending} />
                <button
                  onClick={() => handleFullGenerate()}
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
                将根据上方梗概及参数，生成完整中文剧本并自动创建 {sceneCount} 个（约{" "}
                {perSceneSecs}s/场景）针对{" "}
                {TARGET_MODELS.find((m) => m.value === targetModel)?.label ?? "通用"}{" "}
                优化的分镜节点
              </p>
            </div>
          )}
        </div>

        {/* ── 高级功能 panel ── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: `1px solid ${showAdvancedPanel ? `${ADV_ACCENT_A(0.45)}` : "var(--c-bd2)"}`, transition: "border-color 200ms ease" }}
        >
          {/* Panel header */}
          <button
            onClick={() => setShowAdvancedPanel((v) => !v)}
            className="nodrag flex items-center gap-2 w-full px-3 py-2 transition-all"
            style={{ background: showAdvancedPanel ? ADV_ACCENT_A(0.10) : "var(--c-base)", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <Wand2 style={{ width: 12, height: 12, color: ADV_ACCENT, flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, color: showAdvancedPanel ? ADV_ACCENT : "var(--c-t3)", flex: 1, letterSpacing: "0.02em" }}>
              高级功能
            </span>
            <span style={{ fontSize: 9, color: "var(--c-t4)" }}>
              {showAdvancedPanel ? "" : "变体 · 文风 · 对白 · Mood Board"}
            </span>
            <ChevronDown style={{ width: 10, height: 10, color: "var(--c-t4)", transform: showAdvancedPanel ? "rotate(180deg)" : "none", transition: "transform 200ms ease", flexShrink: 0 }} />
          </button>

          {/* Panel body */}
          {showAdvancedPanel && (
            <div className="flex flex-col gap-3 px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${ADV_ACCENT_A(0.20)}` }}>

              {/* Tab bar */}
              <div className="flex gap-0.5 p-0.5 rounded-lg overflow-x-auto nodrag" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)", scrollbarWidth: "none" }}>
                {([
                  { key: "variants", label: "变体",   Icon: GitBranch },
                  { key: "style",    label: "文风",   Icon: Layers2 },
                  { key: "dialogue", label: "对白",   Icon: MessageSquare },
                  { key: "moodboard",label: "Mood",   Icon: Image },
                ] as const).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setAdvTab(key)}
                    className="nodrag flex items-center gap-1 flex-shrink-0 px-2 py-1.5 rounded-md transition-all"
                    style={{ background: advTab === key ? ADV_ACCENT_A(0.18) : "transparent", border: `1px solid ${advTab === key ? ADV_ACCENT_A(0.40) : "transparent"}`, color: advTab === key ? ADV_ACCENT : "var(--c-t3)", cursor: "pointer", fontSize: 9.5, fontWeight: advTab === key ? 700 : 500 }}
                  >
                    <Icon style={{ width: 9, height: 9 }} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content — capped height with internal scroll to keep the node compact */}
              <div className="nowheel nodrag" style={{ maxHeight: 360, overflowY: "auto", overflowX: "hidden" }}>
              {/* ── 变体 tab ── */}
              {advTab === "variants" && (
                <div className="flex flex-col gap-2">
                  <p style={{ fontSize: 10, color: "var(--c-t3)" }}>基于相同梗概生成多个风格各异的开场段落版本。</p>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 10, color: "var(--c-t3)" }}>版本数量</span>
                    <div className="flex items-center gap-1 ml-auto">
                      {[2, 3, 4].map((n) => (
                        <button key={n} onClick={() => setVariantCount(n)} className="nodrag w-6 h-6 flex items-center justify-center rounded-md transition-all"
                          style={{ fontSize: 10, fontWeight: variantCount === n ? 700 : 400, background: variantCount === n ? ADV_ACCENT_A(0.15) : "var(--c-surface)", border: `1px solid ${variantCount === n ? ADV_ACCENT_A(0.5) : "var(--c-bd2)"}`, color: variantCount === n ? ADV_ACCENT : "var(--c-t3)", cursor: "pointer" }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (variantsMutation.isPending) return;
                      const synopsis = (payload.synopsis?.trim() || payload.content?.trim())?.slice(0, 2000);
                      if (!synopsis) { toast.error("请先填写故事梗概或脚本内容"); return; }
                      variantsMutation.mutate({ synopsis, variantCount, model: llmModel });
                    }}
                    disabled={variantsMutation.isPending || !(payload.synopsis?.trim() || payload.content?.trim())}
                    className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                    style={{ background: variantsMutation.isPending ? "var(--c-surface)" : ADV_ACCENT_A(0.12), border: `1px solid ${variantsMutation.isPending ? BORDER_DEFAULT : ADV_ACCENT_A(0.4)}`, color: variantsMutation.isPending || !(payload.synopsis?.trim() || payload.content?.trim()) ? "var(--c-t4)" : ADV_ACCENT, cursor: variantsMutation.isPending || !(payload.synopsis?.trim() || payload.content?.trim()) ? "not-allowed" : "pointer" }}
                  >
                    {variantsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
                    {variantsMutation.isPending ? "AI 生成变体中..." : `生成 ${variantCount} 个版本`}
                  </button>
                  {variantResults.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {variantResults.map((v, i) => (
                          <button key={i} onClick={() => setSelectedVariant(i)} className="nodrag px-2 py-0.5 rounded-full text-[9px] font-medium transition-all"
                            style={{ background: selectedVariant === i ? ADV_ACCENT_A(0.18) : "var(--c-surface)", border: `1px solid ${selectedVariant === i ? ADV_ACCENT_A(0.5) : "var(--c-bd2)"}`, color: selectedVariant === i ? ADV_ACCENT : "var(--c-t3)", cursor: "pointer" }}>
                            {v.label}
                          </button>
                        ))}
                      </div>
                      {variantResults[selectedVariant] && (
                        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                          <p style={{ fontSize: 10.5, color: "var(--c-t1)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{variantResults[selectedVariant].text}</p>
                          <button
                            onClick={() => {
                              snapshotContent(id, "变体应用前");
                              updateNodeData(id, { content: variantResults[selectedVariant].text });
                              toast.success(`已应用「${variantResults[selectedVariant].label}」版本`);
                            }}
                            className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium w-full transition-all"
                            style={{ background: ADV_ACCENT_A(0.12), border: `1px solid ${ADV_ACCENT_A(0.4)}`, color: ADV_ACCENT, cursor: "pointer" }}
                          >
                            <Check className="w-2.5 h-2.5" />
                            应用此版本
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── 文风 tab ── */}
              {advTab === "style" && (
                <div className="flex flex-col gap-2">
                  <p style={{ fontSize: 10, color: "var(--c-t3)" }}>保留故事框架，将整本剧本迁移为指定写作风格。</p>
                  <div className="flex gap-1 flex-wrap">
                    {SCRIPT_STYLES.map((s) => (
                      <button key={s} onClick={() => setSelectedStyle(s)} className="nodrag px-2 py-0.5 rounded-full text-[9px] font-medium transition-all"
                        style={{ background: selectedStyle === s ? ADV_ACCENT_A(0.18) : "var(--c-surface)", border: `1px solid ${selectedStyle === s ? ADV_ACCENT_A(0.5) : "var(--c-bd2)"}`, color: selectedStyle === s ? ADV_ACCENT : "var(--c-t3)", cursor: "pointer" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      if (anyPending) return;
                      const text = payload.content?.trim();
                      if (!text) { toast.error("请先填写脚本内容"); return; }
                      if (!window.confirm(`确认将脚本内容迁移为「${selectedStyle}」风格？此操作将覆盖当前内容，不可撤销。`)) return;
                      styleTransferMutation.mutate({ scriptText: text.slice(0, 8000), style: selectedStyle, model: llmModel });
                    }}
                    disabled={anyPending || !payload.content?.trim()}
                    className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                    style={{ background: anyPending ? "var(--c-surface)" : ADV_ACCENT_A(0.12), border: `1px solid ${anyPending ? BORDER_DEFAULT : ADV_ACCENT_A(0.4)}`, color: anyPending || !payload.content?.trim() ? "var(--c-t4)" : ADV_ACCENT, cursor: anyPending || !payload.content?.trim() ? "not-allowed" : "pointer" }}
                  >
                    {styleTransferMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers2 className="w-3 h-3" />}
                    {styleTransferMutation.isPending ? `迁移为「${selectedStyle}」风格中...` : `迁移为「${selectedStyle}」风格`}
                  </button>
                  <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5 }}>
                    此操作将直接覆盖脚本内容，建议先备份原文。
                  </p>
                </div>
              )}

              {/* ── 对白 tab ── */}
              {advTab === "dialogue" && (
                <div className="flex flex-col gap-2">
                  <p style={{ fontSize: 10, color: "var(--c-t3)" }}>从剧本中提取所有对白，格式化为「角色：台词」清单。</p>
                  <button
                    onClick={() => {
                      if (extractDialogueMutation.isPending) return;
                      const text = payload.content?.trim();
                      if (!text) { toast.error("请先填写脚本内容"); return; }
                      extractDialogueMutation.mutate({ scriptText: text.slice(0, 8000), model: llmModel });
                    }}
                    disabled={extractDialogueMutation.isPending || !payload.content?.trim()}
                    className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                    style={{ background: extractDialogueMutation.isPending ? "var(--c-surface)" : ADV_ACCENT_A(0.12), border: `1px solid ${extractDialogueMutation.isPending ? BORDER_DEFAULT : ADV_ACCENT_A(0.4)}`, color: extractDialogueMutation.isPending || !payload.content?.trim() ? "var(--c-t4)" : ADV_ACCENT, cursor: extractDialogueMutation.isPending || !payload.content?.trim() ? "not-allowed" : "pointer" }}
                  >
                    {extractDialogueMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                    {extractDialogueMutation.isPending ? "AI 提取对白中..." : "提取对白清单"}
                  </button>
                  {dialogueResult && (
                    <div className="flex flex-col gap-1.5">
                      <pre style={{ fontSize: 10, color: "var(--c-t1)", lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "inherit", background: "var(--c-input)", border: "1px solid var(--c-bd1)", borderRadius: 8, padding: "8px 10px", maxHeight: 160, overflowY: "auto" }}>
                        {dialogueResult}
                      </pre>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(dialogueResult);
                            toast.success("对白清单已复制到剪贴板");
                          } catch { toast.error("复制失败"); }
                        }}
                        className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium w-full transition-all"
                        style={{ background: ADV_ACCENT_A(0.08), border: `1px solid ${ADV_ACCENT_A(0.3)}`, color: ADV_ACCENT, cursor: "pointer" }}
                      >
                        <Copy className="w-2.5 h-2.5" /> 复制对白清单
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Mood Board tab ── */}
              {advTab === "moodboard" && (
                <div className="flex flex-col gap-2">
                  <p style={{ fontSize: 10, color: "var(--c-t3)" }}>将剧本每个场景提炼为 AI 图像生成提示词，便于快速创建视觉参考板。</p>
                  <button
                    onClick={() => {
                      if (moodBoardMutation.isPending) return;
                      const text = payload.content?.trim();
                      if (!text) { toast.error("请先填写脚本内容"); return; }
                      moodBoardMutation.mutate({ scriptText: text.slice(0, 8000), model: llmModel, promptLang });
                    }}
                    disabled={moodBoardMutation.isPending || !payload.content?.trim()}
                    className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                    style={{ background: moodBoardMutation.isPending ? "var(--c-surface)" : ADV_ACCENT_A(0.12), border: `1px solid ${moodBoardMutation.isPending ? BORDER_DEFAULT : ADV_ACCENT_A(0.4)}`, color: moodBoardMutation.isPending || !payload.content?.trim() ? "var(--c-t4)" : ADV_ACCENT, cursor: moodBoardMutation.isPending || !payload.content?.trim() ? "not-allowed" : "pointer" }}
                  >
                    {moodBoardMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
                    {moodBoardMutation.isPending ? "AI 生成 Mood Board 中..." : "生成场景 Mood Board"}
                  </button>
                  {moodBoardResult.length > 0 && (
                    <button
                      onClick={() => {
                        const { count, target } = addScenesFromResult(moodBoardResult.map((s) => ({ description: s.sceneTitle, promptText: s.prompt, negativePrompt: s.negPrompt })));
                        if (count > 0) toast.success(`已为 ${count} 个 Mood Board 场景创建${target === "comfyui_image" ? " ComfyUI 图像" : "分镜"}节点`);
                      }}
                      className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: ADV_ACCENT_A(0.12), border: `1px solid ${ADV_ACCENT_A(0.4)}`, color: ADV_ACCENT, cursor: "pointer" }}
                    >
                      <Film className="w-3 h-3" /> 一键为每个场景创建{storyboardTarget === "comfyui_image" ? " ComfyUI 图像" : "分镜"}节点
                    </button>
                  )}
                  {moodBoardResult.length > 0 && (
                    <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto nodrag">
                      {moodBoardResult.map((scene, i) => (
                        <div key={`${scene.sceneIndex}-${i}`} className="p-2.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: ADV_ACCENT_A(0.15), color: ADV_ACCENT }}>场景{scene.sceneIndex}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--c-t2)" }}>{scene.sceneTitle}</span>
                          </div>
                          <p style={{ fontSize: 9.5, color: "var(--c-t1)", lineHeight: 1.6, fontFamily: "monospace", marginBottom: 4 }}>{scene.prompt}</p>
                          {scene.negPrompt && <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5 }}>−{scene.negPrompt}</p>}
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(scene.prompt);
                                toast.success(`场景 ${scene.sceneIndex} 提示词已复制`);
                              } catch { toast.error("复制失败"); }
                            }}
                            className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-[9px] mt-1"
                            style={{ background: ADV_ACCENT_A(0.08), border: `1px solid ${ADV_ACCENT_A(0.25)}`, color: ADV_ACCENT, cursor: "pointer" }}
                          >
                            <Copy style={{ width: 8, height: 8 }} /> 复制提示词
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </div>{/* end tab content scroll */}

            </div>
          )}
        </div>

      </div>
    </BaseNode>
  );
});
