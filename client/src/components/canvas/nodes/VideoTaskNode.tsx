import { memo, useCallback, useEffect, useRef } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { VideoTaskNodeData, VideoProvider } from "../../../../../shared/types";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Video,
  RefreshCw,
} from "lucide-react";

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

const STATUS_CONFIG = {
  pending: { icon: Clock, color: "text-muted-foreground", label: "待提交" },
  processing: { icon: Loader2, color: "text-[oklch(0.68_0.22_300)]", label: "生成中", spin: true },
  succeeded: { icon: CheckCircle2, color: "text-[oklch(0.65_0.20_160)]", label: "已完成" },
  failed: { icon: XCircle, color: "text-destructive", label: "失败" },
};

export const VideoTaskNode = memo(function VideoTaskNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createTaskMutation = trpc.videoTasks.create.useMutation({
    onSuccess: (task) => {
      updateNodeData(id, {
        status: "processing",
        taskId: task.id,
        externalTaskId: task.externalTaskId ?? undefined,
      });
      toast.success("视频任务已提交");
    },
    onError: (err) => toast.error("提交失败：" + err.message),
  });

  const pollQuery = trpc.videoTasks.poll.useQuery(
    { id: payload.taskId! },
    {
      enabled: false,
      refetchInterval: false,
    }
  );

  // Poll task status
  useEffect(() => {
    if (payload.status === "processing" && payload.taskId) {
      pollRef.current = setInterval(async () => {
        const result = await pollQuery.refetch();
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
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [payload.status, payload.taskId]);

  const handleChange = useCallback(
    (field: keyof VideoTaskNodeData, value: unknown) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleSubmit = () => {
    if (!payload.prompt?.trim()) {
      toast.error("请填写提示词");
      return;
    }
    createTaskMutation.mutate({
      projectId: data.projectId,
      nodeId: id,
      provider: payload.provider,
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      referenceImageUrl: payload.referenceImageUrl,
    });
  };

  const statusConfig = STATUS_CONFIG[payload.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;

  return (
    <BaseNode id={id} selected={selected} nodeType="video_task" title={data.title} minHeight={240}>
      <div className="flex flex-col h-full p-3 gap-2">
        {/* Status bar */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/20 border border-border/30">
          <StatusIcon
            className={`w-3.5 h-3.5 flex-shrink-0 ${statusConfig.color} ${
              (statusConfig as { spin?: boolean }).spin ? "animate-spin" : ""
            }`}
          />
          <span className={`text-xs font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
          {payload.status === "processing" && (
            <span className="ml-auto text-[10px] text-muted-foreground animate-pulse">轮询中...</span>
          )}
        </div>

        {/* Result video */}
        {payload.status === "succeeded" && payload.resultVideoUrl && (
          <div className="rounded-lg overflow-hidden border border-[oklch(0.65_0.20_160/0.4)]">
            <video
              src={payload.resultVideoUrl}
              controls
              className="w-full nodrag"
              style={{ maxHeight: 140 }}
            />
          </div>
        )}

        {/* Error */}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
            {payload.errorMessage}
          </div>
        )}

        {/* Provider */}
        <div className="flex gap-2">
          <Select
            value={payload.provider}
            onValueChange={(v) => handleChange("provider", v as VideoProvider)}
            disabled={payload.status === "processing"}
          >
            <SelectTrigger className="h-7 text-xs bg-transparent border-border/40 nodrag">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="runway">Runway</SelectItem>
              <SelectItem value="kling">Kling (可灵)</SelectItem>
              <SelectItem value="mock">Mock (测试)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Prompt */}
        <Textarea
          placeholder="视频生成提示词..."
          value={payload.prompt ?? ""}
          onChange={(e) => handleChange("prompt", e.target.value)}
          className="resize-none text-xs bg-transparent border-border/40 focus:border-[oklch(0.62_0.20_25/0.6)] nodrag font-mono"
          rows={3}
          disabled={payload.status === "processing"}
        />

        <Input
          placeholder="反向提示词（可选）"
          value={payload.negativePrompt ?? ""}
          onChange={(e) => handleChange("negativePrompt", e.target.value)}
          className="h-7 text-xs bg-transparent border-border/40 nodrag"
          disabled={payload.status === "processing"}
        />

        <Input
          placeholder="参考图 URL（可选）"
          value={payload.referenceImageUrl ?? ""}
          onChange={(e) => handleChange("referenceImageUrl", e.target.value)}
          className="h-7 text-xs bg-transparent border-border/40 nodrag"
          disabled={payload.status === "processing"}
        />

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          {payload.status === "failed" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateNodeData(id, { status: "pending", errorMessage: undefined })}
              className="flex-1 h-7 text-xs gap-1.5 nodrag"
            >
              <RefreshCw className="w-3 h-3" />
              重置
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={
              payload.status === "processing" ||
              payload.status === "succeeded" ||
              createTaskMutation.isPending
            }
            className="flex-1 h-7 text-xs gap-1.5 bg-[oklch(0.62_0.20_25/0.2)] hover:bg-[oklch(0.62_0.20_25/0.3)] border border-[oklch(0.62_0.20_25/0.4)] text-[oklch(0.62_0.20_25)] nodrag"
            variant="ghost"
          >
            {createTaskMutation.isPending || payload.status === "processing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {payload.status === "processing" ? "生成中..." : "提交任务"}
          </Button>
        </div>
      </div>
    </BaseNode>
  );
});
