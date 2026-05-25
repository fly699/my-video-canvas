import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { VideoTaskNodeData, VideoProvider } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Handle, Position } from "@xyflow/react";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle, Download, ChevronDown, ChevronRight, Layers } from "lucide-react";

// Providers that require a reference image (image-to-video)
const REQUIRES_REFERENCE_IMAGE = new Set<string>([
  "poyo_wan25_i2v",
]);

// Heuristic: only allow http(s) / same-origin paths to render. Reject data:/blob:/javascript:.
function isSafeMediaUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url);
}

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "video_task";
    title: string;
    payload: VideoTaskNodeData;
    projectId: number;
  };
}

const STATUS = {
  pending:    { icon: Clock,         label: "待提交", accent: "var(--c-t3)", bg: "var(--c-surface)", borderColor: "var(--c-bd2)" },
  processing: { icon: Loader2,       label: "生成中", accent: "oklch(0.68 0.22 285)",  bg: "oklch(0.68 0.22 285 / 0.08)", borderColor: "oklch(0.68 0.22 285 / 0.30)", spin: true },
  succeeded:  { icon: CheckCircle2,  label: "已完成", accent: "oklch(0.72 0.18 155)",  bg: "oklch(0.72 0.18 155 / 0.08)", borderColor: "oklch(0.72 0.18 155 / 0.30)" },
  failed:     { icon: XCircle,       label: "失败",   accent: "oklch(0.62 0.20 25)",   bg: "oklch(0.62 0.20 25 / 0.08)",  borderColor: "oklch(0.62 0.20 25 / 0.30)" },
} as const;

const PROVIDERS: { value: VideoProvider; label: string; group: string }[] = [
  { value: "poyo_seedance",       label: "Seedance 2",          group: "Poyo" },
  { value: "poyo_veo",            label: "Veo 3.1",             group: "Poyo" },
  { value: "poyo_kling26",        label: "Kling 2.6",           group: "Poyo" },
  { value: "poyo_kling_o3_std",   label: "Kling O3 Standard",   group: "Poyo" },
  { value: "poyo_kling_o3_pro",   label: "Kling O3 Pro",        group: "Poyo" },
  { value: "poyo_kling_o3_4k",    label: "Kling O3 4K",         group: "Poyo" },
  { value: "poyo_wan25_t2v",      label: "Wan 2.5 文生视频",    group: "Poyo" },
  { value: "poyo_wan25_i2v",      label: "Wan 2.5 图生视频",    group: "Poyo" },
  { value: "poyo_runway45",       label: "Runway Gen 4.5",      group: "Poyo" },
  // Higgsfield 公共 API 仅支持 DoP 3 个变体（其他 Kling/Seedance/Veo 模型
  // 只在 cloud.higgsfield.ai 私有后端，第三方无法调用）。
  { value: "hf_dop_standard",     label: "DoP Standard",        group: "Higgsfield" },
  { value: "hf_dop_lite",         label: "DoP Lite",            group: "Higgsfield" },
  { value: "hf_dop_turbo",        label: "DoP Turbo",           group: "Higgsfield" },
  { value: "mock",                label: "Mock 测试",           group: "Dev" },
];

type ParamDef =
  | { type: "select"; key: string; label: string; options: { value: string | number; label: string }[]; default?: string | number }
  | { type: "number"; key: string; label: string; min: number; max: number; step: number; default?: number }
  | { type: "range";  key: string; label: string; min: number; max: number; step: number; default?: number; unit?: string }
  | { type: "toggle"; key: string; label: string; default?: boolean };

