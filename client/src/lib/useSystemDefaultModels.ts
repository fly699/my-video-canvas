import { useMemo } from "react";
import { trpc } from "./trpc";
import type { SystemDefaultModels } from "@shared/nodeDefaultModels";

/** 管理员在后台「模型管理」配置的「系统默认模型」（按槽位 llm/image/video/transcribe）。
 *  作用于所有项目：新节点/聊天默认模型解析时排在项目级配置之下、出厂默认之上。
 *  空对象（默认）= 各槽位用出厂默认，行为与未配置时一致。 */
export function useSystemDefaultModels(): SystemDefaultModels {
  const q = trpc.config.systemDefaultModels.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const cfg = q.data?.systemDefaultModels;
  return useMemo(() => cfg ?? {}, [cfg]);
}
