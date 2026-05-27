import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { VideoTaskNodeData, VideoProvider, CharacterNodeData } from "../../../../../shared/types";
import { mergeCharactersIntoPrompt } from "../../../lib/characterPrompt";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Handle, Position } from "@xyflow/react";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle, Download, ChevronDown, ChevronRight, Layers, Plus, X as XIcon, Film, HardDriveDownload } from "lucide-react";
import { useLocalMedia } from "@/lib/useLocalMedia";
import { cacheMedia } from "@/lib/mediaCache";
import { listCustomPresets, saveCustomPreset, deleteCustomPreset, type CustomVideoPreset } from "@/lib/customPresets";
import { ensureNotificationPermission, showCompletionNotification } from "@/lib/notify";
import { CinematographyPicker } from "../CinematographyPicker";
import {
  applyCinematographyToPrompt,
  clearCinematographyFromPrompt,
  detectActiveCinematography,
  applyCinematographyParams,
  clearCinematographyParamsPatch,
  getTemplateById,
} from "@/lib/cinematographyTemplates";

// Providers that require a reference image (image-to-video)
const REQUIRES_REFERENCE_IMAGE = new Set<string>([
  "poyo_wan25_i2v",
  "hf_dop_standard", "hf_dop_lite", "hf_dop_turbo",
]);

// Heuristic: only allow http(s) / same-origin paths to render. Reject data:/blob:/javascript:.
function isSafeMediaUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url);
}

function toProxiedSrc(u: string): string {
  return u.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(u)}` : u;
}

function LocalCacheBadge({ downloadedAt }: { downloadedAt: number }) {
  return (
    <div
      title={`已缓存到本地（${new Date(downloadedAt).toLocaleString("zh-CN")}）`}
      className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
      style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
    />
  );
}

function ShotItem({ u, idx }: { u: string; idx: number }) {
  const { isLocal, blobUrl, downloadedAt, refresh } = useLocalMedia(u);
  const [caching, setCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);
  const src = blobUrl ?? toProxiedSrc(u);
  const handleCache = async () => {
    if (caching) return;
    setCaching(true); setCacheProgress(0);
    try {
      await cacheMedia(u, "video", (loaded, total) => {
        if (total > 0) setCacheProgress(Math.round(loaded / total * 100));
      });
      refresh();
      toast.success("已缓存到本地");
    } catch (e) {
      toast.error("缓存失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setCaching(false); }
  };
  return (
    <div>
      <div className="relative rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.72 0.18 155 / 0.30)" }}>
        {isLocal && <LocalCacheBadge downloadedAt={downloadedAt} />}
        <video
          src={src}
          controls
          className="w-full nodrag"
          style={{ maxHeight: 110, display: "block" }}
          preload="metadata"
          onError={(e) => { console.error("[VideoTaskNode] shot", idx, "load error:", (e.currentTarget as HTMLVideoElement).error?.message); }}
        />
      </div>
      <a
        href={u.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(u)}&download=1` : u}
        download
        className="nodrag mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] font-medium"
        style={{ background: "oklch(0.72 0.18 155 / 0.10)", border: "1px solid oklch(0.72 0.18 155 / 0.30)", color: "oklch(0.72 0.18 155)", textDecoration: "none" }}
      >
        <Download className="w-2.5 h-2.5" /> 第 {idx + 1} 段
      </a>
      {!isLocal && (
        <button
          onClick={handleCache}
          disabled={caching}
          className="nodrag mt-0.5 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] font-medium"
          style={{ background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: caching ? "not-allowed" : "pointer" }}
        >
          {caching
            ? <><Loader2 className="w-2.5 h-2.5 animate-spin" />{cacheProgress > 0 ? ` ${cacheProgress}%` : " 缓存中..."}</>
            : <><HardDriveDownload className="w-2.5 h-2.5" /> 缓存</>}
        </button>
      )}
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

