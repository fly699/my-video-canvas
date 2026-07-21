import { memo, useState, useRef, useCallback, useEffect, lazy, Suspense, useMemo } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, NodeResizer, NodeToolbar, useUpdateNodeInternals, useStore } from "@xyflow/react";
import { getNodeConfig, COLLABORATOR_COLORS } from "../../lib/nodeConfig";
import { CONNECTION_HINTS, getCompatibleTargets, defaultTargetHandle } from "../../lib/connectionRules";
import type { NodeType, ImageEditOp, VideoTaskNodeData } from "../../../../shared/types";
import { maxRefImagesForProvider } from "../../../../shared/videoRefCaps";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { useStudioExpandAll } from "../../hooks/useStudioExpandAll";
import { useBoxSelecting } from "../../hooks/useBoxSelecting";
import { useNodeExpandable } from "../../hooks/useNodeExpandGuard";
import { useComfyPreviewStore } from "../../hooks/useComfyPreviewStore";
import { useConnectState } from "../../hooks/useConnectingStore";
import { useHoverStore } from "../../hooks/useHoverStore";
import { NodeSelectedContext } from "../../contexts/NodeSelectedContext";
import { StudioFloatingContext } from "../../contexts/StudioFloatingContext";
import { trpc } from "@/lib/trpc";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useUIStyle } from "../../contexts/UIStyleContext";
import { StudioCommandBar, STUDIO_COMMAND_BAR_TYPES } from "./studio/StudioCommandBar";
import { useLightbox } from "./studio/Lightbox";
import {
  Trash2, Copy, GripVertical, Check, X, Loader2, FileText, AlertTriangle, Pin, Pencil, Share2, Play, RefreshCw, Layers, Download, ChevronDown, ChevronUp, Maximize2, Lock,
  Scissors, Sun, Crop, Expand, Film, Captions, Wand2, Combine, Video, Sparkles, Grid3X3, LayoutGrid, Music2, CircleSlash, Rotate3d, Boxes, Focus, Eraser, Columns2, Link2,
} from "lucide-react";
import { getGridPreset, buildGridPrompt } from "../../../../shared/grid";
import { parseRecoverableTask, stripRecoverableMarker } from "../../lib/recoverableError";
import { sourceAspectRatio, imageNaturalRatio, nearestAspect } from "../../lib/imageAspect";
import { downloadMedia } from "../../lib/download";
import { NODE_ICONS } from "../../lib/nodeConfig";
import { VARIANT_TYPES } from "../../hooks/useCanvasStore";
import { toast } from "sonner";
import { openNodeCompare } from "./CompareLightbox";
import { detectUpstreamImages, listUpstreamVideoSources } from "../../lib/comfyWorkflowParams";
import { hasPassableOutput, directPassDownstream } from "../../lib/canvasPassthrough";
import { handleStyle } from "../../lib/handleStyle";
import { agentBadge } from "../../lib/agentOwnership";
import { ModelPicker, IMAGE_MODEL_PICKER_OPTIONS, useResolvedDefaultImageOption, type ModelPickerOption } from "./ModelPicker";
import { estimateImageCost, costEstimateLabel } from "../../lib/costEstimate";
import { COMFY_LOCAL_MODEL, COMFY_LOCAL_OPTION, loadComfyCkpt, loadComfyBase } from "../../lib/comfyLocalRoute";
import { ComfyCkptSelect } from "./ComfyCkptSelect";
import { QuickTrimBar } from "./QuickTrimBar";
import { confirmRegenerate } from "../../lib/confirmRegenerate";

// Nodes that keep their full PRO body in the studio skin (no floating command bar,
// no top toolbar, no compact panel). Their UX isn't a parameter form.
// super_agent（工程智能体）同理——它是「任务输入 + 流式活动日志 + 结果 + 写回」的交互面板，
// 不是参数表单；不加入这里会在工作室模式被折叠成「空标题卡 + 参数浮层下方」，上方窗口空着。
const STUDIO_PRO_BODY_TYPES = new Set<NodeType>(["ai_chat", "super_agent"]);

// #72 LibTV 多角度/打光全功能编辑器（全模式）：懒加载，仅在打开时拉取代码。
const MultiAngleEditorLazy = lazy(() => import("./editors/AngleRelightEditors").then((m) => ({ default: m.MultiAngleEditor })));
const RelightEditorLazy = lazy(() => import("./editors/AngleRelightEditors").then((m) => ({ default: m.RelightEditor })));

// #73 纳管：工具箱宫格管线（多机位九宫格/连贯分镜/剧情推演/三视图/表情表/±5s推演）
// 此前一律走服务端默认模型且无计价显示（隐形付费点）。补模型选择（记忆到 localStorage）
// + 计价显示，并把 model/estimatedCost 回传服务端（审计日志随之记录真实模型与预估）。
const TOOLKIT_MODEL_KEY = "canvas.toolkitImageModel";
const TOOLKIT_MODEL_OPTIONS: ModelPickerOption[] = [
  { value: "", label: "默认模型（系统设置）", group: "默认", family: "默认" },
  COMFY_LOCAL_OPTION,
  ...IMAGE_MODEL_PICKER_OPTIONS,
];
/** 把「默认模型」哨兵项的 label/costLabel 换成解析后的真实模型（如「默认 · GPT Image 2」）。 */
function withResolvedDefault(options: ModelPickerOption[], dft: { label: string; costLabel: string }): ModelPickerOption[] {
  return options.map((o) => (o.value === "" ? { ...o, label: `默认 · ${dft.label}`, costLabel: dft.costLabel } : o));
}
const toolkitCostLabel = (model: string): string => {
  if (!model) return "按系统默认模型";
  if (model === COMFY_LOCAL_MODEL) return "自建 · 免云端积分";
  const c = estimateImageCost(model);
  return c ? costEstimateLabel(c) : "按模型页";
};


interface BaseNodeProps {
  id: string;
  selected?: boolean;
  nodeType: NodeType;
  title: string;
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  showHandles?: boolean;
  headerRight?: React.ReactNode;
  /** 是否允许用户手动拖拽缩放，默认 false */
  resizable?: boolean;
  /** 创意模式下显示在标题栏下方的媒体英雄区（图片/视频预览），选中时展开表单控件 */
  heroMedia?: React.ReactNode;
  /** 左侧吸附浮层（如参考图预览条带）。渲染在折叠 body 之外，故节点收缩后仍常驻可见。 */
  leftDock?: React.ReactNode;
  /** 自定义连接桩（用于多桩节点如剪辑）。渲染在折叠 body 之外，与 BaseNode 自带桩同层，
   *  故工作室收缩态 body 折叠后仍可见。配 showHandles={false} 使用（替代默认桩）。 */
  extraHandles?: React.ReactNode;
  /** 标题栏常驻"运行/重新生成"按钮的处理器；提供则渲染按钮（覆盖所有主题/模式）。 */
  onRun?: () => void;
  /** 是否允许运行（默认 true）；false 时按钮禁用置灰。 */
  canRun?: boolean;
  /** 节点本地运行态（如生成中），优先于全局 runStatus。 */
  running?: boolean;
  /** 是否已有结果：true → 图标 RefreshCw + "重新生成"；false → Play + "运行"。 */
  hasResult?: boolean;
  /** 可选：自定义节点外框基础色（oklch 等）。设置后静止/选中态边框用此色着色，
   *  用于以颜色区分节点的运行模式（如 ComfyUI 本地 vs 云端）。不影响运行态边框。 */
  borderTint?: string;
  /** 可选：标题栏 hover 提示文本（覆盖默认的"双击编辑标题"）。
   *  用于在标题上展示节点的附加信息（如 ComfyUI 工作流模型详情）。 */
  headerTooltip?: string;
  /** 可选：隐藏右上角的节点类型徽章（如「COMFYUI 视频」）。 */
  hideTypeBadge?: boolean;
  /** 可选：给整个节点高度封顶为 3×宽度，超出由节点内部滚动消化（如 Agent 长输出）。
   *  用户手动 resize（写入 style.height）后自动解除该上限。 */
  capNodeHeight?: boolean;
  /** 可选：从素材面板把图片直接拖到整个节点上时，接收这些图片 URL（按顺序）。提供后，
   *  拖放被节点消费（preventDefault），画布不再新建素材节点。供有参考图字段的节点接入。 */
  onAssetImageDrop?: (urls: string[]) => void;
  /** 可选：鼠标悬停标题栏满 1 秒触发（true）、离开时（false）。用于临时展开参考图/提示词吸附窗。 */
  onHeaderHoverChange?: (hovering: boolean) => void;
  /** #133 全净卡（LibTV 角色卡形态）：创意模式且有 heroMedia 时，标题栏不再占布局——
   *  改为悬停/选中才浮现的顶部渐变叠加条（改名/按钮功能全保留）。姓名等身份信息由
   *  节点自己的 hero 内元素（如角色姓名条）承担。 */
  heroBareHeader?: boolean;
  /** #142 常驻进度条右端的「取消」处理器（如 ComfyUI /interrupt）。提供后生成中在
   *  进度条上渲染取消按钮——节点折叠/未选中也可达（此前取消只在收起的配置区里）。 */
  onCancelGenerate?: () => void;
}

/** LibTV 化 3.3：创意模式英雄区右下角的尺寸标注 chip——读取容器内首个
 *  img/video 的自然分辨率（LibTV 节点卡「大预览主体 + 尺寸标注」形态）。
 *  用事件捕获 + MutationObserver 兜底：媒体懒加载/结果替换时自动刷新。 */
function HeroSizeBadge({ hostRef, variant = "chip" }: { hostRef: React.RefObject<HTMLDivElement | null>; variant?: "chip" | "text" }) {
  const [dim, setDim] = useState<string | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const read = () => {
      const img = host.querySelector("img");
      const vid = host.querySelector("video");
      if (img && img.naturalWidth) setDim(`${img.naturalWidth}×${img.naturalHeight}`);
      else if (vid && vid.videoWidth) setDim(`${vid.videoWidth}×${vid.videoHeight}`);
      else setDim(null);
    };
    read();
    const onLoad = () => read();
    host.addEventListener("load", onLoad, true);           // <img> load（捕获）
    host.addEventListener("loadedmetadata", onLoad, true); // <video> 元数据
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read); });
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      host.removeEventListener("load", onLoad, true);
      host.removeEventListener("loadedmetadata", onLoad, true);
      mo.disconnect(); cancelAnimationFrame(raf);
    };
  }, [hostRef]);
  if (!dim) return null;
  // text 版：LibTV 标签行右端的灰色尺寸小字（如「2048 × 1152」）；chip 版：媒体角落胶囊。
  if (variant === "text") {
    return (
      <span className="nodrag pointer-events-none flex-shrink-0"
        style={{ fontSize: 10, fontWeight: 500, color: "var(--c-t4)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
        {dim.replace("×", " × ")}
      </span>
    );
  }
  return (
    <span
      className="nodrag pointer-events-none"
      style={{
        position: "absolute", right: 6, bottom: 6, zIndex: 5,
        fontSize: 9, fontWeight: 700, letterSpacing: "0.03em", fontVariantNumeric: "tabular-nums",
        padding: "2px 6px", borderRadius: 6, lineHeight: 1.4,
        background: "oklch(0 0 0 / 0.55)", color: "oklch(0.92 0 0)",
        border: "1px solid oklch(1 0 0 / 0.14)", backdropFilter: "blur(6px)",
      }}
    >
      {dim}
    </span>
  );
}

/** 从拖拽数据里提取图片素材的 URL（仅 image 类型）。 */
function imageUrlsFromAssetDrag(dt: DataTransfer): string[] {
  const raw = dt.getData("application/x-asset-list");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{ url?: string; type?: string }>;
    return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
  } catch { return []; }
}

