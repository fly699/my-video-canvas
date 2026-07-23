import { memo, useCallback, useMemo, useRef } from "react";
import { BaseNode } from "../BaseNode";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { safeHref } from "@/lib/safeUrl";
import { ZoomableImage } from "../ZoomableImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { getNodeImageOutput } from "@/lib/canvasPassthrough";
import type { ImageEditNodeData, ImageEditOp } from "../../../../../shared/types";
import { IMAGE_EDIT_OPS, IMAGE_EDIT_MODEL_GROUPS, getImageEditOp, buildImageEditInstruction, comfyTemplateForOp, comfyDenoiseForOp } from "../../../../../shared/imageEdit";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Download, RotateCcw, Sparkles, Scissors, Maximize, Brush, Eraser, Lightbulb, Crop, Cloud, Cpu, ArrowUp, SlidersHorizontal, Smile, Camera, type LucideIcon } from "lucide-react";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { HideWhenStudioFloating } from "../../../contexts/StudioFloatingContext";
import { MaskCanvas } from "./MaskCanvas";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { InlineGenBar } from "../InlineGenBar";
import { ToolChip } from "../InlineBarParts";
import { ModelPicker, type ModelPickerOption } from "../ModelPicker";
import { estimateImageCost, costEstimateLabel } from "../../../lib/costEstimate";
import { sourceAspectRatio } from "../../../lib/imageAspect";

// Edit-model options for the rich ModelPicker: provider-grouped + per-model 点数 label
// (via estimateImageCost, same as image-gen). Built once.
const IMAGE_EDIT_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认（Higgsfield · Flux Pro Kontext）", group: "默认", family: "默认" },
  ...IMAGE_EDIT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => {
    const c = estimateImageCost(m.value);
    return { value: m.value, label: m.label, group: g.label, family: g.label, costLabel: c ? costEstimateLabel(c) : undefined };
  })),
];

