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

export const AssetNode = memo(function AssetNode({ id, selected, data }: Props) {
  const payload = data.payload;

  const renderPreview = () => {
    if (!payload.url) {
      return (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/40 gap-2">
          <File className="w-8 h-8" />
          <span className="text-xs">无素材</span>
        </div>
      );
    }

    if (payload.type === "image") {
      return (
        <div className="relative rounded-lg overflow-hidden border border-border/30" style={{ height: 140 }}>
          <img src={payload.url} alt={payload.name} className="w-full h-full object-cover" />
          <a
            href={payload.url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-2 right-2 p-1.5 rounded-lg glass text-muted-foreground hover:text-foreground nodrag"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      );
    }

    if (payload.type === "video") {
      return (
        <div className="rounded-lg overflow-hidden border border-border/30">
          <video
            src={payload.url}
            controls
            className="w-full nodrag"
            style={{ maxHeight: 160 }}
          />
        </div>
      );
    }

    const Icon = payload.type === "audio" ? FileAudio : File;
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-muted/20">
        <Icon className="w-6 h-6 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{payload.name}</p>
          {payload.size && (
            <p className="text-[10px] text-muted-foreground">
              {(payload.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
        </div>
        <a href={payload.url} target="_blank" rel="noopener noreferrer" className="nodrag">
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </a>
      </div>
    );
  };

  const TypeIcon =
    payload.type === "video"
      ? FileVideo
      : payload.type === "audio"
      ? FileAudio
      : payload.type === "image"
      ? FileImage
      : File;

  return (
    <BaseNode id={id} selected={selected} nodeType="asset" title={data.title} minHeight={160}>
      <div className="p-3 flex flex-col gap-2">
        {renderPreview()}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TypeIcon className="w-3.5 h-3.5" />
          <span className="truncate">{payload.name || "未命名素材"}</span>
          {payload.mimeType && (
            <span className="ml-auto text-[10px] opacity-60">{payload.mimeType}</span>
          )}
        </div>
      </div>
    </BaseNode>
  );
});
