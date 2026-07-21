// #309a Poyo 官方 SSE 流式：解析器 + 响应消费（含自动回退判定）合约测试。
// SSE 形态严格按 docs/poyo-llm-api.md：`data: {chunk}` 行 + `data: [DONE]` 结束，
// 增量在 choices[0].delta.content。
import { describe, it, expect } from "vitest";
import { makeChatSseFeeder } from "./_core/sseStream";
import { consumeChatSseResponse } from "./_core/llm";

const chunk = (content?: string, extra?: Record<string, unknown>) =>
  `data: ${JSON.stringify({ id: "cc-1", model: "gpt-5.2", choices: [{ delta: content !== undefined ? { content } : {}, finish_reason: null }], ...extra })}\n\n`;
const finalChunk = () =>
  `data: ${JSON.stringify({ id: "cc-1", model: "gpt-5.2", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`;

describe("#309a makeChatSseFeeder（chat.completions SSE 解析）", () => {
  it("常规流：delta 拼接、finish_reason/usage/DONE 捕获；注释与 event 行忽略", () => {
    const deltas: string[] = [];
    const { feed, acc } = makeChatSseFeeder((t) => deltas.push(t));
    feed(": keep-alive 注释\n");
    feed("event: message\n");
    feed(chunk("你好"));
    feed(chunk("，画布"));
    feed(finalChunk());
    feed("data: [DONE]\n\n");
    expect(acc.text).toBe("你好，画布");
    expect(deltas).toEqual(["你好", "，画布"]);
    expect(acc.finishReason).toBe("stop");
    expect(acc.usage?.total_tokens).toBe(15);
    expect(acc.done).toBe(true);
    expect(acc.model).toBe("gpt-5.2");
  });

  it("跨 chunk 半行缓冲：一条 data 行被劈成三段不丢不重；CRLF 兼容", () => {
    const { feed, acc } = makeChatSseFeeder();
    const line = chunk("增量").replace(/\n\n$/, "\r\n\r\n");
    feed(line.slice(0, 20)); feed(line.slice(20, 45)); feed(line.slice(45));
    expect(acc.text).toBe("增量");
  });

  it("非法 JSON 行忽略、空 delta 不回调", () => {
    const deltas: string[] = [];
    const { feed, acc } = makeChatSseFeeder((t) => deltas.push(t));
    feed("data: {broken json\n");
    feed(chunk(""));
    feed(chunk("好"));
    expect(acc.text).toBe("好");
    expect(deltas).toEqual(["好"]);
  });
});

const sseResponse = (body: string, init?: { status?: number; ctype?: string }) =>
  new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }), { status: init?.status ?? 200, headers: { "content-type": init?.ctype ?? "text/event-stream" } });

describe("#309a consumeChatSseResponse（响应消费 + 回退判定）", () => {
  it("合法 SSE → 组装 InvokeResult（正文/finish/usage/model），deltas 逐段回调", async () => {
    const deltas: string[] = [];
    const r = await consumeChatSseResponse(sseResponse(chunk("规划") + chunk("完成") + finalChunk() + "data: [DONE]\n\n"), "gpt-5.2", (d) => deltas.push(d));
    expect(r).not.toBeNull();
    expect(r!.choices[0].message.content).toBe("规划完成");
    expect(r!.choices[0].finish_reason).toBe("stop");
    expect(r!.usage?.total_tokens).toBe(15);
    expect(deltas).toEqual(["规划", "完成"]);
  });

  it("非 event-stream（网关无视 stream 回 JSON）→ null（调用方回退非流式）", async () => {
    const r = await consumeChatSseResponse(sseResponse(`{"choices":[]}`, { ctype: "application/json" }), "gpt-5.2", () => {});
    expect(r).toBeNull();
  });

  it("非 200 → null；SSE 流里没有任何正文 → null（不赌空回复）", async () => {
    expect(await consumeChatSseResponse(sseResponse("oops", { status: 500 }), "gpt-5.2", () => {})).toBeNull();
    expect(await consumeChatSseResponse(sseResponse("data: [DONE]\n\n"), "gpt-5.2", () => {})).toBeNull();
  });
});
