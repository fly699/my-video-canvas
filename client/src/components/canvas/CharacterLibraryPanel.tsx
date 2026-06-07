import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { mediaFetchUrl } from "@/lib/download";
import { Users, X, Plus, Trash2, User as UserIcon, Mountain } from "lucide-react";

/**
 * Global character library: reusable identities saved across projects. Click an
 * entry to drop it onto the canvas as a `character` node (full payload restored).
 */
export function CharacterLibraryPanel({ onClose }: { onClose: () => void }) {
  const { addNode, updateNodeData } = useCanvasStore();
  const { data: items, refetch } = trpc.characterLibrary.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const delMut = trpc.characterLibrary.delete.useMutation({
    onSuccess: () => { toast.success("已从角色库删除"); refetch(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });

  const addToCanvas = (payload: Record<string, unknown>, i: number) => {
    try {
      const node = addNode("character", { x: 240 + i * 28, y: 220 + i * 28 });
      updateNodeData(node.id, payload, true);
      toast.success("已添加到画布");
    } catch (e) {
      toast.error("添加失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div
      className="flex flex-col"
      style={{
        position: "absolute", top: 56, right: 16, zIndex: 40,
        width: 300, maxHeight: "70vh",
        background: "var(--c-base)", border: "1px solid var(--c-bd1)", borderRadius: 12,
        boxShadow: "var(--c-node-shadow-hover)", overflow: "hidden",
      }}
    >
      <div className="flex items-center justify-between px-3.5 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "oklch(0.66 0.18 30)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>角色库</span>
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>{items?.length ?? 0}</span>
        </div>
        <button onClick={onClose} className="nodrag" style={{ color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none" }}><X className="w-4 h-4" /></button>
      </div>

      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto">
        {(!items || items.length === 0) && (
          <div style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: "24px 8px" }}>
            还没有保存的角色。<br />在角色节点点「保存到角色库」即可。
          </div>
        )}
        {items?.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
            <div className="flex-shrink-0 rounded-md overflow-hidden flex items-center justify-center" style={{ width: 36, height: 36, background: "var(--c-canvas)", border: "1px solid var(--c-bd2)" }}>
              {it.thumbnail
                ? <img src={mediaFetchUrl(it.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (it.characterKind === "scene" ? <Mountain className="w-4 h-4" style={{ color: "var(--c-t4)" }} /> : <UserIcon className="w-4 h-4" style={{ color: "var(--c-t4)" }} />)}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              <div style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{it.characterKind === "scene" ? "场景" : "人物"}{it.creatorName ? ` · ${it.creatorName}` : ""}</div>
            </div>
            <button onClick={() => addToCanvas(it.payload, i)} title="添加到画布" className="nodrag flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 6, background: "oklch(0.66 0.18 30 / 0.12)", border: "1px solid oklch(0.66 0.18 30 / 0.3)", color: "oklch(0.66 0.18 30)", cursor: "pointer" }}>
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { if (window.confirm(`从角色库删除「${it.name}」？`)) delMut.mutate({ id: it.id }); }} title="删除" className="nodrag flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 6, background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer" }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
