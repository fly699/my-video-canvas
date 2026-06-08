import { useCallback, useState, type ReactNode } from "react";
import { Layers, FileText } from "lucide-react";
import { usePersistentState } from "./usePersistentState";

/**
 * 管理一个节点的两个吸附窗：左侧「参考图」+ 顶部「最终提示词」。
 * - 两个独立开关（toggleRef / togglePrompt），各自持久化（ui:refstrip / ui:promptdock）。
 * - 标题栏悬停满 1 秒触发的「临时展开」：onHeaderHoverChange(true) 时两窗都临时显示，
 *   离开（false）即回到各自的持久化状态。临时展开不写入持久化，按钮高亮只反映持久态。
 */
export function useNodeDocks(
  id: string,
  opts: { hasRef: boolean; hasPrompt: boolean },
): {
  refOpen: boolean;
  promptOpen: boolean;
  refActive: boolean;
  promptActive: boolean;
  setRefOpen: (v: boolean) => void;
  setPromptOpen: (v: boolean) => void;
  toggleRef: () => void;
  togglePrompt: () => void;
  onHeaderHoverChange: (hovering: boolean) => void;
} {
  const { hasRef, hasPrompt } = opts;
  const [refPersist, setRefPersist] = usePersistentState<boolean>(`ui:refstrip:${id}`, false, { crossTab: false });
  const [promptPersist, setPromptPersist] = usePersistentState<boolean>(`ui:promptdock:${id}`, false, { crossTab: false });
  const [hoverPeek, setHoverPeek] = useState(false);

  const refActive = hasRef && refPersist;
  const promptActive = hasPrompt && promptPersist;
  const refOpen = hasRef && (refPersist || hoverPeek);
  const promptOpen = hasPrompt && (promptPersist || hoverPeek);

  const toggleRef = useCallback(() => setRefPersist((v) => !v), [setRefPersist]);
  const togglePrompt = useCallback(() => setPromptPersist((v) => !v), [setPromptPersist]);

  return {
    refOpen, promptOpen, refActive, promptActive,
    setRefOpen: setRefPersist, setPromptOpen: setPromptPersist,
    toggleRef, togglePrompt, onHeaderHoverChange: setHoverPeek,
  };
}

/**
 * 标题栏的两个独立吸附窗开关：参考图（Layers + 张数）/ 最终提示词（FileText）。
 * 各自独立 toggle；无参考图时不渲染参考图按钮，无提示词时不渲染提示词按钮。
 */
export function DockToggleButtons({
  refCount, hasPrompt, refActive, promptActive, accent, onToggleRef, onTogglePrompt,
}: {
  refCount: number;
  hasPrompt: boolean;
  refActive: boolean;
  promptActive: boolean;
  accent: string;
  onToggleRef: () => void;
  onTogglePrompt: () => void;
}): ReactNode {
  if (refCount <= 0 && !hasPrompt) return null;
  const btn = (active: boolean): React.CSSProperties => ({
    fontSize: 10,
    color: active ? accent : "var(--c-t3)",
    border: `1px solid ${active ? accent : "var(--c-bd2)"}`,
    borderRadius: 6,
    padding: "1px 6px",
  });
  return (
    <span className="flex items-center" style={{ gap: 4 }}>
      {refCount > 0 && (
        <button
          onClick={onToggleRef}
          className="nodrag flex items-center"
          style={{ gap: 2, ...btn(refActive) }}
          title="展开/收起左侧参考图"
        >
          <Layers style={{ width: 11, height: 11 }} /> {refCount}
        </button>
      )}
      {hasPrompt && (
        <button
          onClick={onTogglePrompt}
          className="nodrag flex items-center"
          style={{ ...btn(promptActive) }}
          title="展开/收起顶部「最终提示词」"
        >
          <FileText style={{ width: 11, height: 11 }} />
        </button>
      )}
    </span>
  );
}
