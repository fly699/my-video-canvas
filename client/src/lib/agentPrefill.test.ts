import { describe, it, expect, beforeEach, vi } from "vitest";
import { requestAgentPrefill, hasAgentPrefill, consumeAgentPrefill, consumeCloseAiClient } from "./agentPrefill";

// vitest 环境为 node（无 sessionStorage / window）——装一个 Map 支撑的最小桩，覆盖纯逻辑。
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
});

describe("agentPrefill 通道", () => {
  it("请求后可被同项目 peek/consume；consume 一次即清空", () => {
    requestAgentPrefill(7, "让画面动起来");
    expect(hasAgentPrefill(7)).toBe(true);
    expect(consumeAgentPrefill(7)).toBe("让画面动起来");
    expect(hasAgentPrefill(7)).toBe(false);
    expect(consumeAgentPrefill(7)).toBeNull();
  });

  it("不同 projectId 不误取（保留待其消费）", () => {
    requestAgentPrefill(7, "文本A");
    expect(hasAgentPrefill(9)).toBe(false);
    expect(consumeAgentPrefill(9)).toBeNull();
    expect(consumeAgentPrefill(7)).toBe("文本A");
  });

  it("空文本 / 无 projectId 不写入", () => {
    requestAgentPrefill(7, "   ");
    expect(hasAgentPrefill(7)).toBe(false);
    requestAgentPrefill(0, "x");
    expect(hasAgentPrefill(0)).toBe(false);
  });

  it("文本首尾空白被裁剪", () => {
    requestAgentPrefill(3, "  你好  ");
    expect(consumeAgentPrefill(3)).toBe("你好");
  });

  it("关闭浮动 AI 客户端信号：同项目一次性消费，不同项目不误触", () => {
    requestAgentPrefill(7, "文本");
    expect(consumeCloseAiClient(9)).toBe(false); // 别的项目不触发
    expect(consumeCloseAiClient(7)).toBe(true);  // 本项目触发
    expect(consumeCloseAiClient(7)).toBe(false); // 一次性
  });
});
