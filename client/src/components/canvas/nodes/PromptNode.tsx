import { memo, useCallback, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { PromptNodeData } from "../../../../../shared/types";
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
    nodeType: "prompt";
    title: string;
    payload: PromptNodeData;
    projectId: number;
  };
}

export const PromptNode = memo(function PromptNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [generating, setGenerating] = useState(false);

  const genImageMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { imageUrl: result.url });
      setGenerating(false);
      toast.success("图像已生成");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error("生成失败：" + err.message);
    },
  });

  const handleChange = useCallback(
    (field: keyof PromptNodeData, value: string) => {
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const handleGenerate = () => {
    if (!payload.positivePrompt?.trim()) {
      toast.error("请先填写正向提示词");
      return;
    }
    setGenerating(true);
    genImageMutation.mutate({
      prompt: payload.positivePrompt,
      negativePrompt: payload.negativePrompt,
      style: payload.style,
    });
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="prompt" title={data.title} minHeight={200}>
      <div className="flex flex-col h-full p-3 gap-2">
        {/* Preview */}
        {payload.imageUrl && (
          <div className="relative rounded-lg overflow-hidden border border-border/30 flex-shrink-0" style={{ height: 100 }}>
            <img src={payload.imageUrl} alt="preview" className="w-full h-full object-cover" />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="absolute top-1.5 right-1.5 p-1 rounded glass text-muted-foreground hover:text-foreground"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">正向提示词</label>
          <Textarea
            placeholder="masterpiece, best quality, cinematic lighting..."
            value={payload.positivePrompt}
            onChange={(e) => handleChange("positivePrompt", e.target.value)}
            className="resize-none text-xs bg-transparent border-[oklch(0.68_0.22_300/0.3)] focus:border-[oklch(0.68_0.22_300/0.6)] nodrag font-mono"
            rows={3}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">反向提示词</label>
          <Textarea
            placeholder="blurry, low quality, distorted..."
            value={payload.negativePrompt ?? ""}
            onChange={(e) => handleChange("negativePrompt", e.target.value)}
            className="resize-none text-xs bg-transparent border-border/40 nodrag font-mono"
            rows={2}
          />
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="风格"
            value={payload.style ?? ""}
            onChange={(e) => handleChange("style", e.target.value)}
            className="flex-1 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
          <Input
            placeholder="比例 (16:9)"
            value={payload.aspectRatio ?? ""}
            onChange={(e) => handleChange("aspectRatio", e.target.value)}
            className="w-24 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
        </div>

        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={generating || !payload.positivePrompt?.trim()}
          className="h-7 text-xs gap-1.5 bg-[oklch(0.68_0.22_300/0.2)] hover:bg-[oklch(0.68_0.22_300/0.3)] border border-[oklch(0.68_0.22_300/0.4)] text-[oklch(0.68_0.22_300)] nodrag"
          variant="ghost"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {generating ? "生成中..." : "AI 生成图像"}
        </Button>
      </div>
    </BaseNode>
  );
});