const HF_DOP_PARAMS: ParamDef[] = [
  { type: "toggle", key: "enhance_prompt", label: "AI 增强提示词", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const KLING_O3_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
    options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
];

const SUPPORTS_NEGATIVE_PROMPT = new Set<string>([
  "poyo_seedance", "poyo_veo",
  "poyo_kling26", "poyo_kling_o3_std", "poyo_kling_o3_pro", "poyo_kling_o3_4k",
]);

const PROVIDER_PARAMS: Record<string, ParamDef[]> = {
  poyo_seedance: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [
        { value: "21:9", label: "21:9 超宽" }, { value: "16:9", label: "16:9 横屏" },
        { value: "4:3", label: "4:3 标准" }, { value: "1:1", label: "1:1 方形" },
        { value: "3:4", label: "3:4 竖屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "auto", label: "自动" },
      ]},
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 2, max: 12, step: 1, default: 5, unit: "s" },
    { type: "toggle", key: "camera_fixed", label: "固定镜头", default: false },
  ],
  poyo_veo: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 5, max: 30, step: 5, default: 5, unit: "s" },
  ],
  hf_dop_standard: HF_DOP_PARAMS,
  hf_dop_lite:     HF_DOP_PARAMS,
  hf_dop_turbo:    HF_DOP_PARAMS,
  poyo_kling26: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    { type: "toggle", key: "sound", label: "AI 生成音效", default: false },
  ],
  poyo_kling_o3_std: KLING_O3_PARAMS,
  poyo_kling_o3_pro: KLING_O3_PARAMS,
  poyo_kling_o3_4k:  KLING_O3_PARAMS,
  poyo_wan25_t2v: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 3, max: 10, step: 1, default: 5, unit: "s" },
  ],
  poyo_wan25_i2v: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 3, max: 10, step: 1, default: 5, unit: "s" },
  ],
  poyo_runway45: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
  ],
  mock: [],
};

const BORDER_DEFAULT = "var(--c-bd2)";
const accentColor = "oklch(0.62 0.20 25)";

