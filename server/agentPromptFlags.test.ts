// #258 提示词开关批②守卫：两个开关默认关时必须零注入/零裁剪（提示词逐字一致的构造性保证），
// 开启时的行为边界（保守裁剪、纯追加）也在此锁死。
import { describe, it, expect } from "vitest";
import { selfCheckRule, includeGuideRule } from "./_core/agentPromptFlags";

describe("selfCheckRule（⑧ 输出前自查）", () => {
  it("关闭/未传 → 空串（模板注入点为空，提示词逐字不变）", () => {
    expect(selfCheckRule(false)).toBe("");
    expect(selfCheckRule(undefined)).toBe("");
  });
  it("开启 → 以换行开头的单条追加规则（纯追加，不含会破坏 JSON 输出的指令）", () => {
    const r = selfCheckRule(true);
    expect(r.startsWith("\n- 【输出前自查")).toBe(true);
    expect(r).toContain("只输出规定的 JSON 本体");
    expect(r.split("\n- ").length).toBe(2); // 恰好一条规则
  });
});

describe("includeGuideRule（⑦ 答疑段按需注入，保守策略）", () => {
  it("开关关 → 无论消息内容一律保留（默认路径逐字一致）", () => {
    expect(includeGuideRule(false, "做一个60秒的产品宣传短片")).toBe(true);
    expect(includeGuideRule(undefined, "做一个60秒的产品宣传短片")).toBe(true);
  });
  it("开关开 + 明确生产指令 → 省略", () => {
    expect(includeGuideRule(true, "做一个60秒的产品宣传短片，赛博朋克风格")).toBe(false);
    expect(includeGuideRule(true, "把第三镜的提示词改成雨夜街头追逐")).toBe(false);
  });
  it("开关开 + 任何疑问/求助特征 → 保留（答疑能力不受影响）", () => {
    expect(includeGuideRule(true, "快剪功能怎么用？")).toBe(true);
    expect(includeGuideRule(true, "极简显示的入口在哪里")).toBe(true);
    expect(includeGuideRule(true, "支持导出 MP3 吗")).toBe(true);
    expect(includeGuideRule(true, "how to use the pose library")).toBe(true);
    expect(includeGuideRule(true, "做个短片，另外双击节点是什么效果？")).toBe(true); // 混合意图 → 保留
  });
  it("开关开 + 空/超短消息（意图不明）→ 保留", () => {
    expect(includeGuideRule(true, "")).toBe(true);
    expect(includeGuideRule(true, undefined)).toBe(true);
    expect(includeGuideRule(true, "继续")).toBe(true);
  });
});
