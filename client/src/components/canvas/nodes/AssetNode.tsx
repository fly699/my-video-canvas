import { memo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import type { AssetNodeData } from "../../../../../shared/types";
import { FileVideo, FileImage, FileAudio, File, ExternalLink, Upload, RefreshCw, Loader2, Play, X } from "lucide-react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { safeHref } from "@/lib/safeUrl";
import { mediaFetchUrl } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { MediaImage } from "../MediaImage";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "asset";
    title: string;
    payload: AssetNodeData;
    projectId: number;
  };
}

const accentColor = "oklch(0.65 0.18 60)";

export const AssetNode = memo(function AssetNode({ id, selected, data }: Props) {
  const payload = data.payload;
  const { updateNodeData } = useCanvasStore();
  const [uploading, setUploading] = useState(false);
  const [videoPreview, setVideoPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const replacedMimeRef = useRef<string | undefined>(undefined);
  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      // The replace input accepts image/video/audio, so re-derive type+mimeType from
      // the new file — otherwise replacing e.g. an image asset with a video leaves
      // type="image" and the preview renders an <img> on a video URL (broken).
      const mt = replacedMimeRef.current;
      const newType = mt?.startsWith("video/") ? "video" : mt?.startsWith("audio/") ? "audio" : mt?.startsWith("image/") ? "image" : undefined;
      updateNodeData(id, {
        url: result.url,
        storageKey: result.storageKey,
        ...(mt ? { mimeType: mt } : {}),
        ...(newType ? { type: newType } : {}),
      });
      setUploading(false);
      toast.success("素材已替换");
    },
    onError: (err) => {
      setUploading(false);
      toast.error("上传失败：" + err.message);
    },
  });

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { toast.error("文件不能超过 32MB"); return; }
    replacedMimeRef.current = file.type || undefined;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
  };

  // 绿点指示：素材是否已落到我方 MinIO 长期存储（/manus-storage/ 路径）。
  const storedInMinio = isOwnStorageUrl(payload.url);

  const renderPreview = () => {
    if (!payload.url) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-lg"
          style={{
            height: 120,
            background: "var(--c-input)",
            border: "1px solid var(--c-bd1)",
          }}
        >
          <File className="w-7 h-7 mb-2" style={{ color: "var(--c-t4)" }} />
          <span className="text-xs" style={{ color: "var(--c-t4)" }}>无素材</span>
        </div>
      );
    }

    if (payload.type === "image") {
      return (
        <div
          className="relative rounded-lg overflow-hidden group/img"
          style={{ height: 140, border: "1px solid var(--c-bd2)", background: "var(--c-canvas)" }}
        >
          {storedInMinio && (
            <div
              title="已存储到 MinIO·长期有效"
              className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
              style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
            />
          )}
          <MediaImage src={payload.url} alt={payload.name} className="w-full h-full object-contain" draggable={false} />
          <div
            className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-end justify-end p-2"
            style={{ background: "oklch(0 0 0 / 0.40)" }}
          >
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click(); }}
              disabled={uploading}
              className="nodrag w-6 h-6 rounded-md flex items-center justify-center mr-1"
              style={{ background: "oklch(0 0 0 / 0.60)", color: "var(--c-t1)" }}
              title="替换图片"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <a
              href={safeHref(payload.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="nodrag w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: "oklch(0 0 0 / 0.60)", color: "var(--c-t1)" }}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      );
    }

    if (payload.type === "video") {
      return (
        <div
          className="relative rounded-lg overflow-hidden nodrag"
          style={{ border: "1px solid var(--c-bd2)", cursor: "zoom-in" }}
          onClick={() => setVideoPreview(true)}
          title="点击播放"
        >
          {storedInMinio && (
            <div
              title="已存储到 MinIO·长期有效"
              className="absolute top-1.5 left-1.5 z-10 w-2.5 h-2.5 rounded-full pointer-events-none"
              style={{ background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
            />
          )}
          {/* First-frame thumbnail (like images) — playback opens in an overlay */}
          <video src={mediaFetchUrl(payload.url)} muted preload="metadata" className="w-full" style={{ maxHeight: 160, display: "block", objectFit: "cover" }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.5)" }}>
              <Play className="w-5 h-5 text-white" fill="white" />
            </div>
          </div>
        </div>
      );
    }

    const Icon = payload.type === "audio" ? FileAudio : File;
    return (
      <div
        className="flex items-center gap-3 p-3 rounded-lg"
        style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
        >
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: "var(--c-t1)" }}>{payload.name}</p>
          {payload.size && (
            <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>
              {(payload.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
        </div>
        {storedInMinio && (
          <div
            title="已存储到 MinIO·长期有效"
            style={{ width: 8, height: 8, borderRadius: "50%", background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2px oklch(0.72 0.18 155 / 0.35)", flexShrink: 0 }}
          />
        )}
        <a href={safeHref(payload.url)} target="_blank" rel="noopener noreferrer" className="nodrag">
          <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--c-t4)" }} />
        </a>
      </div>
    );
  };

  const TypeIcon =
    payload.type === "video" ? FileVideo :
    payload.type === "audio" ? FileAudio :
    payload.type === "image" ? FileImage : File;

  const heroMedia = (() => {
    if (payload.url && payload.type === "image") {
      return (
        <div className="relative" style={{ width: "100%", minHeight: 96, background: "var(--c-canvas)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* contain（非 cover）+ 最小高度：收缩态下也能看全整张参考图，不被裁成一条 */}
          <MediaImage
            src={payload.url}
            style={{ width: "100%", maxHeight: 240, objectFit: "contain", display: "block" }}
            draggable={false}
            alt={payload.name}
          />
          {storedInMinio && (
            <div
              title="已存储到 MinIO·长期有效"
              className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
              style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
            />
          )}
        </div>
      );
    }
    if (payload.url && payload.type === "video") {
      return (
        <div className="relative nodrag" style={{ cursor: "zoom-in" }} onClick={() => setVideoPreview(true)} title="点击播放">
          <video src={mediaFetchUrl(payload.url)} muted preload="metadata" style={{ width: "100%", maxHeight: 200, display: "block", objectFit: "cover" }} />
          {storedInMinio && (
            <div
              title="已存储到 MinIO·长期有效"
              className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
              style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.5)" }}>
              <Play className="w-5 h-5 text-white" fill="white" />
            </div>
          </div>
        </div>
      );
    }
    if (payload.url) {
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-lg"
          style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
          >
            <TypeIcon className="w-4 h-4" style={{ color: accentColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: "var(--c-t1)" }}>{payload.name}</p>
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <BaseNode id={id} selected={selected} nodeType="asset" title={data.title} minHeight={160} resizable heroMedia={heroMedia}>
      <div className="p-3.5 flex flex-col gap-3">
        {renderPreview()}
        <div className="flex items-center gap-2">
          <TypeIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
          <span className="text-xs truncate flex-1" style={{ color: "var(--c-t3)" }}>
            {payload.name || "未命名素材"}
          </span>
          {payload.mimeType && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: `${accentColor}15`, color: accentColor, border: `1px solid ${accentColor}25` }}
            >
              {payload.mimeType.split("/")[1]?.toUpperCase() ?? payload.mimeType}
            </span>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] flex-shrink-0 transition-all"
            style={{
              background: "var(--c-input)",
              border: "1px solid var(--c-bd2)",
              color: "var(--c-t3)",
              cursor: uploading ? "not-allowed" : "pointer",
            }}
            title="替换素材"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {uploading ? "上传中" : "替换"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={handleReplace}
        />
      </div>

      {/* Video preview overlay (play here instead of embedded in the node) */}
      {videoPreview && payload.url && payload.type === "video" && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-6 nodrag nowheel"
          style={{ background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
          onClick={() => setVideoPreview(false)}
          onWheel={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="relative" style={{ maxWidth: "90vw", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <WatermarkedVideo src={mediaFetchUrl(payload.url)} controls autoPlay controlsList="nodownload" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 10, background: "#000" }} />
            <button
              onClick={() => setVideoPreview(false)}
              className="absolute flex items-center justify-center"
              style={{ top: -10, right: -10, width: 30, height: 30, borderRadius: "50%", background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </BaseNode>
  );
});
