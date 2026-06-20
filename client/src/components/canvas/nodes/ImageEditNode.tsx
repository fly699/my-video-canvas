import { memo, useCallback, useMemo } from "react";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { safeHref } from "@/lib/safeUrl";
import { ZoomableImage } from "../ZoomableImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { getNodeImageOutput } from "@/lib/canvasPassthrough";
import type { ImageEditNodeData, ImageEditOp } from "../../../../../shared/types";
import { IMAGE_EDIT_OPS, IMAGE_EDIT_MODEL_GROUPS, getImageEditOp, buildImageEditInstruction, comfyTemplateForOp, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Download, RotateCcw, Sparkles, Scissors, Maximize, Brush, Eraser, Lightbulb, Crop, Cloud, Cpu, type LucideIcon } from "lucide-react";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { HideWhenStudioFloating } from "../../../contexts/StudioFloatingContext";
import { MaskCanvas } from "./MaskCanvas";

const OP_ICONS: Record<string, LucideIcon> = { Scissors, Maximize, Brush, Eraser, Lightbulb, Crop };

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "image_edit";
    title: string;
    payload: ImageEditNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.70 0.17 145)";
const accentA = (a: number) => `oklch(0.70 0.17 145 / ${a})`;
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

const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];

export const ImageEditNode = memo(function ImageEditNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const update = useCallback((patch: Partial<ImageEditNodeData>) => updateNodeData(id, patch), [id, updateNodeData]);

  const operation: ImageEditOp = payload.operation ?? "remove_bg";
  const opSpec = getImageEditOp(operation) ?? IMAGE_EDIT_OPS[0];

  // Source image: auto-detected from the first connected upstream image node.
  const sourceImageUrl = useMemo(() => {
    const inEdges = edges.filter((e) => e.target === id);
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      const url = getNodeImageOutput(src.data.nodeType, src.data.payload as Record<string, unknown>);
      if (url) return url;
    }
    return undefined;
  }, [edges, nodes, id]);

  const backend: "cloud" | "comfyui" = payload.backend ?? "cloud";
  const srcUrl = payload.sourceImageUrl?.trim() || sourceImageUrl;

  const onResult = useCallback((url?: string) => {
    if (!url) { update({ status: "failed", errorMessage: "未返回结果图像" }); toast.error("编辑失败：未返回图像"); return; }
    update({ outputUrl: url, status: "done", errorMessage: undefined });
    propagateRefImage(id, url);
    toast.success("图像编辑完成");
  }, [id, update]);
  const onFail = useCallback((msg: string) => { update({ status: "failed", errorMessage: msg }); toast.error("编辑失败：" + msg); }, [update]);

  const editMutation = trpc.imageEdit.run.useMutation({
    onSuccess: (result) => onResult(result.url),
    onError: (err) => onFail(err.message),
  });
  const comfyMutation = trpc.comfyui.generateImage.useMutation({
    onSuccess: (result) => onResult(result.url),
    onError: (err) => onFail(err.message),
  });
  // Mask painter → upload → maskUrl (comfyui inpaint needs a real mask).
  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => update({ maskUrl: result.url }),
    onError: (err) => toast.error("蒙版上传失败：" + err.message),
  });

  const isProcessing = payload.status === "processing" || editMutation.isPending || comfyMutation.isPending;

  const handleRun = () => {
    if (editMutation.isPending || comfyMutation.isPending) return;
    if (!srcUrl) { toast.error("请先连接上游图像节点，或填写源图 URL"); return; }
    const prompt = payload.prompt?.trim() ?? "";
    if (opSpec.needsPrompt && !prompt) { toast.error(`「${opSpec.label}」需要填写说明`); return; }
    if (prompt.length > 1000) { toast.error("说明上限 1000 字，请截断"); return; }

    if (backend === "comfyui") {
      const ckpt = payload.ckpt?.trim();
      if (!ckpt) { toast.error("ComfyUI 后端需填写 checkpoint 模型名"); return; }
      const template = comfyTemplateForOp(operation, !!payload.maskUrl?.trim());
      if (template === "inpaint" && !payload.maskUrl?.trim()) { toast.error("局部重绘/擦除请先涂抹蒙版"); return; }
      // Compose the edit instruction client-side (same builder the cloud route uses server-side).
      const instruction = buildImageEditInstruction(operation, prompt, opSpec.needsAspect ? payload.aspectRatio : undefined).slice(0, 2000);
      update({ status: "processing", errorMessage: undefined });
      comfyMutation.mutate({
        nodeId: id,
        projectId: data.projectId,
        ...(payload.comfyBaseUrl?.trim() ? { customBaseUrl: payload.comfyBaseUrl.trim() } : {}),
        workflowTemplate: template,
        prompt: instruction || "edit",
        ckpt,
        referenceImageUrl: srcUrl,
        ...(template === "inpaint" ? { maskUrl: payload.maskUrl!.trim() } : { denoise: comfyDenoiseForOp(operation) }),
      });
      return;
    }

    // cloud backend (Higgsfield / KIE / Poyo edit models)
    update({ status: "processing", errorMessage: undefined });
    editMutation.mutate({
      sourceImageUrl: srcUrl,
      operation,
      ...(payload.model ? { model: payload.model } : {}),
      ...(prompt ? { prompt } : {}),
      ...(opSpec.needsAspect && payload.aspectRatio ? { aspectRatio: payload.aspectRatio } : {}),
      ...(payload.maskUrl?.trim() ? { maskUrl: payload.maskUrl.trim() } : {}),
      ...(data.projectId ? { projectId: data.projectId } : {}),
    });
  };

  const exportMask = useCallback((dataUrl: string) => {
    if (!dataUrl) { update({ maskUrl: undefined }); return; }
    const base64 = dataUrl.split(",")[1];
    if (base64) uploadMutation.mutate({ base64, mimeType: "image/png", filename: "image-edit-mask.png" });
  }, [update, uploadMutation]);

  return (
    <BaseNode id={id} selected={selected} nodeType="image_edit" title={data.title} minHeight={220} resizable
      onRun={handleRun} running={isProcessing} canRun={!!srcUrl} hasResult={!!payload.outputUrl}
      heroMedia={payload.outputUrl ? <img src={payload.outputUrl} alt="编辑结果" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} /> : undefined}
      onAssetImageDrop={(urls) => update({ sourceImageUrl: urls[0] })}>

      <div className="flex flex-col gap-3 p-3.5">

        {/* Operation picker */}
        <div>
          <label style={labelStyle}>操作</label>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {IMAGE_EDIT_OPS.map((op) => {
              const active = op.id === operation;
              const I = OP_ICONS[op.icon] ?? Sparkles;
              return (
                <button key={op.id} onClick={() => update({ operation: op.id })}
                  title={op.desc}
                  className="nodrag flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all"
                  style={{
                    background: active ? accentA(0.16) : "var(--c-input)",
                    border: active ? `1.5px solid ${accentA(0.5)}` : "1px solid var(--c-bd1)",
                    color: active ? accent : "var(--c-t3)", cursor: "pointer",
                  }}>
                  <I style={{ width: 11, height: 11, flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 400, lineHeight: 1.2 }}>{op.label}</span>
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: "5px 0 0" }}>{opSpec.desc}</p>
        </div>

        {/* Backend toggle: cloud edit models vs. local ComfyUI */}
        <div>
          <label style={labelStyle}>后端</label>
          <div className="flex gap-1.5">
            {([["cloud", "云端一键", Cloud], ["comfyui", "本地 ComfyUI", Cpu]] as const).map(([val, lbl, Icon]) => {
              const active = backend === val;
              return (
                <button key={val} onClick={() => update({ backend: val })}
                  className="nodrag flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10.5px] font-medium transition-all"
                  style={{
                    background: active ? accentA(0.16) : "var(--c-input)",
                    border: active ? `1.5px solid ${accentA(0.5)}` : "1px solid var(--c-bd1)",
                    color: active ? accent : "var(--c-t4)", cursor: "pointer",
                  }}>
                  <Icon style={{ width: 11, height: 11 }} /> {lbl}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status / error */}
        {isProcessing && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>图像编辑生成中...</span>
          </div>
        )}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <p className="text-xs" style={{ color: "oklch(0.62 0.20 25)" }}>{payload.errorMessage}</p>
          </div>
        )}

        {/* Source image */}
        <div>
          <label style={labelStyle}>源图 URL（自动从连接节点读取）</label>
          <NodeInput className="nodrag" placeholder="https://..." value={payload.sourceImageUrl ?? ""}
            onValueChange={(v) => update({ sourceImageUrl: v })} style={fieldStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
        </div>
        {(payload.sourceImageUrl || sourceImageUrl) && (
          <ZoomableImage src={(payload.sourceImageUrl || sourceImageUrl)!} alt="源图" maxHeight={150} border={`1px solid ${accentA(0.3)}`} />
        )}

        {/* Model (provider-grouped = the three cloud backends) */}
        {backend === "cloud" && (
          <div>
            <label style={labelStyle}>编辑模型</label>
            <select className="nodrag" value={payload.model ?? ""} onChange={(e) => update({ model: e.target.value || undefined })}
              style={{ ...fieldStyle, cursor: "pointer" }}>
              <option value="">默认（Higgsfield · Flux Pro Kontext）</option>
              {IMAGE_EDIT_MODEL_GROUPS.map((g) => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {/* ComfyUI backend config */}
        {backend === "comfyui" && (
          <>
            <div>
              <label style={labelStyle}>ComfyUI 服务器 URL（留空用服务端默认）</label>
              <NodeInput className="nodrag" placeholder="http://127.0.0.1:8188" value={payload.comfyBaseUrl ?? ""}
                onValueChange={(v) => update({ comfyBaseUrl: v })} style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
            </div>
            <div>
              <label style={labelStyle}>Checkpoint 模型名（必填）</label>
              <NodeInput className="nodrag" placeholder="如 sd_xl_base_1.0.safetensors" value={payload.ckpt ?? ""}
                onValueChange={(v) => update({ ckpt: v })} style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }} />
            </div>
            <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
              本地后端：局部重绘/擦除走真·蒙版 inpaint；其余操作走 img2img 重绘（重打光/改比例等以指令引导）。
            </p>
          </>
        )}

        {/* Mask painter (inpaint / erase) — required for ComfyUI inpaint, optional context for cloud */}
        {(operation === "inpaint" || operation === "erase") && srcUrl && (
          <div>
            <label style={labelStyle}>蒙版（涂抹要编辑的区域）{backend === "comfyui" ? " *" : "（可选）"}</label>
            <MaskCanvas imageUrl={srcUrl} onExport={exportMask} accent={accent} />
            {payload.maskUrl && <p style={{ fontSize: 9.5, color: "oklch(0.65 0.18 145)", margin: "2px 0 0" }}>✓ 蒙版已就绪</p>}
            {uploadMutation.isPending && <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: "2px 0 0" }}>蒙版上传中…</p>}
          </div>
        )}

        {/* Aspect (outpaint / reframe) */}
        {opSpec.needsAspect && (
          <div>
            <label style={labelStyle}>目标画幅</label>
            <select className="nodrag" value={payload.aspectRatio ?? ""} onChange={(e) => update({ aspectRatio: e.target.value || undefined })}
              style={{ ...fieldStyle, cursor: "pointer" }}>
              <option value="">保持原比例（仅向外扩展）</option>
              {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}

        {/* Instruction */}
        <div>
          <label style={labelStyle}>{opSpec.needsPrompt ? "说明（必填）" : "说明（可选）"}</label>
          <NodeTextArea
            className="nodrag nowheel"
            placeholder={opSpec.promptPlaceholder}
            value={payload.prompt ?? ""}
            onValueChange={(v) => update({ prompt: v })}
            rows={2}
            style={{ ...fieldStyle, resize: "vertical" as const, lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Output — hidden in studio's floating panel (the node card hero already shows it) */}
        {payload.outputUrl && (
          <HideWhenStudioFloating>
          <div className="flex flex-col gap-1.5">
            <label style={labelStyle}>编辑结果</label>
            <div className="relative">
              <ZoomableImage src={payload.outputUrl} alt="编辑结果" maxHeight={200} border={`1px solid ${accentA(0.4)}`} />
              {isOwnStorageUrl(payload.outputUrl) && (
                <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
              )}
            </div>
            <a href={safeHref(payload.outputUrl)} target="_blank" rel="noreferrer"
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: accentA(0.08), border: `1px solid ${accentA(0.25)}`, color: accent, textDecoration: "none" }}>
              <Download style={{ width: 10, height: 10 }} /> 下载图像
            </a>
            <button onClick={() => update({ outputUrl: undefined, status: "idle", errorMessage: undefined })}
              disabled={isProcessing}
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}>
              <RotateCcw style={{ width: 9, height: 9 }} /> 重置
            </button>
          </div>
          </HideWhenStudioFloating>
        )}

        {/* Run */}
        <button onClick={handleRun} disabled={isProcessing}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: isProcessing ? "var(--c-surface)" : accentA(0.15), border: `1px solid ${isProcessing ? BORDER_DEFAULT : accentA(0.5)}`, color: isProcessing ? "var(--c-t4)" : accent, cursor: isProcessing ? "not-allowed" : "pointer" }}>
          {isProcessing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Sparkles style={{ width: 12, height: 12 }} />}
          {isProcessing ? "生成中..." : `运行 · ${opSpec.label}`}
        </button>

        <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
          云端一键（Higgsfield / KIE / Poyo）或本地 ComfyUI（inpaint / img2img）。结果自动入库并可下游直传。
        </p>
      </div>
    </BaseNode>
  );
});
