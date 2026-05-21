import { memo } from "react";
import { BaseNode } from "../BaseNode";
import type { AssetNodeData } from "../../../../../shared/types";
import { FileVideo, FileImage, FileAudio, File, ExternalLink } from "lucide-react";

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

  const renderPreview = () => {
    if (!payload.url) {
      return (
        <div
          className="flex flex-col items-center justify-center rounded-lg"
          style={{
            height: 120,
            background: "oklch(0.09 0.006 260)",
            border: "1px solid oklch(0.18 0.008 260)",
          }}
        >
          <File className="w-7 h-7 mb-2" style={{ color: "oklch(0.28 0.006 260)" }} />
          <span className="text-xs" style={{ color: "oklch(0.38 0.006 260)" }}>无素材</span>
        </div>
      );
    }

    if (payload.type === "image") {
      return (
        <div
          className="relative rounded-lg overflow-hidden group/img"
          style={{ height: 140, border: "1px solid oklch(0.20 0.008 260)" }}
        >
          <img src={payload.url} alt={payload.name} className="w-full h-full object-cover" draggable={false} />
          <div
            className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-end justify-end p-2"
            style={{ background: "oklch(0 0 0 / 0.40)" }}
          >
            <a
              href={payload.url}
              target="_blank"
              rel="noopener noreferrer"
              className="nodrag w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: "oklch(0 0 0 / 0.60)", color: "oklch(0.80 0.005 260)" }}
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
          style={{ border: "1px solid oklch(0.20 0.008 260)" }}
        >
          <video src={payload.url} controls className="w-full nodrag" style={{ maxHeight: 160, display: "block" }} />
        </div>
      );
    }

    const Icon = payload.type === "audio" ? FileAudio : File;
    return (
      <div
        className="flex items-center gap-3 p-3 rounded-lg"
        style={{ background: "oklch(0.09 0.006 260)", border: "1px solid oklch(0.18 0.008 260)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
        >
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: "oklch(0.80 0.006 260)" }}>{payload.name}</p>
          {payload.size && (
            <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.42 0.006 260)" }}>
              {(payload.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
        </div>
        <a href={payload.url} target="_blank" rel="noopener noreferrer" className="nodrag">
          <ExternalLink className="w-3.5 h-3.5" style={{ color: "oklch(0.45 0.008 260)" }} />
        </a>
      </div>
    );
  };

  const TypeIcon =
    payload.type === "video" ? FileVideo :
    payload.type === "audio" ? FileAudio :
    payload.type === "image" ? FileImage : File;

  return (
    <BaseNode id={id} selected={selected} nodeType="asset" title={data.title} minHeight={160}>
      <div className="p-3.5 flex flex-col gap-3">
        {renderPreview()}
        <div className="flex items-center gap-2">
          <TypeIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
          <span className="text-xs truncate flex-1" style={{ color: "oklch(0.55 0.008 260)" }}>
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
        </div>
      </div>
    </BaseNode>
  );
});
