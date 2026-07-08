import { useEffect, useState } from "react";

// 读取系统「减少动态」偏好，并随其变化实时更新。
// CSS 的 prefers-reduced-motion 媒体查询只能关掉 CSS 动画；SVG 的 SMIL 动画
// （如连线上的 <animateMotion> 流动粒子）必须在 JS 层判断后不渲染，故有此 hook。
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
