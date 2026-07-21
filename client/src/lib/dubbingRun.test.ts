// #298 一句话批量配音：collectDubShots 收集口径（与镜头表面板 runDubBatch 对齐）。
import { describe, it, expect } from "vitest";
import { collectDubShots, type DubScanNode, type DubScanEdge } from "./dubbingRun";

const sb = (id: string, payload: Record<string, unknown>): DubScanNode => ({ id, data: { nodeType: "storyboard", payload } });
const audio = (id: string, payload: Record<string, unknown>): DubScanNode => ({ id, data: { nodeType: "audio", payload } });
const chr = (id: string, name: string, model?: string, voice?: string): DubScanNode => ({
  id, data: { nodeType: "character", payload: { name, voiceModel: model, voiceId: voice } },
});
const script = (id: string, castVoices: Record<string, { model: string; voice: string }>): DubScanNode => ({
  id, data: { nodeType: "script", payload: { castVoices } },
});
const e = (source: string, target: string): DubScanEdge => ({ source, target });

describe("#298 collectDubShots（口令版批量配音收集器）", () => {
  it("按镜号排序；已出声跳过、空工位复用、无对白跳过、disabled 剔除", () => {
    const nodes = [
      sb("s3", { sceneNumber: 3, dialogue: "镜3旁白" }),
      sb("s1", { sceneNumber: 1, dialogue: "镜1旁白" }),
      sb("s2", { sceneNumber: 2, dialogue: "镜2旁白" }),
      sb("s4", { sceneNumber: 4 }),                                  // 无对白 → 跳过
      sb("s5", { sceneNumber: 5, dialogue: "x", disabled: true }),   // 跳过参与 → 剔除
      audio("a2", { audioCategory: "dubbing", url: "http://done" }), // s2 已出声
      audio("a3", { audioCategory: "dubbing" }),                     // s3 空工位 → 复用
      audio("sfx3", { audioCategory: "sfx" }),                       // 音效工位不抢占
    ];
    const edges = [e("s2", "a2"), e("s3", "a3"), e("s3", "sfx3")];
    const r = collectDubShots(nodes, edges);
    expect(r.shots.map((s) => s.sbId)).toEqual(["s1", "s3"]);
    expect(r.shots[0].reuseAudioId).toBeNull();
    expect(r.shots[1].reuseAudioId).toBe("a3");
    expect(r.skippedDone).toBe(1);
    expect(r.skippedNoDialogue).toBe(1);
    expect(r.total).toBe(4); // disabled 不计入
  });

  it("音色表：角色档案作默认、上游脚本 castVoices 覆盖（脚本表优先与面板同序）", () => {
    const nodes = [
      chr("c1", "陈默", "elevenlabs-v3-tts", "Rachel"),
      chr("c2", "林小雨", "openai_tts_real", "nova"),
      chr("c3", "无音色者"),
      script("sc", { 林小雨: { model: "xai-tts-1", voice: "eve" } }),
      sb("s1", { sceneNumber: 1, dialogue: "陈默：你好。\n林小雨：你好呀。" }),
      sb("s2", { sceneNumber: 2, dialogue: "旁白一句。" }), // 无上游脚本 → 只有档案默认
    ];
    const edges = [e("sc", "s1")];
    const r = collectDubShots(nodes, edges);
    expect(r.shots[0].cast).toEqual({
      陈默: { model: "elevenlabs-v3-tts", voice: "Rachel" },
      林小雨: { model: "xai-tts-1", voice: "eve" }, // 脚本表覆盖档案
    });
    expect(r.shots[1].cast["陈默"]).toEqual({ model: "elevenlabs-v3-tts", voice: "Rachel" });
    expect(r.shots[1].cast["无音色者"]).toBeUndefined(); // 半截档案不入表
  });
});
