import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { BaseNode } from "../BaseNode";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { HideWhenStudioFloating } from "../../../contexts/StudioFloatingContext";
import { refUrls } from "../../../lib/referenceImages";
import { buildImageGenInput } from "../../../lib/imageGenBuild";
import { effectiveCharacters, stripCharacterMentions } from "../../../lib/characterConditioning";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { detectUpstreamPrompt, detectUpstreamImagesExpanded, stripMediaMentions } from "../../../lib/comfyWorkflowParams";
import { connectedEffectPrompts, appendEffectPrompts } from "../../../lib/effectPrompt";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { openNodeImage } from "../NodeImageLightbox";
import { Depth3DViewer } from "../Depth3DViewer";
import { Model3DViewer } from "../Model3DViewer";
import { useResultHistoryCapture } from "../../../hooks/useResultHistoryCapture";
import { ResultHistoryStrip } from "../ResultHistoryStrip";
import type { ResultSnapshot } from "../../../../../shared/types";
import { useWorkflowRunState } from "../../../contexts/WorkflowRunContext";
import { PromptDock } from "../PromptDock";
import { RefHeroPreview } from "../RefHeroPreview";
import { useNodeDocks, useCharSceneItems } from "../../../hooks/useNodeDocks";
import type { ImageGenNodeData, ImageGenModel, NodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, RefreshCw, Upload, X, Cpu, Check, Grid2X2, Download, ZoomIn, ChevronDown, ChevronRight, ChevronUp, Lock, Unlock, ImagePlus, AlertTriangle, Rotate3d, Boxes , ArrowUp, Palette, Plus, MapPin, Camera } from "lucide-react";
import { StylePicker } from "../StylePicker";
import { CameraRigPicker, stripCameraRig } from "../CameraRigPicker";
import { ToolChip, RefThumbRow, MarkElementPicker, MarkChipRow, loadMarkModel, saveMarkModel, switchMark, removeMark } from "../InlineBarParts";
import { nanoid } from "nanoid";
import { openNodeCompare } from "../CompareLightbox";
import { usePickStore } from "../../../hooks/usePickStore";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import { useMinimalDisplay } from "../../../hooks/useMinimalDisplay";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useFocusRefSource } from "../../../hooks/useFocusRefSource";
import { imageModelRequiresRef } from "../../../lib/models";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { downloadMedia } from "@/lib/download";
import { ImageLightbox } from "../ImageLightbox";
import { MediaImage } from "../MediaImage";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard, usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { COMFY_LOCAL_MODEL } from "@/lib/comfyLocalRoute";
import { buildLocalComfyImageInput } from "@/lib/comfyLocalImageGen";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { estimateImageCost, costEstimateLabel, KIE_IMAGE_RES_COST } from "@/lib/costEstimate";
import { SyncNodesDialog } from "../SyncNodesDialog";
import { ParamControls } from "../ParamControls";
import { IMAGE_MODEL_PARAMS, resolveImageParam } from "@/lib/paramDefs";
import { NodeTextArea } from "../NodeTextInput";
import { InlineGenBar } from "../InlineGenBar";
import { aspectFieldsFor } from "../../../lib/agentApply";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "image_gen";
    title: string;
    payload: ImageGenNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.72 0.20 330)";
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = `oklch(0.72 0.20 330 / 0.5)`;

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

