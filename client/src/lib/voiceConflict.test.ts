// #303 重音冲突判定：防误报第一优先（宁漏报不误报）。
import { describe, it, expect } from "vitest";
import { videoPromptSpeaks } from "./voiceConflict";

describe("#303 videoPromptSpeaks（视频提示词是否会念出这段对白）", () => {
  it("①台词正文原样出现在视频提示词 → 冲突（角色行/旁白行都算）", () => {
    expect(videoPromptSpeaks("天台夜景，陈默望向远方说道：夜色真美，可惜没人陪我看。镜头推近。", "陈默：夜色真美，可惜没人陪我看。")).toBe(true);
    expect(videoPromptSpeaks("空镜，远处传来汽笛声，城市渐渐睡去。", "远处传来汽笛声，城市渐渐睡去。")).toBe(true);
  });

  it("②视频提示词自含「角色名：台词」行且角色属于本镜对白角色 → 冲突", () => {
    expect(videoPromptSpeaks("中景。\n陈默：你还好吗？", "陈默：完全不同的另一句台词。")).toBe(true);
  });

  it("防误报：参数行（风格：/运镜：）不是对白；台词没写进提示词不冲突；短台词(<4字)不触发子串", () => {
    expect(videoPromptSpeaks("风格：写实电影感。\n运镜：缓慢推近。", "陈默：夜色真美。")).toBe(false); // 风格/运镜 ∉ 对白角色
    expect(videoPromptSpeaks("纯画面描述，没有任何台词。", "陈默：夜色真美，可惜没人陪我看。")).toBe(false);
    expect(videoPromptSpeaks("他说了声好。", "陈默：好。")).toBe(false); // 正文仅 1 字，子串必然噪声
    expect(videoPromptSpeaks("", "陈默：夜色真美。")).toBe(false);
    expect(videoPromptSpeaks("有画面。", "")).toBe(false);
  });
});
