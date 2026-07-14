import { describe, it, expect } from "vitest";
import { deriveAiSessions, resolveActiveSession } from "./aiClientSessions";
import type { NodeType } from "../../../shared/types";

const N = (id: string, nodeType: NodeType, data: Record<string, unknown> = {}) => ({ id, data: { nodeType, ...data } });

describe("deriveAiSessions", () => {
  it("仅收 ai_chat 节点，过滤其它类型", () => {
    const s = deriveAiSessions([
      N("a", "ai_chat", { payload: { messages: [{ role: "user", content: "你好" }] } }),
      N("b", "image_gen", {}),
      N("c", "ai_chat", { payload: { messages: [] } }),
    ]);
    expect(s.map((x) => x.nodeId)).toEqual(["a", "c"]);
  });

  it("标题优先节点 title，其次首条用户消息前缀，都无则「新会话」", () => {
    const s = deriveAiSessions([
      N("a", "ai_chat", { title: "剧本讨论", payload: { messages: [{ role: "user", content: "写个开场" }] } }),
      N("b", "ai_chat", { payload: { messages: [{ role: "user", content: "帮我想三个赛博朋克镜头描述" }] } }),
      N("c", "ai_chat", { payload: { messages: [] } }),
    ]);
    expect(s[0].title).toBe("剧本讨论");
    expect(s[1].title).toBe("帮我想三个赛博朋克镜头描述");
    expect(s[2].title).toBe("新会话");
  });

  it("preview 取最后一条消息前缀；count 为条数", () => {
    const s = deriveAiSessions([
      N("a", "ai_chat", { payload: { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "你好，我能帮你什么" }] } }),
    ]);
    expect(s[0].preview).toBe("你好，我能帮你什么");
    expect(s[0].count).toBe(2);
  });

  it("超长标题/预览截断", () => {
    const long = "床前明月光疑是地上霜举头望明月低头思故乡".repeat(5);
    const s = deriveAiSessions([N("a", "ai_chat", { payload: { messages: [{ role: "user", content: long }] } })]);
    expect(s[0].title.endsWith("…")).toBe(true);
    expect(s[0].title.length).toBeLessThanOrEqual(41);
  });

  it("带 model 字段", () => {
    const s = deriveAiSessions([N("a", "ai_chat", { payload: { model: "gpt-5.2", messages: [] } })]);
    expect(s[0].model).toBe("gpt-5.2");
  });
});

describe("resolveActiveSession", () => {
  const sessions = [
    { nodeId: "a", title: "A", preview: "", count: 0 },
    { nodeId: "b", title: "B", preview: "", count: 0 },
  ];
  it("preferred 仍存在 → 保持", () => {
    expect(resolveActiveSession(sessions, "b")).toBe("b");
  });
  it("preferred 已失效 → 回落第一个", () => {
    expect(resolveActiveSession(sessions, "zzz")).toBe("a");
    expect(resolveActiveSession(sessions, null)).toBe("a");
  });
  it("无会话 → null", () => {
    expect(resolveActiveSession([], "a")).toBeNull();
  });
});
