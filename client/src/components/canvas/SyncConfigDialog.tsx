import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../ui/dialog";
import { Checkbox } from "../ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import type { NodeData } from "../../../../shared/types";

// How the source node's multiple server addresses are spread across targets
// when the "服务器地址" category is synced. "follow" = legacy behavior (every
// target gets the same current address); "sequential"/"random" distribute the
// addresses across targets' customBaseUrl for multi-machine load splitting.
type ServerMode = "follow" | "sequential" | "random";

interface FieldCategory {
  key: string;
  label: string;
  fields: string[];
}

// Per-node-type category → field map. Per-node fields (prompt / seed / reference
// image / result / status) are intentionally excluded — they are never synced.
const IMAGE_CATEGORIES: FieldCategory[] = [
  { key: "server", label: "服务器地址", fields: ["serverUrls", "customBaseUrl"] },
  { key: "conn", label: "工作流 / 负向词", fields: ["workflowTemplate", "negPrompt"] },
  { key: "model", label: "模型", fields: ["ckpt", "vae", "upscaleModel"] },
  { key: "sampling", label: "采样参数", fields: ["steps", "cfg", "width", "height", "sampler", "scheduler", "denoise", "batchSize"] },
  { key: "lora", label: "LoRA", fields: ["loras", "lora", "loraStrength"] },
  { key: "controlnet", label: "ControlNet", fields: ["controlnet"] },
  { key: "ipadapter", label: "IPAdapter", fields: ["ipadapter"] },
];

const VIDEO_CATEGORIES: FieldCategory[] = [
  { key: "server", label: "服务器地址", fields: ["serverUrls", "customBaseUrl"] },
  { key: "conn", label: "工作流 / 负向词", fields: ["workflowTemplate", "negPrompt"] },
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

  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(() => new Set(smartDefaultTargets));
  const [selectedCats, setSelectedCats] = useState<Set<string>>(() => new Set(categories.map((c) => c.key)));
  const [serverMode, setServerMode] = useState<ServerMode>("follow");

  // Server address pool of the SOURCE node (the saved list). Drives both whether
  // the distribution selector shows and how addresses are spread on apply.
  const sourceServerUrls = useMemo(() => {
    const s = nodes.find((n) => n.id === sourceId);
    const sp = ((s?.data as { payload?: unknown } | undefined)?.payload ?? {}) as Record<string, unknown>;
    const arr = sp.serverUrls;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  }, [nodes, sourceId]);

  // Re-seed selections each time the dialog opens (or when the smart defaults /
  // category set change while open) so freshly-added nodes are reflected.
  useEffect(() => {
    if (!open) return;
    setSelectedTargets(new Set(smartDefaultTargets));
    setSelectedCats(new Set(categories.map((c) => c.key))); // categories default all-selected
    setServerMode("follow");
  }, [open, smartDefaultTargets, categories]);

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
    // Config fields live on data.payload (ckpt / steps / serverUrls / …), NOT
    // on data directly — reading from source.data here silently produced an
    // all-undefined patch, so syncing appeared to do nothing.
    const sp = ((source.data as { payload?: unknown }).payload ?? {}) as Record<string, unknown>;
    const fields = categories.filter((c) => selectedCats.has(c.key)).flatMap((c) => c.fields);
    const patch: Record<string, unknown> = {};
    // Only copy fields the source actually has — avoid overwriting targets with
    // undefined for fields the source never set.
    for (const f of fields) {
      if (sp[f] !== undefined) patch[f] = sp[f];
    }
    if (Object.keys(patch).length === 0) { toast.info("源节点没有可同步的配置值"); return; }
    const targets = Array.from(selectedTargets);

    // Distribute the source's multiple server addresses across targets when the
    // server category is synced and the user picked a non-default mode. Every
    // target still receives the full serverUrls list (kept in `patch`); only the
    // active customBaseUrl is assigned per-target.
    const distribute =
      selectedCats.has("server") && serverMode !== "follow" && sourceServerUrls.length > 1;
    let pool = sourceServerUrls;
    if (distribute && serverMode === "random") {
      pool = [...sourceServerUrls];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    batchUpdateNodeData(
      targets.map((id, i) =>
        distribute
          ? { id, payload: { ...patch, customBaseUrl: pool[i % pool.length] } as Partial<NodeData> }
          : { id, payload: patch as Partial<NodeData> },
      ),
    );
    toast.success(
      distribute
        ? `已按${serverMode === "random" ? "随机" : "顺序"}分配地址同步到 ${targets.length} 个 ComfyUI ${label}节点`
        : `已同步配置到 ${targets.length} 个 ComfyUI ${label}节点`,
    );
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

        {candidates.length > 0 && sourceServerUrls.length > 1 && selectedCats.has("server") && (
          <div className="mt-1 rounded-md border border-[var(--c-bd2)] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              服务器地址分配（源节点共 {sourceServerUrls.length} 个地址）
            </div>
            <RadioGroup
              value={serverMode}
              onValueChange={(v) => setServerMode(v as ServerMode)}
              className="gap-2"
            >
              {([
                { v: "follow", label: "完全遵循当前节点（所有目标用相同地址）" },
                { v: "sequential", label: "顺序分配（轮流使用各地址，便于多机负载）" },
                { v: "random", label: "随机分配（洗牌轮流，尽量不重复）" },
              ] as { v: ServerMode; label: string }[]).map((o) => (
                <label key={o.v} className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value={o.v} />
                  <span>{o.label}</span>
                </label>
              ))}
            </RadioGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              完整地址列表会同步给所有目标，仅各自的「当前选用地址」不同。
            </p>
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
