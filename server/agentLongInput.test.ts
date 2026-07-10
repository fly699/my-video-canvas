import { describe, it, expect } from "vitest";
import {
  allocateContextBudget,
  AGENT_INPUT_CHAR_BUDGET,
  LONG_INPUT_THRESHOLD,
  GRAPH_MIN_CHARS,
  HISTORY_MIN_KEEP,
  HISTORY_MIN_ENTRY_CHARS,
} from "./routers/agent";

// 画布助手上下文总量预算动态分配：正文 message 永不截断；正文+历史+画布摘要总量在
// AGENT_INPUT_CHAR_BUDGET 内全部原样；超预算时剩余额度在 graphSummary（一半，下限
// GRAPH_MIN_CHARS）与 history（从最新往旧装，保底最近 2 条）之间分配。输出预算按正文
// 长度分两档（>LONG_INPUT_THRESHOLD → 6000），缩短大输入下的单次生成耗时，避免撞
// llm.ts 的 fetch 超时（自建 300s / 云端 120s）。

const MARK = "…（已截断）";
const mkHistory = (n: number, len = 3000) =>
  Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `${i}-`.padEnd(len, "x"),
  }));

describe("allocateContextBudget", () => {
  it("总量在预算内：即使正文超长，history/graphSummary 也原样保留", () => {
    // 30k 正文 + 6k 历史 + 3k 摘要 = 39k ≤ 40k 预算 → 什么都不截。
    const history = mkHistory(2);
    const r = allocateContextBudget({ message: "a".repeat(30000), history, graphSummary: "g".repeat(3000) });
    expect(r.trimmed).toBe(false);
    expect(r.history).toEqual(history);
    expect(r.graphSummary).toHaveLength(3000);
    expect(r.maxTokens).toBe(6000); // 输出预算档位只看正文长度
  });

  it("正常短输入：原样保留、maxTokens 16000", () => {
    // 30k 历史 + 9k 摘要 + 短正文 = 39k+ ≤ 40k 预算。
    const history = mkHistory(10);
    const r = allocateContextBudget({ message: "帮我做个视频", history, graphSummary: "g".repeat(9000) });
    expect(r.trimmed).toBe(false);
    expect(r.history).toHaveLength(10);
    expect(r.maxTokens).toBe(16000);
  });

  it("超预算：剩余额度对半分给摘要，历史从最新往旧装满为止", () => {
    // 30k 正文 → 剩余 10k：摘要拿 5k，历史 5k → 最新一条 3k 整条装入，
    // 次新一条 3k 装不下但属保底 → 截到剩余 2k，再往旧的不再装。
    const r = allocateContextBudget({ message: "a".repeat(30000), history: mkHistory(10), graphSummary: "g".repeat(15000) });
    expect(r.trimmed).toBe(true);
    expect(r.graphSummary.length).toBe(5000 + MARK.length);
    expect(r.history).toHaveLength(2);
    expect(r.history[1].content.startsWith("9-")).toBe(true);
    expect(r.history[1].content).toHaveLength(3000); // 最新整条保留
    expect(r.history[0].content.startsWith("8-")).toBe(true);
    expect(r.history[0].content).toHaveLength(2000 + MARK.length);
  });

  it("正文较短但历史/摘要巨大：保留额度显著多于旧版一刀切", () => {
    // 5k 正文 → 剩余 35k：摘要 min(20k, 17.5k)=17.5k，历史 17.5k → 装下最新 5 条整条(15k)
    // + 第 6 条截到 2.5k。远宽于旧版固定 2×1000+4000。
    const r = allocateContextBudget({ message: "a".repeat(5000), history: mkHistory(10), graphSummary: "g".repeat(20000) });
    expect(r.trimmed).toBe(true);
    expect(r.graphSummary.length).toBe(17500 + MARK.length);
    expect(r.history).toHaveLength(6);
    expect(r.history.slice(1).every((m) => m.content.length === 3000)).toBe(true);
    expect(r.history[0].content).toHaveLength(2500 + MARK.length);
    expect(r.maxTokens).toBe(16000);
  });

  it("极限挤压：正文 32k 顶满时仍保底摘要下限与最近 2 条历史", () => {
    const r = allocateContextBudget({ message: "a".repeat(32000), history: mkHistory(10, 8000), graphSummary: "g".repeat(20000) });
    expect(r.trimmed).toBe(true);
    expect(r.graphSummary.length).toBeGreaterThanOrEqual(GRAPH_MIN_CHARS);
    expect(r.history.length).toBeGreaterThanOrEqual(HISTORY_MIN_KEEP);
    for (const m of r.history.slice(-HISTORY_MIN_KEEP)) {
      expect(m.content.length).toBeGreaterThanOrEqual(HISTORY_MIN_ENTRY_CHARS);
    }
    // 总量被控制在预算量级（保底项可轻微超出，但不会失控）
    const total = r.history.reduce((a, m) => a + m.content.length, 0) + r.graphSummary.length;
    expect(total).toBeLessThanOrEqual(AGENT_INPUT_CHAR_BUDGET - 32000 + HISTORY_MIN_KEEP * HISTORY_MIN_ENTRY_CHARS + 2 * MARK.length + GRAPH_MIN_CHARS);
  });

  it("history/graphSummary 缺省时安全返回", () => {
    const short = allocateContextBudget({ message: "hi" });
    expect(short).toEqual({ trimmed: false, history: [], graphSummary: "", maxTokens: 16000 });
    const long = allocateContextBudget({ message: "a".repeat(LONG_INPUT_THRESHOLD + 1) });
    expect(long).toEqual({ trimmed: false, history: [], graphSummary: "", maxTokens: 6000 });
  });
});
