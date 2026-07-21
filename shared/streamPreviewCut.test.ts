// #322 流式回显 partial 超长裁剪：头 + 省略标记 + 尾（原 slice(-8000) 只留尾部，
// 把开头的规划特征键截掉、导致客户端排版整段失效）。
import { describe, it, expect } from "vitest";
import { cutStreamPartial, STREAM_OMIT_MARK } from "./streamPreviewCut";

describe("#322 cutStreamPartial", () => {
  it("不超上限：原样返回（零改动）", () => {
    const s = "x".repeat(8000);
    expect(cutStreamPartial(s)).toBe(s);
    expect(cutStreamPartial("短文本")).toBe("短文本");
  });

  it("超上限：保住头部与尾部、中间插省略标记，总长不超上限", () => {
    const head = `{"reply":"已为你规划","operations":[` + "a".repeat(3000);
    const tail = "b".repeat(9000) + `{"op":"connect","sourceRef":"vt9","targetRef":"merge3"}`;
    const s = head + tail;
    const out = cutStreamPartial(s);
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out).toContain(STREAM_OMIT_MARK);
    expect(out.startsWith(`{"reply":"已为你规划","operations":[`)).toBe(true); // 头部特征键保住
    expect(out.endsWith(`{"op":"connect","sourceRef":"vt9","targetRef":"merge3"}`)).toBe(true); // 尾部最新进展保住
  });

  it("头尾拼接正好衔接原文的前 1800 与后段（无重叠、无丢中段以外内容）", () => {
    const s = Array.from({ length: 10000 }, (_, i) => String(i % 10)).join("");
    const out = cutStreamPartial(s, 8000, 1800);
    const [h, t] = out.split(STREAM_OMIT_MARK);
    expect(h).toBe(s.slice(0, 1800));
    expect(t).toBe(s.slice(-(8000 - 1800 - STREAM_OMIT_MARK.length)));
  });
});
