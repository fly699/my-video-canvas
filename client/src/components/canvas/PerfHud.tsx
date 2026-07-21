// #326 隐藏性能 HUD：FPS / store 节点数 / DOM 挂载节点数 / 档位 / 手势状态。
// 默认完全不渲染（返回 null，零开销）；URL 带 ?perfhud=1 或
// localStorage.setItem("avc:perfHud","1") 后刷新即显示——给性能排查一个可量化
// 的读数，不再靠体感。纯只读展示，不碰任何画布状态。
import { useEffect, useState } from "react";
import { useCanvasStore } from "@/hooks/useCanvasStore";
import { usePerfStore, selectPerfLite, PERF_MODE_LABEL } from "@/lib/perfMode";

function hudEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("perfhud") === "1") return true;
    return localStorage.getItem("avc:perfHud") === "1";
  } catch { return false; }
}

export function PerfHud() {
  const [enabled] = useState(hudEnabled);
  const [fps, setFps] = useState(0);
  const [domNodes, setDomNodes] = useState(0);
  const [dragging, setDragging] = useState(false);
  const storeNodes = useCanvasStore((s) => s.nodes.length);
  const mode = usePerfStore((s) => s.mode);
  const lite = usePerfStore(selectPerfLite);

  useEffect(() => {
    if (!enabled) return;
    let frames = 0;
    let run = true;
    const tick = () => { if (!run) return; frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const iv = setInterval(() => {
      setFps(frames); frames = 0;
      setDomNodes(document.querySelectorAll(".react-flow__node").length);
      setDragging(document.documentElement.hasAttribute("data-dragging"));
    }, 1000);
    return () => { run = false; clearInterval(iv); };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999, pointerEvents: "none",
      fontFamily: "monospace", fontSize: 11, lineHeight: 1.5, padding: "5px 9px", borderRadius: 7,
      background: "rgba(0,0,0,0.72)", color: fps >= 50 ? "#7fe0a0" : fps >= 30 ? "#f0d070" : "#f08080",
      border: "1px solid rgba(255,255,255,0.15)" }}>
      <div>FPS {fps}{dragging ? " ·手势中" : ""}</div>
      <div style={{ color: "#bbb" }}>节点 {storeNodes} · DOM {domNodes} · {PERF_MODE_LABEL[mode]}{lite && mode === "auto" ? "(降档)" : ""}</div>
    </div>
  );
}
