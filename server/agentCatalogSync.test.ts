import { describe, it, expect } from "vitest";
import { AGENT_NODE_CATALOG } from "./_core/agentCatalog";
import { CONNECTION_MATRIX } from "../client/src/lib/connectionRules";

/**
 * 智能体节点目录（喂给 LLM 系统提示的「可连接到」）必须是连线矩阵的子集——否则 LLM 会据此
 * 产出被 isConnectionValid 拒绝的 connect 操作，造成无谓失败与重试。曾因删矩阵死边漏改此目录
 * 回归过（script→character、character→prompt），加此测试防漂移。
 */
describe("agentCatalog.connectsTo 与连线矩阵同步", () => {
  for (const spec of AGENT_NODE_CATALOG) {
    it(`${spec.type}.connectsTo 均为矩阵允许的目标`, () => {
      const allowed = new Set(CONNECTION_MATRIX[spec.type] ?? []);
      const extra = spec.connectsTo.filter((t) => !allowed.has(t));
      expect(extra, `${spec.type} 广告了矩阵不允许的连接: ${extra.join(", ")}`).toEqual([]);
    });
  }
});