export const BaseNode = memo(function BaseNode({
  id, selected, nodeType, title, children,
  minWidth = 280, minHeight = 140, showHandles = true, headerRight, resizable = false,
  onRun, canRun = true, running: nodeRunning = false, hasResult = false,
  heroMedia, leftDock, extraHandles, borderTint, headerTooltip, hideTypeBadge, capNodeHeight = false, onAssetImageDrop,
  onHeaderHoverChange,
  heroBareHeader,
  onCancelGenerate,
}: BaseNodeProps) {
  // 已有生成结果时，点「运行/重新生成」按钮先二次确认（仅按钮入口；助手/工作流等
  // 程序化触发直接调各节点 submit，不经过这里）。
  const triggerRun = () => {
    if (!onRun) return;
    if (hasResult) { void confirmRegenerate().then((ok) => { if (ok) onRun(); }); return; }
    onRun();
  };
  const config = getNodeConfig(nodeType);
  const Icon = NODE_ICONS[config.icon] ?? FileText;
  // 窄 selector：只订阅这几个稳定 action + projectId，避免无 selector 订阅整个 store——
  // 否则任意节点拖动/输入触发的 set 会让画布上每个 BaseNode 重渲染（大图 O(N²)）。
  const { deleteNode, duplicateNode, createVariants, updateNodeTitle, projectId } = useCanvasStore(
    useShallow((s) => ({ deleteNode: s.deleteNode, duplicateNode: s.duplicateNode, createVariants: s.createVariants, updateNodeTitle: s.updateNodeTitle, projectId: s.projectId })),
  );
  // Detect ambiguous dual-target connection: when both `input` (left) and `top` handles
  // receive edges, the workflow runner only uses one — warn the user.
  const dualTargetConflict = useCanvasStore((s) => {
    if (!showHandles) return false;
    let hasInput = false, hasTop = false;
    for (const e of s.edges) {
      if (e.target !== id) continue;
      if (e.targetHandle === "input") hasInput = true;
      else if (e.targetHandle === "top") hasTop = true;
      if (hasInput && hasTop) return true;
    }
    return false;
  });

  // "直传" availability: this node has an output AND at least one outgoing edge,
  // so its current result can be pushed to downstream inputs without a run.
  const canDirectPass = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    if (!node || !hasPassableOutput(node.data.nodeType, (node.data.payload ?? {}) as Record<string, unknown>)) return false;
    return s.edges.some((e) => e.source === id);
  });
  const handleDirectPass = useCallback(() => {
    const { updated, skipped } = directPassDownstream(id);
    if (updated > 0) toast.success(`已直传到 ${updated} 个下游节点`);
    else if (skipped > 0) toast.info("下游节点不接受此输出类型");
    else toast.info("没有已连接的下游节点");
  }, [id]);

  // Pinned state — when true, child collapsible regions stay expanded
  // regardless of `selected`. Toggled via the right-click context menu.
  // Generation status/progress read straight from the payload, so a persistent
  // progress bar can render even when the node's config is collapsed (the per-node
  // progress bars live inside the collapsing body and vanish when deselected).
  const genStatus = useCanvasStore((s) => (s.nodes.find((n) => n.id === id)?.data.payload as { status?: string } | undefined)?.status);
  const genProgress = useCanvasStore((s) => {
    const p = (s.nodes.find((n) => n.id === id)?.data.payload as { progress?: number } | undefined)?.progress;
    return typeof p === "number" ? p : null;
  });
  // ComfyUI server queue depth while this node is waiting to start sampling.
  const genQueue = useCanvasStore((s) => {
    const q = (s.nodes.find((n) => n.id === id)?.data.payload as { queueRemaining?: number } | undefined)?.queueRemaining;
    return typeof q === "number" && q > 0 ? q : null;
  });
  const genError = useCanvasStore((s) => {
    const pl = s.nodes.find((n) => n.id === id)?.data.payload as { status?: string; errorMessage?: string } | undefined;
    return pl?.status === "failed" ? (pl.errorMessage || "生成失败") : null;
  });
  // Subtitle/burning nodes report busy via their own verbs ("transcribing"/
  // "burning"), not "processing" — recognize all of them so the persistent
  // progress bar stays visible when those nodes are collapsed too.
  const genBusy = genStatus === "processing" || genStatus === "transcribing" || genStatus === "burning";
  // Live ComfyUI sampling preview (transient; never persisted). Cleared as soon
  // as the run stops so a stale frame doesn't linger over the real result.
  const livePreview = useComfyPreviewStore((s) => s.previews[id]);
  useEffect(() => {
    if (!genBusy && livePreview) useComfyPreviewStore.getState().clearPreview(id);
  }, [genBusy, livePreview, id]);
  const pinned = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    return Boolean((node?.data.payload as Record<string, unknown> | undefined)?.pinned);
  });
  // ◆6 锁定：payload.locked。锁定节点不可拖/不可删(在 Canvas displayNodes 注入 draggable/deletable=false)。
  // 「跳过执行」：payload.disabled（右键切换）。运行器/估价同口径跳过；此处只管徽标。
  const runDisabled = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    return Boolean((node?.data.payload as Record<string, unknown> | undefined)?.disabled);
  });
  const locked = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    return Boolean((node?.data.payload as Record<string, unknown> | undefined)?.locked);
  });
  // 注意：多选时上游 CustomNode 已把 selected prop 压成 false（所有节点统一「框选不展开」），
  // 这里的 selected 即「单选展开」语义；选中描边用 store 真实选中态（storeSelected），
  // 框选高亮不丢。
  const storeSelected = useCanvasStore((s) => !!s.nodes.find((n) => n.id === id)?.selected);
  // ★3：是否多选（≥2 选中）。短路到 2 即返回布尔，避免每 BaseNode 全量 filter 的 O(n²)；
  // 只在跨越「1↔多」阈值时才触发 re-render。多选时非固定节点不再各自弹命令栏。
  const multiSelected = useCanvasStore((s) => { let c = 0; for (const n of s.nodes) { if (n.selected) { c++; if (c >= 2) return true; } } return false; });
  // expandSelected 在下方 boxSelecting 之后计算（需叠加「拖拽/框选不展开」守卫）。
  // Creator id (stamped into the payload at creation) → a per-collaborator color
  // dot in the title bar, matching the cursor / "在线协作者" colors. Only shown
  // for OTHER collaborators' nodes (your own stay undotted — no solo noise).
  const createdBy = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as { createdBy?: number } | undefined;
    return typeof p?.createdBy === "number" ? p.createdBy : null;
  });
  const currentUserId = useCanvasStore((s) => s.currentUserId);
  const creatorName = useCanvasStore((s) => (createdBy != null ? s.collaborators.get(createdBy)?.userName : undefined));
  const isOtherCreator = createdBy != null && currentUserId != null && createdBy !== currentUserId;
  const creatorColor = isOtherCreator ? COLLABORATOR_COLORS[createdBy % COLLABORATOR_COLORS.length] : null;
  // Owner-agent badge (multi-agent canvases): "A{n}" pill in the agent's color when
  // this node was generated by an agent that still exists. Stable string → no churn.
  const ownerBadgeKey = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as { ownerAgentId?: unknown } | undefined;
    const oid = typeof p?.ownerAgentId === "string" ? p.ownerAgentId : null;
    if (!oid || !s.nodes.some((n) => n.id === oid && n.data.nodeType === "agent")) return null;
    const b = agentBadge(oid, s.nodes);
    return `${b.color}|${b.index}`;
  });
  const ownerBadge = ownerBadgeKey ? { color: ownerBadgeKey.split("|")[0], index: Number(ownerBadgeKey.split("|")[1]) } : null;
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const { mode: canvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const { uiStyle } = useUIStyle();
  const isStudio = uiStyle === "studio";
  const isCreative = canvasMode === "creative";
  // LibTV 化 3.1：创意模式换为 LibTV 暗色皮肤——不论 theme 亮暗，创意一律走暗分支
  //（此前创意是强制暖白、被并入 isLight；现在反过来强制排除）。
  const isLight = !isCreative && (theme === "light" || theme === "warm" || theme === "mint" || theme === "lavender" || theme === "paper");
  const hasHero = heroMedia != null;
  const heroMediaRef = useRef<HTMLDivElement>(null); // LibTV 化 3.3：尺寸标注读取宿主
  // 节点 LOD：缩放很小时（<0.3）画布上一屏可挤下几十上百个节点，此时逐个渲染命令栏/
  // 参数表/工具条纯属浪费。用 useStore 只取「是否低于阈值」的布尔——仅在跨越阈值时才
  // 触发本节点重渲染（而非每次缩放都重渲），越阈值后隐藏交互 body（保留缩略图英雄区，
  // 以便缩略图纵览仍成立），到重新放大时自动恢复。
  const lodFar = useStore((s) => s.transform[2] < 0.3);
  // #11 协作编辑锁：他人正在编辑本节点时拿到其信息（多数节点恒为 undefined → 不触发重渲）。
  const peerEdit = useCanvasStore((s) => s.peerEditing.get(id));
  // Some nodes keep their full PRO body even in the studio skin (no floating
  // command bar / panel) — their editing UX doesn't fit a compact bar (e.g. the
  // AI chat node is a live conversation, not a parameter form).
  const usesStudioFloating = isStudio && !STUDIO_PRO_BODY_TYPES.has(nodeType);
  // Studio: when selected, the node card stays compact (header + hero media if any)
  // and the params float in a wide, short panel attached BELOW it (LibLib layout).
  // ★3：多选（≥2）时非固定节点不再逐个弹命令栏——批量操作交给底部 MultiSelectBar，画布保持清爽。
  // 框选拖拽进行中也不浮起——否则框内瞬时只覆盖 1 个节点时会被当单选而闪烁展开。
  const boxSelecting = useBoxSelecting();
  // 「展开配置区必须真点击」：拖拽/框选选中的节点入抑制集(useNodeExpandable→false)，不展开；
  // 框选进行中(boxSelecting)全程不展开；pinned 例外(用户显式钉住，恒展开)。真点击后清出抑制集。
  const expandable = useNodeExpandable(id);
  const expandSelected = pinned || (!!selected && !boxSelecting && expandable);
  const studioFloated = usesStudioFloating && !boxSelecting && expandable && (pinned || (storeSelected && !multiSelected));
  // Every fresh selection starts COMPACT: reset the expand flag whenever the node
  // is no longer the floating/selected one, so re-clicking never reopens expanded.
  // ★4：不再每次取消 floating 就重置展开态——由全局偏好记忆（useStudioExpandAll）。
  // Measure whether the capped compact body overflows → only then show the fade +
  // 展开 affordance (short bodies have nothing to expand). Runs after layout each
  // render but bails when the value is unchanged, so no update loop.
  useEffect(() => {
    const el = compactBodyRef.current;
    if (!el) { if (bodyOverflows) setBodyOverflows(false); return; }
    const overflows = el.scrollHeight > el.clientHeight + 4;
    if (overflows !== bodyOverflows) setBodyOverflows(overflows);
  });
  // Studio top toolbar: a real, gated download of the node's result media (the only
  // genuinely non-duplicate "top toolbar" action this app supports — the LibLib
  // AI ops like 打光/全景 don't exist here, so we don't fake them). Stable string
  // selectors so the subscription never churns.
  // Result media URL detection is PER NODE TYPE: different nodes persist their result
  // in different payload fields (imageUrl / resultVideoUrl / outputUrl / outputUrls / url).
  // The studio toolbar (download + quick actions) keys off these, so every result-bearing
  // type must be mapped or the node shows only "重新生成". `outputUrl` is ambiguous —
  // it's an image for image_edit but a video for clip/merge/subtitle/overlay/…，故按类型分流。
  const resultVideoUrl = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as Record<string, unknown> | undefined;
    if (!p) return "";
    const first = (v: unknown): string => (typeof v === "string" && v ? v.split("\n")[0].trim() : "");
    switch (nodeType) {
      case "video_task":
      case "comfyui_video":
        return first(p.resultVideoUrl);
      case "clip":
      case "merge":
      case "subtitle":
      case "subtitle_motion":
      case "overlay":
      case "smart_cut":
        return first(p.outputUrl);
      case "comfyui_workflow":
        return p.outputType === "video" && Array.isArray(p.outputUrls)
          ? (((p.outputUrls as unknown[]).find((u): u is string => typeof u === "string")) ?? "")
          : "";
      case "asset":
        return p.type === "video" ? first(p.url) : "";
      default:
        return first(p.videoUrl);
    }
  });
  const resultImageUrl = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as Record<string, unknown> | undefined;
    if (!p) return "";
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    switch (nodeType) {
      case "image_gen":
      case "comfyui_image":
      case "storyboard":
        return str(p.imageUrl);
      case "image_edit":
        return str(p.outputUrl);
      case "comfyui_workflow":
        return p.outputType !== "video" && Array.isArray(p.outputUrls)
          ? (((p.outputUrls as unknown[]).find((u): u is string => typeof u === "string")) ?? "")
          : "";
      case "asset":
        return p.type === "image" ? str(p.url) : "";
      default:
        return str(p.imageUrl);
    }
  });
  // All result images of this node (image_gen batch → imageUrls) for lightbox ←/→ paging.
  const heroImageList = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as Record<string, unknown> | undefined;
    const arr = Array.isArray(p?.imageUrls) ? (p!.imageUrls as unknown[]).filter((u): u is string => typeof u === "string") : [];
    return arr.join("\n");
  });
  const openLightbox = () => {
    if (resultVideoUrl) { useLightbox.getState().open([resultVideoUrl], 0, "video", title, id); return; }
    if (!resultImageUrl) return;
    const list = heroImageList ? heroImageList.split("\n") : [resultImageUrl];
    useLightbox.getState().open(list, Math.max(0, list.indexOf(resultImageUrl)), "image", title, id);
  };

  // Liblib-style quick AI-edit: spawn an image_edit node preset to `operation`, with this
  // node's result image as its source (set directly + wired by an edge), then select it.
  const spawnImageEdit = (operation: ImageEditOp, label: string) => {
    if (!resultImageUrl) return;
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
    let node;
    try { node = st.addNode("image_edit", { x: self.position.x + w + 60, y: self.position.y }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); return; }
    st.updateNodeData(node.id, { operation, sourceImageUrl: resultImageUrl });
    st.onConnect({ source: id, sourceHandle: "output", target: node.id, targetHandle: "input" });
    // select the new node from FRESH state (addNode/updateNodeData replaced the array)
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node!.id })) }));
    toast.success(`已创建「${label}」编辑节点（已连源图，点运行生成）`, { duration: 1800 });
  };
  // 就地版本对比（不建对比节点）：从本节点找 B 候选——版本历史上一版 > 多结果第二张/段 >
  // 本节点源媒体（剪辑/编辑类：结果 vs 原片）> 上游第一路媒体（结果 vs 源），
  // 直接全屏打开滑块对比查看器（openNodeCompare）。无第二源时给出明确提示。
  const openSelfCompare = (currentUrl: string) => {
    const st = useCanvasStore.getState();
    const p = (st.nodes.find((n) => n.id === id)?.data.payload ?? {}) as Record<string, unknown>;
    const history = (p.resultHistory as { url: string }[] | undefined) ?? [];
    const multi = ([...(p.imageUrls as string[] | undefined) ?? [], ...(p.outputUrls as string[] | undefined) ?? [], ...(p.resultUrls as string[] | undefined) ?? []]).filter((u) => typeof u === "string" && u);
    // 源媒体字段（原视频/原图）：剪辑 videoUrl、图像编辑 sourceImageUrl、图生类 referenceImageUrl
    const selfSources = [p.videoUrl, p.sourceVideoUrl, p.inputUrl, p.sourceImageUrl, p.referenceImageUrl]
      .filter((u): u is string => typeof u === "string" && !!u);
    let bUrl = history.find((h) => h.url && h.url !== currentUrl)?.url
      ?? multi.find((u) => u !== currentUrl)
      ?? selfSources.find((u) => u !== currentUrl);
    if (!bUrl) {
      // 上游第一路媒体（视频优先）：剪辑/字幕/合并等「结果 vs 原片」、生成节点「结果 vs 参考」
      const ups = [
        ...listUpstreamVideoSources(id, st.edges, st.nodes).map((v) => v.url),
        ...detectUpstreamImages(id, st.edges, st.nodes),
      ].filter(Boolean);
      bUrl = ups.find((u) => u !== currentUrl);
    }
    if (!bUrl) { toast.info("没有可对比的第二个媒体——再生成一次、或连一路源素材"); return; }
    openNodeCompare(currentUrl, bUrl);
  };
  const QUICK_EDITS: { op: ImageEditOp; label: string; Icon: typeof Scissors }[] = [
    { op: "upscale", label: "高清", Icon: Sparkles },
    { op: "remove_bg", label: "去背景", Icon: Scissors },
    { op: "outpaint", label: "扩图", Icon: Expand },
    { op: "reframe", label: "改比例", Icon: Crop },
    // LibTV #59：聚焦=局部重绘（涂抹聚焦区域重点重绘）、擦除物体——op 与蒙版涂抹器均为既有能力。
    { op: "inpaint", label: "聚焦", Icon: Focus },
    { op: "erase", label: "擦除", Icon: Eraser },
  ];

  // #72 多角度/打光全功能编辑器：结果写回本节点结果字段（useResultHistoryCapture
  // 会自动把旧图押入版本历史），字段按 nodeType 与 resultImageUrl 的读取口径一致。
  const [angleEditorOpen, setAngleEditorOpen] = useState(false);
  const [relightEditorOpen, setRelightEditorOpen] = useState(false);
  // #103 快剪覆盖所有视频节点：video_task 之外的类型由 BaseNode 统一渲染快剪条
  const [quickTrimOpen, setQuickTrimOpen] = useState(false);
  const applyEditedImage = useCallback((url: string) => {
    const st = useCanvasStore.getState();
    switch (nodeType) {
      case "image_edit": st.updateNodeData(id, { outputUrl: url }); break;
      case "comfyui_workflow": {
        const p = st.nodes.find((n) => n.id === id)?.data.payload as Record<string, unknown> | undefined;
        const urls = Array.isArray(p?.outputUrls) ? [...(p!.outputUrls as string[])] : [];
        urls[0] = url;
        st.updateNodeData(id, { outputUrls: urls });
        break;
      }
      case "asset": st.updateNodeData(id, { url }); break;
      default: st.updateNodeData(id, { imageUrl: url });
    }
  }, [id, nodeType]);

  // ── LibTV 式一键编排：多角度（九宫格多机位）与宫格切分 ─────────────────────────
  // 多角度：以本图为参考生成多机位九宫格 → 切分 → 产物落入新建 image_gen 节点
  // （imageUrls 网格展示），连线 本节点 → 新节点（矩阵允许 image_gen→image_gen 族）。
  // 宫格切分：直接把本图按 N×N 切分落新节点。全部复用 imageGen.generate / imageGrid.slice。
  const gridGenMut = trpc.imageGen.generate.useMutation();
  const gridSliceMut = trpc.imageGrid.slice.useMutation();
  // #77：工具箱宫格管线的本地自建路由（comfyui img2img，带参考图）
  const gridComfyMut = trpc.comfyui.generateImage.useMutation();
  const [gridBusy, setGridBusy] = useState(false);
  const [gridMenuOpen, setGridMenuOpen] = useState(false);
  // 阶段四 4.1 工具箱下拉（连贯分镜/剧情推演/±5s 画面推演/三视图/表情表）
  const [toolkitOpen, setToolkitOpen] = useState(false);
  // #73 工具箱宫格管线模型选择（""=系统默认），记忆到 localStorage；计价随选联动
  const [toolkitModel, setToolkitModel] = useState<string>(() => { try { return localStorage.getItem(TOOLKIT_MODEL_KEY) ?? ""; } catch { return ""; } });
  // 默认哨兵解析显示：让「默认模型」直接亮出实际会用的模型与计价（项目>系统>出厂）
  const resolvedDft = useResolvedDefaultImageOption();
  const toolkitOptionsResolved = useMemo(() => withResolvedDefault(TOOLKIT_MODEL_OPTIONS, resolvedDft), [resolvedDft.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolkitCost = toolkitModel ? toolkitCostLabel(toolkitModel) : ('默认 · ' + resolvedDft.label + ' · ' + resolvedDft.costLabel);
  const pickToolkitModel = (v: string) => { setToolkitModel(v); try { localStorage.setItem(TOOLKIT_MODEL_KEY, v); } catch { /* ignore */ } };

  const spawnImageResultNode = (nodeTitle: string, urls: string[], heroUrl?: string) => {
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
    let node;
    try { node = st.addNode("image_gen", { x: self.position.x + w + 60, y: self.position.y }); }
    catch (e) {
      // 生成已完成（已计费）却建不了节点：明确告知产物在素材库，别让用户以为白花积分。
      toast.error(`${e instanceof Error ? e.message : "创建节点失败"}——产物已存入素材库（左栏「资产」可找回）`);
      return;
    }
    st.updateNodeTitle(node.id, nodeTitle);
    st.updateNodeData(node.id, { prompt: "", imageUrl: heroUrl ?? urls[0], imageUrls: urls, heroView: "grid" });
    st.onConnect({ source: id, sourceHandle: "output", target: node.id, targetHandle: "input" });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node!.id })) }));
  };

  /** 阶段四 4.1 工具箱通用管线：以本图为参考 → 生成宫格 sheet → 自动切分 → 落新节点。
   *  「多角度/连贯分镜/剧情推演/三视图/表情表」共用（preset 与措辞不同而已）。 */
  const runGridSheet = async (presetId: string, subject: string, titlePrefix: string, doneLabel: string) => {
    if (gridBusy || !resultImageUrl) return;
    const preset = getGridPreset(presetId);
    if (!preset) return;
    setGridBusy(true);
    setToolkitOpen(false);
    const tid = toast.loading(`${titlePrefix}生成中（${preset.rows}×${preset.cols} 宫格 → 自动切分）…`);
    try {
      let gridUrl = "";
      if (toolkitModel === COMFY_LOCAL_MODEL) {
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("本地 ComfyUI 需先在工具箱菜单里选择 checkpoint 模型", { id: tid }); setGridBusy(false); return; }
        const gen = await gridComfyMut.mutateAsync({
          nodeId: id, projectId: projectId ?? 0, workflowTemplate: "img2img", ckpt, customBaseUrl: loadComfyBase() || undefined,
          prompt: buildGridPrompt(subject, preset).slice(0, 2000),
          referenceImageUrl: resultImageUrl, denoise: 0.8,
        });
        gridUrl = gen.url || "";
      } else {
        // sheet 比例按源图画幅推导：每格比例 = 源图比例 → sheet = 源比例 × cols/rows，
        // 切分后的每一格都继承原图画幅（读不出尺寸时回落预设 sheetAspect）。
        const srcRatio = await imageNaturalRatio(resultImageUrl);
        const sheetAspect = (srcRatio ? nearestAspect((srcRatio * preset.cols) / preset.rows) : undefined) ?? preset.sheetAspect;
        const gen = await gridGenMut.mutateAsync({
          prompt: buildGridPrompt(subject, preset),
          referenceImageUrl: resultImageUrl,
          aspectRatio: sheetAspect, poyoAspectRatio: sheetAspect, reveAspectRatio: sheetAspect,
          ...(projectId ? { projectId } : {}),
          ...(toolkitModel ? { model: toolkitModel, estimatedCost: toolkitCost } : {}),
        } as Parameters<typeof gridGenMut.mutateAsync>[0]);
        gridUrl = gen.urls?.[0] || gen.url || "";
      }
      if (!gridUrl) throw new Error("未返回宫格图");
      // 切分失败不许把已生成（已计费、已入素材库）的宫格图丢在库里不见天日——
      // 落宫格原图节点兜底，用户可手动「宫格切分」重试（真实反馈：产物只进素材库不建节点）。
      let slicedUrls: string[] = [];
      try {
        const sliced = await gridSliceMut.mutateAsync({ imageUrl: gridUrl, rows: preset.rows, cols: preset.cols, ...(projectId ? { projectId } : {}) });
        slicedUrls = sliced.urls;
      } catch { /* 下方按整图兜底 */ }
      if (slicedUrls.length) {
        spawnImageResultNode(`${titlePrefix} · ${slicedUrls.length} 张`, slicedUrls);
        toast.success(`已生成 ${slicedUrls.length} ${doneLabel}（新节点）`, { id: tid });
      } else {
        spawnImageResultNode(`${titlePrefix} · 宫格原图`, [gridUrl], gridUrl);
        toast.warning(`宫格已生成但自动切分失败——已把整张宫格图落为新节点，可在节点上手动「宫格切分」`, { id: tid });
      }
    } catch (e) {
      toast.error(`${titlePrefix}生成失败：` + (e instanceof Error ? e.message : String(e)), { id: tid });
    } finally { setGridBusy(false); }
  };

  const handleMultiAngle = () =>
    runGridSheet("grid9", "the exact same subject and scene shown in the reference image", "多角度", "个机位角度");

  /** 阶段四 4.1 画面推演 ±N 秒：生成「本画面 N 秒前/后」的单帧（同机位同风格的时间外推）。 */
  const handleTemporalShift = async (deltaSeconds: number) => {
    if (gridBusy || !resultImageUrl) return;
    setGridBusy(true);
    setToolkitOpen(false);
    const later = deltaSeconds > 0;
    const n = Math.abs(deltaSeconds);
    const label = later ? `推演后 ${n} 秒` : `回溯前 ${n} 秒`;
    const tid = toast.loading(`${label}画面生成中…`);
    try {
      const tsPrompt = `the exact same scene, subjects and camera position as the reference image, but exactly ${n} seconds ${later ? "LATER" : "EARLIER"} in time — ${later ? "show the natural continuation of the action and motion that follows this moment" : "show the moment that naturally led up to this frame"}, single frame, consistent characters, lighting and art style`;
      let url = "";
      if (toolkitModel === COMFY_LOCAL_MODEL) {
        const ckpt = loadComfyCkpt();
        if (!ckpt) { toast.error("本地 ComfyUI 需先在工具箱菜单里选择 checkpoint 模型", { id: tid }); setGridBusy(false); return; }
        const gen = await gridComfyMut.mutateAsync({
          nodeId: id, projectId: projectId ?? 0, workflowTemplate: "img2img", ckpt, customBaseUrl: loadComfyBase() || undefined,
          prompt: tsPrompt.slice(0, 2000), referenceImageUrl: resultImageUrl, denoise: 0.7,
        });
        url = gen.url || "";
      } else {
        // 推演产物必须继承源图画幅：按源图实际宽高就近取比例传给三类模型的比例通道。
        const ar = await sourceAspectRatio(resultImageUrl);
        const gen = await gridGenMut.mutateAsync({
          prompt: tsPrompt,
          referenceImageUrl: resultImageUrl,
          ...(ar ? { aspectRatio: ar, poyoAspectRatio: ar, reveAspectRatio: ar } : {}),
          ...(projectId ? { projectId } : {}),
          ...(toolkitModel ? { model: toolkitModel, estimatedCost: toolkitCost } : {}),
        } as Parameters<typeof gridGenMut.mutateAsync>[0]);
        url = gen.urls?.[0] || gen.url || "";
      }
      if (!url) throw new Error("未返回图片");
      spawnImageResultNode(`${label}`, [url], url);
      toast.success(`已生成「${label}」画面（新节点）`, { id: tid });
    } catch (e) {
      toast.error(`${label}生成失败：` + (e instanceof Error ? e.message : String(e)), { id: tid });
    } finally { setGridBusy(false); }
  };

  const handleGridSlice = async (rows: number, cols: number) => {
    if (gridBusy || !resultImageUrl) return;
    setGridMenuOpen(false);
    setGridBusy(true);
    const tid = toast.loading(`宫格切分（${rows}×${cols}）…`);
    try {
      const sliced = await gridSliceMut.mutateAsync({ imageUrl: resultImageUrl, rows, cols, ...(projectId ? { projectId } : {}) });
      if (!sliced.urls.length) throw new Error("未产生子图");
      spawnImageResultNode(`宫格切分 · ${sliced.urls.length} 张`, sliced.urls);
      toast.success(`已切分为 ${sliced.urls.length} 张子图（新节点）`, { id: tid });
    } catch (e) {
      toast.error("宫格切分失败：" + (e instanceof Error ? e.message : String(e)), { id: tid });
    } finally { setGridBusy(false); }
  };

  // Liblib-style 图生视频: spawn a connected downstream video_task using this node's
  // image result as the i2v first frame (set referenceImageUrl directly + wire by edge),
  // then select it. Only offered for image-result nodes whose type can wire into a
  // video_task (image_gen / image_edit / comfyui_image / asset …).
  const spawnVideoFromImage = () => {
    if (!resultImageUrl) return;
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
    let node;
    try { node = st.addNode("video_task", { x: self.position.x + w + 60, y: self.position.y }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); return; }
    st.updateNodeData(node.id, { referenceImageUrl: resultImageUrl });
    st.onConnect({ source: id, sourceHandle: "output", target: node.id, targetHandle: "input" });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node!.id })) }));
    toast.success("已创建「图生视频」节点（已连源图作首帧，配置后运行生成）", { duration: 1800 });
  };

  // Liblib-style quick video actions: spawn a connected downstream video node
  // (剪辑/字幕/智能剪辑/合并). The new node auto-detects this node's result video
  // through the edge (clip/subtitle/merge/smart_cut all read upstream video), so
  // just create + wire + select. Which actions show is filtered by the connection
  // matrix per nodeType (getCompatibleTargets), so each is always a valid wire.
  const spawnDownstream = (type: NodeType, label: string) => {
    if (!resultVideoUrl) return;
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
    let node;
    try { node = st.addNode(type, { x: self.position.x + w + 60, y: self.position.y }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); return; }
    // clip 无 `input` 桩，下游若是剪辑需连到 video-in（源是本节点的视频结果）；defaultTargetHandle 统一分流。
    st.onConnect({ source: id, sourceHandle: "output", target: node.id, targetHandle: defaultTargetHandle(type, nodeType) });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node!.id })) }));
    toast.success(`已创建「${label}」节点（已连源视频，可直接处理）`, { duration: 1800 });
  };
  const VIDEO_QUICK: { type: NodeType; label: string; Icon: typeof Film }[] = [
    { type: "clip", label: "剪辑", Icon: Film },
    { type: "subtitle", label: "字幕", Icon: Captions },
    { type: "smart_cut", label: "智能剪辑", Icon: Wand2 },
    { type: "merge", label: "合并", Icon: Combine },
  ];

  // ── LibTV 化 1.3：视频一键操作（音频分离 / 高清放大）────────────────────────────
  // 音频分离：本地 ffmpeg 提取整条音轨 → 产物落新建 audio 节点（可直接连回合并/剪辑）。
  // 高清放大：新建 video_task 预设 kie_topaz_upscale（需源视频的云端超分模型），连线即读上游视频。
  const extractAudioMut = trpc.clip.extractAudio.useMutation();
  const [audioSepBusy, setAudioSepBusy] = useState(false);
  const handleExtractAudio = async () => {
    if (audioSepBusy || !resultVideoUrl) return;
    setAudioSepBusy(true);
    const tid = toast.loading("音频分离中（提取音轨为 mp3）…");
    try {
      const r = await extractAudioMut.mutateAsync({ inputUrl: resultVideoUrl, ...(projectId ? { projectId } : {}), nodeId: id });
      const st = useCanvasStore.getState();
      const self = st.nodes.find((n) => n.id === id);
      if (!self) return;
      const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
      const node = st.addNode("audio", { x: self.position.x + w + 60, y: self.position.y });
      st.updateNodeTitle(node.id, "分离音轨");
      st.updateNodeData(node.id, { audioCategory: "upload", source: "upload", name: "分离音轨.mp3", url: r.url, mimeType: "audio/mpeg", ...(r.duration ? { duration: r.duration } : {}) });
      useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node.id })) }));
      toast.success("已分离音轨（新音频节点，可连回合并/剪辑）", { id: tid });
    } catch (e) {
      toast.error("音频分离失败：" + (e instanceof Error ? e.message : String(e)), { id: tid });
    } finally { setAudioSepBusy(false); }
  };
  // #245 链式下一镜（转场自然衔接批2）：抽本镜尾帧 → 尾帧图 asset 节点 + 新视频节点
  // （继承本节点模型）并连好线——下一镜以尾帧为首帧参考，生成层面保证画面连续。
  // 纯手动一键、无自动行为；尾帧同时入素材库（recordEditedAsset），可复用。
  const tailFrameMut = trpc.clip.extractTailFrame.useMutation();
  const [chainBusy, setChainBusy] = useState(false);
  const handleChainNextShot = async () => {
    if (chainBusy || !resultVideoUrl) return;
    setChainBusy(true);
    const tid = toast.loading("抽取尾帧中（作下一镜首帧参考）…");
    try {
      const r = await tailFrameMut.mutateAsync({ inputUrl: resultVideoUrl, ...(projectId ? { projectId } : {}), nodeId: id });
      const st = useCanvasStore.getState();
      const self = st.nodes.find((n) => n.id === id);
      if (!self) return;
      const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
      const imgNode = st.addNode("asset", { x: self.position.x + w + 60, y: self.position.y });
      st.updateNodeTitle(imgNode.id, "尾帧（链式首帧）");
      st.updateNodeData(imgNode.id, { name: "尾帧.jpg", type: "image", url: r.url, mimeType: "image/jpeg" });
      const vidNode = st.addNode("video_task", { x: self.position.x + w + 360, y: self.position.y });
      st.updateNodeTitle(vidNode.id, "下一镜（链式衔接）");
      // #248 用户设置永远第一位：下一镜始终继承用户在本镜选的模型，绝不擅自替换。
      // 模型不吃参考图时只做透明警告 + 建议（videoRefCaps 单一事实源），换不换由用户决定。
      const prov = (self.data.payload as VideoTaskNodeData).provider;
      const provEatsImage = prov ? maxRefImagesForProvider(prov) > 0 : true;
      if (prov) st.updateNodeData(vidNode.id, { provider: prov });
      st.onConnect({ source: imgNode.id, sourceHandle: "output", target: vidNode.id, targetHandle: "input" });
      useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === vidNode.id })) }));
      if (prov && !provEatsImage) {
        toast.warning(`已创建下一镜（沿用您选的模型 ${prov}）。注意：该模型不吃参考图（纯文生），尾帧首帧参考不会生效——建议在新节点上换一个支持首帧图的模型（模型下拉有「🚫图」标注可辨）`, { id: tid, duration: 8000 });
      } else {
        toast.success("已创建下一镜：尾帧已连作首帧参考，填提示词点运行即可无缝衔接", { id: tid, duration: 5000 });
      }
    } catch (e) {
      toast.error("链式下一镜失败：" + (e instanceof Error ? e.message : String(e)), { id: tid });
    } finally { setChainBusy(false); }
  };
  const spawnVideoUpscale = () => {
    if (!resultVideoUrl) return;
    const st = useCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    if (!self) return;
    const w = (self.style?.width as number | undefined) ?? config.defaultWidth ?? 320;
    let node;
    try { node = st.addNode("video_task", { x: self.position.x + w + 60, y: self.position.y }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "创建失败"); return; }
    st.updateNodeTitle(node.id, "视频高清放大");
    st.updateNodeData(node.id, { provider: "kie_topaz_upscale", prompt: "" });
    st.onConnect({ source: id, sourceHandle: "output", target: node.id, targetHandle: "input" });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === node!.id })) }));
    toast.success("已创建「视频高清放大」节点（Topaz 超分，已连源视频，点运行生成）", { duration: 2200 });
  };
  // A previewable node that has a result and is NOT being edited (not selected,
  // not pinned) renders collapsed: only the title bar + warning/error/progress +
  // the hero preview. In that state drop the min-height floor so the node shrinks
  // to fit the preview's natural aspect ratio instead of leaving empty space.
  const isCollapsedPreview = hasHero && !expandSelected;

  // The studio skin collapses/expands the node body (height changes a lot) and floats
  // the params panel on select. Handles are positioned by percentage (top/left %，各节点不一),
  // so when the node height changes, their real positions move — but React Flow caches
  // each handle's offset (handleBounds) at measure time. Without a re-measure those
  // bounds go stale and the handles become un-connectable / edges attach at the wrong
  // spot. Force React Flow to re-read handle positions whenever the layout state flips.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isStudio, studioFloated, isCollapsedPreview, expandSelected, storeSelected, pinned, hasHero, updateNodeInternals]);

  // Whole-node height cap (e.g. Agent's long output): clamp the node to 3× its
  // width and let the node's own internal scroll area absorb the overflow. A
  // manual resize (which writes style.height) lifts the cap so the user can
  // temporarily enlarge it.
  const nodeStyleWidth = useCanvasStore((s) => {
    const w = s.nodes.find((n) => n.id === id)?.style?.width;
    return typeof w === "number" ? w : null;
  });
  const nodeStyleHeight = useCanvasStore((s) => {
    const h = s.nodes.find((n) => n.id === id)?.style?.height;
    return typeof h === "number" ? h : null;
  });
  const manuallyResized = nodeStyleHeight != null && nodeStyleHeight > 0;
  const cappedMaxHeight = capNodeHeight && !manuallyResized
    ? Math.round((nodeStyleWidth ?? config.defaultWidth) * 3)
    : undefined;

  // 创意/工作室皮肤把卡片 minWidth 抬到 1.25×（见下方 style.minWidth），但节点 React Flow 宽度仍是
  // 建节点时写入的 style.width(=config.defaultWidth)。当后者更小时，卡片 width:100%+min-width 会向右
  // 单侧溢出节点框——而 handle、就地输入条(InlineGenBar/NodeToolbar) 都锚定在「节点框中线」，于是与更宽
  // 的可见卡片中线错开（真机实测音频节点：节点框 300、卡片 350，卡片中心右偏 (350-300)/2=25 流单位，
  // ×缩放≈111px，用户报的「两个框中线没对齐」正是此因，与缩放无关）。把溢出量对半用负 margin 左移，
  // 令卡片重新居中在节点框上 → handle / 输入条 / 卡片三者中线一致。仅在「显式设了 style.width 且小于
  // 抬高后的 min」时触发（未设 width 时 RF 按卡片内容自适应节点框，本就无溢出），因此只作用于真正溢出的
  // 节点（实测仅音频 defaultWidth 300 < 350），其它节点 shift=0、零影响。
  const creativeMinW = Math.round(minWidth * 1.25);
  const cardOverflowShift = (isCreative || isStudio) && nodeStyleWidth != null && nodeStyleWidth < creativeMinW
    ? (creativeMinW - nodeStyleWidth) / 2
    : 0;

  // Workflow run status
  const { running, currentNodeId, completedIds, failedIds } = useWorkflowRunState();
  const runStatus: "running" | "done" | "failed" | null = (() => {
    if (running && currentNodeId === id) return "running";
    if (completedIds.includes(id)) return "done";
    if (failedIds.includes(id)) return "failed";
    return null;
  })();

  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleCancelingRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  // 标题栏操作按钮（编辑名称/复制/删除）：单击节点后显示，3 秒后自动隐藏。
  const [clickShowActions, setClickShowActions] = useState(false);
  const hideActionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armHideActions = () => {
    if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current);
    hideActionsTimer.current = setTimeout(() => setClickShowActions(false), 3000);
  };
  const revealActions = () => { setClickShowActions(true); armHideActions(); };
  useEffect(() => () => { if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current); }, []);

  // 标题栏悬停进/出 → 透传给 useNodeDocks（由其做 1 秒延时展开 + 离开延时收起）。
  const onHeaderEnter = () => onHeaderHoverChange?.(true);
  const onHeaderLeave = () => onHeaderHoverChange?.(false);

  const [assetDragOver, setAssetDragOver] = useState(false);
  // Studio: double-click the floating param panel to expand it from the compact
  // command bar into the FULL node body (every param). Single source of truth —
  // expanding just renders the same `children` the pro node uses, no duplication.
  // ★4：展开全部参数偏好全局记忆（展开一次后续选中默认沿用），替代原来每次重选强制 compact。
  const [studioExpanded, setStudioExpanded] = useStudioExpandAll();
  // For non-command-bar nodes the compact view is the pro body capped to a short
  // height; only show the fade + 展开 affordance when it actually overflows.
  const compactBodyRef = useRef<HTMLDivElement>(null);
  const [bodyOverflows, setBodyOverflows] = useState(false);
  // ★2 命令栏浮层：视口下方空间不足时向上翻转（否则底部节点的命令栏被推出屏幕）。
  const rootRef = useRef<HTMLDivElement>(null);
  const [flipCmdBar, setFlipCmdBar] = useState(false);
  useEffect(() => {
    if (!studioFloated) { setFlipCmdBar(false); return; }
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const need = (studioExpanded ? 540 : 360) + 24;   // 估计浮层高度 + 间距
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      setFlipCmdBar(spaceBelow < need && spaceAbove > spaceBelow);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioFloated, studioExpanded]);

  const handleTitleSave = useCallback(() => {
    if (titleCancelingRef.current) { titleCancelingRef.current = false; return; }
    updateNodeTitle(id, titleValue || title);
    setEditingTitle(false);
  }, [id, titleValue, title, updateNodeTitle]);

  const cancelTitleEdit = useCallback(() => {
    titleCancelingRef.current = true;
    setTitleValue(title);
    setEditingTitle(false);
  }, [title]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") cancelTitleEdit();
  }, [handleTitleSave, cancelTitleEdit]);

  // Sync title when prop changes (guard: don't overwrite in-progress edits)
  useEffect(() => { if (!editingTitle) setTitleValue(title); }, [title, editingTitle]);

  // Entry animation
  const [entered, setEntered] = useState(false);
  const [errExpanded, setErrExpanded] = useState(false); // #R4-6 失败横幅点击展开完整错误
  // #315 结果找回：失败消息含 RECOVERABLE 标记（任务已提交但等待超时）时，红条上给
  // 「重新检测」按钮——免费单查平台任务状态，完成即取回结果写回节点（不重新扣费）。
  const recoverable = genError ? parseRecoverableTask(genError) : null;
  const genErrorShown = genError ? stripRecoverableMarker(genError) : null;
  const recheckMut = trpc.imageGen.recheck.useMutation();
  const onRecheck = async () => {
    if (!recoverable || recheckMut.isPending) return;
    try {
      const r = await recheckMut.mutateAsync({ provider: recoverable.provider, taskId: recoverable.taskId });
      if (r.done && r.url) {
        // 按节点类型写回产物字段（角色/场景=参考图；分镜/图像=imageUrl），并清失败态。
        const field = nodeType === "character" ? "referenceImageUrl" : "imageUrl";
        const patch: Record<string, unknown> = { [field]: r.url, status: undefined, errorMessage: undefined };
        if (nodeType === "character") patch.referenceStorageKey = undefined;
        useCanvasStore.getState().updateNodeData(id, patch, true);
        toast.success("已找回平台侧生成结果（未重新扣费）");
      } else if (r.status === "failed") {
        toast.error("平台侧任务最终失败：" + (r.error ?? "未知原因"));
      } else {
        toast.info(`平台侧仍在生成中（状态：${r.status}）——稍后再点一次「重新检测」`);
      }
    } catch (e) {
      toast.error("重新检测失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };
  useEffect(() => { const t = setTimeout(() => setEntered(true), 20); return () => clearTimeout(t); }, []);

  // 仅在"单击节点后 3 秒内"显示标题栏操作按钮；编辑名称进行中保持显示。
  const showActions = clickShowActions || editingTitle;

  // Connection handles — shared subtle-at-rest / filled-on-hover styling (see
  // lib/handleStyle). Target = square (receives), source = circle (sends).
  // During a connection drag, `connectState` highlights the handle that could
  // complete it (per the connection matrix) and dims the rest.
  const handleActive = isHovered || !!selected;
  const connectState = useConnectState(id, nodeType);
  const targetHandle = handleStyle(config.color, handleActive, "square", connectState.target);
  const sourceHandle = handleStyle(config.color, handleActive, "circle", connectState.source);

  // Derive border & shadow from runStatus
  const runBorder = runStatus === "running"
    ? `1.5px solid oklch(0.72 0.22 142 / 0.9)`
    : runStatus === "done"
      ? `1.5px solid oklch(0.72 0.18 155 / 0.8)`
      : runStatus === "failed"
        ? `1.5px solid oklch(0.62 0.22 25 / 0.8)`
        : null;

  const runShadow = runStatus === "running"
    ? `0 0 0 3px oklch(0.72 0.22 142 / 0.22), 0 0 20px oklch(0.72 0.22 142 / 0.20)`
    : runStatus === "done"
      ? `0 0 0 3px oklch(0.72 0.18 155 / 0.18)`
      : runStatus === "failed"
        ? `0 0 0 3px oklch(0.62 0.22 25 / 0.18)`
        : null;

  // Selection outline reads the STORE's real selected state (selVis), not the
  // `selected` prop — that prop is forced false during multi/box-select, but every
  // selected node should still show its highlight. Made a clearly-visible solid
  // accent ring (the old 0x14≈8% glow was effectively invisible).
  const selVis = storeSelected;
  const borderStyle = runBorder
    ? runBorder
    : borderTint
      ? selVis
        ? `2px solid ${borderTint}`
        : `1px solid ${borderTint}99`
      : isCreative
        // LibTV：选中态用「极细」高亮边（1px），常态低透明白细边——发光框不喧宾夺主。
        ? selVis
          ? `1px solid var(--ui-accent, ${config.color})`
          : `1px solid var(--c-bd2)`
        : selVis
          ? `2px solid ${config.color}`
          : isHovered
            ? `1px solid var(--c-bd3)`
            : `1px solid var(--c-bd1)`;

  // NOTE: config.color is an oklch() string, so it must NOT be suffixed with a hex
  // alpha (the old `${config.color}14` produced `oklch(...)14` → invalid CSS → the
  // whole box-shadow was dropped to `none`, which is why selection looked unhighlighted).
  // Use the solid colour for the ring and color-mix() for the soft glow.
  const shadowStyle = runShadow
    ? `${runShadow}, var(--c-node-shadow-run)`
    : selVis
      // 创意(LibTV)：极细 1px 高亮环 + 基础投影，去掉抢眼的 2.5px 实环 + 9px 大光晕。
      ? isCreative
        ? `0 0 0 1px color-mix(in oklch, ${config.color} 55%, transparent), var(--c-node-shadow-selected)`
        : `0 0 0 2.5px ${config.color}, 0 0 0 9px color-mix(in oklch, ${config.color} 22%, transparent), var(--c-node-shadow-selected)`
      : isHovered
        ? `var(--c-node-shadow-hover)`
        : `var(--c-node-shadow-rest)`;

  return (
    <div
      ref={rootRef}
      className={`group/node relative${runStatus === "running" ? " node-run-pulse" : ""}`}
      role="group"
      aria-label={`${title || config?.label || nodeType} 节点${config?.label && title ? `（${config.label}）` : ""}${runStatus === "running" ? " · 生成中" : genError ? " · 失败" : ""}`}
      data-selected={(storeSelected || pinned) ? "true" : "false"}
      data-has-hero={hasHero ? "true" : "false"}
      /* #229 供 CSS 按节点类型定制 hero 布局（角色卡弹性填充等），零 JS 开销 */
      data-node-type={nodeType}
      /* #102/#103 极简显示（Alt+Q）：只有「有真实媒体结果」的节点才极简化——
         data-has-hero 不可靠（提示词等节点无结果也传占位 heroMedia）。 */
      data-has-result={(resultVideoUrl || resultImageUrl) ? "true" : "false"}
      /* #102 极简显示（Alt+Q）悬停浮现标题：CSS ::after 通过 attr() 读取，无 JS 开销 */
      data-node-title={(title || config?.label || "").slice(0, 40)}
      style={{
        // var() with the exact current literal as fallback → "pro" (no --ui-radius-node)
        // is byte-identical; "studio" skin overrides it for softer cards.
        borderRadius: "var(--ui-radius-node, 16px)",
        background: "var(--c-node-bg)",
        border: borderStyle,
        boxShadow: shadowStyle,
        minWidth: (isCreative || isStudio) ? Math.round(minWidth * 1.25) : minWidth,
        // Studio floating nodes have no inline body, so drop the min-height floor too —
        // selected → floating panel below; deselected → a compact title(+hero) card.
        // 创意皮肤同理：has-hero 节点的结果预览走顶部英雄区、控件走底部输入条，选中后 body
        // 里的预览被隐藏(HideWhenStudioFloating/各节点创意分支)、参数默认收起——若仍套 minHeight
        // 就会在英雄区下方空出一块灰区（用户反馈「分镜底部灰一块」）。故创意+has-hero 也 drop。
        minHeight: (isCollapsedPreview || studioFloated || (!isStudio && isCreative && hasHero)) ? 0 : minHeight,
        width: "100%",
        // 见上方 cardOverflowShift 注释：把创意皮肤下卡片 min-width 溢出量对半左移，使卡片居中在节点框、
        // 与 handle/就地输入条中线对齐（负 margin 仅视觉左移卡片，不影响 RF 的节点框/handle 定位）。
        marginLeft: cardOverflowShift ? -cardOverflowShift : undefined,
        height: "100%",
        transition: "border-color 150ms ease, box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease",
        backdropFilter: isLight ? "none" : "blur(4px)",
        opacity: entered ? 1 : 0,
        transform: entered ? "scale(1) translateY(0)" : "scale(0.96) translateY(6px)",
        // overflow is intentionally NOT set here so handle ::before hit-area expansions
        // can extend beyond the node edge without being clipped
      }}
      onMouseEnter={() => { setIsHovered(true); useHoverStore.getState().setHovered(id); }}
      onMouseLeave={() => { setIsHovered(false); if (useHoverStore.getState().nodeId === id) useHoverStore.getState().setHovered(null); }}
      onClick={() => revealActions()}
      onTouchStart={(e) => {
        // ◆9 触屏长按 500ms → 派发事件让 Canvas 打开节点右键菜单(触屏无原生右键)。
        const t = e.touches[0]; if (!t) return;
        const sx = t.clientX, sy = t.clientY;
        longPressStartRef.current = { x: sx, y: sy };
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("avc:node-longpress", { detail: { nodeId: id, x: sx, y: sy } }));
        }, 500);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0], s = longPressStartRef.current;
        if (t && s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 12) window.clearTimeout(longPressTimerRef.current);
      }}
      onTouchEnd={() => window.clearTimeout(longPressTimerRef.current)}
      onTouchCancel={() => window.clearTimeout(longPressTimerRef.current)}
      onDragOver={onAssetImageDrop ? (e) => {
        if (!e.dataTransfer.types.includes("application/x-asset-list")) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!assetDragOver) setAssetDragOver(true);
      } : undefined}
      onDragLeave={onAssetImageDrop ? (e) => { if (e.currentTarget === e.target) setAssetDragOver(false); } : undefined}
      onDrop={onAssetImageDrop ? (e) => {
        const urls = imageUrlsFromAssetDrag(e.dataTransfer);
        setAssetDragOver(false);
        if (urls.length === 0) return;
        e.preventDefault(); e.stopPropagation(); // consume → 画布不再新建素材节点
        onAssetImageDrop(urls);
      } : undefined}
    >
      {/* Studio skin: a floating contextual toolbar above the selected node
          (LibLib-style). Additive & studio-only — pro never renders it. Reuses
          the EXACT existing handlers (same onRun reference the title-bar run uses,
          and the self-contained duplicateNode store action), so it cannot diverge
          from or break existing behavior. */}
      {/* LibTV 化：工具条开放到所有皮肤（原仅 studio）——选中即浮出快捷 AI 操作。
          框选/多选（≥2 选中）时不再逐个弹出单节点操作条，避免画布被一排排工具条淹没；
          此时只保留框选级的对齐条 + 多选操作条（全模式统一）。 */}
      {(storeSelected || pinned) && !multiSelected && (onRun || resultVideoUrl || resultImageUrl) && (() => {
        // LibTV 化 2.x：创意模式的工具条迁入 NodeToolbar——屏幕恒定（画布缩放时节点内容
        // 缩放、工具条保持固定屏幕尺寸），与就地生成输入条同一交互范式；studio/pro 保持
        // 原有「节点内绝对定位、随节点缩放」的行为不变（与下方随缩放的参数面板一致）。
        const creativeConstant = !isStudio && isCreative;
        const bar = (
        <div
          className="nodrag flex items-center gap-1"
          style={{
            ...(creativeConstant ? {} : {
              position: "absolute" as const,
              bottom: "calc(100% + 10px)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 21,
            }),
            whiteSpace: "nowrap",
            background: "var(--c-elevated)",
            border: "1px solid var(--c-bd2)",
            borderRadius: 11,
            padding: "5px 7px",
            boxShadow: "var(--c-node-shadow-hover)",
          }}
        >
            {onRun && (nodeRunning && onCancelGenerate ? (
              // #143 生成中标题栏按钮不再是「禁用的转圈」——直接变成可点的「放弃等待/取消」
              //（用户实报：生成中点重新生成无效、找不到取消入口）。
              <button
                onClick={(e) => { e.stopPropagation(); onCancelGenerate(); }}
                title="放弃等待 / 取消生成"
                className="studio-toolbtn flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: "oklch(0.62 0.20 25 / 0.16)", color: "oklch(0.62 0.20 25)", border: "none", cursor: "pointer" }}
              >
                <X size={13} />
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); if (canRun && !nodeRunning) triggerRun(); }}
                disabled={!canRun || nodeRunning}
                title={nodeRunning ? "生成中…" : (hasResult ? "重新生成" : "运行")}
                className="studio-toolbtn flex items-center justify-center w-7 h-7 rounded-lg"
                style={{
                  background: !canRun || nodeRunning ? "var(--c-surface)" : `${config.color}22`,
                  color: !canRun || nodeRunning ? "var(--c-t4)" : config.color,
                  border: "none",
                  cursor: !canRun || nodeRunning ? "not-allowed" : "pointer",
                }}
              >
                {nodeRunning ? <Loader2 size={13} className="animate-spin" /> : (hasResult ? <RefreshCw size={13} /> : <Play size={13} />)}
              </button>
            ))}
            {/* download — the one genuinely non-duplicate top-toolbar action (the title
                bar has no download). Gated by downloadMedia's authorization gate; the
                server still enforces. Only shown when the node has a result media URL. */}
            {(resultVideoUrl || resultImageUrl) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (resultVideoUrl) void downloadMedia(resultVideoUrl, `${title || "video"}.mp4`, "video");
                  else void downloadMedia(resultImageUrl, `${title || "image"}.png`, "image");
                }}
                title="下载结果"
                className="studio-toolbtn flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer" }}
              >
                <Download size={13} />
              </button>
            )}
            {/* LibTV 化：「快速剪辑」——底部弹出时间轴选区剪辑条。#103 放开到所有有视频
                结果的节点：video_task 仍走 canvas:quick-trim 事件（其批量多结果的当前选中
                由节点自己解析）；其余类型由 BaseNode 统一渲染 QuickTrimBar 并按类型写回。 */}
            {resultVideoUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (nodeType === "video_task") window.dispatchEvent(new CustomEvent("canvas:quick-trim", { detail: { nodeId: id } }));
                  else setQuickTrimOpen(true);
                }}
                title="快剪（时间轴选区截取 · I/O 出入点 · Enter 确认；与「剪辑」节点区分）"
                className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                <Scissors size={12} /> 快剪
              </button>
            )}
            {/* 就地版本对比入口：有图或视频结果即可（compare 节点自身除外），不建节点 */}
            {(resultImageUrl || resultVideoUrl) && nodeType !== "compare" && (
              <button
                onClick={(e) => { e.stopPropagation(); openSelfCompare(resultVideoUrl || resultImageUrl!); }}
                title="对比：全屏滑块对比本节点当前结果与上一版本/其它批量结果（视频同步播放），不建节点"
                className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                <Columns2 size={12} /> 对比
              </button>
            )}
            {/* Liblib-style quick AI-edit actions — only for nodes with an image result.
                Each spawns a connected image_edit node preset to that operation. */}
            {resultImageUrl && nodeType !== "image_edit" && (
              <>
                <div style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 1px" }} />
                {QUICK_EDITS.map(({ op, label, Icon }) => (
                  <button key={op}
                    onClick={(e) => { e.stopPropagation(); spawnImageEdit(op, label); }}
                    title={`${label}（生成连好源图的图像编辑节点）`}
                    className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                    style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
                {/* 3D：伪3D 换视角 / 真3D 建模——上浮到工具条（原入口在节点 hero 悬停层，
                    收起/选中态看不见）。仅对自带 3D 查看器的三类节点显示；通过 panelRequest
                    跨组件信号让节点自身打开查看器（源图选取与截图回灌逻辑都在节点内部）。 */}
                {(nodeType === "image_gen" || nodeType === "storyboard" || nodeType === "comfyui_workflow") && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); useCanvasStore.getState().requestPanel(id, "pseudo3d"); }}
                      title="3D 换视角（深度位移伪 3D，拖拽换视角后截图重绘）"
                      className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                      style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      <Rotate3d size={12} /> 3D
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); useCanvasStore.getState().requestPanel(id, "true3d"); }}
                      title="真 3D 建模（Tripo3D 图生网格，完整 360° 环绕后从新视角重绘）"
                      className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                      style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      <Boxes size={12} /> 真3D
                    </button>
                  </>
                )}
                {/* #72 多角度：LibTV 式全功能编辑器（预设/球面机位/滑杆/提示词/积分），
                    结果写回本节点并入版本历史；九宫格多机位保留在工具箱菜单里 */}
                <button
                  onClick={(e) => { e.stopPropagation(); setAngleEditorOpen(true); }}
                  title="多角度（球面机位控件 + 预设视角 + 景别，换机位重拍本图，结果入版本历史）"
                  className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                  style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  <Rotate3d size={12} /> 多角度
                </button>
                {/* #72 打光：LibTV 式全功能编辑器（光源球面/六方位/亮度颜色/轮廓光/智能模式/8款预设） */}
                <button
                  onClick={(e) => { e.stopPropagation(); setRelightEditorOpen(true); }}
                  title="打光效果（光源球面控件 + 全局亮度/颜色 + 轮廓光 + 智能模式 + 8 款预设，结果入版本历史）"
                  className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                  style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  <Sun size={12} /> 打光
                </button>
                {/* 阶段四 4.1 工具箱：模板化操作套件（全部复用 宫格生成→切分 / 单图外推 管线） */}
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setToolkitOpen((v) => !v); setGridMenuOpen(false); }}
                    disabled={gridBusy}
                    title="工具箱（连贯分镜 / 剧情推演 / 画面推演±5s / 三视图 / 表情表——以本图为参考一键生成）"
                    className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                    style={{ background: toolkitOpen ? "var(--c-elevated)" : "var(--c-surface)", color: gridBusy ? "var(--c-t4)" : "var(--c-t1)", border: "none", cursor: gridBusy ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                  >
                    <Wand2 size={12} /> 工具箱 <ChevronDown size={10} />
                  </button>
                  {toolkitOpen && (
                    <div className="nodrag" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 9, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 10px 30px rgba(0,0,0,0.4)", minWidth: 168 }}>
                      {([
                        { label: "多机位九宫格", desc: "9 个机位角度一次出齐", run: () => handleMultiAngle() },
                        { label: "连贯分镜 25 格", desc: "5×5 逐拍推进整场戏", run: () => runGridSheet("grid25", "the exact same subject and scene shown in the reference image, telling the scene beat by beat", "连贯分镜", "个连续镜头") },
                        { label: "剧情推演 4 格", desc: "2×2 剧情如何发展", run: () => runGridSheet("plot4", "the exact same subject and scene shown in the reference image, showing how the story develops from this moment", "剧情推演", "个剧情节拍") },
                        { label: "画面推演 +5 秒", desc: "这一幕之后的画面", run: () => handleTemporalShift(5) },
                        { label: "画面回溯 −5 秒", desc: "这一幕之前的画面", run: () => handleTemporalShift(-5) },
                        { label: "角色三视图", desc: "正/侧/背设定图", run: () => runGridSheet("turnaround", "the exact same character shown in the reference image", "三视图", "张视图") },
                        { label: "表情九宫格", desc: "同一角色 9 种表情", run: () => runGridSheet("expressions", "the exact same character shown in the reference image", "表情表", "种表情") },
                      ] as const).map((it) => (
                        <button key={it.label} onClick={(e) => { e.stopPropagation(); void it.run(); }}
                          className="studio-toolbtn rounded-md"
                          style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "5px 9px", background: "var(--c-surface)", color: "var(--c-t1)", border: "1px solid var(--c-bd1)", cursor: "pointer", textAlign: "left" }}>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>{it.label}</span>
                          <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{it.desc}</span>
                        </button>
                      ))}
                      {/* #73 纳管：宫格管线模型选择 + 计价（此前隐形走服务端默认模型） */}
                      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 5, borderTop: "1px solid var(--c-bd1)", marginTop: 3 }}>
                        <span style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "0 2px" }}>生成模型（上列全部操作生效）</span>
                        <ModelPicker value={toolkitModel} onChange={pickToolkitModel} options={toolkitOptionsResolved} minWidth={156} />
                        <ComfyCkptSelect enabled={toolkitModel === COMFY_LOCAL_MODEL} width={156} />
                        <span style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "0 2px" }} title="预计消耗（宫格为单张大图计一次生成）">预计：{toolkitCost}</span>
                      </div>
                    </div>
                  )}
                </span>
                {/* 宫格切分：把本图按 N×N 切成子图（LibTV 同款 4/9/16/25 档） */}
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setGridMenuOpen((v) => !v); setToolkitOpen(false); }}
                    disabled={gridBusy}
                    title="宫格切分（把宫格图切成多张子图，产物落入新节点）"
                    className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                    style={{ background: gridMenuOpen ? "var(--c-elevated)" : "var(--c-surface)", color: gridBusy ? "var(--c-t4)" : "var(--c-t1)", border: "none", cursor: gridBusy ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                  >
                    <Grid3X3 size={12} /> 宫格切分 <ChevronDown size={10} />
                  </button>
                  {gridMenuOpen && (
                    <div className="nodrag" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 9, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
                      {/* 行×列 网格：含 1×2/2×1/1×3/3×1/2×3/3×2 等非方形排列（用户实际素材常见混排/条带） */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
                        {([[2, 2], [3, 3], [4, 4], [1, 2], [2, 1], [1, 3], [3, 1], [2, 3], [3, 2], [2, 4], [4, 2], [5, 5]] as const).map(([r, c]) => (
                          <button key={`${r}x${c}`} onClick={(e) => { e.stopPropagation(); void handleGridSlice(r, c); }}
                            className="studio-toolbtn rounded-md"
                            style={{ padding: "4px 8px", fontSize: 11, whiteSpace: "nowrap", background: "var(--c-surface)", color: "var(--c-t1)", border: "1px solid var(--c-bd1)", cursor: "pointer", textAlign: "center" }}>
                            {r}×{c}
                          </button>
                        ))}
                      </div>
                      {/* 自定义 行×列（1-8）——后端 slice 本就支持任意行列 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 4, borderTop: "1px solid var(--c-bd1)", marginTop: 3 }}>
                        <span style={{ fontSize: 10, color: "var(--c-t4)" }}>自定义</span>
                        <input type="number" min={1} max={8} defaultValue={2} id={`grid-r-${id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 36, fontSize: 11, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                        <span style={{ fontSize: 10, color: "var(--c-t4)" }}>行 ×</span>
                        <input type="number" min={1} max={8} defaultValue={3} id={`grid-c-${id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 36, fontSize: 11, padding: "2px 4px", borderRadius: 5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                        <span style={{ fontSize: 10, color: "var(--c-t4)" }}>列</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = Math.max(1, Math.min(8, Number((document.getElementById(`grid-r-${id}`) as HTMLInputElement)?.value || 2)));
                            const c = Math.max(1, Math.min(8, Number((document.getElementById(`grid-c-${id}`) as HTMLInputElement)?.value || 3)));
                            if (r * c < 2) { toast.info("行×列至少要 2 格"); return; }
                            void handleGridSlice(r, c);
                          }}
                          className="studio-toolbtn rounded-md"
                          style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11, background: "var(--c-surface)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", cursor: "pointer", fontWeight: 600 }}>
                          切分
                        </button>
                      </div>
                    </div>
                  )}
                </span>
              </>
            )}
            {/* Liblib-style 图生视频 — image-result nodes that can wire into a video task.
                One click spawns a connected video_task using this image as the i2v first frame. */}
            {resultImageUrl && getCompatibleTargets(nodeType).includes("video_task") && (
              <>
                <div style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 1px" }} />
                <button
                  onClick={(e) => { e.stopPropagation(); spawnVideoFromImage(); }}
                  title="图生视频（用本图作首帧，生成连好源图的视频任务节点）"
                  className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                  style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  <Video size={12} /> 生成视频
                </button>
              </>
            )}
            {/* Liblib-style quick VIDEO actions — only for nodes with a video result.
                Each spawns a connected downstream video node (剪辑/字幕/智能剪辑/合并);
                filtered by the connection matrix so every shown action is a valid wire. */}
            {resultVideoUrl && (() => {
              const targets = getCompatibleTargets(nodeType);
              const acts = VIDEO_QUICK.filter((a) => targets.includes(a.type));
              if (acts.length === 0) return null;
              return (
                <>
                  <div style={{ width: 1, height: 16, background: "var(--c-bd2)", margin: "0 1px" }} />
                  {acts.map(({ type, label, Icon }) => (
                    <button key={type}
                      onClick={(e) => { e.stopPropagation(); spawnDownstream(type, label); }}
                      title={`${label}（生成连好源视频的下游节点）`}
                      className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                      style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                  {/* LibTV 化 1.3：音频分离（本地 ffmpeg 抽音轨 → 新音频节点） */}
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleExtractAudio(); }}
                    disabled={audioSepBusy}
                    title="音频分离（提取整条音轨为 mp3，落入新音频节点）"
                    className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                    style={{ background: "var(--c-surface)", color: audioSepBusy ? "var(--c-t4)" : "var(--c-t1)", border: "none", cursor: audioSepBusy ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                  >
                    {audioSepBusy ? <Loader2 size={12} className="animate-spin" /> : <Music2 size={12} />} 音频分离
                  </button>
                  {/* LibTV 化 1.3：视频高清放大（Topaz 云端超分 video_task 预设） */}
                  {getCompatibleTargets(nodeType).includes("video_task") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); spawnVideoUpscale(); }}
                      title="高清放大（Topaz 视频超分，生成连好源视频的任务节点）"
                      className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                      style={{ background: "var(--c-surface)", color: "var(--c-t1)", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      <Sparkles size={12} /> 高清放大
                    </button>
                  )}
                  {/* #245 链式下一镜：尾帧→下一镜首帧参考（转场自然衔接批2） */}
                  {getCompatibleTargets(nodeType).includes("video_task") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleChainNextShot(); }}
                      disabled={chainBusy}
                      title="链式下一镜（抽本镜尾帧作下一镜首帧参考，画面无缝衔接）"
                      className="studio-toolbtn flex items-center gap-1 h-7 px-2 rounded-lg"
                      style={{ background: "var(--c-surface)", color: chainBusy ? "var(--c-t4)" : "var(--c-t1)", border: "none", cursor: chainBusy ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      {chainBusy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} 链式下一镜
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        );
        return creativeConstant
          ? <NodeToolbar isVisible position={Position.Top} offset={10}>{bar}</NodeToolbar>
          : bar;
      })()}

      {/* Studio: hover quick actions — re-run (+ download when there's a result) without
          selecting/expanding the node. Reuses the exact onRun the toolbar uses; visibility
          is pure CSS (node hover, non-selected). */}
      {isStudio && onRun && (
        <div className="studio-quickrun nodrag" style={{ position: "absolute", bottom: 8, right: 8, zIndex: 7, display: "flex", gap: 6 }}>
          {(resultVideoUrl || resultImageUrl) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (resultVideoUrl) void downloadMedia(resultVideoUrl, `${title || "video"}.mp4`, "video");
                else void downloadMedia(resultImageUrl, `${title || "image"}.png`, "image");
              }}
              title="下载结果"
              style={{ width: 30, height: 30, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--c-surface)", color: "var(--c-t1)", cursor: "pointer", boxShadow: "0 3px 12px oklch(0 0 0 / 0.4)" }}
            ><Download size={14} /></button>
          )}
          {nodeRunning && onCancelGenerate ? (
            // #143 生成中 = 可点的「放弃等待/取消」（红），不再是禁用的转圈。
            <button
              onClick={(e) => { e.stopPropagation(); onCancelGenerate(); }}
              title="放弃等待 / 取消生成"
              style={{ width: 30, height: 30, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: "oklch(0.62 0.20 25 / 0.9)", color: "#fff", cursor: "pointer", boxShadow: "0 3px 12px oklch(0 0 0 / 0.4)" }}
            >
              <X size={14} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); if (canRun && !nodeRunning) triggerRun(); }}
              disabled={!canRun || nodeRunning}
              title={nodeRunning ? "生成中…" : (hasResult ? "重新生成" : "运行")}
              style={{ width: 30, height: 30, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: !canRun || nodeRunning ? "var(--c-surface)" : "#fff",
                color: !canRun || nodeRunning ? "var(--c-t4)" : "#111",
                cursor: !canRun || nodeRunning ? "not-allowed" : "pointer",
                boxShadow: "0 3px 12px oklch(0 0 0 / 0.4)" }}
            >
              {nodeRunning ? <Loader2 size={14} className="animate-spin" /> : (hasResult ? <RefreshCw size={14} /> : <Play size={14} />)}
            </button>
          )}
        </div>
      )}

      {/* 素材拖入高亮 */}
      {assetDragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" style={{ borderRadius: "var(--ui-radius-node, 16px)", border: `2px dashed ${config.color}`, background: `${config.color}14` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: config.color, background: "var(--c-base)", padding: "4px 10px", borderRadius: 8, border: `1px solid ${config.color}55` }}>放到此处用作参考图</span>
        </div>
      )}
      {/* Resize handles — outside overflow:hidden so corner grips aren't clipped */}
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={resizable && (selected || isHovered)}
        lineStyle={{
          borderColor: `${config.color}40`,
          borderWidth: 1,
          borderStyle: "dashed",
        }}
        handleStyle={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: config.color,
          border: `1.5px solid var(--c-canvas)`,
          boxShadow: `0 0 6px ${config.color}80`,
          opacity: 1,
        }}
      />

    {/* Inner content wrapper clips visual content to the rounded corners */}
    <div className="flex flex-col" style={{ overflow: "hidden", borderRadius: "inherit", width: "100%", height: "100%", maxHeight: cappedMaxHeight }}>

      {/* ── Color accent strip at top ── */}
      <div
        style={{
          height: (isCreative || isStudio) ? 3 : 2,
          background: `linear-gradient(90deg, transparent 0%, ${config.color}${(isCreative || isStudio) ? "90" : "70"} 30%, ${config.color}${(isCreative || isStudio) ? "bb" : "90"} 50%, ${config.color}${(isCreative || isStudio) ? "90" : "70"} 70%, transparent 100%)`,
          opacity: (isCreative || isStudio)
            ? selected ? 1 : isHovered ? 0.85 : 0.55
            : selected ? 1 : isHovered ? 0.7 : 0.35,
          transition: "opacity 180ms ease",
          flexShrink: 0,
        }}
      />

      {/* ── Header ── */}
      <div
        className={`node-header flex items-center select-none flex-shrink-0 ${isCreative ? "gap-1.5 px-2.5" : "gap-2 px-3.5 py-1.5"}`}
        onMouseEnter={onHeaderEnter}
        onMouseLeave={onHeaderLeave}
        style={{
          // LibTV 化 3.5/3.7：创意模式标题栏「标签化」——透明无边框，观感上是卡顶一行小标签
          // （小图标 + 灰名 + 灰尺寸），卡本体≈纯媒体。3.7：进一步压薄（≈22px 高、更小内边距/
          // 图标/间距），让标题栏在卡里占比更小，贴近 LibTV。按钮组由 CSS 控制悬停才浮现。
          background: isCreative
            ? "transparent"
            : `linear-gradient(180deg, ${config.color}0e 0%, transparent 100%)`,
          borderBottom: isCreative ? "none" : `1px solid ${isLight ? "var(--c-bd1)" : "oklch(0.20 0.008 260 / 0.60)"}`,
          minHeight: isCreative ? 20 : 36,
          ...(isCreative ? { paddingTop: 2, paddingBottom: 2 } : {}),
          // #133 全净卡（heroBareHeader，放末尾覆盖上面各键）：创意+有 hero 时标题栏脱离布局，
          // 改为悬停/选中才浮现的顶部渐变叠加条——角色卡以 hero 内姓名条承担身份信息，卡顶纯媒体。
          ...(heroBareHeader && isCreative && hasHero ? {
            position: "absolute" as const, top: 3, left: 0, right: 0, zIndex: 12,
            opacity: (isHovered || storeSelected || pinned || editingTitle) ? 1 : 0,
            pointerEvents: (isHovered || storeSelected || pinned || editingTitle) ? ("auto" as const) : ("none" as const),
            background: "linear-gradient(oklch(0 0 0 / 0.6), transparent)",
            transition: "opacity 160ms ease",
            paddingTop: 4, paddingBottom: 10,
          } : {}),
        }}
      >
        {/* Drag grip — 创意(LibTV)皮肤下移除：卡顶应是极简「图标+名称」小标签，
            整个标题栏本就可拖拽，grip 只增视觉噪声与占位。仅 pro/studio 保留。 */}
        {!isCreative && (
          <GripVertical
            className="w-3.5 h-3.5 flex-shrink-0 cursor-grab active:cursor-grabbing"
            style={{
              color: isHovered ? "var(--c-t4)" : "var(--c-bd3)",
              transition: "color 150ms ease",
            }}
          />
        )}

        {/* Node type icon — 创意皮肤下弱化为无框小裸图标（更接近 LibTV 的小标签观感） */}
        <div
          className="rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            width: isCreative ? 15 : 20,
            height: isCreative ? 15 : 20,
            background: isCreative ? "transparent" : `${config.color}1a`,
            border: isCreative ? "none" : `1px solid ${config.color}35`,
          }}
        >
          <Icon style={{ width: isCreative ? 13 : 14, height: isCreative ? 13 : 14, color: config.color }} />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleSave}
                className="flex-1 min-w-0 text-xs font-medium outline-none bg-transparent"
                style={{
                  color: "var(--c-t1)",
                  borderBottom: `1.5px solid ${config.color}`,
                  paddingBottom: 1,
                }}
                autoFocus
              />
              <button
                onClick={handleTitleSave}
                className="p-0.5 rounded-md transition-colors"
                style={{ color: "oklch(0.72 0.18 155)" }}
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelTitleEdit(); }}
                className="p-0.5 rounded-md transition-colors"
                style={{ color: "var(--c-t4)" }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            // Show a faint pencil icon on hover so users discover the title
            // (including the auto-generated "#N" suffix) is editable. Both
            // single-click on the pencil and double-click on the text enter
            // edit mode — single-click on the text alone still propagates to
            // React Flow's node-select behavior (preserved on purpose).
            <div className="flex items-center gap-1 min-w-0 flex-1 group/title">
              <span
                className={`text-xs truncate ui-node-title ${isCreative ? "font-medium" : "font-semibold"}`}
                style={{
                  // 创意皮肤：标题降为次级色 + 中等字重 + 略小字号，作卡顶小标签而非抢眼主标题。
                  color: isCreative ? "var(--c-t3)" : "var(--c-t1)",
                  fontSize: isCreative ? 11 : undefined,
                  cursor: "text",
                  letterSpacing: "-0.01em",
                  transition: "color 150ms ease",
                }}
                data-dblfocus-exempt="1" /* #123 标题双击=改名，豁免「双击节点聚焦」 */
                onDoubleClick={() => { setEditingTitle(true); setTitleValue(title); }}
                title={headerTooltip ? `${headerTooltip}\n\n双击编辑标题: ${title}` : `双击编辑标题: ${title}`}
              >
                {title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingTitle(true); setTitleValue(title); }}
                title="编辑标题（含编号）"
                className="flex-shrink-0"
                style={{
                  width: 18, height: 18, padding: 0,
                  border: "none", background: "transparent",
                  // 隐藏时 display:none 让出空间，标题获得更多显示宽度。
                  display: showActions ? "flex" : "none",
                  alignItems: "center", justifyContent: "center",
                  borderRadius: 4,
                  color: "var(--c-t4)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                  (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
                }}
              >
                <Pencil style={{ width: 10, height: 10 }} />
              </button>
            </div>
          )}
        </div>

        {dualTargetConflict && (
          <div
            title="左侧和顶部输入都已连接 — 运行时只会使用第一个匹配的输入，另一个会被忽略。请只保留一条输入连线。"
            style={{
              width: 20, height: 20, borderRadius: 5,
              background: "oklch(0.70 0.16 65 / 0.18)",
              border: "1px solid oklch(0.70 0.16 65 / 0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "help", flexShrink: 0,
            }}
          >
            <AlertTriangle size={12} style={{ color: "oklch(0.78 0.16 65)" }} />
          </div>
        )}

        {/* ◆4 标题栏常驻「折叠三角 + 图钉」——让「折叠/固定」一眼可见可点，不必再进右键菜单。
            仅对 studio 浮层节点显示。三角:展开态点击折叠(取消固定+取消选中)、折叠态点击展开(选中即浮起)。 */}
        {usesStudioFloating && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const st = useCanvasStore.getState();
                if (studioFloated || pinned) { st.updateNodeData(id, { pinned: false }); st.setNodes(st.nodes.map((n) => n.id === id ? { ...n, selected: false } : n)); }
                else { st.setNodes(st.nodes.map((n) => ({ ...n, selected: n.id === id }))); }
              }}
              title={(studioFloated || pinned) ? "折叠节点" : "展开节点"}
              className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
              style={{ background: "transparent", color: "var(--c-t4)", border: "1px solid transparent", cursor: "pointer" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
            >
              {(studioFloated || pinned) ? <ChevronDown size={12} /> : <ChevronUp size={12} style={{ transform: "rotate(90deg)" }} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); useCanvasStore.getState().updateNodeData(id, { pinned: !pinned }); }}
              title={pinned ? "取消固定（恢复自动折叠）" : "固定显示（始终展开）"}
              className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
              style={{
                background: pinned ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                color: pinned ? "oklch(0.78 0.16 285)" : "var(--c-t4)",
                border: pinned ? "1px solid oklch(0.68 0.22 285 / 0.35)" : "1px solid transparent", cursor: "pointer",
              }}
              onMouseEnter={(e) => { if (!pinned) { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; } }}
              onMouseLeave={(e) => { if (!pinned) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; } }}
            >
              <Pin size={10} />
            </button>
          </>
        )}
        {/* 非 studio 皮肤:保留原被动固定指示 */}
        {!usesStudioFloating && pinned && (
          <span title="已固定（右键菜单可取消）"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 4,
              background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.78 0.16 285)", border: "1px solid oklch(0.68 0.22 285 / 0.35)", flexShrink: 0 }}>
            <Pin size={10} />
          </span>
        )}
        {/* ◆6 锁定徽标(所有皮肤):锁定时常驻,点击解锁 */}
        {locked && (
          <button
            onClick={(e) => { e.stopPropagation(); useCanvasStore.getState().updateNodeData(id, { locked: false }); }}
            title="已锁定(不可拖/删) — 点击解锁"
            className="node-status-badge nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
            style={{ background: "oklch(0.70 0.16 65 / 0.15)", color: "oklch(0.72 0.16 65)", border: "1px solid oklch(0.70 0.16 65 / 0.35)", cursor: "pointer" }}>
            <Lock size={10} />
          </button>
        )}
        {/* 跳过执行徽标（payload.disabled，右键切换）：运行全部/估价均不含该节点；点击恢复 */}
        {runDisabled && (
          <button
            onClick={(e) => { e.stopPropagation(); useCanvasStore.getState().updateNodeData(id, { disabled: false }); }}
            title="已设为跳过执行（运行全部/估价不包含）— 点击恢复参与执行"
            className="node-status-badge nodrag flex-shrink-0 flex items-center gap-1 h-[18px] px-1.5 rounded"
            style={{ background: "var(--c-surface)", color: "var(--c-t4)", border: "1px dashed var(--c-bd3)", cursor: "pointer", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>
            <CircleSlash size={9} /> 跳过
          </button>
        )}

        {/* #11 协作编辑徽标：他人正在编辑此节点 → 显示其头像(首字母)+柔性锁提示 */}
        {peerEdit && (
          <span
            title={`${peerEdit.userName} 正在编辑此节点`}
            className="nodrag flex-shrink-0 flex items-center justify-center"
            style={{ width: 18, height: 18, borderRadius: 999, background: peerEdit.color, color: "#fff", fontSize: 10, fontWeight: 800, border: "1px solid oklch(1 0 0 / 0.45)" }}>
            {(peerEdit.userName || "?").charAt(0).toUpperCase()}
          </span>
        )}

        {/* 直传 — push current output to downstream inputs without running */}
        {canDirectPass && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDirectPass(); }}
            title="直传：把当前输出直接传给已连接的下游节点（无需运行）"
            className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
            style={{
              background: "oklch(0.65 0.18 200 / 0.15)",
              color: "oklch(0.72 0.16 200)",
              border: "1px solid oklch(0.65 0.18 200 / 0.35)",
              cursor: "pointer",
            }}
          >
            <Share2 size={10} />
          </button>
        )}

        {/* 标题栏常驻"运行/重新生成"按钮 — 折叠时也能一键运行，覆盖所有主题/模式 */}
        {onRun && (
          <button
            onClick={(e) => { e.stopPropagation(); if (canRun && !nodeRunning) triggerRun(); }}
            disabled={!canRun || nodeRunning}
            title={nodeRunning ? "生成中…" : (hasResult ? "重新生成" : "运行")}
            className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
            style={{
              background: !canRun || nodeRunning ? "var(--c-surface)" : `${config.color}22`,
              color: !canRun || nodeRunning ? "var(--c-t4)" : config.color,
              border: `1px solid ${!canRun || nodeRunning ? "var(--c-bd2)" : `${config.color}55`}`,
              cursor: !canRun || nodeRunning ? "not-allowed" : "pointer",
            }}
          >
            {nodeRunning ? <Loader2 size={10} className="animate-spin" /> : (hasResult ? <RefreshCw size={10} /> : <Play size={10} />)}
          </button>
        )}

        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}

        {/* LibTV 化 3.6：创意模式标签行右端的媒体尺寸灰字（如「2048 × 1152」） */}
        {isCreative && hasHero && <HeroSizeBadge hostRef={heroMediaRef} variant="text" />}

        {/* Type badge —— 创意(LibTV)皮肤隐藏这枚彩色类型标签：LibTV 标题行只有灰名 + 灰尺寸，
            节点类型由左侧小图标传达即可，彩色徽章与「纯媒体+极简标签」的观感相悖。 */}
        {!hideTypeBadge && !isCreative && (
          <span
            className="node-type-badge text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 leading-none tracking-widest uppercase"
            style={{
              background: `${config.color}15`,
              color: `${config.color}`,
              border: `1px solid ${config.color}28`,
              opacity: 0.85,
            }}
          >
            {config.label}
          </span>
        )}

        {/* Collaborator indicator — a small dot in the creator's unique color so
            collaborators can tell who placed each node. Matches cursor colors. */}
        {creatorColor && (
          <span
            className="flex-shrink-0 rounded-full"
            title={`${creatorName ?? "协作者"} 放置的节点`}
            style={{
              width: 8,
              height: 8,
              background: creatorColor,
              border: "1.5px solid var(--c-base)",
              boxShadow: `0 0 0 1px ${creatorColor}66, 0 0 6px ${creatorColor}55`,
            }}
          />
        )}

        {/* Owner-agent badge — which agent generated this node (multi-agent canvas). */}
        {ownerBadge && (
          <span
            className="flex-shrink-0"
            title={`由智能体 A${ownerBadge.index} 生成`}
            style={{
              fontSize: 8.5, fontWeight: 800, lineHeight: "13px", height: 13, minWidth: 16,
              padding: "0 3px", borderRadius: 4, textAlign: "center", color: "#fff",
              background: ownerBadge.color, boxShadow: `0 0 0 1px ${ownerBadge.color}66`,
            }}
          >A{ownerBadge.index}</span>
        )}

        {/* Run status badge */}
        {runStatus === "running" && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.72 0.22 142 / 0.18)", border: "1px solid oklch(0.72 0.22 142 / 0.55)" }}
            title="执行中"
          >
            <Loader2 className="w-3 h-3 animate-spin" style={{ color: "oklch(0.72 0.22 142)" }} />
          </div>
        )}
        {runStatus === "done" && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.72 0.18 155 / 0.18)", border: "1px solid oklch(0.72 0.18 155 / 0.55)" }}
            title="已完成"
          >
            <Check className="w-3 h-3" style={{ color: "oklch(0.72 0.18 155)" }} />
          </div>
        )}
        {runStatus === "failed" && (
          // #143 上次「运行全部」失败的徽标：用户会误当取消按钮点——让它真的可点（=重试），
          // title 讲清语义。
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.62 0.22 25 / 0.18)", border: "1px solid oklch(0.62 0.22 25 / 0.55)", cursor: onRun && canRun ? "pointer" : "default" }}
            title={onRun && canRun ? "上次运行失败——点击重试" : "上次运行失败"}
            onClick={(e) => { if (onRun && canRun && !nodeRunning) { e.stopPropagation(); onRun(); } }}
          >
            <X className="w-3 h-3" style={{ color: "oklch(0.62 0.22 25)" }} />
          </div>
        )}

        {/* Action buttons — 单击节点后显示 3 秒；隐藏时用 display:none 让出空间（其它按钮靠右、
            标题获得更多显示宽度）；鼠标悬停其上时保持显示（移开后重新计时）。 */}
        <div
          className="items-center gap-0.5 flex-shrink-0"
          style={{ display: showActions ? "flex" : "none" }}
          onMouseEnter={() => { if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current); }}
          onMouseLeave={() => armHideActions()}
        >
          {VARIANT_TYPES.includes(nodeType) && (
            <button
              onClick={() => { const n = createVariants(id, 3); if (n > 0) toast.success(`已生成 ${n} 个变体（各带随机种子，复用相同输入）`); }}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
              style={{ color: "var(--c-t4)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--c-bd2)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
              }}
              title="生成 A/B 变体（×3，各带随机种子）"
            >
              <Layers className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => duplicateNode(id)}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{ color: "var(--c-t4)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--c-bd2)";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
            }}
            title="复制节点 (Ctrl+D)"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => { deleteNode(id); if (projectId) deleteNodeMutation.mutate({ id, projectId }); }}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{ color: "var(--c-t4)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.22 25 / 0.12)";
              (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.22 25)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
            }}
            title="删除节点 (Delete)"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Persistent generation progress ──
          Rendered right under the header (outside the collapsing body) so the
          bar stays visible even when the node is collapsed/deselected. Driven by
          the payload's status/progress, so it works for every node uniformly. */}
      {(genBusy || nodeRunning) && (
        <div
          title={genProgress != null ? `生成中 ${Math.round(genProgress)}%` : "生成中…"}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", flexShrink: 0, background: "var(--c-node-bg)", borderBottom: "1px solid var(--c-bd1)" }}
        >
          <div style={{ flex: 1, height: 4, background: "var(--c-bd1)", borderRadius: 2, overflow: "hidden" }}>
            <div
              className={genProgress == null ? "animate-pulse" : undefined}
              style={{
                height: "100%",
                width: genProgress != null ? `${Math.max(3, Math.min(100, genProgress))}%` : "100%",
                background: config.color,
                opacity: genProgress == null ? 0.55 : 1,
                boxShadow: `0 0 6px ${config.color}88`,
                transition: "width 280ms ease",
                borderRadius: 2,
              }}
            />
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: config.color, whiteSpace: "nowrap" }}>
            {genProgress != null ? `${Math.round(genProgress)}%` : (genQueue != null ? `排队 ${genQueue}` : "生成中")}
          </span>
          {onCancelGenerate && (
            // #142 取消常驻可达：此前取消按钮在收起的配置区里，创意模式/未选中看不到。
            <button
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); onCancelGenerate(); }}
              title="取消生成 / 放弃等待"
              style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer", lineHeight: "14px" }}
            >
              取消
            </button>
          )}
        </div>
      )}

      {/* ── Live sampling preview (ComfyUI) ──
          The denoising in-progress image streamed over the WS. Shown only while
          busy and when the node is expanded (selected/pinned), so collapsed nodes
          stay compact. Transient — discarded when the run finishes. */}
      {genBusy && livePreview && expandSelected && (
        <div style={{ padding: "4px 8px", flexShrink: 0, background: "var(--c-node-bg)", borderBottom: "1px solid var(--c-bd1)" }}>
          <img
            src={livePreview}
            alt="实时预览"
            className="nodrag"
            style={{ display: "block", width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6, background: "var(--c-surface)" }}
          />
        </div>
      )}

      {/* ── Persistent failure indicator ──
          Like the progress bar, rendered outside the collapsing body so a failed
          generation is visible even when the node is collapsed (the detailed error
          lives inside the body). */}
      {!genBusy && !nodeRunning && genErrorShown && (
        <div
          className="nodrag"
          role="button" tabIndex={0} aria-label={`生成失败：${genErrorShown}`}
          onClick={(e) => { e.stopPropagation(); setErrExpanded((v) => !v); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setErrExpanded((v) => !v); } }}
          title={errExpanded ? "点击收起" : "点击展开完整错误"}
          style={{ display: "flex", alignItems: errExpanded ? "flex-start" : "center", gap: 5, padding: "4px 10px", flexShrink: 0, cursor: "pointer", background: "oklch(0.62 0.20 25 / 0.12)", borderBottom: "1px solid var(--c-bd1)" }}
        >
          <AlertTriangle size={11} style={{ color: "oklch(0.62 0.20 25)", flexShrink: 0, marginTop: errExpanded ? 2 : 0 }} />
          <span style={errExpanded
            ? { fontSize: 9.5, fontWeight: 600, color: "oklch(0.62 0.20 25)", flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }
            : { fontSize: 9.5, fontWeight: 600, color: "oklch(0.62 0.20 25)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {genErrorShown}
          </span>
          {/* #315 结果找回：任务已提交但等待超时（RECOVERABLE 标记）→ 免费单查平台状态，
              完成即取回结果写回节点——不必重掏钱重新生成。收起/展开态都常驻可点。 */}
          {recoverable && (
            <button
              className="nodrag" data-testid="recheck-task-btn"
              onClick={(e) => { e.stopPropagation(); void onRecheck(); }}
              disabled={recheckMut.isPending}
              title="平台侧任务可能已完成——免费查询一次并取回结果（不重新扣费）"
              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid oklch(0.72 0.15 155 / 0.55)", background: "oklch(0.72 0.15 155 / 0.12)", color: "oklch(0.72 0.15 155)", cursor: recheckMut.isPending ? "default" : "pointer", opacity: recheckMut.isPending ? 0.6 : 1 }}
            >
              {recheckMut.isPending ? "检测中…" : "重新检测"}
            </button>
          )}
          {errExpanded ? (
            <button
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); try { void navigator.clipboard?.writeText(genErrorShown); toast.success("已复制错误信息", { duration: 1200 }); } catch { /* ignore */ } }}
              title="复制完整错误"
              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid oklch(0.62 0.20 25 / 0.4)", background: "transparent", color: "oklch(0.62 0.20 25)", cursor: "pointer" }}
            >
              <Copy size={9} /> 复制
            </button>
          ) : (
            <ChevronDown size={11} style={{ color: "oklch(0.62 0.20 25)", flexShrink: 0, opacity: 0.7 }} />
          )}
        </div>
      )}

      {/* ── Hero media (creative mode only, shown via CSS) ── */}
      {hasHero && (
        <div className="node-hero-media" ref={heroMediaRef}>
          {heroMedia}
          {/* 尺寸标注移至标题标签行（LibTV 标签行右端灰字，3.6）；hero 角落 chip 不再重复 */}
          {/* LibTV 化 3.4：创意模式生成中的英雄区骨架流光 + 进度百分比覆盖层
              （与标题栏下常驻进度条同一 payload.status/progress 数据源） */}
          {isCreative && genBusy && (
            <div className="node-hero-genmask">
              <span>{genProgress != null ? `${Math.round(genProgress)}%` : "生成中…"}</span>
            </div>
          )}
          {/* Studio: fullscreen lightbox trigger — 仅图片结果。视频结果不再叠加自定义全屏钮：
              原生控制条自带的全屏能真正铺满屏幕，双按钮只会让人点到不铺满的那个（用户实测反馈）；
              水印开启时原生全屏被禁，但 WatermarkedVideo 自带的放大预览钮会顶上。图片无原生全屏，保留。 */}
          {isStudio && !resultVideoUrl && resultImageUrl && (
            <button
              className="nodrag studio-toolbtn"
              onClick={(e) => { e.stopPropagation(); openLightbox(); }}
              title="全屏预览"
              style={{ position: "absolute", top: 6, right: 6, zIndex: 6, width: 26, height: 26, borderRadius: 8,
                border: "1px solid oklch(1 0 0 / 0.18)", background: "oklch(0 0 0 / 0.45)", color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>
      )}

      {/* ── Content area ──
          Studio skin: when selected, the param body floats in a panel ATTACHED BELOW
          the node (LibLib-style 上下吸附) so the node card itself stays compact/media-first
          instead of expanding inline. Same `children` (every control preserved) — only
          relocated. Pro/creative render the body inline (collapsible) exactly as before. */}
      {/* Studio (selected): the body is relocated to a panel attached BELOW the node,
          rendered OUTSIDE this overflow:hidden wrapper (see below) so it isn't clipped
          and lives in the node's transformed space (scales with canvas zoom). */}
      {/* Studio: 只有「选中（命令栏浮出）」时才不内联 body——参数交给下方浮动面板。
          未选中时像专业版一样内联渲染 body，使剪辑等「预览在 body 里、又无结果英雄区」
          的节点在静止态也常显预览（此前 studio 一律不内联 → 未选中只剩光秃标题栏）。
          有结果英雄区的节点(has-hero)未选中仍由「媒体优先折叠」CSS 收成英雄区，不受影响。 */}
      {(studioFloated || lodFar) ? null : (
        <NodeSelectedContext.Provider value={expandSelected}>
          <div className="node-body-wrap">
            {/* When the node height is capped, make this wrapper a flex column so a
                flex:1 child can inherit the bounded height (percentage height/h-full
                can't resolve here because the parent height is flex-derived). */}
            <div className="overflow-visible nopan" style={{ flex: 1, minHeight: 0, ...(capNodeHeight ? { display: "flex", flexDirection: "column" } : {}) }}>{children}</div>
          </div>
        </NodeSelectedContext.Provider>
      )}

      </div>{/* end inner overflow:hidden content wrapper */}

      {/* Studio: param panel attached BELOW the node. Rendered as an absolutely-positioned
          child of the node root (NOT a NodeToolbar), so it lives inside the node's
          transformed space → scales with canvas zoom, and matches the node width (100%).
          `nowheel` lets it scroll internally without ReactFlow hijacking the wheel. */}
      {studioFloated && (
        <div
          className="nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            // double-click anywhere on the panel background toggles full params
            // (ignore dblclick that originates inside an input/control)
            if ((e.target as HTMLElement).closest("input,textarea,select,button")) return;
            e.stopPropagation(); setStudioExpanded(!studioExpanded);
          }}
          style={{
            position: "absolute",
            // ★2：默认向下展开；视口下方空间不足 → 向上翻转（bottom 锚点），避免被推出屏幕。
            ...(flipCmdBar ? { bottom: "calc(100% + 12px)" } : { top: "calc(100% + 12px)" }),
            // Align the panel outer edge with the node's SOLID highlight border outer
            // line (the 2px colored frame). width:100% on an absolute child resolves to
            // the padding box (2px inside that border), so pull out by the 2px border
            // width each side to sit flush with the border's outer edge.
            left: -2,
            width: "calc(100% + 4px)",
            maxHeight: 520,
            overflowY: "auto",
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            borderRadius: 14,
            boxShadow: "var(--c-node-shadow-selected)",
            padding: "14px 14px 16px",
            zIndex: 20,
          }}
        >
          {/* Studio param panel. EVERY node defaults to a COMPACT view + 展开全部参数:
              command-bar types get the curated LibLib row; all other types show their
              pro body capped to a short height (top = primary params). Expanding renders
              the same `children` the pro node uses (single source of truth). The body is
              wrapped in StudioFloatingContext so media-result nodes skip their in-body
              preview (the card hero already shows it → no duplicate). */}
          {studioExpanded ? (
            <>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t3)" }}>全部参数</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setStudioExpanded(false); }}
                  title="收起（也可双击面板空白处）"
                  className="flex items-center gap-1 rounded-lg"
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--c-t2)", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", padding: "3px 8px", cursor: "pointer" }}
                >
                  <ChevronUp size={12} /> 收起
                </button>
              </div>
              <StudioFloatingContext.Provider value={true}>
                <NodeSelectedContext.Provider value={true}>{children}</NodeSelectedContext.Provider>
              </StudioFloatingContext.Provider>
            </>
          ) : STUDIO_COMMAND_BAR_TYPES.has(nodeType) ? (
            <>
              <StudioCommandBar nodeId={id} onRun={onRun} canRun={canRun} running={nodeRunning} hasResult={hasResult} />
              <button
                onClick={(e) => { e.stopPropagation(); setStudioExpanded(true); }}
                title="展开全部参数（也可双击面板空白处）"
                className="flex items-center justify-center gap-1 w-full rounded-lg"
                style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: "var(--c-t3)", background: "var(--c-surface)", border: "1px dashed var(--c-bd2)", padding: "5px 0", cursor: "pointer" }}
              >
                <ChevronDown size={12} /> 展开全部参数
              </button>
            </>
          ) : (
            <>
              {/* compact: pro body capped to a short height; fade + 展开 only when it overflows */}
              <div ref={compactBodyRef} style={{ position: "relative", maxHeight: 200, overflow: "hidden" }}>
                <StudioFloatingContext.Provider value={true}>
                  <NodeSelectedContext.Provider value={true}>{children}</NodeSelectedContext.Provider>
                </StudioFloatingContext.Provider>
                {bodyOverflows && (
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 46, background: "linear-gradient(to bottom, transparent, var(--c-base))", pointerEvents: "none" }} />
                )}
              </div>
              {bodyOverflows && (
                <button
                  onClick={(e) => { e.stopPropagation(); setStudioExpanded(true); }}
                  title="展开全部参数（也可双击面板空白处）"
                  className="flex items-center justify-center gap-1 w-full rounded-lg"
                  style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "var(--c-t3)", background: "var(--c-surface)", border: "1px dashed var(--c-bd2)", padding: "5px 0", cursor: "pointer" }}
                >
                  <ChevronDown size={12} /> 展开全部参数
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 左侧吸附浮层：渲染在折叠 body 之外，节点收缩后仍常驻可见（绝对定位于节点根，向左吸附）。 */}
      {leftDock}

      {/* ── Connection Handles — outside overflow:hidden so ::before hit-area works ── */}
      {showHandles && (() => {
        const hint = CONNECTION_HINTS[nodeType];
        const inTitle = hint ? `${hint.label} 输入  ${hint.incoming}` : "输入";
        const outTitle = hint ? `${hint.label} 输出  ${hint.outgoing}` : "输出";
        return (
          <>
            <Handle type="target" position={Position.Left}   id="input"  style={{ ...targetHandle, top: "50%", left: -7 }} title={inTitle} />
            <Handle type="source" position={Position.Right}  id="output" style={{ ...sourceHandle, top: "50%", right: -7 }} title={outTitle} />
            {/* Top/Bottom handles offset off-center (32% / 68%) so the input dot and
                output dot never sit stacked at the horizontal center on a short or
                collapsed node — keeps in/out visually distinct. */}
            <Handle type="target" position={Position.Top}    id="top"    style={{ ...targetHandle, left: "32%", top: -7 }} title={inTitle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={{ ...sourceHandle, left: "68%", bottom: -7 }} title={outTitle} />
          </>
        );
      })()}

      {/* Custom handles for multi-handle nodes (e.g. clip) — rendered here, OUTSIDE the
          collapsible body, so they survive the studio skin's collapsed (body max-height:0)
          state. Nodes pass these via `extraHandles` together with showHandles={false}. */}
      {extraHandles}

      {/* #72 多角度/打光全功能编辑器：portal 到 body（节点 DOM 有 transform，
          fixed 定位会被祸害成相对定位）；独立于 NodeToolbar 挂载，节点取消选中也不闪关。 */}
      {angleEditorOpen && resultImageUrl && createPortal(
        <Suspense fallback={null}>
          <MultiAngleEditorLazy sourceUrl={resultImageUrl} nodeId={id} projectId={projectId ?? 0}
            onApply={applyEditedImage} onClose={() => setAngleEditorOpen(false)} />
        </Suspense>, document.body)}
      {relightEditorOpen && resultImageUrl && createPortal(
        <Suspense fallback={null}>
          <RelightEditorLazy sourceUrl={resultImageUrl} nodeId={id} projectId={projectId ?? 0}
            onApply={applyEditedImage} onClose={() => setRelightEditorOpen(false)} />
        </Suspense>, document.body)}

      {/* #103 快剪条（video_task 之外的视频节点；确认走 clip.trimVideo，按类型写回结果字段）。
          QuickTrimBar 自身 portal 到 body，不受节点 transform/overflow 影响。 */}
      {quickTrimOpen && resultVideoUrl && nodeType !== "video_task" && (
        <QuickTrimBar
          videoUrl={resultVideoUrl}
          projectId={projectId ?? 0}
          nodeId={id}
          onClose={() => setQuickTrimOpen(false)}
          onDone={(url) => {
            const st = useCanvasStore.getState();
            switch (nodeType) {
              case "comfyui_video": st.updateNodeData(id, { resultVideoUrl: url }); break;
              case "clip": case "merge": case "subtitle": case "subtitle_motion":
              case "overlay": case "smart_cut":
                st.updateNodeData(id, { outputUrl: url }); break;
              case "comfyui_workflow": {
                // 替换 outputUrls 里第一个视频（与 resultVideoUrl 推导取的是同一个）
                const p = st.nodes.find((n) => n.id === id)?.data.payload as Record<string, unknown> | undefined;
                const urls: string[] = Array.isArray(p?.outputUrls) ? [...(p!.outputUrls as string[])] : [];
                const i = urls.findIndex((u) => typeof u === "string" && u);
                if (i >= 0) urls[i] = url; else urls.unshift(url);
                st.updateNodeData(id, { outputUrls: urls });
                break;
              }
              case "asset": st.updateNodeData(id, { url }); break;
              default: break; // resultVideoUrl 的枚举类型已全覆盖，不会走到
            }
          }}
        />
      )}
    </div>
  );
});
