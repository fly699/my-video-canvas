import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../ui/dialog";
import { Checkbox } from "../ui/checkbox";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import type { NodeData } from "../../../../shared/types";

interface FieldCategory {
  key: string;
  label: string;
  fields: string[];
}

// Per-node-type category → field map. Per-node fields (prompt / seed / reference
// image / result / status) are intentionally excluded — they are never synced.
const IMAGE_CATEGORIES: FieldCategory[] = [
  { key: "conn", label: "基础 / 连接", fields: ["serverUrls", "customBaseUrl", "workflowTemplate", "negPrompt"] },
  { key: "model", label: "模型", fields: ["ckpt", "vae", "upscaleModel"] },
  { key: "sampling", label: "采样参数", fields: ["steps", "cfg", "width", "height", "sampler", "scheduler", "denoise", "batchSize"] },
  { key: "lora", label: "LoRA", fields: ["loras", "lora", "loraStrength"] },
  { key: "controlnet", label: "ControlNet", fields: ["controlnet"] },
  { key: "ipadapter", label: "IPAdapter", fields: ["ipadapter"] },
];

const VIDEO_CATEGORIES: FieldCategory[] = [
  { key: "conn", label: "基础 / 连接", fields: ["serverUrls", "customBaseUrl", "workflowTemplate", "negPrompt"] },
  { key: "model", label: "模型", fields: ["ckpt", "motionModule", "clip", "clipVision", "vae"] },
  { key: "sampling", label: "采样参数", fields: ["steps", "cfg", "frames", "fps", "width", "height", "sampler", "scheduler", "denoise", "batchSize"] },
];

export function SyncConfigDialog({
  open, onOpenChange, sourceId, nodeType, accent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceId: string;
  nodeType: "comfyui_image" | "comfyui_video";
  accent: string;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const batchUpdateNodeData = useCanvasStore((s) => s.batchUpdateNodeData);

  const categories = nodeType === "comfyui_image" ? IMAGE_CATEGORIES : VIDEO_CATEGORIES;
  const label = nodeType === "comfyui_image" ? "图像" : "视频";

  // Candidate target nodes: same type, excluding the source.
  const candidates = useMemo(
    () => nodes.filter((n) => n.data.nodeType === nodeType && n.id !== sourceId),
    [nodes, nodeType, sourceId],
  );

  // Smart default: prefer "sibling branch" nodes — those that share at least one
  // upstream source with the current node. Fall back to ALL same-type nodes when
  // the source has no upstream, or no sibling shares a source.
  const smartDefaultTargets = useMemo(() => {
    const upstream = new Set(edges.filter((e) => e.target === sourceId).map((e) => e.source));
    const matched = new Set<string>();
    if (upstream.size > 0) {
      for (const t of candidates) {
        const tUp = edges.filter((e) => e.target === t.id).map((e) => e.source);
        if (tUp.some((s) => upstream.has(s))) matched.add(t.id);
      }
    }
    if (matched.size > 0) return matched;
    return new Set(candidates.map((t) => t.id)); // fallback: all
  }, [candidates, edges, sourceId]);

  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());

  // Reset selections each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelectedTargets(new Set(smartDefaultTargets));
    setSelectedCats(new Set(categories.map((c) => c.key))); // categories default all-selected
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  const nodeTitle = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return (n?.data as { title?: string } | undefined)?.title || id.slice(0, 8);
  };

  const apply = () => {
    if (selectedTargets.size === 0) { toast.info("请至少选择一个目标节点"); return; }
    if (selectedCats.size === 0) { toast.info("请至少选择一类参数"); return; }
    const source = nodes.find((n) => n.id === sourceId);
    if (!source) return;
    const sp = source.data as Record<string, unknown>;
    const fields = categories.filter((c) => selectedCats.has(c.key)).flatMap((c) => c.fields);
    const patch: Record<string, unknown> = {};
    for (const f of fields) patch[f] = sp[f];
    const targets = Array.from(selectedTargets);
    batchUpdateNodeData(targets.map((id) => ({ id, payload: patch as Partial<NodeData> })));
    toast.success(`已同步配置到 ${targets.length} 个 ComfyUI ${label}节点`);
    onOpenChange(false);
  };

  const allTargetsSelected = candidates.length > 0 && selectedTargets.size === candidates.length;
  const allCatsSelected = selectedCats.size === categories.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>同步配置到其他 ComfyUI {label}节点</DialogTitle>
          <DialogDescription>
            选择目标节点与要同步的参数类别。提示词、Seed、参考图、结果等逐节点字段不会被同步。
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">当前画布只有这一个 ComfyUI {label}节点。</p>
        ) : (
          <div className="grid grid-cols-2 gap-5 max-h-[50vh] overflow-y-auto">
            {/* 目标节点 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">目标节点（{selectedTargets.size}/{candidates.length}）</span>
                <button
                  className="text-xs"
                  style={{ color: accent }}
                  onClick={() => setSelectedTargets(allTargetsSelected ? new Set() : new Set(candidates.map((t) => t.id)))}
                >
                  {allTargetsSelected ? "全不选" : "全选"}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {candidates.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedTargets.has(t.id)}
                      onCheckedChange={() => setSelectedTargets((s) => toggle(s, t.id))}
                    />
                    <span className="truncate" title={nodeTitle(t.id)}>{nodeTitle(t.id)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 参数类别 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">参数类别（{selectedCats.size}/{categories.length}）</span>
                <button
                  className="text-xs"
                  style={{ color: accent }}
                  onClick={() => setSelectedCats(allCatsSelected ? new Set() : new Set(categories.map((c) => c.key)))}
                >
                  {allCatsSelected ? "全不选" : "全选"}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedCats.has(c.key)}
                      onCheckedChange={() => setSelectedCats((s) => toggle(s, c.key))}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            className="px-4 py-1.5 rounded-md text-sm border border-[var(--c-bd2)]"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>
          <button
            className="px-4 py-1.5 rounded-md text-sm font-medium text-white disabled:opacity-50"
            style={{ background: accent }}
            disabled={candidates.length === 0}
            onClick={apply}
          >
            应用同步
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
