import { memo, useCallback, useMemo, useState } from "react";
import { BaseNode } from "../BaseNode";
import { InlineGenBar } from "../InlineGenBar";
import { SlidersHorizontal } from "lucide-react";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { safeHref } from "@/lib/safeUrl";
import { ZoomableImage } from "../ZoomableImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { getNodeImageOutput } from "@/lib/canvasPassthrough";
import type { PoseControlNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Layers, Loader2, Download, RotateCcw, PersonStanding } from "lucide-react";
import { PosePresetPicker } from "../PosePresetPicker";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { useSimpleRefStrip } from "../../../hooks/useSimpleRefStrip";
import { useNodeDocks } from "../../../hooks/useNodeDocks";
import { PromptDock } from "../PromptDock";

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
  const { updateNodeData, nodes, edges } = useCanvasStore(useShallow((s) => ({ updateNodeData: s.updateNodeData, nodes: s.nodes, edges: s.edges })));
  const payload = data.payload;

  const update = useCallback((patch: Partial<PoseControlNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const sourceImageUrl = useMemo(() => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      const p = src.data.payload as Record<string, unknown>;
      // getNodeImageOutput restricts assets to type==="image" and skips a video-output
      // comfyui_workflow — so a connected video/audio asset is never read as the image.
      const url = getNodeImageOutput(src.data.nodeType, p);
      if (url) return url;
    }
    return undefined;
  }, [edges, nodes, id]);

  const poseControlMutation = trpc.clip.poseControl.useMutation({
    onSuccess: (result) => {
      update({ outputImageUrl: result.url, outputUrl: result.url, status: "done" });
      // Auto-fill any already-connected downstream reference-image targets.
      propagateRefImage(id, result.url);
      toast.success("构图控制图像已生成");
    },
    onError: (err) => { update({ status: "failed", errorMessage: err.message }); toast.error("生成失败：" + err.message); },
  });

  const handleRun = () => {
    if (poseControlMutation.isPending) return;
    const refUrl = payload.referenceImageUrl || sourceImageUrl;
    if (!refUrl) { toast.error("请先连接图像节点或填写参考图 URL"); return; }
    if (!payload.prompt?.trim()) { toast.error("请填写图像描述提示词"); return; }
    if (payload.prompt.trim().length > 1000) { toast.error("提示词上限 1000 字，请截断"); return; } // server max(1000)
    update({ status: "processing", errorMessage: undefined });
    poseControlMutation.mutate({
      referenceImageUrl: refUrl,
      prompt: payload.prompt.trim(),
      guidanceScale: payload.guidanceScale,
    });
  };

  const isProcessing = payload.status === "processing" || poseControlMutation.isPending;

  // 统一吸附窗：左侧参考构图（单张）+ 顶部「最终提示词」（本地图像描述）。无按钮：悬停标题栏
  // 1 秒临时展开，点击吸附窗钉住。
  // hasRef 纳入上游自动探测的 sourceImageUrl（运行时 refUrl = referenceImageUrl || sourceImageUrl）：
  // 仅连线未手填 URL 时吸附窗也能显示参考图。
  const docks = useNodeDocks(id, { hasRef: !!(payload.referenceImageUrl?.trim() || sourceImageUrl), hasPrompt: !!payload.prompt?.trim() }, { prompt: payload.prompt ?? "", ref: payload.referenceImageUrl || sourceImageUrl || "" });
  const refStrip = useSimpleRefStrip(id, payload, "single", { accent, open: docks.refOpen, onOpenChange: docks.setRefOpen, onHoverChange: docks.onDockHoverChange, onPin: docks.pinRef });

  // #100 姿势库：导演台 22 款预设 → 3D 摆姿截图作参考构图。
  const [posePickerOpen, setPosePickerOpen] = useState(false);
  // #97 LibTV：创意模式参数下浮（高级机制，快捷键 A）。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);
  // 配置区单一来源：非创意内联卡体（原样）；创意模式挂输入条「参数与操作」下浮面板。
  const configBody = (
    <>
        {/* Reference image */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>参考构图图像 URL（自动从连接节点读取）</label>
            <button onClick={() => setPosePickerOpen(true)}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all flex-shrink-0"
              title="从导演台姿势库选姿势：3D 人偶摆姿 + 拖拽换角度 → 截图作参考构图"
              style={{ background: accentA(0.12), border: `1px solid ${accentA(0.4)}`, color: accent, cursor: "pointer" }}>
              <PersonStanding style={{ width: 11, height: 11 }} /> 姿势库
            </button>
          </div>
          <NodeInput className="nodrag" placeholder="https://..." value={payload.referenceImageUrl ?? ""}
            onValueChange={(v) => update({ referenceImageUrl: v })} style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
        </div>

        {/* Reference image preview */}
        {(payload.referenceImageUrl || sourceImageUrl) && (
          <ZoomableImage src={(payload.referenceImageUrl || sourceImageUrl)!} alt="参考构图" maxHeight={160} border={`1px solid ${accentA(0.3)}`} />
        )}

        {/* Prompt */}
        <div>
          <label style={labelStyle}>图像描述提示词（英文效果更佳）</label>
          <NodeTextArea
            className="nodrag nowheel"
            placeholder="Describe the new image content while maintaining the reference composition..."
            value={payload.prompt ?? ""}
            onValueChange={(v) => update({ prompt: v })}
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
    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="pose_control" title={data.title} minHeight={200} resizable
      onAssetImageDrop={(urls) => update({ referenceImageUrl: urls[0] })}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <>
          {refStrip.strip}
          <PromptDock
            open={docks.promptOpen}
            text={payload.prompt ?? ""}
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }>

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

        {!isCreativeMode && configBody}

        {/* Output image */}
        {payload.outputImageUrl && (
          <div className="flex flex-col gap-1.5">
            <label style={labelStyle}>生成结果</label>
            <div className="relative">
              <ZoomableImage src={payload.outputImageUrl} alt="生成结果" maxHeight={200} border={`1px solid ${accentA(0.4)}`} />
              {isOwnStorageUrl(payload.outputImageUrl) && (
                <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
              )}
            </div>
            <a href={safeHref(payload.outputImageUrl)} target="_blank" rel="noreferrer"
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}>
              <Download style={{ width: 10, height: 10 }} /> 下载图像
            </a>
            <button onClick={() => update({ outputImageUrl: undefined, outputUrl: undefined, status: "idle", errorMessage: undefined })}
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

    </BaseNode>
    {/* ── #97 LibTV（创意模式）就地输入条：参数与操作下浮面板（屏幕恒定） ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={440}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)", whiteSpace: "nowrap" }}>姿势控制</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>参考构图 / 描述 / 遵循强度（运行按钮在卡体常驻）</span>
          <button className="nodrag" onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开参数与操作面板（浮现于输入条下方，不撑开节点卡体）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            <SlidersHorizontal size={12} /> 参数与操作
          </button>
        </div>
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {configBody}
          </div>
        )}
      </InlineGenBar>
    )}
    {/* #100 姿势库选择器（portal 到 body，不受节点收缩/浮面板卸载影响） */}
    {posePickerOpen && (
      <PosePresetPicker
        onApply={(url) => update({ referenceImageUrl: url })}
        onClose={() => setPosePickerOpen(false)}
      />
    )}
    </>
  );
});