const STYLES = ["写实", "动漫", "插画", "3D渲染", "水彩", "油画", "素描", "赛博朋克", "复古胶片"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1"];

// Soul Standard supported sizes (from official SDK)
// Soul Standard — server enforces a 13-value enum for `width_and_height`.
// Source: official higgsfield-js SDK src/helpers.ts SoulSize constant; also
// echoed in the 422 error response when an invalid value is sent. Picking
// anything outside this list (e.g. "1024x1024") returns Pydantic literal_error.
const SOUL_SIZES = [
  // Landscape
  "2048x1152", "2048x1536", "2016x1344", "1696x960", "1632x1088",
  // Portrait
  "1152x2048", "1536x2048", "1344x2016", "960x1696", "1088x1632",
  // Square / mixed
  "1536x1536", "1536x1152", "1152x1536",
] as const;

// Reve / Seedream / Flux Pro aspect_ratio enum — verified against the
// third-party reference impl (jeremieLouvaert/ComfyUI-Higgsfield-Direct).
// All v2 image endpoints share this set.
const REVE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const FLUX_PRO_ASPECT_RATIOS = REVE_ASPECT_RATIOS;

// v2 endpoints expect resolution as "1K" / "2K" / "4K", NOT "720p"/"1080p".
// Soul Standard (v1) is the only model that uses the px-based "720p"/"1080p".
const REVE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const ImageGenNode = memo(function ImageGenNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const connectState = useConnectState(id, "image_gen");
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  // LibTV 化 2.1：创意模式（uiStyle=pro + canvasMode=creative）启用就地生成输入条。
  const { uiStyle } = useUIStyle();
  const { mode: canvasMode } = useCanvasMode();
  const isCreativeMode = uiStyle !== "studio" && canvasMode === "creative";
  // LibTV：双击参考缩略图 → 聚焦至来源节点。
  const focusRefSource = useFocusRefSource(id);
  const [inlineParamsOpen, setInlineParamsOpen] = useState(false);
  // LibTV：创意模式配置区默认收起（就地输入条是主入口），点输入条「高级」才展开——
  // 否则选中节点配置区全高展开，会把锚在节点底部的输入条顶出视口（用户实测反馈）。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // LibTV：输入条「风格」chip 打开风格库，选中把风格片段追加到提示词。
  const [styleOpen, setStyleOpen] = useState(false);
  // #90 LibTV：输入条「摄像机」chip 打开摄像机参数选择器（与视频节点同款，注入提示词）。
  const [camRigOpen, setCamRigOpen] = useState(false);
  // LibTV 三段式输入条：顶部「＋参考」的隐藏文件选择器。
  const inlineRefFileRef = useRef<HTMLInputElement>(null);

  // ── LibTV 画布拾取（＋参考=从画布选参考 / 标记=元素选择模式）──
  // 拾取结果经 canvas:pick-result 派回；canvas:pick-upload = 浮条「本地上传」回落。
  const [markState, setMarkState] = useState<{ url: string; loading: boolean; error: string | null; elements: { name: string; desc?: string }[] } | null>(null);
  const analyzeMut = trpc.aiEnhance.analyzeImageElements.useMutation();
  // 标记分析用的视觉模型（全局偏好持久化）；换模型立即用新模型重跑分析。
  const [markModel, setMarkModel] = useState<string>(loadMarkModel);
  const runAnalyze = useCallback((url: string, model: string) => {
    setMarkState({ url, loading: true, error: null, elements: [] });
    analyzeMut.mutate({ imageUrl: url, model }, {
      onSuccess: (r) => setMarkState((s) => (s && s.url === url ? { ...s, loading: false, elements: r.elements } : s)),
      onError: (err) => setMarkState((s) => (s && s.url === url ? { ...s, loading: false, error: err.message } : s)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 「高级」展开态不跨选中记忆：取消选中即复位，下次点选默认收起、需再点「高级」才展开。
  useEffect(() => { if (!selected) setAdvancedOpen(false); }, [selected]);
  // 快捷键 A：选中时切换「高级」参数区（Canvas 派发 canvas:toggle-advanced）。
  useEffect(() => {
    if (!selected) return;
    const h = () => setAdvancedOpen((v) => !v);
    window.addEventListener("canvas:toggle-advanced", h);
    return () => window.removeEventListener("canvas:toggle-advanced", h);
  }, [selected]);
  const payload = data.payload;
  // Auto-prefer the upstream AI temporary public URL as the reference source when
  // the admin toggle is on and that URL probes alive (no-op when off / default).
  const preferUpstreamRef = usePreferUpstreamRefSource();
  useAutoPreferUpstreamRefSource({ nodeId: id, refImageUrl: payload.referenceImageUrl, enabled: preferUpstreamRef, onSwitch: (u) => updateNodeData(id, { referenceImageUrl: u }, true) });
  // Pull a connected upstream prompt (提示词 / 分镜) into this node's blank prompt —
  // image_gen advertises "← 提示词 / 分镜" as inputs but never consumed them. The
  // selector returns a primitive string, so it only re-renders when that text changes.
  const upstreamPrompt = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).positive);
  const upstreamNeg = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).negative);
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (upstreamPrompt && !payload.prompt?.trim()) patch.prompt = upstreamPrompt;
    if (upstreamNeg && !payload.negativePrompt?.trim()) patch.negativePrompt = upstreamNeg;
    if (Object.keys(patch).length) updateNodeData(id, patch, true); // fill-only-when-blank
  }, [upstreamPrompt, upstreamNeg, payload.prompt, payload.negativePrompt, id, updateNodeData]);
  const [uploading, setUploading] = useState(false);
  const [showSyncDlg, setShowSyncDlg] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refZoom, setRefZoom] = useState<number | null>(null);
  // 3D 换视角：打开 Depth3DViewer 的源图；pendingGen3d = 截图已插为参考图、等 re-render 后触发生成。
  const [view3dSrc, setView3dSrc] = useState<string | null>(null);
  // B 档「真3D」：把选中图交 Poyo Tripo3D 图生 .glb 网格，完整 360° 环绕后截图重绘。复用 pendingGen3d。
  const [model3dSrc, setModel3dSrc] = useState<string | null>(null);
  const [pendingGen3d, setPendingGen3d] = useState(false);
  // 打开真3D查看器：引擎选择/计费确认在查看器内完成；同源图已有模型则直接复用（免费重开）。
  const openTrue3d = useCallback(async (url: string) => {
    if (url) setModel3dSrc(url);
  }, []);
  // 悬浮工具条「3D / 真3D」跨组件信号（BaseNode → 本节点）：token 防重触发，
  // selector 返回原始 token 值（zustand「不返回新对象」铁律，与分镜 shotlist 同款）。
  const pseudo3dToken = useCanvasStore((s) => (s.panelRequest?.nodeId === id && s.panelRequest?.panel === "pseudo3d" ? s.panelRequest.token : 0));
  const true3dToken = useCanvasStore((s) => (s.panelRequest?.nodeId === id && s.panelRequest?.panel === "true3d" ? s.panelRequest.token : 0));
  useEffect(() => {
    if (pseudo3dToken > 0 && payload.imageUrl) setView3dSrc(payload.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudo3dToken]);
  useEffect(() => {
    if (true3dToken > 0 && payload.imageUrl) void openTrue3d(payload.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [true3dToken]);
  // Multi-reference-image list + left-docked expandable strip.
  const refImages = useReferenceImages(id, payload);
  // 画布拾取结果监听（需在 refImages 之后声明）。
  useEffect(() => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ forNodeId: string; kind: string; url: string }>).detail;
      if (d?.forNodeId !== id) return;
      if (d.kind === "ref") {
        // 同 URL 去重追加——重复点选同一产物时明确提示，避免误以为「覆盖/加不上」
        if (!refImages.addUrls([d.url], "url")) toast.info("该图已在参考列表中，未重复添加");
        return;
      }
      // mark：图加入参考（若未在），并启动元素分析
      if (!refImages.images.some((r) => r.url === d.url)) refImages.addUrls([d.url], "url");
      runAnalyze(d.url, markModel);
    };
    const onUpload = (e: Event) => {
      if ((e as CustomEvent<{ forNodeId: string }>).detail?.forNodeId !== id) return;
      inlineRefFileRef.current?.click();
    };
    window.addEventListener("canvas:pick-result", onResult);
    window.addEventListener("canvas:pick-upload", onUpload);
    return () => { window.removeEventListener("canvas:pick-result", onResult); window.removeEventListener("canvas:pick-upload", onUpload); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refImages.images, markModel]);
  // 上游图像（图像生成 / ComfyUI 图像·自定义 / 素材 / 分镜）自动作为参考图填充——
  // 仅当本节点尚无任何参考图时（fill-only-when-blank），绝不覆盖手动参考图，也不改变
  // 「无参考图时用连线角色」的既有优先级（角色不在图源类型里，单独走 connectedCharacterRefImages）。
  const upstreamRefKey = useCanvasStore((s) => detectUpstreamImagesExpanded(id, s.edges, s.nodes).join("\n"));
  // 有连线「角色」上游时，保留既有「无参考图→用连线角色」的优先级，不自动填上游图（避免破坏）。
  const hasUpstreamChar = useCanvasStore((s) => s.edges.some((e) => e.target === id && s.nodes.find((n) => n.id === e.source)?.data.nodeType === "character"));
  useEffect(() => {
    if (hasUpstreamChar) return;
    const list = upstreamRefKey ? upstreamRefKey.split("\n").filter(Boolean) : [];
    if (list.length === 0) return;
    const hasRefs = (payload.referenceImages?.length ?? 0) > 0 || !!payload.referenceImageUrl?.trim();
    if (hasRefs) return;
    refImages.addUrls(list, "upstream");
    // refImages 每渲染重建，但 hasRefs 守卫 + addUrls 去重使其幂等
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamRefKey, hasUpstreamChar, payload.referenceImages, payload.referenceImageUrl]);
  // 「最终提示词」= 真正会送去生成的正向词：本地/上游已自动填入 payload.prompt，
  // 这里再叠加「@角色 / 连线角色」结构化注入与 post_process 效果词，和 handleGenerate 同源。
  const finalPromptDisplay = useCanvasStore((s) => {
    const base = payload.prompt ?? "";
    const chars = effectiveCharacters(id, base, s.edges, s.nodes);
    return appendEffectPrompts(
      mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(base, s.nodes), s.nodes), chars),
      connectedEffectPrompts(id, s.edges, s.nodes),
    );
  });
  const hasCharInject = useCanvasStore((s) => effectiveCharacters(id, payload.prompt ?? "", s.edges, s.nodes).length > 0);
  // 左侧吸附窗 = 自有参考图（可编辑）+ 最终参与的角色/场景图（@提及或连线，只读），各带类型标签。
  const charSceneItems = useCharSceneItems(id, payload.prompt ?? "");
  const stripImages: StripItem[] = [
    ...refImages.images.map((img) => ({ ...img, label: "参考图", removable: true })),
    ...charSceneItems,
  ];
  const docks = useNodeDocks(id, { hasRef: true, /* 常开：空态悬停也能看到「上传/素材库」参考图入口 */ hasPrompt: !!finalPromptDisplay.trim() }, { prompt: finalPromptDisplay, ref: stripImages.map((i) => i.id).join(",") });
  const { refOpen: stripOpen, setRefOpen: setStripOpen } = docks;
  const [paramsExpanded, setParamsExpanded] = useState(false);
  // Derived, not local state — stays in sync with collaboration/undo updates
  const seedLocked = payload.seed != null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if we are in batch/grid mode
  const hasMultiple = (payload.imageUrls?.length ?? 0) > 1;

  // Reset lightbox when image data shape changes (avoids out-of-bounds index after batch→single switch)
  useEffect(() => {
    if (lightboxIndex === null) return;
    const len = hasMultiple ? (payload.imageUrls?.length ?? 0) : (payload.imageUrl ? 1 : 0);
    if (lightboxIndex >= len) setLightboxIndex(null);
  }, [hasMultiple, payload.imageUrls, payload.imageUrl, lightboxIndex]);

  // #140 放弃等待：云端生图是「提交即计费」的一次长请求，无法撤回；放弃 = 本地不再等、
  // 结果不回填（abandonedRef 守卫 onSuccess）。每次重新生成时复位。
  const abandonedRef = useRef(false);
  // 回填与报错抽成共享回调：云端 imageGen 与「本地 ComfyUI（自建算力）」两条生成路径复用同一套
  // 写回逻辑（结果形状都是 { url, urls?, sourceUrl?, sourceUrls?, sourceAt? }，ComfyUI 无 source* 字段
  // 时安全落 undefined）。
  const applyGenResult = useCallback((result: { url?: string; urls?: string[]; sourceUrl?: string; sourceUrls?: string[]; sourceAt?: number }) => {
    if (abandonedRef.current) return; // 用户已放弃等待——结果丢弃，不回填
    // Guard: node may have been deleted while generation was in flight
    if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
    if (result.urls && result.urls.length > 1) {
      updateNodeData(id, {
        imageUrls: result.urls,
        imageUrl: result.urls[0],
        imageUrlSources: result.sourceUrls,
        imageUrlSource: result.sourceUrls?.[0] ?? result.sourceUrl,
        imageUrlSourceAt: result.sourceAt,
      });
      propagateRefImage(id, result.urls[0]);
      toast.success(`批量生成完成，共 ${result.urls.length} 张图像`);
    } else {
      const imageUrl = result.url ?? result.urls?.[0];
      if (!imageUrl) { toast.error("生成完成但未返回图像"); return; }
      updateNodeData(id, {
        imageUrl,
        imageUrls: undefined,
        imageUrlSource: result.sourceUrl ?? result.sourceUrls?.[0],
        imageUrlSources: undefined,
        imageUrlSourceAt: result.sourceAt,
      });
      propagateRefImage(id, imageUrl);
      toast.success("图像生成成功");
    }
  }, [id, updateNodeData, propagateRefImage]);
  const applyGenError = useCallback((err: { message: string }) => {
    if (abandonedRef.current) return; // 已放弃——错误也不打扰
    toast.error("图像生成失败：" + err.message);
  }, []);
  const genMutation = trpc.imageGen.generate.useMutation({ onSuccess: applyGenResult, onError: applyGenError });
  // #87 自建算力：模型选「本地 ComfyUI」时改走此 mutation（comfyui.generateImage，txt2img/img2img）。
  const comfyLocalMut = trpc.comfyui.generateImage.useMutation({ onSuccess: applyGenResult, onError: applyGenError });
  // 两条生成路径合一的「进行中」状态，供按钮禁用/转圈统一读取。
  const isGenerating = genMutation.isPending || comfyLocalMut.isPending;

  const uploadMutation = trpc.upload.uploadImage.useMutation();

  // Upload image files and insert them into the reference list at `index`.
  // Used by both the inline upload button (append) and the strip's drag-in
  // (smart-sorted by drop position).
  const uploadFilesToRef = useCallback(async (files: File[], index: number) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { toast.error("请选择图片文件"); return; }
    setUploading(true);
    let at = index;
    try {
      for (const file of imgs) {
        if (file.size > 16 * 1024 * 1024) { toast.error(`${file.name} 超过 16MB`); continue; }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        const result = await uploadMutation.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
        refImages.insertUrls([result.url], at, "upload");
        at++;
      }
      toast.success("参考图上传成功");
    } catch (err) {
      toast.error("参考图上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }, [id, refImages, uploadMutation]);

  const update = useCallback(
    (field: keyof ImageGenNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const handlePropagateSeed = useCallback(() => {
    if (payload.seed == null) return;
    const { nodes: allNodes, edges: allEdges, batchUpdateNodeData } = useCanvasStore.getState();
    const updates = allEdges
      .filter(e => e.source === id)
      .flatMap<{ id: string; payload: Partial<NodeData> }>(edge => {
        const target = allNodes.find(n => n.id === edge.target);
        if (!target) return [];
        const nt = target.data.nodeType;
        if (nt !== "storyboard" && nt !== "image_gen" && nt !== "video_task") return [];
        // video_task 的种子存在 payload.params.seed（ParamDef），不是顶层 payload.seed——
        // 顶层写入视频节点永远读不到（曾致「传播成功」但实际未生效）。按目标类型写对字段，
        // 并保留该节点其余 params。
        if (nt === "video_task") {
          const params = ((target.data.payload as { params?: Record<string, unknown> }).params) ?? {};
          if (params.seed === payload.seed) return [];
          return [{ id: edge.target, payload: { params: { ...params, seed: payload.seed } } }];
        }
        // Skip targets that already hold the same seed — avoid store churn
        // and misleading "propagated to N nodes" toasts when nothing changed
        const currentSeed = (target.data.payload as { seed?: number }).seed;
        if (currentSeed === payload.seed) return [];
        return [{ id: edge.target, payload: { seed: payload.seed } }];
      });
    if (updates.length > 0) {
      batchUpdateNodeData(updates);
      toast.success(`种子 ${payload.seed} 已传播到 ${updates.length} 个节点`);
    } else {
      toast.info("下游节点种子已是最新或没有支持种子的下游节点");
    }
  }, [id, payload.seed]);

  // 批量「运行全部」进行中：runner 用它自己的 mutation 实例跑本节点，本节点 isGenerating
  // 却为 false，导致手动「运行」可对同一节点再发一次 → 双扣费/占卡。批量运行中禁用手动运行。
  const batchRunning = useWorkflowRunState().running;

  const handleGenerate = () => {
    if (isGenerating) return;
    if (batchRunning) { toast.error("批量运行进行中，请等待完成后再单独运行"); return; }
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    // 组装逻辑抽到纯函数 buildImageGenInput（与「运行全部」runner 同一事实源，防两侧漂移）。
    const { edges: gedges, nodes: gnodes } = useCanvasStore.getState();
    const built = buildImageGenInput({
      id, payload, nodes: gnodes, edges: gedges,
      defaultModel: resolve("image_gen", "image"),
      kieTempKey: localStorage.getItem("kie:tempKey"),
    });
    if (built.blocked) { toast.error(built.blocked); return; }
    abandonedRef.current = false; // 新一轮生成：复位「放弃等待」标记
    // #87 自建算力：走本地 ComfyUI（无参考=txt2img，有参考=img2img），复用全局地址/checkpoint。
    if ((payload.model as string | undefined) === COMFY_LOCAL_MODEL) {
      const bi = built.input as { prompt?: string; style?: string; negativePrompt?: string };
      // 比例/张数是通用字段（ImageGenNodeData 类型未显式声明，运行时存在，与 buildImageGenInput 同款 cast）。
      const g = payload as unknown as { aspectRatio?: string; imageSize?: string; poyoAspectRatio?: string; imageN?: number };
      const local = buildLocalComfyImageInput({
        prompt: bi.prompt ?? payload.prompt ?? "",
        style: bi.style ?? payload.style,
        negativePrompt: bi.negativePrompt ?? payload.negativePrompt,
        refUrl: built.refUrl,
        aspect: g.aspectRatio || g.imageSize || g.poyoAspectRatio,
        batch: g.imageN,
        projectId: data.projectId,
        nodeId: id,
      });
      if (!local.ok) { toast.error(local.blocked); return; }
      comfyLocalMut.mutate(local.input);
      return;
    }
    const submit = () => genMutation.mutate({
      ...(built.input as Parameters<typeof genMutation.mutate>[0]),
      projectId: data.projectId,
    });
    guard({ model: payload.model ?? resolve("image_gen", "image"), refImageUrl: built.refUrl }, submit);
  };

  // #140 放弃等待：本地解锁按钮与状态；云端生成继续（提交即计费，不可撤回），结果不回填。
  const abandonWait = () => {
    abandonedRef.current = true;
    genMutation.reset();
    comfyLocalMut.reset(); // 自建算力路径同样解锁
    toast.info("已放弃等待：节点已解锁。云端生成仍在进行（费用照常发生），其结果不会回填本节点", { duration: 7000 });
  };

  // 3D 换视角截图已插为首位参考图后，等 payload.referenceImages re-render 反映到位再触发生成，
  // 避免同 tick 调 handleGenerate 读到旧 payload（buildImageGenInput 读 prop）。
  useEffect(() => {
    if (!pendingGen3d) return;
    if (uploading || isGenerating) return;
    setPendingGen3d(false);
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGen3d, uploading, payload.referenceImages, payload.referenceImageUrl]);

  // #5 版本历史：采集用共享 hook；回滚把某条快照写回当前结果（进撤销栈，便于再撤销回来）。
  useResultHistoryCapture(id, { current: payload.imageUrl, urls: payload.imageUrls, prompt: payload.prompt, history: payload.resultHistory });
  const rollbackToSnapshot = useCallback((snap: ResultSnapshot) => {
    updateNodeData(id, { imageUrl: snap.url, imageUrls: snap.urls ?? [snap.url] });
  }, [id, updateNodeData]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void uploadFilesToRef(files, refImages.images.length);
  };

  const handleSelectImage = (url: string) => {
    // Keep imageUrlSource aligned with the newly selected batch image so the
    // downstream "switch to AI-platform URL" fallback maps to the right source.
    const idx = payload.imageUrls?.indexOf(url) ?? -1;
    const matchedSource = idx >= 0 ? payload.imageUrlSources?.[idx] : undefined;
    updateNodeData(id, { imageUrl: url, ...(matchedSource !== undefined ? { imageUrlSource: matchedSource } : {}) });
    const n = propagateRefImage(id, url);
    toast.success(n > 0 ? `已选择图像并更新 ${n} 个下游节点` : "已选择此图像");
  };

  const handleClearBatch = () => {
    updateNodeData(id, { imageUrls: undefined, imageUrl: undefined });
  };

  const handleDownloadImage = (url: string) => {
    void downloadMedia(url, `generated-${Date.now()}.png`, "image");
  };

  const handleDownloadSelected = () => handleDownloadImage(payload.imageUrl ?? "");

  const isSoul = payload.model === "hf_soul_standard";
  const isReve = payload.model === "hf_reve";
  const isSeedreamV4 = payload.model === "hf_seedream_v4";
  const isFluxPro = payload.model === "hf_flux_pro";
  const isManus = payload.model === "manus_forge";
  // Models that use the collapsible params panel
  const isReveLike = isReve || isSeedreamV4 || isFluxPro;

  // 实时点数预估：单价 × 张数（Soul 批量 / Flux 多图 / Poyo imageN），模型或数量一变即重算。
  const genCount = (() => {
    const poyoN = (payload as unknown as { imageN?: number }).imageN ?? 1;
    if (isSoul && (payload.batchSize ?? 1) > 1) return payload.batchSize ?? 1;
    if (isFluxPro && (payload.fluxNumImages ?? 1) > 1) return payload.fluxNumImages ?? 1;
    return poyoN > 1 ? poyoN : 1;
  })();
  const genCostLabel = costEstimateLabel(estimateImageCost(payload.model || resolve("image_gen", "image"), genCount, { resolution: payload.imageResolution }));

  // Collapse the params panel when switching model — old expansion state doesn't apply to a new param set
  useEffect(() => {
    setParamsExpanded(false);
  }, [payload.model]);

  // 绿点指示：结果图是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const imgStoredInMinio = isOwnStorageUrl(payload.imageUrl);

  // 收缩态 hero 兜底：尚无生成结果、但已有参考图时，用参考图作为预览。
  // 否则工作室收缩后（无 inline body）整个节点只剩标题栏，参考图根本看不见。
  const heroRefUrl = refImages.images[0]?.url ?? payload.referenceImageUrl ?? payload.referenceImages?.[0];

  // 多图 hero（LibTV 多图模式）：默认堆叠——只显当前选中图、右下露叠层卡边、
  // 「N 张」角标展开为画布内网格（heroView="grid"，每张 hover 下载/设为主图，
  // 主图「收起」回堆叠）、两侧悬停箭头切换当前图。
  // #109 极简显示（Alt+Q）：多产物强制网格平铺（堆叠只显一张，选片场景看不全）
  const minimalDisplay = useMinimalDisplay();
  const heroShowStack = hasMultiple && isCreativeMode && !!payload.imageUrl && payload.heroView !== "grid" && !minimalDisplay;
  // #125 极简下默认平铺（#109），但可经 minimalCollapsed 收起为单张（网格右上角「收起」钮）。
  const heroShowGrid = hasMultiple && !heroShowStack && (minimalDisplay ? payload.minimalCollapsed !== true : payload.heroView !== "single");
  const stackOthers = heroShowStack ? (payload.imageUrls ?? []).filter((u) => u !== payload.imageUrl) : [];
  const stackCycle = (dir: 1 | -1) => {
    const urls = payload.imageUrls ?? [];
    if (urls.length < 2) return;
    const cur = Math.max(0, urls.indexOf(payload.imageUrl ?? ""));
    handleSelectImage(urls[(cur + dir + urls.length) % urls.length]);
  };
  const heroMedia = heroShowStack ? (
    <div className="relative" style={{ padding: "0 10px 10px 0" }}>
      {stackOthers.slice(0, 2).map((u, i) => (
        <div key={u} className="absolute overflow-hidden rounded-xl pointer-events-none"
          style={{ top: (i + 1) * 5, left: (i + 1) * 5, right: 10 - (i + 1) * 5, bottom: 10 - (i + 1) * 5, opacity: i === 0 ? 0.9 : 0.55, zIndex: 0, border: "1px solid var(--c-bd2)", background: "var(--c-canvas)" }}>
          <MediaImage src={u} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      ))}
      <div className="relative overflow-hidden rounded-xl group" style={{ zIndex: 1, background: "var(--c-canvas)" }}>
        <MediaImage src={payload.imageUrl!} alt="generated" className="w-full" draggable={false} style={{ display: "block" }} />
        {imgStoredInMinio && (
          <div title="已存储到 MinIO·长期有效" className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
            style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }} />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); update("heroView", "grid"); }}
          title={`共 ${payload.imageUrls!.length} 张，点击展开为网格（每张可下载/设为主图）`}
          className="nodrag absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold"
          style={{ background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(8px)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(1 0 0 / 0.18)", color: "#fff" }}
        >
          <Grid2X2 className="w-3 h-3" />
          {payload.imageUrls!.length} 张
        </button>
        {([[-1, "‹", "上一张", { left: 6 }] as const, [1, "›", "下一张", { right: 6 }] as const]).map(([dir, glyph, tip, pos]) => (
          <button key={glyph}
            onClick={(e) => { e.stopPropagation(); stackCycle(dir); }}
            title={`${tip}（共 ${payload.imageUrls!.length} 张）`}
            className="nodrag absolute z-10 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ ...pos, top: "50%", transform: "translateY(-50%)", width: 30, height: 30, borderRadius: 99, background: "oklch(0 0 0 / 0.55)", border: "1px solid oklch(1 0 0 / 0.2)", color: "#fff", fontSize: 17, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  ) : heroShowGrid ? (
    /* #77 网格视图按钮重排：网格级「收起」从图面移到常驻头行（不再与每图 hover 的
       「下载」挤在右上角）；每图 hover 改为底部渐变 + 图标圆钮（下载/设为主图），
       可视性与命中率都更好。 */
    <div className="relative flex flex-col">
      {/* #125 极简显示：网格右上角常显半透明「收起」钮（头行被极简隐藏，需独立控制） */}
      {minimalDisplay && (
        <button
          className="nodrag absolute top-2 right-2 z-10 flex items-center gap-1"
          title="收起为单张预览（仅极简显示形态）"
          onClick={(e) => { e.stopPropagation(); update("minimalCollapsed", true); }}
          style={{ padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: "oklch(0 0 0 / 0.6)", border: "1px solid oklch(1 0 0 / 0.25)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)", opacity: 0.8 }}
        >
          <ChevronUp style={{ width: 11, height: 11 }} /> 收起
        </button>
      )}
      {!minimalDisplay && (
      <div className="nodrag flex items-center justify-between" style={{ padding: "6px 10px 0" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t4)" }}>{payload.imageUrls!.length} 张 · 网格视图</span>
        <button
          className="nodrag flex items-center gap-1"
          title="收起为堆叠视图"
          onClick={(e) => { e.stopPropagation(); update("heroView", "single"); }}
          style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
        >
          <ChevronUp style={{ width: 11, height: 11 }} /> 收起
        </button>
      </div>
      )}
      <div
        className="grid gap-1 p-2"
        style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
      >
        {payload.imageUrls!.map((url, idx) => {
          const isSelected = url === payload.imageUrl;
          const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "oklch(0 0 0 / 0.66)", border: "1px solid oklch(1 0 0 / 0.28)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)", padding: 0 };
          return (
            <div key={idx} className="relative rounded-lg overflow-hidden group" style={{ background: "var(--c-canvas)" }}>
              <MediaImage
                src={url}
                alt={`generated-${idx}`}
                className="w-full"
                draggable={false}
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
                  title="当前主图"
                  className="absolute top-1 right-1 rounded-full flex items-center justify-center pointer-events-none"
                  style={{ width: 16, height: 16, background: accent }}
                >
                  <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
                </div>
              )}
              {/* hover：底部渐变 + 图标圆钮（下载 / 设为主图），不再遮挡图片上缘 */}
              <div className="absolute inset-x-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-2 pb-1.5 pt-4"
                style={{ background: "linear-gradient(oklch(0 0 0 / 0) 0%, oklch(0 0 0 / 0.55) 100%)" }}>
                <button className="nodrag" style={iconBtn} title="下载这张图"
                  onClick={(e) => { e.stopPropagation(); handleDownloadImage(url); }}>
                  <Download style={{ width: 12, height: 12 }} />
                </button>
                {!isSelected && (
                  <button className="nodrag" style={iconBtn} title="设为当前主图（同步下游节点）"
                    onClick={(e) => { e.stopPropagation(); handleSelectImage(url); }}>
                    <ImagePlus style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : payload.imageUrl ? (
    <div className="relative overflow-hidden group" style={{ width: "100%" }}>
      <MediaImage
        src={payload.imageUrl}
        alt="generated"
        className="w-full"
        draggable={false}
        style={{ display: "block" }}
      />
      {/* #128 右上角操作行：放大（hover 浮现）+ #125 极简收起态的「展开 N 张」。
          原预览中央的「放大 / 3D 换视角 / 真3D」浮层按用户要求取消——遮挡画面；
          3D 两个入口在选中节点的上浮工具条常驻（BaseNode），能力不丢失。 */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        {minimalDisplay && hasMultiple && payload.minimalCollapsed === true && (
          <button
            className="nodrag flex items-center gap-1"
            title="展开为平铺网格（仅极简显示形态）"
            onClick={(e) => { e.stopPropagation(); update("minimalCollapsed", false); }}
            style={{ padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: "oklch(0 0 0 / 0.6)", border: "1px solid oklch(1 0 0 / 0.25)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)", opacity: 0.8 }}
          >
            <ChevronDown style={{ width: 11, height: 11 }} /> 展开 {payload.imageUrls!.length} 张
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setLightboxIndex(0); }}
          title="放大预览"
          className="nodrag opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
          style={{ padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: "oklch(0 0 0 / 0.6)", border: "1px solid oklch(1 0 0 / 0.25)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)" }}
        >
          <ZoomIn style={{ width: 11, height: 11 }} /> 放大
        </button>
      </div>
      {imgStoredInMinio && (
        <div
          title="已存储到 MinIO·长期有效"
          className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
          style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
        />
      )}
    </div>
  ) : heroRefUrl ? (
    // 无结果但有参考图 → 收缩时把参考图当 hero 预览（避免只剩标题栏、参考图看不见）。
    <RefHeroPreview url={heroRefUrl} />
  ) : null;

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="image_gen" title={data.title} minHeight={300} heroMedia={heroMedia}
      onRun={handleGenerate} running={isGenerating} canRun={!!payload.prompt?.trim()} hasResult={!!payload.imageUrl}
      onCancelGenerate={isGenerating ? abandonWait : undefined}
      onAssetImageDrop={(urls) => refImages.addUrls(urls, "drop")}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      extraHandles={
        <Handle
          type="source"
          position={Position.Right}
          id="image-out"
          style={{ ...handleStyle(accent, handlesActive, "circle", connectState.source), top: "75%", right: -7 }}
          title="图像输出 → 连接到视频任务参考图"
        />
      }
      leftDock={
        <>
          <ReferenceImageStrip
            images={stripImages}
            open={stripOpen}
            accent={accent}
            onClose={() => setStripOpen(false)}
            onRemove={refImages.removeId}
            onMove={refImages.moveId}
            onInsertUrls={(urls, index) => refImages.insertUrls(urls, index, "drop")}
            onDropFiles={(files, index) => void uploadFilesToRef(files, index)}
            onZoom={(i) => { const u = stripImages[i]?.url; if (u) openNodeImage(u); }}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinRef}
          />
          <PromptDock
            open={docks.promptOpen}
            text={finalPromptDisplay}
            negText={payload.negativePrompt}
            source={hasCharInject ? "含角色" : undefined}
            accent={accent}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }>
      {/* 创意模式收起态（未展开高级）：body 内容全被隐藏，padding/gap 一并归零，
          否则点击带结果节点后预览下会剩一块空 padding 灰条。 */}
      <div className="flex flex-col h-full overflow-auto" style={isCreativeMode && !advancedOpen ? { padding: 0, gap: 0 } : { padding: 14, gap: 12 }}>

        {/* #5 版本历史：历次产出的结果快照，点击回滚（共享组件）。创意收起态隐藏（预览下不留条）。
            hover 单项出「对比」→ 就地全屏滑块对比（A=当前结果 B=该版本），不建节点。 */}
        {!(isCreativeMode && !advancedOpen) && (
          <ResultHistoryStrip history={payload.resultHistory} currentUrl={payload.imageUrl} accent={accent} onRollback={rollbackToSnapshot}
            onCompare={(snap) => { if (payload.imageUrl) openNodeCompare(payload.imageUrl, snap.url); }} />
        )}

        {/* ── Batch grid result ── (hidden inside the studio floating panel — the
            node card's hero preview already shows the result there → no duplicate) */}
        <HideWhenStudioFloating>
        {hasMultiple ? (
          <div className="flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4 }}>
                <Grid2X2 style={{ width: 10, height: 10 }} />
                {payload.imageUrls!.length} 张图像 · 点击选择
              </span>
              <div className="flex gap-1">
                {/* 折叠预览模式：网格 / 单图 */}
                <div className="flex items-center rounded overflow-hidden" style={{ border: `1px solid ${BORDER_DEFAULT}` }} title="预览形态：展开网格 / 堆叠（默认）">
                  {(["grid", "single"] as const).map((mode) => {
                    const active = (payload.heroView ?? (isCreativeMode ? "single" : "grid")) === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => update("heroView", mode)}
                        className="nodrag flex items-center gap-1 px-1.5 py-0.5"
                        style={{ fontSize: 9.5, background: active ? accent : "transparent", color: active ? "white" : "var(--c-t3)" }}
                        title={mode === "grid" ? "展开为网格（每张可下载/设为主图）" : "堆叠视图（默认）：当前图 + 叠层卡边"}
                      >
                        {mode === "grid" ? <Grid2X2 style={{ width: 10, height: 10 }} /> : <ImagePlus style={{ width: 10, height: 10 }} />}
                        {mode === "grid" ? "网格" : "堆叠"}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "oklch(0.72 0.20 330 / 0.12)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_ACCENT, color: accent, fontSize: 10 }}
                >
                  {isGenerating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                  重新生成
                </button>
                <button
                  onClick={handleClearBatch}
                  className="nodrag flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: "var(--c-surface)", borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, color: "var(--c-t3)", fontSize: 10 }}
                >
                  <X className="w-2.5 h-2.5" />
                  清空
                </button>
              </div>
            </div>

            {/* Grid */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: payload.imageUrls!.length === 4 ? "1fr 1fr" : `repeat(${Math.min(payload.imageUrls!.length, 3)}, 1fr)` }}
            >
              {payload.imageUrls!.map((url, idx) => {
                const isSelected = url === payload.imageUrl;
                return (
                  // 结果图可拖出：写 text/uri-list + text/plain，让参考图条/其它节点(读同一 MIME)直接接住。
                  // 用 div[role=button] 而非 <button>，以便在内部嵌套逐图操作按钮（button 不可嵌套 button）。
                  <div
                    key={idx}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/uri-list", url);
                      e.dataTransfer.setData("text/plain", url);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setLightboxIndex(idx)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightboxIndex(idx); } }}
                    className="nodrag relative rounded-lg overflow-hidden group"
                    style={{
                      aspectRatio: "1/1",
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: isSelected ? accent : "transparent",
                      background: "var(--c-canvas)",
                      padding: 0,
                      cursor: "grab",
                      transition: "border-color 150ms ease, opacity 150ms ease",
                      opacity: isSelected ? 1 : 0.72,
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = "0.72"; }}
                  >
                    <MediaImage
                      src={url}
                      alt={`generated-${idx}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {/* Selected checkmark */}
                    {isSelected && (
                      <div
                        className="absolute top-1 right-1 rounded-full flex items-center justify-center"
                        style={{ width: 16, height: 16, background: accent }}
                      >
                        <Check style={{ width: 10, height: 10, color: "var(--c-canvas)" }} />
                      </div>
                    )}
                    {/* Hover overlay：放大 / 下载此图 / 设为封面（逐图操作），拖动可拖到参考图条或其它节点 */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5"
                      style={{ background: "oklch(0 0 0 / 0.45)" }}
                    >
                      <div className="rounded-md flex items-center justify-center" title="放大预览" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)" }}>
                        <ZoomIn style={{ width: 14, height: 14, color: "#fff" }} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadImage(url); }}
                        className="nodrag rounded-md flex items-center justify-center"
                        title="下载此图" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)", border: "none", cursor: "pointer" }}
                      >
                        <Download style={{ width: 13, height: 13, color: "#fff" }} />
                      </button>
                      {!isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectImage(url); }}
                          className="nodrag rounded-md flex items-center justify-center"
                          title="设为封面（选为此节点输出）" style={{ width: 24, height: 24, background: "oklch(0 0 0 / 0.5)", border: "none", cursor: "pointer" }}
                        >
                          <Check style={{ width: 14, height: 14, color: "#fff" }} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected image preview (larger) */}
            {payload.imageUrl && (
              <div
                className="mt-1.5 rounded-lg overflow-hidden"
                style={{ borderWidth: 1, borderStyle: "solid", borderColor: `oklch(0.72 0.20 330 / 0.3)`, background: "var(--c-canvas)" }}
              >
                <div className="flex items-center justify-between" style={{ padding: "3px 8px", borderBottom: `1px solid oklch(0.72 0.20 330 / 0.15)` }}>
                  <span style={{ fontSize: 9, color: accent, letterSpacing: "0.05em", fontWeight: 600 }}>✓ 已选择</span>
                  <button
                    onClick={handleDownloadSelected}
                    className="nodrag flex items-center gap-0.5"
                    style={{ fontSize: 9, color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 0 }}
                    title="下载此图像"
                  >
                    <Download style={{ width: 9, height: 9 }} />
                    下载
                  </button>
                </div>
                <MediaImage
                  src={payload.imageUrl}
                  alt="selected"
                  className="w-full object-contain"
                  style={{ maxHeight: 120 }}
                  draggable={false}
                />
              </div>
            )}
          </div>
        ) : (
          /* ── Single image result ── */
          payload.imageUrl ? (
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
              <MediaImage
                src={payload.imageUrl}
                alt="generated"
                className="w-full h-full object-contain"
                draggable={false}
              />
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                <button
                  onClick={() => setLightboxIndex(0)}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
                >
                  <ZoomIn className="w-3 h-3" />
                  放大
                </button>
                <button
                  onClick={handleDownloadSelected}
                  className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(10px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)" }}
                >
                  <Download className="w-3 h-3" />
                  下载
                </button>
                {/* 重新生成已移至标题栏常驻按钮，避免与"放大"相邻误点浪费点数 */}
              </div>
            </div>
          ) : (
            <div
              className="node-empty-placeholder rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ aspectRatio: "16/9", borderWidth: 1, borderStyle: "dashed", borderColor: `oklch(0.72 0.20 330 / 0.25)`, background: `oklch(0.72 0.20 330 / 0.04)` }}
            >
              <div className="flex flex-col items-center gap-1.5" style={{ color: "oklch(0.72 0.20 330 / 0.5)" }}>
                <Sparkles style={{ width: 24, height: 24 }} />
                <span style={{ fontSize: 11 }}>生成图像将显示在这里</span>
              </div>
            </div>
          )
        )}
        </HideWhenStudioFloating>

        {/* ── Input area (collapsed when not selected, kept open if pinned) ──
            创意模式：默认收起，由就地输入条「高级」开关展开（防节点过高顶飞输入条）。 */}
        <div
          style={(() => {
            const open = isCreativeMode ? advancedOpen : expanded;
            return {
              overflow: "hidden",
              maxHeight: open ? "9999px" : "0px",
              transition: open
                ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
                : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
            };
          })()}
        >

        {/* Model selector */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            模型
          </label>
          <ModelPicker
            value={payload.model ?? resolve("image_gen", "image")}
            onChange={(v) => update("model", v as ImageGenModel)}
            options={IMAGE_MODEL_PICKER_OPTIONS}
          />
          {/* #87 自建算力：选「本地 ComfyUI」时展示地址 + checkpoint（全能服务器管理器，全局共享）。 */}
          {(payload.model as string | undefined) === COMFY_LOCAL_MODEL && (
            <div style={{ marginTop: 8 }}><ComfyCkptSelect enabled width={180} /></div>
          )}
          {/* 编辑 / 图生图模型必须有参考图——缺图时提前提示，避免提交后才被上游退回扣费 */}
          {imageModelRequiresRef(payload.model) && stripImages.length === 0 && (
            <div style={{
              marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 11,
              color: "oklch(0.62 0.20 25)", background: "oklch(0.62 0.20 25 / 0.08)",
              border: "1px solid oklch(0.62 0.20 25 / 0.28)", borderRadius: 6, padding: "4px 7px",
            }}>
              <AlertTriangle className="w-3 h-3" style={{ flexShrink: 0 }} />
              此模型为图生图 / 编辑，需先连接或上传参考图
            </div>
          )}
        </div>
        {/* 同步模型与参数到同类图像生成节点（弹窗勾选） */}
        <button
          onClick={() => setShowSyncDlg(true)}
          title="把当前模型与全部参数同步到所选图像生成节点（弹窗勾选，默认同工作流）"
          className="nodrag flex items-center justify-center gap-1 rounded-lg text-[10.5px] py-1 transition-all"
          style={{ marginTop: 6, width: "100%", background: "oklch(0.66 0.19 300 / 0.08)", border: "1px dashed oklch(0.66 0.19 300 / 0.4)", color: "oklch(0.74 0.16 300)", cursor: "pointer" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.66 0.19 300 / 0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.66 0.19 300 / 0.08)"; }}
        >
          <Grid2X2 className="w-3 h-3" /> 同步模型与参数到其它图像节点
        </button>
        {showSyncDlg && (
          <SyncNodesDialog
            sourceId={id}
            nodeType="image_gen"
            typeLabel="图像生成"
            patch={{ model: payload.model, negativePrompt: payload.negativePrompt, style: payload.style, aspectRatio: payload.aspectRatio, poyoQuality: payload.poyoQuality, widthAndHeight: payload.widthAndHeight, soulQuality: payload.soulQuality, batchSize: payload.batchSize, seed: payload.seed, enhancePrompt: payload.enhancePrompt, reveAspectRatio: payload.reveAspectRatio, reveResolution: payload.reveResolution, fluxGuidanceScale: payload.fluxGuidanceScale, fluxSeed: payload.fluxSeed, fluxNumImages: payload.fluxNumImages }}
            onClose={() => setShowSyncDlg(false)}
          />
        )}

        {/* Prompt */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <NodeTextArea className="nodrag nowheel"
            placeholder="描述你想生成的图像..."
            value={payload.prompt ?? ""}
            onValueChange={(v) => update("prompt", v)}
            rows={3}

            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Negative prompt */}
        <div>
          <label style={labelStyle}>反向提示词</label>
          <NodeTextArea className="nodrag nowheel"
            placeholder="blurry, low quality..."
            value={payload.negativePrompt ?? ""}
            onValueChange={(v) => update("negativePrompt", v)}
            rows={2}

            style={{ ...fieldBase, resize: "none", lineHeight: 1.6, fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Reve params are now inside the collapsible block below */}

        {/* Style + Ratio (non-Soul, non-Reve/Seedream/FluxPro models) */}
        {!isSoul && !isReveLike && (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label style={labelStyle}>风格</label>
                <select
                  value={payload.style ?? ""}
                  onChange={(e) => update("style", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="">默认</option>
                  {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* 比例选择器仅用于既没有 schema 参数、且非 Manus 的旧模型；
                  Poyo 模型的尺寸/比例改由下方 ParamControls 渲染（schema 驱动），
                  Manus Forge 服务端忽略比例所以隐藏。 */}
              {!isManus && payload.model && !IMAGE_MODEL_PARAMS[payload.model] && (
                <div style={{ width: 80 }}>
                  <label style={labelStyle}>比例</label>
                  <select
                    value={payload.aspectRatio ?? ""}
                    onChange={(e) => update("aspectRatio", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldBase, cursor: "pointer" }}
                  >
                    {(RATIOS as readonly string[]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              {/* kie 分辨率档（如 GPT Image 2 1K/2K/4K = 6/10/16 点，逐档计价） */}
              {payload.model && KIE_IMAGE_RES_COST[payload.model] && (
                <div style={{ width: 72 }}>
                  <label style={labelStyle} title={Object.entries(KIE_IMAGE_RES_COST[payload.model]).map(([k, v]) => `${k}=${v}点`).join(" / ")}>分辨率</label>
                  <select
                    value={payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[payload.model])[0]}
                    onChange={(e) => update("imageResolution", e.target.value)}
                    className="nodrag"
                    style={{ ...fieldBase, cursor: "pointer" }}
                  >
                    {Object.keys(KIE_IMAGE_RES_COST[payload.model]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Poyo 模型参数控件（schema 驱动）—— 替代原 Poyo 专属比例/GPT 质量硬编码区块 */}
        {payload.model && IMAGE_MODEL_PARAMS[payload.model] && IMAGE_MODEL_PARAMS[payload.model].length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <ParamControls
              defs={IMAGE_MODEL_PARAMS[payload.model]}
              values={payload as unknown as Record<string, unknown>}
              onChange={(key, value) => update(key as keyof ImageGenNodeData, value as never)}
            />
          </div>
        )}

        {/* Soul / Reve / Seedream v4 / Flux Pro specific params — collapsible */}
        {(isSoul || isReveLike) && (
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
                模型参数
              </span>
              {paramsExpanded
                ? <ChevronDown className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
                : <ChevronRight className="w-3 h-3" style={{ color: "var(--c-t4)" }} />
              }
            </button>
            {paramsExpanded && (
              <div className="px-3 pb-3 flex flex-col gap-2.5">
                {/* Soul Standard params */}
                {isSoul && <>
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label style={labelStyle}>尺寸</label>
                <select
                  value={payload.widthAndHeight ?? "1024x1024"}
                  onChange={(e) => update("widthAndHeight", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  {SOUL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>质量</label>
                <select
                  value={payload.soulQuality ?? "720p"}
                  onChange={(e) => update("soulQuality", e.target.value as "720p" | "1080p")}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>
            <div className="flex gap-1.5">
              <div style={{ width: 80 }}>
                <label style={labelStyle}>批量</label>
                <select
                  value={String(payload.batchSize ?? 1)}
                  onChange={(e) => update("batchSize", Number(e.target.value))}
                  className="nodrag"
                  style={{ ...fieldBase, cursor: "pointer" }}
                >
                  <option value="1">1 张</option>
                  <option value="4">4 张</option>
                </select>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-[5px]">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Seed（可选）</label>
                  <button
                    onClick={() => {
                      if (seedLocked) {
                        update("seed", undefined);
                      } else {
                        const randomSeed = Math.floor(Math.random() * 2147483647);
                        update("seed", randomSeed);
                      }
                    }}
                    className="nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] transition-all"
                    style={{
                      background: seedLocked ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
                      border: `1px solid ${seedLocked ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                      color: seedLocked ? "oklch(0.72 0.18 285)" : "var(--c-t4)",
                      cursor: "pointer",
                    }}
                    title={seedLocked ? "解锁种子（清除）" : "锁定随机种子"}
                  >
                    {seedLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    {seedLocked ? "已锁" : "锁定"}
                  </button>
                </div>
                <input
                  type="number"
                  placeholder="随机"
                  value={payload.seed ?? ""}
                  onChange={(e) => update("seed", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag"
                  style={fieldBase}
                />
              </div>
            </div>
            {payload.model === "hf_soul_standard" && payload.seed !== undefined && (
              <button
                onClick={handlePropagateSeed}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
                style={{
                  background: "oklch(0.68 0.22 285 / 0.10)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.30)",
                  color: "oklch(0.68 0.22 285)",
                  cursor: "pointer",
                }}
              >
                <Lock className="w-3 h-3" />
                传播种子 {payload.seed} 到下游
              </button>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`enhance-${id}`}
                checked={Boolean(payload.enhancePrompt)}
                onChange={(e) => update("enhancePrompt", e.target.checked)}
                className="nodrag"
                style={{ accentColor: accent, width: 12, height: 12 }}
              />
              <label htmlFor={`enhance-${id}`} style={{ fontSize: 11, color: "var(--c-t2)", cursor: "pointer" }}>
                AI 增强提示词
              </label>
            </div>
          </>
                }
                {/* Reve / Seedream v4 / Flux Pro params */}
                {isReveLike && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1.5">
                      <div className="flex-1">
                        <label style={labelStyle}>宽高比</label>
                        <select
                          value={payload.reveAspectRatio ?? "16:9"}
                          onChange={(e) => update("reveAspectRatio", e.target.value)}
                          className="nodrag"
                          style={{ ...fieldBase, cursor: "pointer" }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                        >
                          {/* Flux Pro Kontext only supports a subset of ratios — keep UI options in sync with the server-side whitelist */}
                          {(isFluxPro ? (FLUX_PRO_ASPECT_RATIOS as readonly string[]) : (REVE_ASPECT_RATIOS as readonly string[])).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      {isReveLike && (
                        <div style={{ width: 80 }}>
                          <label style={labelStyle}>分辨率</label>
                          <select
                            value={payload.reveResolution ?? "2K"}
                            onChange={(e) => update("reveResolution", e.target.value)}
                            className="nodrag"
                            style={{ ...fieldBase, cursor: "pointer" }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                          >
                            {REVE_RESOLUTIONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {/* Flux Pro Kontext extra params */}
                    {isFluxPro && (
                      <>
                        <div className="flex gap-1.5">
                          <div className="flex-1">
                            <label style={labelStyle}>引导强度</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={1}
                                max={20}
                                step={0.5}
                                value={payload.fluxGuidanceScale ?? 3.5}
                                onChange={(e) => update("fluxGuidanceScale", Number(e.target.value))}
                                className="nodrag flex-1"
                                style={{ accentColor: accent }}
                              />
                              <span style={{ fontSize: 11, color: "var(--c-t3)", width: 28, textAlign: "right" }}>
                                {(payload.fluxGuidanceScale ?? 3.5).toFixed(1)}
                              </span>
                            </div>
                          </div>
                          <div style={{ width: 72 }}>
                            <label style={labelStyle}>批量</label>
                            <select
                              value={String(payload.fluxNumImages ?? 1)}
                              onChange={(e) => update("fluxNumImages", Number(e.target.value))}
                              className="nodrag"
                              style={{ ...fieldBase, cursor: "pointer" }}
                            >
                              <option value="1">1 张</option>
                              <option value="2">2 张</option>
                              <option value="3">3 张</option>
                              <option value="4">4 张</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>Seed（可选）</label>
                          <input
                            type="number"
                            placeholder="随机"
                            value={payload.fluxSeed ?? ""}
                            onChange={(e) => update("fluxSeed", e.target.value ? Number(e.target.value) : undefined)}
                            className="nodrag"
                            style={fieldBase}
                            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reference images (multi) */}
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (files.length) { e.preventDefault(); void uploadFilesToRef(files, refImages.images.length); return; }
            const assetRaw = e.dataTransfer.getData("application/x-asset-list");
            if (assetRaw) {
              e.preventDefault();
              try {
                const list = JSON.parse(assetRaw) as Array<{ url?: string; type?: string }>;
                const urls = list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
                if (urls.length) refImages.addUrls(urls, "drop");
              } catch { /* ignore */ }
              return;
            }
            const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
            if (/^https?:\/\//.test(uri)) { e.preventDefault(); refImages.addUrls([uri], "drop"); }
          }}
        >
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            参考图（可选，可多张）
            {refImages.images.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--c-t3)", fontWeight: 600 }}>· {refImages.images.length} 张</span>
            )}
            <RefImageReachabilityBadge
              model={payload.model}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
            />
            <RefImageSwitchButton
              nodeId={id}
              model={payload.model}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
              onSwitch={(u) => update("referenceImageUrl", u)}
            />
          </label>

          {/* Horizontal thumbnails (numbered) */}
          {refImages.images.length > 0 && (
            <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {refImages.images.map((img, i) => (
                <div key={img.id} className="group relative rounded-lg overflow-hidden flex-shrink-0" style={{ width: 72, height: 72, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}>
                  <MediaImage
                    src={img.url}
                    alt={`ref-${i + 1}`}
                    className="nodrag w-full h-full object-cover"
                    style={{ cursor: "zoom-in" }}
                    draggable={false}
                    title="点击放大"
                    onClick={() => setRefZoom(i)}
                  />
                  <span style={{ position: "absolute", left: 3, top: 3, minWidth: 15, height: 15, paddingInline: 3, borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center", background: accent, color: "white" }}>{i + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); refImages.removeId(img.id); }}
                    className="nodrag absolute top-1 right-1 p-0.5 rounded-full"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setView3dSrc(img.url); }}
                    title="把这张参考图虚拟化为伪 3D（深度位移），拖拽换视角后重绘"
                    className="nodrag absolute bottom-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <Rotate3d style={{ width: 12, height: 12 }} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void openTrue3d(img.url); }}
                    title="图生真 3D 网格（Tripo3D），完整 360° 环绕后从新视角重绘"
                    className="nodrag absolute bottom-1 left-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}
                  >
                    <Boxes style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="nodrag w-full flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors"
            style={{
              marginTop: refImages.images.length > 0 ? 6 : 0,
              borderWidth: 1, borderStyle: "dashed",
              borderColor: uploading ? BORDER_DEFAULT : "var(--c-bd3)",
              background: "var(--c-input)",
              color: uploading ? "var(--c-t4)" : "var(--c-t3)",
              fontSize: 11, cursor: uploading ? "not-allowed" : "pointer",
            }}
          >
            {uploading
              ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> 上传中...</>
              : <><Upload style={{ width: 13, height: 13 }} /> {refImages.images.length > 0 ? "添加参考图" : "上传 / 拖拽参考图"}</>
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          {/* 或直接粘贴公网图片 URL —— 回车/失焦添加为新的参考图 */}
          <input
            type="url"
            placeholder="粘贴公网图片 URL 后回车添加（https://…）"
            className="nodrag"
            style={{ ...fieldBase, marginTop: 6, fontSize: 10.5 }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = (e.target as HTMLInputElement).value.trim();
              if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); (e.target as HTMLInputElement).value = ""; }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); e.currentTarget.value = ""; }
              e.currentTarget.style.borderColor = BORDER_DEFAULT;
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || batchRunning || !payload.prompt?.trim()}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: isGenerating || !payload.prompt?.trim()
              ? "var(--c-surface)"
              : "linear-gradient(135deg, oklch(0.72 0.20 330 / 0.18), oklch(0.68 0.22 285 / 0.18))",
            borderWidth: 1, borderStyle: "solid",
            borderColor: isGenerating || !payload.prompt?.trim() ? BORDER_DEFAULT : BORDER_ACCENT,
            color: isGenerating || !payload.prompt?.trim() ? "var(--c-t4)" : accent,
            cursor: isGenerating || !payload.prompt?.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {(() => {
            const poyoN = (payload as unknown as { imageN?: number }).imageN ?? 1;
            const batch = isSoul && (payload.batchSize ?? 1) > 1 ? (payload.batchSize ?? 1)
                        : isFluxPro && (payload.fluxNumImages ?? 1) > 1 ? (payload.fluxNumImages ?? 1)
                        : poyoN > 1 ? poyoN
                        : 1;
            if (isGenerating) return batch > 1 ? `批量生成中 (${batch} 张)...` : "AI 生成中...";
            return batch > 1 ? `批量生成 ${batch} 张` : "生成图像";
          })()}
          {genCostLabel && !isGenerating && (
            <span
              title="按当前模型与参数实时预估的点数消耗，仅供参考，实际以平台账单为准"
              style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "oklch(0.72 0.20 330 / 0.15)", letterSpacing: "0.02em" }}
            >
              {genCostLabel}
            </span>
          )}
        </button>
        {isGenerating && (
          // #140 放弃等待（云端生图提交即计费，无法撤回；放弃 = 本地解锁、结果不回填）
          <button
            onClick={abandonWait}
            className="nodrag flex items-center justify-center gap-1 w-full py-1.5 rounded-lg text-[11px] font-medium"
            style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
            title="停止等待本次生成并解锁节点（任务已计费且会在云端继续，结果不回填；如需保留结果请耐心等待）"
          >
            <X className="w-3 h-3" /> 放弃等待
          </button>
        )}

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (() => {
        const images = hasMultiple ? (payload.imageUrls ?? []) : (payload.imageUrl ? [payload.imageUrl] : []);
        if (images.length === 0 || lightboxIndex >= images.length) return null;
        return (
          <ImageLightbox
            images={images}
            currentIndex={lightboxIndex}
            selectedUrl={payload.imageUrl}
            onClose={() => setLightboxIndex(null)}
            onNavigate={(idx) => setLightboxIndex(idx)}
            onSelect={(url) => { handleSelectImage(url); setLightboxIndex(null); }}
          />
        );
      })()}

      {/* Reference-image zoom (plain viewer, navigable across all refs) */}
      {refZoom !== null && refImages.images.length > 0 && (
        <ImageLightbox
          images={refImages.images.map((r) => r.url)}
          currentIndex={Math.min(refZoom, refImages.images.length - 1)}
          onClose={() => setRefZoom(null)}
          onNavigate={(idx) => setRefZoom(idx)}
        />
      )}

      {reachabilityDialog}
    </BaseNode>

    {/* LibTV 化 2.1：创意模式的就地生成输入条（屏幕恒定，NodeToolbar 锚定节点下方）。
        提示词/模型/参数/成本/生成一条龙，读写与配置区同一 payload（双向同步）。 */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={expanded}>
        {/* ── LibTV 三段式 Row1：工具 chips 行（＋参考 / 标记 / 风格） ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <ToolChip icon={<Plus size={13} />} label="参考" title="从画布选择参考（点击其它节点的产物；浮条内可切本地上传）" onClick={() => usePickStore.getState().begin("ref", id)} />
          <ToolChip icon={<MapPin size={12} />} label="标记"
            title="元素选择模式：点击画布上的图片，AI 分析图中元素后点选插入引用"
            onClick={() => usePickStore.getState().begin("mark", id)} />
          <ToolChip icon={<Palette size={12} />} label="风格" title="风格库（选一个风格追加到提示词）" onClick={() => setStyleOpen(true)} />
          <ToolChip icon={<Camera size={12} />} label="摄像机" active={/shot on /i.test(payload.prompt ?? "")}
            title="摄像机参数（相机/镜头/焦距/光圈 → 注入提示词）" onClick={() => setCamRigOpen(true)} />
          <input ref={inlineRefFileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void uploadFilesToRef(files, refImages.images.length); e.target.value = ""; }} />
        </div>
        {/* ── Row2：参考图缩略行（点缩略图插入「图片N」引用） ── */}
        <RefThumbRow images={refImages.images} onRemove={refImages.removeId}
          onClick={(i) => update("prompt", `${(payload.prompt ?? "").trim()}${(payload.prompt ?? "").trim() ? " " : ""}图片${i + 1} `)}
          onDoubleClick={(i) => focusRefSource(refImages.images[i]?.url ?? "")} />
        {/* ── Row3：大提示词区（无边框大字，贴 LibTV） ── */}
        <NodeTextArea
          className="nodrag nowheel"
          rows={3}
          placeholder="描述你想生成的画面…（@ 引用角色/素材）"
          value={payload.prompt ?? ""}
          onValueChange={(v) => update("prompt", v)}
          style={{ width: "100%", resize: "none", fontSize: 15, lineHeight: 1.75, padding: "6px 8px", borderRadius: 8, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none", fontFamily: "inherit" }}
        />
        {/* ── Row3.5：标记引用 chips（嵌入提示词后仍可下拉换选元素 / 移除，LibTV 同款） ── */}
        {(payload.markRefs?.length ?? 0) > 0 && (
          <MarkChipRow
            marks={payload.markRefs!}
            onSwitch={(mid, newName) => {
              const r = switchMark(payload.markRefs ?? [], payload.prompt ?? "", mid, newName);
              if (r) updateNodeData(id, r);
            }}
            onRemove={(mid) => updateNodeData(id, removeMark(payload.markRefs ?? [], payload.prompt ?? "", mid))}
          />
        )}
        {/* ── Row4：精简控制行 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* 模型未显式选择时回退到默认模型（与配置区/提交口径一致），避免选择器显示空白 */}
          <ModelPicker value={payload.model ?? resolve("image_gen", "image")} onChange={(v) => update("model", v)} options={IMAGE_MODEL_PICKER_OPTIONS} minWidth={130} />
          {/* LibTV 控制行分组竖分隔线：模型 │ 参数·高级 … 积分 │ 发送 */}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); setInlineParamsOpen((v) => !v); }}
              title="生成参数（比例 / 分辨率 / 数量）"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: inlineParamsOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {(payload.aspectRatio || "比例默认")} · {(payload.imageResolution || "画质默认")} · {genCount}张
            </button>
            {inlineParamsOpen && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 40, width: 262, display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>比例</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                    {["", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"].map((r) => (
                      <button key={r || "auto"} className="nodrag"
                        onClick={() => { const af = aspectFieldsFor("image_gen", r); updateNodeData(id, r ? af : { aspectRatio: "", poyoAspectRatio: "", reveAspectRatio: "" }, true); }}
                        style={{ padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${(payload.aspectRatio ?? "") === r ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: (payload.aspectRatio ?? "") === r ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                        {r || "默认"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>清晰度（kie 模型逐档计价）</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["", "1K", "2K", "4K"].map((r) => (
                      <button key={r || "auto"} className="nodrag" onClick={() => update("imageResolution", r || undefined)}
                        style={{ flex: 1, padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${(payload.imageResolution ?? "") === r ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: (payload.imageResolution ?? "") === r ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                        {r || "默认"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>生成数量（支持批量的模型生效）</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 4].map((n) => (
                      <button key={n} className="nodrag" onClick={() => update("batchSize", n)}
                        style={{ flex: 1, padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${(payload.batchSize ?? 1) === n ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: (payload.batchSize ?? 1) === n ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                        {n}张
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </span>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起节点内完整配置区" : "展开节点内完整配置区（参考图/风格/更多参数）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            高级
          </button>
          <div style={{ flex: 1 }} />
          <span title="预估消耗" style={{ fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }}>⚡ {genCostLabel || "—"}</span>
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); if (!isGenerating && payload.prompt?.trim()) handleGenerate(); }}
            disabled={isGenerating || !payload.prompt?.trim()}
            title={isGenerating ? "生成中…" : "生成"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: isGenerating || !payload.prompt?.trim() ? "not-allowed" : "pointer", background: isGenerating || !payload.prompt?.trim() ? "var(--c-surface)" : "var(--ui-accent, var(--c-accent))", color: isGenerating || !payload.prompt?.trim() ? "var(--c-t4)" : "#0b0d12" }}
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </InlineGenBar>
    )}

    {/* LibTV「标记」元素选择浮层：AI 分析后点选元素 → 插入「图片N 的<元素>」引用 */}
    {markState && (
      <MarkElementPicker
        imageUrl={markState.url}
        elements={markState.elements}
        loading={markState.loading}
        error={markState.error}
        onClose={() => setMarkState(null)}
        model={markModel}
        onModelChange={(m) => { setMarkModel(m); saveMarkModel(m); runAnalyze(markState.url, m); }}
        onSelect={(name) => {
          const idx = refImages.images.findIndex((r) => r.url === markState.url);
          const refToken = idx >= 0 ? `图片${idx + 1} 的${name}` : name;
          const cur = (payload.prompt ?? "").trim();
          // 提示词插入 + 常驻标记 chip（记录 token 与全部候选元素，事后可下拉换选）
          updateNodeData(id, {
            prompt: cur ? `${cur} ${refToken} ` : `${refToken} `,
            markRefs: [...(payload.markRefs ?? []), { id: nanoid(8), url: markState.url, element: name, token: refToken, elements: markState.elements }],
          });
          setMarkState(null);
          toast.success(`已插入标记引用：${refToken}`);
        }}
      />
    )}

    {/* LibTV：输入条「风格」chip 打开的风格库（portal 到 body，不受节点收缩影响） */}
    {styleOpen && (
      <StylePicker
        onClose={() => setStyleOpen(false)}
        onSelect={(p) => {
          const cur = (payload.prompt ?? "").trim();
          update("prompt", cur ? `${cur}，${p.prompt}` : p.prompt);
          toast.success(`已应用风格：${p.label}`);
        }}
      />
    )}

    {/* #90 摄像机参数选择器（与视频节点同款）：相机/镜头/焦距/光圈 → 注入提示词，重复应用先替换旧片段 */}
    {camRigOpen && (
      <CameraRigPicker
        active={/shot on /i.test(payload.prompt ?? "")}
        onApply={(frag) => {
          const base = stripCameraRig(payload.prompt ?? "");
          update("prompt", base ? `${base}，${frag}` : frag);
          toast.success("已注入摄像机参数");
        }}
        onClear={() => { update("prompt", stripCameraRig(payload.prompt ?? "")); toast.success("已清除摄像机参数"); }}
        onClose={() => setCamRigOpen(false)}
      />
    )}

    {/* ⚠ 两个 3D 查看器必须放在 BaseNode 外面：BaseNode 的 children 在「选中(studioFloated)/
        缩放很远(lodFar)」时会整体换容器或不渲染，放在 children 里会随选中状态卸载——真实翻车：
        真3D 界面突然消失回画布、点空白处取消选中又出现（生成中还会重复扣费提交）。 */}
    {/* 3D 换视角：把选中图深度位移为伪 3D，拖拽换视角截图 → 插为首位参考图 → 触发再生成。 */}
    {view3dSrc && (
      <Depth3DViewer
        sourceImageUrl={view3dSrc}
        onClose={() => setView3dSrc(null)}
        onGenerate={(capturedUrl) => {
          refImages.insertUrls([capturedUrl], 0, "upload"); // 作首位结构参考图，且在参考图条可见
          setPendingGen3d(true); // 等 payload 反映后由 effect 触发生成
        }}
      />
    )}

    {/* B 档 真3D：图生 .glb 网格 → 完整 360° 环绕 → 截图插为首位参考图 → 触发再生成。
        glbUrl 持久化进 payload.model3d：关闭后免费重开继续调整，可导出/存素材库。 */}
    {model3dSrc && (
      <Model3DViewer
        sourceImageUrl={model3dSrc}
        initialGlbUrl={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.glbUrl : undefined}
        savedToLibrary={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.saved : undefined}
        projectId={data.projectId}
        nodeId={id}
        onGlbReady={(glbUrl) => update("model3d", { sourceUrl: model3dSrc, glbUrl })}
        onSavedToLibrary={() => payload.model3d && update("model3d", { ...payload.model3d, saved: true })}
        onClose={() => setModel3dSrc(null)}
        onGenerate={(capturedUrl) => {
          refImages.insertUrls([capturedUrl], 0, "upload");
          setPendingGen3d(true);
        }}
      />
    )}
    </>
  );
});
