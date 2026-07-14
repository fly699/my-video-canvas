import { describe, it, expect } from "vitest";
import { promptInQueueLists } from "./_core/comfyui";

// pollHistory 的队列感知：超过软上限后，只要任务仍在 /queue 就继续等（不误报超时）。
// 这里覆盖 /queue 的 queue_running / queue_pending 条目形如 [num, promptId, prompt, ...] 的解析。
describe("promptInQueueLists — /queue 是否含指定 promptId", () => {
  it("命中 queue_running", () => {
    const q = { queue_running: [[0, "abc-123", {}, {}]], queue_pending: [] };
    expect(promptInQueueLists(q, "abc-123")).toBe(true);
  });
  it("命中 queue_pending", () => {
    const q = { queue_running: [], queue_pending: [[3, "wait-9", {}]] };
    expect(promptInQueueLists(q, "wait-9")).toBe(true);
  });
  it("不在任一队列 → false", () => {
    const q = { queue_running: [[0, "other", {}]], queue_pending: [[1, "another", {}]] };
    expect(promptInQueueLists(q, "abc-123")).toBe(false);
  });
  it("空/缺字段/ null 安全返回 false", () => {
    expect(promptInQueueLists({}, "x")).toBe(false);
    expect(promptInQueueLists(null, "x")).toBe(false);
    expect(promptInQueueLists(undefined, "x")).toBe(false);
    expect(promptInQueueLists({ queue_running: [], queue_pending: [] }, "x")).toBe(false);
  });
});
