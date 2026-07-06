import { useEffect, useState } from "react";

/** 画布顶栏是否处于「窄」宽度：用于把余额/模型块的文字标签在窄屏收起（只留图标+数字），
 *  给右侧按钮腾横向空间。轻量 window-resize 阈值判断（无需 ResizeObserver）。 */
export function useTopbarNarrow(threshold = 1180): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < threshold);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < threshold);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [threshold]);
  return narrow;
}
