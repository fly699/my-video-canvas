import { memo, useCallback, useRef } from "react";
import { Columns2 } from "lucide-react";
import { BaseNode } from "../BaseNode";
import { MediaImage } from "../MediaImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { detectUpstreamImages } from "../../../lib/comfyWorkflowParams";
import type { CompareNodeData } from "../../../../../shared/types";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "compare"; title: string; payload: CompareNodeData; projectId: number };
}

const tag: React.CSSProperties = { fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: "rgba(0,0,0,0.6)", color: "#fff", pointerEvents: "none" };

/** 图片对比（滑块）节点：两路上游图 A/B 叠放，中间可拖滑块左右揭示——左=A、右=B。
 *  验证「原始结构 vs AI 生成」主体是否一致（3D 约束工作流的验证闭环）。纯前端、无生成、无扣费。 */
export const CompareNode = memo(function CompareNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = (data.payload ?? {}) as CompareNodeData;
  // 上游图源（返回 join 字符串保持引用稳定，避免每次 store 变动重渲）。
  const upstreamKey = useCanvasStore((s) => detectUpstreamImages(id, s.edges, s.nodes).join("\n"));
  const ups = upstreamKey ? upstreamKey.split("\n") : [];
  const a = payload.aUrl ?? ups[0];
  const b = payload.bUrl ?? ups[1];
  const pos = Math.min(1, Math.max(0, payload.slider ?? 0.5));

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const setPos = useCallback((clientX: number) => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    updateNodeData(id, { slider: v }, true); // 拖拽为瞬时，不写撤销历史
  }, [id, updateNodeData]);
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    dragRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPos(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => { if (dragRef.current) setPos(e.clientX); };
  const onUp = (e: React.PointerEvent) => { dragRef.current = false; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };

  return (
    <BaseNode id={id} selected={selected} nodeType="compare" title={data.title} minHeight={200}>
      <div className="p-2">
        {a && b ? (
          <div
            ref={boxRef}
            className="nodrag relative rounded-lg overflow-hidden"
            style={{ width: "100%", background: "var(--c-canvas)", cursor: "ew-resize", userSelect: "none", touchAction: "none" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          >
            {/* A 铺满（分隔线左侧可见） */}
            <MediaImage src={a} alt="A" className="w-full" draggable={false} style={{ display: "block", pointerEvents: "none" }} />
            {/* B 覆盖，裁到分隔线右侧（右侧可见 B） */}
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos * 100}%)` }}>
              <MediaImage src={b} alt="B" className="w-full" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
            </div>
            {/* 分隔线 + 圆形手柄 */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos * 100}%`, width: 2, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.45)", transform: "translateX(-1px)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: "50%", left: `${pos * 100}%`, transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: 99, background: "#fff", boxShadow: "0 1px 5px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <Columns2 size={14} color="#333" />
            </div>
            <span style={{ position: "absolute", left: 6, top: 6, ...tag }}>A</span>
            <span style={{ position: "absolute", right: 6, top: 6, ...tag }}>B</span>
          </div>
        ) : (
          <div style={{ padding: 22, textAlign: "center", fontSize: 12, color: "var(--c-t3)", lineHeight: 1.7 }}>
            连入两路图像（生图 / ComfyUI / 导演台 / 素材 / 分镜）<br />拖动中间滑块左右对比，验证主体结构是否一致
            {a && !b && <div style={{ marginTop: 6, fontSize: 11, color: "var(--c-t4)" }}>已连 1 路，还差 1 路</div>}
          </div>
        )}
      </div>
    </BaseNode>
  );
});
