import { memo, useCallback, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PoseControlNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Layers, Loader2, Download, RotateCcw } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "pose_control";
    title: string;
    payload: PoseControlNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.20 310)";
const accentA = (a: number) => `oklch(0.65 0.20 310 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" as const,
  letterSpacing: "0.06em", color: "var(--c-t4)", display: "block", marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 12,
  background: "var(--c-input)", borderWidth: 1, borderStyle: "solid",
  borderColor: BORDER_DEFAULT, borderRadius: 8, color: "var(--c-t1)",
  outline: "none", transition: "border-color 150ms ease", lineHeight: 1.5,
};

export const PoseControlNode = memo(function PoseControlNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;

  const update = useCallback((patch: Partial<PoseControlNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const sourceImageUrl = useMemo(() => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      const p = src.data.payload as Record<string, unknown>;
      const url = (p.imageUrl ?? p.outputUrl ?? p.url) as string | undefined;
      if (url) return url;
    }
    return undefined;
  }, [edges, nodes, id]);

  const poseControlMutation = trpc.clip.poseControl.useMutation({
    onSuccess: (result) => {
      update({ outputImageUrl: result.url, status: "done" });
      toast.success("构图控制图像已生成");
    },
    onError: (err) => { update({ status: "failed", errorMessage: err.message }); toast.error("生成失败：" + err.message); },
  });

  const handleRun = () => {
    if (poseControlMutation.isPending) return;
    const refUrl = payload.referenceImageUrl || sourceImageUrl;
    if (!refUrl) { toast.error("请先连接图像节点或填写参考图 URL"); return; }
    if (!payload.prompt?.trim()) { toast.error("请填写图像描述提示词"); return; }
    update({ status: "processing", errorMessage: undefined });
    poseControlMutation.mutate({
      referenceImageUrl: refUrl,
      prompt: payload.prompt.trim(),
      guidanceScale: payload.guidanceScale,
    });
  };

  const isProcessing = payload.status === "processing" || poseControlMutation.isPending;

  return (
    <BaseNode id={id} selected={selected} nodeType="pose_control" title={data.title} minHeight={200} resizable showHandles={false}>
      <Handle type="target" position={Position.Top} id="input" style={{ background: accent }} />

      <div className="flex flex-col gap-3 p-3.5">

        {/* Status banner */}
        {isProcessing && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>Flux Pro Kontext 生成中...</span>
          </div>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <p className="text-xs" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {/* Reference image */}
        <div>
          <label style={labelStyle}>参考构图图像 URL（自动从连接节点读取）</label>
          <input className="nodrag" placeholder="https://..." value={payload.referenceImageUrl ?? ""}
            onChange={(e) => update({ referenceImageUrl: e.target.value })} style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
        </div>

        {/* Reference image preview */}
        {(payload.referenceImageUrl || sourceImageUrl) && (
          <img
            src={payload.referenceImageUrl || sourceImageUrl}
            alt="参考构图"
            className="w-full rounded-lg nodrag"
            style={{ maxHeight: 100, objectFit: "cover", border: `1px solid ${accentA(0.3)}` }}
          />
        )}

        {/* Prompt */}
        <div>
          <label style={labelStyle}>图像描述提示词（英文效果更佳）</label>
          <textarea
            className="nodrag"
            placeholder="Describe the new image content while maintaining the reference composition..."
            value={payload.prompt ?? ""}
            onChange={(e) => update({ prompt: e.target.value })}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical" as const, lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Guidance scale */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>参考强度</label>
            <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{payload.guidanceScale ?? 3.5}</span>
          </div>
          <input type="range" min={1} max={10} step={0.5} value={payload.guidanceScale ?? 3.5}
            onChange={(e) => update({ guidanceScale: Number(e.target.value) })}
            className="nodrag w-full" style={{ accentColor: accent }} />
          <div className="flex justify-between" style={{ fontSize: 9, color: "var(--c-t4)", marginTop: 2 }}>
            <span>自由创作</span><span>严格遵循</span>
          </div>
        </div>

        {/* Output image */}
        {payload.outputImageUrl && (
          <div className="flex flex-col gap-1.5">
            <label style={labelStyle}>生成结果</label>
            <img src={payload.outputImageUrl} alt="生成结果" className="w-full rounded-lg nodrag"
              style={{ maxHeight: 160, objectFit: "cover", border: `1px solid ${accentA(0.4)}` }} />
            <a href={payload.outputImageUrl} target="_blank" rel="noreferrer"
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}>
              <Download style={{ width: 10, height: 10 }} /> 下载图像
            </a>
            <button onClick={() => update({ outputImageUrl: undefined, status: "idle", errorMessage: undefined })}
              disabled={isProcessing}
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}>
              <RotateCcw style={{ width: 9, height: 9 }} /> 重置
            </button>
          </div>
        )}

        {/* Run button */}
        <button onClick={handleRun} disabled={isProcessing}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: isProcessing ? "var(--c-surface)" : accentA(0.15), border: `1px solid ${isProcessing ? BORDER_DEFAULT : accentA(0.5)}`, color: isProcessing ? "var(--c-t4)" : accent, cursor: isProcessing ? "not-allowed" : "pointer" }}>
          {isProcessing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Layers style={{ width: 12, height: 12 }} />}
          {isProcessing ? "Flux Pro Kontext 生成中..." : "生成保留构图的新图像"}
        </button>

        <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
          基于 Flux Pro Kontext，复用参考图构图，生成新内容图像
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} id="output" style={{ background: accent }} />
    </BaseNode>
  );
});
