import { describe, it, expect } from "vitest";
import { extractJsonObjects } from "./routers/agent";

// 复现 router 的「优先取含 operations 的对象」选择逻辑，验证抗散文/技能污染。
const pickPlan = (text: string): string | undefined => {
  const cands = extractJsonObjects(text);
  return cands.find((c) => /"operations"\s*:/.test(c)) ?? cands.find((c) => /"reply"\s*:/.test(c)) ?? cands[cands.length - 1];
};

describe("extractJsonObjects（括号配平抽取，抗技能/散文里的花括号污染）", () => {
  it("纯 JSON 对象", () => {
    expect(extractJsonObjects('{"reply":"x","operations":[]}')).toEqual(['{"reply":"x","operations":[]}']);
  });

  it("散文前后缀 + 技能说明里的花括号：只挑出含 operations 的对象（贪婪正则会抠错）", () => {
    const t = '好的，我先用了技能整理镜头 {step: 1, note}。最终计划如下：\n{"reply":"12镜","operations":[{"op":"create","tempId":"n1","nodeType":"prompt"}]}\n附注：见 {附录A}';
    const plan = pickPlan(t);
    expect(plan).toBeTruthy();
    const parsed = JSON.parse(plan!);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.reply).toBe("12镜");
  });

  it("字符串内的花括号/引号不误判（提示词含 {} 与转义引号）", () => {
    const t = '{"reply":"用 {风格} 描述","operations":[{"op":"create","payload":{"positivePrompt":"a \\"quote\\" and {brace}"}}]}';
    const objs = extractJsonObjects(t);
    expect(objs).toHaveLength(1); // 整个只有一个顶层对象，内部 {} 不拆
    const parsed = JSON.parse(objs[0]);
    expect(parsed.operations[0].payload.positivePrompt).toBe('a "quote" and {brace}');
  });

  it("多个顶层对象：按序返回，pick 取含 operations 的", () => {
    const objs = extractJsonObjects('{"note":"闲聊"} 然后 {"reply":"r","operations":[]}');
    expect(objs).toHaveLength(2);
    expect(pickPlan('{"note":"闲聊"} 然后 {"reply":"r","operations":[]}')).toContain('"operations"');
  });

  it("无对象 → 空数组（纯散文回答走 reply 兜底）", () => {
    expect(extractJsonObjects("这是一个纯文字回答，没有 JSON。")).toEqual([]);
  });

  it("被截断的半截 JSON（缺右括号）→ 不产出配平对象（走截断兜底而非泄漏半截）", () => {
    expect(extractJsonObjects('好的：{"reply":"x","opera')).toEqual([]);
  });
});
