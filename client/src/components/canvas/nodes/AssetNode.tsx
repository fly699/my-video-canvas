import { memo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import type { AssetNodeData } from "../../../../../shared/types";
import { FileVideo, FileImage, FileAudio, File, ExternalLink, Upload, RefreshCw, Loader2 } from "lucide-react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { url: result.url, storageKey: result.storageKey });
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
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { toast.error("文件不能超过 32MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

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
          style={{ height: 140, border: "1px solid var(--c-bd2)" }}
        >
          <img src={payload.url} alt={payload.name} className="w-full h-full object-cover" draggable={false} />
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
              href={payload.url}
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
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--c-bd2)" }}
        >
          <video src={payload.url} controls className="w-full nodrag" style={{ maxHeight: 160, display: "block" }} />
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
        <a href={payload.url} target="_blank" rel="noopener noreferrer" className="nodrag">
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
        <img
          src={payload.url}
          style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }}
          draggable={false}
          alt={payload.name}
        />
      );
    }
    if (payload.url && payload.type === "video") {
      return (
        <video
          src={payload.url}
          controls
          style={{ width: "100%", maxHeight: 200, display: "block" }}
          className="nodrag"
        />
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
    return (
      <div className="node-hero-placeholder" style={{ minHeight: 120 }}>
        <File style={{ width: 24, height: 24, color: "var(--c-t4)" }} />
        <span style={{ fontSize: 11, color: "var(--c-t4)", marginTop: 6 }}>无素材</span>
      </div>
    );
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
    </BaseNode>
  );
});
