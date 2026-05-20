import { memo, useCallback, useEffect, useRef } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { VideoTaskNodeData, VideoProvider } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle } from "lucide-react";

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
  pending:    { icon: Clock,         label: "待提交", accent: "oklch(0.50 0.008 260)", bg: "oklch(0.14 0.007 260)", borderColor: "oklch(0.22 0.008 260)" },
  processing: { icon: Loader2,       label: "生成中", accent: "oklch(0.68 0.22 285)",  bg: "oklch(0.68 0.22 285 / 0.08)", borderColor: "oklch(0.68 0.22 285 / 0.30)", spin: true },
  succeeded:  { icon: CheckCircle2,  label: "已完成", accent: "oklch(0.72 0.18 155)",  bg: "oklch(0.72 0.18 155 / 0.08)", borderColor: "oklch(0.72 0.18 155 / 0.30)" },
  failed:     { icon: XCircle,       label: "失败",   accent: "oklch(0.62 0.20 25)",   bg: "oklch(0.62 0.20 25 / 0.08)",  borderColor: "oklch(0.62 0.20 25 / 0.30)" },
} as const;

const PROVIDERS = [
  { value: "poyo_seedance", label: "Seedance 2 (Poyo)" },
  { value: "poyo_veo",      label: "Veo 3.1 (Poyo)" },
  { value: "runway",        label: "Runway Gen-3" },
  { value: "kling",         label: "Kling 可灵" },
  { value: "mock",          label: "Mock 测试" },
];

const BORDER_DEFAULT = "oklch(0.20 0.008 260)";

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  background: "oklch(0.09 0.006 260)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 6,
  color: "oklch(0.80 0.006 260)",
  outline: "none",
  transition: "border-color 120ms ease",
};

