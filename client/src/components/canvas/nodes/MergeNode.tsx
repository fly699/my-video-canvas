import { memo, useMemo, useState } from "react";
import { useCreativeAdvanced } from "../../../hooks/useCreativeAdvanced";
import { InlineGenBar } from "../InlineGenBar";
import { SlidersHorizontal } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "../BaseNode";
import { ReferenceImageStrip, type StripItem } from "../ReferenceImageStrip";
import { useNodeDocks, useAudioStripItems } from "../../../hooks/useNodeDocks";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import type { MergeNodeData, MergeTransition } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { assembleFromStoryboards, assembledPlanToMergePatch } from "@/lib/storyboardGen";
import { buildShotSubtitles } from "@/lib/shotSubtitles";
import { toast } from "sonner";
import { mediaFetchUrl } from "@/lib/download";
import { isOwnStorageUrl } from "@/lib/ownStorage";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { NodeTextArea } from "../NodeTextInput";
import { compareUpstreamNodes } from "../../../lib/inputOrder";
import { getNodeVideoOutput } from "@/lib/canvasPassthrough";
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
  const { updateNodeData, nodes, edges } = useCanvasStore(useShallow((s) => ({ updateNodeData: s.updateNodeData, nodes: s.nodes, edges: s.edges })));
  const payload = data.payload;
  const [showBgMusic, setShowBgMusic] = useState(false);

  // 左侧吸附窗「音频」波形项：上游音频 + 本节点背景音乐（只读，放末尾）。
  const upstreamAudio = useAudioStripItems(id);
  const audioItems: StripItem[] = useMemo(() => {
    const own: StripItem[] = payload.bgMusicUrl?.trim()
      ? [{ id: "bgm:" + payload.bgMusicUrl, url: payload.bgMusicUrl, name: "背景音乐", label: "音频", kind: "audio", removable: false }]
      : [];
    return [...upstreamAudio, ...own];
  }, [upstreamAudio, payload.bgMusicUrl]);
  const docks = useNodeDocks(id, { hasRef: audioItems.length > 0, hasPrompt: false }, { ref: audioItems.map((a) => a.id).join(",") });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Auto-collapse the editing controls when the node is deselected; expand when
  // selected or pinned (mirrors NodeSelectedContext / the other nodes' behavior).
  const expanded = Boolean(selected) || Boolean((data.payload as { pinned?: boolean }).pinned);
  // LibTV（#70 创意模式）：选中后编辑控件也默认收起（保留产出/状态/合并按钮），
  // 点「参数设置」/快捷键 A 展开。
  const { isCreativeMode, advancedOpen, setAdvancedOpen } = useCreativeAdvanced(selected);

  // 内嵌字幕烧录（成片字幕一步到位）：合并产物 + 镜头表对白 + 回传 segStarts → 烧字幕。
  const burnSubMutation = trpc.subtitle.burnIn.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { outputUrl: result.url, status: "done", errorMessage: undefined });
      toast.success("成片已内嵌字幕");
    },
    onError: (err) => {
      // 字幕烧录失败不丢成片：保留无字幕成片为输出，仅提示。
      updateNodeData(id, { status: "done", errorMessage: undefined });
      toast.error("字幕烧录失败（已保留无字幕成片）：" + err.message);
    },
  });

  const mergeMutation = trpc.merge.mergeVideos.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, {
        outputUrl: result.url,
        outputDuration: result.duration,
        // 各段成片精确起点（仅装配/xfade 路径返回）：字幕「从镜头表生成」的时间轴。
        // 普通合并返回 undefined → 清掉旧值，避免陈旧起点误导字幕对位。
        segStarts: result.segStarts,
        status: "done",
        errorMessage: undefined,
      });
      // 装配 + 开了内嵌字幕 + 有对白与精确起点 → 续烧字幕（保持 processing 不露无字幕中间版）。
      if (payload.burnShotSubtitles && payload.segDialogues?.some(Boolean) && result.segStarts?.length) {
        const entries = buildShotSubtitles({
          segStarts: result.segStarts,
          segDialogues: payload.segDialogues,
          totalDuration: result.duration,
          voiceDurations: payload.segVoiceDurations ?? undefined,
        });
        if (entries.length) {
          updateNodeData(id, { status: "processing" });
          burnSubMutation.mutate({
            videoUrl: result.url, entries,
            fontSize: payload.subFontSize,
            projectId: data.projectId, nodeId: id,
          });
          return;
        }
      }
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
      const p = srcNode.data.payload as Record<string, unknown>;
      // Helper skips non-video assets (audio/image) and image-output comfyui_workflow
      // runs — so the merged film never includes an image/audio URL as a "video".
      const url = getNodeVideoOutput(srcNode.data.nodeType, p);
      if (url) items.push({ url, label: srcNode.data.title || url.split("/").pop() || url });
    }
    return items;
  };

  // Effective ordered inputs for the drag-reorder list: explicit manual order if
  // set, otherwise the smart-ordered connected inputs. Labels prefer source titles.
  const graphItems = collectInputItems();
  const labelByUrl = new Map(graphItems.map((x) => [x.url, x.label]));
  const manualOrder = payload.inputVideoUrls ?? [];
  // When a manual order exists, keep it BUT append any newly-connected inputs not yet
  // in the list — otherwise connecting a clip after reordering silently drops it from
  // the merge. (Manually-typed URLs not present in the graph are preserved as-is.)
  const orderItems: { url: string; label: string }[] = manualOrder.length
    ? [
        ...manualOrder.map((u) => ({ url: u, label: labelByUrl.get(u) ?? u.split("/").pop() ?? u })),
        ...graphItems.filter((g) => !manualOrder.includes(g.url)),
      ]
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

  /** 按镜头表装配：上游视频→回溯各自分镜→按镜号排序，产出 段顺序+逐切点转场+逐段配音。
   *  仅显式点击时写入（segTransitions/voiceUrls 持久化）；普通合并路径不受影响。 */
  const handleAssemble = () => {
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState();
    const plan = assembleFromStoryboards(id, allNodes, allEdges);
    if ("error" in plan) { toast.error(plan.error); return; }
    update(assembledPlanToMergePatch(plan));
    const voiced = plan.shots.filter((x) => x.hasVoice).length;
    const sfxed = plan.shots.filter((x) => x.hasSfx).length;
    toast.success(`已按镜头表装配 ${plan.inputVideoUrls.length} 段（镜号排序 · 逐切点转场${voiced ? ` · ${voiced} 条配音对位` : ""}${sfxed ? ` · ${sfxed} 条音效对位` : ""}）`, { duration: 5000 });
  };

  const reactFlow = useReactFlow();
  /** 按镜定位：选中并居中该镜的视频节点（按镜重生成入口——在该节点重提出片后，
   *  回来重新点「按镜头表装配」即可替换该段，aligned 守卫天然兜住中间态）。 */
  const focusShotNode = (nodeId: string) => {
    const { nodes: cur, setNodes } = useCanvasStore.getState();
    if (!cur.some((n) => n.id === nodeId)) { toast.error("该镜的视频节点已被删除，请重新装配"); return; }
    setNodes(cur.map((n) => ({ ...n, selected: n.id === nodeId })));
    const rfNode = reactFlow.getNode(nodeId);
    if (rfNode) {
      const w = rfNode.measured?.width ?? rfNode.width ?? 240;
      const h = rfNode.measured?.height ?? rfNode.height ?? 120;
      reactFlow.setCenter(rfNode.position.x + w / 2, rfNode.position.y + h / 2, { zoom: Math.min(Math.max(reactFlow.getZoom(), 0.85), 1.5), duration: 500 });
    }
  };

  const handleMerge = () => {
    if (mergeMutation.isPending || payload.status === "processing") return;
    // Use the effective ordered list (manual order + appended new connections), so a
    // clip connected after reordering is included rather than silently dropped.
    const urls = orderItems.map((x) => x.url);

    if (urls.length < 2) {
      toast.error("至少需要 2 个已完成的视频节点输入，或手动填写视频 URL");
      return;
    }
    if (urls.length > 50) {
      // Server enforces inputUrls.max(50); block with a clear message instead of
      // letting the request 400, and don't silently drop clips from the final film.
      toast.error(`最多合并 50 个视频，当前有 ${urls.length} 个，请减少后再试`);
      return;
    }

    update({ status: "processing", errorMessage: undefined });
    // 装配产物仅在与当前段顺序完全对齐时随单发送（用户手动改过顺序/输入则失配丢弃，防错位）。
    const aligned = !!payload.segTransitions
      && payload.inputVideoUrls?.length === urls.length
      && payload.inputVideoUrls.every((u, i) => u === urls[i]);
    mergeMutation.mutate({
      inputUrls: urls,
      projectId: data.projectId,
      nodeId: id,
      transition: payload.transition,
      transitionDuration: payload.transition !== "none" ? payload.transitionDuration : undefined,
      ...(aligned ? {
        transitions: payload.segTransitions?.slice(0, urls.length - 1),
        voiceUrls: payload.voiceUrls?.slice(0, urls.length),
        sfxUrls: payload.sfxUrls?.slice(0, urls.length),
      } : {}),
      bgMusicUrl: effectiveBgMusicUrl || undefined,
      bgMusicVolume: payload.bgMusicVolume,
      originalVolume: payload.originalVolume,
    });
  };

  const handleReset = () => {
    update({ outputUrl: undefined, outputDuration: undefined, status: "idle", errorMessage: undefined });
  };

  const isProcessing = payload.status === "processing" || mergeMutation.isPending || burnSubMutation.isPending;
  const isDone = payload.status === "done";
  const isFailed = payload.status === "failed";

  // #96 配置区单一来源：非创意内联卡体（原样）；创意模式挂输入条「参数与操作」下浮面板。
  const configBody = (
    <>

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
                <label style={{ ...labelStyle, marginBottom: 0 }}>音乐音量</label>
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
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>原声音量</label>
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{((payload.originalVolume ?? 1) * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={2} step={0.05}
                value={payload.originalVolume ?? 1}
                onChange={(e) => update({ originalVolume: Number(e.target.value) })}
                className="nodrag w-full"
                style={{ accentColor: accent }}
              />
              <p style={{ fontSize: 10, color: "var(--c-t4)", marginTop: 3 }}>
                原视频自带声音的音量；接入音频后原声与音乐按各自音量混合，不再被替换。
              </p>
            </div>
          </div>
        )}

        {/* 按镜头表装配（装配端）：镜号排序 + 逐切点转场 + 配音对位 */}
        <button
          onClick={handleAssemble}
          disabled={isProcessing}
          title="从上游视频回溯各自的分镜：按镜号排序段顺序、按分镜转场字段设逐切点转场、把各镜配音对位混入成片"
          className="nodrag flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ background: "oklch(0.65 0.20 160 / 0.10)", border: "1px solid oklch(0.65 0.20 160 / 0.4)", color: "oklch(0.65 0.20 160)", cursor: isProcessing ? "not-allowed" : "pointer" }}
        >
          🎬 按镜头表装配（镜号排序 · 逐段转场 · 配音对位）
        </button>
        {payload.segTransitions && (
          <>
            <p style={{ fontSize: 9.5, color: "var(--c-t3)", lineHeight: 1.5 }}>
              已装配 {payload.inputVideoUrls?.length ?? 0} 段 · 逐切点转场 {payload.segTransitions.length} 个 · 配音 {payload.voiceUrls?.filter(Boolean).length ?? 0} 条{(payload.sfxUrls?.filter(Boolean).length ?? 0) > 0 ? ` · 音效 ${payload.sfxUrls!.filter(Boolean).length} 条` : ""}（手动改动顺序后将回退为全局转场）
            </p>
            {(payload.sourceShots?.length ?? 0) > 0 && (
              <div className="nodrag" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {payload.sourceShots!.map((s, i) => (
                  <button
                    key={`${s.vid}-${i}`}
                    onClick={() => focusShotNode(s.vid)}
                    title="定位该镜的视频节点（对某镜不满意：在节点上重新生成出片后，回来重新点「按镜头表装配」即可替换该段）"
                    className="nodrag"
                    style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "oklch(0.65 0.20 160 / 0.08)", border: "1px solid oklch(0.65 0.20 160 / 0.3)", color: "oklch(0.65 0.20 160)", cursor: "pointer" }}
                  >
                    镜{s.num ?? i + 1}
                  </button>
                ))}
              </div>
            )}
            {/* 成片内嵌字幕：仅当装配出对白时可用——合并完成后直接烧进成片 */}
            {payload.segDialogues?.some(Boolean) && (
              <label className="nodrag" title="合并完成后，用镜头表对白 + 各段精确起点直接把字幕烧进成片，无需再接字幕节点（确定性对位、零转录）"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: payload.burnShotSubtitles ? accent : "var(--c-t3)", cursor: "pointer" }}>
                <input type="checkbox" checked={payload.burnShotSubtitles ?? false}
                  onChange={(e) => update({ burnShotSubtitles: e.target.checked })}
                  style={{ accentColor: accent, margin: 0 }} />
                合并时内嵌字幕（{payload.segDialogues.filter(Boolean).length} 镜有对白）
              </label>
            )}
            {/* 烧录字幕字号（此前无控件 → 永远落服务端默认；仅在开启内嵌字幕时显示） */}
            {payload.burnShotSubtitles && payload.segDialogues?.some(Boolean) && (
              <label className="nodrag" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--c-t3)" }}>
                字幕字号
                <input type="number" min={12} max={48} step={1} value={payload.subFontSize ?? 24}
                  onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) update({ subFontSize: Math.max(12, Math.min(48, n)) }); }}
                  style={{ width: 56, fontSize: 11, padding: "2px 5px", borderRadius: 5, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t1)" }} />
              </label>
            )}
          </>
        )}

    </>
  );

  return (
    <>
    <BaseNode id={id} selected={selected} nodeType="merge" title={data.title} minHeight={200} resizable
      onHeaderHoverChange={docks.onHeaderHoverChange}
      leftDock={
        <ReferenceImageStrip
          images={audioItems}
          open={docks.refOpen}
          accent={accent}
          readOnly
          title="音频"
          readOnlyHint={<>参与本节点的音频<br />（上游 / 背景音乐）</>}
          onClose={() => docks.setRefOpen(false)}
          onRemove={() => {}}
          onMove={() => {}}
          onInsertUrls={() => {}}
          onDropFiles={() => {}}
          onZoom={() => {}}
          onHoverChange={docks.onDockHoverChange}
          onPin={docks.pinRef}
        />
      }>

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
        {expanded && !isCreativeMode && configBody}

        {/* 合并按钮 —— 移出收起区：选中即常显（LibTV 主操作优先） */}
        {expanded && (<>
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
    {/* ── #96 LibTV（创意模式）就地输入条：参数与操作下浮面板（屏幕恒定） ── */}
    {isCreativeMode && (
      <InlineGenBar nodeId={id} visible={!!selected} width={440}>
        <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)", whiteSpace: "nowrap" }}>合并</span>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>轨道排序 / 音量 / 音频轨参数</span>
          <button className="nodrag" onClick={(e) => { e.stopPropagation(); setAdvancedOpen((v) => !v); }}
            title={(advancedOpen ? "收起参数面板" : "展开参数与操作面板（浮现于输入条下方，不撑开节点卡体）") + " · 快捷键 A"}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: advancedOpen ? "var(--c-elevated)" : "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            <SlidersHorizontal size={12} /> 参数与操作
          </button>
        </div>
        {advancedOpen && (
          <div className="nodrag nowheel flex flex-col" style={{ gap: 12, maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain", paddingTop: 10, marginTop: 4, borderTop: "1px solid var(--c-bd1)" }}>
            {configBody}
          </div>
        )}
      </InlineGenBar>
    )}
    </>
  );
});
