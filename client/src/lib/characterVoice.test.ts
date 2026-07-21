// #297 角色卡音色徽标取值逻辑：遍历「角色档案 → 脚本 castVoices」全部锁定途径。
import { describe, it, expect } from "vitest";
import { resolveCharacterVoice, voiceShortLabel, voiceFullLabel } from "./characterVoice";

const scriptNode = (cast: Record<string, { model?: string; voice?: string }>, title = "第一场") => ({
  nodeType: "script", title, payload: { castVoices: cast },
});

describe("#297 resolveCharacterVoice（音色徽标遍历所有锁定途径）", () => {
  it("档案锁定优先（助手 set_voice / 镜头表回写 / 角色库带入的落点）", () => {
    const r = resolveCharacterVoice("陈默", { voiceModel: "elevenlabs-v3-tts", voiceId: "Rachel" }, [
      scriptNode({ 陈默: { model: "openai_tts_real", voice: "nova" } }),
    ]);
    expect(r).toEqual({ model: "elevenlabs-v3-tts", voice: "Rachel", source: "profile" });
  });

  it("无档案时回退扫描脚本配音表（Casting 面板只写 castVoices 不回写档案）", () => {
    const r = resolveCharacterVoice("林小雨", {}, [
      scriptNode({}, "空场"),
      scriptNode({ 林小雨: { model: "openai_tts_real", voice: "nova" } }, "第二场"),
    ]);
    expect(r).toEqual({ model: "openai_tts_real", voice: "nova", source: "script", scriptTitle: "第二场" });
  });

  it("两处都没有 → null；半截数据（缺 voice）不算锁定；名字取 trim 后精确匹配", () => {
    expect(resolveCharacterVoice("陈默", {}, [scriptNode({ 陈默: { model: "openai_tts_real" } })])).toBeNull();
    expect(resolveCharacterVoice("", { voiceModel: "", voiceId: "" }, [])).toBeNull();
    expect(resolveCharacterVoice(" 陈默 ", {}, [scriptNode({ 陈默: { model: "xai-tts-1", voice: "eve" } })])?.voice).toBe("eve");
  });

  it("标签：目录内出中文名、目录外回退原始 id、voxcpm 显示克隆音色", () => {
    expect(voiceShortLabel("elevenlabs-v3-tts", "Rachel")).toBe("瑞秋 Rachel");
    expect(voiceShortLabel("unknown-model", "someVoice")).toBe("someVoice");
    expect(voiceShortLabel("voxcpm-local", "whatever")).toBe("克隆音色");
    expect(voiceFullLabel("elevenlabs-v3-tts", "Rachel")).toContain("ElevenLabs v3 TTS");
  });
});
