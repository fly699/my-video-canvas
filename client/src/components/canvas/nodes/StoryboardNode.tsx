import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { TRPCClientError } from "@trpc/client";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateRefImage } from "../../../lib/refImagePropagation";
import { useShallow } from "zustand/react/shallow";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, Upload, X, Wand2, History, Languages, Film, ZoomIn, Download, Copy, ClipboardList, Rotate3d, Boxes, ArrowUp, Plus, Palette, MapPin, Camera } from "lucide-react";
import { nanoid } from "nanoid";
import { CameraRigPicker, stripCameraRig } from "../CameraRigPicker";
import { ToolChip, RefThumbRow, MarkElementPicker, MarkChipRow, loadMarkModel, saveMarkModel, switchMark, removeMark } from "../InlineBarParts";
import { StylePicker } from "../StylePicker";
import { usePickStore } from "../../../hooks/usePickStore";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { useFocusRefSource } from "../../../hooks/useFocusRefSource";
import { InlineGenBar } from "../InlineGenBar";
import { Depth3DViewer } from "../Depth3DViewer";
import { Model3DViewer } from "../Model3DViewer";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { estimateImageCost, costEstimateLabel, KIE_IMAGE_RES_COST } from "@/lib/costEstimate";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { effectiveCharacters, effectiveCharacterRefImages, effectiveSceneRefImages, stripCharacterMentions } from "../../../lib/characterConditioning";
import { mentionedMediaUrls, stripMediaMentions, detectUpstreamPrompt } from "../../../lib/comfyWorkflowParams";
import { ShotListPanel } from "../ShotListPanel";
import { buildStoryboardGenInput, applyStoryboardGenResult, SOUL_SIZES_LIST, V2_ASPECT_RATIOS, V2_RESOLUTIONS, KIE_RATIOS } from "../../../lib/storyboardGen";
import { imageModelRequiresRef } from "@/lib/models";
import { useSimpleRefStrip } from "../../../hooks/useSimpleRefStrip";
import { useNodeDocks, useCharSceneItems } from "../../../hooks/useNodeDocks";
import { PromptDock } from "../PromptDock";
import { RefHeroPreview } from "../RefHeroPreview";
import { IMAGE_MODELS } from "@/lib/models";
import { MediaImage } from "../MediaImage";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard, usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS } from "../ModelPicker";
import { COMFY_LOCAL_MODEL } from "@/lib/comfyLocalRoute";
import { buildLocalComfyImageInput } from "@/lib/comfyLocalImageGen";
import { ComfyCkptSelect } from "../ComfyCkptSelect";
import { SyncNodesDialog } from "../SyncNodesDialog";
import { ParamControls } from "../ParamControls";
import { IMAGE_MODEL_PARAMS, resolveImageParam } from "@/lib/paramDefs";
import type { ImageGenModel } from "../../../../../shared/types";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import { NodeTextArea, NodeInput } from "../NodeTextInput";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "storyboard";
    title: string;
    payload: StoryboardNodeData;
    projectId: number;
  };
}

const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_FOCUS   = "oklch(0.65 0.20 160 / 0.6)";
const STORY_ACCENT   = "oklch(0.65 0.20 160)";

function formatAIError(err: unknown): string {
  if (err instanceof TRPCClientError) {
    if (err.data?.zodError) return "输入内容不符合要求，请检查字段长度";
    if (err.data?.httpStatus === 500) return "服务器处理失败，请稍后重试";
    if (err.message?.toLowerCase().includes("fetch") || err.message?.toLowerCase().includes("network")) return "网络连接失败，请检查网络后重试";
    return err.message ?? "请求失败，请重试";
  }
  return "未知错误，请重试";
}

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
  transition: "border-color 150ms ease, background 150ms ease",
  lineHeight: 1.5,
};

const onFocus = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
const onBlur  = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