const PROVIDERS: { value: VideoProvider; label: string; group: string }[] = [
  { value: "poyo_seedance",       label: "Seedance 2",          group: "Poyo" },
  { value: "poyo_veo",            label: "Veo 3.1",             group: "Poyo" },
  { value: "poyo_kling26",        label: "Kling 2.6",           group: "Poyo" },
  { value: "poyo_kling_o3_std",   label: "Kling O3 Standard",   group: "Poyo" },
  { value: "poyo_kling_o3_pro",   label: "Kling O3 Pro",        group: "Poyo" },
  { value: "poyo_kling_o3_4k",    label: "Kling O3 4K",         group: "Poyo" },
  { value: "poyo_wan25_t2v",      label: "Wan 2.6 文生视频",    group: "Poyo" },
  { value: "poyo_wan25_i2v",      label: "Wan 2.6 图生视频",    group: "Poyo" },
  { value: "poyo_runway45",       label: "Runway Gen 4.5",      group: "Poyo" },
  // Higgsfield 公共 API 仅支持 DoP 3 个变体（其他 Kling/Seedance/Veo 模型
  // 只在 cloud.higgsfield.ai 私有后端，第三方无法调用）。
  { value: "hf_dop_standard",     label: "DoP Standard",        group: "Higgsfield" },
  { value: "hf_dop_lite",         label: "DoP Lite",            group: "Higgsfield" },
  { value: "hf_dop_turbo",        label: "DoP Turbo",           group: "Higgsfield" },
  { value: "mock",                label: "Mock 测试",           group: "Dev" },
];

type ParamDef =
  | { type: "select"; key: string; label: string; options: { value: string | number; label: string }[]; default?: string | number }
  | { type: "number"; key: string; label: string; min: number; max: number; step: number; default?: number }
  | { type: "range";  key: string; label: string; min: number; max: number; step: number; default?: number; unit?: string }
  | { type: "toggle"; key: string; label: string; default?: boolean };

const HF_CAMERA_MOTION_OPTIONS = [
  { value: "none",       label: "无镜头运动" },
  { value: "zoom_in",    label: "推镜（Zoom In）" },
  { value: "zoom_out",   label: "拉镜（Zoom Out）" },
  { value: "pan_left",   label: "左移（Pan Left）" },
  { value: "pan_right",  label: "右移（Pan Right）" },
  { value: "tilt_up",    label: "上倾（Tilt Up）" },
  { value: "tilt_down",  label: "下倾（Tilt Down）" },
  { value: "orbit",      label: "环绕（Orbit）" },
  { value: "static",     label: "固定（Static）" },
];

