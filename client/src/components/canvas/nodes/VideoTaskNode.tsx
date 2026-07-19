import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { handleStyle } from "../../../lib/handleStyle";
import { useConnectState } from "../../../hooks/useConnectingStore";
import { useHoverStore } from "../../../hooks/useHoverStore";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { usePersistentState } from "../../../hooks/usePersistentState";
import type { VideoTaskNodeData, VideoProvider, CharacterNodeData } from "../../../../../shared/types";
import { maxRefImagesForProvider } from "../../../../../shared/videoRefCaps";
import { appendSubjectMapping, subjectOverflow } from "../../../../../shared/subjectRef";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { effectiveCharacterRefImages, effectiveSceneRefImages, effectiveCharacters, stripCharacterMentions, effectiveCharacterVideoRefs, effectiveCharacterAudioRefs } from "../../../lib/characterConditioning";
import { connectedEffectPrompts, appendEffectPrompts } from "../../../lib/effectPrompt";
import { composeCharacterEffectPrompt } from "../../../lib/promptCompose";
import { clampDurationForProvider } from "../../../lib/storyboardGen";
import { detectUpstreamPrompt, detectUpstreamImageUrl, detectUpstreamStoryboardDuration, listUpstreamVideoSources, listUpstreamAudioSources, mentionedMediaUrls, stripMediaMentions } from "../../../lib/comfyWorkflowParams";
import { SUPPORTS_REF_VIDEO, SUPPORTS_REF_AUDIO, collectVideoRefMedia, planCharacterRefs } from "../../../lib/videoRefMedia";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Handle, Position } from "@xyflow/react";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle, Download, ChevronDown, ChevronRight, Layers, Plus, X as XIcon, Film, ArrowUp } from "lucide-react";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { mediaFetchUrl, onDownloadMedia } from "@/lib/download";
import { listCustomPresets, saveCustomPreset, deleteCustomPreset, type CustomVideoPreset } from "@/lib/customPresets";
import { ensureNotificationPermission, showCompletionNotification } from "@/lib/notify";
import { CinematographyPicker } from "../CinematographyPicker";
import { RefImageReachabilityBadge, RefImageSwitchButton, useRefImageGuard, providerNeedsPublicMedia, usePreferUpstreamRefSource, useAutoPreferUpstreamRefSource } from "../mediaReachability";
import { ModelPicker } from "../ModelPicker";
import { confirmRegenerate } from "@/lib/confirmRegenerate";
import { SyncNodesDialog } from "../SyncNodesDialog";
import { platformBadge, VIDEO_MODELS } from "../../../lib/models";
import { estimateVideoCost, costEstimateLabel } from "../../../lib/costEstimate";
import { ImageLightbox } from "../ImageLightbox";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { openNodeImage } from "../NodeImageLightbox";
import { PromptDock } from "../PromptDock";
import { RefHeroPreview } from "../RefHeroPreview";
import { useNodeDocks, useCharSceneItems, useAudioStripItems, useVideoStripItems } from "../../../hooks/useNodeDocks";
import { useReferenceImages } from "../../../hooks/useReferenceImages";
import { HideWhenStudioFloating } from "../../../contexts/StudioFloatingContext";
import { MediaImage } from "../MediaImage";
import {
  applyCinematographyToPrompt,
  clearCinematographyFromPrompt,
  detectActiveCinematography,
  applyCinematographyParams,
  clearCinematographyParamsPatch,
  getTemplateById,
} from "@/lib/cinematographyTemplates";
import { NodeTextArea, NodeInput } from "../NodeTextInput";
import { InlineGenBar } from "../InlineGenBar";
import { QuickTrimBar } from "../QuickTrimBar";
import { CameraRigPicker, stripCameraRig } from "../CameraRigPicker";
import { Camera, MapPin } from "lucide-react";
import { ToolChip, RefThumbRow, MarkElementPicker, MarkChipRow, loadMarkModel, saveMarkModel, switchMark, removeMark } from "../InlineBarParts";
import { nanoid } from "nanoid";
import { usePickStore } from "../../../hooks/usePickStore";
import { useCanvasMode } from "../../../contexts/CanvasModeContext";
import { useUIStyle } from "../../../contexts/UIStyleContext";
import { useFocusRefSource } from "../../../hooks/useFocusRefSource";
// 视频模型参数表已抽到 shared/videoModelParams（服务端画布助手目录同源消费）；
// 这里再导出以保持既有导入路径（ShotListPanel / StudioCommandBar / useWorkflowRunner 等）不变。
import { PROVIDER_PARAMS, withParamDefaults, SUPPORTS_NEGATIVE_PROMPT, REQUIRES_REFERENCE_IMAGE } from "../../../../../shared/videoModelParams";
export { PROVIDER_PARAMS, withParamDefaults, SUPPORTS_NEGATIVE_PROMPT, REQUIRES_REFERENCE_IMAGE };

// LibTV 化 2.2：就地参数浮层的档位按钮（选中态走强调色，与 image_gen 输入条同款）。
function InlinePill({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      className="nodrag"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        padding: "5px 9px", fontSize: 10.5, borderRadius: 7,
        border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
        background: active ? "color-mix(in oklab, var(--ui-accent) 16%, var(--c-surface))" : "var(--c-surface)",
        color: "var(--c-t2)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// Heuristic: only allow http(s) / same-origin paths to render. Reject data:/blob:/javascript:.
function isSafeMediaUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url);
}

// 绿点徽标：媒体已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
function MinioStorageBadge() {
  return (
    <div
      title="已存储到 MinIO·长期有效"
      className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
      style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
    />
  );
}

function ShotItem({ u, idx }: { u: string; idx: number }) {
  const storedInMinio = isOwnStorageUrl(u);
  const src = mediaFetchUrl(u);
  return (
    <div>
      <div className="relative rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.72 0.18 155 / 0.30)" }}>
        {storedInMinio && <MinioStorageBadge />}
        <WatermarkedVideo
          block
          src={src}
          controls
          className="w-full nodrag"
          style={{ maxHeight: 110, display: "block" }}
          preload="metadata"
          onError={(e) => { console.error("[VideoTaskNode] shot", idx, "load error:", (e.currentTarget as HTMLVideoElement).error?.message); }}
        />
      </div>
      <a
        href={mediaFetchUrl(u, true)}
        onClick={onDownloadMedia(u, `视频_第${idx + 1}段.mp4`)}
        className="nodrag mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] font-medium cursor-pointer"
        style={{ background: "oklch(0.72 0.18 155 / 0.10)", border: "1px solid oklch(0.72 0.18 155 / 0.30)", color: "oklch(0.72 0.18 155)", textDecoration: "none" }}
      >
        <Download className="w-2.5 h-2.5" /> 第 {idx + 1} 段
      </a>
    </div>
  );
}

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "video_task";
    title: string;
    payload: VideoTaskNodeData;
    projectId: number;
  };
}

const STATUS = {
  pending:    { icon: Clock,         label: "待提交", accent: "var(--c-t3)", bg: "var(--c-surface)", borderColor: "var(--c-bd2)" },
  processing: { icon: Loader2,       label: "生成中", accent: "oklch(0.68 0.22 285)",  bg: "oklch(0.68 0.22 285 / 0.08)", borderColor: "oklch(0.68 0.22 285 / 0.30)", spin: true },
  succeeded:  { icon: CheckCircle2,  label: "已完成", accent: "oklch(0.72 0.18 155)",  bg: "oklch(0.72 0.18 155 / 0.08)", borderColor: "oklch(0.72 0.18 155 / 0.30)" },
  failed:     { icon: XCircle,       label: "失败",   accent: "oklch(0.62 0.20 25)",   bg: "oklch(0.62 0.20 25 / 0.08)",  borderColor: "oklch(0.62 0.20 25 / 0.30)" },
} as const;

// 视频模型清单集中在 lib/models.ts（VIDEO_MODELS）统一维护，供本节点选择器与管理
// 后台「模型使能」枚举共用。排序（Kie 在 Poyo 之前）由 ModelPicker 按 group 统一处理。
const PROVIDERS = VIDEO_MODELS;

// Precomputed, stable ModelPicker options — PROVIDERS is a module constant, so
// projecting it once (rather than `PROVIDERS.map(...)` inline each render) keeps
// the reference stable so ModelPicker's `groups` useMemo isn't busted on every
// re-render (this node re-renders on each 5s poll tick).
export const PROVIDER_PICKER_OPTIONS = PROVIDERS.map((p) => ({
  value: p.value,
  label: p.label,
  group: p.group,
  family: p.family,
  caps: p.caps,
  costLabel: p.costLabel,
}));




/** The exact payload patch applied when the video provider/model changes: switch
 *  provider, reset params (each provider has its own param schema), and drop a stale
 *  negative prompt for providers that don't support it. Exported as the single source
 *  of truth so the studio inspector can reuse it verbatim (no logic duplication). */
export function videoProviderChangePatch(newProvider: VideoProvider) {
  return {
    provider: newProvider,
    params: {},
    ...(!SUPPORTS_NEGATIVE_PROMPT.has(newProvider) ? { negativePrompt: undefined } : {}),
  };
}

// Multi-modal reference (docs/poyo-video-api.md §六): models that accept reference
// videos / audios on the SAME wire model. Only Seedance-2 qualifies — Wan 2.7's
// reference mode is a separate wire model not yet mapped. Collected from connected
// upstream `asset` nodes (video / audio) → reference_video_urls / reference_audio_urls.




interface ParamPreset {
  id: string;
  label: string;
  params: Record<string, unknown>;
  negativePrompt?: string;
}


const KLING_O3_PRESETS: ParamPreset[] = [
  { id: "cinematic",  label: "电影横屏", params: { aspect_ratio: "16:9", duration: 10 } },
  { id: "portrait",   label: "竖屏短片", params: { aspect_ratio: "9:16", duration: 8 } },
  { id: "square",     label: "方形社交", params: { aspect_ratio: "1:1", duration: 5 } },
  { id: "anime",      label: "动漫风格", params: { aspect_ratio: "16:9", duration: 5 }, negativePrompt: "realistic, photo, 3d render, photography" },
];

const HF_DOP_FAST_PRESETS: ParamPreset[] = [
  { id: "zoom",   label: "推镜特写", params: { camera_motion_type: "zoom_in",  camera_motion_speed: "slow",   resolution: "720p" } },
  { id: "orbit",  label: "环绕运镜", params: { camera_motion_type: "orbit",    camera_motion_speed: "normal", resolution: "720p" } },
  { id: "static", label: "固定镜头", params: { camera_motion_type: "static",                                  resolution: "720p" } },
];

const WAN26_PRESETS: ParamPreset[] = [
  { id: "quick",   label: "快速预览", params: { duration: 5,  resolution: "720p",  multi_shots: false } },
  // ⚠️ Wan 2.6 `multi_shots: true` produces 3 separate shots and bills 3x.
  // Users must opt-in via the toggle (which carries an explicit warning label)
  // instead of getting it bundled into a preset whose name doesn't telegraph cost.
  { id: "medium",  label: "中等时长", params: { duration: 10, resolution: "720p",  multi_shots: false } },
  { id: "long_hd", label: "高清长片", params: { duration: 15, resolution: "1080p", multi_shots: false } },
];

const PROVIDER_PRESETS: Record<string, ParamPreset[]> = {
  poyo_seedance: [
    { id: "cinematic",  label: "电影宽屏", params: { aspect_ratio: "16:9", duration: 10, camera_fixed: true,  resolution: "1080p" } },
    { id: "portrait",   label: "竖屏短片", params: { aspect_ratio: "9:16", duration: 5,  resolution: "720p"  } },
    { id: "ultrawide",  label: "超宽景观", params: { aspect_ratio: "21:9", duration: 8,  resolution: "1080p" } },
    { id: "audio",      label: "带音效",  params: { aspect_ratio: "16:9", duration: 5,  generate_audio: true, resolution: "720p" } },
  ],
  poyo_veo: [
    { id: "hd_ref",      label: "高清参考", params: { resolution: "1080p", generation_type: "reference", aspect_ratio: "16:9" } },
    { id: "4k",          label: "4K 旗舰", params: { resolution: "4k",    generation_type: "reference", aspect_ratio: "16:9" } },
    { id: "portrait",    label: "竖屏",   params: { resolution: "1080p", generation_type: "reference", aspect_ratio: "9:16" } },
    { id: "first_frame", label: "首帧约束", params: { resolution: "720p",  generation_type: "frame",     aspect_ratio: "16:9" } },
  ],
  poyo_kling26: [
    { id: "cinematic", label: "电影横屏", params: { aspect_ratio: "16:9", duration: 10, sound: false } },
    { id: "portrait",  label: "竖屏短片", params: { aspect_ratio: "9:16", duration: 5,  sound: false } },
    { id: "sound_fx",  label: "带音效",  params: { aspect_ratio: "16:9", duration: 5,  sound: true  } },
  ],
  poyo_kling_o3_std: KLING_O3_PRESETS,
  poyo_kling_o3_pro: KLING_O3_PRESETS,
  poyo_kling_o3_4k:  KLING_O3_PRESETS,
  poyo_wan25_t2v:    WAN26_PRESETS,
  poyo_wan25_i2v:    WAN26_PRESETS,
  poyo_runway45: [
    { id: "cinematic", label: "电影横屏", params: { aspect_ratio: "16:9", duration: 10 } },
    { id: "portrait",  label: "竖屏短片", params: { aspect_ratio: "9:16", duration: 5  } },
  ],
  hf_dop_standard: [
    { id: "zoom_slow",  label: "推镜特写", params: { camera_motion_type: "zoom_in",  camera_motion_speed: "slow",   duration: 8, resolution: "1080p" } },
    { id: "orbit",      label: "环绕运镜", params: { camera_motion_type: "orbit",    camera_motion_speed: "normal", duration: 8, resolution: "720p"  } },
    { id: "static_hd",  label: "固定高清", params: { camera_motion_type: "static",                                  duration: 8, resolution: "1080p" } },
    { id: "tilt_slow",  label: "上倾慢镜", params: { camera_motion_type: "tilt_up",  camera_motion_speed: "slow",   duration: 8, resolution: "720p"  } },
  ],
  hf_dop_lite:   HF_DOP_FAST_PRESETS,
  hf_dop_turbo:  HF_DOP_FAST_PRESETS,
};