export const VideoTaskNode = memo(function VideoTaskNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accentColor = "oklch(0.62 0.20 25)";

  const createTaskMutation = trpc.videoTasks.create.useMutation({
    onSuccess: (task) => {
      updateNodeData(id, { status: "processing", taskId: task.id, externalTaskId: task.externalTaskId ?? undefined });
      toast.success("视频任务已提交");
    },
    onError: (err) => toast.error("提交失败：" + err.message),
  });

  const pollQuery = trpc.videoTasks.poll.useQuery({ id: payload.taskId! }, { enabled: false, refetchInterval: false });
  // Keep a stable ref so the interval callback always calls the latest refetch
  const pollQueryRef = useRef(pollQuery);
  pollQueryRef.current = pollQuery;

  useEffect(() => {
    if (payload.status === "processing" && payload.taskId) {
      pollRef.current = setInterval(async () => {
        try {
          const result = await pollQueryRef.current.refetch();
          if (result.error) throw result.error;
          if (result.data) {
            const task = result.data;
            if (task.status === "succeeded" || task.status === "failed") {
              updateNodeData(id, {
                status: task.status,
                resultVideoUrl: task.resultVideoUrl ?? undefined,
                errorMessage: task.errorMessage ?? undefined,
              });
              if (pollRef.current) clearInterval(pollRef.current);
            }
          }
        } catch (err) {
          updateNodeData(id, { status: "failed", errorMessage: String(err) });
          if (pollRef.current) clearInterval(pollRef.current);
          toast.error("轮询失败：" + String(err));
        }
      }, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // pollQueryRef is stable; id/updateNodeData are stable references
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.status, payload.taskId, id, updateNodeData]);

  const handleChange = useCallback(
    (field: keyof VideoTaskNodeData, value: unknown) => { updateNodeData(id, { [field]: value }); },
    [id, updateNodeData]
  );

  const handleSubmit = () => {
    if (!payload.prompt?.trim()) { toast.error("请填写提示词"); return; }
    createTaskMutation.mutate({
      projectId: data.projectId, nodeId: id,
      provider: payload.provider, prompt: payload.prompt,
      negativePrompt: payload.negativePrompt, referenceImageUrl: payload.referenceImageUrl,
    });
  };

  const status = STATUS[payload.status] ?? STATUS.pending;
  const StatusIcon = status.icon;
  const isLocked = payload.status === "processing" || payload.status === "succeeded";

  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = `${accentColor.slice(0, -1)} / 0.6)`; };
  const onFocusMid    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "oklch(0.40 0.008 260)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  return (
    <BaseNode id={id} selected={selected} nodeType="video_task" title={data.title} minHeight={240}>
      <div className="flex flex-col h-full p-2.5 gap-2">

        {/* ── Status pill ── */}
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
          style={{
            background: status.bg,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: status.borderColor,
          }}
        >
          <StatusIcon
            className={`w-3.5 h-3.5 flex-shrink-0 ${(status as { spin?: boolean }).spin ? "animate-spin" : ""}`}
            style={{ color: status.accent }}
          />
          <span className="text-xs font-medium" style={{ color: status.accent }}>{status.label}</span>
          {payload.status === "processing" && (
            <span className="ml-auto text-[10px] animate-pulse" style={{ color: "oklch(0.50 0.008 260)" }}>
              轮询中...
            </span>
          )}
          {payload.status === "succeeded" && (
            <span className="ml-auto text-[10px]" style={{ color: "oklch(0.45 0.008 260)" }}>
              生成完成
            </span>
          )}
        </div>

        {/* ── Result video ── */}
        {payload.status === "succeeded" && payload.resultVideoUrl && (
          <div
            className="rounded-lg overflow-hidden flex-shrink-0"
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: STATUS.succeeded.borderColor,
            }}
          >
            <video src={payload.resultVideoUrl} controls className="w-full nodrag" style={{ maxHeight: 140, display: "block" }} />
          </div>
        )}

        {/* ── Error ── */}
        {payload.status === "failed" && payload.errorMessage && (
          <div
            className="flex items-start gap-2 p-2 rounded-lg"
            style={{
              background: STATUS.failed.bg,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: STATUS.failed.borderColor,
            }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: STATUS.failed.accent }} />
            <p className="text-[11px] leading-relaxed" style={{ color: STATUS.failed.accent }}>{payload.errorMessage}</p>
          </div>
        )}

        {/* ── Provider ── */}
        <select
          value={payload.provider}
          onChange={(e) => handleChange("provider", e.target.value as VideoProvider)}
          disabled={isLocked}
          className="nodrag"
          style={{
            ...fieldStyle,
            cursor: isLocked ? "not-allowed" : "pointer",
            opacity: isLocked ? 0.5 : 1,
          }}
          onFocus={onFocusAccent}
          onBlur={onBlurDefault}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value} style={{ background: "oklch(0.12 0.007 260)" }}>
              {p.label}
            </option>
          ))}
        </select>

        {/* ── Prompt ── */}
        <textarea
          placeholder="视频生成提示词..."
          value={payload.prompt ?? ""}
          onChange={(e) => handleChange("prompt", e.target.value)}
          rows={3}
          disabled={isLocked}
          className="nodrag"
          style={{
            ...fieldStyle,
            resize: "none",
            lineHeight: 1.65,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            opacity: isLocked ? 0.5 : 1,
          }}
          onFocus={onFocusAccent}
          onBlur={onBlurDefault}
        />

        <input
          placeholder="反向提示词（可选）"
          value={payload.negativePrompt ?? ""}
          onChange={(e) => handleChange("negativePrompt", e.target.value)}
          disabled={isLocked}
          className="nodrag"
          style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
          onFocus={onFocusMid}
          onBlur={onBlurDefault}
        />

        <input
          placeholder="参考图 URL（可选）"
          value={payload.referenceImageUrl ?? ""}
          onChange={(e) => handleChange("referenceImageUrl", e.target.value)}
          disabled={isLocked}
          className="nodrag"
          style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
          onFocus={onFocusMid}
          onBlur={onBlurDefault}
        />

        {/* ── Actions ── */}
        <div className="flex gap-1.5 mt-auto">
          {payload.status === "failed" && (
            <button
              onClick={() => updateNodeData(id, { status: "pending", errorMessage: undefined })}
              className="nodrag flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: "oklch(0.14 0.007 260)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "oklch(0.22 0.008 260)",
                color: "oklch(0.60 0.008 260)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.14 0.007 260)"; }}
            >
              <RefreshCw className="w-3 h-3" />
              重置
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={isLocked || createTaskMutation.isPending}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: isLocked || createTaskMutation.isPending
                ? "oklch(0.13 0.007 260)"
                : `${accentColor.slice(0, -1)} / 0.15)`,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: isLocked || createTaskMutation.isPending
                ? BORDER_DEFAULT
                : `${accentColor.slice(0, -1)} / 0.4)`,
              color: isLocked || createTaskMutation.isPending
                ? "oklch(0.38 0.006 260)"
                : accentColor,
              cursor: isLocked || createTaskMutation.isPending ? "not-allowed" : "pointer",
            }}
          >
            {createTaskMutation.isPending || payload.status === "processing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {payload.status === "processing" ? "生成中..." : "提交任务"}
          </button>
        </div>
      </div>
    </BaseNode>
  );
});
