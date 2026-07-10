import { useEffect, useState } from "react";
import { useReactFlow, useOnViewportChange, type Viewport } from "@xyflow/react";
import { Crosshair } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";

/**
 * 「返回节点」提示（对标 LibTV）：画布被拖/缩到视野里一个节点都看不到时，
 * 底栏上方浮出提示条，点击一键 fitView 归位。空画布不提示（另有欢迎引导）。
 * 用 useOnViewportChange 订阅视口（用户拖动与程序 setViewport/fitView 都会触发），
 * 只在视口变化结束时重算，不进拖动热路径。
 */
export function ReturnToNodesHint() {
  const reactFlow = useReactFlow();
  const nodes = useCanvasStore((s) => s.nodes);
  const [vp, setVp] = useState<Viewport | null>(null);
  useOnViewportChange({ onEnd: setVp });
  // 首帧兜底：进画布后用户还没动过视口时 onEnd 不触发，主动取一次当前视口
  //（视口恢复由 rAF 异步落地，稍等一拍再读，避免读到未恢复的 0,0,1）。
  useEffect(() => {
    const t = setTimeout(() => setVp((v) => v ?? reactFlow.getViewport()), 600);
    return () => clearTimeout(t);
  }, [reactFlow]);

  if (!vp || nodes.length === 0) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const anyVisible = nodes.some((n) => {
    const m = (n as { measured?: { width?: number; height?: number } }).measured;
    const w = (n.width ?? m?.width ?? 340) * vp.zoom;
    const h = (n.height ?? m?.height ?? 240) * vp.zoom;
    const x = n.position.x * vp.zoom + vp.x;
    const y = n.position.y * vp.zoom + vp.y;
    return x + w > 0 && x < vw && y + h > 0 && y < vh;
  });
  if (anyVisible) return null;

  return (
    <div
      style={{
        position: "fixed", left: "50%", bottom: 118, transform: "translateX(-50%)", zIndex: 45,
        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 16px", borderRadius: 999,
        background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      }}
    >
      <span style={{ fontSize: 12.5, color: "var(--c-t2)" }}>当前视野没有节点</span>
      <button
        onClick={() => reactFlow.fitView({ padding: 0.2, duration: 400 })}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 14px", borderRadius: 999, fontSize: 12.5,
          cursor: "pointer", border: "1px solid oklch(0.70 0.20 310 / 0.5)", background: "oklch(0.70 0.20 310 / 0.16)",
          color: "oklch(0.76 0.18 310)", fontWeight: 600,
        }}
      ><Crosshair size={13} /> 返回节点</button>
    </div>
  );
}
