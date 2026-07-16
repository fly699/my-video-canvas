import { describe, it, expect } from "vitest";
import { shouldRepairPlan, buildRepairInstruction, parseIntentDecision } from "./routers/agent";

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

// ③ 对话/规划分流：意图分类器输出解析，强偏 plan（只有明确纯闲聊才 chat）。
describe("parseIntentDecision（意图分流解析，强偏 plan）", () => {
  it("明确 chat → chat", () => {
    expect(parseIntentDecision("chat")).toBe("chat");
    expect(parseIntentDecision("CHAT\n")).toBe("chat");
    expect(parseIntentDecision("这是闲聊")).toBe("chat");
  });
  it("明确 plan → plan", () => {
    expect(parseIntentDecision("plan")).toBe("plan");
    expect(parseIntentDecision("需要规划")).toBe("plan");
  });
  it("空/异常/拿不准 → plan（绝不比原路径差）", () => {
    expect(parseIntentDecision("")).toBe("plan");
    expect(parseIntentDecision(null)).toBe("plan");
    expect(parseIntentDecision(undefined)).toBe("plan");
    expect(parseIntentDecision("我不确定")).toBe("plan");
    expect(parseIntentDecision("随便说点什么")).toBe("plan");
  });
  it("同时出现 chat 与动画布信号 → plan（防误判为闲聊）", () => {
    expect(parseIntentDecision("chat，但要做视频")).toBe("plan");
    expect(parseIntentDecision("闲聊 plan 建节点")).toBe("plan");
  });
});