const OP_ICONS: Record<string, LucideIcon> = { Scissors, Maximize, Brush, Eraser, Lightbulb, Crop, Sparkles, Camera, Smile };

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
  const { updateNodeData, nodes, edges } = useCanvasStore(useShallow((s) => ({ updateNodeData: s.updateNodeData, nodes: s.nodes, edges: s.edges })));
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

  // 取消/放弃等待（对齐 #140/#143/合并节点）：云端编辑提交即计费、无法撤回；
  // 放弃 = 本地解锁、迟到结果不回填。
  const abandonedRef = useRef(false);
  const onResult = useCallback((url?: string) => {
    if (abandonedRef.current) return;
    if (!url) { update({ status: "failed", errorMessage: "未返回结果图像" }); toast.error("编辑失败：未返回图像"); return; }
    update({ outputUrl: url, status: "done", errorMessage: undefined });
    propagateRefImage(id, url);
    toast.success("图像编辑完成");
  }, [id, update]);
  const onFail = useCallback((msg: string) => {
    if (abandonedRef.current) return;
    update({ status: "failed", errorMessage: msg }); toast.error("编辑失败：" + msg);
  }, [update]);

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

  // 只看持久化 status——handleRun 两条分支都会同步先置 "processing"；并上 isPending
  // 会让「放弃等待」后节点解不开锁（请求仍在飞）。
  const isProcessing = payload.status === "processing";

  const abandonWait = () => {
    abandonedRef.current = true;
    update({ status: payload.outputUrl ? "done" : "idle", errorMessage: undefined });
    toast.info("已取消等待：节点已解锁。云端/ComfyUI 编辑仍在进行（费用照常发生），其结果不会回填本节点", { duration: 7000 });
  };

  const handleRun = () => {
    if (editMutation.isPending || comfyMutation.isPending) return;
    if (!srcUrl) { toast.error("请先连接上游图像节点，或填写源图 URL"); return; }
    const prompt = payload.prompt?.trim() ?? "";
    if (opSpec.needsPrompt && !prompt) { toast.error(`「${opSpec.label}」需要填写说明`); return; }
    if (prompt.length > 1000) { toast.error("说明上限 1000 字，请截断"); return; }
    abandonedRef.current = false; // 新一轮编辑：复位「放弃等待」标记

    if (backend === "comfyui") {
      const ckpt = payload.ckpt?.trim();
      if (!ckpt) { toast.error("ComfyUI 后端需填写 checkpoint 模型名"); return; }
      // 需蒙版的操作(局部重绘/擦除)在 comfyui 后端必须有蒙版，否则 comfyTemplateForOp
      // 会退回 img2img 整图重绘、静默丢失「局部/擦除」语义。按 opSpec.needsMask 拦截
      // （原来的 template==="inpaint" 守卫永不为真——无蒙版时 template 已是 img2img）。
      if (opSpec.needsMask && !payload.maskUrl?.trim()) { toast.error(`「${opSpec.label}」请先涂抹蒙版`); return; }
      const template = comfyTemplateForOp(operation, !!payload.maskUrl?.trim());
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
    void (async () => {
      // 改画幅类操作用用户选的目标比例；其余操作必须显式传源图比例——部分云端编辑模型
      // （如 kie 编辑系）未传比例时按各自默认枚举首位出图，原图画幅会被静默改掉。
      const aspect = opSpec.needsAspect ? payload.aspectRatio : await sourceAspectRatio(srcUrl);
      editMutation.mutate({
        sourceImageUrl: srcUrl,
        operation,
        ...(payload.model ? { model: payload.model } : {}),
        ...(prompt ? { prompt } : {}),
        ...(aspect ? { aspectRatio: aspect } : {}),
        ...(payload.maskUrl?.trim() ? { maskUrl: payload.maskUrl.trim() } : {}),
        ...(data.projectId ? { projectId: data.projectId } : {}),
      });
    })();
  };

  const exportMask = useCallback((dataUrl: string) => {
    if (!dataUrl) { update({ maskUrl: undefined }); return; }
    const base64 = dataUrl.split(",")[1];
    if (base64) uploadMutation.mutate({ base64, mimeType: "image/png", filename: "image-edit-mask.png" });
  }, [update, uploadMutation]);

  // ── #91 LibTV 化：配置分区抽成单一来源常量——非创意内联卡体（原样），创意模式
  //    卡体收干净、分区挂输入条与「高级」下浮面板（与图像/提示词/角色节点同范式）。 ──
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);

  const statusSection = (<>
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
  </>);

  const backendSection = (
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
  );

  const sourceSection = (<>
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
  </>);

  const modelSection = backend === "cloud" ? (
    <div>
      <label style={labelStyle}>编辑模型</label>
      <ModelPicker value={payload.model ?? ""} onChange={(v) => update({ model: v || undefined })}
        options={IMAGE_EDIT_MODEL_OPTIONS} disabled={isProcessing} minWidth={260} accent={accent} />
    </div>
  ) : null;

  const comfySection = backend === "comfyui" ? (
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
  ) : null;

  const maskSection = (operation === "inpaint" || operation === "erase") && srcUrl ? (
    <div>
      <label style={labelStyle}>蒙版（涂抹要编辑的区域）{backend === "comfyui" ? " *" : "（可选）"}</label>
      <MaskCanvas imageUrl={srcUrl} onExport={exportMask} accent={accent} />
      {payload.maskUrl && <p style={{ fontSize: 9.5, color: "oklch(0.65 0.18 145)", margin: "2px 0 0" }}>✓ 蒙版已就绪</p>}
      {uploadMutation.isPending && <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: "2px 0 0" }}>蒙版上传中…</p>}
    </div>
  ) : null;

  const aspectSection = opSpec.needsAspect ? (
    <div>
      <label style={labelStyle}>目标画幅</label>
      <select className="nodrag" value={payload.aspectRatio ?? ""} onChange={(e) => update({ aspectRatio: e.target.value || undefined })}
        style={{ ...fieldStyle, cursor: "pointer" }}>
        <option value="">保持原比例（仅向外扩展）</option>
        {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  ) : null;

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="image_edit" title={data.title} minHeight={isCreativeMode ? 140 : 220} resizable
      onCancelGenerate={isProcessing ? abandonWait : undefined}
      onRun={handleRun} running={isProcessing} canRun={!!srcUrl} hasResult={!!payload.outputUrl}
      // 创意模式：无结果时用源图作 hero（卡体即「正在编辑的图」），有结果换结果图。
      heroMedia={(payload.outputUrl || (isCreativeMode ? srcUrl : undefined))
        ? <img src={(payload.outputUrl || srcUrl)!} alt={payload.outputUrl ? "编辑结果" : "源图"} style={{ width: "100%", height: "auto", display: "block" }} />
        : undefined}
      onAssetImageDrop={(urls) => update({ sourceImageUrl: urls[0] })}>

      <div className="flex flex-col gap-3 p-3.5">

        {statusSection}

        {/* #91 创意模式：配置全部移出卡体（输入条 + 高级下浮面板）；工作室/专业保持原内联表单 */}
        {!isCreativeMode && (<>

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

        {backendSection}
        {sourceSection}
        {modelSection}
        {comfySection}
        {maskSection}
        {aspectSection}

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
        </>)}

        {/* Output. In studio's floating panel the preview + download are hidden (the
            node card hero shows the result, the floating top bar provides download),
            but 重置 stays reachable since it has no other home there. */}
        {!isCreativeMode && payload.outputUrl && (
          <div className="flex flex-col gap-1.5">
            <HideWhenStudioFloating>
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
            </HideWhenStudioFloating>
            <button onClick={() => update({ outputUrl: undefined, status: "idle", errorMessage: undefined })}
              disabled={isProcessing}
              className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}>
              <RotateCcw style={{ width: 9, height: 9 }} /> 重置
            </button>
          </div>
        )}

        {/* Run（非创意；创意模式在输入条上运行） */}
        {!isCreativeMode && (<>
        <button onClick={isProcessing ? abandonWait : handleRun}
          title={isProcessing ? "放弃等待 / 取消（云端编辑无法撤回，费用照常发生，其结果不会回填）" : undefined}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={isProcessing
            ? { background: "oklch(0.62 0.20 25 / 0.12)", border: "1px solid oklch(0.62 0.20 25 / 0.4)", color: "oklch(0.62 0.20 25)", cursor: "pointer" }
            : { background: accentA(0.15), border: `1px solid ${accentA(0.5)}`, color: accent, cursor: "pointer" }}>
          {isProcessing ? <RotateCcw style={{ width: 12, height: 12 }} /> : <Sparkles style={{ width: 12, height: 12 }} />}
          {isProcessing ? "取消（生成中...）" : `运行 · ${opSpec.label}`}
        </button>

        <p style={{ fontSize: 9, color: "var(--c-t4)", lineHeight: 1.5, margin: 0 }}>
          云端一键（Higgsfield / KIE / Poyo）或本地 ComfyUI（inpaint / img2img）。结果自动入库并可下游直传。
        </p>
        </>)}
      </div>
    </BaseNode>

    {/* ── #91 LibTV（创意模式）就地输入条：操作 chips ‖ 说明大字 ‖ 模型 / 画幅 / 高级 / 运行 ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={500}>
        {/* Row1：编辑操作 chips（抠图/扩图/局部重绘/擦除/重打光/高清/多角度/改比例） */}
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {IMAGE_EDIT_OPS.map((op) => {
            const I = OP_ICONS[op.icon] ?? Sparkles;
            return (
              <ToolChip key={op.id} icon={<I size={12} />} label={op.label.split(" / ")[0]} active={op.id === operation}
                title={op.desc} onClick={() => update({ operation: op.id })} />
            );
          })}
        </div>
        {/* Row2：说明大字区 */}
        <NodeTextArea
          className="nodrag nowheel"
          rows={2}
          placeholder={opSpec.promptPlaceholder}
          value={payload.prompt ?? ""}
          onValueChange={(v) => update({ prompt: v })}
          style={{ width: "100%", resize: "none", fontSize: 13.5, lineHeight: 1.7, padding: "4px 6px", borderRadius: 8, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none", fontFamily: "inherit" }}
        />
        {/* Row3：控制行（模型 │ 目标画幅 · 高级 │ 运行） */}
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {backend === "cloud" ? (
            <ModelPicker value={payload.model ?? ""} onChange={(v) => update({ model: v || undefined })}
              options={IMAGE_EDIT_MODEL_OPTIONS} disabled={isProcessing} minWidth={150} accent={accent} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-t3)", whiteSpace: "nowrap" }}>本地 ComfyUI</span>
          )}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          {opSpec.needsAspect && (
            <select className="nodrag" value={payload.aspectRatio ?? ""} onChange={(e) => update({ aspectRatio: e.target.value || undefined })}
              title="目标画幅"
              style={{ height: 28, padding: "0 6px", fontSize: 11, borderRadius: 8, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", outline: "none" }}>
              <option value="">原比例</option>
              {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开参数面板（后端/源图/蒙版/画幅，浮现于输入条下方）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <SlidersHorizontal size={12} /> 高级
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); if (isProcessing) { abandonWait(); return; } if (srcUrl) handleRun(); }}
            disabled={!isProcessing && !srcUrl}
            title={isProcessing ? "放弃等待 / 取消（云端编辑无法撤回，其结果不会回填）" : !srcUrl ? "请先连接上游图像或在「高级」里填源图" : `运行 · ${opSpec.label}`}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: !isProcessing && !srcUrl ? "not-allowed" : "pointer", background: isProcessing ? "oklch(0.62 0.20 25 / 0.16)" : !srcUrl ? "var(--c-surface)" : "var(--ui-accent, var(--c-accent))", color: isProcessing ? "oklch(0.62 0.20 25)" : !srcUrl ? "var(--c-t4)" : "#0b0d12" }}
          >
            {isProcessing ? <RotateCcw size={14} /> : <ArrowUp size={15} />}
          </button>
        </div>
        {/* 参数下浮面板：后端 / 源图 / 模型（comfy 时的服务器与 ckpt）/ 蒙版 / 画幅 / 重置 */}
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {backendSection}
            {sourceSection}
            {comfySection}
            {maskSection}
            {aspectSection}
            {payload.outputUrl && (
              <button onClick={() => update({ outputUrl: undefined, status: "idle", errorMessage: undefined })}
                disabled={isProcessing}
                className="nodrag flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px]"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}>
                <RotateCcw style={{ width: 9, height: 9 }} /> 重置结果
              </button>
            )}
          </div>
        )}
      </InlineGenBar>
    )}
    </>
  );
});
