import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { StoryboardNodeData } from "../../../../../shared/types";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, ImageIcon, Loader2, RefreshCw } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "storyboard";
    title: string;
    payload: StoryboardNodeData;
    projectId: number;
  };
}

export const StoryboardNode = memo(function StoryboardNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { imageUrl: result.url });
      setGenerating(false);
      toast.success("分镜图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("图像生成失败：" + err.message);
    },
  });

  const handleChange = useCallback(
    (field: keyof StoryboardNodeData, value: string | number) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.promptText?.trim()) {
      toast.error("请先填写提示词");
      return;
    }
    setGenerating(true);
    genImageMutation.mutate({
      prompt: payload.promptText,
      negativePrompt: payload.negativePrompt,
      style: payload.colorTone,
    });
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="storyboard" title={data.title} minHeight={280}>
      <div className="flex flex-col h-full p-3 gap-2">
        {/* Image preview */}
        <div
          className="relative rounded-lg overflow-hidden bg-muted/30 border border-border/30 flex-shrink-0"
          style={{ height: 140 }}
        >
          {payload.imageUrl ? (
            <>
              <img
                src={payload.imageUrl}
                alt="分镜"
                className="w-full h-full object-cover"
                draggable={false}
              />
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="absolute top-2 right-2 p-1.5 rounded-lg glass text-muted-foreground hover:text-foreground transition-colors"
                title="重新生成"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
              <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerate}
                disabled={generating || !payload.promptText?.trim()}
                className="h-7 text-xs gap-1.5 border-[oklch(0.65_0.20_160/0.4)] hover:border-[oklch(0.65_0.20_160)] nodrag"
              >
                {generating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {generating ? "生成中..." : "AI 生成分镜"}
              </Button>
            </div>
          )}
        </div>

        {/* Scene info */}
        <div className="flex gap-2">
          <Input
            placeholder="场景编号"
            type="number"
            value={payload.sceneNumber ?? ""}
            onChange={(e) => handleChange("sceneNumber", Number(e.target.value))}
            className="w-20 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
          <Input
            placeholder="时长(秒)"
            type="number"
            value={payload.duration ?? ""}
            onChange={(e) => handleChange("duration", Number(e.target.value))}
            className="w-20 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
          <Input
            placeholder="运镜"
            value={payload.cameraMovement ?? ""}
            onChange={(e) => handleChange("cameraMovement", e.target.value)}
            className="flex-1 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
        </div>

        <Textarea
          placeholder="场景描述..."
          value={payload.description}
          onChange={(e) => handleChange("description", e.target.value)}
          className="resize-none text-xs bg-transparent border-border/40 nodrag"
          rows={2}
        />

        <Textarea
          placeholder="正向提示词（用于 AI 生图）..."
          value={payload.promptText ?? ""}
          onChange={(e) => handleChange("promptText", e.target.value)}
          className="resize-none text-xs bg-transparent border-border/40 focus:border-[oklch(0.65_0.20_160/0.6)] nodrag font-mono"
          rows={2}
        />

        <Input
          placeholder="反向提示词（可选）"
          value={payload.negativePrompt ?? ""}
          onChange={(e) => handleChange("negativePrompt", e.target.value)}
          className="h-7 text-xs bg-transparent border-border/40 nodrag font-mono"
        />

        <div className="flex gap-2">
          <Input
            placeholder="色调/风格"
            value={payload.colorTone ?? ""}
            onChange={(e) => handleChange("colorTone", e.target.value)}
            className="flex-1 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
          <Input
            placeholder="镜头"
            value={payload.lens ?? ""}
            onChange={(e) => handleChange("lens", e.target.value)}
            className="flex-1 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
        </div>
      </div>
    </BaseNode>
  );
});