// Rough cost estimates in Poyo credits per 5s clip (display only)
const PROVIDER_COST: Record<string, { label: string; color: string }> = {
  poyo_seedance:     { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  poyo_veo:          { label: "~20积分", color: "oklch(0.65 0.18 60)" },
  poyo_kling26:      { label: "~4积分", color: "oklch(0.72 0.18 155)" },
  poyo_kling_o3_std: { label: "~6积分", color: "oklch(0.72 0.18 155)" },
  poyo_kling_o3_pro: { label: "~12积分", color: "oklch(0.65 0.18 60)" },
  poyo_kling_o3_4k:  { label: "~30积分", color: "oklch(0.62 0.20 25)" },
  poyo_wan25_t2v:    { label: "~2积分", color: "oklch(0.72 0.18 155)" },
  poyo_wan25_i2v:    { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  poyo_runway45:     { label: "~10积分", color: "oklch(0.65 0.18 60)" },
  hf_dop_standard:   { label: "~8积分", color: "oklch(0.65 0.18 60)" },
  hf_dop_lite:       { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  hf_dop_turbo:      { label: "~2积分", color: "oklch(0.72 0.18 155)" },
  mock:              { label: "免费", color: "oklch(0.55 0.08 260)" },
};

const fieldStyle: React.CSSProperties = {
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
  transition: "border-color 150ms ease, background 150ms ease",
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

export const VideoTaskNode = memo(function VideoTaskNode({ id, selected, data }: Props) {
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Count of parallel-mode createTaskMutation calls currently in flight.
  // When > 0, the shared mutation's global onSuccess/onError must NOT write to payload —
  // the per-mutate handler updates parallelResults instead. A single counter (vs. boolean
  // flag) correctly handles 2+ concurrent parallel submits whose globals fire in arbitrary order.
  const parallelInFlightRef = useRef(0);
  // Auto-collapse params when node is deselected; expand when selected
  const [paramsExpanded, setParamsExpanded] = useState(!!selected);
  useEffect(() => { setParamsExpanded(!!selected); }, [selected]);

  const [parallelMode, setParallelMode] = useState(false);
  const [parallelProviders, setParallelProviders] = useState<VideoProvider[]>([]);
  const [parallelResults, setParallelResults] = useState<Record<string, { status: "pending" | "processing" | "done" | "failed"; videoUrl?: string; taskId?: number }>>({});
  // Track all in-flight parallel poll timers so we can fully clean them up when leaving parallel mode
  const parallelPollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Generation counter — incremented on parallel-mode close so stale per-mutate callbacks
  // (still in flight at close time) won't reintroduce entries into parallelResults
  const parallelGenRef = useRef(0);

  const createTaskMutation = trpc.videoTasks.create.useMutation({
    onSuccess: (task) => {
      // If any parallel submit is in flight, suppress global payload write for this call.
      // Decrement the counter so subsequent globals know when all parallel submits are done.
      if (parallelInFlightRef.current > 0) {
        parallelInFlightRef.current -= 1;
        return;
      }
      // Guard: node may have been deleted while mutation was in flight
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { status: "processing", taskId: task.id, externalTaskId: task.externalTaskId ?? undefined });
      toast.success("视频任务已提交");
    },
    onError: (err) => {
      if (parallelInFlightRef.current > 0) {
        parallelInFlightRef.current -= 1;
        // Per-call onError is responsible for surfacing the failure in parallelResults
        return;
      }
      toast.error("提交失败：" + err.message);
    },
  });

  const resetTaskMutation = trpc.videoTasks.reset.useMutation({
    onSuccess: () => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
      toast.success("已重置，可重新提交");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
      console.warn("Reset task DB error (ignored):", err.message);
      toast.warning("已本地重置；服务端同步失败：" + err.message);
    },
  });

  const pollQuery = trpc.videoTasks.poll.useQuery({ id: payload.taskId! }, { enabled: false, refetchInterval: false });
  const pollQueryRef = useRef(pollQuery);
  pollQueryRef.current = pollQuery;
  const utils = trpc.useUtils();

  // Poll parallel task IDs — intervals keyed by provider string
  useEffect(() => {
    Object.entries(parallelResults).forEach(([provider, entry]) => {
      if (entry.status === "processing" && entry.taskId != null && !parallelPollRefs.current.has(provider)) {
        const taskId = entry.taskId;
        const intervalId = setInterval(async () => {
          try {
            const result = await utils.videoTasks.poll.fetch({ id: taskId });
            if (result && (result.status === "succeeded" || result.status === "failed")) {
              setParallelResults(prev => ({
                ...prev,
                [provider]: { ...prev[provider], status: result.status === "succeeded" ? "done" : "failed", videoUrl: result.resultVideoUrl ?? undefined },
              }));
              clearInterval(parallelPollRefs.current.get(provider));
              parallelPollRefs.current.delete(provider);
            }
          } catch { /* transient — retry next tick */ }
        }, 5000);
        parallelPollRefs.current.set(provider, intervalId);
      }
      if ((entry.status === "done" || entry.status === "failed") && parallelPollRefs.current.has(provider)) {
        clearInterval(parallelPollRefs.current.get(provider));
        parallelPollRefs.current.delete(provider);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallelResults]);
  // Cleanup all parallel intervals on unmount
  useEffect(() => () => { parallelPollRefs.current.forEach(clearInterval); parallelPollRefs.current.clear(); }, []);

  useEffect(() => {
    if (!(payload.status === "processing" && payload.taskId)) return;
    // Tolerate transient poll failures — the server-side task is still running and credits
    // are already spent. Marking the node "failed" on a single network blip would tempt the user
    // to re-submit and double-charge. Only flip to failed after several consecutive failures.
    let consecutiveFailures = 0;
    const MAX_POLL_FAILURES = 5;
    const timerId = setInterval(async () => {
      try {
        const result = await pollQueryRef.current.refetch();
        if (result.error) throw result.error;
        if (result.data) {
          consecutiveFailures = 0;
          const task = result.data;
          if (task.status === "succeeded" || task.status === "failed") {
            updateNodeData(id, {
              status: task.status,
              resultVideoUrl: task.resultVideoUrl ?? undefined,
              errorMessage: task.errorMessage ?? undefined,
            }, true);
            clearInterval(timerId);
          }
        }
      } catch (err) {
        consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "未知错误";
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          updateNodeData(id, { status: "failed", errorMessage: `轮询持续失败：${msg}` }, true);
          clearInterval(timerId);
          toast.error("轮询持续失败，任务可能仍在服务端运行；如需重新提交请先在服务端确认");
        }
        // Otherwise: silent retry on next tick
      }
    }, 5000);
    pollRef.current = timerId;
    return () => { clearInterval(timerId); pollRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.status, payload.taskId, id, updateNodeData]);

  const handleChange = useCallback(
    (field: keyof VideoTaskNodeData, value: unknown) => { updateNodeData(id, { [field]: value }); },
    [id, updateNodeData]
  );

  const handleParamChange = useCallback(
    (key: string, value: unknown) => {
      updateNodeData(id, { params: { ...(payload.params ?? {}), [key]: value } });
    },
    [id, updateNodeData, payload.params]
  );

  const handleSubmit = () => {
    if (createTaskMutation.isPending) return;
    if (payload.status === "processing") return;
    if (!payload.prompt?.trim()) { toast.error("请填写提示词"); return; }
    if (REQUIRES_REFERENCE_IMAGE.has(payload.provider) && !payload.referenceImageUrl?.trim()) {
      toast.error("该模型需要参考图 URL"); return;
    }
    if (payload.referenceImageUrl && !isSafeMediaUrl(payload.referenceImageUrl)) {
      toast.error("参考图 URL 仅支持 http(s) 或相对路径"); return;
    }
    createTaskMutation.mutate({
      projectId: data.projectId, nodeId: id,
      provider: payload.provider, prompt: payload.prompt,
      negativePrompt: payload.negativePrompt, referenceImageUrl: payload.referenceImageUrl,
      params: payload.params,
    });
  };

  const handleReset = () => {
    if (payload.taskId) {
      resetTaskMutation.mutate({ id: payload.taskId });
    } else {
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
    }
  };

  const status = STATUS[payload.status] ?? STATUS.pending;
  const StatusIcon = status.icon;
  const isLocked = payload.status === "processing" || payload.status === "succeeded";
  const isResettable = payload.status === "succeeded" || payload.status === "failed";

  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "oklch(0.62 0.20 25 / 0.6)"; };
  const onFocusMid    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "var(--c-t4)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  // Only accept http(s) (route through proxy) or same-origin relative paths; reject data:/blob:/javascript:
  const videoSrc = !isSafeMediaUrl(payload.resultVideoUrl)
    ? undefined
    : payload.resultVideoUrl!.startsWith("http")
      ? `/api/video-proxy?url=${encodeURIComponent(payload.resultVideoUrl!)}`
      : payload.resultVideoUrl;

  // Get param defs for current provider
  const paramDefs = PROVIDER_PARAMS[payload.provider] ?? [];
  const params = payload.params ?? {};

  const heroMedia = payload.status === "succeeded" && videoSrc ? (
    <video
      src={videoSrc}
      controls
      className="w-full"
      preload="metadata"
      style={{ display: "block", maxHeight: 240 }}
    />
  ) : isSafeMediaUrl(payload.referenceImageUrl) ? (
    <img
      src={payload.referenceImageUrl}
      style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }}
      draggable={false}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="video_task" title={data.title} minHeight={260} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* ── Status pill ── */}
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg flex-shrink-0"
          style={{ background: status.bg, borderWidth: 1, borderStyle: "solid", borderColor: status.borderColor }}
        >
          <StatusIcon
            className={`w-3.5 h-3.5 flex-shrink-0 ${(status as { spin?: boolean }).spin ? "animate-spin" : ""}`}
            style={{ color: status.accent }}
          />
          <span className="text-xs font-medium" style={{ color: status.accent }}>{status.label}</span>
          {payload.status === "processing" && (
            <span className="ml-auto text-[10px] animate-pulse" style={{ color: "var(--c-t3)" }}>轮询中...</span>
          )}
          {payload.status === "succeeded" && (
            <span className="ml-auto text-[10px]" style={{ color: "var(--c-t4)" }}>生成完成</span>
          )}
        </div>

        {/* ── Result video ── */}
        {payload.status === "succeeded" && payload.resultVideoUrl && videoSrc && (
          <div className="flex-shrink-0">
            <div className="rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: STATUS.succeeded.borderColor }}>
              <video
                key={videoSrc}
                src={videoSrc}
                controls
                className="w-full nodrag"
                style={{ maxHeight: 140, display: "block" }}
                preload="metadata"
                onError={(e) => {
                  const target = e.currentTarget;
                  console.error("[VideoTaskNode] Video load error:", target.error?.message, "src:", target.src);
                }}
              />
            </div>
            {/* Download button */}
            <a
              href={`/api/video-proxy?url=${encodeURIComponent(payload.resultVideoUrl)}&download=1`}
              download
              className="nodrag mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: "oklch(0.72 0.18 155 / 0.10)",
                borderWidth: 1, borderStyle: "solid",
                borderColor: "oklch(0.72 0.18 155 / 0.30)",
                color: "oklch(0.72 0.18 155)",
                textDecoration: "none",
                display: "flex",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.18)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.10)"; }}
            >
              <Download className="w-3 h-3" />
              下载视频
            </a>
          </div>
        )}

        {/* ── Error ── */}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0" style={{ background: STATUS.failed.bg, borderWidth: 1, borderStyle: "solid", borderColor: STATUS.failed.borderColor }}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: STATUS.failed.accent }} />
            <p className="text-[11px] leading-relaxed" style={{ color: STATUS.failed.accent, wordBreak: "break-word", overflowWrap: "anywhere", minWidth: 0, flex: 1 }}>{payload.errorMessage}</p>
          </div>
        )}

        {/* ── Input area (collapsed when not selected) ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: selected ? "9999px" : "0px",
            transition: selected
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          }}
        >

        {/* ── Parallel compare mode toggle ── */}
        <div className="flex items-center justify-between px-3.5 pt-2 pb-1 flex-shrink-0" style={{ marginLeft: -14, marginRight: -14 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
            {parallelMode ? "并行对比模式" : "单模型模式"}
          </span>
          <button
            onClick={() => {
              // Stop polls, reset the in-flight counter (so a stranded count from in-flight mutates
              // won't suppress future single-mode onSuccess writes), bump the generation token
              // (so stale per-mutate callbacks no-op), and clear state
              parallelPollRefs.current.forEach(clearInterval);
              parallelPollRefs.current.clear();
              parallelInFlightRef.current = 0;
              parallelGenRef.current += 1;
              setParallelMode((v) => !v);
              setParallelProviders([]);
              setParallelResults({});
            }}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all"
            style={{
              background: parallelMode ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
              border: `1px solid ${parallelMode ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
              color: parallelMode ? "oklch(0.68 0.22 285)" : "var(--c-t4)",
              cursor: "pointer",
            }}
          >
            <Layers style={{ width: 10, height: 10 }} />
            {parallelMode ? "关闭" : "并行对比"}
          </button>
        </div>

        {parallelMode && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <p style={{ fontSize: 10, color: "var(--c-t4)" }}>选择最多 3 个模型并行生成对比：</p>
            <div className="flex flex-col gap-1">
              {PROVIDERS.filter(p => p.value !== "mock").map((p) => {
                const checked = parallelProviders.includes(p.value);
                return (
                  <button
                    key={p.value}
                    onClick={() => {
                      if (checked) {
                        setParallelProviders(prev => prev.filter(v => v !== p.value));
                      } else if (parallelProviders.length < 3) {
                        setParallelProviders(prev => [...prev, p.value]);
                      }
                    }}
                    className="nodrag flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all text-left"
                    style={{
                      background: checked ? "oklch(0.68 0.22 285 / 0.10)" : "var(--c-input)",
                      border: `1px solid ${checked ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                      color: checked ? "oklch(0.75 0.15 285)" : "var(--c-t2)",
                      cursor: (!checked && parallelProviders.length >= 3) ? "not-allowed" : "pointer",
                      opacity: (!checked && parallelProviders.length >= 3) ? 0.5 : 1,
                    }}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      background: checked ? "oklch(0.68 0.22 285)" : "transparent",
                      border: `1.5px solid ${checked ? "oklch(0.68 0.22 285)" : "var(--c-bd3)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {checked && <span style={{ color: "white", fontSize: 9, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span>{p.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--c-t4)", background: "var(--c-surface)", borderRadius: 99, padding: "1px 5px" }}>{p.group}</span>
                    {parallelResults[p.value] && (
                      <span style={{
                        fontSize: 9, borderRadius: 99, padding: "1px 5px",
                        background: parallelResults[p.value].status === "done" ? "oklch(0.72 0.18 155 / 0.15)" : "oklch(0.68 0.22 285 / 0.12)",
                        color: parallelResults[p.value].status === "done" ? "oklch(0.65 0.18 155)" : "oklch(0.68 0.22 285)",
                      }}>
                        {parallelResults[p.value].status === "done" ? "完成" : parallelResults[p.value].status === "failed" ? "失败" : "生成中"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {parallelProviders.length > 0 && (
              <button
                onClick={() => {
                  if (createTaskMutation.isPending) return;
                  if (!(payload.prompt?.trim())) { toast.error("请先填写提示词"); return; }
                  // Block submit if any selected parallel provider requires a reference image but none is set
                  if (!payload.referenceImageUrl?.trim() && parallelProviders.some((p) => REQUIRES_REFERENCE_IMAGE.has(p))) {
                    toast.error("已选择的图生视频模型需要参考图 URL"); return;
                  }
                  toast.info(`正在并行提交 ${parallelProviders.length} 个任务...`);
                  // Capture generation token for this batch — per-mutate callbacks compare against
                  // the latest token and no-op if the user has closed parallel mode since
                  const gen = parallelGenRef.current;
                  // Increment counter ONCE per mutate call so global onSuccess/onError can correctly suppress payload writes
                  parallelInFlightRef.current += parallelProviders.length;
                  parallelProviders.forEach(provider => {
                    setParallelResults(prev => ({ ...prev, [provider]: { status: "processing" } }));
                    createTaskMutation.mutate(
                      // Send only prompt/negative/refImage in parallel mode — per-provider params
                      // diverge enough that sharing one params bag tends to break some providers
                      { nodeId: id, projectId: data.projectId, provider, prompt: payload.prompt!, negativePrompt: payload.negativePrompt, referenceImageUrl: payload.referenceImageUrl },
                      {
                        onSuccess: (result) => {
                          if (parallelGenRef.current !== gen) return; // stale — user closed parallel mode
                          setParallelResults(prev => ({ ...prev, [provider]: { status: "processing", taskId: result.id } }));
                        },
                        onError: (err) => {
                          if (parallelGenRef.current !== gen) return; // stale — user closed parallel mode
                          setParallelResults(prev => ({ ...prev, [provider]: { status: "failed" } }));
                          toast.error(`${provider} 失败: ${err.message}`);
                        },
                      }
                    );
                  });
                }}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "oklch(0.68 0.22 285 / 0.12)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  color: "oklch(0.72 0.18 285)",
                  cursor: "pointer",
                }}
              >
                <Play style={{ width: 11, height: 11 }} />
                并行生成 {parallelProviders.length} 个模型
              </button>
            )}
            {/* Parallel results grid */}
            {Object.keys(parallelResults).length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>对比结果</span>
                <div className="flex gap-1.5">
                  {Object.entries(parallelResults).map(([provider, result]) => (
                    <div
                      key={provider}
                      className="flex-1 rounded-lg overflow-hidden"
                      style={{
                        minWidth: 0,
                        background: "var(--c-input)",
                        border: `1px solid ${result.status === "done" ? "oklch(0.65 0.18 155 / 0.35)" : "var(--c-bd2)"}`,
                      }}
                    >
                      {result.status === "done" && isSafeMediaUrl(result.videoUrl) ? (
                        <video
                          src={result.videoUrl!.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(result.videoUrl!)}` : result.videoUrl}
                          controls
                          className="w-full nodrag"
                          style={{ maxHeight: 80, display: "block" }}
                        />
                      ) : (
                        <div className="flex items-center justify-center" style={{ height: 60 }}>
                          {result.status === "processing" ? (
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "oklch(0.68 0.22 285)" }} />
                          ) : (
                            <XCircle className="w-4 h-4" style={{ color: "oklch(0.62 0.20 25)" }} />
                          )}
                        </div>
                      )}
                      <div className="px-1.5 py-1">
                        <p style={{ fontSize: 9, color: "var(--c-t3)", textAlign: "center" }}>
                          {PROVIDERS.find(p => p.value === provider)?.label ?? provider}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Provider ── */}
        <div style={{ marginTop: 4 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>视频模型</label>
            {PROVIDER_COST[payload.provider] && (
              <span
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  padding: "1px 6px", borderRadius: 99,
                  background: `${PROVIDER_COST[payload.provider].color}18`,
                  border: `1px solid ${PROVIDER_COST[payload.provider].color}30`,
                  color: PROVIDER_COST[payload.provider].color,
                }}
              >
                {PROVIDER_COST[payload.provider].label}
              </span>
            )}
          </div>
          {/* Legacy migration: some historical providers (hf_dop_preview / hf_kling_* /
              hf_seedance_*) were removed when Higgsfield video API was rewritten. If a
              stored node still has one of those values, render a deprecation notice and
              keep an inert option in the dropdown so the <select> isn't blank. */}
          {!PROVIDERS.some((p) => p.value === payload.provider) && (
            <div style={{
              marginBottom: 6, padding: "6px 10px", fontSize: 11, lineHeight: 1.5,
              color: "oklch(0.75 0.18 25)", background: "oklch(0.62 0.20 25 / 0.10)",
              border: "1px solid oklch(0.62 0.20 25 / 0.30)", borderRadius: 6,
            }}>
              ⚠️ 当前模型 <code style={{ fontFamily: "monospace" }}>{payload.provider}</code> 已下线（Higgsfield 公共 API 不再支持）。请重新选择。
            </div>
          )}
          <select
            value={payload.provider}
            onChange={(e) => {
              updateNodeData(id, { provider: e.target.value as VideoProvider, params: {} });
            }}
            disabled={isLocked}
            className="nodrag"
            style={{ ...fieldStyle, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusAccent}
            onBlur={onBlurDefault}
          >
            {/* Stub option so legacy provider value renders something instead of blank */}
            {!PROVIDERS.some((p) => p.value === payload.provider) && (
              <option value={payload.provider} disabled style={{ background: "var(--c-surface)" }}>
                ⚠ 已下线: {payload.provider}
              </option>
            )}
            {["Poyo", "Higgsfield", "Dev"].map((group) => (
              <optgroup key={group} label={`── ${group} ──`} style={{ background: "var(--c-surface)" }}>
                {PROVIDERS.filter((p) => p.group === group).map((p) => (
                  <option key={p.value} value={p.value} style={{ background: "var(--c-surface)" }}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea
            placeholder="视频生成提示词..."
            value={payload.prompt ?? ""}
            onChange={(e) => handleChange("prompt", e.target.value)}
            rows={3}
            disabled={isLocked}
            className="nodrag"
            style={{ ...fieldStyle, resize: "none", lineHeight: 1.65, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusAccent}
            onBlur={onBlurDefault}
          />
        </div>

        {/* ── Negative prompt (for models that support it) ── */}
        {SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) && (
          <div>
            <label style={labelStyle}>反向提示词（可选）</label>
            <input
              placeholder="blurry, low quality..."
              value={payload.negativePrompt ?? ""}
              onChange={(e) => handleChange("negativePrompt", e.target.value)}
              disabled={isLocked}
              className="nodrag"
              style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
              onFocus={onFocusMid}
              onBlur={onBlurDefault}
            />
          </div>
        )}

        {/* ── Reference image URL (for all models) ── */}
        <div>
          <label style={labelStyle}>参考图 URL（可选）</label>
          <input
            placeholder="https://..."
            value={payload.referenceImageUrl ?? ""}
            onChange={(e) => handleChange("referenceImageUrl", e.target.value)}
            disabled={isLocked}
            className="nodrag"
            style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusMid}
            onBlur={onBlurDefault}
          />
        </div>

        {/* ── Dynamic model-specific params ── */}
        {paramDefs.length > 0 && (
          <div
            className="rounded-xl"
            style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)" }}
          >
            {/* Collapsible header */}
            <button
              onClick={() => setParamsExpanded((v) => !v)}
              className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
              style={{ cursor: "pointer", background: "transparent" }}
            >
              <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
                模型参数
              </span>
              {paramsExpanded
                ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
                : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              }
            </button>
            {/* 2-column grid for compact layout */}
            {paramsExpanded && <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 px-3 pb-3">
            {paramDefs.map((def) => {
              const curVal = params[def.key] ?? def.default;
              // toggle spans full width for readability
              const isToggle = def.type === "toggle";
              if (def.type === "select") {
                return (
                  <div key={def.key} className={isToggle ? "col-span-2" : ""}>
                    <label style={labelStyle}>{def.label}</label>
                    <select
                      value={String(curVal ?? "")}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = Number(raw);
                        handleParamChange(def.key, isNaN(num) || raw === "" ? raw : num);
                      }}
                      disabled={isLocked}
                      className="nodrag"
                      style={{ ...fieldStyle, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}
                      onFocus={onFocusMid}
                      onBlur={onBlurDefault}
                    >
                      {def.options.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)} style={{ background: "var(--c-surface)" }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (def.type === "number") {
                return (
                  <div key={def.key}>
                    <label style={labelStyle}>{def.label}</label>
                    <input
                      type="number"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      placeholder={def.default !== undefined ? String(def.default) : ""}
                      value={curVal !== undefined ? String(curVal) : ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        handleParamChange(def.key, v);
                      }}
                      disabled={isLocked}
                      className="nodrag"
                      style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
                      onFocus={onFocusMid}
                      onBlur={onBlurDefault}
                    />
                  </div>
                );
              }
              if (def.type === "range") {
                const val = curVal !== undefined ? Number(curVal) : (def.default ?? def.min);
                const displayVal = def.unit === "s" ? `${val}秒` : def.key === "cfg_scale" ? val.toFixed(1) : String(val);
                return (
                  <div key={def.key} className="col-span-2">
                    <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>{def.label}</label>
                      <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{displayVal}</span>
                    </div>
                    <input
                      type="range"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={val}
                      onChange={(e) => handleParamChange(def.key, Number(e.target.value))}
                      disabled={isLocked}
                      className="nodrag w-full"
                      style={{ accentColor: accentColor, opacity: isLocked ? 0.5 : 1 }}
                    />
                  </div>
                );
              }
              if (def.type === "toggle") {
                const checked = curVal === true || curVal === "true";
                return (
                  <div key={def.key} className="col-span-2 flex items-center justify-between py-0.5">
                    <label style={{ ...labelStyle, marginBottom: 0 }}>{def.label}</label>
                    <button
                      onClick={() => handleParamChange(def.key, !checked)}
                      disabled={isLocked}
                      className="nodrag relative flex-shrink-0"
                      style={{
                        width: 32, height: 18, borderRadius: 9,
                        background: checked ? "oklch(0.62 0.20 25 / 0.7)" : "var(--c-bd1)",
                        borderWidth: 1, borderStyle: "solid",
                        borderColor: checked ? "oklch(0.62 0.20 25 / 0.5)" : "var(--c-bd3)",
                        cursor: isLocked ? "not-allowed" : "pointer",
                        transition: "background 150ms ease, border-color 150ms ease",
                        opacity: isLocked ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute", top: 2,
                          left: checked ? 14 : 2,
                          width: 12, height: 12, borderRadius: "50%",
                          background: "var(--c-t1)",
                          transition: "left 150ms ease",
                        }}
                      />
                    </button>
                  </div>
                );
              }
              return null;
            })}
            </div>}{/* end grid */}
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-2 flex-shrink-0">
          {isResettable && (
            <button
              onClick={handleReset}
              disabled={resetTaskMutation.isPending}
              className="nodrag flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: "var(--c-surface)",
                borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)",
                color: resetTaskMutation.isPending ? "var(--c-t4)" : "var(--c-t2)",
                cursor: resetTaskMutation.isPending ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => { if (!resetTaskMutation.isPending) (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
              title="重置后可修改参数重新生成"
            >
              {resetTaskMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              重置
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={isLocked || isResettable || createTaskMutation.isPending}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: isLocked || isResettable || createTaskMutation.isPending
                ? "var(--c-surface)"
                : "oklch(0.62 0.20 25 / 0.15)",
              borderWidth: 1, borderStyle: "solid",
              borderColor: isLocked || isResettable || createTaskMutation.isPending
                ? BORDER_DEFAULT
                : "oklch(0.62 0.20 25 / 0.4)",
              color: isLocked || isResettable || createTaskMutation.isPending
                ? "var(--c-t4)"
                : accentColor,
              cursor: isLocked || isResettable || createTaskMutation.isPending ? "not-allowed" : "pointer",
            }}
            title={isResettable ? "请先点击「重置」再重新提交" : ""}
          >
            {createTaskMutation.isPending || payload.status === "processing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {payload.status === "processing" ? "生成中..." : "提交任务"}
          </button>
        </div>

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Input handle — target/square = receives image from ImageGenNode */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image-in"
        style={{
          width: 12, height: 12,
          borderRadius: 3,
          background: "oklch(0.68 0.22 285 / 0.85)",
          border: "2px solid var(--c-canvas)",
          left: -6,
          top: "25%",
        }}
        title="参考图输入 ← 连接图像生成节点"
      />
    </BaseNode>
  );
});
