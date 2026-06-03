import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage, propagatePromptToVideo } from "../../../lib/refImagePropagation";
import { usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import type { ComfyuiImageNodeData, ComfyuiLoraEntry } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Download, ZoomIn,
  ChevronDown, ChevronRight, Server, Boxes, ImageIcon,
  Languages, Check, Copy, Lock, Unlock, Ban, Plus, Layers,
} from "lucide-react";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { downloadMedia } from "@/lib/download";
import { ImageLightbox } from "../ImageLightbox";
import { MaskCanvas } from "./MaskCanvas";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { makeImageProxyFallback } from "@/lib/utils";
import { ComfyServerUrlField } from "./ComfyServerUrlField";
import { SyncConfigDialog } from "../SyncConfigDialog";
import { NodeConfigTabs } from "../NodeConfigTabs";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "comfyui_image";
    title: string;
    payload: ComfyuiImageNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.68 0.20 100)";
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = `oklch(0.68 0.20 100 / 0.5)`;

const fieldBase: React.CSSProperties = {
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
  fontFamily: "var(--font-sans)",
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

export const ComfyuiImageNode = memo(function ComfyuiImageNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  // Auto-prefer the upstream AI temporary public URL as the reference source when
  // the admin toggle is on and that URL probes alive (no-op when off / default).
  const preferUpstreamRef = usePreferUpstreamRefSource();
  useAutoPreferUpstreamRefSource({ nodeId: id, refImageUrl: payload.referenceImageUrl, enabled: preferUpstreamRef, onSwitch: (u) => updateNodeData(id, { referenceImageUrl: u }, true) });
  // Diffusion architecture: classic SD (default) vs DiT (Flux/SD3/Qwen). New arch
  // ships as a standalone UNet + separate CLIP/VAE, so default modelSource=unet.
  const archVal = payload.arch ?? "sd";
  const modelSrc = payload.modelSource ?? (archVal === "sd" ? "checkpoint" : "unet");
  const [uploading, setUploading] = useState(false);
  // Controlled lightbox index (null = closed). Mirrors ImageGenNode so multi-image
  // navigation + selection inside the lightbox actually work.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refZoom, setRefZoom] = useState(false);
  // IPAdapter reference-image zoom (controlled index; null = closed).
  const [ipZoomIndex, setIpZoomIndex] = useState<number | null>(null);
  // Cursor-driven insertion indicator while dragging onto the IPAdapter grid.
  const [ipDragOver, setIpDragOver] = useState(false);
  const [translating, setTranslating] = useState(false);
  // Translation LLM — let the user pick a model that's available in their
  // deployment (some setups have no Gemini but do have Claude/GPT via Poyo).
  const [llmModel, setLlmModel] = useState<LLMModelId>("claude-haiku-4-5-20251001");
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [cfgTab, setCfgTab] = useState("basic");
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [cnExpanded, setCnExpanded] = useState(false);
  const [ipExpanded, setIpExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cnFileInputRef = useRef<HTMLInputElement>(null);
  const ipFileInputRef = useRef<HTMLInputElement>(null);

  // Pull ckpt/lora suggestions from ComfyUI via /object_info (best-effort, no-throw).
  // Debounce the URL so each keystroke in the COMFYUI_BASE_URL field doesn't
  // fire a fresh assertWhitelisted DB query + outbound HTTP probe.
  const [debouncedUrl, setDebouncedUrl] = useState(payload.customBaseUrl?.trim() || undefined);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(payload.customBaseUrl?.trim() || undefined), 600);
    return () => clearTimeout(t);
  }, [payload.customBaseUrl]);
  // Saved server addresses (persisted on node) — used for the quick-switch chips.
  // The model list is fetched from the ACTIVE address only: generation runs on
  // customBaseUrl, so unioning across saved servers (customBaseUrls) would offer
  // models that exist on another server but not the one the request targets,
  // failing with "not in list" on submit even though it was picked from the list.
  const serverUrls = payload.serverUrls ?? [];
  const modelsQuery = trpc.comfyui.fetchModels.useQuery(
    { customBaseUrl: debouncedUrl },
    { staleTime: 60_000, retry: false }
  );

  // Set when the user cancels: the blocking generate request can't be aborted
  // client-side, so when it eventually settles we skip overwriting the node
  // (which we've already flipped to a cancelled state for instant feedback).
  const cancelledRef = useRef(false);
  const genMutation = trpc.comfyui.generateImage.useMutation({
    onSuccess: (result) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      if (cancelledRef.current) { cancelledRef.current = false; return; }
      updateNodeData(id, { imageUrl: result.url, imageUrls: result.urls, status: "done", errorMessage: undefined, progress: undefined });
      if (result.url) propagateRefImage(id, result.url);
      if (payload.sendPromptToVideo) propagatePromptToVideo(id);
      toast.success("ComfyUI 图像生成成功");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      if (cancelledRef.current) { cancelledRef.current = false; return; }
      updateNodeData(id, { status: "failed", errorMessage: err.message, progress: undefined });
      toast.error("ComfyUI 图像生成失败：" + err.message);
    },
  });

  // Which slot the in-flight upload targets: img2img reference / ControlNet / IPAdapter / inpaint mask.
  const uploadTargetRef = useRef<"reference" | "controlnet" | "ipadapter" | "mask">("reference");
  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      setUploading(false);
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      const cur = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.payload as ComfyuiImageNodeData | undefined;
      if (uploadTargetRef.current === "mask") {
        updateNodeData(id, { maskUrl: result.url });
      } else if (uploadTargetRef.current === "controlnet") {
        const c = cur?.controlnet;
        updateNodeData(id, { controlnet: { model: c?.model ?? "", strength: c?.strength, startPercent: c?.startPercent, endPercent: c?.endPercent, imageUrl: result.url } });
        toast.success("ControlNet 图像上传成功");
      } else if (uploadTargetRef.current === "ipadapter") {
        const p = cur?.ipadapter;
        const prev = p?.imageUrls?.length ? p.imageUrls : (p?.imageUrl ? [p.imageUrl] : []);
        const next = [...prev, result.url];
        updateNodeData(id, { ipadapter: { model: p?.model ?? "", clipVision: p?.clipVision, weight: p?.weight, imageUrl: next[0], imageUrls: next } });
        toast.success("IPAdapter 参考图上传成功");
      } else {
        // A reference upload implies img2img — switch from txt2img so the
        // server actually honours referenceImageUrl (no-op if already img2img/inpaint).
        const patch: Partial<ComfyuiImageNodeData> = { referenceImageUrl: result.url };
        if (cur?.workflowTemplate !== "img2img" && cur?.workflowTemplate !== "inpaint") patch.workflowTemplate = "img2img";
        updateNodeData(id, patch);
        toast.success("参考图上传成功");
      }
    },
    onError: (err) => {
      setUploading(false);
      toast.error("图像上传失败：" + err.message);
    },
  });

  const translateTargetRef = useRef<"prompt" | "negPrompt">("prompt");
  const translateMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      setTranslating(false);
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { [translateTargetRef.current]: result.result });
      toast.success("已翻译为英文");
    },
    onError: (err) => {
      setTranslating(false);
      toast.error("翻译失败：" + err.message);
    },
  });

  const update = useCallback(
    (field: keyof ComfyuiImageNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  // Multi-LoRA: `loras` is the source of truth; fall back to the legacy single
  // `lora`/`loraStrength` for nodes saved before this feature existed.
  const lorasValue: ComfyuiLoraEntry[] =
    payload.loras ?? (payload.lora?.trim() ? [{ name: payload.lora.trim(), strengthModel: payload.loraStrength ?? 1.0 }] : []);
  const setLoras = (next: typeof lorasValue) =>
    updateNodeData(id, { loras: next, lora: undefined, loraStrength: undefined });
  const addLora = () => setLoras([...lorasValue, { name: "", strengthModel: 1.0 }]);
  const updateLora = (i: number, patch: Partial<(typeof lorasValue)[number]>) =>
    setLoras(lorasValue.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLora = (i: number) => setLoras(lorasValue.filter((_, idx) => idx !== i));

  const cn = payload.controlnet;
  const updateCn = (patch: Partial<NonNullable<ComfyuiImageNodeData["controlnet"]>>) =>
    updateNodeData(id, { controlnet: { model: cn?.model ?? "", imageUrl: cn?.imageUrl ?? "", strength: cn?.strength, startPercent: cn?.startPercent, endPercent: cn?.endPercent, ...patch } });

  const ip = payload.ipadapter;
  // NB: preserve `imageUrls` across model/weight/clipVision edits — omitting it
  // here would silently wipe a multi-image set whenever the user tweaks a field.
  const updateIp = (patch: Partial<NonNullable<ComfyuiImageNodeData["ipadapter"]>>) =>
    updateNodeData(id, { ipadapter: { model: ip?.model ?? "", imageUrl: ip?.imageUrl ?? "", imageUrls: ip?.imageUrls, clipVision: ip?.clipVision, weight: ip?.weight, ...patch } });

  // IPAdapter takes MULTIPLE style/face references (chained server-side). The
  // legacy single `imageUrl` is kept as a fallback (== first of the list) so
  // older saved nodes and downstream reads still work.
  const ipImages: string[] = ip?.imageUrls?.length ? ip.imageUrls : (ip?.imageUrl ? [ip.imageUrl] : []);
  const setIpImages = (next: string[]) => {
    const trimmed = next.slice(0, 8);
    updateNodeData(id, { ipadapter: { model: ip?.model ?? "", clipVision: ip?.clipVision, weight: ip?.weight, imageUrl: trimmed[0] ?? "", imageUrls: trimmed.length ? trimmed : undefined } });
  };
  const removeIpImage = (i: number) => setIpImages(ipImages.filter((_, idx) => idx !== i));
  const moveIpImage = (from: number, to: number) => {
    if (from === to || from < 0 || from >= ipImages.length) return;
    const next = [...ipImages];
    const [m] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, m);
    setIpImages(next);
  };
  const appendIpUrls = (urls: string[]) => {
    const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    if (clean.length) setIpImages([...ipImages, ...clean]);
  };

  const handleTranslate = (field: "prompt" | "negPrompt" = "prompt") => {
    if (translating || translateMutation.isPending) return;
    const text = field === "prompt" ? payload.prompt : payload.negPrompt;
    if (!text?.trim()) { toast.error(field === "prompt" ? "请先填写提示词" : "请先填写反向提示词"); return; }
    translateTargetRef.current = field;
    setTranslating(true);
    translateMutation.mutate({ text, mode: "translate_en", model: llmModel });
  };

  // Cancel a running ComfyUI job (POST /interrupt). The in-flight generate
  // mutation then fails and the node drops back to a re-runnable state.
  const interruptMutation = trpc.comfyui.interrupt.useMutation({
    onSuccess: () => toast.success("已发送中断请求"),
    onError: (err) => toast.error("中断失败：" + err.message),
  });
  const handleCancel = () => {
    cancelledRef.current = true;
    interruptMutation.mutate({ customBaseUrl: payload.customBaseUrl?.trim() || undefined });
    // Instant UI feedback — don't wait for the (possibly slow) server poll to end.
    updateNodeData(id, { status: "failed", errorMessage: "已取消生成", progress: undefined });
  };

  // Recover from a stale "processing" state left over from a page reload: a
  // freshly-mounted node can't have an in-flight mutation (those don't survive
  // reload), so the blocking generate request was lost — unstick the UI.
  useEffect(() => {
    if (payload.status === "processing") {
      updateNodeData(id, { status: "failed", errorMessage: "生成已中断（页面刷新或连接断开），请重新运行。", progress: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed lock: ComfyUI uses -1 for "random each run". "Lock" pins a concrete
  // random seed for reproducibility; "unlock" returns to -1.
  const seedLocked = typeof payload.seed === "number" && payload.seed >= 0;
  const toggleSeedLock = () => {
    if (seedLocked) update("seed", -1);
    else update("seed", Math.floor(Math.random() * 2147483647));
  };

  // Sync shared ComfyUI config (server / checkpoint / sampling params) from this
  // node to ALL other comfyui_image nodes on the canvas — handy after the Script
  // node batch-creates many ComfyUI image nodes: configure one, propagate to all.
  // Per-node fields (prompt / seed / reference & result images) are NOT synced.
  // Select which generated image is the node's active output. Also push the new
  // URL to connected downstream reference-image consumers (mirrors ImageGenNode).
  const selectImage = useCallback((url: string) => {
    updateNodeData(id, { imageUrl: url });
    propagateRefImage(id, url);
  }, [id, updateNodeData]);

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    if (!payload.ckpt?.trim()) { toast.error("请先填写 Checkpoint 名称"); return; }
    if ((payload.workflowTemplate === "img2img" || payload.workflowTemplate === "inpaint") && !payload.referenceImageUrl) {
      toast.error(payload.workflowTemplate === "inpaint" ? "inpaint 模板需要原图" : "img2img 模板需要参考图"); return;
    }
    if (payload.workflowTemplate === "inpaint" && !payload.maskUrl) {
      toast.error("inpaint 模板需要涂抹蒙版"); return;
    }
    cancelledRef.current = false;
    updateNodeData(id, { status: "processing", errorMessage: undefined, progress: 0 });
    genMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      customBaseUrl: payload.customBaseUrl?.trim() || undefined,
      workflowTemplate: payload.workflowTemplate ?? "txt2img",
      prompt: payload.prompt,
      negPrompt: payload.negPrompt,
      ckpt: payload.ckpt,
      // Auto-fill the SaveImage prefix from node title + model so ComfyUI outputs
      // carry a readable name (server sanitizes; falls back to comfyui_output).
      filenamePrefix: `${data.title}_${payload.ckpt}`.slice(0, 120),
      lora: payload.lora,
      loras: lorasValue.filter((l) => l.name.trim()).length > 0 ? lorasValue.filter((l) => l.name.trim()) : undefined,
      controlnet: cn?.model?.trim() && cn?.imageUrl
        ? { model: cn.model.trim(), imageUrl: cn.imageUrl, strength: cn.strength, startPercent: cn.startPercent, endPercent: cn.endPercent, preprocessor: cn.preprocessor?.trim() || undefined }
        : undefined,
      ipadapter: ip?.model?.trim() && ipImages.length
        ? { model: ip.model.trim(), imageUrl: ipImages[0], imageUrls: ipImages.length > 1 ? ipImages : undefined, clipVision: ip.clipVision?.trim() || undefined, weight: ip.weight }
        : undefined,
      clip: payload.clip?.name1?.trim()
        ? { clipType: payload.clip.clipType, name1: payload.clip.name1.trim(), name2: payload.clip.name2?.trim() || undefined, name3: payload.clip.name3?.trim() || undefined }
        : undefined,
      arch: archVal === "sd" ? undefined : archVal,
      modelSource: modelSrc,
      unetWeightDtype: modelSrc === "unet" ? (payload.unetWeightDtype || "default") : undefined,
      guidance: archVal === "flux" ? (payload.guidance ?? 3.5) : undefined,
      shift: (archVal === "sd3" || archVal === "qwen") ? (payload.shift ?? (archVal === "qwen" ? 3.1 : 3)) : undefined,
      upscaleModel: payload.upscaleModel?.trim() || undefined,
      steps: payload.steps ?? 20,
      cfg: payload.cfg ?? 7,
      seed: typeof payload.seed === "number" ? payload.seed : -1,
      width: payload.width ?? 512,
      height: payload.height ?? 512,
      sampler: payload.sampler || undefined,
      scheduler: payload.scheduler || undefined,
      denoise: typeof payload.denoise === "number" ? payload.denoise : undefined,
      vae: payload.vae || undefined,
      loraStrength: typeof payload.loraStrength === "number" ? payload.loraStrength : undefined,
      batchSize: payload.batchSize ?? 1,
      referenceImageUrl: payload.referenceImageUrl,
      maskUrl: payload.maskUrl,
    });
  };

  // Upload a single image file to the given slot. Safe to call repeatedly for
  // multiple files: the IPAdapter onSuccess handler reads fresh store state and
  // appends, and React onSuccess callbacks run serially, so no append is lost.
  const uploadImageFile = (file: File, target: "reference" | "controlnet" | "ipadapter") => {
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16 MB"); return; }
    uploadTargetRef.current = target;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setUploading(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, target: "reference" | "controlnet" | "ipadapter" = "reference") => {
    const files = Array.from(e.target.files ?? []);
    // IPAdapter supports multiple references; other slots take a single image.
    (target === "ipadapter" ? files : files.slice(0, 1)).forEach((f) => uploadImageFile(f, target));
    e.target.value = "";
  };

  // Parse image URLs out of a drag payload (asset-library JSON, then uri/text).
  const ipUrlsFromDrag = (dt: DataTransfer): string[] => {
    const assetRaw = dt.getData("application/x-asset-list");
    if (assetRaw) {
      try {
        const list = JSON.parse(assetRaw) as Array<{ url?: string; type?: string }>;
        return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
      } catch { /* fall through */ }
    }
    const uri = dt.getData("text/uri-list") || dt.getData("text/plain");
    return uri ? uri.split(/[\r\n]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)) : [];
  };

  const handleIpDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIpDragOver(false);
    // intra-grid reorder
    const reorder = e.dataTransfer.getData("application/x-ip-reorder");
    if (reorder) { moveIpImage(Number(reorder), ipImages.length); return; }
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { files.forEach((f) => uploadImageFile(f, "ipadapter")); return; }
    appendIpUrls(ipUrlsFromDrag(e.dataTransfer));
  };

  // Drop an image from the asset library / OS / a URL anywhere on the node body
  // → set it as the img2img reference (switching txt2img → img2img so the server
  // actually honours it). Mirrors the per-node ref drop in ImageGenNode and stops
  // propagation so the canvas doesn't ALSO spawn a duplicate asset node.
  // (Drops on the IPAdapter zone are handled by handleIpDrop, which stops first.)
  const setReferenceFromDrop = (url: string) => {
    const tmpl = payload.workflowTemplate;
    const patch: Partial<ComfyuiImageNodeData> = { referenceImageUrl: url };
    if (tmpl !== "img2img" && tmpl !== "inpaint") patch.workflowTemplate = "img2img";
    updateNodeData(id, patch);
    toast.success(tmpl === "inpaint" ? "已设为原图" : "已设为参考图（img2img）");
  };
  const handleNodeDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); e.stopPropagation(); uploadImageFile(files[0], "reference"); return; }
    const urls = ipUrlsFromDrag(e.dataTransfer); // asset-list JSON, then uri/text
    if (urls.length) { e.preventDefault(); e.stopPropagation(); setReferenceFromDrop(urls[0]); }
  };

  const handleDownload = (url: string) => {
    if (!url) return;
    // Auto-name the download from node title + model so saved files are identifiable.
    const base = `${data.title}_${(payload.ckpt ?? "").replace(/\.[A-Za-z0-9]+$/, "")}`
      .replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "comfyui";
    void downloadMedia(url, `${base}_${Date.now()}.png`, "image");
  };

  const isImg2Img = payload.workflowTemplate === "img2img";
  const isInpaint = payload.workflowTemplate === "inpaint";
  const needsRefImage = isImg2Img || isInpaint;

  // 绿点指示：结果图是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const imgStoredInMinio = isOwnStorageUrl(payload.imageUrl);

  // 标题栏下常驻的模型注释（与自定义工作流节点一致）：模板 · checkpoint。
  const ckptShort = (payload.ckpt ?? "").split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const modelAnnotation = [payload.workflowTemplate, ckptShort].filter(Boolean).join(" · ");
  const modelTip = [
    payload.ckpt ? `模型: ${payload.ckpt}` : "",
    payload.lora ? `LoRA: ${payload.lora}` : "",
    (payload.sampler || payload.steps != null) ? `采样: ${payload.sampler ?? ""} ${payload.steps != null ? payload.steps + "步" : ""}${payload.cfg != null ? " CFG " + payload.cfg : ""}`.trim() : "",
    (payload.width && payload.height) ? `尺寸: ${payload.width}×${payload.height}` : "",
  ].filter(Boolean).join("\n");

  const heroMedia = payload.imageUrl ? (
    <div className="relative overflow-hidden group" style={{ width: "100%" }}>
      <img
        src={payload.imageUrl}
        alt="comfyui-generated"
        className="w-full h-full object-cover"
        draggable={false}
        style={{ objectFit: "cover", display: "block" }}
        onError={makeImageProxyFallback(payload.imageUrl)}
      />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        style={{ background: "oklch(0 0 0 / 0.45)" }}
      >
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending}
          className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
        >
          {genMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          重新生成
        </button>
      </div>
    </div>
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="comfyui_image" title={data.title} minHeight={320} resizable heroMedia={heroMedia}
      onRun={handleGenerate} running={genMutation.isPending} canRun={!!payload.prompt?.trim() && !!payload.ckpt?.trim()} hasResult={!!payload.imageUrl}
      headerTooltip={modelTip || undefined}>
      <div
        className="flex flex-col h-full p-3.5 gap-3 overflow-auto"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
        onDrop={handleNodeDrop}
      >
        {/* 模型注释：标题栏下方常驻显示（模板 · checkpoint），与自定义工作流节点一致 */}
        {modelAnnotation && (
          <div
            title={modelTip || undefined}
            style={{ fontSize: 10.5, color: accent, fontWeight: 500, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}
          >
            {modelAnnotation}
          </div>
        )}

        {/* ── Result image(s) ── */}
        {payload.imageUrl ? (
          (payload.imageUrls && payload.imageUrls.length > 1) ? (
            // Multi-image grid
            <div className="flex-shrink-0 grid gap-1.5" style={{ gridTemplateColumns: payload.imageUrls.length >= 2 ? "1fr 1fr" : "1fr" }}>
              {payload.imageUrls.map((url, i) => {
                const isSelected = url === payload.imageUrl;
                return (
                <div
                  key={url + i}
                  onClick={() => selectImage(url)}
                  className="nodrag relative rounded-lg overflow-hidden cursor-pointer"
                  style={{
                    aspectRatio: "1/1", borderWidth: 2, borderStyle: "solid",
                    borderColor: isSelected ? accent : BORDER_DEFAULT,
                    background: "var(--c-canvas)",
                    opacity: isSelected ? 1 : 0.78,
                    transition: "border-color 150ms ease, opacity 150ms ease",
                  }}
                  title={isSelected ? "当前选中（节点输出）" : "点击选为输出图像"}
                >
                  <img
                    src={url}
                    alt={`generated-${i}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                    onError={makeImageProxyFallback(url)}
                  />
                  {isOwnStorageUrl(url) && (
                    <div
                      title="已存储到 MinIO·长期有效"
                      className="absolute top-1 left-1 rounded-full pointer-events-none"
                      style={{ width: 9, height: 9, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2px oklch(0.72 0.18 155 / 0.35)" }}
                    />
                  )}
                  {isSelected && (
                    <div
                      className="absolute top-1 right-1 rounded-full flex items-center justify-center"
                      style={{ width: 16, height: 16, background: accent }}
                    >
                      <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
                    </div>
                  )}
                  <div
                    className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ background: "oklch(0 0 0 / 0.55)" }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                      title="放大"
                    >
                      <ZoomIn className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(url); }}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                      title="下载"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Set the reference image AND switch the template to img2img;
                        // the server only honours referenceImageUrl when workflowTemplate
                        // === "img2img", so updating one without the other is a no-op.
                        updateNodeData(id, { referenceImageUrl: url, workflowTemplate: "img2img" });
                        toast.success("已设为参考图并切换至 img2img 模式");
                      }}
                      className="nodrag flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
                      title="设为参考图并切换 img2img 模式"
                    >
                      <ImageIcon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
          // Single image
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
          >
            {imgStoredInMinio && (
              <div
                title="已存储到 MinIO·长期有效"
                className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
              />
            )}
            <img
              src={payload.imageUrl}
              alt="generated"
              className="w-full h-full object-contain"
              draggable={false}
              onError={makeImageProxyFallback(payload.imageUrl ?? "")}
            />
            <div
              className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
              style={{ background: "oklch(0 0 0 / 0.55)" }}
            >
              <button
                onClick={() => setLightboxIndex(0)}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
              >
                <ZoomIn className="w-3 h-3" />
                放大
              </button>
              <button
                onClick={() => handleDownload(payload.imageUrl ?? "")}
                className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "oklch(0.14 0.007 260 / 0.8)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd3)", color: "var(--c-t2)" }}
              >
                <Download className="w-3 h-3" />
                下载
              </button>
            </div>
          </div>
          )
        ) : (
          <div
            className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "dashed", borderColor: `oklch(0.68 0.20 100 / 0.25)`, background: `oklch(0.68 0.20 100 / 0.04)` }}
          >
            <div className="flex flex-col items-center gap-1.5" style={{ color: "oklch(0.68 0.20 100 / 0.6)" }}>
              <Boxes style={{ width: 24, height: 24 }} />
              <span style={{ fontSize: 11 }}>ComfyUI 生成图像将显示在这里</span>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {payload.status === "failed" && payload.errorMessage && (
          <div
            className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0"
            style={{ background: "oklch(0.62 0.20 25 / 0.08)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.62 0.20 25 / 0.30)" }}
          >
            <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.20 25)" }} />
            <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.62 0.20 25)", wordBreak: "break-word", overflowWrap: "anywhere", minWidth: 0, flex: 1 }}>
              {payload.errorMessage}
            </p>
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

        <NodeConfigTabs
          tabs={[
            { key: "basic", label: "基础", Icon: Server },
            { key: "model", label: "模型", Icon: Boxes },
            { key: "sampling", label: "采样", Icon: Sparkles },
            { key: "advanced", label: "高级", Icon: Layers },
          ]}
          active={cfgTab}
          onChange={setCfgTab}
          accent={accent}
        >
        {cfgTab === "basic" && (<>
        {/* ── ComfyUI URL (collapsible) ── */}
        <div
          className="rounded-xl"
          style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)", marginBottom: 12 }}
        >
          <button
            onClick={() => setUrlExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
              <Server style={{ width: 10, height: 10 }} />
              ComfyUI 服务器
            </span>
            {urlExpanded
              ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
            }
          </button>
          {urlExpanded && (
            <div className="px-3 pb-3">
              <ComfyServerUrlField
                id={id}
                value={payload.customBaseUrl ?? ""}
                onChange={(v) => update("customBaseUrl", v)}
                serverUrls={serverUrls}
                onChangeServerUrls={(next) => update("serverUrls", next)}
                isFetching={modelsQuery.isFetching}
                onRefresh={() => { modelsQuery.refetch(); }}
                accent={accent}
                borderAccent={BORDER_ACCENT}
                borderDefault={BORDER_DEFAULT}
                fieldBase={fieldBase}
              />
              {/* Connection / model count status */}
              <ComfyConnectionStatus
                isFetching={modelsQuery.isFetching}
                isError={modelsQuery.isError}
                errorMessage={modelsQuery.error?.message}
                ckptCount={modelsQuery.data?.ckpts.length ?? 0}
                loraCount={modelsQuery.data?.loras.length ?? 0}
                extraCounts={[
                  { label: "VAE", count: modelsQuery.data?.vaes.length ?? 0 },
                  { label: "ControlNet", count: modelsQuery.data?.controlnets.length ?? 0 },
                  { label: "IPAdapter", count: modelsQuery.data?.ipadapters.length ?? 0 },
                  { label: "UNET", count: modelsQuery.data?.unets.length ?? 0 },
                  { label: "放大", count: modelsQuery.data?.upscaleModels.length ?? 0 },
                  { label: "嵌入", count: modelsQuery.data?.embeddings.length ?? 0 },
                ]}
              />
              <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4 }}>
                每个节点独立配置，仅 http(s) 协议。ComfyUI 端需用 <code>--listen 0.0.0.0</code> 启动；本应用服务器必须能通过网络到达此地址。
              </p>
            </div>
          )}
        </div>

        {/* ── Sync config to other ComfyUI image nodes (picker dialog) ── */}
        <button
          onClick={() => setSyncOpen(true)}
          title="选择目标节点与参数类别，把当前配置同步到其他 ComfyUI 图像节点（不含提示词、Seed、结果图）"
          className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10.5px] transition-all"
          style={{
            background: "oklch(0.68 0.20 100 / 0.08)",
            border: "1px dashed oklch(0.68 0.20 100 / 0.4)",
            color: accent,
            cursor: "pointer",
            marginBottom: 4,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.20 100 / 0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.20 100 / 0.08)"; }}
        >
          <Copy className="w-3 h-3" />
          同步配置到其他 ComfyUI 图像节点…
        </button>
        <SyncConfigDialog open={syncOpen} onOpenChange={setSyncOpen} sourceId={id} nodeType="comfyui_image" accent={accent} />

        {/* ── Workflow template ── */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            Workflow 模板
          </label>
          <select
            value={payload.workflowTemplate ?? "txt2img"}
            onChange={(e) => update("workflowTemplate", e.target.value as ComfyuiImageNodeData["workflowTemplate"])}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="txt2img">txt2img — 文生图</option>
            <option value="img2img">img2img — 图生图</option>
            <option value="inpaint">inpaint — 蒙版重绘</option>
          </select>
        </div>

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea className="nodrag nowheel"
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onChange={(e) => update("prompt", e.target.value)}
            rows={3}

            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={translating} />
            <button
              onClick={() => handleTranslate("prompt")}
              disabled={translating}
              className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
              style={{
                background: translating ? "var(--c-surface)" : "oklch(0.65 0.18 200 / 0.10)",
                border: `1px solid ${translating ? "var(--c-bd2)" : "oklch(0.65 0.18 200 / 0.35)"}`,
                color: translating ? "var(--c-t4)" : "oklch(0.70 0.16 200)",
                cursor: translating ? "not-allowed" : "pointer",
              }}
              title="将提示词翻译为英文（ComfyUI / SD 模型对英文提示更友好）"
            >
              {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
              译为英文
            </button>
          </div>
        </div>

        {/* ── Negative prompt ── */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <textarea className="nodrag nowheel"
            placeholder="blurry, low quality..."
            value={payload.negPrompt ?? ""}
            onChange={(e) => update("negPrompt", e.target.value)}
            rows={2}

            style={{ ...fieldBase, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() => handleTranslate("negPrompt")}
              disabled={translating}
              className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
              style={{
                background: translating ? "var(--c-surface)" : "oklch(0.65 0.18 200 / 0.10)",
                border: `1px solid ${translating ? "var(--c-bd2)" : "oklch(0.65 0.18 200 / 0.35)"}`,
                color: translating ? "var(--c-t4)" : "oklch(0.70 0.16 200)",
                cursor: translating ? "not-allowed" : "pointer",
              }}
              title="将反向提示词翻译为英文"
            >
              {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
              译为英文
            </button>
          </div>
        </div>

        {/* ── 提示词联动：传给下游 ComfyUI 视频节点 ── */}
        <button
          onClick={() => update("sendPromptToVideo", !payload.sendPromptToVideo)}
          className="nodrag flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-[10.5px] transition-all"
          style={{
            background: payload.sendPromptToVideo ? "oklch(0.68 0.20 285 / 0.12)" : "var(--c-input)",
            border: `1px solid ${payload.sendPromptToVideo ? "oklch(0.68 0.20 285 / 0.5)" : "var(--c-bd2)"}`,
            color: payload.sendPromptToVideo ? "oklch(0.74 0.18 285)" : "var(--c-t3)",
            cursor: "pointer",
          }}
          title="开启后，运行工作流时把本节点的正/反向提示词自动传给下游连接的 ComfyUI 视频节点"
        >
          <span>运行工作流时把提示词传给下游视频节点</span>
          <span
            style={{
              width: 26, height: 15, borderRadius: 99, flexShrink: 0, position: "relative",
              background: payload.sendPromptToVideo ? "oklch(0.68 0.20 285)" : "var(--c-bd3)",
              transition: "background 150ms ease",
            }}
          >
            <span style={{
              position: "absolute", top: 2, left: payload.sendPromptToVideo ? 13 : 2,
              width: 11, height: 11, borderRadius: "50%", background: "#fff", transition: "left 150ms ease",
            }} />
          </span>
        </button>

        </>)}
        {cfgTab === "model" && (<>
        {/* ── 架构（经典 SD / Flux / SD3 / Qwen）── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>架构</label>
            <select
              value={archVal}
              onChange={(e) => {
                const v = e.target.value as "sd" | "flux" | "sd3" | "qwen";
                // Switching to a DiT arch defaults to UNet loading + a sensible CLIP preset.
                const patch: Partial<ComfyuiImageNodeData> = { arch: v === "sd" ? undefined : v };
                if (v !== "sd") {
                  patch.modelSource = "unet";
                  if (!payload.clip?.name1) {
                    if (v === "flux") patch.clip = { clipType: "flux", name1: "", name2: "" };
                    else if (v === "qwen") patch.clip = { clipType: "qwen_image", name1: "" };
                    else if (v === "sd3") patch.clip = { clipType: "", name1: "", name2: "", name3: "" };
                  }
                } else {
                  patch.modelSource = undefined;
                }
                updateNodeData(id, patch);
              }}
              className="nodrag" style={fieldBase}
            >
              <option value="sd">经典 SD / SDXL</option>
              <option value="flux">Flux.1</option>
              <option value="sd3">SD3 / SD3.5</option>
              <option value="qwen">Qwen-Image</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>模型加载方式</label>
            <select
              value={modelSrc}
              onChange={(e) => update("modelSource", e.target.value === "unet" ? "unet" : "checkpoint")}
              className="nodrag" style={fieldBase}
            >
              <option value="checkpoint">完整 Checkpoint</option>
              <option value="unet">单独 UNet / 扩散模型</option>
            </select>
          </div>
        </div>
        {/* ── 模型文件（按加载方式切换 checkpoint / unet 列表）── */}
        <div>
          <label style={labelStyle}>{modelSrc === "unet" ? "UNet / 扩散模型 *" : "Checkpoint *"}</label>
          <input
            list={`comfyui-model-${id}`}
            placeholder={modelSrc === "unet" ? "如 flux1-dev.safetensors" : "如 sd_xl_base_1.0.safetensors"}
            value={payload.ckpt ?? ""}
            onChange={(e) => update("ckpt", e.target.value)}
            className="nodrag"
            style={fieldBase}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <datalist id={`comfyui-model-${id}`}>
            {((modelSrc === "unet" ? modelsQuery.data?.unets : modelsQuery.data?.ckpts) ?? []).map((c) => <option key={c} value={c} />)}
          </datalist>
          {modelSrc === "unet" && (
            <div style={{ marginTop: 6 }}>
              <label style={labelStyle}>权重精度（weight_dtype）</label>
              <select value={payload.unetWeightDtype ?? "default"} onChange={(e) => update("unetWeightDtype", e.target.value)} className="nodrag" style={fieldBase}>
                {["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {archVal === "flux" && (
            <div style={{ marginTop: 6 }}>
              <label style={labelStyle}>Flux Guidance</label>
              <input type="number" min={0} max={100} step={0.1} value={payload.guidance ?? 3.5}
                onChange={(e) => update("guidance", Number(e.target.value) || 0)} className="nodrag" style={fieldBase} />
            </div>
          )}
          {(archVal === "sd3" || archVal === "qwen") && (
            <div style={{ marginTop: 6 }}>
              <label style={labelStyle}>采样位移 shift</label>
              <input type="number" min={0} max={100} step={0.1} value={payload.shift ?? (archVal === "qwen" ? 3.1 : 3)}
                onChange={(e) => update("shift", Number(e.target.value) || 0)} className="nodrag" style={fieldBase} />
            </div>
          )}
          {archVal !== "sd" && (
            <p style={{ fontSize: 10, color: "var(--c-t4)", margin: "4px 0 0" }}>
              DiT 架构：请在下方「CLIP 来源」选好文本编码器、并填 VAE（多为单独文件）。新架构暂仅支持 txt2img + LoRA，忽略 ControlNet/IPAdapter。
            </p>
          )}
        </div>

        {/* ── LoRA stack (multi) ── */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Layers style={{ width: 10, height: 10 }} />
            LoRA（可叠加多个，可选）
          </label>
          <datalist id={`comfyui-loras-${id}`}>
            {(modelsQuery.data?.loras ?? []).map((l) => <option key={l} value={l} />)}
          </datalist>
          {lorasValue.length === 0 && (
            <p style={{ fontSize: 10, color: "var(--c-t4)", margin: "2px 0 4px" }}>未使用 LoRA</p>
          )}
          <div className="flex flex-col gap-1.5">
            {lorasValue.map((l, i) => (
              <div key={i} className="flex flex-col gap-1 p-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
                <div className="flex items-center gap-1">
                  <input
                    list={`comfyui-loras-${id}`}
                    placeholder="lora 文件名"
                    value={l.name}
                    onChange={(e) => updateLora(i, { name: e.target.value })}
                    className="nodrag"
                    style={{ ...fieldBase, flex: 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                  <button
                    onClick={() => removeLora(i)}
                    className="nodrag flex items-center justify-center rounded-md"
                    style={{ width: 24, height: 24, flexShrink: 0, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)", cursor: "pointer" }}
                    title="移除此 LoRA"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span style={{ fontSize: 9.5, color: "var(--c-t4)", flexShrink: 0 }}>强度 {l.strengthModel.toFixed(2)}</span>
                  <input
                    type="range" min={-2} max={2} step={0.05}
                    value={l.strengthModel}
                    onChange={(e) => updateLora(i, { strengthModel: Number(e.target.value) })}
                    className="nodrag" style={{ flex: 1, accentColor: accent }}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={addLora}
            disabled={lorasValue.length >= 8}
            className="nodrag flex items-center justify-center gap-1 w-full py-1 mt-1 rounded-lg text-[10px] transition-all"
            style={{
              background: "var(--c-input)",
              border: "1px dashed var(--c-bd2)",
              color: lorasValue.length >= 8 ? "var(--c-t4)" : accent,
              cursor: lorasValue.length >= 8 ? "not-allowed" : "pointer",
            }}
            title={lorasValue.length >= 8 ? "最多 8 个 LoRA" : "添加一个 LoRA"}
          >
            <Plus className="w-3 h-3" /> 添加 LoRA
          </button>
        </div>

        </>)}
        {cfgTab === "sampling" && (<>
        {/* ── Advanced params (collapsible) ── */}
        <div
          className="rounded-xl"
          style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)" }}
        >
          <button
            onClick={() => setParamsExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
              采样参数
            </span>
            {paramsExpanded
              ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
            }
          </button>
          {paramsExpanded && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-x-2 gap-y-2">
              <div>
                <label style={labelStyle}>Steps</label>
                <input
                  type="number" min={1} max={150}
                  value={payload.steps ?? 20}
                  onChange={(e) => update("steps", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>CFG</label>
                <input
                  type="number" min={1} max={30} step={0.5}
                  value={payload.cfg ?? 7}
                  onChange={(e) => update("cfg", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>宽度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  value={payload.width ?? 512}
                  onChange={(e) => update("width", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>高度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  value={payload.height ?? 512}
                  onChange={(e) => update("height", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Sampler */}
              <div>
                <label style={labelStyle}>采样器</label>
                <input
                  list={`comfyui-samplers-${id}`}
                  placeholder="euler"
                  value={payload.sampler ?? ""}
                  onChange={(e) => update("sampler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-samplers-${id}`}>
                  {(modelsQuery.data?.samplers ?? []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {/* Scheduler */}
              <div>
                <label style={labelStyle}>调度器</label>
                <input
                  list={`comfyui-schedulers-${id}`}
                  placeholder="normal"
                  value={payload.scheduler ?? ""}
                  onChange={(e) => update("scheduler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-schedulers-${id}`}>
                  {(modelsQuery.data?.schedulers ?? ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"]).map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {/* Denoise */}
              <div className="col-span-2">
                <label style={labelStyle}>
                  Denoise &nbsp;
                  <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{(payload.denoise ?? 1.0).toFixed(2)}</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={payload.denoise ?? 1.0}
                  onChange={(e) => update("denoise", Number(e.target.value))}
                  className="nodrag" style={{ width: "100%", accentColor: accent }}
                />
              </div>
              {/* VAE */}
              <div className="col-span-2">
                <label style={labelStyle}>VAE（留空用 Checkpoint 内置）</label>
                <input
                  list={`comfyui-vaes-${id}`}
                  placeholder="ae.safetensors"
                  value={payload.vae ?? ""}
                  onChange={(e) => update("vae", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-vaes-${id}`}>
                  {(modelsQuery.data?.vaes ?? []).map((v) => <option key={v} value={v} />)}
                </datalist>
              </div>
              {/* CLIP 来源：checkpoint 不含 CLIP（Flux/SD3/UNet-only）时单独加载 */}
              <div className="col-span-2">
                <label style={labelStyle}>CLIP 来源（Checkpoint 报错 "clip input is invalid" 时用）</label>
                <select
                  value={payload.clip == null ? "checkpoint" : (payload.clip.name3 !== undefined ? "triple" : payload.clip.name2 !== undefined ? "dual" : "single")}
                  onChange={(e) => {
                    const m = e.target.value;
                    if (m === "checkpoint") update("clip", undefined);
                    else if (m === "single") update("clip", { clipType: payload.clip?.clipType || "stable_diffusion", name1: payload.clip?.name1 || "", name2: undefined, name3: undefined });
                    else if (m === "dual") update("clip", { clipType: payload.clip?.clipType || "flux", name1: payload.clip?.name1 || "", name2: payload.clip?.name2 ?? "", name3: undefined });
                    else update("clip", { clipType: "", name1: payload.clip?.name1 || "", name2: payload.clip?.name2 ?? "", name3: payload.clip?.name3 ?? "" });
                  }}
                  className="nodrag" style={fieldBase}
                >
                  <option value="checkpoint">跟随 Checkpoint（默认）</option>
                  <option value="single">单独 CLIP（CLIPLoader · Qwen 等）</option>
                  <option value="dual">双 CLIP（DualCLIPLoader · Flux/SDXL）</option>
                  <option value="triple">三 CLIP（TripleCLIPLoader · SD3）</option>
                </select>
                {payload.clip != null && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                    {/* TripleCLIPLoader 无 type 字段 */}
                    {payload.clip.name3 === undefined && (
                      <>
                        <input
                          list={`comfyui-clip-types-${id}`}
                          placeholder={payload.clip.name2 !== undefined ? "类型 如 flux / sdxl" : "类型 如 qwen_image / flux"}
                          value={payload.clip.clipType}
                          onChange={(e) => update("clip", { ...payload.clip!, clipType: e.target.value })}
                          className="nodrag" style={fieldBase}
                        />
                        <datalist id={`comfyui-clip-types-${id}`}>
                          {(payload.clip.name2 !== undefined
                            ? ["sdxl", "sd3", "flux", "hunyuan_video", "hidream"]
                            : ["qwen_image", "stable_diffusion", "sd3", "flux", "stable_cascade", "stable_audio", "mochi", "ltxv", "pixart", "cosmos", "lumina2", "wan", "hunyuan_video"]
                          ).map((t) => <option key={t} value={t} />)}
                        </datalist>
                      </>
                    )}
                    <input
                      list={`comfyui-clips-${id}`}
                      placeholder={payload.clip.name2 !== undefined ? "clip_name1 如 clip_l" : "clip 文件名"}
                      value={payload.clip.name1}
                      onChange={(e) => update("clip", { ...payload.clip!, name1: e.target.value })}
                      className="nodrag" style={fieldBase}
                    />
                    {payload.clip.name2 !== undefined && (
                      <input
                        list={`comfyui-clips-${id}`}
                        placeholder="clip_name2 如 t5xxl_fp16"
                        value={payload.clip.name2}
                        onChange={(e) => update("clip", { ...payload.clip!, name2: e.target.value })}
                        className="nodrag" style={fieldBase}
                      />
                    )}
                    {payload.clip.name3 !== undefined && (
                      <input
                        list={`comfyui-clips-${id}`}
                        placeholder="clip_name3 如 t5xxl"
                        value={payload.clip.name3}
                        onChange={(e) => update("clip", { ...payload.clip!, name3: e.target.value })}
                        className="nodrag" style={fieldBase}
                      />
                    )}
                    <datalist id={`comfyui-clips-${id}`}>
                      {(modelsQuery.data?.clips ?? []).map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                )}
              </div>
              {/* Upscale model (放大) */}
              <div className="col-span-2">
                <label style={labelStyle}>放大模型（留空不放大）</label>
                <input
                  list={`comfyui-upscalers-${id}`}
                  placeholder="如 4x-UltraSharp.pth"
                  value={payload.upscaleModel ?? ""}
                  onChange={(e) => update("upscaleModel", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-upscalers-${id}`}>
                  {(modelsQuery.data?.upscaleModels ?? []).map((u) => <option key={u} value={u} />)}
                </datalist>
              </div>
              {/* Batch size */}
              <div>
                <label style={labelStyle}>批量数量</label>
                <input
                  type="number" min={1} max={8}
                  value={payload.batchSize ?? 1}
                  onChange={(e) => update("batchSize", e.target.value ? Math.min(8, Math.max(1, Number(e.target.value))) : 1)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Seed */}
              <div>
                <div className="flex items-center justify-between mb-[5px]">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Seed（-1 随机）</label>
                  <button
                    onClick={toggleSeedLock}
                    className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] transition-all"
                    style={{
                      background: seedLocked ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
                      border: `1px solid ${seedLocked ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                      color: seedLocked ? "oklch(0.72 0.18 285)" : "var(--c-t4)",
                      cursor: "pointer",
                    }}
                    title={seedLocked ? "解锁（改回 -1 每次随机）" : "锁定一个随机种子以复现"}
                  >
                    {seedLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    {seedLocked ? "已锁" : "随机"}
                  </button>
                </div>
                <input
                  type="number" placeholder="-1"
                  value={payload.seed ?? ""}
                  onChange={(e) => update("seed", e.target.value === "" ? undefined : Number(e.target.value))}
                  className="nodrag" style={fieldBase}
                />
              </div>
            </div>
          )}
        </div>

        </>)}
        {/* 参考图归入"基础"页（紧随提示词，img2img/inpaint 常用）；它物理位置在采样之后，
            故用独立的 basic 片段渲染——basic 激活时此片段会接在上面 basic 内容之后显示。 */}
        {cfgTab === "basic" && (<>
        {/* ── Reference image upload (img2img / inpaint) ── */}
        {needsRefImage && (
          <div>
            <label style={labelStyle}>{isInpaint ? "原图（inpaint 必需） *" : "参考图（img2img 必需） *"}</label>
            {payload.referenceImageUrl ? (
              <div
                className="relative rounded-lg overflow-hidden"
                style={{ height: 80, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
              >
                <img
                  src={payload.referenceImageUrl}
                  alt="reference"
                  className="nodrag w-full h-full object-cover"
                  style={{ cursor: "zoom-in" }}
                  draggable={false}
                  title="点击放大"
                  onClick={() => setRefZoom(true)}
                  onError={makeImageProxyFallback(payload.referenceImageUrl ?? "")}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); update("referenceImageUrl", undefined); }}
                  className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                  style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="nodrag w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors"
                style={{
                  borderWidth: 1, borderStyle: "dashed",
                  borderColor: uploading ? BORDER_DEFAULT : "var(--c-bd3)",
                  background: "var(--c-input)",
                  color: uploading ? "var(--c-t4)" : "var(--c-t3)",
                  fontSize: 11, cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading
                  ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</>
                  : <><Upload style={{ width: 13, height: 13 }} /> 点击上传参考图</>
                }
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            {/* 或直接粘贴公网图片 URL — 仅在没有本地上传图(非 http 路径)时显示 */}
            {(!payload.referenceImageUrl || payload.referenceImageUrl.startsWith("http")) && (
              <input
                type="url"
                placeholder="或粘贴公网图片 URL（https://…）"
                value={payload.referenceImageUrl?.startsWith("http") ? payload.referenceImageUrl : ""}
                onChange={(e) => update("referenceImageUrl", e.target.value.trim() || undefined)}
                className="nodrag"
                style={{ ...fieldBase, marginTop: 6, fontSize: 10.5 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            )}
            {/* Inpaint mask painter — appears once the reference image is set. */}
            {isInpaint && payload.referenceImageUrl && (
              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>蒙版（涂抹要重绘的区域） *</label>
                <MaskCanvas
                  imageUrl={payload.referenceImageUrl}
                  accent={accent}
                  onExport={(dataUrl) => {
                    if (!dataUrl) { update("maskUrl", undefined); return; }
                    uploadTargetRef.current = "mask";
                    const base64 = dataUrl.split(",")[1];
                    setUploading(true);
                    uploadMutation.mutate({ base64, mimeType: "image/png", filename: "inpaint-mask.png" });
                  }}
                />
                {payload.maskUrl && <p style={{ fontSize: 9.5, color: "oklch(0.65 0.18 145)", margin: "2px 0 0" }}>✓ 蒙版已就绪</p>}
              </div>
            )}
          </div>
        )}
        </>)}
        {cfgTab === "advanced" && (<>
        {/* ── ControlNet (optional, applies to txt2img & img2img) ── */}
        <div className="rounded-xl" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
          <button
            onClick={() => setCnExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
              ControlNet{cn?.model?.trim() && cn?.imageUrl ? <span style={{ color: accent }}>●</span> : "（可选）"}
            </span>
            {cnExpanded ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} /> : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />}
          </button>
          {cnExpanded && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              <div>
                <label style={labelStyle}>ControlNet 模型</label>
                <input
                  list={`comfyui-controlnets-${id}`}
                  placeholder="如 control_v11p_sd15_canny.pth"
                  value={cn?.model ?? ""}
                  onChange={(e) => updateCn({ model: e.target.value })}
                  className="nodrag" style={fieldBase}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
                <datalist id={`comfyui-controlnets-${id}`}>
                  {(modelsQuery.data?.controlnets ?? []).map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label style={labelStyle}>预处理器（可选，需 controlnet_aux 节点包）</label>
                <input
                  list={`comfyui-cn-preproc-${id}`}
                  placeholder="留空＝直接用控制图（已是边缘/深度图）"
                  value={cn?.preprocessor ?? ""}
                  onChange={(e) => updateCn({ preprocessor: e.target.value })}
                  className="nodrag" style={{ ...fieldBase, fontSize: 10.5 }}
                />
                <datalist id={`comfyui-cn-preproc-${id}`}>
                  <option value="CannyEdgePreprocessor">Canny 边缘</option>
                  <option value="MiDaS-DepthMapPreprocessor">深度 (MiDaS)</option>
                  <option value="DepthAnythingV2Preprocessor">深度 (DepthAnythingV2)</option>
                  <option value="OpenposePreprocessor">OpenPose 姿态</option>
                  <option value="DWPreprocessor">DWPose 姿态</option>
                  <option value="LineArtPreprocessor">线稿 LineArt</option>
                  <option value="ScribblePreprocessor">涂鸦 Scribble</option>
                  <option value="HEDPreprocessor">HED 软边缘</option>
                </datalist>
              </div>
              <div>
                <label style={labelStyle}>控制图像</label>
                {cn?.imageUrl ? (
                  <div className="relative rounded-lg overflow-hidden" style={{ height: 80, border: `1px solid ${BORDER_DEFAULT}`, background: "var(--c-canvas)" }}>
                    <img src={cn.imageUrl} alt="controlnet" className="w-full h-full object-cover" draggable={false} onError={makeImageProxyFallback(cn.imageUrl)} />
                    <button onClick={() => updateCn({ imageUrl: "" })} className="nodrag absolute top-1 right-1 p-0.5 rounded-full" style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}>
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => cnFileInputRef.current?.click()}
                    disabled={uploading}
                    className="nodrag w-full flex items-center justify-center gap-2 py-3 rounded-lg"
                    style={{ border: "1px dashed var(--c-bd3)", background: "var(--c-input)", color: uploading ? "var(--c-t4)" : "var(--c-t3)", fontSize: 11, cursor: uploading ? "not-allowed" : "pointer" }}
                  >
                    {uploading ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</> : <><Upload style={{ width: 13, height: 13 }} /> 上传控制图像</>}
                  </button>
                )}
                <input ref={cnFileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFileChange(e, "controlnet")} />
                {(!cn?.imageUrl || cn.imageUrl.startsWith("http")) && (
                  <input
                    type="url"
                    placeholder="或粘贴公网图片 URL（https://…）"
                    value={cn?.imageUrl?.startsWith("http") ? cn.imageUrl : ""}
                    onChange={(e) => updateCn({ imageUrl: e.target.value.trim() })}
                    className="nodrag" style={{ ...fieldBase, marginTop: 6, fontSize: 10.5 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                )}
              </div>
              <div>
                <label style={labelStyle}>强度 <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{(cn?.strength ?? 1.0).toFixed(2)}</span></label>
                <input type="range" min={0} max={2} step={0.05} value={cn?.strength ?? 1.0} onChange={(e) => updateCn({ strength: Number(e.target.value) })} className="nodrag" style={{ width: "100%", accentColor: accent }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label style={labelStyle}>起始 % <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{((cn?.startPercent ?? 0) * 100).toFixed(0)}</span></label>
                  <input type="range" min={0} max={1} step={0.05} value={cn?.startPercent ?? 0} onChange={(e) => updateCn({ startPercent: Number(e.target.value) })} className="nodrag" style={{ width: "100%", accentColor: accent }} />
                </div>
                <div>
                  <label style={labelStyle}>结束 % <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{((cn?.endPercent ?? 1) * 100).toFixed(0)}</span></label>
                  <input type="range" min={0} max={1} step={0.05} value={cn?.endPercent ?? 1} onChange={(e) => updateCn({ endPercent: Number(e.target.value) })} className="nodrag" style={{ width: "100%", accentColor: accent }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── IPAdapter (optional style/face reference) ── */}
        <div className="rounded-xl" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}>
          <button
            onClick={() => setIpExpanded((v) => !v)}
            className="nodrag w-full flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ cursor: "pointer", background: "transparent" }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
              IPAdapter{ip?.model?.trim() && ipImages.length ? <span style={{ color: accent }}>●{ipImages.length > 1 ? `×${ipImages.length}` : ""}</span> : "（风格/人脸参考·可选）"}
            </span>
            {ipExpanded ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} /> : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />}
          </button>
          {ipExpanded && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              <div>
                <label style={labelStyle}>IPAdapter 模型</label>
                <input
                  list={`comfyui-ipadapters-${id}`}
                  placeholder="如 ip-adapter-plus_sdxl_vit-h.safetensors"
                  value={ip?.model ?? ""}
                  onChange={(e) => updateIp({ model: e.target.value })}
                  className="nodrag" style={fieldBase}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
                <datalist id={`comfyui-ipadapters-${id}`}>
                  {(modelsQuery.data?.ipadapters ?? []).map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setIpDragOver(true); }}
                onDragLeave={() => setIpDragOver(false)}
                onDrop={handleIpDrop}
              >
                <label style={labelStyle}>
                  参考图像
                  <span style={{ fontWeight: 400, color: "var(--c-t3)" }}> · 可多张（最多 8，全部参与调制）{ipImages.length ? ` · 已选 ${ipImages.length}` : ""}</span>
                </label>
                {ipImages.length > 0 && (
                  <div
                    className="nodrag"
                    style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 6 }}
                  >
                    {ipImages.map((url, i) => (
                      <div
                        key={`${url}-${i}`}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("application/x-ip-reorder", String(i)); e.dataTransfer.effectAllowed = "move"; }}
                        className="relative group rounded-lg overflow-hidden"
                        style={{ aspectRatio: "1 / 1", border: `1px solid ${BORDER_DEFAULT}`, background: "var(--c-canvas)", cursor: "grab" }}
                      >
                        <img
                          src={url}
                          alt={`ipadapter-${i + 1}`}
                          className="w-full h-full object-cover"
                          draggable={false}
                          style={{ cursor: "zoom-in" }}
                          onClick={() => setIpZoomIndex(i)}
                          onError={makeImageProxyFallback(url)}
                        />
                        <span style={{ position: "absolute", left: 2, top: 2, minWidth: 14, height: 14, paddingInline: 3, borderRadius: 7, fontSize: 8.5, fontWeight: 700, lineHeight: "14px", textAlign: "center", background: accent, color: "white" }}>
                          {i + 1}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeIpImage(i); }}
                          className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ right: 2, top: 2, padding: 2, borderRadius: "50%", background: "oklch(0 0 0 / 0.7)", color: "white", lineHeight: 0 }}
                          title="删除"
                        >
                          <X style={{ width: 10, height: 10 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {ipImages.length < 8 && (
                  <button
                    onClick={() => ipFileInputRef.current?.click()}
                    disabled={uploading}
                    className="nodrag w-full flex items-center justify-center gap-2 py-2.5 rounded-lg"
                    style={{ border: `1px dashed ${ipDragOver ? accent : "var(--c-bd3)"}`, background: ipDragOver ? "color-mix(in oklch, var(--c-input) 80%, var(--c-base))" : "var(--c-input)", color: uploading ? "var(--c-t4)" : "var(--c-t3)", fontSize: 11, cursor: uploading ? "not-allowed" : "pointer" }}
                  >
                    {uploading ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</> : <><Upload style={{ width: 13, height: 13 }} /> {ipImages.length ? "添加参考图像" : "上传参考图像"}（可拖入）</>}
                  </button>
                )}
                <input ref={ipFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFileChange(e, "ipadapter")} />
                {ipImages.length < 8 && (
                  <input
                    type="url"
                    placeholder="或粘贴公网图片 URL 后回车添加（https://…）"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) { appendIpUrls([v]); (e.target as HTMLInputElement).value = ""; }
                      }
                    }}
                    className="nodrag" style={{ ...fieldBase, marginTop: 6, fontSize: 10.5 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                  />
                )}
              </div>
              <div>
                <label style={labelStyle}>权重 <span style={{ fontWeight: 400, color: "var(--c-t3)" }}>{(ip?.weight ?? 1.0).toFixed(2)}</span></label>
                <input type="range" min={0} max={2} step={0.05} value={ip?.weight ?? 1.0} onChange={(e) => updateIp({ weight: Number(e.target.value) })} className="nodrag" style={{ width: "100%", accentColor: accent }} />
              </div>
              <div>
                <label style={labelStyle}>CLIP Vision（留空用默认）</label>
                <input
                  list={`comfyui-clipvisions-${id}`}
                  placeholder="CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
                  value={ip?.clipVision ?? ""}
                  onChange={(e) => updateIp({ clipVision: e.target.value })}
                  className="nodrag" style={{ ...fieldBase, fontSize: 10.5 }}
                />
                <datalist id={`comfyui-clipvisions-${id}`}>
                  {(modelsQuery.data?.clipVisions ?? []).map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: 0 }}>需安装 ComfyUI_IPAdapter_plus 自定义节点包。</p>
            </div>
          )}
        </div>

        </>)}
        </NodeConfigTabs>

        {/* ── Progress bar ── */}
        {payload.status === "processing" && payload.progress != null && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ height: 4, borderRadius: 2, background: "var(--c-bd2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${payload.progress}%`, background: accent, transition: "width 300ms ease", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 2, display: "block" }}>{payload.progress}%</span>
          </div>
        )}

        {/* ── Generate button ── */}
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim()
              ? "var(--c-surface)"
              : "linear-gradient(135deg, oklch(0.68 0.20 100 / 0.18), oklch(0.62 0.22 80 / 0.18))",
            borderWidth: 1, borderStyle: "solid",
            borderColor: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? BORDER_DEFAULT : BORDER_ACCENT,
            color: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? "var(--c-t4)" : accent,
            cursor: genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
            marginTop: 12,
          }}
        >
          {genMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {genMutation.isPending ? "ComfyUI 生成中..." : "运行 ComfyUI"}
        </button>

        {/* Cancel button — interrupt the running ComfyUI job. Keyed off status so
            it disappears the instant we flip to a cancelled/failed state. */}
        {payload.status === "processing" && (
          <button
            onClick={handleCancel}
            disabled={interruptMutation.isPending}
            className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              marginTop: 6,
              background: "oklch(0.62 0.20 25 / 0.08)",
              border: "1px solid oklch(0.62 0.20 25 / 0.35)",
              color: "oklch(0.66 0.20 25)",
              cursor: interruptMutation.isPending ? "wait" : "pointer",
            }}
          >
            <Ban className="w-3 h-3" />
            {interruptMutation.isPending ? "正在取消…" : "取消生成"}
          </button>
        )}

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Input handle — receives reference image */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image-in"
        style={{
          width: 12, height: 12,
          borderRadius: 3,
          background: "oklch(0.72 0.20 330 / 0.85)",
          border: "2px solid var(--c-canvas)",
          left: -6,
          top: "25%",
        }}
        title="参考图输入（img2img 使用）"
      />

      {/* Output handle — provided by BaseNode default (id="output" on Position.Right);
          no custom handle to avoid overlapping with the default. Downstream nodes
          consume payload.imageUrl directly via useWorkflowRunner's edge traversal. */}

      {/* Lightbox — controlled index so prev/next navigation and "select" work */}
      {lightboxIndex !== null && (() => {
        const images = payload.imageUrls && payload.imageUrls.length > 1
          ? payload.imageUrls
          : (payload.imageUrl ? [payload.imageUrl] : []);
        if (images.length === 0 || lightboxIndex >= images.length) return null;
        return (
          <ImageLightbox
            images={images}
            currentIndex={lightboxIndex}
            selectedUrl={payload.imageUrl ?? ""}
            onClose={() => setLightboxIndex(null)}
            onNavigate={(idx) => setLightboxIndex(idx)}
            onSelect={(url) => { selectImage(url); setLightboxIndex(null); }}
          />
        );
      })()}

      {/* Reference-image zoom (plain viewer) */}
      {refZoom && payload.referenceImageUrl && (
        <ImageLightbox
          images={[payload.referenceImageUrl]}
          currentIndex={0}
          onClose={() => setRefZoom(false)}
          onNavigate={() => {}}
        />
      )}

      {/* IPAdapter reference zoom (navigable across the multi-image set) */}
      {ipZoomIndex !== null && ipImages.length > 0 && ipZoomIndex < ipImages.length && (
        <ImageLightbox
          images={ipImages}
          currentIndex={ipZoomIndex}
          onClose={() => setIpZoomIndex(null)}
          onNavigate={(idx) => setIpZoomIndex(idx)}
        />
      )}
    </BaseNode>
  );
});

function ComfyConnectionStatus({
  isFetching,
  isError,
  errorMessage,
  ckptCount,
  loraCount,
  extraCounts,
}: {
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string;
  ckptCount: number;
  loraCount: number;
  extraCounts?: Array<{ label: string; count: number }>;
}) {
  if (isFetching) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-[10px]" style={{ color: "var(--c-t4)" }}>
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        正在拉取模型列表…
      </div>
    );
  }
  // Empty list AFTER a successful fetch usually means the server couldn't
  // reach ComfyUI (fetchModels server-side swallows errors). Surface a
  // diagnostic hint instead of leaving the user wondering why no models.
  const failed = isError || ckptCount === 0;
  if (failed) {
    return (
      <div className="flex items-start gap-1.5 mt-1.5 text-[10px]" style={{ color: "oklch(0.62 0.20 25)" }}>
        <span>⚠️</span>
        <span>
          未拉到模型 — 本应用服务器无法访问该 ComfyUI 地址。检查：① ComfyUI 用 --listen 0.0.0.0 启动；② 本服务器到该 IP 的网络可达；③ 端口防火墙；④ COMFYUI_BASE_URL 环境变量。
          {errorMessage ? <span style={{ display: "block", marginTop: 2, opacity: 0.7 }}>{errorMessage}</span> : null}
        </span>
      </div>
    );
  }
  const extras = (extraCounts ?? []).filter((e) => e.count > 0).map((e) => `${e.count} ${e.label}`);
  return (
    <div className="flex items-start gap-1.5 mt-1.5 text-[10px]" style={{ color: "oklch(0.65 0.18 145)" }}>
      <span>●</span>
      <span>
        已连接 — {ckptCount} 个 checkpoint{loraCount > 0 ? `、${loraCount} 个 LoRA` : ""}
        {extras.length > 0 ? <span style={{ color: "var(--c-t4)" }}>{`（${extras.join("、")}）`}</span> : null}
      </span>
    </div>
  );
}

