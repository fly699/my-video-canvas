import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useFloatingBox, type Corner } from "../../hooks/useFloatingBox";
import { mediaFetchUrl } from "@/lib/download";
import { useReactFlow } from "@xyflow/react";
import { Users, X, Plus, Trash2, User as UserIcon, Mountain, Pin, PinOff, Pencil, Music, Film, Search } from "lucide-react";

const DOCK_W = 300;

/**
 * Global character library: reusable identities saved across projects. Click an entry to
 * drop it on the canvas as a `character` node. The panel floats (drag by header), resizes
 * from any corner, and can be PINNED (固定) — pinned snaps to the top-right dock and locks
 * drag/resize; unpin returns to the floating box. Position/size/pin persist.
 */
export function CharacterLibraryPanel({ onClose }: { onClose: () => void }) {
  const { addNode, updateNodeData } = useCanvasStore();
  const reactFlow = useReactFlow();
  const { box, onHeaderMouseDown, onResizeMouseDown } = useFloatingBox(
    "ui:character-library:v1",
    { x: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 1200) - DOCK_W - 16), y: 56, w: DOCK_W, h: 480 },
    { minW: 220, minH: 200 },
  );
  const [pinned, setPinned] = usePersistentState<boolean>("ui:character-library:pinned:v1", false, { crossTab: false });
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "person" | "scene">("all");

  const { data: items, refetch, isLoading } = trpc.characterLibrary.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const qq = query.trim().toLowerCase();
  const shownItems = (items ?? []).filter((it) => {
    const kind = it.characterKind === "scene" ? "scene" : "person";
    if (kindFilter !== "all" && kind !== kindFilter) return false;
    return !qq || (it.name ?? "").toLowerCase().includes(qq);
  });
  const delMut = trpc.characterLibrary.delete.useMutation({
    onSuccess: () => { toast.success("已从角色库删除"); refetch(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });
  const renameMut = trpc.characterLibrary.rename.useMutation({
    onSuccess: () => { toast.success("已重命名"); refetch(); },
    onError: (e) => toast.error("重命名失败：" + e.message),
  });
  const rename = (id: number, cur: string) => {
    const name = window.prompt("重命名角色", cur)?.trim();
    if (name && name !== cur) renameMut.mutate({ id, name });
  };

  // 放在当前视口中心（而非固定世界坐标），轻微抖动避免叠放。focus=true 时
  // 选中并居中到该节点，方便立即编辑。
  const dropOnCanvas = (payload: Record<string, unknown>, kind: string, focus: boolean) => {
    try {
      const c = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const pos = { x: c.x + (Math.random() * 50 - 25), y: c.y + (Math.random() * 50 - 25) };
      const node = addNode("character", pos);
      const merged: Record<string, unknown> = { ...payload, characterKind: payload.characterKind ?? kind ?? "person" };
      updateNodeData(node.id, merged, true);
      if (focus) {
        const { nodes, setNodes } = useCanvasStore.getState();
        setNodes(nodes.map((n) => ({ ...n, selected: n.id === node.id })));
        reactFlow.setCenter(pos.x + 150, pos.y + 120, { zoom: Math.max(reactFlow.getZoom(), 0.9), duration: 400 });
      }
      toast.success(focus ? "已添加到画布，可直接编辑后「保存到角色库」覆盖" : "已添加到画布");
    } catch (e) {
      toast.error("添加失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Pinned → dock top-right at fixed width; floating → the persisted box.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = pinned ? vw - DOCK_W - 16 : box.x;
  const top = pinned ? 56 : box.y;
  const width = pinned ? DOCK_W : box.w;
  // 高度自适应内容：框高随角色数量自然增长（少则矮、不再固定 480 留白），
  // 超过上限再由内部列表滚动。浮动模式下 box.h（四角缩放）作为高度上限，
  // 并以视口可用高度兜底；pinned 模式上限为视口内固定值。
  const maxHeight = pinned ? Math.min(640, vh - 96) : Math.min(box.h, vh - top - 16);

  const cornerHandle = (corner: Corner, style: React.CSSProperties) => (
    <div
      onMouseDown={onResizeMouseDown(corner)}
      style={{
        position: "absolute", width: 16, height: 16, zIndex: 3,
        cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
        ...style,
      }}
    />
  );

  return (
    <div
      className="nodrag nowheel flex flex-col"
      style={{
        position: "fixed", left, top, width, height: "auto", maxHeight, zIndex: 40,
        background: "var(--c-base)", border: "1px solid var(--c-bd1)", borderRadius: 12,
        boxShadow: "var(--c-node-shadow-hover)", overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between px-3.5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-elevated)", cursor: pinned ? "default" : "move", userSelect: "none" }}
        onMouseDown={pinned ? undefined : onHeaderMouseDown}
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "oklch(0.66 0.18 30)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>角色库</span>
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>{items?.length ?? 0}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPinned((p) => !p)}
            className="nodrag"
            title={pinned ? "取消固定（恢复浮动）" : "固定到右上角"}
            style={{ color: pinned ? "oklch(0.66 0.18 30)" : "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 2 }}
          >
            {pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} className="nodrag" style={{ color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none" }}><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
        {/* 搜索 + 类型筛选 */}
        {(items?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="flex items-center gap-1.5" style={{ flex: 1, padding: "4px 8px", borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索角色名" className="nodrag"
                style={{ flex: 1, fontSize: 11, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none", minWidth: 0 }} />
              {query && <button onClick={() => setQuery("")} className="nodrag" style={{ background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer", padding: 0, flexShrink: 0 }}><X className="w-3 h-3" /></button>}
            </div>
            {(["all", "person", "scene"] as const).map((k) => (
              <button key={k} onClick={() => setKindFilter(k)} className="nodrag" style={{ fontSize: 10.5, padding: "4px 8px", borderRadius: 7, cursor: "pointer", border: `1px solid ${kindFilter === k ? "oklch(0.66 0.18 30 / 0.4)" : "var(--c-bd2)"}`, background: kindFilter === k ? "oklch(0.66 0.18 30 / 0.14)" : "transparent", color: kindFilter === k ? "oklch(0.66 0.18 30)" : "var(--c-t3)" }}>
                {k === "all" ? "全部" : k === "person" ? "人物" : "场景"}
              </button>
            ))}
          </div>
        )}
        {/* 加载中显骨架，避免慢网/首帧误把「有数据的库」显示成空引导 */}
        {isLoading && !items && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 2px" }}>
            {[0, 1, 2].map((i) => <div key={i} className="animate-pulse" style={{ height: 44, borderRadius: 8, background: "var(--c-elevated)" }} />)}
          </div>
        )}
        {!isLoading && (!items || items.length === 0) && (
          <div style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: "24px 8px" }}>
            还没有保存的角色。<br />在角色节点点「保存到角色库」即可。
          </div>
        )}
        {shownItems.length === 0 && (items?.length ?? 0) > 0 && (
          <div style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: "20px 8px" }}>没有匹配的角色/场景</div>
        )}
        {shownItems.map((it) => (
          <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
            <div className="flex-shrink-0 rounded-md overflow-hidden flex items-center justify-center" style={{ width: 36, height: 36, background: "var(--c-canvas)", border: "1px solid var(--c-bd2)" }}>
              {it.thumbnail
                ? <img src={mediaFetchUrl(it.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (it.characterKind === "scene" ? <Mountain className="w-4 h-4" style={{ color: "var(--c-t4)" }} /> : <UserIcon className="w-4 h-4" style={{ color: "var(--c-t4)" }} />)}
            </div>
            <div className="flex-1 min-w-0" onDoubleClick={() => rename(it.id, it.name)} title="双击重命名">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}>{it.name}</div>
              <div className="flex items-center gap-1" style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
                <span>{it.characterKind === "scene" ? "场景" : "人物"}</span>
                {(() => {
                  const p = (it.payload ?? {}) as { referenceAudioUrl?: string; additionalAudioUrls?: string[]; referenceVideoUrl?: string; additionalVideoUrls?: string[] };
                  const hasAudio = !!(p.referenceAudioUrl?.trim() || p.additionalAudioUrls?.length);
                  const hasVideo = !!(p.referenceVideoUrl?.trim() || p.additionalVideoUrls?.length);
                  return (<>
                    {hasAudio && <span title="含音频参考" style={{ display: "inline-flex", alignItems: "center", gap: 1, padding: "0 3px", borderRadius: 4, background: "oklch(0.66 0.18 30 / 0.14)", color: "oklch(0.66 0.18 30)" }}><Music className="w-2.5 h-2.5" />音</span>}
                    {hasVideo && <span title="含视频参考" style={{ display: "inline-flex", alignItems: "center", gap: 1, padding: "0 3px", borderRadius: 4, background: "oklch(0.62 0.16 240 / 0.14)", color: "oklch(0.62 0.16 240)" }}><Film className="w-2.5 h-2.5" />视</span>}
                  </>);
                })()}
              </div>
            </div>
            <button onClick={() => dropOnCanvas(it.payload, it.characterKind, true)} title="编辑（放到画布并选中，改完「保存到角色库」即可覆盖更新）" className="nodrag flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 6, background: "none", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={() => dropOnCanvas(it.payload, it.characterKind, false)} title="添加到画布" className="nodrag flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 6, background: "oklch(0.66 0.18 30 / 0.12)", border: "1px solid oklch(0.66 0.18 30 / 0.3)", color: "oklch(0.66 0.18 30)", cursor: "pointer" }}>
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { if (window.confirm(`从角色库删除「${it.name}」？`)) delMut.mutate({ id: it.id }); }} title="删除" className="nodrag flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 6, background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer" }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Four-corner resize handles (floating only — pinned is docked & locked) */}
      {!pinned && (
        <>
          {cornerHandle("tl", { left: 0, top: 0 })}
          {cornerHandle("tr", { right: 0, top: 0 })}
          {cornerHandle("bl", { left: 0, bottom: 0 })}
          {cornerHandle("br", { right: 0, bottom: 0 })}
        </>
      )}
    </div>
  );
}
