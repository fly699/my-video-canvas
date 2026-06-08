import { useCallback, type ReactNode } from "react";
import { Layers, FileText } from "lucide-react";
import { usePersistentState } from "./usePersistentState";

/**
 * 统一管理一个节点的两个吸附窗开关状态：左侧「参考图」+ 顶部「最终提示词」。
 * 标题栏复用同一个循环按钮，按点击次数循环：
 *   两者都有：全收起 → 开参考图 → 参考图+提示词 → 全收起 …
 *   只有其一：直接单控该窗的开/关。
 * 状态分别持久化（ui:refstrip / ui:promptdock，按节点 id）。内容消失时自动判为收起，
 * 避免「开着却没内容」。
 */
export function useNodeDocks(
  id: string,
  opts: { hasRef: boolean; hasPrompt: boolean },
): {
  refOpen: boolean;
  promptOpen: boolean;
  setRefOpen: (v: boolean) => void;
  setPromptOpen: (v: boolean) => void;
  cycle: () => void;
} {
  const { hasRef, hasPrompt } = opts;
  const [refOpenRaw, setRefOpen] = usePersistentState<boolean>(`ui:refstrip:${id}`, false, { crossTab: false });
  const [promptOpenRaw, setPromptOpen] = usePersistentState<boolean>(`ui:promptdock:${id}`, false, { crossTab: false });
  const refOpen = hasRef && refOpenRaw;
  const promptOpen = hasPrompt && promptOpenRaw;

  const cycle = useCallback(() => {
    if (hasRef && hasPrompt) {
      if (!refOpen && !promptOpen) { setRefOpen(true); }
      else if (refOpen && !promptOpen) { setPromptOpen(true); }
      else { setRefOpen(false); setPromptOpen(false); }
    } else if (hasRef) {
      setPromptOpen(false); setRefOpen(!refOpen);
    } else if (hasPrompt) {
      setRefOpen(false); setPromptOpen(!promptOpen);
    }
  }, [hasRef, hasPrompt, refOpen, promptOpen, setRefOpen, setPromptOpen]);

  return { refOpen, promptOpen, setRefOpen, setPromptOpen, cycle };
}

/**
 * 标题栏循环按钮：左侧参考图（Layers + 张数）+ 顶部提示词（FileText）。
 * 点击触发 useNodeDocks 的 cycle。无参考图且无提示词时不渲染。
 */
export function DockToggleButton({
  refCount, hasPrompt, refOpen, promptOpen, accent, onClick,
}: {
  refCount: number;
  hasPrompt: boolean;
  refOpen: boolean;
  promptOpen: boolean;
  accent: string;
  onClick: () => void;
}): ReactNode {
  if (refCount <= 0 && !hasPrompt) return null;
  const anyOpen = refOpen || promptOpen;
  return (
    <button
      onClick={onClick}
      className="nodrag flex items-center"
      style={{
        gap: 5, fontSize: 10,
        color: anyOpen ? accent : "var(--c-t3)",
        border: `1px solid ${anyOpen ? accent : "var(--c-bd2)"}`,
        borderRadius: 6, padding: "1px 6px",
      }}
      title="展开/收起 参考图 / 最终提示词（循环：参考图 → +提示词 → 全部收起）"
    >
      {refCount > 0 && (
        <span className="flex items-center" style={{ gap: 2, color: refOpen ? accent : "var(--c-t3)" }}>
          <Layers style={{ width: 11, height: 11 }} /> {refCount}
        </span>
      )}
      {hasPrompt && (
        <FileText style={{ width: 11, height: 11, color: promptOpen ? accent : "var(--c-t3)" }} />
      )}
    </button>
  );
}
