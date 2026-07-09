import { useEffect } from "react";
import { useCanvasStore } from "./useCanvasStore";
import { pushResultSnapshot } from "../lib/resultHistory";
import type { ResultSnapshot } from "../../../shared/types";

// 通用「结果版本历史」采集（#5）：任一生成节点每产出一张**新**结果就追加一条快照到
// payload.resultHistory（最新在前，封顶）。回滚到旧快照时 url 已在历史 → pushResultSnapshot
// 返回同引用、据引用相等跳过写入，历史严格倒序、来回回滚不乱序、无更新环。
// silent=true：不进撤销栈、不广播（本地便利态，随节点持久化）。
export function useResultHistoryCapture(
  id: string,
  opts: { current?: string; urls?: string[]; prompt?: string; history?: ResultSnapshot[] },
): void {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  useEffect(() => {
    const url = opts.current;
    if (!url) return;
    const next = pushResultSnapshot(opts.history, { url, urls: opts.urls, prompt: opts.prompt, at: Date.now() });
    if (next !== opts.history) updateNodeData(id, { resultHistory: next }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.current]);
}