export const StoryboardNode = memo(function StoryboardNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { resolve } = useNodeDefaultModels();
  // Detect connected CharacterNodes that have their own referenceImageUrl
  const connectedCharRefUrl = useCanvasStore((s) => {
    const incomingEdges = s.edges.filter((e) => e.target === id);
    for (const edge of incomingEdges) {
      const srcNode = s.nodes.find((n) => n.id === edge.source);
      if (srcNode?.data.nodeType !== "character") continue;
      const cp = srcNode.data.payload as import("../../../../../shared/types").CharacterNodeData;
      // Scene-kind characters contribute text only — never use them as an
      // identity/face reference image (consistent with round-5 fixes).
      if ((cp.characterKind ?? "person") === "scene") continue;
      if (cp.referenceImageUrl) return cp.referenceImageUrl;
    }
    return undefined;
  });
  const connectedCharWithRef = Boolean(connectedCharRefUrl);

  // Outgoing edges → connected video_task node IDs (for prompt push button)
  // useShallow prevents infinite Zustand re-subscription when the returned array has
  // the same elements but a different reference (React error #185).
  const connectedVideoNodeIds = useCanvasStore(
    useShallow((s) => {
      const outgoingEdges = s.edges.filter((e) => e.source === id);
      return outgoingEdges
        .map((edge) => s.nodes.find((n) => n.id === edge.target
          && (n.data.nodeType === "video_task" || n.data.nodeType === "comfyui_video")))
        .filter(Boolean)
        .map((n) => n!.id as string);
    }),
  );
  const { mode: canvasMode } = useCanvasMode();
  const isCreative = canvasMode === "creative";
  // LibTV 化 2.1c：创意模式（LibTV 模式宿主）下渲染屏幕恒定的就地生成输入条。
  const { uiStyle } = useUIStyle();
  const isCreativeMode = uiStyle !== "studio" && isCreative;
  const [inlineParamsOpen, setInlineParamsOpen] = useState(false);
  // LibTV：创意模式配置区默认收起（就地输入条为主入口），点「高级」才展开。
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  // Effective reference the next generation will use (local overrides character)
  const effectiveRefUrl = payload.referenceImageUrl?.trim() || connectedCharRefUrl;
  const [generating, setGenerating] = useState(false);

  // 统一吸附窗：左侧参考图（单张）+ 顶部「最终提示词」（角色注入后的实际正向词，与 handleGenerate 同源）。
  // 无按钮：悬停标题栏 1 秒临时展开，点击吸附窗钉住持久展开。
  const finalPromptDisplay = useCanvasStore((s) => {
    const base = payload.promptText ?? "";
    const chars = effectiveCharacters(id, base, s.edges, s.nodes);
    return mergeCharactersIntoPrompt(stripMediaMentions(stripCharacterMentions(base, s.nodes), s.nodes), chars, 2000);
  });
  const hasCharInject = useCanvasStore((s) => effectiveCharacters(id, payload.promptText ?? "", s.edges, s.nodes).length > 0);
  // 左侧吸附窗 = 自有参考图 + 最终参与的角色/场景图（@提及或连线，只读），各带类型标签。
  const charSceneItems = useCharSceneItems(id, payload.promptText ?? "");
  const docks = useNodeDocks(id, { hasRef: true, /* 常开：空态悬停也能看到「上传/素材库」参考图入口 */ hasPrompt: !!finalPromptDisplay.trim() }, { prompt: finalPromptDisplay, ref: `${payload.referenceImageUrl ?? ""}|${charSceneItems.map((i) => i.id).join(",")}` });
  const refStrip = useSimpleRefStrip(id, payload, "multi", { accent: STORY_ACCENT, open: docks.refOpen, onOpenChange: docks.setRefOpen, onHoverChange: docks.onDockHoverChange, onPin: docks.pinRef, extraItems: charSceneItems });
  const [inputExpanded, setInputExpanded] = useState(!!selected);
  const [llmModel, setLlmModel] = useState<LLMModelId>(() => resolve("storyboard", "llm") as LLMModelId);
  const [showHistory, setShowHistory] = useState(false);
  // 「镜头表」侧向展开面板（同组分镜序列总览：重排/时长校验/衔接优化）。
  const [showShotList, setShowShotList] = useState(false);
  // 智能体引导卡「打开镜头表」跨节点信号：本节点被点名时自动展开面板（token 防重触发；
  // selector 返回原始 token 值，遵守 zustand「不返回新对象」铁律）。
  const panelToken = useCanvasStore((s) => (s.panelRequest?.nodeId === id && s.panelRequest?.panel === "shotlist" ? s.panelRequest.token : 0));
  useEffect(() => {
    if (panelToken > 0) setShowShotList(true);
  }, [panelToken]);

  // 上游「提示词」节点 → 只填空自动填充（与 video_task/image_gen 同口径）：
  // 本镜 promptText / negativePrompt 为空时才填入，绝不覆盖已有内容。
  // 此前 prompt→storyboard 连接虽被矩阵允许但分镜不消费——连了白连（审计补齐）。
  // 注意：selector 必须返回原始值（string|undefined）——返回对象会每次新引用，
  // 触发 zustand getSnapshot 无限循环（与 VideoTaskNode 的既有写法保持一致）。
  const upPromptPos = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).positive);
  const upPromptNeg = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).negative);
  useEffect(() => {
    const patch: Partial<StoryboardNodeData> = {};
    if (upPromptPos && !payload.promptText?.trim()) patch.promptText = upPromptPos;
    if (upPromptNeg && !payload.negativePrompt?.trim()) patch.negativePrompt = upPromptNeg;
    if (Object.keys(patch).length) updateNodeData(id, patch, true);
  }, [upPromptPos, upPromptNeg, payload.promptText, payload.negativePrompt, id, updateNodeData]);

  // ── 精修工位往返（分镜 ⇄ 图像节点）─────────────────────────────────────────
  // 上游精修节点（image_gen / comfyui_image）出图后亮「采用此图」候选条；
  // 仅显式点击才回填关键帧，绝不自动写入（防覆盖已确认关键帧）。
  const refineCandidate = useCanvasStore((s) => {
    for (const e of s.edges) {
      if (e.target !== id) continue;
      const src = s.nodes.find((n) => n.id === e.source);
      const t = src?.data.nodeType;
      if (t !== "image_gen" && t !== "comfyui_image") continue;
      const u = (src!.data.payload as { imageUrl?: string }).imageUrl;
      if (u && u !== payload.imageUrl) return u;
    }
    return undefined;
  });
  const adoptRefineImage = useCallback(() => {
    if (!refineCandidate) return;
    const history = [refineCandidate, ...(payload.imageHistory ?? [])].filter((u): u is string => !!u).slice(0, 12);
    updateNodeData(id, { imageUrl: refineCandidate, imageHistory: history });
    propagateRefImage(id, refineCandidate);
    toast.success("已采用精修图作为本镜关键帧");
  }, [refineCandidate, payload.imageHistory, id, updateNodeData]);

  /** 送精修：建图像生成节点（带走提示词/参考/模型/比例）+ 复制角色连线 + 工位边。 */
  const handleSendToRefine = useCallback(() => {
    const store = useCanvasStore.getState();
    const own = store.nodes.find((n) => n.id === id);
    if (!own) return;
    // 已有精修工位则不重复建
    const existing = store.edges.find((e) => e.source === id && ["image_gen"].includes(store.nodes.find((n) => n.id === e.target)?.data.nodeType ?? ""));
    if (existing) { toast.info("本镜已有精修工位（图像节点），请在其中继续"); return; }
    const ig = store.addNode("image_gen", { x: own.position.x + 440, y: own.position.y - 40 });
    store.updateNodeData(ig.id, {
      prompt: payload.promptText ?? "",
      negativePrompt: payload.negativePrompt,
      model: payload.imageModel,
      aspectRatio: payload.aspectRatio,
      referenceImageUrl: payload.referenceImageUrl,
      referenceImages: payload.referenceImages?.map((r) => ({ ...r })),
    });
    // 复制角色/场景连线（character→分镜 的源 → character→图像节点），身份控制不丢
    for (const e of store.edges.filter((e) => e.target === id)) {
      if (store.nodes.find((n) => n.id === e.source)?.data.nodeType === "character") {
        store.onConnect({ source: e.source, target: ig.id, sourceHandle: null, targetHandle: null });
      }
    }
    // 工位双链：分镜→图像（送出）+ 图像→分镜（关键帧候选回链）
    store.onConnect({ source: id, target: ig.id, sourceHandle: null, targetHandle: null });
    store.onConnect({ source: ig.id, target: id, sourceHandle: null, targetHandle: null });
    toast.success("已创建精修工位：在图像节点里精修，出图后回本镜点「采用此图」");
  }, [id, payload]);
  const [batchCount, setBatchCount] = useState<1 | 4>(([1, 4].includes(payload.batchSize as number) ? payload.batchSize : 1) as 1 | 4);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // 3D 换视角（与图像节点同款）：伪3D 深度位移 / 真3D 图生网格 → 截图设为参考图 → 重绘该分镜。
  const [view3dSrc, setView3dSrc] = useState<string | null>(null);
  const [model3dSrc, setModel3dSrc] = useState<string | null>(null);
  const [pendingGen3d, setPendingGen3d] = useState(false);
  // 打开真3D查看器：引擎选择/计费确认在查看器内完成；同源图已有模型则直接复用（免费重开）。
  const openTrue3d = useCallback(async (url: string) => {
    if (url) setModel3dSrc(url);
  }, []);
  // 悬浮工具条「3D / 真3D」跨组件信号（BaseNode → 本节点）：与 shotlist 信号同款 token 写法。
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

  // Close lightbox on Escape
  useEffect(() => {
    if (!zoomUrl) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setZoomUrl(null); } };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [zoomUrl]);

  // Sync batchCount when payload.batchSize changes externally (collab / undo-redo)
  useEffect(() => {
    if ([1, 4].includes(payload.batchSize as number)) {
      setBatchCount(payload.batchSize as 1 | 4);
    }
  }, [payload.batchSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInputExpanded(!!selected);
  }, [selected]);
  const model: ImageGenModel = IMAGE_MODELS.some(m => m.value === payload.imageModel)
    ? (payload.imageModel as ImageGenModel)
    : (resolve("storyboard", "image") as ImageGenModel);
  const setModel = (m: string) => { updateNodeData(id, { imageModel: m as ImageGenModel }); };
  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();

  // ── Per-model sizing controls ──
  // Mirror the option lists used by ImageGenNode so a scene can be tuned
  // independently without forcing the user to round-trip via ImageGenNode.
  const isSoul = model === "hf_soul_standard";
  const isV2HF = model === "hf_reve" || model === "hf_seedream_v4" || model === "hf_flux_pro";

  // Sync key shared settings (model / color tone / batch / negative prompt)
  // from this storyboard to ALL other storyboard nodes on the canvas.
  // Helps users keep a consistent style across an entire sequence without
  // hand-editing every scene.
  const [showSync, setShowSync] = useState(false);

  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  // LibTV：输入条「风格」chip 打开风格库，选中把风格片段追加到本镜提示词。
  const [styleOpen, setStyleOpen] = useState(false);
  // 多参考图管理（referenceImages[]，[0] 与 referenceImageUrl 镜像；生成链路最多取 8 张）。
  // 之前拾取直接写 referenceImageUrl 单字段，连选第二张会覆盖第一张（用户实测反馈）。
  const refImages = useReferenceImages(id, payload);
  // 双击参考缩略图 → 聚焦至来源节点。
  const focusRefSource = useFocusRefSource(id);
  // #90 LibTV「标记」：点选画布图片 → AI 元素分析 → 插入「图片N 的<元素>」引用（与图像/视频节点同款）。
  const [markState, setMarkState] = useState<{ url: string; loading: boolean; error: string | null; elements: { name: string; desc?: string }[] } | null>(null);
  const analyzeElementsMut = trpc.aiEnhance.analyzeImageElements.useMutation();
  const [markModel, setMarkModel] = useState<string>(loadMarkModel);
  const runMarkAnalyze = useCallback((url: string, model: string) => {
    setMarkState({ url, loading: true, error: null, elements: [] });
    analyzeElementsMut.mutate({ imageUrl: url, model }, {
      onSuccess: (r) => setMarkState((s) => (s && s.url === url ? { ...s, loading: false, elements: r.elements } : s)),
      onError: (err) => setMarkState((s) => (s && s.url === url ? { ...s, loading: false, error: err.message } : s)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // #90 LibTV：输入条「摄像机」chip 打开摄像机参数选择器（与视频节点同款，注入本镜提示词）。
  const [camRigOpen, setCamRigOpen] = useState(false);
  // LibTV 画布拾取（＋参考=从画布选参考，可连选追加；标记=元素选择模式）。
  useEffect(() => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ forNodeId: string; kind: string; url: string }>).detail;
      if (d?.forNodeId !== id) return;
      if (d.kind === "ref") {
        if (!refImages.addUrls([d.url], "url")) toast.info("该图已在参考列表中，未重复添加");
        return;
      }
      if (d.kind === "mark") {
        // mark：图加入参考（若未在），并启动元素分析
        if (!refImages.images.some((r) => r.url === d.url)) refImages.addUrls([d.url], "url");
        runMarkAnalyze(d.url, markModel);
      }
    };
    const onUpload = (e: Event) => {
      if ((e as CustomEvent<{ forNodeId: string }>).detail?.forNodeId !== id) return;
      refInputRef.current?.click();
    };
    window.addEventListener("canvas:pick-result", onResult);
    window.addEventListener("canvas:pick-upload", onUpload);
    return () => { window.removeEventListener("canvas:pick-result", onResult); window.removeEventListener("canvas:pick-upload", onUpload); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refImages.images, markModel]);

  const uploadRefMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      refImages.addUrls([result.url], "upload");
      setUploadingRef(false);
      toast.success("参考图已上传");
    },
    onError: (err) => {
      setUploadingRef(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16MB"); return; }
    setUploadingRef(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadRefMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setUploadingRef(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 生成结果写回（云端 imageGen 与本地 ComfyUI 两路共用单一事实源）。
  const applySbResult = (result: { url?: string; urls?: string[]; sourceUrl?: string; sourceUrls?: string[]; sourceAt?: number }) => {
    const newUrls = applyStoryboardGenResult(id, result, {
      getNodes: () => useCanvasStore.getState().nodes,
      updateNodeData: (nid, p) => updateNodeData(nid, p),
      propagateRefImage,
    });
    setGenerating(false);
    if (!useCanvasStore.getState().nodes.some(n => n.id === id)) return; // 节点已删
    if (!newUrls.length) { toast.error("生成完成但未返回图像"); return; }
    if (newUrls.length > 1) setShowHistory(true);
    toast.success(newUrls.length > 1 ? `已生成 ${newUrls.length} 张，可在历史中切换` : "分镜图像已生成");
  };
  const onGenError = (err: { message: string }) => { setGenerating(false); toast.error("图像生成失败：" + err.message); };
  const genImageMutation = trpc.imageGen.generate.useMutation({ onSuccess: applySbResult, onError: onGenError });
  // #87 自建算力：分镜模型选「本地 ComfyUI」时改走此 mutation（comfyui.generateImage，txt2img/img2img）。
  const comfyLocalMut = trpc.comfyui.generateImage.useMutation({ onSuccess: applySbResult, onError: onGenError });

  // AI prompt expansion
  const [expandingPrompt, setExpandingPrompt] = useState(false);
  const aiExpandMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setExpandingPrompt(false);
      toast.success("提示词已扩写");
    },
    onError: (err) => {
      setExpandingPrompt(false);
      toast.error("AI 扩写失败：" + formatAIError(err));
    },
  });

  const [expandingDesc, setExpandingDesc] = useState(false);
  const aiExpandDescMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { description: result.result });
      setExpandingDesc(false);
      toast.success("场景描述已扩写");
    },
    onError: (err) => {
      setExpandingDesc(false);
      toast.error("AI 扩写失败：" + formatAIError(err));
    },
  });

  const [translating, setTranslating] = useState(false);
  const aiTranslateMutation = trpc.aiEnhance.enhance.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { promptText: result.result });
      setTranslating(false);
      toast.success("已翻译为英文提示词");
    },
    onError: (err) => {
      setTranslating(false);
      toast.error("翻译失败：" + formatAIError(err));
    },
  });

  const handleExpandPrompt = useCallback(() => {
    if (aiExpandMutation.isPending || expandingPrompt) return;
    if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
    setExpandingPrompt(true);
    aiExpandMutation.mutate({ text: payload.description.slice(0, 8000), mode: "storyboard_prompt", model: llmModel });
  }, [payload.description, aiExpandMutation, expandingPrompt, llmModel]);

  const handleChange = useCallback(
    (field: keyof StoryboardNodeData, value: string | number | undefined) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  useEffect(() => {
    if (payload.duration === undefined) {
      updateNodeData(id, { duration: 5 });
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingGen3d) return;
    if (generating || genImageMutation.isPending || comfyLocalMut.isPending) return;
    setPendingGen3d(false);
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGen3d, payload.referenceImageUrl]);

  const handleGenerate = () => {
    // Double guard — local state is async (could be stale on rapid double-click) so
    // also check the mutation's own isPending which tRPC flips synchronously
    if (generating || genImageMutation.isPending || comfyLocalMut.isPending) return;
    // 组装走单一事实源（lib/storyboardGen）：角色/场景/@图像注入、效果注入、
    // 分模型 sizing、kie 块（临时 key + 比例）、点数预估——与镜头表批量同一条路。
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    const built = buildStoryboardGenInput({
      id, payload, nodes: allNodes, edges: allEdges,
      kieTempKey: localStorage.getItem("kie:tempKey"),
      projectId: data.projectId, // 归属项目→入素材库（与 ImageGen/批量视频同口径，此前漏）
    });
    if (built.blocked) { toast.error(built.blocked); return; }
    // #87 自建算力：本地 ComfyUI（无参考=txt2img，有参考=img2img），复用全局地址/checkpoint。
    if ((payload.imageModel as string | undefined) === COMFY_LOCAL_MODEL) {
      const bi = built.input as { prompt?: string; style?: string; negativePrompt?: string };
      const g = payload as unknown as { aspectRatio?: string; imageSize?: string; poyoAspectRatio?: string; imageN?: number };
      const local = buildLocalComfyImageInput({
        prompt: bi.prompt ?? payload.promptText ?? "",
        style: bi.style, negativePrompt: bi.negativePrompt, refUrl: built.refUrl,
        aspect: g.aspectRatio || g.imageSize || g.poyoAspectRatio, batch: g.imageN,
        projectId: data.projectId, nodeId: id,
      });
      if (!local.ok) { toast.error(local.blocked); return; }
      setGenerating(true);
      comfyLocalMut.mutate(local.input);
      return;
    }
    const submit = () => {
      setGenerating(true);
      genImageMutation.mutate(built.input as Parameters<typeof genImageMutation.mutate>[0]);
    };
    guard({ model, refImageUrl: built.refUrl }, submit);
  };

  // 绿点指示：结果图是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const imgStoredInMinio = isOwnStorageUrl(payload.imageUrl);

  const heroMedia = (() => {
    if (payload.imageUrl) {
      return (
        <div className="relative" style={{ width: "100%" }}>
          <MediaImage
            src={payload.imageUrl}
            style={{ width: "100%", objectFit: "cover", display: "block" }}
            draggable={false}
            alt="分镜"
          />
          {imgStoredInMinio && (
            <div
              title="已存储到 MinIO·长期有效"
              className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
              style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
            />
          )}
        </div>
      );
    }
    // 无关键帧结果但有参考图 → 收缩时显示参考图（否则工作室收缩只剩标题栏、参考图看不见）。
    if (effectiveRefUrl) {
      return <RefHeroPreview url={effectiveRefUrl} />;
    }
    // Text-only description is an INPUT, not a generated result — only surface it
    // as a creative-mode preview card. In other modes returning it as hero would
    // (via the now-global collapse rule) hide the node's editor before any image
    // exists. Real image results below collapse in every mode.
    if (isCreative && payload.description?.trim()) {
      return (
        <div
          className="node-hero-placeholder"
          style={{
            minHeight: 100,
            padding: "14px 16px",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            background: "var(--c-input)",
          }}
        >
          <p style={{ fontSize: 12, color: "var(--c-t2)", lineHeight: 1.6, margin: 0 }}>
            {(() => {
              const chars = Array.from(payload.description);
              return chars.length > 120 ? chars.slice(0, 120).join("") + "…" : payload.description;
            })()}
          </p>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="storyboard" title={data.title} minHeight={280} heroMedia={heroMedia}
      onRun={handleGenerate} running={generating} canRun={!!payload.promptText?.trim()} hasResult={!!payload.imageUrl}
      onAssetImageDrop={(urls) => refImages.addUrls(urls, "drop")}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <>
          {refStrip.strip}
          <PromptDock
            open={docks.promptOpen}
            text={finalPromptDisplay}
            negText={payload.negativePrompt}
            source={hasCharInject ? "含角色" : undefined}
            accent={STORY_ACCENT}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
          {showShotList && <ShotListPanel id={id} onClose={() => setShowShotList(false)} />}
        </>
      }>
      {/* 创意模式收起态（未展开高级）且已有分镜图：内嵌预览/配置全被隐藏，padding/gap 归零，
          否则点击后预览下会剩一块空 padding 灰条。空节点（无图）保留 padding 给生成入口。 */}
      <div className="flex flex-col h-full" style={isCreativeMode && !advancedOpen && payload.imageUrl ? { padding: 0, gap: 0 } : { padding: 14, gap: 12 }}>

        {/* ── Image preview — hidden in creative mode (image shown in heroMedia instead) ── */}
        {!(isCreative && payload.imageUrl) && (<div
          className="relative rounded-lg overflow-hidden flex-shrink-0"
          style={{
            height: 150,
            background: "var(--c-input)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: BORDER_DEFAULT,
          }}
        >
          {payload.imageUrl ? (
            <>
              {imgStoredInMinio && (
                <div
                  title="已存储到 MinIO·长期有效"
                  className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                  style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
              <MediaImage
                src={payload.imageUrl}
                alt="分镜"
                className="w-full h-full object-cover"
                draggable={false}
              />
              <div
                className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1"
                style={{ background: "oklch(0 0 0 / 0.55)" }}
              >
                {/* 「重新生成」已移至标题栏（BaseNode onRun），避免与放大/下载挤在一起 */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setZoomUrl(payload.imageUrl || null); }}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: "oklch(0.68 0.18 220 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.68 0.18 220 / 0.5)",
                      color: "oklch(0.75 0.15 220)",
                    }}
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setView3dSrc(payload.imageUrl || null); }}
                    title="3D 换视角（深度位移，免费，需 ComfyUI）"
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: "oklch(0.70 0.20 310 / 0.20)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.70 0.20 310 / 0.5)", color: "oklch(0.78 0.15 310)" }}
                  >
                    <Rotate3d className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void openTrue3d(payload.imageUrl || ""); }}
                    title={payload.model3d?.sourceUrl === payload.imageUrl ? "真 3D 换视角（已生成，免费重开）" : "真 3D 换视角（Tripo3D 图生网格，约 30–60 credits）"}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: "oklch(0.72 0.17 160 / 0.20)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.72 0.17 160 / 0.5)", color: "oklch(0.78 0.14 160)" }}
                  >
                    <Boxes className="w-3 h-3" />
                  </button>
                </div>
                {(payload.imageHistory?.length ?? 0) > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
                    className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all mt-1"
                    style={{
                      background: "oklch(0.68 0.22 285 / 0.20)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.68 0.22 285 / 0.5)",
                      color: "oklch(0.75 0.18 285)",
                    }}
                  >
                    <History className="w-3 h-3" />
                    历史 ({payload.imageHistory?.length ?? 0})
                  </button>
                )}
              </div>
              <SceneNumberBadge
                value={payload.sceneNumber}
                onChange={(n) => updateNodeData(id, { sceneNumber: n })}
              />

            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <ImageIcon className="w-7 h-7" style={{ color: "var(--c-t4)" }} />
              <button
                onClick={handleGenerate}
                disabled={generating || !payload.promptText?.trim()}
                className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: generating || !payload.promptText?.trim()
                    ? "var(--c-surface)"
                    : "oklch(0.65 0.20 160 / 0.15)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: generating || !payload.promptText?.trim()
                    ? "var(--c-bd2)"
                    : "oklch(0.65 0.20 160 / 0.45)",
                  color: generating || !payload.promptText?.trim()
                    ? "var(--c-t4)"
                    : "oklch(0.72 0.18 160)",
                  cursor: generating || !payload.promptText?.trim() ? "not-allowed" : "pointer",
                }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? "生成中..." : "AI 生成分镜"}
                {!generating && (() => {
                  const lbl = costEstimateLabel(estimateImageCost(model, isSoul ? batchCount : 1, { resolution: payload.imageResolution }));
                  return lbl ? (
                    <span
                      title="按当前模型与参数实时预估的点数消耗，仅供参考，实际以平台账单为准"
                      style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "oklch(0.65 0.20 160 / 0.18)", letterSpacing: "0.02em" }}
                    >
                      {lbl}
                    </span>
                  ) : null;
                })()}
              </button>
              {!payload.promptText?.trim() && (
                <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>请先填写提示词</p>
              )}
            </div>
          )}
        </div>)}

        {/* ── Generation history panel ── */}
        {showHistory && (payload.imageHistory?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
                生成历史
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="nodrag"
                style={{ fontSize: 10, color: "var(--c-t4)", cursor: "pointer", background: "none", border: "none" }}
              >
                收起
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {(payload.imageHistory ?? []).map((url, i) => (
                <button
                  key={i}
                  onClick={() => { updateNodeData(id, { imageUrl: url }); propagateRefImage(id, url); setShowHistory(false); }}
                  className="nodrag flex-shrink-0 rounded overflow-hidden"
                  style={{
                    width: 60, height: 45,
                    border: url === payload.imageUrl
                      ? "1.5px solid oklch(0.65 0.20 160)"
                      : "1.5px solid var(--c-bd2)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title={i === 0 ? "当前版本" : `版本 ${i + 1}`}
                >
                  <MediaImage
                    src={url}
                    alt={`历史 ${i + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Collapsible inputs ──
            创意模式：默认收起，由就地输入条「高级」开关展开（防节点过高顶飞输入条）。 */}
        <div
          style={(() => {
            const open = isCreativeMode ? advancedOpen : inputExpanded;
            return {
              overflow: "hidden",
              maxHeight: open ? 2000 : 0,
              opacity: open ? 1 : 0,
              transition: "max-height 250ms cubic-bezier(0.23,1,0.32,1), opacity 200ms ease",
              display: "flex" as const,
              flexDirection: "column" as const,
              gap: 12,
            };
          })()}
        >
        {/* ── Shot List 工具行：镜头表（侧向展开） + 拍点 ── */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowShotList((v) => !v)}
            title="镜头表：同组分镜序列总览（重排 / 时长校验 / 衔接优化）"
            className="nodrag flex items-center gap-1 px-2 py-1 rounded-md transition-all"
            style={{ fontSize: 10, fontWeight: showShotList ? 700 : 500, background: showShotList ? "oklch(0.65 0.20 160 / 0.18)" : "var(--c-surface)", border: `1px solid ${showShotList ? "oklch(0.65 0.20 160 / 0.5)" : "var(--c-bd2)"}`, color: showShotList ? STORY_ACCENT : "var(--c-t3)", cursor: "pointer" }}
          >
            <ClipboardList style={{ width: 11, height: 11 }} /> 镜头表
          </button>
          <button
            onClick={handleSendToRefine}
            title="送精修：创建图像生成节点（带走提示词/参考图/模型/角色连线），用工作台的全部能力精修本镜关键帧"
            className="nodrag flex items-center gap-1 px-2 py-1 rounded-md transition-all"
            style={{ fontSize: 10, fontWeight: 500, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
          >
            <Wand2 style={{ width: 11, height: 11 }} /> 送精修
          </button>
          {refineCandidate && (
            <button
              onClick={adoptRefineImage}
              title="精修工位有新图，点击采用为本镜关键帧（不会自动覆盖）"
              className="nodrag flex items-center gap-1 px-2 py-1 rounded-md transition-all"
              style={{ fontSize: 10, fontWeight: 700, background: "oklch(0.72 0.20 330 / 0.14)", border: "1px solid oklch(0.72 0.20 330 / 0.5)", color: "oklch(0.72 0.20 330)", cursor: "pointer" }}
            >
              <ImageIcon style={{ width: 11, height: 11 }} /> 采用精修图
            </button>
          )}
          {payload.beatRef && (
            <span title="所属节拍表拍点（来自脚本节点的节拍表）" style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "oklch(0.66 0.18 250 / 0.14)", color: "oklch(0.66 0.18 250)" }}>
              拍点 {payload.beatRef}
            </span>
          )}
        </div>

        {/* ── Scene meta ── */}
        <div className="flex gap-1.5">
          <input
            type="number"
            placeholder="场景#"
            value={payload.sceneNumber ?? ""}
            onChange={(e) => handleChange("sceneNumber", e.target.value === "" ? undefined : Number(e.target.value))}
            className="nodrag"
            style={{ ...fieldStyle, width: 52 }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <NodeInput
            placeholder="运镜方式"
            value={payload.cameraMovement ?? ""}
            onValueChange={(v) => handleChange("cameraMovement", v)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          {/* 景别（行业 Shot List 标准字段） */}
          <select
            className="nodrag"
            value={payload.shotType ?? ""}
            onChange={(e) => handleChange("shotType", e.target.value || undefined)}
            title="景别：ECU 大特写 / CU 特写 / MS 中景 / MLS 中远景 / WS 远景 / establishing 定场"
            style={{ ...fieldStyle, width: 110, padding: "7px 6px" }}
          >
            <option value="">景别</option>
            {["ECU", "CU", "MS", "MLS", "WS", "establishing"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* ── Shot List：对白/旁白 + 音效意图 + 转场 ── */}
        <NodeTextArea
          placeholder="对白 / 旁白（可直接喂给下游音频节点作配音文案）"
          value={payload.dialogue ?? ""}
          onValueChange={(v) => handleChange("dialogue", v || undefined)}
          rows={2}
          className="nodrag"
          style={{ ...fieldStyle, resize: "vertical", minHeight: 40 }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="flex gap-1.5">
          <NodeInput
            placeholder="音效 / BGM 意图（如：雨声渐强 + 低音弦乐）"
            value={payload.sfx ?? ""}
            onValueChange={(v) => handleChange("sfx", v || undefined)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <select
            className="nodrag"
            value={payload.transition ?? ""}
            onChange={(e) => handleChange("transition", e.target.value || undefined)}
            title="到下一镜的转场方式"
            style={{ ...fieldStyle, width: 110, padding: "7px 6px" }}
          >
            <option value="">转场→</option>
            {["cut", "dissolve", "fade", "wipe", "match-cut"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {/* ── Duration slider ── */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label style={{ fontSize: 11, color: "var(--c-t3)", marginBottom: 0 }}>时长</label>
            <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{payload.duration ?? 5}秒</span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={payload.duration ?? 5}
            onChange={(e) => handleChange("duration", Number(e.target.value))}
            className="nodrag w-full"
            style={{ accentColor: "oklch(0.65 0.20 160)" }}
          />
        </div>

        {/* ── Description ── */}
        <NodeTextArea
          placeholder="场景描述..."
          value={payload.description ?? ""}
          onValueChange={(v) => handleChange("description", v)}
          className="nodrag nowheel"
          rows={2}
          style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <LLMModelPicker value={llmModel} onChange={setLlmModel} disabled={expandingDesc || expandingPrompt || translating} />
          <button
            onClick={() => {
              if (expandingDesc || expandingPrompt || translating || aiExpandDescMutation.isPending) return;
              if (!payload.description?.trim()) { toast.error("请先填写场景描述"); return; }
              setExpandingDesc(true);
              aiExpandDescMutation.mutate({ text: payload.description.slice(0, 8000), mode: "expand", model: llmModel });
            }}
            disabled={expandingDesc || expandingPrompt || translating}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: (expandingDesc || expandingPrompt || translating) ? "var(--c-surface)" : "oklch(0.65 0.20 160 / 0.10)",
              border: `1px solid ${(expandingDesc || expandingPrompt || translating) ? "var(--c-bd2)" : "oklch(0.65 0.20 160 / 0.35)"}`,
              color: (expandingDesc || expandingPrompt || translating) ? "var(--c-t4)" : "oklch(0.65 0.20 160)",
              cursor: (expandingDesc || expandingPrompt || translating) ? "not-allowed" : "pointer",
            }}
          >
            {expandingDesc ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
            AI 扩写描述
          </button>
        </div>

        {/* ── Prompt ── */}
        <div className="flex flex-col gap-1">
          <NodeTextArea
            placeholder="正向提示词（用于 AI 生图）..."
            value={payload.promptText ?? ""}
            onValueChange={(v) => handleChange("promptText", v)}
            className="nodrag nowheel"
            rows={2}
            style={{
              ...fieldStyle,
              resize: "none",
              lineHeight: 1.6,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
            }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
              {(payload.promptText ?? "").length} 字
            </span>
          </div>
          {connectedVideoNodeIds.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap self-start">
              <button
                onClick={() => {
                  if (!payload.promptText?.trim()) { toast.error("请先填写提示词再发送"); return; }
                  const { updateNodeData: updateStore } = useCanvasStore.getState();
                  connectedVideoNodeIds.forEach((videoNodeId) => {
                    updateStore(videoNodeId, {
                      prompt: payload.promptText,
                      // Always sync referenceImageUrl — explicitly clear it (undefined)
                      // when the storyboard has no image so stale URLs don't linger
                      referenceImageUrl: payload.imageUrl || undefined,
                    });
                  });
                  toast.success(
                    connectedVideoNodeIds.length === 1
                      ? "提示词已发送到视频节点"
                      : `提示词已发送至 ${connectedVideoNodeIds.length} 个视频节点`
                  );
                }}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all"
                style={{
                  background: "oklch(0.62 0.20 25 / 0.12)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "oklch(0.62 0.20 25 / 0.35)",
                  color: "oklch(0.68 0.18 25)",
                  cursor: "pointer",
                }}
              >
                <Film className="w-3 h-3" />
                发送到视频节点
              </button>
              {/* Image-only send: pushes just the generated image as the video
                  node's reference, without requiring a prompt. */}
              <button
                disabled={!payload.imageUrl}
                title={payload.imageUrl ? "把本节点已生成的图片发送为视频节点的参考图" : "请先生成图片"}
                onClick={() => {
                  if (!payload.imageUrl) return;
                  const { updateNodeData: updateStore } = useCanvasStore.getState();
                  connectedVideoNodeIds.forEach((videoNodeId) => {
                    updateStore(videoNodeId, { referenceImageUrl: payload.imageUrl });
                  });
                  toast.success(
                    connectedVideoNodeIds.length === 1
                      ? "图片已发送到视频节点"
                      : `图片已发送至 ${connectedVideoNodeIds.length} 个视频节点`
                  );
                }}
                className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all"
                style={{
                  background: payload.imageUrl ? "oklch(0.62 0.16 260 / 0.14)" : "var(--c-surface)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: payload.imageUrl ? "oklch(0.62 0.16 260 / 0.40)" : "var(--c-bd2)",
                  color: payload.imageUrl ? "oklch(0.72 0.14 260)" : "var(--c-t4)",
                  cursor: payload.imageUrl ? "pointer" : "not-allowed",
                }}
              >
                <ImageIcon className="w-3 h-3" />
                发送图片到视频节点
              </button>
            </div>
          )}
          <button
            onClick={handleExpandPrompt}
            disabled={expandingPrompt || expandingDesc || translating || !payload.description?.trim()}
            className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all self-start"
            style={{
              background: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-surface)"
                : "oklch(0.65 0.20 160 / 0.12)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-bd2)"
                : "oklch(0.65 0.20 160 / 0.35)",
              color: expandingPrompt || expandingDesc || translating || !payload.description?.trim()
                ? "var(--c-t4)"
                : "oklch(0.65 0.20 160)",
              cursor: expandingPrompt || expandingDesc || translating || !payload.description?.trim() ? "not-allowed" : "pointer",
            }}
          >
            {expandingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {expandingPrompt ? "AI 扩写中..." : "AI 扩写提示词"}
          </button>
          <button
            onClick={() => {
              if (translating || expandingDesc || expandingPrompt || aiTranslateMutation.isPending) return;
              const text = payload.description?.trim() || payload.promptText?.trim();
              if (!text) { toast.error("请先填写场景描述或提示词"); return; }
              setTranslating(true);
              aiTranslateMutation.mutate({ text, mode: "translate_en", model: llmModel });
            }}
            disabled={translating || expandingDesc || expandingPrompt}
            title="将场景描述翻译为英文，结果写入提示词"
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium transition-all"
            style={{
              background: (translating || expandingDesc || expandingPrompt) ? "var(--c-surface)" : "oklch(0.68 0.22 300 / 0.10)",
              border: `1px solid ${(translating || expandingDesc || expandingPrompt) ? "var(--c-bd2)" : "oklch(0.68 0.22 300 / 0.35)"}`,
              color: (translating || expandingDesc || expandingPrompt) ? "var(--c-t4)" : "oklch(0.72 0.18 300)",
              cursor: (translating || expandingDesc || expandingPrompt) ? "not-allowed" : "pointer",
            }}
          >
            {translating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
            翻译英文
          </button>
        </div>

        {/* ── Negative prompt ── */}
        <NodeTextArea
          placeholder="负面提示词（可选，描述不希望出现的内容）..."
          value={payload.negativePrompt ?? ""}
          onValueChange={(v) => handleChange("negativePrompt", v)}
          className="nodrag nowheel"
          rows={2}
          style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {/* ── Style row ── */}
        <div className="flex gap-1.5">
          <NodeInput
            placeholder="色调/风格"
            value={payload.colorTone ?? ""}
            onValueChange={(v) => handleChange("colorTone", v)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <NodeInput
            placeholder="镜头"
            value={payload.lens ?? ""}
            onValueChange={(v) => handleChange("lens", v)}
            className="nodrag flex-1"
            style={fieldStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </div>

        {/* ── Reference image upload ── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRefUpload}
            />
            <button
              onClick={() => refInputRef.current?.click()}
              disabled={uploadingRef}
              className="nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all flex-1"
              style={{
                background: "var(--c-input)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "var(--c-bd2)",
                color: "var(--c-t3)",
                cursor: uploadingRef ? "not-allowed" : "pointer",
              }}
            >
              {uploadingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {payload.referenceImageUrl ? "添加参考图" : "上传参考图"}
            </button>
            {payload.referenceImageUrl && (
              <button
                onClick={() => updateNodeData(id, { referenceImageUrl: undefined, referenceImages: [] })}
                className="nodrag p-1 rounded transition-all"
                style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t3)" }}
                title="清除全部参考图"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <RefImageReachabilityBadge
              model={model}
              refImageUrl={effectiveRefUrl}
              reachable={reachable}
            />
            <RefImageSwitchButton
              nodeId={id}
              model={model}
              refImageUrl={effectiveRefUrl}
              reachable={reachable}
              onSwitch={(u) => updateNodeData(id, { referenceImageUrl: u })}
            />
          </div>
          {/* 或直接粘贴公网图片 URL */}
          <input
            type="url"
            placeholder="或粘贴公网图片 URL（https://…）"
            value={payload.referenceImageUrl?.startsWith("http") ? payload.referenceImageUrl : ""}
            onChange={(e) => updateNodeData(id, { referenceImageUrl: e.target.value.trim() || undefined })}
            className="nodrag"
            style={{ ...fieldStyle, fontSize: 10.5 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-t4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; }}
          />
          {/* Priority hint: when this node has its own referenceImageUrl, CharacterNode's ref is silently ignored */}
          {connectedCharWithRef && payload.referenceImageUrl && (
            <p style={{ fontSize: 9.5, color: "oklch(0.72 0.18 55)", lineHeight: 1.4, margin: 0 }}>
              本节点参考图优先：已连接角色节点的参考图不会用于生图
            </p>
          )}
          {/* Hint: when no local ref but CharacterNode has one, show it will be used */}
          {connectedCharWithRef && !payload.referenceImageUrl && (
            <p style={{ fontSize: 9.5, color: "var(--c-t4)", lineHeight: 1.4, margin: 0 }}>
              将使用已连接角色节点的参考图
            </p>
          )}
        </div>

        {/* ── Model selector ── 单独占整行，避免下拉被同行按钮挤窄 ── */}
        <div className="nodrag flex items-stretch gap-1.5">
          <div className="flex-1 min-w-0">
            <ModelPicker
              value={(payload.imageModel as string) || model}
              onChange={(v) => setModel(v)}
              options={IMAGE_MODEL_PICKER_OPTIONS}
            />
          </div>
          {/* kie 模型通用比例（审计补齐：此前分镜选 kie 比例不可控）。服务端按模型枚举夹取 */}
          {model.startsWith("kie_") && (
            <select
              className="nodrag"
              value={payload.aspectRatio ?? ""}
              onChange={(e) => handleChange("aspectRatio", e.target.value || undefined)}
              title="kie 模型画面比例"
              style={{ ...fieldStyle, width: 76, padding: "6px 6px" }}
            >
              <option value="">比例</option>
              {KIE_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {/* kie 分辨率档（如 GPT Image 2 1K/2K/4K = 6/10/16 点，逐档计价） */}
          {KIE_IMAGE_RES_COST[model] && (
            <select
              className="nodrag"
              value={payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[model])[0]}
              onChange={(e) => handleChange("imageResolution", e.target.value)}
              title={`分辨率档（${Object.entries(KIE_IMAGE_RES_COST[model]).map(([k, v]) => `${k}=${v}点`).join(" / ")}）`}
              style={{ ...fieldStyle, width: 64, padding: "6px 6px" }}
            >
              {Object.keys(KIE_IMAGE_RES_COST[model]).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>
        {/* #87 自建算力：选「本地 ComfyUI」时展示地址 + checkpoint（全能服务器管理器，全局共享） */}
        {(payload.imageModel as string | undefined) === COMFY_LOCAL_MODEL && (
          <div className="nodrag" style={{ marginTop: 6 }}><ComfyCkptSelect enabled width={160} /></div>
        )}
        {/* ── 同步参数 ── 移到模型选择下方独立一行，右对齐，让模型下拉拿到整行宽度 ── */}
        <div className="nodrag flex justify-end">
          <button
            onClick={() => setShowSync(true)}
            title="把当前模型 / 色调 / 抽卡次数 / 反向提示词等参数同步到所选分镜节点（弹窗勾选）"
            className="nodrag flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] transition-all"
            style={{
              background: "oklch(0.65 0.20 160 / 0.08)",
              border: "1px dashed oklch(0.65 0.20 160 / 0.4)",
              color: "oklch(0.72 0.18 160)",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 160 / 0.16)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 160 / 0.08)"; }}
          >
            <Copy className="w-3 h-3" />
            同步参数
          </button>
        </div>
        {showSync && (
          <SyncNodesDialog
            sourceId={id}
            nodeType="storyboard"
            typeLabel="分镜"
            patch={{ imageModel: payload.imageModel, colorTone: payload.colorTone, batchSize: payload.batchSize, negativePrompt: payload.negativePrompt, cameraMovement: payload.cameraMovement, lens: payload.lens }}
            onClose={() => setShowSync(false)}
          />
        )}
        {/* ── Sizing controls (per-model) ── Soul / Reve-like 走既有专属控件；
            Poyo 模型改由下方 schema 驱动的 ParamControls 渲染 ── */}
        {(isSoul || isV2HF) && (
          <div className="flex gap-1.5 nodrag">
            {isSoul && (
              <>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    画布尺寸
                  </label>
                  <select
                    value={payload.widthAndHeight ?? "1536x1536"}
                    onChange={(e) => updateNodeData(id, { widthAndHeight: e.target.value })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {SOUL_SIZES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    画质
                  </label>
                  <select
                    value={payload.soulQuality ?? "1080p"}
                    onChange={(e) => updateNodeData(id, { soulQuality: e.target.value as "720p" | "1080p" })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                {/* 与 ImageGenNode 对齐：种子（复现一致画面）+ AI 增强提示词 */}
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    Seed
                  </label>
                  <input
                    type="number"
                    placeholder="随机"
                    value={payload.seed ?? ""}
                    onChange={(e) => updateNodeData(id, { seed: e.target.value ? Number(e.target.value) : undefined })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)" }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 7 }}>
                  <label className="nodrag" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--c-t3)", cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(payload.enhancePrompt)}
                      onChange={(e) => updateNodeData(id, { enhancePrompt: e.target.checked })}
                      style={{ width: 11, height: 11 }}
                    />
                    AI 增强
                  </label>
                </div>
              </>
            )}
            {isV2HF && (
              <>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    宽高比
                  </label>
                  <select
                    value={payload.reveAspectRatio ?? "2:3"}
                    onChange={(e) => updateNodeData(id, { reveAspectRatio: e.target.value })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {V2_ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                    分辨率
                  </label>
                  <select
                    value={payload.reveResolution ?? "2K"}
                    onChange={(e) => updateNodeData(id, { reveResolution: e.target.value as "1K" | "2K" | "4K" })}
                    className="nodrag"
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
                  >
                    {V2_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        )}
        {/* Flux Pro Kontext 专属参数（与 ImageGenNode 对齐：引导强度/批量/种子） */}
        {model === "hf_flux_pro" && (
          <div className="flex gap-1.5 nodrag" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>
                引导强度 {(payload.fluxGuidanceScale ?? 3.5).toFixed(1)}
              </label>
              <input
                type="range" min={1} max={20} step={0.5}
                value={payload.fluxGuidanceScale ?? 3.5}
                onChange={(e) => updateNodeData(id, { fluxGuidanceScale: Number(e.target.value) })}
                className="nodrag" style={{ width: "100%" }}
              />
            </div>
            <div style={{ width: 70 }}>
              <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>批量</label>
              <select
                value={String(payload.fluxNumImages ?? 1)}
                onChange={(e) => updateNodeData(id, { fluxNumImages: Number(e.target.value) })}
                className="nodrag"
                style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)", cursor: "pointer" }}
              >
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 张</option>)}
              </select>
            </div>
            <div style={{ width: 90 }}>
              <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)", display: "block", marginBottom: 4 }}>Seed</label>
              <input
                type="number" placeholder="随机"
                value={payload.fluxSeed ?? ""}
                onChange={(e) => updateNodeData(id, { fluxSeed: e.target.value ? Number(e.target.value) : undefined })}
                className="nodrag"
                style={{ width: "100%", padding: "6px 8px", fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t1)" }}
              />
            </div>
          </div>
        )}
        {/* Poyo 模型参数控件（schema 驱动）—— 替代原 Poyo 宽高比/画质硬编码块 */}
        {imageModelRequiresRef(model) && !payload.referenceImageUrl?.trim() && !(payload.referenceImages?.length) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "oklch(0.75 0.16 75 / 0.10)", border: "1px solid oklch(0.75 0.16 75 / 0.4)" }}>
            <span style={{ fontSize: 10, color: "oklch(0.78 0.14 75)", lineHeight: 1.5 }}>
              ⚠ 该模型为图生图 / 编辑模型，必须提供参考图——请连接图像、@图像名 或在参考栏上传。
            </span>
          </div>
        )}
        {model && IMAGE_MODEL_PARAMS[model] && IMAGE_MODEL_PARAMS[model].length > 0 && (

          <div className="nodrag">
            <ParamControls
              defs={IMAGE_MODEL_PARAMS[model]}
              values={payload as unknown as Record<string, unknown>}
              onChange={(key, value) => updateNodeData(id, { [key]: value } as unknown as Partial<StoryboardNodeData>)}
            />
          </div>
        )}
        {/* ── Batch count (only effective for hf_soul_standard) ── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-t4)" }}>
              抽卡次数
            </span>
            <div className="flex gap-1">
              {([1, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => { setBatchCount(n); updateNodeData(id, { batchSize: n }); }}
                  className="nodrag"
                  style={{
                    width: 28, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${batchCount === n ? "oklch(0.65 0.20 160 / 0.6)" : "var(--c-bd2)"}`,
                    background: batchCount === n ? "oklch(0.65 0.20 160 / 0.15)" : "var(--c-input)",
                    color: batchCount === n ? "oklch(0.72 0.18 160)" : "var(--c-t3)",
                    cursor: "pointer",
                    transition: "all 120ms",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {batchCount > 1 && model !== "hf_soul_standard" && (
            <p style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
              当前模型仅支持单张，请选择 Soul Standard 以启用抽卡
            </p>
          )}
        </div>

        {/* End collapsible inputs */}
        </div>

      </div>

      {reachabilityDialog}
    </BaseNode>

    {/* LibTV 化 2.1c：创意模式的就地生成输入条（屏幕恒定，NodeToolbar 锚定节点下方）。
        提示词/图像模型/参数（比例·清晰度·数量）/成本/生成一条龙，与配置区同一 payload 双向同步。 */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned)}>
        {/* ── LibTV 三段式 Row1：工具 chips 行（＋参考 / 标记 / 风格 / 摄像机，#90 与图像/视频节点对齐） ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <ToolChip icon={<Plus size={13} />} label="参考" title="从画布选择参考（点击其它节点的产物；浮条内可切本地上传）" onClick={() => usePickStore.getState().begin("ref", id)} />
          <ToolChip icon={<MapPin size={12} />} label="标记"
            title="元素选择模式：点击画布上的图片，AI 分析图中元素后点选插入引用"
            onClick={() => usePickStore.getState().begin("mark", id)} />
          <ToolChip icon={<Palette size={12} />} label="风格" title="风格库（选一个风格追加到本镜提示词）" onClick={() => setStyleOpen(true)} />
          <ToolChip icon={<Camera size={12} />} label="摄像机" active={/shot on /i.test(payload.promptText ?? "")}
            title="摄像机参数（相机/镜头/焦距/光圈 → 注入本镜提示词）" onClick={() => setCamRigOpen(true)} />
          {uploadingRef && <Loader2 size={13} className="animate-spin" style={{ color: "var(--c-t3)" }} />}
        </div>
        {/* ── Row2：参考图缩略行（多图连选，编号 + hover 放大 + 删除 + 双击聚焦来源） ── */}
        <RefThumbRow images={refImages.images} onRemove={refImages.removeId}
          onDoubleClick={(i) => focusRefSource(refImages.images[i]?.url ?? "")} />
        {/* ── Row3：大提示词区 ── */}
        <NodeTextArea
          className="nodrag nowheel"
          rows={3}
          placeholder="描述本镜画面…（@ 引用角色/素材）"
          value={payload.promptText ?? ""}
          onValueChange={(v) => handleChange("promptText", v)}
          style={{ width: "100%", resize: "none", fontSize: 14, lineHeight: 1.7, padding: "4px 6px", borderRadius: 8, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none", fontFamily: "inherit" }}
        />
        {/* ── Row3.5：标记引用 chips（嵌入提示词后仍可下拉换选元素 / 移除，#90 与图像节点同款） ── */}
        {(payload.markRefs?.length ?? 0) > 0 && (
          <MarkChipRow
            marks={payload.markRefs!}
            onSwitch={(mid, newName) => {
              const r = switchMark(payload.markRefs ?? [], payload.promptText ?? "", mid, newName);
              if (r) updateNodeData(id, { promptText: r.prompt, markRefs: r.markRefs });
            }}
            onRemove={(mid) => {
              const r = removeMark(payload.markRefs ?? [], payload.promptText ?? "", mid);
              updateNodeData(id, { promptText: r.prompt, markRefs: r.markRefs });
            }}
          />
        )}
        {/* ── Row4：精简控制行 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ModelPicker value={(payload.imageModel as string) || model} onChange={setModel} options={IMAGE_MODEL_PICKER_OPTIONS} minWidth={130} />
          {/* LibTV 控制行分组竖分隔线：模型 │ 参数·高级 … 积分 │ 发送 */}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); setInlineParamsOpen((v) => !v); }}
              title="生成参数（比例 / 清晰度 / 数量）"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: inlineParamsOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {(payload.aspectRatio || "比例默认")}{KIE_IMAGE_RES_COST[model] ? ` · ${payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[model])[0]}` : ""}{isSoul ? ` · ${batchCount}张` : ""}
            </button>
            {inlineParamsOpen && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 40, width: 262, display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>比例</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                    {["", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"].map((r) => (
                      <button key={r || "auto"} className="nodrag"
                        onClick={() => handleChange("aspectRatio", r || undefined)}
                        style={{ padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${(payload.aspectRatio ?? "") === r ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: (payload.aspectRatio ?? "") === r ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                        {r || "默认"}
                      </button>
                    ))}
                  </div>
                </div>
                {KIE_IMAGE_RES_COST[model] && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>清晰度（逐档计价）</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {Object.keys(KIE_IMAGE_RES_COST[model]).map((r) => (
                        <button key={r} className="nodrag" onClick={() => handleChange("imageResolution", r)}
                          style={{ flex: 1, padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${(payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[model])[0]) === r ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: (payload.imageResolution ?? Object.keys(KIE_IMAGE_RES_COST[model])[0]) === r ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {isSoul && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>抽卡次数（Soul 专属）</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {([1, 4] as const).map((n) => (
                        <button key={n} className="nodrag" onClick={() => { setBatchCount(n); updateNodeData(id, { batchSize: n }); }}
                          style={{ flex: 1, padding: "5px 0", fontSize: 10.5, borderRadius: 7, border: `1px solid ${batchCount === n ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: batchCount === n ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)", color: "var(--c-t2)", cursor: "pointer" }}>
                          {n}张
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </span>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起节点内完整配置区" : "展开节点内完整配置区（镜头表字段/参考图/更多参数）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            高级
          </button>
          <div style={{ flex: 1 }} />
          <span title="按当前模型与参数实时预估的点数消耗，仅供参考" style={{ fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }}>
            ⚡ {costEstimateLabel(estimateImageCost(model, isSoul ? batchCount : 1, { resolution: payload.imageResolution })) || "—"}
          </span>
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); if (!generating && payload.promptText?.trim()) handleGenerate(); }}
            disabled={generating || !payload.promptText?.trim()}
            title={generating ? "生成中…" : "生成分镜图"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: generating || !payload.promptText?.trim() ? "not-allowed" : "pointer", background: generating || !payload.promptText?.trim() ? "var(--c-surface)" : "var(--ui-accent, var(--c-accent))", color: generating || !payload.promptText?.trim() ? "var(--c-t4)" : "#0b0d12" }}
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
        {/* #87 自建算力：创意模式下也展示地址 + checkpoint 配置 */}
        {(payload.imageModel as string | undefined) === COMFY_LOCAL_MODEL && (
          <div className="nodrag" style={{ marginTop: 6 }}><ComfyCkptSelect enabled width={160} /></div>
        )}
      </InlineGenBar>
    )}

    {/* LibTV：输入条「风格」chip 打开的风格库（portal 到 body） */}
    {styleOpen && (
      <StylePicker
        onClose={() => setStyleOpen(false)}
        onSelect={(p) => {
          const cur = (payload.promptText ?? "").trim();
          handleChange("promptText", cur ? `${cur}，${p.prompt}` : p.prompt);
          toast.success(`已应用风格：${p.label}`);
        }}
      />
    )}

    {/* #90 LibTV「标记」元素选择浮层：AI 分析后点选元素 → 插入「图片N 的<元素>」引用 */}
    {markState && (
      <MarkElementPicker
        imageUrl={markState.url}
        elements={markState.elements}
        loading={markState.loading}
        error={markState.error}
        onClose={() => setMarkState(null)}
        model={markModel}
        onModelChange={(m) => { setMarkModel(m); saveMarkModel(m); runMarkAnalyze(markState.url, m); }}
        onSelect={(name) => {
          const idx = refImages.images.findIndex((r) => r.url === markState.url);
          const refToken = idx >= 0 ? `图片${idx + 1} 的${name}` : name;
          const cur = (payload.promptText ?? "").trim();
          updateNodeData(id, {
            promptText: cur ? `${cur} ${refToken} ` : `${refToken} `,
            markRefs: [...(payload.markRefs ?? []), { id: nanoid(8), url: markState.url, element: name, token: refToken, elements: markState.elements }],
          });
          setMarkState(null);
          toast.success(`已插入标记引用：${refToken}`);
        }}
      />
    )}

    {/* #90 摄像机参数选择器（与视频节点同款）：相机/镜头/焦距/光圈 → 注入本镜提示词，重复应用先替换 */}
    {camRigOpen && (
      <CameraRigPicker
        active={/shot on /i.test(payload.promptText ?? "")}
        onApply={(frag) => {
          const base = stripCameraRig(payload.promptText ?? "");
          handleChange("promptText", base ? `${base}，${frag}` : frag);
          toast.success("已注入摄像机参数");
        }}
        onClear={() => { handleChange("promptText", stripCameraRig(payload.promptText ?? "")); toast.success("已清除摄像机参数"); }}
        onClose={() => setCamRigOpen(false)}
      />
    )}

      {/* ── Image lightbox (portal to body — avoids React Flow event interception) ── */}
      {zoomUrl && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            background: "oklch(0 0 0 / 0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setZoomUrl(null); }}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <MediaImage
              src={zoomUrl}
              alt="分镜大图"
              style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8, display: "block" }}
            />
            {/* Top-right controls */}
            <div style={{ position: "absolute", top: -12, right: -12, display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(zoomUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    const ext = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg"
                      : blob.type.includes("webp") ? "webp"
                      : "png";
                    const a = document.createElement("a");
                    const objectUrl = URL.createObjectURL(blob);
                    a.href = objectUrl;
                    a.download = `storyboard.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
                  } catch (err) {
                    // Only fall back to window.open for CORS/network errors (TypeError),
                    // not for HTTP errors (403, 404) where opening a new tab is unhelpful
                    if (err instanceof TypeError && /^https?:\/\//i.test(zoomUrl)) {
                      toast.info("直接下载失败，将尝试在新标签页打开");
                      window.open(zoomUrl, "_blank", "noopener,noreferrer");
                    } else {
                      toast.error("下载失败，图片无法访问");
                    }
                  }
                }}
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: "oklch(0.72 0.18 160 / 0.20)", border: "1px solid oklch(0.72 0.18 160 / 0.5)",
                  color: "oklch(0.80 0.16 160)", cursor: "pointer",
                }}
                title="下载图片"
              >
                <Download style={{ width: 14, height: 14 }} />
              </button>
              <button
                onClick={() => setZoomUrl(null)}
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: "oklch(0.55 0.0 0 / 0.5)", border: "1px solid rgba(255,255,255,0.15)",
                  color: "white", cursor: "pointer",
                }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    {/* 3D 查看器必须在 BaseNode 外（children 随选中态换容器会把全屏层卸载——图像节点同款修复） */}
    {view3dSrc && (
      <Depth3DViewer
        sourceImageUrl={view3dSrc}
        onClose={() => setView3dSrc(null)}
        onGenerate={(capturedUrl) => {
          updateNodeData(id, { referenceImageUrl: capturedUrl });
          setPendingGen3d(true); // 参考图落 payload 后由 effect 触发重绘
        }}
      />
    )}
    {model3dSrc && (
      <Model3DViewer
        sourceImageUrl={model3dSrc}
        initialGlbUrl={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.glbUrl : undefined}
        savedToLibrary={payload.model3d?.sourceUrl === model3dSrc ? payload.model3d.saved : undefined}
        projectId={data.projectId}
        nodeId={id}
        onGlbReady={(glbUrl) => updateNodeData(id, { model3d: { sourceUrl: model3dSrc, glbUrl } })}
        onSavedToLibrary={() => payload.model3d && updateNodeData(id, { model3d: { ...payload.model3d, saved: true } })}
        onClose={() => setModel3dSrc(null)}
        onGenerate={(capturedUrl) => {
          updateNodeData(id, { referenceImageUrl: capturedUrl });
          setPendingGen3d(true);
        }}
      />
    )}
    </>
  );
});

// Editable scene-number badge: click to edit, Enter / blur to save, Esc cancels.
// Lives separately from the BaseNode title (which carries "分镜 #N") so users
// can renumber a shot independent of the panel title — useful when re-ordering
// scenes after AI generation.
function SceneNumberBadge({
  value,
  onChange,
}: {
  value?: number | string;
  onChange: (v: number | string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  useEffect(() => { setDraft(value != null ? String(value) : ""); }, [value]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) { onChange(undefined); return; }
    // Preserve numeric type when input is purely digits (keeps backward
    // compatibility with templates / AI generation that emit Number values).
    // Anything else (letters, mixed, symbols) is stored as the user's string
    // verbatim — supports labels like "开场", "S1", "插曲#3".
    const asNumber = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    if (asNumber !== null && Number.isFinite(asNumber)) onChange(asNumber);
    else onChange(trimmed);
  };

  // Width grows with content so a long label like "开场镜头" doesn't get
  // clipped while still keeping the badge tight for short numbers.
  const measuredWidth = Math.max(28, Math.min(160, draft.length * 7 + 14));

  if (editing) {
    return (
      <div
        className="absolute top-2 left-2 nodrag nowheel"
        style={{
          background: "oklch(0 0 0 / 0.85)",
          backdropFilter: "blur(4px)",
          borderRadius: 4,
          display: "flex", alignItems: "center",
          padding: "1px 4px",
          gap: 2,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span style={{ color: "oklch(0.75 0.18 160)", fontSize: 10, fontWeight: 600 }}>#</span>
        <input
          autoFocus
          type="text"
          value={draft}
          maxLength={24}
          onChange={(e) => setDraft(e.target.value.slice(0, 24))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); }
          }}
          style={{
            width: measuredWidth,
            padding: 0,
            fontSize: 10,
            fontWeight: 600,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "oklch(0.75 0.18 160)",
            textAlign: "left",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold nodrag"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="点击编辑场景编号（任意字符，最多 24 字）"
      style={{
        background: "oklch(0 0 0 / 0.65)",
        color: "oklch(0.75 0.18 160)",
        backdropFilter: "blur(4px)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: 180,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value != null && value !== "" ? `#${value}` : "#?"}
    </div>
  );
}
