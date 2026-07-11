import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { useCanvasStore } from "./useCanvasStore";

/**
 * LibTV「双击参考图聚焦至节点」：按图片 URL 在画布上找到产出/持有它的来源节点，
 * 选中并把视口平滑居中过去（与 OutlineList/NodeSearch.focusNode 同口径）。
 * 本地上传/素材库的图找不到来源节点时给出提示。
 */
export function useFocusRefSource(selfId: string) {
  const reactFlow = useReactFlow();
  return useCallback((url: string) => {
    if (!url) return;
    const { nodes, setNodes } = useCanvasStore.getState();
    const src = nodes.find((n) => {
      if (n.id === selfId) return false;
      const p = n.data.payload as Record<string, unknown>;
      if (p.imageUrl === url || p.referenceImageUrl === url || p.url === url) return true;
      for (const k of ["imageUrls", "outputUrls", "resultUrls"] as const) {
        const arr = p[k];
        if (Array.isArray(arr) && arr.includes(url)) return true;
      }
      const refs = p.referenceImages;
      return Array.isArray(refs) && refs.some((r) => (r as { url?: string })?.url === url);
    });
    if (!src) { toast.info("未找到该参考图的来源节点（可能来自本地上传或素材库）"); return; }
    setNodes(nodes.map((n) => (n.selected !== (n.id === src.id) ? { ...n, selected: n.id === src.id } : n)));
    const rfNode = reactFlow.getNode(src.id);
    if (rfNode) {
      const w = rfNode.measured?.width ?? rfNode.width ?? 240;
      const h = rfNode.measured?.height ?? rfNode.height ?? 120;
      reactFlow.setCenter(rfNode.position.x + w / 2, rfNode.position.y + h / 2, {
        zoom: Math.min(Math.max(reactFlow.getZoom(), 0.85), 1.5),
        duration: 500,
      });
    } else {
      reactFlow.fitView({ nodes: [{ id: src.id }], padding: 0.5, duration: 400 });
    }
  }, [selfId, reactFlow]);
}
