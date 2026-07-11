import { useEffect, useState } from "react";
import { useUIStyle } from "../contexts/UIStyleContext";
import { useCanvasMode } from "../contexts/CanvasModeContext";

/**
 * LibTV（#70 创意模式）节点收起范式的共享 hook：
 * - isCreativeMode：pro/simple 皮肤 + creative 画布（工作室/专业不受影响）
 * - advancedOpen：配置区展开态——取消选中复位；选中时快捷键 A
 *   （Canvas 派发 canvas:toggle-advanced）切换。
 * 图像/视频/分镜/音频/角色/ComfyUI 系节点为历史原因各自内联同款逻辑；
 * 新接入的节点一律用本 hook，避免再复制粘贴。
 */
export function useCreativeAdvanced(selected: boolean | undefined) {
  const { uiStyle } = useUIStyle();
  const { mode } = useCanvasMode();
  const isCreativeMode = uiStyle !== "studio" && mode === "creative";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => { if (!selected) setAdvancedOpen(false); }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const h = () => setAdvancedOpen((v) => !v);
    window.addEventListener("canvas:toggle-advanced", h);
    return () => window.removeEventListener("canvas:toggle-advanced", h);
  }, [selected]);
  return { isCreativeMode, advancedOpen, setAdvancedOpen };
}
