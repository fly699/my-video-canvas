import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { ComfyuiVideoNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Play, Loader2, RefreshCw, Upload, X, Cpu, Download, AlertCircle,
  ChevronDown, ChevronRight, Server, Boxes, HardDriveDownload, Languages, Copy, Lock, Unlock, Ban,
} from "lucide-react";
import { useLocalMedia } from "@/lib/useLocalMedia";
import { cacheMedia } from "@/lib/mediaCache";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";

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
  const [translating, setTranslating] = useState(false);
  const [llmModel, setLlmModel] = useState<LLMModelId>("claude-haiku-4-5-20251001");
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

  // Set when the user cancels: the blocking generate request can't be aborted
  // client-side, so skip overwriting the node when it eventually settles.
  const cancelledRef = useRef(false);
  const genMutation = trpc.comfyui.generateVideo.useMutation({
    onSuccess: (result) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      if (cancelledRef.current) { cancelledRef.current = false; return; }
      updateNodeData(id, { resultVideoUrl: result.url, status: "done", errorMessage: undefined, progress: undefined });
      toast.success("ComfyUI 视频生成成功");
    },
    onError: (err) => {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === id)) return;
      if (cancelledRef.current) { cancelledRef.current = false; return; }
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

  const handleTranslate = (field: "prompt" | "negPrompt" = "prompt") => {
    if (translating || translateMutation.isPending) return;
    const text = field === "prompt" ? payload.prompt : payload.negPrompt;
    if (!text?.trim()) { toast.error(field === "prompt" ? "请先填写提示词" : "请先填写反向提示词"); return; }
    translateTargetRef.current = field;
    setTranslating(true);
    translateMutation.mutate({ text, mode: "translate_en", model: llmModel });
  };

  // Cancel a running ComfyUI job (POST /interrupt).
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

  // Recover from a stale "processing" state after a page reload.
  useEffect(() => {
    if (payload.status === "processing") {
      updateNodeData(id, { status: "failed", errorMessage: "生成已中断（页面刷新或连接断开），请重新运行。", progress: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed lock (ComfyUI uses -1 for random each run).
  const seedLocked = typeof payload.seed === "number" && payload.seed >= 0;
  const toggleSeedLock = () => {
    if (seedLocked) update("seed", -1);
    else update("seed", Math.floor(Math.random() * 2147483647));
  };

  // Sync shared ComfyUI config to ALL other comfyui_video nodes on the canvas.
  // Per-node fields (prompt / seed / reference image / result) are NOT synced.
  const syncToAllComfyVideos = useCallback(() => {
    const { nodes: allNodes, batchUpdateNodeData } = useCanvasStore.getState();
    const targets = allNodes.filter((n) => n.data.nodeType === "comfyui_video" && n.id !== id);
    if (targets.length === 0) { toast.info("当前画布只有这一个 ComfyUI 视频节点"); return; }
    const p = payload;
    const patch: Partial<ComfyuiVideoNodeData> = {
      customBaseUrl: p.customBaseUrl,
      workflowTemplate: p.workflowTemplate,
      negPrompt: p.negPrompt,
      ckpt: p.ckpt,
      motionModule: p.motionModule,
      clip: p.clip,
      clipVision: p.clipVision,
      steps: p.steps,
      cfg: p.cfg,
      frames: p.frames,
      fps: p.fps,
      width: p.width,
      height: p.height,
      sampler: p.sampler,
      scheduler: p.scheduler,
      denoise: p.denoise,
      vae: p.vae,
      batchSize: p.batchSize,
    };
    batchUpdateNodeData(targets.map((t) => ({ id: t.id, payload: patch })));
    toast.success(`已同步配置到 ${targets.length} 个 ComfyUI 视频节点`);
  }, [id, payload]);

  const tpl = payload.workflowTemplate ?? "animatediff";
  const isSvd = tpl === "svd";
  const isWanI2V = tpl === "wan_i2v";
  const needsRef = isSvd || isWanI2V;
  const isAnimateDiff = tpl === "animatediff";
  const usesClip = tpl === "wan_t2v" || tpl === "wan_i2v" || tpl === "ltxv";
  const usesClipVision = isWanI2V;

  const handleGenerate = () => {
    if (genMutation.isPending) return;
    if (uploading) { toast.error("参考图正在上传中，请稍候"); return; }
    if (!payload.prompt?.trim()) { toast.error("请先填写提示词"); return; }
    if (!payload.ckpt?.trim()) { toast.error("请先填写模型名称"); return; }
    if (needsRef && !payload.referenceImageUrl) {
      toast.error("该模板需要起始图/参考图"); return;
    }
    if (isAnimateDiff && !payload.motionModule?.trim()) {
      toast.error("AnimateDiff 模板需要 Motion Module 名称"); return;
    }
    cancelledRef.current = false;
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
      clip: payload.clip?.trim() || undefined,
      clipVision: payload.clipVision?.trim() || undefined,
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
    <BaseNode id={id} selected={selected} nodeType="comfyui_video" title={data.title} minHeight={300} heroMedia={heroMedia}
      onRun={handleGenerate} running={genMutation.isPending || payload.status === "processing"} canRun={!!payload.prompt?.trim() && !!payload.ckpt?.trim()} hasResult={payload.status === "done" && !!payload.resultVideoUrl}>
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

        {/* ── Sync config to all ComfyUI video nodes ── */}
        <button
          onClick={syncToAllComfyVideos}
          title="把当前服务器地址 / Checkpoint / 运动模块 / 采样参数等配置同步到画布中所有其他 ComfyUI 视频节点（不含提示词、Seed、参考图、结果视频）"
          className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10.5px] transition-all"
          style={{
            background: "oklch(0.62 0.22 50 / 0.08)",
            border: "1px dashed oklch(0.62 0.22 50 / 0.4)",
            color: accent,
            cursor: "pointer",
            marginBottom: 4,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.22 50 / 0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.22 50 / 0.08)"; }}
        >
          <Copy className="w-3 h-3" />
          同步配置到全部 ComfyUI 视频节点
        </button>

        {/* ── Workflow template ── */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu style={{ width: 10, height: 10 }} />
            Workflow 模板
          </label>
          <select
            value={payload.workflowTemplate ?? "animatediff"}
            onChange={(e) => {
              // Switching template prefills its recommended frames/fps/size.
              const t = e.target.value as NonNullable<ComfyuiVideoNodeData["workflowTemplate"]>;
              const presets: Record<string, { frames: number; fps: number; width: number; height: number }> = {
                animatediff: { frames: 16, fps: 8, width: 512, height: 512 },
                svd: { frames: 25, fps: 8, width: 1024, height: 576 },
                wan_t2v: { frames: 81, fps: 16, width: 832, height: 480 },
                wan_i2v: { frames: 81, fps: 16, width: 832, height: 480 },
                ltxv: { frames: 97, fps: 25, width: 768, height: 512 },
              };
              updateNodeData(id, { workflowTemplate: t, ...presets[t] });
            }}
            className="nodrag"
            style={{ ...fieldBase, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            <option value="animatediff">AnimateDiff — 文生视频</option>
            <option value="svd">SVD — 图生视频</option>
            <option value="wan_t2v">Wan 2.1/2.2 — 文生视频</option>
            <option value="wan_i2v">Wan 2.1/2.2 — 图生视频</option>
            <option value="ltxv">LTX-Video — 文生视频（快）</option>
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

        {/* ── Main model (Checkpoint or UNET) ── */}
        <div>
          <label style={labelStyle}>{usesClip ? "模型（UNET/Checkpoint）*" : "Checkpoint *"}</label>
          <input
            list={`comfyui-vid-ckpts-${id}`}
            placeholder={isSvd ? "如 svd_xt.safetensors" : usesClip ? "如 wan2.2_t2v_…fp8.safetensors" : "如 sd_v1-5_pruned.safetensors"}
            value={payload.ckpt ?? ""}
            onChange={(e) => update("ckpt", e.target.value)}
            className="nodrag"
            style={fieldBase}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <datalist id={`comfyui-vid-ckpts-${id}`}>
            {((usesClip && payload.workflowTemplate?.startsWith("wan") ? modelsQuery.data?.unets : modelsQuery.data?.ckpts) ?? []).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* ── CLIP text encoder (Wan / LTX) ── */}
        {usesClip && (
          <div>
            <label style={labelStyle}>CLIP 文本编码器（留空用推荐默认）</label>
            <input
              list={`comfyui-vid-clip-${id}`}
              placeholder={payload.workflowTemplate === "ltxv" ? "t5xxl_fp16.safetensors" : "umt5_xxl_fp8_e4m3fn_scaled.safetensors"}
              value={payload.clip ?? ""}
              onChange={(e) => update("clip", e.target.value)}
              className="nodrag" style={{ ...fieldBase, fontSize: 10.5 }}
            />
            <datalist id={`comfyui-vid-clip-${id}`}>
              {(modelsQuery.data?.clips ?? []).map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        )}

        {/* ── CLIP Vision (Wan I2V) ── */}
        {usesClipVision && (
          <div>
            <label style={labelStyle}>CLIP Vision（图生视频，留空用默认）</label>
            <input
              list={`comfyui-vid-clipvision-${id}`}
              placeholder="clip_vision_h.safetensors"
              value={payload.clipVision ?? ""}
              onChange={(e) => update("clipVision", e.target.value)}
              className="nodrag" style={{ ...fieldBase, fontSize: 10.5 }}
            />
            <datalist id={`comfyui-vid-clipvision-${id}`}>
              {(modelsQuery.data?.clipVisions ?? []).map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        )}

        {/* ── Motion module (AnimateDiff only) ── */}
        {isAnimateDiff && (
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

        {/* ── Start/reference image (SVD / Wan I2V) ── */}
        {needsRef && (
        <div>
          <label style={labelStyle}>
            起始图 *
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
        </div>
        )}

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
