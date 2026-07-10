import { useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Play, Loader2, Search, CheckCircle2, XCircle, Layers } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig } from "../../lib/nodeConfig";
import { extractFrameMedia } from "../../lib/nodeMedia";
import { RUNNABLE_TYPES } from "../../lib/runnableTypes";
import { MediaImage } from "./MediaImage";
import type { NodeType } from "../../../../shared/types";

/**
 * LibTV 化 2.4：资产管理左栏的「画布大纲」tab。
 *
 * 与既有导航的分工：⌘K NodeSearch 是「想找某个节点」的即时搜索命令面板；
 * 大纲是「一眼看清整个工作流结构与生成状态」的常驻列表——列出【所有】节点
 * （含未运行/生成中/失败），group 组为章节、组内与散节点按 Y→X 空间序
 * （与胶片条同序口径），点击行即定位选中（与 NodeSearch.focusNode 同口径）。
 */

type OutlineRow = {
  id: string;
  nodeType: string;
  title: string;
  status?: string;
  thumb?: { imageUrl?: string; videoUrl?: string };
};

type OutlineSection = { key: string; label: string | null; rows: OutlineRow[] };

/** 空间序：Y 优先、X 次之（分镜自然顺序，与胶片条一致）。 */
function bySpatial(a: { position: { x: number; y: number } }, b: { position: { x: number; y: number } }) {
  return a.position.y - b.position.y || a.position.x - b.position.x;
}

function StatusDot({ status }: { status?: string }) {
  if (status === "processing")
    return <Loader2 size={11} className="animate-spin flex-shrink-0" style={{ color: "oklch(0.68 0.22 285)" }} />;
  if (status === "succeeded")
    return <CheckCircle2 size={11} className="flex-shrink-0" style={{ color: "oklch(0.7 0.18 155)" }} />;
  if (status === "failed")
    return <XCircle size={11} className="flex-shrink-0" style={{ color: "oklch(0.65 0.2 25)" }} />;
  return <span className="flex-shrink-0" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--c-bd3)", margin: 2 }} />;
}

export function OutlineList() {
  const nodes = useCanvasStore((s) => s.nodes);
  const reactFlow = useReactFlow();
  const [q, setQ] = useState("");

  const sections = useMemo<OutlineSection[]>(() => {
    const query = q.trim().toLowerCase();
    const toRow = (n: (typeof nodes)[number]): OutlineRow => {
      const p = n.data.payload as Record<string, unknown>;
      return {
        id: n.id,
        nodeType: n.data.nodeType,
        title: n.data.title || getNodeConfig(n.data.nodeType as NodeType)?.label || n.data.nodeType,
        status: typeof p.status === "string" ? p.status : undefined,
        thumb: extractFrameMedia(p),
      };
    };
    const match = (r: OutlineRow) =>
      !query || r.title.toLowerCase().includes(query) || r.nodeType.toLowerCase().includes(query);

    const groups = nodes.filter((n) => n.data.nodeType === "group").sort(bySpatial);
    const grouped = new Set<string>();
    const out: OutlineSection[] = [];
    for (const g of groups) {
      const childIds = ((g.data.payload as { childIds?: string[] }).childIds ?? []);
      const members = nodes.filter((n) => childIds.includes(n.id) && n.data.nodeType !== "group").sort(bySpatial);
      members.forEach((m) => grouped.add(m.id));
      const rows = members.map(toRow).filter(match);
      if (rows.length) out.push({ key: g.id, label: (g.data.title || "分组"), rows });
    }
    const loose = nodes
      .filter((n) => n.data.nodeType !== "group" && !grouped.has(n.id))
      .sort(bySpatial).map(toRow).filter(match);
    if (loose.length) out.push({ key: "__loose__", label: out.length ? "未分组" : null, rows: loose });
    return out;
  }, [nodes, q]);

  // 与 NodeSearch.focusNode 同口径：选中该节点并把视口平滑居中过去。
  const focusNode = (id: string) => {
    const { nodes: cur, setNodes } = useCanvasStore.getState();
    setNodes(cur.map((n) => (n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)));
    const rfNode = reactFlow.getNode(id);
    if (rfNode) {
      const w = rfNode.measured?.width ?? rfNode.width ?? 240;
      const h = rfNode.measured?.height ?? rfNode.height ?? 120;
      reactFlow.setCenter(rfNode.position.x + w / 2, rfNode.position.y + h / 2, {
        zoom: Math.min(Math.max(reactFlow.getZoom(), 0.85), 1.5),
        duration: 500,
      });
    } else {
      reactFlow.fitView({ nodes: [{ id }], padding: 0.5, duration: 400 });
    }
  };

  const total = nodes.filter((n) => n.data.nodeType !== "group").length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 搜索过滤 */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        <div className="flex items-center gap-1.5 rounded-lg px-2" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
          <Search size={12} style={{ color: "var(--c-t4)", flexShrink: 0 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`筛选 ${total} 个节点…`}
            className="flex-1 min-w-0 bg-transparent outline-none py-1.5"
            style={{ fontSize: 11.5, color: "var(--c-t1)" }}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {sections.length === 0 && (
          <p className="text-center py-8" style={{ fontSize: 11, color: "var(--c-t4)" }}>
            {total === 0 ? "画布暂无节点" : "无匹配节点"}
          </p>
        )}
        {sections.map((sec) => (
          <div key={sec.key} className="flex flex-col gap-0.5">
            {sec.label && (
              <div className="flex items-center gap-1.5 px-1.5 pt-1.5 pb-0.5">
                <Layers size={10} style={{ color: "var(--c-t4)" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t4)", letterSpacing: "0.04em" }}>{sec.label}</span>
                <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{sec.rows.length}</span>
              </div>
            )}
            {sec.rows.map((r) => {
              const cfg = getNodeConfig(r.nodeType as NodeType);
              const runnable = RUNNABLE_TYPES.includes(r.nodeType as NodeType);
              return (
                <div
                  key={r.id}
                  onClick={() => focusNode(r.id)}
                  className="group flex items-center gap-2 rounded-lg px-1.5 py-1 cursor-pointer transition-colors"
                  style={{ minHeight: 34 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  title={`${r.title}（点击定位到画布）`}
                >
                  {/* 缩略图 / 类型色块 */}
                  <div className="flex-shrink-0 rounded-md overflow-hidden flex items-center justify-center"
                    style={{ width: 30, height: 30, background: `${cfg?.color ?? "var(--c-bd2)"}18`, border: `1px solid ${cfg?.color ?? "var(--c-bd2)"}30` }}>
                    {r.thumb?.imageUrl ? (
                      <MediaImage src={r.thumb.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : r.thumb?.videoUrl ? (
                      <video src={r.thumb.videoUrl} preload="metadata" muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: cfg?.color ?? "var(--c-bd3)" }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t1)" }}>{r.title}</div>
                    <div className="truncate" style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{cfg?.label ?? r.nodeType}</div>
                  </div>
                  <StatusDot status={r.status} />
                  {runnable && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center justify-center rounded-md"
                      style={{ width: 22, height: 22, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                      title="运行此节点"
                      onClick={(e) => {
                        e.stopPropagation();
                        useCanvasStore.getState().requestRun(null, [r.id]);
                        toast.success("已请求运行", { duration: 1200 });
                      }}
                    >
                      <Play size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
