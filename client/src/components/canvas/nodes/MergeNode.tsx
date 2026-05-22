import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { MergeNodeData, MergeTransition } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Merge, Loader2, Download, RotateCcw, Music, ChevronDown } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "merge";
    title: string;
    payload: MergeNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.62 0.20 270)";
const accentA = (a: number) => `oklch(0.62 0.20 270 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
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
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
};

const TRANSITIONS: { value: MergeTransition; label: string }[] = [
  { value: "none",    label: "直切（无转场）" },
  { value: "fade",    label: "淡入淡出" },
  { value: "dissolve", label: "叠化溶解" },
];

export const MergeNode = memo(function MergeNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const [showBgMusic, setShowBgMusic] = useState(false);

  const mergeMutation = trpc.merge.mergeVideos.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, {
        outputUrl: result.url,
        outputDuration: result.duration,
        status: "done",
        errorMessage: undefined,
      });
      toast.success(`合并完成，总时长 ${result.duration.toFixed(1)}s`);
    },
    onError: (err) => {
      updateNodeData(id, { status: "failed", errorMessage: err.message });
      toast.error("合并失败：" + err.message);
    },
  });

  const update = (patch: Partial<MergeNodeData>) => updateNodeData(id, patch);

  // Collect video URLs from connected source nodes
  const collectInputUrls = (): string[] => {
    const incomingEdges = edges.filter((e) => e.target === id);
    const urls: string[] = [];
    for (const edge of incomingEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source);
      if (!srcNode) continue;
      const p = srcNode.data.payload as Record<string, unknown>;
      const url = (p.resultVideoUrl ?? p.outputUrl ?? p.url) as string | undefined;
      if (url) urls.push(url);
    }
    return urls;
  };

  const handleMerge = () => {
    const urls = payload.inputVideoUrls?.length
      ? payload.inputVideoUrls
      : collectInputUrls();

    if (urls.length < 2) {
      toast.error("至少需要 2 个已完成的视频节点输入，或手动填写视频 URL");
      return;
    }

    update({ status: "processing", errorMessage: undefined });
    mergeMutation.mutate({
      inputUrls: urls,
      transition: payload.transition,
      transitionDuration: payload.transitionDuration,
      bgMusicUrl: payload.bgMusicUrl || undefined,
      bgMusicVolume: payload.bgMusicVolume,
    });
  };

  const handleReset = () => {
    update({ outputUrl: undefined, outputDuration: undefined, status: "idle", errorMessage: undefined });
  };

  const isProcessing = payload.status === "processing" || mergeMutation.isPending;
  const isDone = payload.status === "done";
  const isFailed = payload.status === "failed";

  return (
    <BaseNode id={id} selected={selected} nodeType="merge" title={data.title} minHeight={200}>
      <Handle type="target" position={Position.Top} id="input" style={{ background: accent }} />

      <div className="flex flex-col gap-3 p-3.5">

        {/* Status */}
        {isProcessing && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>合并视频中...</span>
          </div>
        )}

        {isFailed && (
          <div className="flex flex-col gap-1 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <span className="text-xs font-medium" style={{ color: "oklch(0.62 0.20 25)" }}>合并失败</span>
            {payload.errorMessage && (
              <span className="text-[10px]" style={{ color: "var(--c-t3)" }}>{payload.errorMessage}</span>
            )}
          </div>
        )}

        {/* Output video */}
        {isDone && payload.outputUrl && (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <video
              key={payload.outputUrl}
              src={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}`}
              controls
              className="w-full rounded-lg nodrag"
              style={{ maxHeight: 140, display: "block", border: `1px solid ${accentA(0.4)}` }}
              preload="metadata"
            />
            <div className="flex gap-1.5">
              <a
                href={`/api/video-proxy?url=${encodeURIComponent(payload.outputUrl)}&download=1`}
                download
                className="nodrag flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium"
                style={{ background: accentA(0.10), border: `1px solid ${accentA(0.3)}`, color: accent, textDecoration: "none" }}
              >
                <Download style={{ width: 10, height: 10 }} />
                下载 ({payload.outputDuration?.toFixed(1) ?? "?"}s)
              </a>
              <button
                onClick={handleReset}
                className="nodrag flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px]"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
              >
                <RotateCcw style={{ width: 9, height: 9 }} />
                重置
              </button>
            </div>
          </div>
        )}

        {/* Manual URL input (optional) */}
        <div>
          <label style={labelStyle}>视频 URL（自动从连接节点读取，可手动覆盖）</label>
          <textarea
            className="nodrag"
            placeholder={"每行一个视频 URL\nhttps://...\nhttps://..."}
            value={(payload.inputVideoUrls ?? []).join("\n")}
            onChange={(e) => {
              const urls = e.target.value.split("\n").map((u) => u.trim()).filter(Boolean);
              update({ inputVideoUrls: urls });
            }}
            rows={3}
            style={{ ...fieldStyle, resize: "none", fontFamily: "monospace", fontSize: 10, lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Transition */}
        <div>
          <label style={labelStyle}>转场效果</label>
          <select
            value={payload.transition ?? "none"}
            onChange={(e) => update({ transition: e.target.value as MergeTransition })}
            className="nodrag"
            style={{ ...fieldStyle, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            {TRANSITIONS.map((t) => (
              <option key={t.value} value={t.value} style={{ background: "var(--c-base)" }}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Transition duration (only when not "none") */}
        {payload.transition !== "none" && payload.transition && (
          <div>
            <label style={labelStyle}>转场时长（秒）</label>
            <input
              type="number" min={0.1} max={2.0} step={0.1}
              value={payload.transitionDuration ?? 0.5}
              onChange={(e) => update({ transitionDuration: Number(e.target.value) })}
              className="nodrag"
              style={{ ...fieldStyle, width: 80 }}
            />
          </div>
        )}

        {/* Background music toggle */}
        <button
          onClick={() => setShowBgMusic((v) => !v)}
          className="nodrag flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs transition-all"
          style={{
            background: showBgMusic ? accentA(0.08) : "var(--c-surface)",
            border: `1px solid ${showBgMusic ? accentA(0.3) : "var(--c-bd2)"}`,
            color: showBgMusic ? accent : "var(--c-t3)",
            cursor: "pointer",
          }}
        >
          <span className="flex items-center gap-1.5">
            <Music style={{ width: 11, height: 11 }} />
            背景音乐叠加（可选）
          </span>
          <ChevronDown style={{ width: 11, height: 11, transform: showBgMusic ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
        </button>

        {showBgMusic && (
          <div className="flex flex-col gap-2">
            <div>
              <label style={labelStyle}>音频 URL</label>
              <input
                className="nodrag"
                placeholder="https://..."
                value={payload.bgMusicUrl ?? ""}
                onChange={(e) => update({ bgMusicUrl: e.target.value })}
                style={{ ...fieldStyle }}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>音量</label>
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{((payload.bgMusicVolume ?? 0.3) * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05}
                value={payload.bgMusicVolume ?? 0.3}
                onChange={(e) => update({ bgMusicVolume: Number(e.target.value) })}
                className="nodrag w-full"
                style={{ accentColor: accent }}
              />
            </div>
          </div>
        )}

        {/* Merge button */}
        <button
          onClick={handleMerge}
          disabled={isProcessing || isDone}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: isProcessing || isDone ? "var(--c-surface)" : accentA(0.15),
            border: `1px solid ${isProcessing || isDone ? BORDER_DEFAULT : accentA(0.5)}`,
            color: isProcessing || isDone ? "var(--c-t4)" : accent,
            cursor: isProcessing || isDone ? "not-allowed" : "pointer",
          }}
        >
          {isProcessing
            ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
            : <Merge style={{ width: 13, height: 13 }} />}
          {isProcessing ? "合并中..." : isDone ? "已完成（重置后可重新合并）" : "合并视频"}
        </button>

      </div>

      <Handle type="source" position={Position.Bottom} id="output" style={{ background: accent }} />
    </BaseNode>
  );
});