const BORDER_DEFAULT = "var(--c-bd2)";
const accentColor = "oklch(0.62 0.20 25)";

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

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

// OmniHuman「指定说话主体」：对肖像参考图跑主体检测，展示各主体蒙版，勾选谁说话 → payload.maskUrls。
// 肖像图与提交时(composeSubmissionContext)同口径解析：手动上传 > 手填/推送 referenceImageUrl
// > 连线上游图像 > 连线/@提及角色参考图 > @提及图像。订阅 edges/nodes，连线一变即重算。
function OmnihumanSubjectPicker({ nodeId, prompt, referenceImageUrl, manualRefUrl, selected, onChange, disabled }: {
  nodeId: string; prompt?: string; referenceImageUrl?: string; manualRefUrl?: string;
  selected: string[]; onChange: (masks: string[]) => void; disabled?: boolean;
}) {
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const imageUrl = useMemo(() => {
    return manualRefUrl
      || referenceImageUrl?.trim()
      || detectUpstreamImageUrl(nodeId, edges, nodes)
      || effectiveCharacterRefImages(nodeId, prompt ?? "", edges, nodes).find((u) => !!u?.trim())
      || effectiveSceneRefImages(nodeId, prompt ?? "", edges, nodes).find((u) => !!u?.trim())
      || mentionedMediaUrls(prompt, "image", nodes)[0];
  }, [nodeId, prompt, referenceImageUrl, manualRefUrl, edges, nodes]);
  const [masks, setMasks] = useState<string[]>([]);
  const detect = trpc.videoTasks.detectOmnihumanSubjects.useMutation({
    onSuccess: (r) => { setMasks(r.masks); if (!r.masks.length) toast.info("未检测到可单独指定的主体（图中可能仅一个主体）"); },
    onError: (e) => toast.error("主体检测失败：" + e.message),
  });
  const toggle = (url: string) => onChange(selected.includes(url) ? selected.filter((u) => u !== url) : [...selected, url].slice(0, 5));
  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--c-bd2)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t2)" }}>指定说话主体（可选）</span>
        <button className="nodrag" disabled={disabled || !imageUrl || detect.isPending}
          onClick={() => imageUrl && detect.mutate({ imageUrl, kieTempKey: localStorage.getItem("kie:tempKey") || undefined })}
          style={{ fontSize: 11, padding: "3px 9px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t1)", cursor: imageUrl && !detect.isPending ? "pointer" : "not-allowed", opacity: imageUrl ? 1 : 0.5 }}>
          {detect.isPending ? "检测中…" : "检测主体"}
        </button>
      </div>
      {!imageUrl && <span style={{ fontSize: 10, color: "var(--c-t4)" }}>先设置肖像参考图，再检测主体</span>}
      {masks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {masks.map((url, i) => {
            const on = selected.includes(url);
            return (
              <button key={url} className="nodrag" onClick={() => toggle(url)} title={`主体 ${i + 1}`}
                style={{ position: "relative", width: 48, height: 48, borderRadius: 8, overflow: "hidden", padding: 0, cursor: "pointer",
                  border: `2px solid ${on ? "oklch(0.72 0.20 25)" : "var(--c-bd2)"}` }}>
                <img src={url} alt={`主体${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                {on && <span style={{ position: "absolute", top: 0, right: 2, fontSize: 12, color: "#fff", textShadow: "0 0 3px #000" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
      {selected.length > 0 && <span style={{ fontSize: 10, color: "var(--c-t3)" }}>已选 {selected.length} 个主体说话（不选 = 默认全部）</span>}
    </div>
  );
}

export const VideoTaskNode = memo(function VideoTaskNode({ id, selected, data }: Props) {
  const handlesActive = useHoverStore((s) => s.nodeId === id) || !!selected;
  const connectState = useConnectState(id, "video_task");
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // LibTV 化 2.1b：创意模式（未来 LibTV 模式宿主）下渲染屏幕恒定的就地生成输入条。
  const { uiStyle } = useUIStyle();
  const { mode: canvasMode } = useCanvasMode();
  const isCreativeMode = uiStyle !== "studio" && canvasMode === "creative";
  const [inlineParamsOpen, setInlineParamsOpen] = useState(false);
  // LibTV：创意模式配置区默认收起（就地输入条为主入口），点「高级」才展开——
  // 防止选中后配置区全高展开把输入条顶出视口。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 「高级」展开态不跨选中记忆：取消选中即复位，下次点选默认收起、需再点「高级」才展开。
  useEffect(() => { if (!selected) setAdvancedOpen(false); }, [selected]);
  // 展开「高级」时把节点内滚动容器滚回顶部——配置区从视频块后顶到最前，立刻可见。
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (advancedOpen) bodyScrollRef.current?.scrollTo({ top: 0 }); }, [advancedOpen]);
  // 快捷键 A：选中时切换「高级」参数区（Canvas 派发 canvas:toggle-advanced）。
  useEffect(() => {
    if (!selected) return;
    const h = () => setAdvancedOpen((v) => !v);
    window.addEventListener("canvas:toggle-advanced", h);
    return () => window.removeEventListener("canvas:toggle-advanced", h);
  }, [selected]);
  const payload = data.payload;
  // Pull a connected upstream prompt (提示词 / 分镜) into this node's blank prompt —
  // video_task advertises "← 提示词 / 分镜" but never consumed them. Primitive selector
  // result → only re-renders when the upstream prompt text actually changes.
  const upstreamPrompt = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).positive);
  const upstreamNeg = useCanvasStore((s) => detectUpstreamPrompt(id, s.edges, s.nodes).negative);
  useEffect(() => {
    const patch: Record<string, string> = {};
    if (upstreamPrompt && !payload.prompt?.trim()) patch.prompt = upstreamPrompt;
    if (upstreamNeg && !payload.negativePrompt?.trim()) patch.negativePrompt = upstreamNeg;
    if (Object.keys(patch).length) updateNodeData(id, patch, true); // fill-only-when-blank
  }, [upstreamPrompt, upstreamNeg, payload.prompt, payload.negativePrompt, id, updateNodeData]);
  // Auto-prefer the upstream AI temporary public URL as the reference source when
  // the admin toggle is on and that URL probes alive (no-op when off / default).
  const preferUpstreamRef = usePreferUpstreamRefSource();
  useAutoPreferUpstreamRefSource({ nodeId: id, refImageUrl: payload.referenceImageUrl, enabled: preferUpstreamRef, onSwitch: (u) => updateNodeData(id, { referenceImageUrl: u }, true) });
  // Count of parallel-mode createTaskMutation calls currently in flight.
  // When > 0, the shared mutation's global onSuccess/onError must NOT write to payload —
  // the per-mutate handler updates parallelResults instead. A single counter (vs. boolean
  // flag) correctly handles 2+ concurrent parallel submits whose globals fire in arbitrary order.
  const parallelInFlightRef = useRef(0);
  // Auto-collapse params when node is deselected; expand when selected
  const [paramsExpanded, setParamsExpanded] = useState(!!selected);
  useEffect(() => { setParamsExpanded(!!selected); }, [selected]);

  const { guard, reachable, dialog: reachabilityDialog } = useRefImageGuard();

  // Multi-reference-image management. Only the first (首图) feeds the video
  // model's start frame; the rest are managed alternates the user can reorder.
  const refImages = useReferenceImages(id, payload);
  // 「最终提示词」= 真正送去生成的正向词：本地/上游已填入 payload.prompt，再叠加角色注入与效果词。
  const finalPromptDisplay = useCanvasStore((s) => {
    const base = payload.prompt ?? "";
    const chars = effectiveCharacters(id, base, s.edges, s.nodes);
    // 先去角色 @提及，再去 @音频名/@视频名 字面量（这些只作媒体引用，不应进 prompt 文本）。
    const stripped = stripMediaMentions(stripCharacterMentions(base, s.nodes), s.nodes);
    return appendEffectPrompts(
      mergeCharactersIntoPrompt(stripped, chars, 4000),
      connectedEffectPrompts(id, s.edges, s.nodes),
    );
  });
  const hasCharInject = useCanvasStore((s) => effectiveCharacters(id, payload.prompt ?? "", s.edges, s.nodes).length > 0);
  // 左侧吸附窗 = 自有参考图（可编辑）+ 最终参与的角色/场景图（@提及或连线，只读），各带类型标签。
  const charSceneItems = useCharSceneItems(id, payload.prompt ?? "");
  // 音视频参考磁贴：仅当该模型支持视频/音频输入时展示（含上游来源 + 角色携带，各注明来源）。
  const supportsRefVideo = SUPPORTS_REF_VIDEO.has(payload.provider);
  const supportsRefAudio = SUPPORTS_REF_AUDIO.has(payload.provider);
  const videoItems = useVideoStripItems(id, payload.prompt ?? "");
  const audioItems = useAudioStripItems(id, payload.prompt ?? "");
  // LibTV 化 2.3：多主体参考语法——多图 provider 且附了 ≥2 张手动参考图时，
  // 给每张打「主体N」编号（N = 发送顺序，与 buildRefUrls 同源），提示词可用
  // 主体1/主体2… 指代对应图。仅编号会真正发送的前 max 张。
  const providerMaxRefs = maxRefImagesForProvider(payload.provider);
  // #228 角色参考状态提示：角色/场景定妆照本次「会不会发送、以什么方式发送」，与提交
  // 路径（buildRefUrls/refModeForSubmit）共用 planCharacterRefs 单一决策源，所见即所发。
  const upstreamFrameUrl = useCanvasStore((s) => detectUpstreamImageUrl(id, s.edges, s.nodes));
  const charRefPlan = useMemo(() => planCharacterRefs({
    charRefCount: charSceneItems.filter((it) => it.label === "角色" || it.label === "场景").length,
    manualRefCount: refImages.images.length,
    hasUpstreamFrame: !!(payload.referenceImageUrl?.trim() || upstreamFrameUrl),
    providerMaxRefs,
  }), [charSceneItems, refImages.images.length, payload.referenceImageUrl, upstreamFrameUrl, providerMaxRefs]);
  const subjectTagging = providerMaxRefs > 1 && refImages.images.length > 1;
  const subjectCount = subjectTagging ? Math.min(refImages.images.length, providerMaxRefs) : 0;
  const insertSubjectToken = useCallback((n: number) => {
    const cur = payload.prompt ?? "";
    const token = `主体${n}`;
    updateNodeData(id, { prompt: cur.trim() ? `${cur.replace(/\s+$/, "")} ${token}` : token });
  }, [id, payload.prompt, updateNodeData]);
  const stripImages: StripItem[] = [
    ...refImages.images.map((img, i) => ({ ...img, label: "参考图", removable: true, subjectIndex: subjectTagging && i < providerMaxRefs ? i + 1 : undefined })),
    ...charSceneItems,
    ...(supportsRefVideo ? videoItems : []),
    ...(supportsRefAudio ? audioItems : []),
  ];
  const docks = useNodeDocks(id, { hasRef: true, /* 常开：空态悬停也能看到「上传/素材库」参考图入口 */ hasPrompt: !!finalPromptDisplay.trim() }, { prompt: finalPromptDisplay, ref: stripImages.map((i) => i.id).join(",") });
  const { refOpen: stripOpen, setRefOpen: setStripOpen } = docks;
  const [refZoom, setRefZoom] = useState<number | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [showSyncDlg, setShowSyncDlg] = useState(false);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const refUploadMutation = trpc.upload.uploadImage.useMutation();
  const uploadRefFiles = useCallback(async (files: File[], index: number) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { toast.error("请选择图片文件"); return; }
    setRefUploading(true);
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
        const result = await refUploadMutation.mutateAsync({ base64, mimeType: file.type, filename: file.name });
        if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
        refImages.insertUrls([result.url], at, "upload");
        at++;
      }
      toast.success("参考图上传成功");
    } catch (err) {
      toast.error("参考图上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRefUploading(false);
    }
  }, [id, refImages, refUploadMutation]);

  const [parallelMode, setParallelMode] = useState(false);
  const [parallelProviders, setParallelProviders] = useState<VideoProvider[]>([]);
  const [parallelResults, setParallelResults] = useState<Record<string, { status: "pending" | "processing" | "done" | "failed"; videoUrl?: string; taskId?: number }>>({});
  // Track all in-flight parallel poll timers so we can fully clean them up when leaving parallel mode
  const parallelPollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Generation counter — incremented on parallel-mode close so stale per-mutate callbacks
  // (still in flight at close time) won't reintroduce entries into parallelResults
  const parallelGenRef = useRef(0);

  const createTaskMutation = trpc.videoTasks.create.useMutation({
    onSuccess: (task) => {
      // If any parallel submit is in flight, suppress global payload write for this call.
      // Decrement the counter so subsequent globals know when all parallel submits are done.
      if (parallelInFlightRef.current > 0) {
        parallelInFlightRef.current -= 1;
        return;
      }
      // Guard: node may have been deleted while mutation was in flight
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { status: "processing", taskId: task.id, externalTaskId: task.externalTaskId ?? undefined });
      toast.success("视频任务已提交");
    },
    onError: (err) => {
      if (parallelInFlightRef.current > 0) {
        parallelInFlightRef.current -= 1;
        // Per-call onError is responsible for surfacing the failure in parallelResults
        return;
      }
      toast.error("提交失败：" + err.message);
    },
  });

  const resetTaskMutation = trpc.videoTasks.reset.useMutation({
    onSuccess: () => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
      toast.success("已重置，可重新提交");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
      console.warn("Reset task DB error (ignored):", err.message);
      toast.warning("已本地重置；服务端同步失败：" + err.message);
    },
  });

  const pollQuery = trpc.videoTasks.poll.useQuery({ id: payload.taskId! }, { enabled: false, refetchInterval: false });
  const pollQueryRef = useRef(pollQuery);
  pollQueryRef.current = pollQuery;
  const utils = trpc.useUtils();

  // Poll parallel task IDs — intervals keyed by provider string
  useEffect(() => {
    Object.entries(parallelResults).forEach(([provider, entry]) => {
      if (entry.status === "processing" && entry.taskId != null && !parallelPollRefs.current.has(provider)) {
        const taskId = entry.taskId;
        const intervalId = setInterval(async () => {
          try {
            const result = await utils.videoTasks.poll.fetch({ id: taskId });
            if (result && (result.status === "succeeded" || result.status === "failed")) {
              setParallelResults(prev => ({
                ...prev,
                [provider]: { ...prev[provider], status: result.status === "succeeded" ? "done" : "failed", videoUrl: result.resultVideoUrl ?? undefined },
              }));
              clearInterval(parallelPollRefs.current.get(provider));
              parallelPollRefs.current.delete(provider);
            }
          } catch { /* transient — retry next tick */ }
        }, 5000);
        parallelPollRefs.current.set(provider, intervalId);
      }
      if ((entry.status === "done" || entry.status === "failed") && parallelPollRefs.current.has(provider)) {
        clearInterval(parallelPollRefs.current.get(provider));
        parallelPollRefs.current.delete(provider);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallelResults]);
  // Cleanup all parallel intervals on unmount
  useEffect(() => () => { parallelPollRefs.current.forEach(clearInterval); parallelPollRefs.current.clear(); }, []);

  useEffect(() => {
    if (!(payload.status === "processing" && payload.taskId)) return;
    // #253 轮询失败 ≠ 任务失败：云端任务已计费、照常生成，且往往已成功——此前连续失败
    // 5 次（仅 25 秒的网络/隧道抖动或服务热重启窗口）就把节点标 failed，用户实报
    // 「显示轮询失败，平台侧其实已出片」，还会诱导重提双花钱。改为：
    //  - 网络类失败【永不放弃】：第 5 次连续失败时 toast 警示一次并把间隔退避到 15s，
    //    继续自动重试直到拿到明确状态或用户点「放弃等待」；
    //  - 仅「任务不存在/已删除」这类明确结论才终止标 failed。
    let consecutiveFailures = 0;
    const MAX_POLL_FAILURES = 5;
    const isTerminalErr = (m: string) => /NOT_FOUND|不存在|已删除|无权/.test(m);
    let stopped = false;
    let delay = 5000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      try {
        const result = await pollQueryRef.current.refetch();
        if (result.error) throw result.error;
        if (result.data) {
          consecutiveFailures = 0;
          delay = 5000;
          const task = result.data;
          if (task.status === "succeeded" || task.status === "failed") {
            updateNodeData(id, {
              status: task.status,
              resultVideoUrl: task.resultVideoUrl ?? undefined,
              errorMessage: task.errorMessage ?? undefined,
            }, true);
            return; // 拿到终态，停止轮询
          }
        }
      } catch (err) {
        consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "未知错误";
        if (isTerminalErr(msg)) {
          updateNodeData(id, { status: "failed", errorMessage: `任务查询失败：${msg}` }, true);
          return;
        }
        if (consecutiveFailures === MAX_POLL_FAILURES) {
          toast.warning("查询任务状态暂时失败（网络/隧道抖动）——云端任务不受影响，将继续自动重试；不想等可点「放弃等待」解锁节点", { duration: 8000 });
        }
        if (consecutiveFailures >= MAX_POLL_FAILURES) delay = 15000; // 退避但不放弃
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.status, payload.taskId, id, updateNodeData]);

  // #140/#143 放弃等待（云端任务提交即计费、不可撤回）：停轮询、清任务引用、节点解锁。
  // 传给 BaseNode onCancelGenerate——生成中标题栏▶直接变成可点的取消（用户指定放标题栏）。
  const abandonWait = useCallback(() => {
    updateNodeData(id, { status: "pending", taskId: undefined, externalTaskId: undefined, errorMessage: undefined }, true);
    toast.info("已放弃等待：节点已解锁。云端任务仍在生成（费用照常发生），其结果不会回填本节点", { duration: 7000 });
  }, [id, updateNodeData]);

  // #253 查询云端结果（救回入口）：被误标 failed 但 taskId 仍在（云端任务其实可能已
  // 出片）的节点，手动按 taskId 再查一次——成功则直接回填结果；仍在跑则恢复轮询等待。
  const [refreshingResult, setRefreshingResult] = useState(false);
  const refreshCloudResult = async () => {
    if (payload.taskId == null || refreshingResult) return;
    setRefreshingResult(true);
    try {
      const task = await utils.videoTasks.poll.fetch({ id: payload.taskId });
      if (task?.status === "succeeded") {
        updateNodeData(id, { status: "succeeded", resultVideoUrl: task.resultVideoUrl ?? undefined, errorMessage: undefined }, true);
        toast.success("已从云端找回生成结果");
      } else if (task?.status === "failed") {
        updateNodeData(id, { status: "failed", errorMessage: task.errorMessage ?? "云端任务失败" }, true);
        toast.error("云端任务确实失败了：" + (task.errorMessage ?? "未知原因"));
      } else {
        updateNodeData(id, { status: "processing", errorMessage: undefined }, true); // 重新进入轮询 effect
        toast.info("云端任务仍在生成，已恢复自动等待");
      }
    } catch (e) {
      toast.error("查询云端结果失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setRefreshingResult(false); }
  };

  // #143 stale processing 自愈：processing 但没有 taskId（提交中断/页面刷新丢时序）——
  // 轮询 effect 因缺 taskId 永远不跑，节点卡死在「生成中」且▶被禁用。挂载时回落 failed。
  useEffect(() => {
    if (payload.status === "processing" && payload.taskId == null && !createTaskMutation.isPending) {
      updateNodeData(id, { status: "failed", errorMessage: "生成已中断（页面刷新或提交失败），请重新提交" }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback(
    (field: keyof VideoTaskNodeData, value: unknown) => { updateNodeData(id, { [field]: value }); },
    [id, updateNodeData]
  );

  const handleParamChange = useCallback(
    (key: string, value: unknown) => {
      updateNodeData(id, { params: { ...(payload.params ?? {}), [key]: value } });
    },
    [id, updateNodeData, payload.params]
  );

  /** 按钮入口专用：已有成片时先二次确认再提交（助手/工作流等程序化触发直接调 handleSubmit）。 */
  const submitViaButton = () => {
    if (payload.status === "succeeded") { void confirmRegenerate("生成的视频").then((ok) => { if (ok) handleSubmit(); }); return; }
    handleSubmit();
  };

  const handleSubmit = () => {
    if (createTaskMutation.isPending) return;
    if (payload.status === "processing") return;
    if (!payload.prompt?.trim()) { toast.error("请填写提示词"); return; }
    // 解析最终参考图（含连线角色/场景参考图、上游图像节点兜底）后再校验——
    // 否则「连了角色节点但没手填 referenceImageUrl」会被误判为缺参考图（数字人/图生视频常见）。
    const { prompt: finalPrompt, referenceImageUrl: finalRefImage } = composeSubmissionContext();
    if (REQUIRES_REFERENCE_IMAGE.has(payload.provider) && !finalRefImage?.trim()) {
      toast.error("该模型需要参考图 URL"); return;
    }
    // Veo 3.1 首帧约束模式需要参考图
    if (payload.provider === "poyo_veo" && payload.params?.generation_type === "frame" && !finalRefImage?.trim()) {
      toast.error("Veo 3.1 首帧约束模式需要提供参考图 URL"); return;
    }
    if (finalRefImage && !isSafeMediaUrl(finalRefImage)) {
      toast.error("参考图 URL 仅支持 http(s) 或相对路径"); return;
    }
    // If parallel mode was closed while requests were in-flight, the counter may
    // be stuck at a non-zero value and would suppress this single-mode callback.
    if (!parallelMode) parallelInFlightRef.current = 0;
    // Fire-and-forget — first submit prompts the user to allow notifications
    // so the completion alert can reach them on backgrounded tabs.
    void ensureNotificationPermission();

    const refMedia = collectRefMedia(payload.provider);
    // 时长传递（修「分镜设 20 却出 6 秒」）：上游直连分镜的 duration【优先覆盖】节点上"未设 /
    // 仍是 provider 默认"的时长；仅当用户在节点上【显式设了非默认】时长才尊重节点自身。再按
    // provider 档位夹取（grok 支持 6~30）。与「运行全部」runner / ShotListPanel 批量同口径。
    const { nodes: dNodes, edges: dEdges } = useCanvasStore.getState();
    const durDef = PROVIDER_PARAMS[payload.provider]?.find((d) => d.key === "duration");
    const provDurDefault = typeof durDef?.default === "number" ? durDef.default : undefined;
    const ownDur = (payload.params as { duration?: number } | undefined)?.duration;
    const upDur = detectUpstreamStoryboardDuration(id, dEdges, dNodes);
    const wantDur = (typeof ownDur !== "number" || ownDur === provDurDefault) ? (upDur ?? ownDur) : ownDur;
    const clampedDur = clampDurationForProvider(PROVIDER_PARAMS[payload.provider], wantDur);
    const submitParams = withParamDefaults(payload.provider, clampedDur != null ? { ...(payload.params ?? {}), duration: clampedDur } : payload.params);
    // LibTV 化 2.3：主体N ↔ 参考图顺序绑定。越界（主体3 但只送 2 张图）提交前拦截，
    // 合法引用则确定性追加映射说明行（appendSubjectMapping 幂等）。
    const refUrlsForSubmit = buildRefUrls(payload.provider, finalRefImage);
    const subjectRefCount = refUrlsForSubmit?.length ?? (finalRefImage?.trim() ? 1 : 0);
    const overflow = subjectOverflow(finalPrompt, subjectRefCount);
    if (overflow.length) {
      toast.error(`提示词引用了主体${overflow.join("、主体")}，但本次只会发送 ${subjectRefCount} 张参考图（${payload.provider} 上限 ${maxRefImagesForProvider(payload.provider)} 张）。请补参考图或改用已有的主体编号。`);
      return;
    }
    const promptForSubmit = appendSubjectMapping(finalPrompt, subjectRefCount);
    const submit = () => createTaskMutation.mutate({
      projectId: data.projectId, nodeId: id,
      provider: payload.provider, prompt: promptForSubmit,
      // Only send negativePrompt for providers that actually support it
      negativePrompt: SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) ? payload.negativePrompt : undefined,
      referenceImageUrl: finalRefImage,
      referenceImageUrls: refUrlsForSubmit,
      referenceVideoUrls: refMedia.videoRefs,
      referenceAudioUrls: refMedia.audioRefs,
      // OmniHuman 指定说话主体的蒙版（用户在节点上勾选）。
      maskUrls: Array.isArray(payload.maskUrls) && payload.maskUrls.length ? (payload.maskUrls as string[]) : undefined,
      referenceMode: refModeForSubmit(),
      params: submitParams,
      // 实时点数预估随请求上报，成功/失败都计入管理员日志（仅供参考）。
      estimatedCost: costEstimateLabel(estimateVideoCost(payload.provider, submitParams)) || undefined,
      // kie video models auth via their own key (temp > assigned > house).
      ...(payload.provider.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
    });
    guard({ model: payload.provider, refImageUrl: finalRefImage }, submit);
  };

  /**
   * Pull connected character nodes and synthesize a profile-augmented prompt
   * + reference-image fallback. Shared between single-mode handleSubmit and
   * parallel-mode submit — previously parallel mode used payload.prompt
   * verbatim, silently skipping character injection.
   * The user's payload.prompt stays untouched so the textarea still reflects
   * only what they typed. Cinematography markers embedded in payload.prompt
   * are preserved verbatim since mergeCharactersIntoPrompt only prepends.
   */
  const composeSubmissionContext = useCallback((): {
    prompt: string;
    referenceImageUrl: string | undefined;
  } => {
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    // Position-ordered (topmost first) so the prompt's 角色1/角色2 numbering aligns
    // with the reference image order in buildRefUrls (both use connectedCharacters).
    // 角色 = 连线 + prompt 里的「@角色」提及，两者等价生效。
    const chars = effectiveCharacters(id, payload.prompt, allEdges, allNodes);
    // Single-ref fallback: PERSON characters only — a 场景's image is location, not identity.
    // 角色身份图优先，其次 @图像名 引用的独立图像节点（保证单图模型下单张 @图像 不丢）。
    const charRefFallback = chars.find((c) => (c.characterKind ?? "person") !== "scene" && c.referenceImageUrl?.trim())?.referenceImageUrl
      ?? mentionedMediaUrls(payload.prompt, "image", allNodes)[0];
    return {
      // prompt 组装（剥@角色/@媒体 → 注入角色 → 追加效果，cap 4000）抽到共享纯函数
      // composeCharacterEffectPrompt——与「运行全部」runner 的 video_task 分支同一事实源。
      prompt: composeCharacterEffectPrompt(id, payload.prompt ?? "", allNodes, allEdges, 4000),
      // 参考图优先级（与「运行全部」runner 的 autoDetectInputImage 同口径）：
      // 手动/推送 payload.referenceImageUrl > 直连上游图像节点(拉取兜底，i2v 首帧) > 角色/@图像。
      // 拉取兜底保证「image_gen 直连 ref-image-in 但推送未及时写入」时逐节点按钮也能取到首帧。
      referenceImageUrl: payload.referenceImageUrl?.trim() || detectUpstreamImageUrl(id, allEdges, allNodes) || charRefFallback,
    };
  }, [id, payload.prompt, payload.referenceImageUrl]);

  // Build the multi-reference list to send for a provider: the node's attached
  // reference images (or the single primary), capped to what the provider's
  // model actually consumes. Returns undefined for single-image cases so the
  // backend keeps its unchanged single-image mapping.
  const buildRefUrls = useCallback((provider: string, primary: string | undefined): string[] | undefined => {
    const all = refImages.images.map((i) => i.url).filter((u): u is string => Boolean(u));
    const { nodes: gn, edges: ge } = useCanvasStore.getState();
    // @图像名 直接引用的独立图像节点 → 显式参考图（用户主动 @ 即视为参考，始终并入）。
    const atImgs = mentionedMediaUrls(payload.prompt, "image", gn);
    let base = all;
    if (base.length === 0) {
      // No manually-attached refs → lock identity on ALL views of any connected
      // character (multi-reference); person identity refs first, then SCENE backdrop
      // refs (location/style context), falling back to the single primary ref.
      // 首帧优先（#228，与「运行全部」runner 同口径）：已有手填/推送主图或上游首帧图时，
      // 角色参考不再并入多图列表——此前这里会把角色图切成主体参考、静默丢弃用户的首帧
      // 构图，且与批量运行结果分叉；一致性由首帧画面继承（首帧由生图节点吃定妆照生成）。
      const framePrimary = payload.referenceImageUrl?.trim() || detectUpstreamImageUrl(id, ge, gn);
      const charRefs = framePrimary ? [] : [...effectiveCharacterRefImages(id, payload.prompt, ge, gn), ...effectiveSceneRefImages(id, payload.prompt, ge, gn)];
      base = charRefs.length ? charRefs : (primary ? [primary] : []);
    }
    base = Array.from(new Set([...base, ...atImgs]));
    const max = maxRefImagesForProvider(provider);
    return max > 1 && base.length > 1 ? base.slice(0, max) : undefined;
  }, [refImages.images, id, payload.prompt, payload.referenceImageUrl]);

  // Reference (subject) mode: when the references come from connected CHARACTERS
  // (identity), they are SUBJECTS, not 首尾帧 — so on multi-reference-capable models
  // (seedance-2 / kling-o3 / happy-horse) they should route to reference_image_urls
  // instead of the start/end-frame image_urls path. Only when the user hasn't manually
  // attached frame references (those keep the default frame mapping). Server falls back
  // gracefully for models without a reference mode, so this is safe to always send.
  const refModeForSubmit = useCallback((): "reference" | undefined => {
    if (refImages.images.length > 0) return undefined; // manual refs → keep frame default
    const { nodes: gn, edges: ge } = useCanvasStore.getState();
    // 首帧优先（#228）：有手填/推送主图或上游首帧图 → 保持首帧 i2v 路径，不切主体参考模式
    //（与 buildRefUrls / runner 同口径，否则首帧被服务端 reference 分支忽略）。
    if (payload.referenceImageUrl?.trim() || detectUpstreamImageUrl(id, ge, gn)) return undefined;
    // Person identity OR scene backdrop refs are context, not 首尾帧 → reference mode.
    const hasCharRefs = effectiveCharacterRefImages(id, payload.prompt, ge, gn).length > 0 || effectiveSceneRefImages(id, payload.prompt, ge, gn).length > 0;
    return hasCharRefs ? "reference" : undefined;
  }, [refImages.images, id, payload.prompt, payload.referenceImageUrl]);

  // Multi-modal references: gather video/audio URLs for models that accept them, from
  // ALL participating sources — upstream 来源（video_task/comfyui_video/audio/asset 视频音频）
  // + 角色携带（@视频/@音频 或连线角色），de-duped。镜像吸附栏「参与本节点工作」的口径。
  const collectRefMedia = useCallback((provider: string): { videoRefs?: string[]; audioRefs?: string[] } => {
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    return collectVideoRefMedia(id, payload.prompt, provider, allEdges, allNodes);
  }, [id, payload.prompt]);

  // [CHARGED] / [CHARGED?] are server-side markers that indicate the upstream
  // provider has (almost certainly / possibly) already billed for this task,
  // even though our code path observed a failure. Resetting and resubmitting
  // would create a brand-new paid request — we surface a confirm() prompt so
  // the user has to acknowledge that risk explicitly. Without this gate, the
  // most natural UX (see failure → click retry) silently doubled their cost.
  const errMsg = payload.errorMessage ?? "";
  const isCharged = errMsg.startsWith("[CHARGED]");
  const isMaybeCharged = errMsg.startsWith("[CHARGED?]");
  const isPossiblyBilled = isCharged || isMaybeCharged;

  const handleReset = () => {
    if (isPossiblyBilled) {
      const msg = isCharged
        ? "上游确认本任务已生成并已扣点数。继续重置会清除当前结果，重新提交将再次扣费——除非你已确认结果丢失或不可用。\n\n确认重置？"
        : "本任务的提交结果未确认，上游可能已经接收到请求并扣费。点击「确定」会重置任务并允许重新提交——若上游确实已扣费，会再次扣费。\n\n确认重置？";
      if (typeof window !== "undefined" && !window.confirm(msg)) return;
    }
    if (payload.taskId) {
      resetTaskMutation.mutate({ id: payload.taskId });
    } else {
      updateNodeData(id, {
        status: "pending",
        taskId: undefined,
        externalTaskId: undefined,
        resultVideoUrl: undefined,
        errorMessage: undefined,
      });
    }
  };

  const status = STATUS[payload.status] ?? STATUS.pending;
  const StatusIcon = status.icon;
  // 只在生成中锁定输入。succeeded 不再锁——生成成功后应可换模型/改词直接重新生成
  //（与生图节点同口径；此前成功即锁死模型选择器，用户须先重置才能换模型，实报不便）。
  const isLocked = payload.status === "processing";
  const isResettable = payload.status === "succeeded" || payload.status === "failed";

  const onFocusAccent = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "oklch(0.62 0.20 25 / 0.6)"; };
  const onFocusMid    = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = "var(--c-t4)"; };
  const onBlurDefault = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  // Backend serializes multi-shot (Wan 2.6 multi_shots=true) results as
  // newline-joined URLs inside the existing text column. Split here so the
  // UI can render a grid of all generated clips instead of choking on the
  // joined string when fed to <video src=...>.
  const allResultUrls: string[] = (() => {
    const raw = payload.resultVideoUrl;
    if (!raw) return [];
    if (!raw.includes("\n")) return [raw];
    return raw.split("\n").map((u) => u.trim()).filter((u) => u.length > 0);
  })();
  const safeResultUrls = allResultUrls.filter(isSafeMediaUrl);
  // Hero / primary video — first URL (used for legacy single-video UI paths
  // like heroMedia and the download link).
  const primaryUrl: string | undefined = safeResultUrls[0];
  const videoSrc = primaryUrl ? mediaFetchUrl(primaryUrl) : undefined;
  const hasMultiResults = safeResultUrls.length > 1;

  // Get param defs for current provider
  const paramDefs = PROVIDER_PARAMS[payload.provider] ?? [];
  const params = payload.params ?? {};
  const presets = PROVIDER_PRESETS[payload.provider] ?? [];

  // 实时点数预估：模型或参数（时长/分辨率/音频等）一变即重算，显示在提交按钮上。
  const costLabel = useMemo(
    () => costEstimateLabel(estimateVideoCost(payload.provider, withParamDefaults(payload.provider, payload.params))),
    [payload.provider, payload.params],
  );

  // LibTV 化 2.2：就地输入条的参数摘要（如「16:9 · 720p · 5秒」）。挑最常用的三类
  // （比例 / 分辨率档 / 时长）；provider 没有该参数就跳过，全无则显示「参数」。
  const inlineParamSummary = useMemo(() => {
    const defs = PROVIDER_PARAMS[payload.provider] ?? [];
    const p = payload.params ?? {};
    const get = (k: string) => p[k] ?? defs.find((d) => d.key === k)?.default;
    const parts: string[] = [];
    const ar = get("aspect_ratio");
    if (ar !== undefined && ar !== "") parts.push(String(ar));
    const res = get("resolution") ?? get("quality");
    if (res !== undefined && res !== "") parts.push(String(res));
    const dur = get("duration");
    if (dur !== undefined && dur !== "") parts.push(`${dur}秒`);
    return parts.length ? parts.join(" · ") : "参数";
  }, [payload.provider, payload.params]);

  // ── Custom presets (localStorage-backed) ────────────────────────────────
  const [customPresets, setCustomPresets] = useState<CustomVideoPreset[]>([]);
  useEffect(() => { setCustomPresets(listCustomPresets(payload.provider)); }, [payload.provider]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const handleSavePreset = () => {
    const created = saveCustomPreset(
      payload.provider,
      newPresetLabel,
      params,
      SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) ? payload.negativePrompt : undefined,
    );
    if (!created) { toast.error("预设名为空或已超数量上限"); return; }
    setCustomPresets((prev) => [...prev, created]);
    setNewPresetLabel("");
    setSavingPreset(false);
    toast.success(`已保存预设「${created.label}」`);
  };
  const handleDeletePreset = (presetId: string, label: string) => {
    deleteCustomPreset(payload.provider, presetId);
    setCustomPresets((prev) => prev.filter((p) => p.id !== presetId));
    toast.success(`已删除预设「${label}」`);
  };

  // ── Cinematography template picker ──────────────────────────────────────
  // The picker is a modal opened from the params panel header. Applying a
  // template (a) injects/replaces the camera-marker block in prompt and
  // (b) sets provider-native camera_motion params when supported.
  const [pickerOpen, setPickerOpen] = useState(false);
  const activeCameraTemplateId = detectActiveCinematography(payload.prompt ?? "");
  const activeCameraTemplate = activeCameraTemplateId ? getTemplateById(activeCameraTemplateId) : undefined;
  const handlePickCinematography = useCallback(
    (template: ReturnType<typeof getTemplateById> & object) => {
      if (!template) return;
      const newPrompt = applyCinematographyToPrompt(payload.prompt ?? "", template);
      // CRITICAL: clear every camera_motion_* field FIRST, then layer the new
      // template's patch on top. Without this, switching from a template that
      // sets {type, speed} to one that only sets {type} leaves the previous
      // speed value lingering — Higgsfield DoP keeps generating with the wrong
      // motion. Same trap when the new template has no native mapping at all.
      const providerPatch = applyCinematographyParams(payload.provider, template);
      updateNodeData(id, {
        prompt: newPrompt,
        params: {
          ...(payload.params ?? {}),
          ...clearCinematographyParamsPatch(),
          ...providerPatch,
        },
      });
      toast.success(`已应用运镜：${template.label}`);
    },
    [id, updateNodeData, payload.prompt, payload.params, payload.provider],
  );
  const handleClearCinematography = useCallback(() => {
    const newPrompt = clearCinematographyFromPrompt(payload.prompt ?? "");
    // Also wipe params — otherwise the marker disappears from the prompt but
    // Higgsfield DoP keeps running with the previously-applied
    // camera_motion_type / speed, producing inconsistent state.
    updateNodeData(id, {
      prompt: newPrompt,
      params: { ...(payload.params ?? {}), ...clearCinematographyParamsPatch() },
    });
    toast.success("已清除运镜模板");
  }, [id, updateNodeData, payload.prompt, payload.params]);

  // ── Browser notification on task completion ─────────────────────────────
  const prevStatusRef = useRef(payload.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = payload.status;
    if (prev !== "processing") return;
    if (payload.status !== "succeeded" && payload.status !== "failed") return;
    const providerLabel = PROVIDERS.find((p) => p.value === payload.provider)?.label ?? payload.provider;
    const promptSnippet = (payload.prompt ?? "").slice(0, 60);
    showCompletionNotification({
      title: payload.status === "succeeded" ? `视频生成完成 · ${providerLabel}` : `视频生成失败 · ${providerLabel}`,
      body: promptSnippet || undefined,
      tag: `video-task-${id}`,
    });
  }, [payload.status, payload.provider, payload.prompt, id]);

  // 绿点指示：结果视频是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const videoStoredInMinio = isOwnStorageUrl(primaryUrl);

  // ── LibTV 化：摄像机参数选择器（输入条 Camera chip 打开）──
  const [camRigOpen, setCamRigOpen] = useState(false);
  // LibTV 三段式输入条：顶部「＋参考」的隐藏文件选择器。
  const inlineRefFileRef = useRef<HTMLInputElement>(null);

  // ── LibTV 画布拾取（＋参考=从画布选参考 / 标记=元素选择模式）──
  // 双击参考缩略图 → 聚焦至来源节点。
  const focusRefSource = useFocusRefSource(id);
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
  useEffect(() => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ forNodeId: string; kind: string; url: string }>).detail;
      if (d?.forNodeId !== id) return;
      if (d.kind === "ref") {
        // 同 URL 去重追加——重复点选同一产物时明确提示，避免误以为「覆盖/加不上」
        if (!refImages.addUrls([d.url], "url")) toast.info("该图已在参考列表中，未重复添加");
        return;
      }
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

  // ── LibTV 化：快速剪辑条（BaseNode 操作条「剪辑」按钮派发 canvas:quick-trim 打开）──
  const [quickTrimOpen, setQuickTrimOpen] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail?.nodeId === id) setQuickTrimOpen(true); };
    window.addEventListener("canvas:quick-trim", h);
    return () => window.removeEventListener("canvas:quick-trim", h);
  }, [id]);

  // ── LibTV 化 B：空视频节点工作流预设 ────────────────────────────────────────
  // 「空节点」= 无提示词、无结果、无参考图、无上游连线 → 配置区顶部给出一键搭建入口：
  // 首帧生成视频（建 1 个首帧图节点连入）/ 首尾帧生成视频（建首帧+尾帧两个图节点连入），
  // 建好后整体成组并命名「预设 - ×××」，示例提示词直接可跑。全部复用现有 store action。
  const hasUpstream = useCanvasStore((s) => s.edges.some((e) => e.target === id));
  const isEmptyNode = payload.status !== "processing" && payload.status !== "succeeded"
    && !payload.prompt?.trim() && !payload.referenceImageUrl?.trim() && refImages.images.length === 0 && !hasUpstream;
  const buildWorkflowPreset = useCallback((kind: "first" | "firstlast") => {
    const st = useCanvasStore.getState();
    const me = st.nodes.find((n) => n.id === id);
    if (!me) return;
    const baseX = me.position.x - 480;
    const created: string[] = [];
    if (kind === "first") {
      const img = st.addNode("image_gen", { x: baseX, y: me.position.y + 40 });
      st.updateNodeTitle(img.id, "首帧");
      st.onConnect({ source: img.id, target: id, sourceHandle: null, targetHandle: "ref-image-in" });
      st.updateNodeData(id, { prompt: "以当前图为首帧生成视频。" }, true);
      created.push(img.id);
    } else {
      const img1 = st.addNode("image_gen", { x: baseX, y: me.position.y - 40 });
      const img2 = st.addNode("image_gen", { x: baseX, y: me.position.y + 300 });
      st.updateNodeTitle(img1.id, "首帧");
      st.updateNodeTitle(img2.id, "尾帧");
      st.onConnect({ source: img1.id, target: id, sourceHandle: null, targetHandle: "ref-image-in" });
      st.onConnect({ source: img2.id, target: id, sourceHandle: null, targetHandle: "ref-image-in" });
      st.updateNodeData(id, { prompt: "以图一为首帧、图二为尾帧生成视频。" }, true);
      created.push(img1.id, img2.id);
    }
    const label = kind === "first" ? "预设 - 首帧生成视频" : "预设 - 首尾帧生成视频";
    st.groupSelected([...created, id], label);
    toast.success(`已按「${label.replace("预设 - ", "")}」搭好工作流——先生成首${kind === "firstlast" ? "/尾" : ""}帧图，再回本节点生成视频`);
  }, [id]);

  // Only treat a finished result video as a "hero" preview — a bare reference
  // image is an INPUT, not a result, so the node must stay expanded (showing its
  // controls) until it has actually produced a video.
  // 创意模式展开「高级」时连 hero 一并收起——hero 常驻会占满节点，把展开的配置区
  // 顶出可视范围，点「高级」看起来毫无反应（用户实报）；收起高级即恢复 hero。
  const heroMedia = payload.status === "succeeded" && videoSrc && !(isCreativeMode && advancedOpen) ? (
    <div className="relative" style={{ width: "100%" }}>
      <WatermarkedVideo
        block
        src={videoSrc}
        controls
        className="w-full"
        preload="metadata"
        style={{ display: "block" }}
      />
      {videoStoredInMinio && <MinioStorageBadge />}
    </div>
  ) : payload.referenceImageUrl ? (
    // 无视频结果但有参考图（图生视频首帧/参考）→ 收缩时显示参考图，
    // 否则工作室收缩只剩标题栏、参考图看不见。
    <RefHeroPreview url={payload.referenceImageUrl} />
  ) : null;

  return (<>
    <BaseNode id={id} selected={selected} nodeType="video_task" title={data.title} minHeight={260} heroMedia={heroMedia}
      onRun={handleSubmit} running={createTaskMutation.isPending || payload.status === "processing"} canRun={!!payload.prompt?.trim()} hasResult={payload.status === "succeeded"}
      onCancelGenerate={payload.status === "processing" ? abandonWait : undefined}
      onAssetImageDrop={(urls) => refImages.addUrls(urls, "drop")}
      onHeaderHoverChange={docks.onHeaderHoverChange}
      extraHandles={
        <Handle
          type="target"
          position={Position.Left}
          id="ref-image-in"
          style={{ ...handleStyle("oklch(0.68 0.22 285)", handlesActive, "square", connectState.target), top: "25%", left: -7 }}
          title="参考图输入 ← 连接图像生成节点"
        />
      }
      leftDock={
        <>
          <ReferenceImageStrip
            images={stripImages}
            open={stripOpen}
            accent={accentColor}
            onClose={() => setStripOpen(false)}
            onRemove={refImages.removeId}
            onMove={refImages.moveId}
            onInsertUrls={(urls, index) => refImages.insertUrls(urls, index, "drop")}
            onDropFiles={(files, index) => void uploadRefFiles(files, index)}
            onZoom={(i) => { const u = stripImages[i]?.url; if (u) openNodeImage(u); }}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinRef}
            onInsertSubject={insertSubjectToken}
          />
          <PromptDock
            open={docks.promptOpen}
            text={finalPromptDisplay}
            negText={SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) ? payload.negativePrompt : undefined}
            source={hasCharInject ? "含角色" : undefined}
            accent={accentColor}
            onClose={() => docks.setPromptOpen(false)}
            onHoverChange={docks.onDockHoverChange}
            onPin={docks.pinPrompt}
          />
        </>
      }>
      {/* 创意模式收起态（未展开高级）：body 内容全被隐藏，padding/gap 一并归零，
          否则点击带结果节点后预览下会剩一块空 padding 灰条（空节点预设卡场景保留 padding）。 */}
      <div ref={bodyScrollRef} className="flex flex-col h-full overflow-auto" style={isCreativeMode && !advancedOpen && !isEmptyNode ? { padding: 0, gap: 0 } : { padding: 14, gap: 12 }}>

        {/* ── Status pill ──
            生成完成后不再显示绿色状态条（结果视频本身即状态，全模式）；创意收起态整条隐藏
            （进度/失败已有 BaseNode 标题栏常驻条）。 */}
        {payload.status !== "succeeded" && !(isCreativeMode && !advancedOpen) && (
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg flex-shrink-0"
          style={{ background: status.bg, borderWidth: 1, borderStyle: "solid", borderColor: status.borderColor }}
        >
          <StatusIcon
            className={`w-3.5 h-3.5 flex-shrink-0 ${(status as { spin?: boolean }).spin ? "animate-spin" : ""}`}
            style={{ color: status.accent }}
          />
          <span className="text-xs font-medium" style={{ color: status.accent }}>{status.label}</span>
          {payload.status === "processing" && (
            <span className="ml-auto text-[10px] animate-pulse" style={{ color: "var(--c-t3)" }}>轮询中...</span>
          )}
        </div>
        )}

        {/* ── 空节点工作流预设（LibTV）：一键搭建 首帧 / 首尾帧 生成视频 ── */}
        {isEmptyNode && !isLocked && (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t4)", letterSpacing: "0.04em" }}>工作流预设 · 一键搭建</div>
            <div className="flex gap-2">
              {([
                { kind: "first" as const, label: "首帧生成视频", desc: "首帧图 → 本节点" },
                { kind: "firstlast" as const, label: "首尾帧生成视频", desc: "首帧+尾帧 → 本节点" },
              ]).map(({ kind, label, desc }) => (
                <button
                  key={kind}
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); buildWorkflowPreset(kind); }}
                  title={`${desc}（自动建图节点、连线、填示例提示词并成组）`}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", textAlign: "left",
                    borderRadius: 9, border: "1px solid var(--c-bd2)", background: "var(--c-surface)",
                    color: "var(--c-t2)", cursor: "pointer", transition: "border-color 120ms ease, background 120ms ease",
                  }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.borderColor = "oklch(0.7 0.18 25 / 0.55)"; (ev.currentTarget as HTMLElement).style.background = "oklch(0.7 0.18 25 / 0.08)"; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)"; (ev.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
                >
                  <Film size={13} style={{ color: "oklch(0.7 0.18 25)", flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 11.5, fontWeight: 600 }}>{label}</span>
                    <span style={{ display: "block", fontSize: 9.5, color: "var(--c-t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Result video(s) ──
            Single result: full-width player.
            Multi-shot result (Wan 2.6 multi_shots=true → 3 clips):
            2-column grid showing all clips; each gets its own download link.
            Hidden inside the studio floating panel — the card hero already shows it. */}
        <HideWhenStudioFloating>
        {/* 创意模式展开「高级」时暂时收起结果视频——否则成片占满节点，展开的配置区
            压在节点内部滚动区深处，点「高级」看起来毫无反应（用户实报）。收起高级即恢复。 */}
        {payload.status === "succeeded" && videoSrc && !(isCreativeMode && advancedOpen) && (
          <div className="flex-shrink-0">
            {hasMultiResults && (
              <div style={{ fontSize: 10, color: "var(--c-t3)", marginBottom: 4 }}>
                生成了 {safeResultUrls.length} 段视频（多镜头模式）
              </div>
            )}
            {hasMultiResults ? (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                {safeResultUrls.map((u, idx) => (
                  <ShotItem key={u} u={u} idx={idx} />
                ))}
              </div>
            ) : (
              <>
                <div className="relative rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: STATUS.succeeded.borderColor }}>
                  {videoStoredInMinio && <MinioStorageBadge />}
                  <WatermarkedVideo
                    block
                    key={videoSrc}
                    src={videoSrc}
                    controls
                    className="w-full nodrag"
                    style={{ maxHeight: 140, display: "block" }}
                    preload="metadata"
                  />
                </div>
                {/* Download button (primary URL — works for single-shot results) */}
                {primaryUrl && (
                  <a
                    href={mediaFetchUrl(primaryUrl, true)}
                    onClick={onDownloadMedia(primaryUrl, "视频.mp4")}
                    className="nodrag mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
                    style={{
                      background: "oklch(0.72 0.18 155 / 0.10)",
                      borderWidth: 1, borderStyle: "solid",
                      borderColor: "oklch(0.72 0.18 155 / 0.30)",
                      color: "oklch(0.72 0.18 155)",
                      textDecoration: "none",
                      display: "flex",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.18)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.10)"; }}
                  >
                    <Download className="w-3 h-3" />
                    下载视频
                  </a>
                )}
              </>
            )}
          </div>
        )}
        </HideWhenStudioFloating>

        {/* ── Error ──
            When errorMessage carries the server-side [CHARGED] / [CHARGED?]
            marker we render a stronger amber banner with an explicit "积分已扣"
            badge — same coloring as a financial warning, distinguishable
            from the standard red "task failed" banner. */}
        {payload.status === "failed" && payload.errorMessage && (
          <div
            className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0"
            style={{
              background: isPossiblyBilled ? "oklch(0.65 0.18 60 / 0.08)" : STATUS.failed.bg,
              borderWidth: 1, borderStyle: "solid",
              borderColor: isPossiblyBilled ? "oklch(0.65 0.18 60 / 0.4)" : STATUS.failed.borderColor,
            }}
          >
            <AlertCircle
              className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
              style={{ color: isPossiblyBilled ? "oklch(0.72 0.18 60)" : STATUS.failed.accent }}
            />
            <div className="flex flex-col gap-1" style={{ minWidth: 0, flex: 1 }}>
              {isPossiblyBilled && (
                <span style={{
                  alignSelf: "flex-start",
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
                  padding: "1px 6px", borderRadius: 99,
                  background: "oklch(0.72 0.18 60 / 0.15)",
                  border: "1px solid oklch(0.72 0.18 60 / 0.4)",
                  color: "oklch(0.78 0.18 60)",
                }}>
                  {isCharged ? "⚠ 积分已扣" : "⚠ 积分可能已扣"}
                </span>
              )}
              <p className="text-[11px] leading-relaxed" style={{
                color: isPossiblyBilled ? "oklch(0.78 0.18 60)" : STATUS.failed.accent,
                wordBreak: "break-word", overflowWrap: "anywhere",
              }}>
                {payload.errorMessage}
              </p>
            </div>
          </div>
        )}

        {/* ── Input area (collapsed when not selected) ──
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

        {/* ── Parallel compare mode toggle ── */}
        <div className="flex items-center justify-between px-3.5 pt-2 pb-1 flex-shrink-0" style={{ marginLeft: -14, marginRight: -14 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
            {parallelMode ? "并行对比模式" : "单模型模式"}
          </span>
          <button
            onClick={() => {
              // Stop polls, reset the in-flight counter (so a stranded count from in-flight mutates
              // won't suppress future single-mode onSuccess writes), bump the generation token
              // (so stale per-mutate callbacks no-op), and clear state
              parallelPollRefs.current.forEach(clearInterval);
              parallelPollRefs.current.clear();
              parallelInFlightRef.current = 0;
              parallelGenRef.current += 1;
              setParallelMode((v) => !v);
              setParallelProviders([]);
              setParallelResults({});
            }}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all"
            style={{
              background: parallelMode ? "oklch(0.68 0.22 285 / 0.15)" : "var(--c-surface)",
              border: `1px solid ${parallelMode ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
              color: parallelMode ? "oklch(0.68 0.22 285)" : "var(--c-t4)",
              cursor: "pointer",
            }}
          >
            <Layers style={{ width: 10, height: 10 }} />
            {parallelMode ? "关闭" : "并行对比"}
          </button>
        </div>

        {parallelMode && (
          <div className="flex flex-col gap-2 flex-shrink-0">
            <p style={{ fontSize: 10, color: "var(--c-t4)" }}>选择最多 3 个模型并行生成对比：</p>
            {/* 并行模式各 provider 参数互不相同，统一用各自默认参数（不沿用上方调过的 params）。 */}
            <p style={{ fontSize: 9.5, color: "var(--c-t4)", opacity: 0.85 }}>注：并行模式使用各模型的默认参数（不套用上方手动调整的时长/分辨率等）。</p>
            <div className="flex flex-col gap-1">
              {PROVIDERS.filter(p => p.value !== "mock").map((p) => {
                const checked = parallelProviders.includes(p.value);
                return (
                  <button
                    key={p.value}
                    onClick={() => {
                      if (checked) {
                        setParallelProviders(prev => prev.filter(v => v !== p.value));
                      } else if (parallelProviders.length < 3) {
                        setParallelProviders(prev => [...prev, p.value]);
                      }
                    }}
                    className="nodrag flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all text-left"
                    style={{
                      background: checked ? "oklch(0.68 0.22 285 / 0.10)" : "var(--c-input)",
                      border: `1px solid ${checked ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                      color: checked ? "oklch(0.75 0.15 285)" : "var(--c-t2)",
                      cursor: (!checked && parallelProviders.length >= 3) ? "not-allowed" : "pointer",
                      opacity: (!checked && parallelProviders.length >= 3) ? 0.5 : 1,
                    }}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      background: checked ? "oklch(0.68 0.22 285)" : "transparent",
                      border: `1.5px solid ${checked ? "oklch(0.68 0.22 285)" : "var(--c-bd3)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {checked && <span style={{ color: "white", fontSize: 9, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span>{p.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: platformBadge(p.group).fg, background: platformBadge(p.group).bg, borderRadius: 99, padding: "1px 5px", fontWeight: 700 }}>{p.group}</span>
                    {parallelResults[p.value] && (
                      <span style={{
                        fontSize: 9, borderRadius: 99, padding: "1px 5px",
                        background: parallelResults[p.value].status === "done" ? "oklch(0.72 0.18 155 / 0.15)" : "oklch(0.68 0.22 285 / 0.12)",
                        color: parallelResults[p.value].status === "done" ? "oklch(0.65 0.18 155)" : "oklch(0.68 0.22 285)",
                      }}>
                        {parallelResults[p.value].status === "done" ? "完成" : parallelResults[p.value].status === "failed" ? "失败" : "生成中"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {parallelProviders.length > 0 && (
              <button
                onClick={() => {
                  if (createTaskMutation.isPending) return;
                  if (!(payload.prompt?.trim())) { toast.error("请先填写提示词"); return; }
                  // Compose ONCE so all parallel providers see the same
                  // character-augmented prompt. Previously this branch sent
                  // payload.prompt verbatim, silently skipping connected
                  // character nodes — parallel mode produced different prompts
                  // than single mode for the same node configuration.
                  const submission = composeSubmissionContext();
                  // Block submit if any selected parallel provider requires a reference image
                  // but none is resolvable. Check the COMPOSED image (含连线角色/上游图像兜底),
                  // not just payload.referenceImageUrl——否则连了角色却被误判缺图。
                  if (!submission.referenceImageUrl?.trim() && parallelProviders.some((p) => REQUIRES_REFERENCE_IMAGE.has(p))) {
                    toast.error("已选择的图生视频模型需要参考图 URL"); return;
                  }
                  // Representative provider for the reachability warning: pick any
                  // URL-only (poyo_/hf_) provider so the guard fires if ANY of the
                  // parallel targets can't fetch the reference image.
                  const warnProvider = parallelProviders.find(providerNeedsPublicMedia) ?? parallelProviders[0];
                  const runBatch = () => {
                  toast.info(`正在并行提交 ${parallelProviders.length} 个任务...`);
                  // Capture generation token for this batch — per-mutate callbacks compare against
                  // the latest token and no-op if the user has closed parallel mode since
                  const gen = parallelGenRef.current;
                  // Increment counter ONCE per mutate call so global onSuccess/onError can correctly suppress payload writes
                  parallelInFlightRef.current += parallelProviders.length;
                  parallelProviders.forEach(provider => {
                    setParallelResults(prev => ({ ...prev, [provider]: { status: "processing" } }));
                    // 主体N 映射按各 provider 实际发送的参考图张数分别追加（多图上限不同）。
                    const pRefUrls = buildRefUrls(provider, submission.referenceImageUrl);
                    createTaskMutation.mutate(
                      // Don't share the node's params bag across providers (they diverge),
                      // but each provider still needs its OWN required-field defaults
                      // (resolution/aspect_ratio/duration/...) since the backend no longer
                      // hard-defaults them — so pass that provider's ParamDef defaults.
                      { nodeId: id, projectId: data.projectId, provider, prompt: appendSubjectMapping(submission.prompt, pRefUrls?.length ?? (submission.referenceImageUrl?.trim() ? 1 : 0)), negativePrompt: SUPPORTS_NEGATIVE_PROMPT.has(provider) ? payload.negativePrompt : undefined, referenceImageUrl: submission.referenceImageUrl, referenceImageUrls: pRefUrls, referenceVideoUrls: collectRefMedia(provider).videoRefs, referenceAudioUrls: collectRefMedia(provider).audioRefs, referenceMode: refModeForSubmit(), params: withParamDefaults(provider, {}), estimatedCost: costEstimateLabel(estimateVideoCost(provider, withParamDefaults(provider, {}))) || undefined, ...(provider.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}) },
                      {
                        onSuccess: (result) => {
                          if (parallelGenRef.current !== gen) return; // stale — user closed parallel mode
                          setParallelResults(prev => ({ ...prev, [provider]: { status: "processing", taskId: result.id } }));
                        },
                        onError: (err) => {
                          if (parallelGenRef.current !== gen) return; // stale — user closed parallel mode
                          setParallelResults(prev => ({ ...prev, [provider]: { status: "failed" } }));
                          toast.error(`${provider} 失败: ${err.message}`);
                        },
                      }
                    );
                  });
                  };
                  guard(
                    { model: warnProvider, refImageUrl: submission.referenceImageUrl },
                    runBatch,
                  );
                }}
                className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "oklch(0.68 0.22 285 / 0.12)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  color: "oklch(0.72 0.18 285)",
                  cursor: "pointer",
                }}
              >
                <Play style={{ width: 11, height: 11 }} />
                并行生成 {parallelProviders.length} 个模型
              </button>
            )}
            {/* Parallel results grid */}
            {Object.keys(parallelResults).length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>对比结果</span>
                <div className="flex gap-1.5">
                  {Object.entries(parallelResults).map(([provider, result]) => (
                    <div
                      key={provider}
                      className="flex-1 rounded-lg overflow-hidden"
                      style={{
                        minWidth: 0,
                        background: "var(--c-input)",
                        border: `1px solid ${result.status === "done" ? "oklch(0.65 0.18 155 / 0.35)" : "var(--c-bd2)"}`,
                      }}
                    >
                      {result.status === "done" && isSafeMediaUrl(result.videoUrl) ? (
                        <WatermarkedVideo
                          block
                          src={mediaFetchUrl(result.videoUrl!)}
                          controls
                          className="w-full nodrag"
                          style={{ maxHeight: 80, display: "block" }}
                        />
                      ) : (
                        <div className="flex items-center justify-center" style={{ height: 60 }}>
                          {result.status === "processing" ? (
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "oklch(0.68 0.22 285)" }} />
                          ) : (
                            <XCircle className="w-4 h-4" style={{ color: "oklch(0.62 0.20 25)" }} />
                          )}
                        </div>
                      )}
                      <div className="px-1.5 py-1">
                        <p style={{ fontSize: 9, color: "var(--c-t3)", textAlign: "center" }}>
                          {PROVIDERS.find(p => p.value === provider)?.label ?? provider}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Provider ── */}
        <div style={{ marginTop: 4 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>视频模型</label>
            {/* Cost is shown per-model inside the ModelPicker (costLabel) — no
                separate badge here to avoid two divergent price sources. */}
          </div>
          {/* Legacy migration: some historical providers (hf_dop_preview / hf_kling_* /
              hf_seedance_*) were removed when Higgsfield video API was rewritten. If a
              stored node still has one of those values, render a deprecation notice and
              keep an inert option in the dropdown so the <select> isn't blank. */}
          {!PROVIDERS.some((p) => p.value === payload.provider) && (
            <div style={{
              marginBottom: 6, padding: "6px 10px", fontSize: 11, lineHeight: 1.5,
              color: "oklch(0.75 0.18 25)", background: "oklch(0.62 0.20 25 / 0.10)",
              border: "1px solid oklch(0.62 0.20 25 / 0.30)", borderRadius: 6,
            }}>
              ⚠️ 当前模型 <code style={{ fontFamily: "monospace" }}>{payload.provider}</code> 已下线（Higgsfield 公共 API 不再支持）。请重新选择。
            </div>
          )}
          <ModelPicker
            value={payload.provider}
            disabled={isLocked}
            accent="oklch(0.7 0.18 25)"
            options={PROVIDER_PICKER_OPTIONS}
            onChange={(v) => updateNodeData(id, videoProviderChangePatch(v as VideoProvider))}
          />
        </div>
        {/* 同步模型与参数到同类视频任务节点（弹窗勾选） */}
        <button
          onClick={() => setShowSyncDlg(true)}
          title="把当前模型与全部参数同步到所选视频任务节点（弹窗勾选，默认同工作流）"
          className="nodrag flex items-center justify-center gap-1 rounded-lg text-[10.5px] py-1 transition-all"
          style={{ background: "oklch(0.7 0.18 25 / 0.08)", border: "1px dashed oklch(0.7 0.18 25 / 0.4)", color: "oklch(0.74 0.16 25)", cursor: "pointer" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.7 0.18 25 / 0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.7 0.18 25 / 0.08)"; }}
        >
          <Layers className="w-3 h-3" /> 同步模型与参数到其它视频节点
        </button>
        {showSyncDlg && (
          <SyncNodesDialog
            sourceId={id}
            nodeType="video_task"
            typeLabel="视频任务"
            patch={{ provider: payload.provider, negativePrompt: payload.negativePrompt, params: payload.params }}
            onClose={() => setShowSyncDlg(false)}
          />
        )}

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <NodeTextArea
            placeholder="视频生成提示词..."
            value={payload.prompt ?? ""}
            onValueChange={(v) => handleChange("prompt", v)}
            rows={3}
            disabled={isLocked}
            className="nodrag nowheel"
            style={{ ...fieldStyle, resize: "none", lineHeight: 1.65, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusAccent}
            onBlur={onBlurDefault}
          />
        </div>

        {/* ── Negative prompt (for models that support it) ── */}
        {SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) && (
          <div>
            <label style={labelStyle}>反向提示词（可选）</label>
            <NodeInput
              placeholder="blurry, low quality..."
              value={payload.negativePrompt ?? ""}
              onValueChange={(v) => handleChange("negativePrompt", v)}
              disabled={isLocked}
              className="nodrag"
              style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
              onFocus={onFocusMid}
              onBlur={onBlurDefault}
            />
          </div>
        )}

        {/* ── Reference images (multi; 首图 = start frame) ── */}
        <div
          onDragOver={(e) => { if (!isLocked && (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list"))) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            if (isLocked) return;
            const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (files.length) { e.preventDefault(); void uploadRefFiles(files, refImages.images.length); return; }
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
            参考图（可选）
            {refImages.images.length > 0 && (() => {
              const max = maxRefImagesForProvider(payload.provider);
              const n = refImages.images.length;
              const hint = max === 0
                ? "该模型为文生视频，参考图将被忽略"
                : max === 1
                  ? "仅首图用于生成"
                  : n <= max
                    ? `全部 ${n} 张用于生成`
                    : `前 ${max} 张用于生成`;
              return <span style={{ fontSize: 10, color: "var(--c-t4)" }}>· {n} 张（{hint}）</span>;
            })()}
            <RefImageReachabilityBadge
              model={parallelMode ? (parallelProviders.find(providerNeedsPublicMedia) ?? parallelProviders[0]) : payload.provider}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
            />
            <RefImageSwitchButton
              nodeId={id}
              model={parallelMode ? (parallelProviders.find(providerNeedsPublicMedia) ?? parallelProviders[0]) : payload.provider}
              refImageUrl={payload.referenceImageUrl}
              reachable={reachable}
              onSwitch={(u) => handleChange("referenceImageUrl", u)}
            />
          </label>

          {charRefPlan && (
            <div style={{ fontSize: 10, lineHeight: 1.5, marginTop: 2, color: charRefPlan.mode === "none" ? "var(--c-t4)" : "oklch(0.70 0.13 150)" }}>
              ⓘ {charRefPlan.note}
            </div>
          )}

          {refImages.images.length > 0 && (
            <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {refImages.images.map((img, i) => (
                <div key={img.id} className="relative rounded-lg overflow-hidden flex-shrink-0" style={{ width: 68, height: 68, borderWidth: 1, borderStyle: "solid", borderColor: i === 0 ? "oklch(0.62 0.20 25 / 0.5)" : "var(--c-bd2)", background: "var(--c-canvas)" }}>
                  <MediaImage src={img.url} alt={`ref-${i + 1}`} className="nodrag w-full h-full object-cover" style={{ cursor: "zoom-in" }} draggable={false} title={i === 0 ? "首图（用于生成）" : "点击放大"} onClick={() => setRefZoom(i)} />
                  <span style={{ position: "absolute", left: 3, top: 3, minWidth: 15, height: 15, paddingInline: 3, borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center", background: accentColor, color: "white" }}>{i + 1}</span>
                  {!isLocked && (
                    <button onClick={(e) => { e.stopPropagation(); refImages.removeId(img.id); }} className="nodrag absolute top-1 right-1 p-0.5 rounded-full" style={{ background: "oklch(0 0 0 / 0.7)", color: "var(--c-t1)" }}>
                      <XIcon style={{ width: 11, height: 11 }} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: refImages.images.length > 0 ? 6 : 0 }}>
            <button
              onClick={() => refFileInputRef.current?.click()}
              disabled={isLocked || refUploading}
              className="nodrag flex items-center justify-center gap-1.5 flex-shrink-0 rounded-lg"
              style={{ padding: "0 10px", height: 32, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--c-bd3)", background: "var(--c-input)", color: "var(--c-t3)", fontSize: 11, cursor: isLocked || refUploading ? "not-allowed" : "pointer" }}
              title="上传参考图"
            >
              {refUploading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Plus style={{ width: 13, height: 13 }} />}
            </button>
            <input
              placeholder="粘贴公网图片 URL 后回车添加（https://…）"
              disabled={isLocked}
              className="nodrag"
              style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value.trim();
                if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); (e.target as HTMLInputElement).value = ""; }
              }}
              onFocus={onFocusMid}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (/^https?:\/\//.test(v)) { refImages.addUrls([v], "url"); e.currentTarget.value = ""; }
                onBlurDefault(e);
              }}
            />
          </div>
          <input ref={refFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void uploadRefFiles(files, refImages.images.length); }} />
        </div>

        {/* ── OmniHuman 指定说话主体（仅数字人模型） ── */}
        {payload.provider === "kie_omnihuman15" && (
          <OmnihumanSubjectPicker
            nodeId={id}
            prompt={payload.prompt}
            referenceImageUrl={payload.referenceImageUrl}
            manualRefUrl={refImages.images[0]?.url}
            selected={(payload.maskUrls as string[] | undefined) ?? []}
            onChange={(masks) => handleChange("maskUrls", masks.length ? masks : undefined)}
            disabled={isLocked}
          />
        )}

        {/* ── Dynamic model-specific params ── */}
        {paramDefs.length > 0 && (
          <div
            className="rounded-xl"
            style={{ background: "var(--c-input)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd1)" }}
          >
            {/* Collapsible header */}
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
            {/* ── Cinematography template launcher (always available regardless
                 of params panel state — sits between collapse header and the
                 quick-presets row) ── */}
            {paramsExpanded && (
              <div className="px-3 pt-2 pb-1">
                <button
                  onClick={() => { if (!isLocked) setPickerOpen(true); }}
                  disabled={isLocked}
                  className="nodrag flex items-center justify-between w-full"
                  title="运镜模板库（30+ 电影级运镜）"
                  style={{
                    padding: "6px 10px",
                    fontSize: 11, fontWeight: 500,
                    background: activeCameraTemplate ? "oklch(0.68 0.22 285 / 0.10)" : "var(--c-surface)",
                    border: `1px solid ${activeCameraTemplate ? "oklch(0.68 0.22 285 / 0.40)" : "var(--c-bd2)"}`,
                    borderRadius: 8,
                    color: activeCameraTemplate ? "oklch(0.78 0.18 285)" : "var(--c-t3)",
                    cursor: isLocked ? "not-allowed" : "pointer",
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <Film style={{ width: 12, height: 12 }} />
                    {activeCameraTemplate
                      ? <>运镜：<strong>{activeCameraTemplate.label}</strong> {activeCameraTemplate.emoji}</>
                      : "🎬 运镜模板库"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--c-t4)" }}>
                    {activeCameraTemplate ? "点击切换" : "30+ 种"}
                  </span>
                </button>
              </div>
            )}
            {/* ── Quick presets row ── */}
            {paramsExpanded && (presets.length > 0 || customPresets.length > 0 || paramDefs.length > 0) && (
              <div className="px-3 pt-2 pb-2">
                <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>
                    快速预设
                  </div>
                  {!savingPreset && paramDefs.length > 0 && (
                    <button
                      onClick={() => { if (!isLocked) setSavingPreset(true); }}
                      disabled={isLocked}
                      className="nodrag flex items-center gap-1"
                      title="保存当前参数为自定义预设"
                      style={{
                        padding: "1px 7px", fontSize: 10, borderRadius: 99,
                        background: "transparent", border: "1px dashed var(--c-bd3)",
                        color: "var(--c-t4)",
                        cursor: isLocked ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => { if (!isLocked) { (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.62 0.20 25 / 0.6)"; (e.currentTarget as HTMLElement).style.color = accentColor; } }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
                    >
                      <Plus style={{ width: 9, height: 9 }} /> 保存当前
                    </button>
                  )}
                </div>
                {savingPreset && (
                  <div className="flex gap-1.5 nodrag" style={{ marginBottom: 8 }}>
                    <NodeInput
                      autoFocus
                      placeholder="预设名称（如：抖音横屏）"
                      value={newPresetLabel}
                      onValueChange={(v) => setNewPresetLabel(v.slice(0, 24))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSavePreset();
                        else if (e.key === "Escape") { setSavingPreset(false); setNewPresetLabel(""); }
                      }}
                      maxLength={24}
                      className="nodrag"
                      style={{ ...fieldStyle, fontSize: 11, padding: "4px 8px", flex: 1 }}
                      onFocus={onFocusAccent}
                      onBlur={onBlurDefault}
                    />
                    <button
                      onClick={handleSavePreset}
                      disabled={!newPresetLabel.trim()}
                      className="nodrag"
                      style={{
                        padding: "2px 10px", fontSize: 10.5, borderRadius: 6,
                        background: newPresetLabel.trim() ? "oklch(0.62 0.20 25 / 0.18)" : "var(--c-surface)",
                        border: `1px solid ${newPresetLabel.trim() ? "oklch(0.62 0.20 25 / 0.4)" : "var(--c-bd2)"}`,
                        color: newPresetLabel.trim() ? accentColor : "var(--c-t4)",
                        cursor: newPresetLabel.trim() ? "pointer" : "not-allowed",
                      }}
                    >保存</button>
                    <button
                      onClick={() => { setSavingPreset(false); setNewPresetLabel(""); }}
                      className="nodrag"
                      style={{
                        padding: "2px 8px", fontSize: 10.5, borderRadius: 6,
                        background: "var(--c-surface)", border: "1px solid var(--c-bd2)",
                        color: "var(--c-t3)", cursor: "pointer",
                      }}
                    >取消</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((preset) => {
                    const isActive = Object.entries(preset.params).every(
                      ([k, v]) => String(params[k]) === String(v)
                    );
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          if (isLocked) return;
                          updateNodeData(id, {
                            params: { ...params, ...preset.params },
                            ...(preset.negativePrompt !== undefined && SUPPORTS_NEGATIVE_PROMPT.has(payload.provider)
                              ? { negativePrompt: preset.negativePrompt }
                              : {}),
                          });
                        }}
                        disabled={isLocked}
                        className="nodrag"
                        style={{
                          padding: "2px 9px",
                          fontSize: 10.5,
                          borderRadius: 99,
                          background: isActive ? "oklch(0.62 0.20 25 / 0.15)" : "var(--c-surface)",
                          border: `1px solid ${isActive ? "oklch(0.62 0.20 25 / 0.40)" : "var(--c-bd2)"}`,
                          color: isActive ? accentColor : "var(--c-t3)",
                          cursor: isLocked ? "not-allowed" : "pointer",
                          fontWeight: isActive ? 600 : 400,
                          transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isLocked && !isActive) {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--c-t4)";
                            (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isLocked && !isActive) {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)";
                            (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
                          }
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  {customPresets.map((preset) => {
                    const isActive = Object.entries(preset.params).every(
                      ([k, v]) => String(params[k]) === String(v)
                    );
                    return (
                      <div
                        key={preset.id}
                        className="group/preset nodrag relative"
                        style={{ display: "inline-flex" }}
                      >
                        <button
                          onClick={() => {
                            if (isLocked) return;
                            updateNodeData(id, {
                              params: { ...params, ...preset.params },
                              ...(preset.negativePrompt !== undefined && SUPPORTS_NEGATIVE_PROMPT.has(payload.provider)
                                ? { negativePrompt: preset.negativePrompt }
                                : {}),
                            });
                          }}
                          disabled={isLocked}
                          title={`自定义 · ${preset.label}`}
                          style={{
                            padding: "2px 18px 2px 9px",  // extra right padding for X
                            fontSize: 10.5,
                            borderRadius: 99,
                            // Distinct accent (purple) so users can spot their own presets
                            background: isActive ? "oklch(0.68 0.22 285 / 0.18)" : "oklch(0.68 0.22 285 / 0.08)",
                            border: `1px solid ${isActive ? "oklch(0.68 0.22 285 / 0.50)" : "oklch(0.68 0.22 285 / 0.30)"}`,
                            color: isActive ? "oklch(0.75 0.18 285)" : "oklch(0.65 0.16 285)",
                            cursor: isLocked ? "not-allowed" : "pointer",
                            fontWeight: isActive ? 600 : 400,
                          }}
                        >
                          {preset.label}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset.id, preset.label); }}
                          className="nodrag"
                          title="删除该预设"
                          style={{
                            position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
                            width: 13, height: 13, padding: 0,
                            borderRadius: "50%",
                            background: "transparent", border: "none",
                            color: "oklch(0.65 0.16 285 / 0.7)",
                            cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.20 25 / 0.2)";
                            (e.currentTarget as HTMLElement).style.color = "oklch(0.68 0.22 25)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "transparent";
                            (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.16 285 / 0.7)";
                          }}
                        >
                          <XIcon style={{ width: 8, height: 8 }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* divider between presets and params */}
            {paramsExpanded && presets.length > 0 && paramDefs.length > 0 && (
              <div style={{ height: 1, background: "var(--c-bd1)", marginLeft: 12, marginRight: 12, marginBottom: 4 }} />
            )}
            {/* 2-column grid for compact layout */}
            {paramsExpanded && <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 px-3 pb-3">
            {paramDefs.map((def) => {
              // camera_motion_speed is irrelevant for "none" (no motion) and "static" (fixed camera)
              if (def.key === "camera_motion_speed") {
                const motionType = params.camera_motion_type ?? "none";
                if (motionType === "none" || motionType === "static") return null;
              }
              const curVal = params[def.key] ?? def.default;
              // toggle spans full width for readability
              const isToggle = def.type === "toggle";
              if (def.type === "select") {
                return (
                  <div key={def.key} className={isToggle ? "col-span-2" : ""}>
                    <label style={labelStyle}>{def.label}</label>
                    <select
                      value={String(curVal ?? "")}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = Number(raw);
                        handleParamChange(def.key, isNaN(num) || raw === "" ? raw : num);
                      }}
                      disabled={isLocked}
                      className="nodrag"
                      style={{ ...fieldStyle, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}
                      onFocus={onFocusMid}
                      onBlur={onBlurDefault}
                    >
                      {def.options.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)} style={{ background: "var(--c-surface)" }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (def.type === "number") {
                return (
                  <div key={def.key}>
                    <label style={labelStyle}>{def.label}</label>
                    <input
                      type="number"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      placeholder={def.default !== undefined ? String(def.default) : ""}
                      value={curVal !== undefined ? String(curVal) : ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        handleParamChange(def.key, v);
                      }}
                      disabled={isLocked}
                      className="nodrag"
                      style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
                      onFocus={onFocusMid}
                      onBlur={onBlurDefault}
                    />
                  </div>
                );
              }
              if (def.type === "range") {
                const val = curVal !== undefined ? Number(curVal) : (def.default ?? def.min);
                const displayVal = def.unit === "s" ? `${val}秒` : def.key === "cfg_scale" ? val.toFixed(1) : String(val);
                return (
                  <div key={def.key} className="col-span-2">
                    <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>{def.label}</label>
                      <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{displayVal}</span>
                    </div>
                    <input
                      type="range"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={val}
                      onChange={(e) => handleParamChange(def.key, Number(e.target.value))}
                      disabled={isLocked}
                      className="nodrag w-full"
                      style={{ accentColor: accentColor, opacity: isLocked ? 0.5 : 1 }}
                    />
                  </div>
                );
              }
              if (def.type === "toggle") {
                const checked = curVal === true || curVal === "true";
                return (
                  <div key={def.key} className="col-span-2 flex items-center justify-between py-0.5">
                    <label style={{ ...labelStyle, marginBottom: 0 }}>{def.label}</label>
                    <button
                      onClick={() => handleParamChange(def.key, !checked)}
                      disabled={isLocked}
                      className="nodrag relative flex-shrink-0"
                      style={{
                        width: 32, height: 18, borderRadius: 9,
                        background: checked ? "oklch(0.62 0.20 25 / 0.7)" : "var(--c-bd1)",
                        borderWidth: 1, borderStyle: "solid",
                        borderColor: checked ? "oklch(0.62 0.20 25 / 0.5)" : "var(--c-bd3)",
                        cursor: isLocked ? "not-allowed" : "pointer",
                        transition: "background 150ms ease, border-color 150ms ease",
                        opacity: isLocked ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute", top: 2,
                          left: checked ? 14 : 2,
                          width: 12, height: 12, borderRadius: "50%",
                          background: "var(--c-t1)",
                          transition: "left 150ms ease",
                        }}
                      />
                    </button>
                  </div>
                );
              }
              return null;
            })}
            </div>}{/* end grid */}
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-2 flex-shrink-0">
          {payload.status === "processing" && (
            // #140 放弃等待（云端任务提交即计费、平台不可撤回）：本地停轮询、节点解锁可
            // 改参重提；云端任务继续跑但结果不回填。status 改动触发轮询 effect cleanup。
            <button
              onClick={abandonWait}
              className="nodrag flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all"
              style={{ background: "var(--c-surface)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
              title="停止等待该云端任务并解锁节点（任务已计费且会在云端继续，结果不回填；如需保留结果请耐心等待）"
            >
              <XIcon className="w-3 h-3" />
              放弃等待
            </button>
          )}
          {isResettable && (
            <button
              onClick={handleReset}
              disabled={resetTaskMutation.isPending}
              className="nodrag flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: "var(--c-surface)",
                borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)",
                color: resetTaskMutation.isPending ? "var(--c-t4)" : "var(--c-t2)",
                cursor: resetTaskMutation.isPending ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => { if (!resetTaskMutation.isPending) (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
              title="重置后可修改参数重新生成"
            >
              {resetTaskMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              重置
            </button>
          )}
          {/* #253 失败但 taskId 仍在：云端任务可能其实已出片（轮询误报/网络中断）——一键找回 */}
          {payload.status === "failed" && payload.taskId != null && (
            <button
              onClick={() => void refreshCloudResult()}
              disabled={refreshingResult}
              className="nodrag flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all"
              style={{ background: "var(--c-surface)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: refreshingResult ? "var(--c-t4)" : "var(--c-t2)", cursor: refreshingResult ? "wait" : "pointer" }}
              onMouseEnter={(e) => { if (!refreshingResult) (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
              title="按任务号向云端再查一次：任务其实已完成则直接找回结果（轮询失败常是网络问题，云端任务并未失败）"
            >
              {refreshingResult ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              查询云端结果
            </button>
          )}
          <button
            onClick={submitViaButton}
            disabled={isLocked || createTaskMutation.isPending}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: isLocked || createTaskMutation.isPending
                ? "var(--c-surface)"
                : "oklch(0.62 0.20 25 / 0.15)",
              borderWidth: 1, borderStyle: "solid",
              borderColor: isLocked || createTaskMutation.isPending
                ? BORDER_DEFAULT
                : "oklch(0.62 0.20 25 / 0.4)",
              color: isLocked || createTaskMutation.isPending
                ? "var(--c-t4)"
                : accentColor,
              cursor: isLocked || createTaskMutation.isPending ? "not-allowed" : "pointer",
            }}
            title={payload.status === "succeeded" ? "重新生成（将二次确认）" : ""}
          >
            {createTaskMutation.isPending || payload.status === "processing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {payload.status === "processing" ? "生成中..." : payload.status === "succeeded" ? "重新生成" : "提交任务"}
            {costLabel && payload.status !== "processing" && !createTaskMutation.isPending && (
              <span
                title="按当前模型与参数实时预估的点数消耗，仅供参考，实际以平台账单为准"
                style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "oklch(0.62 0.20 25 / 0.18)", letterSpacing: "0.02em" }}
              >
                {costLabel}
              </span>
            )}
          </button>
        </div>

        </div>{/* end input collapse wrapper */}
      </div>

      {pickerOpen && (
        <CinematographyPicker
          provider={payload.provider}
          activeTemplateId={activeCameraTemplateId}
          onSelect={handlePickCinematography}
          onClear={handleClearCinematography}
          onClose={() => setPickerOpen(false)}
        />
      )}
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

    {/* LibTV 化 2.1b：创意模式的就地生成输入条（屏幕恒定，NodeToolbar 锚定节点下方）。
        提示词/模型/参数浮层/成本/提交一条龙，读写与配置区同一 payload（双向同步）。
        2.2：参数浮层按当前 provider 的 ParamDef 全量渲染（档位按钮/下拉/滑杆/开关/数字）。 */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={expanded} width={520}>
        {/* ── LibTV 三段式 Row1：工具 chips 行（＋参考 / 标记 / 运镜 / 摄像机） ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <ToolChip icon={<Plus size={13} />} label="参考" title="从画布选择参考（点击其它节点的产物；浮条内可切本地上传）" onClick={() => usePickStore.getState().begin("ref", id)} />
          <ToolChip icon={<MapPin size={12} />} label="标记"
            title="元素选择模式：点击画布上的图片，AI 分析图中元素后点选插入引用"
            onClick={() => usePickStore.getState().begin("mark", id)} />
          <ToolChip icon={<Film size={12} />} label="运镜" active={!!activeCameraTemplateId}
            title={activeCameraTemplateId ? "运镜库（已应用运镜，可更换/清除）" : "运镜库（选一个运镜注入提示词/参数）"}
            onClick={() => setPickerOpen(true)} />
          <ToolChip icon={<Camera size={12} />} label="摄像机" active={/shot on /i.test(payload.prompt ?? "")}
            title="摄像机参数（相机/镜头/焦距/光圈 → 注入提示词）" onClick={() => setCamRigOpen(true)} />
          <input ref={inlineRefFileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void uploadRefFiles(files, refImages.images.length); e.target.value = ""; }} />
        </div>
        {/* ── Row2：参考图缩略行（点缩略图插入「主体N」） ── */}
        <RefThumbRow images={refImages.images} onRemove={refImages.removeId} onClick={(i) => insertSubjectToken(i + 1)}
          onDoubleClick={(i) => focusRefSource(refImages.images[i]?.url ?? "")} />
        {/* ── Row3：大提示词区 ── */}
        <NodeTextArea
          className="nodrag nowheel"
          rows={3}
          placeholder="描述你想生成的视频…（@ 引用角色/素材）"
          value={payload.prompt ?? ""}
          onValueChange={(v) => handleChange("prompt", v)}
          disabled={isLocked}
          style={{ width: "100%", resize: "none", fontSize: 15, lineHeight: 1.75, padding: "6px 8px", borderRadius: 8, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none", fontFamily: "inherit", opacity: isLocked ? 0.6 : 1 }}
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
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <ModelPicker
            value={payload.provider}
            disabled={isLocked}
            accent="oklch(0.7 0.18 25)"
            options={PROVIDER_PICKER_OPTIONS}
            minWidth={130}
            onChange={(v) => updateNodeData(id, videoProviderChangePatch(v as VideoProvider))}
          />
          {/* LibTV 控制行分组竖分隔线：模型 │ 参数·主体·高级 … 积分 │ 发送 */}
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); setInlineParamsOpen((v) => !v); }}
              title="生成参数（该模型全部可调项）"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: inlineParamsOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {inlineParamSummary}
            </button>
            {inlineParamsOpen && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 40, width: 300, maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
                {paramDefs.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--c-t3)" }}>该模型没有可调参数</div>
                )}
                {paramDefs.map((def) => {
                  // 与配置区同规则：无运动/固定机位时速度项无意义
                  if (def.key === "camera_motion_speed") {
                    const motionType = params.camera_motion_type ?? "none";
                    if (motionType === "none" || motionType === "static") return null;
                  }
                  const curVal = params[def.key] ?? def.default;
                  if (def.type === "select") {
                    return (
                      <div key={def.key}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>{def.label}</div>
                        {def.options.length <= 6 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {def.options.map((opt) => (
                              <InlinePill key={String(opt.value)} active={String(curVal ?? "") === String(opt.value)} disabled={isLocked}
                                onClick={() => handleParamChange(def.key, opt.value)}>
                                {opt.label}
                              </InlinePill>
                            ))}
                          </div>
                        ) : (
                          <select
                            value={String(curVal ?? "")}
                            disabled={isLocked}
                            className="nodrag"
                            onChange={(e) => { const raw = e.target.value; const num = Number(raw); handleParamChange(def.key, isNaN(num) || raw === "" ? raw : num); }}
                            style={{ width: "100%", fontSize: 11, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: isLocked ? "not-allowed" : "pointer" }}
                          >
                            {def.options.map((opt) => (
                              <option key={String(opt.value)} value={String(opt.value)} style={{ background: "var(--c-surface)" }}>{opt.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  }
                  if (def.type === "range") {
                    const val = curVal !== undefined ? Number(curVal) : (def.default ?? def.min);
                    const displayVal = def.unit === "s" ? `${val}秒` : def.key === "cfg_scale" ? val.toFixed(1) : String(val);
                    return (
                      <div key={def.key}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }}>{def.label}</span>
                          <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{displayVal}</span>
                        </div>
                        <input type="range" min={def.min} max={def.max} step={def.step} value={val} disabled={isLocked}
                          onChange={(e) => handleParamChange(def.key, Number(e.target.value))}
                          className="nodrag" style={{ width: "100%", accentColor: "var(--ui-accent, var(--c-accent))", opacity: isLocked ? 0.5 : 1 }} />
                      </div>
                    );
                  }
                  if (def.type === "number") {
                    return (
                      <div key={def.key}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)", marginBottom: 6 }}>{def.label}</div>
                        <input
                          type="number" min={def.min} max={def.max} step={def.step}
                          placeholder={def.default !== undefined ? String(def.default) : ""}
                          value={curVal !== undefined ? String(curVal) : ""}
                          disabled={isLocked}
                          onChange={(e) => { const v = e.target.value === "" ? undefined : Number(e.target.value); handleParamChange(def.key, v); }}
                          className="nodrag"
                          style={{ width: "100%", fontSize: 11, padding: "5px 8px", borderRadius: 7, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", opacity: isLocked ? 0.5 : 1 }}
                        />
                      </div>
                    );
                  }
                  if (def.type === "toggle") {
                    const checked = curVal === true || curVal === "true";
                    return (
                      <div key={def.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }}>{def.label}</span>
                        <button
                          onClick={() => handleParamChange(def.key, !checked)}
                          disabled={isLocked}
                          className="nodrag"
                          style={{ position: "relative", flexShrink: 0, width: 32, height: 18, borderRadius: 9, background: checked ? "oklch(0.62 0.20 25 / 0.7)" : "var(--c-bd1)", border: `1px solid ${checked ? "oklch(0.62 0.20 25 / 0.5)" : "var(--c-bd3)"}`, cursor: isLocked ? "not-allowed" : "pointer", transition: "background 150ms ease, border-color 150ms ease", opacity: isLocked ? 0.5 : 1 }}
                        >
                          <span style={{ position: "absolute", top: 2, left: checked ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "var(--c-t1)", transition: "left 150ms ease" }} />
                        </button>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </span>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起节点内完整配置区" : "展开节点内完整配置区（参考图/预设/全部参数）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            高级
          </button>
          <div style={{ flex: 1 }} />
          <span title="按当前模型与参数实时预估的点数消耗，仅供参考" style={{ fontSize: 11, color: "var(--c-t3)", whiteSpace: "nowrap" }}>⚡ {costLabel || "—"}</span>
          <span style={{ width: 1, height: 15, background: "var(--c-bd2)", flexShrink: 0 }} />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); if (!isLocked && !createTaskMutation.isPending && payload.prompt?.trim()) submitViaButton(); }}
            disabled={isLocked || createTaskMutation.isPending || !payload.prompt?.trim()}
            title={payload.status === "processing" || createTaskMutation.isPending ? "生成中…" : payload.status === "succeeded" ? "重新生成（将二次确认）" : "提交任务"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, borderRadius: 9, border: "none", cursor: isLocked || createTaskMutation.isPending || !payload.prompt?.trim() ? "not-allowed" : "pointer", background: isLocked || createTaskMutation.isPending || !payload.prompt?.trim() ? "var(--c-surface)" : "var(--ui-accent, var(--c-accent))", color: isLocked || createTaskMutation.isPending || !payload.prompt?.trim() ? "var(--c-t4)" : "#0b0d12" }}
          >
            {createTaskMutation.isPending || payload.status === "processing" ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </InlineGenBar>
    )}

    {/* LibTV「标记」元素选择浮层：AI 分析后点选元素 → 插入「主体N 的<元素>」引用 */}
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
          const refToken = idx >= 0 ? `主体${idx + 1} 的${name}` : name;
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

    {/* LibTV 化：摄像机参数选择器（应用把拍摄参数片段注入提示词，重复应用先替换旧片段） */}
    {camRigOpen && (
      <CameraRigPicker
        active={/shot on /i.test(payload.prompt ?? "")}
        onApply={(frag) => {
          const base = stripCameraRig(payload.prompt ?? "");
          handleChange("prompt", base ? `${base}，${frag}` : frag);
          toast.success("已注入摄像机参数");
        }}
        onClear={() => { handleChange("prompt", stripCameraRig(payload.prompt ?? "")); toast.success("已清除摄像机参数"); }}
        onClose={() => setCamRigOpen(false)}
      />
    )}

    {/* LibTV 化：快速剪辑条（屏幕底部固定；确认走 clip.trimVideo，完成后原地替换结果视频） */}
    {quickTrimOpen && primaryUrl && (
      <QuickTrimBar
        videoUrl={primaryUrl}
        projectId={data.projectId}
        nodeId={id}
        onClose={() => setQuickTrimOpen(false)}
        onDone={(url) => updateNodeData(id, { resultVideoUrl: url })}
      />
    )}
  </>);
});
