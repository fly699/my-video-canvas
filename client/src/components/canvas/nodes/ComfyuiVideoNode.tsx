import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ComfyuiVideoNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Play, Loader2, RefreshCw, Upload, X, Cpu, Download, AlertCircle,
  ChevronDown, ChevronRight, Server, Boxes, HardDriveDownload,
} from "lucide-react";
import { useLocalMedia } from "@/lib/useLocalMedia";
import { cacheMedia } from "@/lib/mediaCache";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "comfyui_video";
    title: string;
    payload: ComfyuiVideoNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.62 0.22 50)";
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = `oklch(0.62 0.22 50 / 0.5)`;

function isSafeMediaUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url);
}

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

export const ComfyuiVideoNode = memo(function ComfyuiVideoNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const [uploading, setUploading] = useState(false);
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce customBaseUrl to avoid one outbound probe per keystroke.
  const [debouncedUrl, setDebouncedUrl] = useState(payload.customBaseUrl?.trim() || undefined);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(payload.customBaseUrl?.trim() || undefined), 600);
    return () => clearTimeout(t);
  }, [payload.customBaseUrl]);
  const modelsQuery = trpc.comfyui.fetchModels.useQuery(
    { customBaseUrl: debouncedUrl },
    { staleTime: 60_000, retry: false }
  );

  const genMutation = trpc.comfyui.generateVideo.useMutation({
    onSuccess: (result) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { resultVideoUrl: result.url, status: "done", errorMessage: undefined, progress: undefined });
      toast.success("ComfyUI 视频生成成功");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { status: "failed", errorMessage: err.message, progress: undefined });
      toast.error("ComfyUI 视频生成失败：" + err.message);
    },
  });

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      setUploading(false);
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      updateNodeData(id, { referenceImageUrl: result.url });
      toast.success("参考图上传成功");
    },
    onError: (err) => {
      setUploading(false);
      toast.error("参考图上传失败：" + err.message);
    },
  });

  const update = useCallback(
    (field: keyof ComfyuiVideoNodeData, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const isSvd = payload.workflowTemplate === "svd";

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    if (!payload.ckpt?.trim()) { toast.error("请先填写 Checkpoint 名称"); return; }
    if (isSvd && !payload.referenceImageUrl) {
      toast.error("SVD 模板需要参考图"); return;
    }
    if (!isSvd && !payload.motionModule?.trim()) {
      toast.error("AnimateDiff 模板需要 Motion Module 名称"); return;
    }
    updateNodeData(id, { status: "processing", errorMessage: undefined, progress: 0 });
    genMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      customBaseUrl: payload.customBaseUrl?.trim() || undefined,
      workflowTemplate: payload.workflowTemplate ?? "animatediff",
      prompt: payload.prompt,
      negPrompt: payload.negPrompt,
      ckpt: payload.ckpt,
      motionModule: payload.motionModule,
      steps: payload.steps ?? 20,
      cfg: payload.cfg ?? 7,
      seed: typeof payload.seed === "number" ? payload.seed : -1,
      frames: payload.frames ?? 16,
      fps: payload.fps ?? 8,
      width: payload.width || undefined,
      height: payload.height || undefined,
      sampler: payload.sampler || undefined,
      scheduler: payload.scheduler || undefined,
      denoise: typeof payload.denoise === "number" ? payload.denoise : undefined,
      vae: payload.vae || undefined,
      batchSize: payload.batchSize ?? 1,
      referenceImageUrl: payload.referenceImageUrl,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); e.target.value = ""; return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("文件不能超过 16 MB"); e.target.value = ""; return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.onerror = () => { setUploading(false); toast.error("文件读取失败"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const videoSrc = !isSafeMediaUrl(payload.resultVideoUrl)
    ? undefined
    : payload.resultVideoUrl!.startsWith("http")
      ? `/api/video-proxy?url=${encodeURIComponent(payload.resultVideoUrl!)}`
      : payload.resultVideoUrl;

  // ── Local media cache (IndexedDB) ────────────────────────────────────────
  const { isLocal: videoIsLocal, blobUrl: videoBlobUrl, downloadedAt: videoDownloadedAt, refresh: refreshVideoCache } = useLocalMedia(isSafeMediaUrl(payload.resultVideoUrl) ? payload.resultVideoUrl : undefined);
  const [videoCaching, setVideoCaching] = useState(false);
  const [videoCacheProgress, setVideoCacheProgress] = useState(0);
  const handleVideoCache = async () => {
    if (!payload.resultVideoUrl || videoCaching) return;
    setVideoCaching(true); setVideoCacheProgress(0);
    try {
      await cacheMedia(payload.resultVideoUrl, "video", (loaded, total) => {
        if (total > 0) setVideoCacheProgress(Math.round(loaded / total * 100));
      });
      refreshVideoCache();
      toast.success("已缓存到本地");
    } catch (err) {
      toast.error("缓存失败：" + (err instanceof Error ? err.message : String(err)));
    } finally { setVideoCaching(false); }
  };

  const heroMedia = payload.status === "done" && videoSrc ? (
    <video
      src={videoBlobUrl ?? videoSrc}
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
    <BaseNode id={id} selected={selected} nodeType="comfyui_video" title={data.title} minHeight={300} heroMedia={heroMedia}>
      <div className="flex flex-col h-full p-3.5 gap-3 overflow-auto">

        {/* ── Status pill ── */}
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg flex-shrink-0"
          style={{
            background: payload.status === "done" ? "oklch(0.72 0.18 155 / 0.08)"
                       : payload.status === "processing" ? "oklch(0.68 0.22 285 / 0.08)"
                       : payload.status === "failed" ? "oklch(0.62 0.20 25 / 0.08)"
                       : "var(--c-surface)",
            borderWidth: 1, borderStyle: "solid",
            borderColor: payload.status === "done" ? "oklch(0.72 0.18 155 / 0.30)"
                        : payload.status === "processing" ? "oklch(0.68 0.22 285 / 0.30)"
                        : payload.status === "failed" ? "oklch(0.62 0.20 25 / 0.30)"
                        : "var(--c-bd2)",
          }}
        >
          {payload.status === "processing" ? (
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" style={{ color: "oklch(0.68 0.22 285)" }} />
          ) : (
            <Boxes className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />
          )}
          <span className="text-xs font-medium" style={{
            color: payload.status === "done" ? "oklch(0.72 0.18 155)"
                 : payload.status === "processing" ? "oklch(0.68 0.22 285)"
                 : payload.status === "failed" ? "oklch(0.62 0.20 25)"
                 : "var(--c-t3)",
          }}>
            {payload.status === "done" ? "已完成"
             : payload.status === "processing" ? "ComfyUI 生成中..."
             : payload.status === "failed" ? "失败"
             : "待运行"}
          </span>
        </div>

        {/* ── Result video ── */}
        {payload.status === "done" && payload.resultVideoUrl && videoSrc && (
          <div className="flex-shrink-0">
            <div className="relative rounded-lg overflow-hidden" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.72 0.18 155 / 0.30)" }}>
              {videoIsLocal && (
                <div
                  title={`已缓存到本地（${new Date(videoDownloadedAt).toLocaleString("zh-CN")}）`}
                  className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
                  style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
              <video
                key={videoBlobUrl ?? videoSrc}
                src={videoBlobUrl ?? videoSrc}
                controls
                className="w-full nodrag"
                style={{ maxHeight: 160, display: "block" }}
                preload="metadata"
              />
            </div>
            <a
              href={`/api/video-proxy?url=${encodeURIComponent(payload.resultVideoUrl)}&download=1`}
              download
              className="nodrag mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: "oklch(0.72 0.18 155 / 0.10)",
                borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.72 0.18 155 / 0.30)",
                color: "oklch(0.72 0.18 155)",
                textDecoration: "none",
              }}
            >
              <Download className="w-3 h-3" />
              下载视频
            </a>
            {!videoIsLocal && (
              <button
                onClick={handleVideoCache}
                disabled={videoCaching}
                className="nodrag mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "transparent", borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t3)", cursor: videoCaching ? "not-allowed" : "pointer" }}
              >
                {videoCaching
                  ? <><Loader2 className="w-3 h-3 animate-spin" />{videoCacheProgress > 0 ? ` ${videoCacheProgress}%` : " 缓存中..."}</>
                  : <><HardDriveDownload className="w-3 h-3" /> 缓存到本地</>}
              </button>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {payload.status === "failed" && payload.errorMessage && (
          <div className="flex items-start gap-2 p-2 rounded-lg flex-shrink-0" style={{ background: "oklch(0.62 0.20 25 / 0.08)", borderWidth: 1, borderStyle: "solid", borderColor: "oklch(0.62 0.20 25 / 0.30)" }}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.20 25)" }} />
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

        {/* ── ComfyUI URL ── */}
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
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="http://127.0.0.1:8188（留空使用全局默认）"
                  value={payload.customBaseUrl ?? ""}
                  onChange={(e) => update("customBaseUrl", e.target.value)}
                  className="nodrag flex-1"
                  style={fieldBase}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
                <button
                  onClick={() => { modelsQuery.refetch(); }}
                  disabled={modelsQuery.isFetching}
                  className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
                  title="刷新模型列表"
                  style={{
                    width: 30, height: 30,
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-bd2)",
                    color: modelsQuery.isFetching ? "var(--c-t4)" : accent,
                    cursor: modelsQuery.isFetching ? "wait" : "pointer",
                  }}
                >
                  <RefreshCw className={modelsQuery.isFetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
                </button>
              </div>
              {/* Connection status — visible cue when fetchModels failed */}
              {modelsQuery.isFetching ? (
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px]" style={{ color: "var(--c-t4)" }}>
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> 正在拉取模型列表…
                </div>
              ) : (modelsQuery.isError || (modelsQuery.data?.ckpts.length ?? 0) === 0) ? (
                <div className="flex items-start gap-1.5 mt-1.5 text-[10px]" style={{ color: "oklch(0.62 0.20 25)" }}>
                  <span>⚠️</span>
                  <span>未拉到模型 — 本应用服务器无法访问该 ComfyUI 地址。检查 --listen / 防火墙 / 网络可达性。</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px]" style={{ color: "oklch(0.65 0.18 145)" }}>
                  <span>●</span> 已连接 — {modelsQuery.data?.ckpts.length} 个 checkpoint
                </div>
              )}
              <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 4 }}>
                每个节点独立配置，仅 http(s) 协议。
              </p>
            </div>
          )}
        </div>

        {/* ── Workflow template ── */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            Workflow 模板
          </label>
          <select
            value={payload.workflowTemplate ?? "animatediff"}
            onChange={(e) => update("workflowTemplate", e.target.value as "animatediff" | "svd")}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="animatediff">AnimateDiff — 文生视频</option>
            <option value="svd">SVD — 图生视频</option>
          </select>
        </div>

        {/* ── Prompt ── */}
        <div>
          <label style={labelStyle}>提示词 *</label>
          <textarea className="nodrag nowheel"
            placeholder="描述视频内容..."
            value={payload.prompt ?? ""}
            onChange={(e) => update("prompt", e.target.value)}
            rows={3}
            
            style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
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
        </div>

        {/* ── Checkpoint ── */}
        <div>
          <label style={labelStyle}>Checkpoint *</label>
          <input
            list={`comfyui-vid-ckpts-${id}`}
            placeholder={isSvd ? "如 svd_xt.safetensors" : "如 sd_v1-5_pruned.safetensors"}
            value={payload.ckpt ?? ""}
            onChange={(e) => update("ckpt", e.target.value)}
            className="nodrag"
            style={fieldBase}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <datalist id={`comfyui-vid-ckpts-${id}`}>
            {(modelsQuery.data?.ckpts ?? []).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* ── Motion module (AnimateDiff only) ── */}
        {!isSvd && (
          <div>
            <label style={labelStyle}>Motion Module *</label>
            <input
              list={`comfyui-vid-motion-${id}`}
              placeholder="如 mm_sd_v15_v2.ckpt"
              value={payload.motionModule ?? ""}
              onChange={(e) => update("motionModule", e.target.value)}
              className="nodrag"
              style={fieldBase}
              onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
            />
            <datalist id={`comfyui-vid-motion-${id}`}>
              {(modelsQuery.data?.motionModules ?? []).map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
        )}

        {/* ── Advanced params ── */}
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
              采样 / 视频参数
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
                <label style={labelStyle}>Frames</label>
                <input
                  type="number" min={1} max={256}
                  value={payload.frames ?? 16}
                  onChange={(e) => update("frames", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>FPS</label>
                <input
                  type="number" min={1} max={60}
                  value={payload.fps ?? 8}
                  onChange={(e) => update("fps", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Width / Height */}
              <div>
                <label style={labelStyle}>宽度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  placeholder="默认"
                  value={payload.width ?? ""}
                  onChange={(e) => update("width", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              <div>
                <label style={labelStyle}>高度</label>
                <input
                  type="number" min={64} max={2048} step={8}
                  placeholder="默认"
                  value={payload.height ?? ""}
                  onChange={(e) => update("height", e.target.value ? Number(e.target.value) : undefined)}
                  className="nodrag" style={fieldBase}
                />
              </div>
              {/* Sampler */}
              <div>
                <label style={labelStyle}>采样器</label>
                <input
                  list={`comfyui-vid-samplers-${id}`}
                  placeholder="euler"
                  value={payload.sampler ?? ""}
                  onChange={(e) => update("sampler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-vid-samplers-${id}`}>
                  {(modelsQuery.data?.samplers ?? []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {/* Scheduler */}
              <div>
                <label style={labelStyle}>调度器</label>
                <input
                  list={`comfyui-vid-schedulers-${id}`}
                  placeholder="normal"
                  value={payload.scheduler ?? ""}
                  onChange={(e) => update("scheduler", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-vid-schedulers-${id}`}>
                  {(modelsQuery.data?.schedulers ?? ["normal", "karras", "exponential", "sgm_uniform", "simple"]).map((s) => <option key={s} value={s} />)}
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
                  list={`comfyui-vid-vaes-${id}`}
                  placeholder="ae.safetensors"
                  value={payload.vae ?? ""}
                  onChange={(e) => update("vae", e.target.value || undefined)}
                  className="nodrag" style={fieldBase}
                />
                <datalist id={`comfyui-vid-vaes-${id}`}>
                  {(modelsQuery.data?.vaes ?? []).map((v) => <option key={v} value={v} />)}
                </datalist>
              </div>
              {/* Seed */}
              <div className="col-span-2">
                <label style={labelStyle}>Seed（-1 随机）</label>
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

        {/* ── Reference image upload (SVD or optional for AnimateDiff) ── */}
        <div>
          <label style={labelStyle}>
            参考图 {isSvd ? "*" : "（可选）"}
          </label>
          {payload.referenceImageUrl ? (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{ height: 80, borderWidth: 1, borderStyle: "solid", borderColor: BORDER_DEFAULT, background: "var(--c-canvas)" }}
            >
              <img
                src={payload.referenceImageUrl}
                alt="reference"
                className="w-full h-full object-cover"
                draggable={false}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <button
                onClick={() => update("referenceImageUrl", undefined)}
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
        </div>

        {/* ── Progress bar ── */}
        {payload.status === "processing" && payload.progress != null && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ height: 4, borderRadius: 2, background: "var(--c-bd2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${payload.progress}%`, background: accent, transition: "width 300ms ease", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 2, display: "block" }}>{payload.progress}%</span>
          </div>
        )}

        {/* ── Action button ── */}
        <button
          onClick={handleGenerate}
          disabled={genMutation.isPending || !payload.prompt?.trim() || !payload.ckpt?.trim() || payload.status === "processing"}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: genMutation.isPending || payload.status === "processing"
              ? "var(--c-surface)"
              : "linear-gradient(135deg, oklch(0.62 0.22 50 / 0.18), oklch(0.65 0.22 35 / 0.18))",
            borderWidth: 1, borderStyle: "solid",
            borderColor: genMutation.isPending || payload.status === "processing" ? BORDER_DEFAULT : BORDER_ACCENT,
            color: genMutation.isPending || payload.status === "processing" ? "var(--c-t4)" : accent,
            cursor: genMutation.isPending || payload.status === "processing" ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
            marginTop: 12,
          }}
        >
          {genMutation.isPending || payload.status === "processing"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : (payload.status === "done" ? <RefreshCw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />)
          }
          {genMutation.isPending || payload.status === "processing"
            ? "ComfyUI 生成中..."
            : (payload.status === "done" ? "重新生成" : "运行 ComfyUI")
          }
        </button>

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
          background: "oklch(0.68 0.22 285 / 0.85)",
          border: "2px solid var(--c-canvas)",
          left: -6,
          top: "25%",
        }}
        title="参考图输入"
      />

      {/* Output handle — provided by BaseNode default (id="output" on Position.Right);
          no custom handle to avoid overlapping with the default. */}
    </BaseNode>
  );
});
