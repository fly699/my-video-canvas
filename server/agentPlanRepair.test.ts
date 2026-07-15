import { describe, it, expect } from "vitest";
import { shouldRepairPlan, buildRepairInstruction, splitSystemForCache } from "./routers/agent";

// 画布助手「规划自愈」触发判定 —— 仅在「原本就要放弃/给不出有用结果」的失败路径触发，
// 成功规划一律不触发（否则平白多一次 LLM 调用拖慢正常请求）。
describe("shouldRepairPlan（自愈触发判定）", () => {
  it("解析失败 + 明显在尝试 operations（含该键）→ 触发", () => {
    expect(shouldRepairPlan({
      parsedOk: false, operations: [], dropped: [],
      cleaned: '{"reply":"好的","operations":[{"op":"create"', // 被截断
      text: '{"reply":"好的","operations":[{"op":"create"',
    })).toBe(true);
  });

  it("解析失败 + 以 { 开头（无 operations 键但像 JSON）→ 触发", () => {
    expect(shouldRepairPlan({
      parsedOk: false, operations: [], dropped: [],
      cleaned: '{"reply":"部分内容', text: '{"reply":"部分内容',
    })).toBe(true);
  });

  it("解析失败 + 纯散文回答（提问/解释，无 operations、不像 JSON）→ 不触发（保留原文）", () => {
    expect(shouldRepairPlan({
      parsedOk: false, operations: [], dropped: [],
      cleaned: "你想生成几个镜头？可以先告诉我风格。",
      text: "你想生成几个镜头？可以先告诉我风格。",
    })).toBe(false);
  });

  it("解析成功 + 有操作 → 不触发（正常成功路径）", () => {
    expect(shouldRepairPlan({
      parsedOk: true, operations: [{ op: "create" }], dropped: [],
      cleaned: "{...}", text: "{...}",
    })).toBe(false);
  });

  it("解析成功 + 空操作 + 无被拒项（纯对话回复 operations:[]）→ 不触发", () => {
    expect(shouldRepairPlan({
      parsedOk: true, operations: [], dropped: [],
      cleaned: '{"reply":"已了解","operations":[]}', text: '{"reply":"已了解","operations":[]}',
    })).toBe(false);
  });

  it("解析成功 + 所有操作都被拒 + 确有被拒项 → 触发（用户什么也拿不到，回喂拒因）", () => {
    expect(shouldRepairPlan({
      parsedOk: true, operations: [], dropped: ["未知节点类型 foo", "编造的模型 id"],
      cleaned: "{...}", text: "{...}",
    })).toBe(true);
  });
});

describe("splitSystemForCache（prompt caching 静态前缀/易变尾部切分）", () => {
  const system = [
    "你是副驾。",
    "",
    "# 可用节点目录",
    "catalog...模型清单...",
    "",
    "# 当前画布",
    "（空画布）角色库...",
    "",
    "# 输出要求",
    "严格只输出 JSON...规则...",
  ].join("\n");

  it("正常切分：静态前缀 = 目录 + 输出规则，易变尾部 = 当前画布段 + 追加的经验", () => {
    const { systemStatic, systemVolatile } = splitSystemForCache(system, "\n\n# 相关工作流经验\nexp...");
    // 静态前缀含目录与输出规则，但不含「当前画布」易变段
    expect(systemStatic).toContain("# 可用节点目录");
    expect(systemStatic).toContain("# 输出要求");
    expect(systemStatic).not.toContain("# 当前画布");
    // 易变尾部含当前画布段 + 经验，但不含输出规则
    expect(systemVolatile).toContain("# 当前画布");
    expect(systemVolatile).toContain("# 相关工作流经验");
    expect(systemVolatile).not.toContain("# 输出要求");
  });

  it("切分无损：静态前缀 + 易变尾部（去掉追加经验）可还原原文的两段拼接", () => {
    const { systemStatic, systemVolatile } = splitSystemForCache(system, "");
    // 拼接顺序为 目录段 + 规则段 + 当前画布段；覆盖原文全部实质内容（不丢字）
    expect((systemStatic + systemVolatile).length).toBe(system.length);
  });

  it("标记缺失 → 兜底单块（systemVolatile 空，经验补回静态块，不发第二个 system 消息）", () => {
    const plain = "没有结构标记的提示词";
    const { systemStatic, systemVolatile } = splitSystemForCache(plain, "\n\nEXP");
    expect(systemVolatile).toBe("");
    expect(systemStatic).toBe(plain + "\n\nEXP");
  });
});

describe("buildRepairInstruction（修复指令构造）", () => {
  it("解析失败 → 指令要求只输出合法 JSON、可缩减步骤", () => {
    const msg = buildRepairInstruction(false, []);
    expect(msg).toContain("JSON.parse");
    expect(msg).toContain("减少");
  });

  it("操作被拒 → 指令带上去重后的拒因、要求只用清单内真实值", () => {
    const msg = buildRepairInstruction(true, ["未知节点类型 foo", "未知节点类型 foo", "编造的模型 id"]);
    expect(msg).toContain("未知节点类型 foo");
    expect(msg).toContain("编造的模型 id");
    // 去重：同一拒因只出现一次
    expect(msg.match(/未知节点类型 foo/g)?.length).toBe(1);
  });
});
