import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import {
  Upload,
  X,
  FileImage,
  FileVideo,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";

interface Props {
  projectId: number;
  onClose: () => void;
}

export function AssetPanel({ projectId, onClose }: Props) {
  const { addNode } = useCanvasStore();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, refetch } = trpc.assets.list.useQuery({ projectId });

  const uploadMutation = trpc.assets.upload.useMutation({
    onSuccess: () => {
      toast.success("素材上传成功");
      refetch();
      setUploading(false);
    },
    onError: (err) => {
      toast.error("上传失败：" + err.message);
      setUploading(false);
    },
  });

  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => {
      toast.success("素材已删除");
      refetch();
    },
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        toast.error("文件大小不能超过 20MB");
        return;
      }

      setUploading(true);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const type = file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("image/")
          ? "image"
          : "other";

        uploadMutation.mutate({
          name: file.name,
          type,
          mimeType: file.type,
          size: file.size,
          base64,
          projectId,
        });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [projectId, uploadMutation]
  );

  const handleAddToCanvas = (asset: NonNullable<typeof assets>[0]) => {
    const node = addNode("asset", { x: 200, y: 200 });
    // The node data will be updated via store
    toast.success(`素材节点已添加到画布`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-sm font-medium">素材库</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5 text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Upload */}
      <div className="px-4 py-3 border-b border-border/30">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full gap-2 border-dashed border-border/60 hover:border-primary/40"
          variant="outline"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {uploading ? "上传中..." : "上传素材"}
        </Button>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
          支持图片、视频、音频，最大 20MB
        </p>
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {!assets || assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <FileImage className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground/50">暂无素材</p>
          </div>
        ) : (
          assets.map((asset) => (
            <div
              key={asset.id}
              className="group flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              {/* Thumbnail */}
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted/30 flex-shrink-0 border border-border/30">
                {asset.type === "image" ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileVideo className="w-5 h-5 text-muted-foreground/50" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{asset.name}</p>
                <p className="text-[10px] text-muted-foreground/50">
                  {asset.type} · {asset.size ? `${(asset.size / 1024).toFixed(0)}KB` : ""}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleAddToCanvas(asset)}
                  className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
                  title="添加到画布"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm("确认删除此素材？")) {
                      deleteMutation.mutate({ id: asset.id });
                    }
                  }}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
