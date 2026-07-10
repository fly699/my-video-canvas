import { NodeToolbar, Position } from "@xyflow/react";

/**
 * LibTV 化 2.0：就地生成输入条的「屏幕恒定」容器。
 *
 * 逐帧分析 LibTV 确认的核心交互：画布缩放时节点内容随缩放，而交互 UI（输入条/
 * 浮条/参数浮层）保持固定屏幕尺寸锚定在节点位置——任何缩放率下都可读可点。
 * React Flow 的 NodeToolbar 正是该行为（渲染在 viewport 覆盖层、不套节点
 * transform），GroupNode 已用同款。
 *
 * 本组件只提供容器（吸附在节点下方 + 统一深色圆角条样式），内容由各节点组装
 * （image_gen 先行；video_task / storyboard 复用同一容器扩展）。仅创意模式
 * （LibTV 模式宿主）由调用方决定是否渲染——组件自身不感知皮肤。
 */
export function InlineGenBar({ nodeId, visible, width = 480, children }: {
  /** 显式锚定的节点 id（渲染位置可在节点树外，锚定不受容器变化影响）。 */
  nodeId: string;
  visible: boolean;
  /** 固定屏幕像素宽（不随画布缩放）。 */
  width?: number;
  children: React.ReactNode;
}) {
  // ⚠ 不做「超出视口翻转到节点上方」的兜底（曾实装后真实翻车）：节点上方已有
  // 屏幕恒定顶部工具条 + 最终提示词吸附窗，翻上去三层同锚点直接全叠在一起。
  // 配置区默认收起后节点很矮，输入条出视口的场景已极少；真贴屏幕底时平移画布即可。
  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Bottom} offset={12}>
      <div
        className="nodrag nowheel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: "94vw",
          display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px",
          borderRadius: 14,
          background: "color-mix(in oklch, var(--c-base) 96%, transparent)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 14px 44px oklch(0 0 0 / 0.45)",
          backdropFilter: "blur(16px)",
        }}
      >
        {children}
      </div>
    </NodeToolbar>
  );
}
