import { trpc } from "./trpc";

export interface BridgeSkill { name: string; description: string }

/** 本机 Claude 桥接可用的技能清单（供聊天框「/ 唤起技能」）。
 *  enabled = 服务端是否放行了 Skill（CLAUDE_BRIDGE_SKILLS=1）；skills = 服务器技能目录里扫到的技能。 */
export function useBridgeSkills(enabledQuery = true): { enabled: boolean; skills: BridgeSkill[] } {
  const q = trpc.config.bridgeSkills.useQuery(undefined, {
    enabled: enabledQuery,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return { enabled: !!q.data?.enabled, skills: q.data?.skills ?? [] };
}