const HF_DOP_STANDARD_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 4,
    options: [{ value: 4, label: "4 秒" }, { value: 8, label: "8 秒" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
  { type: "select", key: "camera_motion_type", label: "镜头运动", default: "none",
    options: HF_CAMERA_MOTION_OPTIONS },
  { type: "select", key: "camera_motion_speed", label: "运动速度", default: "normal",
    options: [{ value: "slow", label: "慢速" }, { value: "normal", label: "正常" }, { value: "fast", label: "快速" }] },
  { type: "toggle", key: "enhance_prompt", label: "AI 增强提示词", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const HF_DOP_FAST_PARAMS: ParamDef[] = [
  { type: "select", key: "duration", label: "时长（秒）", default: 4,
    options: [{ value: 4, label: "4 秒" }] },
  { type: "select", key: "resolution", label: "分辨率", default: "720p",
    options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }] },
  { type: "select", key: "camera_motion_type", label: "镜头运动", default: "none",
    options: HF_CAMERA_MOTION_OPTIONS },
  { type: "select", key: "camera_motion_speed", label: "运动速度", default: "normal",
    options: [{ value: "slow", label: "慢速" }, { value: "normal", label: "正常" }, { value: "fast", label: "快速" }] },
  { type: "toggle", key: "enhance_prompt", label: "AI 增强提示词", default: false },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const KLING_O3_PARAMS: ParamDef[] = [
  { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
    options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
  { type: "range", key: "duration", label: "时长（秒）", min: 3, max: 15, step: 1, default: 5, unit: "s" },
  { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
];

const SUPPORTS_NEGATIVE_PROMPT = new Set<string>([
  "poyo_seedance",
  "poyo_kling_o3_std", "poyo_kling_o3_pro", "poyo_kling_o3_4k",
]);

const PROVIDER_PARAMS: Record<string, ParamDef[]> = {
  poyo_seedance: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [
        { value: "21:9", label: "21:9 超宽" }, { value: "16:9", label: "16:9 横屏" },
        { value: "4:3", label: "4:3 标准" }, { value: "1:1", label: "1:1 方形" },
        { value: "3:4", label: "3:4 竖屏" }, { value: "9:16", label: "9:16 竖屏" },
      ]},
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "range",  key: "duration", label: "时长（秒）", min: 4, max: 15, step: 1, default: 5, unit: "s" },
    { type: "toggle", key: "camera_fixed", label: "固定镜头", default: false },
    { type: "toggle", key: "generate_audio", label: "AI 生成音频", default: false },
    { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
  ],
  poyo_veo: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
    // Veo 3.1 only supports fixed 8-second duration per API docs
    { type: "select", key: "duration", label: "时长（秒）", default: 8,
      options: [{ value: 8, label: "8 秒（固定）" }] },
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "4k", label: "4K" }] },
    { type: "select", key: "generation_type", label: "生成模式", default: "reference",
      options: [{ value: "reference", label: "参考图风格" }, { value: "frame", label: "首帧约束" }] },
  ],
  hf_dop_standard: HF_DOP_STANDARD_PARAMS,
  hf_dop_lite:     HF_DOP_FAST_PARAMS,
  hf_dop_turbo:    HF_DOP_FAST_PARAMS,
  poyo_kling26: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }, { value: "1:1", label: "1:1 方形" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    { type: "toggle", key: "sound", label: "AI 生成音效", default: false },
  ],
  poyo_kling_o3_std: KLING_O3_PARAMS,
  poyo_kling_o3_pro: KLING_O3_PARAMS,
  poyo_kling_o3_4k:  KLING_O3_PARAMS,
  poyo_wan25_t2v: [
    // Wan 2.6 API does not document aspect_ratio; resolution and multi_shots replace it
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
    // ⚠️ multi_shots: true causes Poyo to generate 3 separate video shots and
    // bills each separately (~3x credit cost). Default off; label spells this
    // out so users can't enable it without seeing the cost.
    { type: "toggle", key: "multi_shots", label: "多镜头模式（⚠ 生成 3 段，3x 计费）", default: false },
  ],
  poyo_wan25_i2v: [
    { type: "select", key: "resolution", label: "分辨率", default: "720p",
      options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }, { value: 15, label: "15 秒" }] },
    { type: "toggle", key: "multi_shots", label: "多镜头模式（⚠ 生成 3 段，3x 计费）", default: false },
  ],
  poyo_runway45: [
    { type: "select", key: "aspect_ratio", label: "宽高比", default: "16:9",
      options: [{ value: "16:9", label: "16:9 横屏" }, { value: "9:16", label: "9:16 竖屏" }] },
    { type: "select", key: "duration", label: "时长（秒）", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    { type: "number", key: "seed", label: "随机种子（可选）", min: 0, max: 2147483647, step: 1 },
  ],
  mock: [],
};

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

