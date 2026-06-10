import { describe, it, expect } from "vitest";
import { parseDialogueLines, extractRoles, shouldCast, planCastSegments } from "./dialogueCasting";

describe("parseDialogueLines", () => {
  it("parses 「角色名：台词」 with Chinese or Latin colons and strips the prefix", () => {
    const segs = parseDialogueLines("阿明：站住！\nLily: Don't move.\n夜色渐深，街道空无一人。");
    expect(segs).toEqual([
      { role: "阿明", text: "站住！" },
      { role: "Lily", text: "Don't move." },
      { role: null, text: "夜色渐深，街道空无一人。" },
    ]);
  });

  it("does not treat long or punctuated prefixes as roles", () => {
    // 角色名超过 12 字 / 含标点 / 含空白 → 整行算旁白
    const segs = parseDialogueLines("这是一个特别特别特别长的前缀啊：不算角色\n你好，世界：也不算");
    expect(segs.every((s) => s.role === null)).toBe(true);
  });

  it("ignores empty lines", () => {
    expect(parseDialogueLines("\n\n阿明：嗯\n\n")).toHaveLength(1);
  });
});

describe("extractRoles", () => {
  it("dedupes across shots preserving first-seen order", () => {
    const roles = extractRoles(["阿明：a\n小红：b", undefined, "小红：c\n阿明：d\n老王：e"]);
    expect(roles).toEqual(["阿明", "小红", "老王"]);
  });
});

describe("shouldCast / planCastSegments", () => {
  const segs = parseDialogueLines("阿明：你来了。\n小红：嗯。\n小红：坐吧。\n（雨声渐起）");
  const fallback = { model: "openai_tts_real", voice: "alloy" };

  it("only casts when at least one parsed role has an assigned voice", () => {
    expect(shouldCast(segs, {})).toBe(false);
    expect(shouldCast(segs, { 路人: { model: "m", voice: "v" } })).toBe(false);
    expect(shouldCast(segs, { 阿明: { model: "m", voice: "v" } })).toBe(true);
  });

  it("plans per-role voices, falls back for narration, merges adjacent same-voice segments", () => {
    const cast = {
      阿明: { model: "elevenlabs-v3-tts", voice: "adam" },
      小红: { model: "elevenlabs-v3-tts", voice: "rachel" },
    };
    const plan = planCastSegments(segs, cast, fallback);
    // 小红的两句相邻同音色 → 合并为一次 TTS；旁白行落 fallback
    expect(plan).toEqual([
      { model: "elevenlabs-v3-tts", voice: "adam", text: "你来了。" },
      { model: "elevenlabs-v3-tts", voice: "rachel", text: "嗯。\n坐吧。" },
      { model: "openai_tts_real", voice: "alloy", text: "（雨声渐起）" },
    ]);
  });

  it("single assigned role: unassigned roles + narration all merge into one fallback segment", () => {
    const plan = planCastSegments(segs, { 阿明: { model: "m1", voice: "v1" } }, fallback);
    expect(plan.map((p) => p.voice)).toEqual(["v1", "alloy"]);
    // 小红未分配 → 与旁白同 fallback，相邻全部合并为一次 TTS
    expect(plan[1].text).toBe("嗯。\n坐吧。\n（雨声渐起）");
  });
});
