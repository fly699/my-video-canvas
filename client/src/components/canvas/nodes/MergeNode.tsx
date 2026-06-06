import { memo, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { MergeNodeData, MergeTransition } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { mediaFetchUrl } from "@/lib/download";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { NodeTextArea } from "../NodeTextInput";
import { compareUpstreamNodes } from "../../../lib/inputOrder";
import { Merge, Loader2, RotateCcw, Music, ChevronDown, GripVertical, X } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "merge";
    title: string;
    payload: MergeNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.62 0.20 270)";
const accentA = (a: number) => `oklch(0.62 0.20 270 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
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
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
};

const TRANSITIONS: { value: MergeTransition; label: string }[] = [
  { value: "none",    label: "直切（无转场）" },
  { value: "fade",    label: "淡入淡出" },
  { value: "dissolve", label: "叠化溶解" },
];

export const MergeNode = memo(function MergeNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const [showBgMusic, setShowBgMusic] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Auto-collapse the editing controls when the node is deselected; expand when
  // selected or pinned (mirrors NodeSelectedContext / the other nodes' behavior).
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);

  const mergeMutation = trpc.merge.mergeVideos.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, {
        outputUrl: result.url,
        outputDuration: result.duration,
        status: "done",
        errorMessage: undefined,
      });
      toast.success(`合并完成，总时长 ${result.duration.toFixed(1)}s`);
    },
    onError: (err) => {
      updateNodeData(id, { status: "failed", errorMessage: err.message });
      toast.error("合并失败：" + err.message);
    },
  });

  const update = (patch: Partial<MergeNodeData>) => updateNodeData(id, patch);

  // Drag a video asset from the 素材库 (or a URL) straight onto the node → append
  // it to the merge list. Mirrors the asset-drop pattern used by the gen nodes.
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("text/uri-list")) {
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    let dropped: string[] = [];
    const raw = e.dataTransfer.getData("application/x-asset-list");
    if (raw) {
      try {
        dropped = (JSON.parse(raw) as Array<{ url?: string; type?: string; mimeType?: string }>)
          .filter((a) => a.url && (a.type === "video" || a.mimeType?.startsWith("video/")))
          .map((a) => a.url!);
      } catch { /* ignore */ }
    }
    if (!dropped.length) {
      const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
      if (/^https?:\/\//.test(uri)) dropped = [uri];
    }
    if (!dropped.length) return; // not a video asset — let the canvas handle it
    e.preventDefault(); e.stopPropagation();
    const existing = payload.inputVideoUrls ?? [];
    const merged = [...existing, ...dropped.filter((u) => !existing.includes(u))];
    update({ inputVideoUrls: merged });
    toast.success(`已添加 ${merged.length - existing.length} 个视频到合并列表`);
  };

  // Collect video URLs from connected source nodes (video-producing types only).
  // AudioNode is explicitly excluded — if a user connects an audio source it should
  // populate `bgMusicUrl` instead of being treated as a video track (would crash FFmpeg).
  const VIDEO_SOURCE_TYPES = new Set(["video_task", "clip", "merge", "overlay", "asset", "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow"]);
  // Connected video inputs, smart-ordered (title number → Y → connection order),
  // each with a display label (the source node's title).
  const collectInputItems = (): { url: string; label: string }[] => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const incoming = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.target === id);
    incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
    const items: { url: string; label: string }[] = [];
    for (const { e } of incoming) {
      const srcNode = byId.get(e.source);
      if (!srcNode || !VIDEO_SOURCE_TYPES.has(srcNode.data.nodeType)) continue;
      if (srcNode.data.nodeType === "asset") {
        const mt = (srcNode.data.payload as { mimeType?: string }).mimeType;
        if (mt && mt.startsWith("audio/")) continue;
      }
      const p = srcNode.data.payload as Record<string, unknown>;
      const url = (p.resultVideoUrl ?? p.outputUrl ?? p.url) as string | undefined;
      if (url) items.push({ url, label: srcNode.data.title || url.split("/").pop() || url });
    }
    return items;
  };
  const collectInputUrls = (): string[] => collectInputItems().map((x) => x.url);

  // Effective ordered inputs for the drag-reorder list: explicit manual order if
  // set, otherwise the smart-ordered connected inputs. Labels prefer source titles.
  const graphItems = collectInputItems();
  const labelByUrl = new Map(graphItems.map((x) => [x.url, x.label]));
  const orderItems: { url: string; label: string }[] = (payload.inputVideoUrls ?? []).length
    ? (payload.inputVideoUrls ?? []).map((u) => ({ url: u, label: labelByUrl.get(u) ?? u.split("/").pop() ?? u }))
    : graphItems;
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const arr = orderItems.map((x) => x.url);
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    update({ inputVideoUrls: arr });
  };

  // Auto-detect a connected AudioNode (or audio-mime asset) for background music
  const detectedBgMusicUrl = (() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    for (const edge of incomingEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source);
      if (!srcNode) continue;
      if (srcNode.data.nodeType === "audio") {
        const u = (srcNode.data.payload as { url?: string }).url;
        if (u) return u;
      }
      if (srcNode.data.nodeType === "asset") {
        const p = srcNode.data.payload as { mimeType?: string; url?: string };
        if (p.mimeType?.startsWith("audio/") && p.url) return p.url;
      }
    }
    return undefined;
  })();
  const effectiveBgMusicUrl = payload.bgMusicUrl || detectedBgMusicUrl;

  const handleMerge = () => {
    if (mergeMutation.isPending || payload.status === "processing") return;
    const urls = payload.inputVideoUrls?.length
      ? payload.inputVideoUrls
      : collectInputUrls();

    if (urls.length < 2) {
      toast.error("至少需要 2 个已完成的视频节点输入，或手动填写视频 URL");
      return;
    }

    update({ status: "processing", errorMessage: undefined });
    mergeMutation.mutate({
      inputUrls: urls,
      transition: payload.transition,
      transitionDuration: payload.transition !== "none" ? payload.transitionDuration : undefined,
      bgMusicUrl: effectiveBgMusicUrl || undefined,
      bgMusicVolume: payload.bgMusicVolume,
    });
  };

  const handleReset = () => {
    update({ outputUrl: undefined, outputDuration: undefined, status: "idle", errorMessage: undefined });
  };

  const isProcessing = payload.status === "processing" || mergeMutation.isPending;
  const isDone = payload.status === "done";
  const isFailed = payload.status === "failed";

  return (
    <BaseNode id={id} selected={selected} nodeType="merge" title={data.title} minHeight={200} resizable>

      <div className="flex flex-col gap-3 p-3.5 h-full" onDragOver={handleDragOver} onDrop={handleDrop}>

        {/* Status */}
        {isProcessing && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: accentA(0.08), border: `1px solid ${accentA(0.3)}` }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />
            <span className="text-xs" style={{ color: accent }}>合并视频中...</span>
          </div>
        )}

        {isFailed && (
          <div className="flex flex-col gap-1 px-2.5 py-2 rounded-lg" style={{ background: "oklch(0.62 0.20 25 / 0.08)", border: "1px solid oklch(0.62 0.20 25 / 0.3)" }}>
            <span className="text-xs font-medium" style={{ color: "oklch(0.62 0.20 25)" }}>合并失败</span>
            {payload.errorMessage && (
              <span className="text-[10px]" style={{ color: "var(--c-t3)" }}>{payload.errorMessage}</span>
            )}
          </div>
        )}

        {/* Output video — fills the node height so it scales when the node is
            resized (was locked at 140px). */}
        {isDone && payload.outputUrl && (
          <div className="flex flex-col gap-1.5 flex-1" style={{ minHeight: 0 }}>
            <div className="relative" style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <WatermarkedVideo
                block
                key={payload.outputUrl}
                src={mediaFetchUrl(payload.outputUrl)}
                controls
                className="w-full rounded-lg nodrag"
                style={{ flex: 1, minHeight: 180, width: "100%", objectFit: "contain", display: "block", border: `1px solid ${accentA(0.4)}`, background: "#000" }}
                preload="metadata"
              />
              {isOwnStorageUrl(payload.outputUrl) && (
                <div
                  title="已存储到 MinIO·长期有效"
                  className="absolute top-1.5 left-1.5 z-10 rounded-full pointer-events-none"
                  style={{ width: 10, height: 10, background: "oklch(0.72 0.18 155)", boxShadow: "0 0 0 2.5px oklch(0.72 0.18 155 / 0.35)" }}
                />
              )}
            </div>
            {/* Bottom controls hide when the node is collapsed — the output
                video preview stays, but the reset button only shows expanded. */}
            {expanded && (
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={handleReset}
                  className="nodrag flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px]"
                  style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}
                >
                  <RotateCcw style={{ width: 9, height: 9 }} />
                  重置
                  {payload.outputDuration ? <span style={{ color: "var(--c-t4)" }}> · {payload.outputDuration.toFixed(1)}s</span> : null}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Compact summary when collapsed (deselected) — keeps the node informative
            without the full editing controls. */}
        {!expanded && (
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--c-t3)" }}>
            <Merge style={{ width: 11, height: 11, color: accent, flexShrink: 0 }} />
            <span>{orderItems.length} 个视频输入 · 转场：{TRANSITIONS.find((t) => t.value === (payload.transition ?? "none"))?.label ?? "直切"}{effectiveBgMusicUrl ? " · 含背景音乐" : ""}</span>
          </div>
        )}

        {/* Editing controls — collapse when the node is deselected. */}
        {expanded && (<>

        {/* Ordered input list — drag to set the concatenation order. Connected
            inputs are smart-ordered by default; dragging fixes an explicit order. */}
        {orderItems.length > 0 && (
          <div>
            <label style={labelStyle}>合并顺序（拖拽排序，从上到下依次拼接）</label>
            <div className="flex flex-col gap-1">
              {orderItems.map((it, i) => (
                <div
                  key={it.url + i}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (dragIdx != null) reorder(dragIdx, i); setDragIdx(null); }}
                  onDragEnd={() => setDragIdx(null)}
                  className="nodrag"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 7, background: dragIdx === i ? accentA(0.14) : "var(--c-input)", border: `1px solid ${BORDER_DEFAULT}`, cursor: "grab" }}
                >
                  <GripVertical style={{ width: 12, height: 12, color: "var(--c-t4)", flexShrink: 0 }} />
                  <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 4, background: accentA(0.18), color: accent, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.url}>{it.label}</span>
                  <button
                    onClick={() => update({ inputVideoUrls: orderItems.filter((_, j) => j !== i).map((x) => x.url) })}
                    title="从合并列表移除"
                    style={{ flexShrink: 0, padding: 2, lineHeight: 0, background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer" }}
                  ><X style={{ width: 11, height: 11 }} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual URL input (optional) */}
        <div>
          <label style={labelStyle}>视频 URL（自动从连接节点读取，可手动覆盖）</label>
          <NodeTextArea
            className="nodrag nowheel"
            placeholder={"每行一个视频 URL\nhttps://...\nhttps://..."}
            value={(payload.inputVideoUrls ?? []).join("\n")}
            onValueChange={(v) => {
              const urls = v.split("\n").map((u) => u.trim()).filter(Boolean);
              update({ inputVideoUrls: urls });
            }}
            rows={3}
            style={{ ...fieldStyle, resize: "none", fontFamily: "monospace", fontSize: 10, lineHeight: 1.6 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
        </div>

        {/* Transition */}
        <div>
          <label style={labelStyle}>转场效果</label>
          <select
            value={payload.transition ?? "none"}
            onChange={(e) => update({ transition: e.target.value as MergeTransition })}
            className="nodrag"
            style={{ ...fieldStyle, cursor: "pointer" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          >
            {TRANSITIONS.map((t) => (
              <option key={t.value} value={t.value} style={{ background: "var(--c-base)" }}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Transition duration (only when not "none") */}
        {payload.transition !== "none" && payload.transition && (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>转场时长</label>
              <span style={{ fontSize: 11, color: "var(--c-t3)", fontVariantNumeric: "tabular-nums" }}>{(payload.transitionDuration ?? 0.5).toFixed(1)}秒</span>
            </div>
            <input
              type="range" min={0.1} max={2.0} step={0.1}
              value={payload.transitionDuration ?? 0.5}
              onChange={(e) => update({ transitionDuration: Number(e.target.value) })}
              className="nodrag w-full"
              style={{ accentColor: accent }}
            />
          </div>
        )}

        {/* Background music toggle */}
        <button
          onClick={() => setShowBgMusic((v) => !v)}
          className="nodrag flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs transition-all"
          style={{
            background: showBgMusic ? accentA(0.08) : "var(--c-surface)",
            border: `1px solid ${showBgMusic ? accentA(0.3) : "var(--c-bd2)"}`,
            color: showBgMusic ? accent : "var(--c-t3)",
            cursor: "pointer",
          }}
        >
          <span className="flex items-center gap-1.5">
            <Music style={{ width: 11, height: 11 }} />
            背景音乐叠加（可选）
          </span>
          <ChevronDown style={{ width: 11, height: 11, transform: showBgMusic ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
        </button>

        {showBgMusic && (
          <div className="flex flex-col gap-2">
            <div>
              <label style={labelStyle}>音频 URL</label>
              <input
                className="nodrag"
                placeholder={detectedBgMusicUrl ? "已自动检测连接的音频节点" : "https://..."}
                value={payload.bgMusicUrl ?? ""}
                onChange={(e) => update({ bgMusicUrl: e.target.value })}
                style={{ ...fieldStyle }}
                onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
              {!payload.bgMusicUrl && detectedBgMusicUrl && (
                <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 3 }}>
                  使用已连接的音频节点（手动填写 URL 可覆盖）
                </p>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>音量</label>
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{((payload.bgMusicVolume ?? 0.3) * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05}
                value={payload.bgMusicVolume ?? 0.3}
                onChange={(e) => update({ bgMusicVolume: Number(e.target.value) })}
                className="nodrag w-full"
                style={{ accentColor: accent }}
              />
            </div>
          </div>
        )}

        {/* Merge button */}
        <button
          onClick={handleMerge}
          disabled={isProcessing || isDone}
          className="nodrag flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: isProcessing || isDone ? "var(--c-surface)" : accentA(0.15),
            border: `1px solid ${isProcessing || isDone ? BORDER_DEFAULT : accentA(0.5)}`,
            color: isProcessing || isDone ? "var(--c-t4)" : accent,
            cursor: isProcessing || isDone ? "not-allowed" : "pointer",
          }}
        >
          {isProcessing
            ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
            : <Merge style={{ width: 13, height: 13 }} />}
          {isProcessing ? "合并中..." : isDone ? "已完成（重置后可重新合并）" : "合并视频"}
        </button>

        </>)}

      </div>

    </BaseNode>
  );
});
