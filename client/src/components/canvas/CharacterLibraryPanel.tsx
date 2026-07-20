import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useFloatingBox, type Corner } from "../../hooks/useFloatingBox";
import { mediaFetchUrl } from "@/lib/download";
import { librarySourceProjectOf } from "@/lib/characterLibrarySave";
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
  // #272 分项目检索：按入库时记录的来源项目筛选（librarySourceProjectId，写在条目
  // payload 里的零迁移方案）。"all"=全部、"current"=本项目、数字=指定项目 id。
  // 老条目没有来源标记——只在「全部」下可见，任何项目筛选都不显示（宁缺毋滥，
  // 不把归属不明的条目伪装成某项目的）。
  const [projFilter, setProjFilter] = useState<"all" | "current" | number>("all");
  const currentProjectId = useCanvasStore((s) => s.projectId);
  // 项目 id → 名称映射（projects.list 已被首页/AI 客户端使用，共享缓存不额外扇出；
  // 返回形状是 {owned, shared} 两组，拍平后统一查——他人共享项目里入库的条目也能显示名）。
  const { data: projects } = trpc.projects.list.useQuery(undefined, { staleTime: 60_000 });
  const allProjects = Array.isArray(projects) ? projects : [...(projects?.owned ?? []), ...(projects?.shared ?? [])];
  const projTitle = (pid: number) => allProjects.find((p: { id: number; name: string }) => p.id === pid)?.name || `项目 #${pid}`;

  const { data: items, refetch, isLoading } = trpc.characterLibrary.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const srcOf = (it: { payload?: Record<string, unknown> }) => librarySourceProjectOf(it.payload);
  // 来源项目下拉的选项集：出现在库条目里的全部来源项目（去重、按 id 稳定排序）。
  const sourceProjectIds = Array.from(new Set((items ?? []).map(srcOf).filter((v): v is number => v != null))).sort((a, b) => a - b);
  const qq = query.trim().toLowerCase();
  const shownItems = (items ?? []).filter((it) => {
    const kind = it.characterKind === "scene" ? "scene" : "person";
    if (kindFilter !== "all" && kind !== kindFilter) return false;
    if (projFilter !== "all") {
      const src = srcOf(it);
      const want = projFilter === "current" ? currentProjectId : projFilter;
      if (want == null || src !== want) return false;
    }
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
  const dropOnCanvas = (payload: Record<string, unknown>, kind: string, focus: boolean, libName?: string) => {
    try {
      const c = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const pos = { x: c.x + (Math.random() * 50 - 25), y: c.y + (Math.random() * 50 - 25) };
      const node = addNode("character", pos);
      const merged: Record<string, unknown> = { ...payload, characterKind: payload.characterKind ?? kind ?? "person" };
      // #287 库行 name 才是权威显示名（面板卡片显示的就是它）：「重命名」「覆盖保存」都只改
      // 行名、不改 payload 快照——整包落地会把入库时的旧 name/sceneName 带到画布，节点左上角
      // 名字 chip（读 payload 的名字字段）显示的就不是实际角色名（用户实报）。落地时强制用
      // 行名覆写对应类别的名字字段 + 节点标题，快照其余设定原样保留。
      const nm = (libName ?? "").trim();
      if (nm) {
        if ((merged.characterKind as string) === "scene") merged.sceneName = nm; else merged.name = nm;
        useCanvasStore.getState().updateNodeTitle(node.id, nm);
      }
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
      onPointerDown={onResizeMouseDown(corner)}
      style={{
        position: "absolute", width: 16, height: 16, zIndex: 3, touchAction: "none",
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
        style={{ borderBottom: "1px solid var(--c-elevated)", cursor: pinned ? "default" : "move", userSelect: "none", touchAction: pinned ? undefined : "none" }}
        onPointerDown={pinned ? undefined : onHeaderMouseDown}
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
        {/* #272 分项目检索行：「本项目」快捷按钮 + 来源项目下拉（面板 fixed 定位、不在
            transform:scale 容器内，原生 select 可安全使用——缩放窗坑不适用于此）。 */}
        {(items?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              className="nodrag"
              onClick={() => setProjFilter((v) => (v === "current" ? "all" : "current"))}
              disabled={currentProjectId == null}
              title="只看在当前项目里入库的角色/场景（再点一次恢复全部）"
              style={{ fontSize: 10.5, padding: "4px 8px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${projFilter === "current" ? "oklch(0.66 0.18 30 / 0.4)" : "var(--c-bd2)"}`, background: projFilter === "current" ? "oklch(0.66 0.18 30 / 0.14)" : "transparent", color: projFilter === "current" ? "oklch(0.66 0.18 30)" : "var(--c-t3)" }}
            >本项目</button>
            <select
              className="nodrag"
              value={projFilter === "current" ? "current" : String(projFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setProjFilter(v === "all" ? "all" : v === "current" ? "current" : Number(v));
              }}
              title="按入库来源项目检索（旧条目未记录来源，仅「全部项目」下可见）"
              style={{ flex: 1, minWidth: 0, fontSize: 10.5, padding: "4px 6px", borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", cursor: "pointer" }}
            >
              <option value="all">全部项目</option>
              {currentProjectId != null && <option value="current">本项目（{projTitle(currentProjectId)}）</option>}
              {sourceProjectIds.filter((pid) => pid !== currentProjectId).map((pid) => (
                <option key={pid} value={String(pid)}>{projTitle(pid)}</option>
              ))}
            </select>
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
        {/* #133 批B：列表 → 大预览网格卡（LibTV 库形态）。缩略图占卡主体、姓名叠底部渐变、
            hover 右上浮现操作行；双击整卡 = 添加到画布（最高频操作零按钮直达）。 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))", gap: 8 }} data-charlib-grid>
          {shownItems.map((it) => {
            const p = (it.payload ?? {}) as { referenceAudioUrl?: string; additionalAudioUrls?: string[]; referenceVideoUrl?: string; additionalVideoUrls?: string[] };
            const hasAudio = !!(p.referenceAudioUrl?.trim() || p.additionalAudioUrls?.length);
            const hasVideo = !!(p.referenceVideoUrl?.trim() || p.additionalVideoUrls?.length);
            const isScene = it.characterKind === "scene";
            return (
              <div key={it.id} className="group/clib nodrag relative rounded-xl overflow-hidden"
                title="双击添加到画布"
                onDoubleClick={() => dropOnCanvas(it.payload, it.characterKind, false, it.name)}
                style={{ aspectRatio: "3 / 4", background: "var(--c-input)", border: "1px solid var(--c-bd2)", cursor: "pointer" }}>
                {it.thumbnail
                  ? <img src={mediaFetchUrl(it.thumbnail)} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isScene ? <Mountain className="w-7 h-7" style={{ color: "var(--c-t4)", opacity: 0.6 }} /> : <UserIcon className="w-7 h-7" style={{ color: "var(--c-t4)", opacity: 0.6 }} />}
                    </div>}
                {/* hover 操作行（右上）：添加 / 编辑 / 删除 */}
                <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 group-hover/clib:opacity-100" style={{ transition: "opacity 140ms ease" }}>
                  {([
                    { key: "add", icon: <Plus className="w-3.5 h-3.5" />, title: "添加到画布（或双击整卡）", onClick: () => dropOnCanvas(it.payload, it.characterKind, false, it.name), accentBg: true },
                    { key: "edit", icon: <Pencil className="w-3 h-3" />, title: "编辑（放到画布并选中，改完「保存到角色库」覆盖更新）", onClick: () => dropOnCanvas(it.payload, it.characterKind, true, it.name) },
                    { key: "del", icon: <Trash2 className="w-3 h-3" />, title: "删除", onClick: () => { if (window.confirm(`从角色库删除「${it.name}」？`)) delMut.mutate({ id: it.id }); } },
                  ] as const).map((b) => (
                    <button key={b.key} title={b.title}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); b.onClick(); }}
                      style={{ width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, cursor: "pointer", backdropFilter: "blur(6px)",
                        background: ("accentBg" in b && b.accentBg) ? "oklch(0.66 0.18 30 / 0.85)" : "oklch(0 0 0 / 0.55)",
                        border: "1px solid oklch(1 0 0 / 0.2)", color: "#fff" }}>
                      {b.icon}
                    </button>
                  ))}
                </div>
                {/* 底部渐变姓名条：双击名字=重命名（阻断卡片双击添加） */}
                <div className="absolute left-0 right-0 bottom-0 flex items-center gap-1" style={{ padding: "14px 7px 6px", background: "linear-gradient(transparent, oklch(0 0 0 / 0.78))" }}>
                  <span onDoubleClick={(e) => { e.stopPropagation(); rename(it.id, it.name); }} title="双击重命名"
                    style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: "#fff", textShadow: "0 1px 3px oklch(0 0 0 / 0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "text" }}>
                    {it.name}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 6, background: isScene ? "oklch(0.62 0.16 240 / 0.5)" : "oklch(0.66 0.18 30 / 0.5)", color: "#fff" }}>{isScene ? "场景" : "人物"}</span>
                  {/* #272 来源项目角标（有记录才显示；全部视图下辅助辨认归属） */}
                  {srcOf(it) != null && (
                    <span title={`入库来源：${projTitle(srcOf(it)!)}`}
                      style={{ flexShrink: 0, fontSize: 8.5, padding: "1px 5px", borderRadius: 6, background: "oklch(0 0 0 / 0.45)", border: "1px solid oklch(1 0 0 / 0.18)", color: "oklch(0.85 0.02 260)", maxWidth: 56, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {projTitle(srcOf(it)!)}
                    </span>
                  )}
                  {hasAudio && <Music className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "#fff", opacity: 0.85 }} />}
                  {hasVideo && <Film className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "#fff", opacity: 0.85 }} />}
                </div>
              </div>
            );
          })}
        </div>
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
