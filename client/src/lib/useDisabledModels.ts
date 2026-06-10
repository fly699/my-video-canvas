import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * 管理员在后台「模型管理」里禁用的模型集合（按模型 value/id）。被禁用的模型不在各
 * 节点的模型下拉里显示。默认空集合 → 行为与未配置时完全一致（全部显示）。
 *
 * 仅作 UI 显示门控：已经选中某个后来被禁用模型的旧节点，其当前值仍照常显示与运行，
 * 只是不出现在可选列表里（避免破坏既有画布）。
 */
export function useDisabledModels(): Set<string> {
  const q = trpc.config.modelToggles.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const ids = q.data?.disabledModels;
  return useMemo(() => new Set(ids ?? []), [ids]);
}
