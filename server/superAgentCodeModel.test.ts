import { describe, it, expect } from "vitest";
import { codeTaskModelArg } from "./routers/superAgent";

// 代码任务跑真实 claude CLI：桥接伪 id 必须归一，否则 `--model claude-local` 被真实 CLI
// 拒绝报「selected model (claude-local) … may not exist」（用户实报，AI 客户端「运行工件」）。
describe("codeTaskModelArg（代码任务模型归一）", () => {
  it("claude-local → undefined（不传 --model，用订阅默认）", () => {
    expect(codeTaskModelArg("claude-local")).toBeUndefined();
  });

  it("claude-local:opus → opus（取冒号后缀）", () => {
    expect(codeTaskModelArg("claude-local:opus")).toBe("opus");
    expect(codeTaskModelArg("claude-local:sonnet")).toBe("sonnet");
  });

  it("gpt-local / grok-local → undefined（claude CLI 跑不了这些家族）", () => {
    expect(codeTaskModelArg("gpt-local")).toBeUndefined();
    expect(codeTaskModelArg("grok-local")).toBeUndefined();
  });

  it("真实模型 id 原样透传（opus/sonnet/完整 id）", () => {
    expect(codeTaskModelArg("opus")).toBe("opus");
    expect(codeTaskModelArg("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });

  it("空/未定义 → undefined", () => {
    expect(codeTaskModelArg(undefined)).toBeUndefined();
    expect(codeTaskModelArg("")).toBeUndefined();
    expect(codeTaskModelArg("   ")).toBeUndefined();
  });
});
