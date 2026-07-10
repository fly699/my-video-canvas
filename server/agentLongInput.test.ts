import { describe, it, expect } from "vitest";
import { adaptToLongInput, LONG_INPUT_THRESHOLD } from "./routers/agent";

// 画布助手超长输入（如 30k 字大纲）自适应压缩：正常输入完全不动；超长时 history 只留
// 最近 2 条且每条截短、graphSummary 截小、maxTokens 16000→6000，缩短单次生成耗时以
// 避免撞 llm.ts 的 fetch 超时（自建 300s / 云端 120s）。

const mkHistory = (n: number, len = 3000) =>
  Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `${i}-`.padEnd(len, "x"),
  }));

describe("adaptToLongInput", () => {
  it("正常输入：history/graphSummary 原样、maxTokens 16000", () => {
    const history = mkHistory(10);
    const r = adaptToLongInput({ message: "a".repeat(LONG_INPUT_THRESHOLD), history, graphSummary: "g".repeat(15000) });
    expect(r.longInput).toBe(false);
    expect(r.maxTokens).toBe(16000);
    expect(r.history).toHaveLength(10);
    expect(r.history[0].content).toHaveLength(3000);
    expect(r.graphSummary).toHaveLength(15000);
  });

  it("超长输入：history 只留最近 2 条且每条截到 1000 字符内", () => {
    const history = mkHistory(10);
    const r = adaptToLongInput({ message: "a".repeat(30000), history, graphSummary: "g".repeat(15000) });
    expect(r.longInput).toBe(true);
    expect(r.history).toHaveLength(2);
    // 保留的是最后两条（第 8、9 条）
    expect(r.history[0].content.startsWith("8-")).toBe(true);
    expect(r.history[1].content.startsWith("9-")).toBe(true);
    for (const m of r.history) expect(m.content.length).toBeLessThanOrEqual(1000 + "…（已截断）".length);
  });

  it("超长输入：graphSummary 截小、maxTokens 降为 6000", () => {
    const r = adaptToLongInput({ message: "a".repeat(30000), graphSummary: "g".repeat(15000) });
    expect(r.graphSummary.length).toBeLessThanOrEqual(4000 + "…（已截断）".length);
    expect(r.graphSummary.endsWith("…（已截断）")).toBe(true);
    expect(r.maxTokens).toBe(6000);
  });

  it("超长输入但 history/graphSummary 本身很短：不加截断标记", () => {
    const r = adaptToLongInput({
      message: "a".repeat(30000),
      history: [{ role: "user", content: "短消息" }],
      graphSummary: "小画布",
    });
    expect(r.history).toEqual([{ role: "user", content: "短消息" }]);
    expect(r.graphSummary).toBe("小画布");
  });

  it("history/graphSummary 缺省时安全返回", () => {
    const short = adaptToLongInput({ message: "hi" });
    expect(short).toEqual({ longInput: false, history: [], graphSummary: "", maxTokens: 16000 });
    const long = adaptToLongInput({ message: "a".repeat(30000) });
    expect(long).toEqual({ longInput: true, history: [], graphSummary: "", maxTokens: 6000 });
  });
});
