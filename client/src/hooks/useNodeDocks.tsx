import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentState } from "./usePersistentState";

/**
 * 管理一个节点的两个吸附窗：左侧「参考图」+ 顶部「最终提示词」。无标题栏按钮。
 *
 * 交互：
 * - 鼠标悬停节点标题栏满 1 秒 → 两窗一起「临时展开」（peek，不写持久化）。
 * - 临时展开期间点击某个吸附窗 → 该窗「钉住」持久展开（写持久化），离开标题栏也不收；
 *   另一个未点的窗在鼠标离开后收起。
 * - 钉住的窗用其自带的 ×（onClose→setXxxOpen(false)）关闭。
 *
 * 鼠标在「标题栏 ↔ 吸附窗」之间移动时用一个短延迟避免闪烁：标题栏 1s 才触发展开，
 * 离开后延迟收起；进入吸附窗（onDockHoverChange）取消收起，保持展开以便点击钉住。
 */
export function useNodeDocks(
  id: string,
  opts: { hasRef: boolean; hasPrompt: boolean },
): {
  refOpen: boolean;
  promptOpen: boolean;
  setRefOpen: (v: boolean) => void;
  setPromptOpen: (v: boolean) => void;
  pinRef: () => void;
  pinPrompt: () => void;
  onHeaderHoverChange: (hovering: boolean) => void;
  onDockHoverChange: (hovering: boolean) => void;
} {
  const { hasRef, hasPrompt } = opts;
  const [refPersist, setRefPersist] = usePersistentState<boolean>(`ui:refstrip:${id}`, false, { crossTab: false });
  const [promptPersist, setPromptPersist] = usePersistentState<boolean>(`ui:promptdock:${id}`, false, { crossTab: false });
  const [peek, setPeek] = useState(false);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOpen = () => { if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; } };
  const clearClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  useEffect(() => () => { clearOpen(); clearClose(); }, []);

  const onHeaderHoverChange = useCallback((hovering: boolean) => {
    if (hovering) {
      clearClose();
      openTimer.current ?? (openTimer.current = setTimeout(() => { openTimer.current = null; setPeek(true); }, 1000));
    } else {
      clearOpen();
      clearClose();
      closeTimer.current = setTimeout(() => { closeTimer.current = null; setPeek(false); }, 300);
    }
  }, []);

  const onDockHoverChange = useCallback((hovering: boolean) => {
    if (hovering) { clearClose(); clearOpen(); }
    else { clearClose(); closeTimer.current = setTimeout(() => { closeTimer.current = null; setPeek(false); }, 300); }
  }, []);

  const refOpen = hasRef && (refPersist || peek);
  const promptOpen = hasPrompt && (promptPersist || peek);
  const pinRef = useCallback(() => setRefPersist(true), [setRefPersist]);
  const pinPrompt = useCallback(() => setPromptPersist(true), [setPromptPersist]);

  return {
    refOpen, promptOpen,
    setRefOpen: setRefPersist, setPromptOpen: setPromptPersist,
    pinRef, pinPrompt, onHeaderHoverChange, onDockHoverChange,
  };
}
