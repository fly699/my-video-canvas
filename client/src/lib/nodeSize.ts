// 节点「真实视觉尺寸」估算：群组底框/自动布局/适应视图都靠它算包围盒。
// 关键（修「群组底框盖不住下方节点」bug）：必须把 React Flow 渲染后测得的 measured 尺寸纳入——
// 很多节点没有显式 height，实际渲染高度（展开配置/高预览）远大于配置默认值；若只按默认值算，
// 底框高度不足、下方节点探出框外。取 measured 与「显式/样式/默认」估算的**较大值**，保证包围盒
// 永不低估真实footprint。
export interface NodeSizeInput {
  measured?: { width?: number; height?: number };
  width?: number;         // NodeResizer 手动缩放写入的顶层尺寸
  height?: number;
  style?: { width?: unknown; height?: unknown };
}
export interface NodeSizeDefaults { defaultWidth?: number; defaultHeight?: number }

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function pickNodeSize(n: NodeSizeInput, cfg: NodeSizeDefaults): { w: number; h: number } {
  const estW = num(n.width) ?? num(n.style?.width) ?? cfg.defaultWidth ?? 280;
  const estH = num(n.height) ?? num(n.style?.height) ?? cfg.defaultHeight ?? 200;
  const mW = num(n.measured?.width) ?? 0;
  const mH = num(n.measured?.height) ?? 0;
  return { w: Math.max(estW || 280, mW), h: Math.max(estH || 200, mH) };
}
