import { memo, useCallback, useMemo } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PostProcessNodeData, PostProcessOp } from "../../../../../shared/types";
import { toast } from "sonner";
import { Wand2, ZoomIn, Film, Sparkles, Loader2, Download, ArrowRight } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "post_process";
    title: string;
    payload: PostProcessNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.65 0.18 190)";
const accentA = (a: number) => `oklch(0.65 0.18 190 / ${a})`;

const OPS: { value: PostProcessOp; label: string; icon: typeof ZoomIn; desc: string; inputType: "image" | "video" | "both" }[] = [
  { value: "upscale2x",  label: "超分 2×",   icon: ZoomIn,    desc: "图像分辨率提升 2 倍",     inputType: "image" },
  { value: "upscale4x",  label: "超分 4×",   icon: ZoomIn,    desc: "图像分辨率提升 4 倍",     inputType: "image" },
  { value: "denoise",    label: "降噪",       icon: Sparkles,  desc: "去除图像/视频噪点",       inputType: "both" },
  { value: "sharpen",    label: "锐化",       icon: Wand2,     desc: "增强边缘清晰度",         inputType: "both" },
  { value: "fps2x",      label: "插帧 2×",   icon: Film,      desc: "视频帧率提升 2 倍",       inputType: "video" },
];

export const PostProcessNode = memo(function PostProcessNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const op = payload.operation ?? "upscale2x";

  // Get upstream input from connected nodes
  const inputUrl = useCanvasStore(useMemo(() => (s: ReturnType<typeof useCanvasStore.getState>) => {
    const upstreamEdges = s.edges.filter(e => e.target === id);
    for (const edge of upstreamEdges) {
      const node = s.nodes.find(n => n.id === edge.source);
      if (!node) continue;
      const p = node.data.payload as Record<string, unknown>;
      if (p.resultVideoUrl) return { url: p.resultVideoUrl as string, type: "video" as const };
      if (p.imageUrl) return { url: p.imageUrl as string, type: "image" as const };
      if (p.url && (node.data.nodeType === "asset" || node.data.nodeType === "audio")) {
        const assetType = (p.type as string) ?? "image";
        if (assetType === "image" || assetType === "video") return { url: p.url as string, type: assetType as "image" | "video" };
      }
    }
    return null;
  }, [id]));

  const handleProcess = useCallback(() => {
    if (!inputUrl) { toast.error("请先连接上游图像或视频节点"); return; }
    const currentOp = OPS.find(o => o.value === op)!;
    if (currentOp.inputType === "image" && inputUrl.type !== "image") {
      toast.error("此操作仅支持图像输入"); return;
    }
    if (currentOp.inputType === "video" && inputUrl.type !== "video") {
      toast.error("此操作仅支持视频输入"); return;
    }
    updateNodeData(id, { status: "processing", inputImageUrl: inputUrl.type === "image" ? inputUrl.url : undefined, inputVideoUrl: inputUrl.type === "video" ? inputUrl.url : undefined });
    // Simulate processing (real implementation would call a backend API)
    setTimeout(() => {
      updateNodeData(id, { status: "done", outputUrl: inputUrl.url });
      toast.success(`${currentOp.label}处理完成`);
    }, 2000);
  }, [id, inputUrl, op, updateNodeData]);

  const handleDownload = () => {
    if (!payload.outputUrl) return;
    const a = document.createElement("a");
    a.href = payload.outputUrl;
    a.download = `processed-${op}-${Date.now()}.png`;
    a.click();
  };

  const selectedOp = OPS.find(o => o.value === op) ?? OPS[0];
  const isProcessing = payload.status === "processing";

  return (
    <BaseNode id={id} selected={selected} nodeType="post_process" title={data.title} minHeight={200} resizable>
      <div className="flex flex-col gap-3 p-3.5">

        {/* Operation selector */}
        <div className="flex flex-col gap-1">
          <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.42 0.008 260)", marginBottom: 4, display: "block" }}>
            处理操作
          </label>
          <div className="flex flex-wrap gap-1">
            {OPS.map((o) => {
              const Icon = o.icon;
              return (
                <button
                  key={o.value}
                  onClick={() => updateNodeData(id, { operation: o.value, status: "idle", outputUrl: undefined })}
                  className="nodrag flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all"
                  style={{
                    background: op === o.value ? accentA(0.15) : "oklch(0.09 0.006 260)",
                    border: `1px solid ${op === o.value ? accentA(0.40) : "oklch(0.20 0.008 260)"}`,
                    color: op === o.value ? accent : "oklch(0.50 0.008 260)",
                    fontWeight: op === o.value ? 600 : 400,
                    cursor: "pointer",
                  }}
                  title={o.desc}
                >
                  <Icon style={{ width: 10, height: 10 }} />
                  {o.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 10, color: "oklch(0.40 0.006 260)", marginTop: 2 }}>{selectedOp.desc}</p>
        </div>

        {/* Input preview */}
        <div
          className="rounded-lg overflow-hidden flex-shrink-0"
          style={{
            height: 80,
            background: "oklch(0.09 0.006 260)",
            border: `1px solid ${inputUrl ? accentA(0.25) : "oklch(0.18 0.008 260)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {inputUrl ? (
            inputUrl.type === "image" ? (
              <img src={payload.outputUrl ?? inputUrl.url} alt="input" className="w-full h-full object-cover" />
            ) : (
              <video src={payload.outputUrl ?? inputUrl.url} className="w-full nodrag" style={{ maxHeight: 80, display: "block" }} />
            )
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <ArrowRight style={{ width: 18, height: 18, color: "oklch(0.28 0.006 260)" }} />
              <span style={{ fontSize: 10, color: "oklch(0.35 0.006 260)" }}>连接上游图像或视频</span>
            </div>
          )}
        </div>

        {/* Process button */}
        <div className="flex gap-1.5">
          <button
            onClick={handleProcess}
            disabled={isProcessing || !inputUrl}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: isProcessing || !inputUrl ? "oklch(0.13 0.007 260)" : accentA(0.15),
              borderWidth: 1, borderStyle: "solid",
              borderColor: isProcessing || !inputUrl ? "oklch(0.22 0.008 260)" : accentA(0.4),
              color: isProcessing || !inputUrl ? "oklch(0.38 0.006 260)" : accent,
              cursor: isProcessing || !inputUrl ? "not-allowed" : "pointer",
            }}
          >
            {isProcessing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Wand2 style={{ width: 12, height: 12 }} />}
            {isProcessing ? "处理中..." : `执行${selectedOp.label}`}
          </button>
          {payload.outputUrl && payload.status === "done" && (
            <button
              onClick={handleDownload}
              className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
              style={{ background: accentA(0.10), border: `1px solid ${accentA(0.30)}`, color: accent, cursor: "pointer" }}
              title="下载结果"
            >
              <Download style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>

        {payload.status === "done" && (
          <p style={{ fontSize: 10, color: "oklch(0.60 0.15 155)", textAlign: "center" }}>✓ 处理完成</p>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <p style={{ fontSize: 10, color: "oklch(0.60 0.18 25)", textAlign: "center" }}>{payload.errorMessage}</p>
        )}
      </div>
    </BaseNode>
  );
});
