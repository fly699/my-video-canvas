// #306 桥接流式回显：增量喂食器 + 进程内总线 纯函数测试。
import { describe, it, expect } from "vitest";
import { makeStreamJsonDeltaFeeder } from "./_core/bridgeAttachments";
import { isValidStreamChannel, subscribeBridgeStream, publishBridgeDelta, bridgeStreamSubscriberCount } from "./_core/bridgeStreamBus";

const evLine = (text: string) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }) + "\n";

describe("#306 makeStreamJsonDeltaFeeder（stream-json 增量解析）", () => {
  it("完整行：按序回调 text delta；其他事件/非 JSON 行忽略", () => {
    const got: string[] = [];
    const feed = makeStreamJsonDeltaFeeder((t) => got.push(t));
    feed(JSON.stringify({ type: "system", subtype: "init" }) + "\n");
    feed(evLine("你好"));
    feed("not json at all\n");
    feed(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }) + "\n");
    feed(evLine("，世界"));
    feed(JSON.stringify({ type: "result", result: "你好，世界" }) + "\n");
    expect(got).toEqual(["你好", "，世界"]);
  });

  it("跨 chunk 半行缓冲：一行 JSON 被从中间劈开也不丢、不重", () => {
    const got: string[] = [];
    const feed = makeStreamJsonDeltaFeeder((t) => got.push(t));
    const line = evLine("增量片段");
    feed(line.slice(0, 25));
    feed(line.slice(25, 40));
    feed(line.slice(40));
    expect(got).toEqual(["增量片段"]);
  });

  it("空 delta 文本不回调（防止空串刷屏）", () => {
    const got: string[] = [];
    const feed = makeStreamJsonDeltaFeeder((t) => got.push(t));
    feed(evLine(""));
    feed(evLine("有内容"));
    expect(got).toEqual(["有内容"]);
  });
});

describe("#306 bridgeStreamBus（进程内增量总线）", () => {
  it("channel 校验：jobId 形态放行；短串/怪字符/非字符串拒绝", () => {
    expect(isValidStreamChannel("acj_m1abc2_x9y8z7w6")).toBe(true);
    expect(isValidStreamChannel("short")).toBe(false);
    expect(isValidStreamChannel("bad channel with spaces!")).toBe(false);
    expect(isValidStreamChannel(123)).toBe(false);
    expect(isValidStreamChannel(undefined)).toBe(false);
  });

  it("订阅/发布/退订：退订后发布是 no-op；订阅方抛异常被吞掉", () => {
    const got: string[] = [];
    const before = bridgeStreamSubscriberCount();
    const unsub = subscribeBridgeStream("test_channel_306", (d) => { got.push(d); if (d === "boom") throw new Error("订阅方异常"); });
    expect(bridgeStreamSubscriberCount()).toBe(before + 1);
    publishBridgeDelta("test_channel_306", "a");
    publishBridgeDelta("test_channel_306", "");        // 空串 no-op
    publishBridgeDelta("other_channel_xx", "别人的");   // 无订阅者 no-op
    expect(() => publishBridgeDelta("test_channel_306", "boom")).not.toThrow(); // 异常不外泄
    unsub();
    expect(bridgeStreamSubscriberCount()).toBe(before);
    publishBridgeDelta("test_channel_306", "late");
    expect(got).toEqual(["a", "boom"]);
  });
});
