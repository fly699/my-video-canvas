import { useStore } from "@xyflow/react";

/**
 * 选中（≥2 个非 group 节点）在屏幕坐标下的包围盒——供对齐条 / 多选操作条「吸附」到框选区域的
 * 上 / 下边，而不是固定屏幕顶部 / 底部。订阅 ReactFlow 的 transform 与节点位置，平移 / 缩放 /
 * 移动节点时实时跟随；不足 2 个选中返回 null（此时两个条回退到原来的固定居中定位）。
 */
export interface SelectionScreenBox {
  top: number;    // 选区上边（屏幕 px）
  bottom: number; // 选区下边（屏幕 px）
  cx: number;     // 选区水平中心（屏幕 px）
  count: number;
}

export function useSelectionScreenBox(): SelectionScreenBox | null {
  return useStore(
    (s) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
      s.nodeLookup.forEach((node) => {
        if (!node.selected) return;
        if ((node.data as { nodeType?: string })?.nodeType === "group") return;
        const pos = node.internals.positionAbsolute;
        const w = node.measured?.width ?? 0;
        const h = node.measured?.height ?? 0;
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + w > maxX) maxX = pos.x + w;
        if (pos.y + h > maxY) maxY = pos.y + h;
        count++;
      });
      if (count < 2) return null;
      const [tx, ty, zoom] = s.transform;
      return {
        top: minY * zoom + ty,
        bottom: maxY * zoom + ty,
        cx: ((minX + maxX) / 2) * zoom + tx,
        count,
      };
    },
    // 值相等则不重渲染，避免每帧新对象触发无谓更新。
    (a, b) => a === b || (!!a && !!b && a.top === b.top && a.bottom === b.bottom && a.cx === b.cx && a.count === b.count),
  );
}