// Rough cost estimates in Poyo credits per 5s clip (display only)
const PROVIDER_COST: Record<string, { label: string; color: string }> = {
  poyo_seedance:     { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  poyo_veo:          { label: "~20积分", color: "oklch(0.65 0.18 60)" },
  poyo_kling26:      { label: "~4积分", color: "oklch(0.72 0.18 155)" },
  poyo_kling_o3_std: { label: "~6积分", color: "oklch(0.72 0.18 155)" },
  poyo_kling_o3_pro: { label: "~12积分", color: "oklch(0.65 0.18 60)" },
  poyo_kling_o3_4k:  { label: "~30积分", color: "oklch(0.62 0.20 25)" },
  poyo_wan25_t2v:    { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  poyo_wan25_i2v:    { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  poyo_runway45:     { label: "~10积分", color: "oklch(0.65 0.18 60)" },
  hf_dop_standard:   { label: "~8积分", color: "oklch(0.65 0.18 60)" },
  hf_dop_lite:       { label: "~3积分", color: "oklch(0.72 0.18 155)" },
  hf_dop_turbo:      { label: "~2积分", color: "oklch(0.72 0.18 155)" },
  mock:              { label: "免费", color: "oklch(0.55 0.08 260)" },
};

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

export const VideoTaskNode = memo(function VideoTaskNode({ id, selected, data }: Props) {
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  // Use selector to avoid re-rendering on every store change (other nodes' updates)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Count of parallel-mode createTaskMutation calls currently in flight.
  // When > 0, the shared mutation's global onSuccess/onError must NOT write to payload —
  // the per-mutate handler updates parallelResults instead. A single counter (vs. boolean
  // flag) correctly handles 2+ concurrent parallel submits whose globals fire in arbitrary order.
  const parallelInFlightRef = useRef(0);
  // Auto-collapse params when node is deselected; expand when selected
  const [paramsExpanded, setParamsExpanded] = useState(!!selected);
  useEffect(() => { setParamsExpanded(!!selected); }, [selected]);

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
    // Tolerate transient poll failures — the server-side task is still running and credits
    // are already spent. Marking the node "failed" on a single network blip would tempt the user
    // to re-submit and double-charge. Only flip to failed after several consecutive failures.
    let consecutiveFailures = 0;
    const MAX_POLL_FAILURES = 5;
    const timerId = setInterval(async () => {
      try {
        const result = await pollQueryRef.current.refetch();
        if (result.error) throw result.error;
        if (result.data) {
          consecutiveFailures = 0;
          const task = result.data;
          if (task.status === "succeeded" || task.status === "failed") {
            updateNodeData(id, {
              status: task.status,
              resultVideoUrl: task.resultVideoUrl ?? undefined,
              errorMessage: task.errorMessage ?? undefined,
            }, true);
            clearInterval(timerId);
          }
        }
      } catch (err) {
        consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "未知错误";
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          updateNodeData(id, { status: "failed", errorMessage: `轮询持续失败：${msg}` }, true);
          clearInterval(timerId);
          toast.error("轮询持续失败，任务可能仍在服务端运行；如需重新提交请先在服务端确认");
        }
        // Otherwise: silent retry on next tick
      }
    }, 5000);
    pollRef.current = timerId;
    return () => { clearInterval(timerId); pollRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.status, payload.taskId, id, updateNodeData]);

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

  const handleSubmit = () => {
    if (createTaskMutation.isPending) return;
    if (payload.status === "processing") return;
    if (!payload.prompt?.trim()) { toast.error("请填写提示词"); return; }
    if (REQUIRES_REFERENCE_IMAGE.has(payload.provider) && !payload.referenceImageUrl?.trim()) {
      toast.error("该模型需要参考图 URL"); return;
    }
    // Veo 3.1 首帧约束模式需要参考图
    if (payload.provider === "poyo_veo" && payload.params?.generation_type === "frame" && !payload.referenceImageUrl?.trim()) {
      toast.error("Veo 3.1 首帧约束模式需要提供参考图 URL"); return;
    }
    if (payload.referenceImageUrl && !isSafeMediaUrl(payload.referenceImageUrl)) {
      toast.error("参考图 URL 仅支持 http(s) 或相对路径"); return;
    }
    // If parallel mode was closed while requests were in-flight, the counter may
    // be stuck at a non-zero value and would suppress this single-mode callback.
    if (!parallelMode) parallelInFlightRef.current = 0;
    // Fire-and-forget — first submit prompts the user to allow notifications
    // so the completion alert can reach them on backgrounded tabs.
    void ensureNotificationPermission();

    const { prompt: finalPrompt, referenceImageUrl: finalRefImage } = composeSubmissionContext();

    createTaskMutation.mutate({
      projectId: data.projectId, nodeId: id,
      provider: payload.provider, prompt: finalPrompt,
      // Only send negativePrompt for providers that actually support it
      negativePrompt: SUPPORTS_NEGATIVE_PROMPT.has(payload.provider) ? payload.negativePrompt : undefined,
      referenceImageUrl: finalRefImage,
      params: payload.params,
    });
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
    const connectedCharacters: CharacterNodeData[] = [];
    let charRefFallback: string | undefined = undefined;
    for (const e of allEdges) {
      if (e.target !== id) continue;
      const src = allNodes.find((n) => n.id === e.source);
      if (src?.data.nodeType === "character") {
        const cp = src.data.payload as CharacterNodeData;
        connectedCharacters.push(cp);
        if (!charRefFallback && cp.referenceImageUrl) charRefFallback = cp.referenceImageUrl;
      }
    }
    return {
      prompt: mergeCharactersIntoPrompt(payload.prompt ?? "", connectedCharacters),
      referenceImageUrl: payload.referenceImageUrl?.trim() || charRefFallback,
    };
  }, [id, payload.prompt, payload.referenceImageUrl]);

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
  const isLocked = payload.status === "processing" || payload.status === "succeeded";
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
  const videoSrc = primaryUrl ? toProxiedSrc(primaryUrl) : undefined;
  const hasMultiResults = safeResultUrls.length > 1;

  // Get param defs for current provider
  const paramDefs = PROVIDER_PARAMS[payload.provider] ?? [];
  const params = payload.params ?? {};
  const presets = PROVIDER_PRESETS[payload.provider] ?? [];

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

  // ── Local media cache (IndexedDB) ────────────────────────────────────────
  const { isLocal, blobUrl, downloadedAt, refresh: refreshLocalCache } = useLocalMedia(primaryUrl);
  const [caching, setCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);
  const handleCache = async () => {
    if (!primaryUrl || caching) return;
    setCaching(true); setCacheProgress(0);
    try {
      await cacheMedia(primaryUrl, "video", (loaded, total) => {
        if (total > 0) setCacheProgress(Math.round(loaded / total * 100));
      });
      refreshLocalCache();
      toast.success("已缓存到本地");
    } catch (e) {
      toast.error("缓存失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setCaching(false); }
  };

  const heroMedia = payload.status === "succeeded" && videoSrc ? (
    <video
      src={blobUrl ?? videoSrc}
      controls
      className="w-full"
      preload="metadata"
      style={{ display: "block", maxHeight: 240 }}
    />
  ) : isSafeMediaUrl(payload.referenceImageUrl) ? (
    <img
      src={payload.referenceImageUrl}
      style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }}
      draggable={false}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  ) : null;

  return (
    <BaseNode id={id} selected={selected} nodeType="video_task" title={data.title} minHeight={260} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* ── Status pill ── */}
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
          {payload.status === "succeeded" && (
            <span className="ml-auto text-[10px]" style={{ color: "var(--c-t4)" }}>生成完成</span>
          )}
        </div>

        {/* ── Result video(s) ──
            Single result: full-width player.
            Multi-shot result (Wan 2.6 multi_shots=true → 3 clips):
            2-column grid showing all clips; each gets its own download link. */}
        {payload.status === "succeeded" && videoSrc && (
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
                  {isLocal && <LocalCacheBadge downloadedAt={downloadedAt} />}
                  <video
                    key={videoSrc}
                    src={blobUrl ?? videoSrc}
                    controls
                    className="w-full nodrag"
                    style={{ maxHeight: 140, display: "block" }}
                    preload="metadata"
                  />
                </div>
                {/* Download button (primary URL — works for single-shot results) */}
                {primaryUrl && (
                  <a
                    href={primaryUrl.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(primaryUrl)}&download=1` : primaryUrl}
                    download
                    className="nodrag mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
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
                {/* Cache to local button */}
                {!isLocal && primaryUrl && (
                  <button
                    onClick={handleCache}
                    disabled={caching}
                    className="nodrag mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium"
                    style={{
                      background: "transparent",
                      borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)",
                      color: "var(--c-t3)",
                      cursor: caching ? "not-allowed" : "pointer",
                    }}
                  >
                    {caching
                      ? <><Loader2 className="w-3 h-3 animate-spin" />{cacheProgress > 0 ? ` ${cacheProgress}%` : " 缓存中..."}</>
                      : <><HardDriveDownload className="w-3 h-3" /> 缓存到本地</>}
                  </button>
                )}
              </>
            )}
          </div>
        )}

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

        {/* ── Input area (collapsed when not selected) ── */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: expanded ? "9999px" : "0px",
            transition: expanded
              ? "max-height 220ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "max-height 160ms cubic-bezier(0.77, 0, 0.175, 1)",
          }}
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
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--c-t4)", background: "var(--c-surface)", borderRadius: 99, padding: "1px 5px" }}>{p.group}</span>
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
                  // Block submit if any selected parallel provider requires a reference image but none is set
                  if (!payload.referenceImageUrl?.trim() && parallelProviders.some((p) => REQUIRES_REFERENCE_IMAGE.has(p))) {
                    toast.error("已选择的图生视频模型需要参考图 URL"); return;
                  }
                  toast.info(`正在并行提交 ${parallelProviders.length} 个任务...`);
                  // Capture generation token for this batch — per-mutate callbacks compare against
                  // the latest token and no-op if the user has closed parallel mode since
                  const gen = parallelGenRef.current;
                  // Increment counter ONCE per mutate call so global onSuccess/onError can correctly suppress payload writes
                  parallelInFlightRef.current += parallelProviders.length;
                  // Compose ONCE so all parallel providers see the same
                  // character-augmented prompt. Previously this branch sent
                  // payload.prompt verbatim, silently skipping connected
                  // character nodes — parallel mode produced different prompts
                  // than single mode for the same node configuration.
                  const submission = composeSubmissionContext();
                  parallelProviders.forEach(provider => {
                    setParallelResults(prev => ({ ...prev, [provider]: { status: "processing" } }));
                    createTaskMutation.mutate(
                      // Send only prompt/negative/refImage in parallel mode — per-provider params
                      // diverge enough that sharing one params bag tends to break some providers
                      { nodeId: id, projectId: data.projectId, provider, prompt: submission.prompt, negativePrompt: SUPPORTS_NEGATIVE_PROMPT.has(provider) ? payload.negativePrompt : undefined, referenceImageUrl: submission.referenceImageUrl },
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
                        <video
                          src={result.videoUrl!.startsWith("http") ? `/api/video-proxy?url=${encodeURIComponent(result.videoUrl!)}` : result.videoUrl}
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
            {PROVIDER_COST[payload.provider] && (
              <span
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  padding: "1px 6px", borderRadius: 99,
                  background: `${PROVIDER_COST[payload.provider].color}18`,
                  border: `1px solid ${PROVIDER_COST[payload.provider].color}30`,
                  color: PROVIDER_COST[payload.provider].color,
                }}
              >
                {PROVIDER_COST[payload.provider].label}
              </span>
            )}
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
          <select
            value={payload.provider}
            onChange={(e) => {
              const newProvider = e.target.value as VideoProvider;
              updateNodeData(id, {
                provider: newProvider,
                params: {},
                // Clear stale negative prompt when switching to a provider that doesn't support it
                ...(!SUPPORTS_NEGATIVE_PROMPT.has(newProvider) ? { negativePrompt: undefined } : {}),
              });
            }}
            disabled={isLocked}
            className="nodrag"
            style={{ ...fieldStyle, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusAccent}
            onBlur={onBlurDefault}
          >
            {/* Stub option so legacy provider value renders something instead of blank */}
            {!PROVIDERS.some((p) => p.value === payload.provider) && (
              <option value={payload.provider} disabled style={{ background: "var(--c-surface)" }}>
                ⚠ 已下线: {payload.provider}
              </option>
            )}
            {["Poyo", "Higgsfield", "Dev"].map((group) => (
              <optgroup key={group} label={`── ${group} ──`} style={{ background: "var(--c-surface)" }}>
                {PROVIDERS.filter((p) => p.group === group).map((p) => (
                  <option key={p.value} value={p.value} style={{ background: "var(--c-surface)" }}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea
            placeholder="视频生成提示词..."
            value={payload.prompt ?? ""}
            onChange={(e) => handleChange("prompt", e.target.value)}
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
            <input
              placeholder="blurry, low quality..."
              value={payload.negativePrompt ?? ""}
              onChange={(e) => handleChange("negativePrompt", e.target.value)}
              disabled={isLocked}
              className="nodrag"
              style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
              onFocus={onFocusMid}
              onBlur={onBlurDefault}
            />
          </div>
        )}

        {/* ── Reference image URL (for all models) ── */}
        <div>
          <label style={labelStyle}>参考图 URL（可选）</label>
          <input
            placeholder="https://..."
            value={payload.referenceImageUrl ?? ""}
            onChange={(e) => handleChange("referenceImageUrl", e.target.value)}
            disabled={isLocked}
            className="nodrag"
            style={{ ...fieldStyle, opacity: isLocked ? 0.5 : 1 }}
            onFocus={onFocusMid}
            onBlur={onBlurDefault}
          />
        </div>

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
                    <input
                      autoFocus
                      placeholder="预设名称（如：抖音横屏）"
                      value={newPresetLabel}
                      onChange={(e) => setNewPresetLabel(e.target.value.slice(0, 24))}
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
          <button
            onClick={handleSubmit}
            disabled={isLocked || isResettable || createTaskMutation.isPending}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: isLocked || isResettable || createTaskMutation.isPending
                ? "var(--c-surface)"
                : "oklch(0.62 0.20 25 / 0.15)",
              borderWidth: 1, borderStyle: "solid",
              borderColor: isLocked || isResettable || createTaskMutation.isPending
                ? BORDER_DEFAULT
                : "oklch(0.62 0.20 25 / 0.4)",
              color: isLocked || isResettable || createTaskMutation.isPending
                ? "var(--c-t4)"
                : accentColor,
              cursor: isLocked || isResettable || createTaskMutation.isPending ? "not-allowed" : "pointer",
            }}
            title={isResettable ? "请先点击「重置」再重新提交" : ""}
          >
            {createTaskMutation.isPending || payload.status === "processing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {payload.status === "processing" ? "生成中..." : "提交任务"}
          </button>
        </div>

        </div>{/* end input collapse wrapper */}
      </div>

      {/* Input handle — target/square = receives image from ImageGenNode */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image-in"
        style={{
          width: 12, height: 12,
          borderRadius: 3,
          background: "oklch(0.68 0.22 285 / 0.85)",
          border: "2px solid var(--c-canvas)",
          left: -6,
          top: "25%",
        }}
        title="参考图输入 ← 连接图像生成节点"
      />
      {pickerOpen && (
        <CinematographyPicker
          provider={payload.provider}
          activeTemplateId={activeCameraTemplateId}
          onSelect={handlePickCinematography}
          onClear={handleClearCinematography}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </BaseNode>
  );
});
