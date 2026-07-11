import { describe, it, expect } from "vitest";
import { serializeMessagesForLog, capLogText, detectLlmRoute } from "./_core/llmWithKie";
import { insertLlmUsageLog, getLlmUsageLogs, getLlmUsageLogDetail, getLlmUsageSummary, clearLlmUsageLogs } from "./db";
import type { Message } from "./_core/llm";

describe("LLM 日志：prompt 序列化 / 截断 / 路由识别", () => {
  it("多模态 messages 序列化：文本原样，图片/文件用占位符（不落 base64）", () => {
    const messages: Message[] = [
      { role: "system", content: "你是助手" },
      { role: "user", content: [
        { type: "text", text: "看这张图" } as never,
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } } as never,
      ] },
    ];
    const s = serializeMessagesForLog(messages);
    expect(s).toContain("【system】你是助手");
    expect(s).toContain("【user】看这张图 [图片]");
    expect(s).not.toContain("base64");
  });

  it("capLogText：超限截断并标注原始长度，未超限原样", () => {
    expect(capLogText("短文本")).toBe("短文本");
    const long = "x".repeat(13000);
    const capped = capLogText(long);
    expect(capped.length).toBeLessThan(12100);
    expect(capped).toContain("已截断，原文共 13000 字");
  });

  it("detectLlmRoute：kie/自定义/平台（自建/桥接依赖部署配置，测试环境未配置时回落平台）", () => {
    expect(detectLlmRoute("kie_claude_opus_45")).toBe("kie");
    expect(detectLlmRoute("custom_openai")).toBe("custom");
    expect(detectLlmRoute("gemini-2.5-flash")).toBe("platform");
    expect(detectLlmRoute(undefined)).toBe("platform");
  });
});

describe("LLM 日志：devStore 查询（筛选/关键词/统计/详情）", () => {
  it("插入→多条件筛选→关键词→详情→统计→清空 全链路", async () => {
    await clearLlmUsageLogs();
    await insertLlmUsageLog({ userId: 1, userName: "张三", scene: "scripts.generate", model: "m1", route: "platform", status: "success", durationMs: 1200, promptChars: 10, replyChars: 20, promptText: "写一个武侠脚本", replyText: "从前有座山" });
    await insertLlmUsageLog({ userId: 2, userName: "李四", scene: "agent.chat", model: "m2", route: "kie", status: "error", errorMessage: "额度不足", durationMs: 300, promptChars: 5, replyChars: 0, promptText: "帮我建节点", replyText: "" });

    const all = await getLlmUsageLogs({});
    expect(all.total).toBe(2);
    // 列表行不带全文、带预览
    expect((all.rows[0] as unknown as { promptText?: string }).promptText).toBeUndefined();
    expect(all.rows.map((r) => r.promptPreview)).toContain("写一个武侠脚本");

    expect((await getLlmUsageLogs({ scene: "agent.chat" })).total).toBe(1);
    expect((await getLlmUsageLogs({ status: "error" })).rows[0].userName).toBe("李四");
    expect((await getLlmUsageLogs({ userId: 1 })).total).toBe(1);
    expect((await getLlmUsageLogs({ route: "kie" })).total).toBe(1);
    // 关键词命中 prompt / 错误信息 / 用户名
    expect((await getLlmUsageLogs({ q: "武侠" })).total).toBe(1);
    expect((await getLlmUsageLogs({ q: "额度不足" })).total).toBe(1);
    expect((await getLlmUsageLogs({ q: "李四" })).total).toBe(1);
    expect((await getLlmUsageLogs({ q: "不存在的词" })).total).toBe(0);

    const detail = await getLlmUsageLogDetail(all.rows.find((r) => r.userId === 1)!.id);
    expect(detail?.promptText).toBe("写一个武侠脚本");
    expect(detail?.replyText).toBe("从前有座山");

    const sum = await getLlmUsageSummary({});
    expect(sum.totals.calls).toBe(2);
    expect(sum.totals.errors).toBe(1);
    expect(sum.byScene.map((x) => x.scene).sort()).toEqual(["agent.chat", "scripts.generate"]);
    expect(sum.byUser.find((u) => u.userId === 2)?.errors).toBe(1);

    await clearLlmUsageLogs();
    expect((await getLlmUsageLogs({})).total).toBe(0);
  });
});
