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

  it("#300 prompt 承载对白：含角色行且连视频的 prompt 当镜；无对白行/无下游视频不收", () => {
    const prompt = (id: string, title: string, positivePrompt: string): DubScanNode => ({
      id, data: { nodeType: "prompt", title, payload: { positivePrompt } },
    });
    const video = (id: string, title = ""): DubScanNode => ({ id, data: { nodeType: "video_task", title, payload: {} } });
    const nodes = [
      prompt("p2", "镜头 2", "街角夜景，霓虹。\n林小雨：等我。"),
      prompt("p1", "镜头 1", "天台全景，冷色调。\n陈默：夜色真美。\n镜头缓缓推近。"),
      prompt("p3", "镜头 3", "纯画面描述，没有对白行。"),          // 无角色行 → 不收
      prompt("p9", "镜头 9", "陈默：孤立的提示词。"),               // 无下游视频 → 不收
      prompt("p4", "", "陈默：走 imageFirst 链。"),                 // 镜号取下游视频标题
      { id: "ig", data: { nodeType: "image_gen", payload: {} } },
      video("v1"), video("v2"), video("v3"), video("v4", "SH04 视频"),
    ];
    const edges = [e("p1", "v1"), e("p2", "v2"), e("p3", "v3"), e("p4", "ig"), e("ig", "v4")];
    const r = collectDubShots(nodes, edges);
    expect(r.shots.map((s) => s.sbId)).toEqual(["p1", "p2", "p4"]); // 按镜号 1,2,4 排序
    expect(r.shots[0].text).toBe("陈默：夜色真美。");                 // 只收角色行，画面描述剥除
    expect(r.shots[2].sceneNumber).toBe(4);                          // imageFirst 链镜号来自下游视频标题
  });

  it("#300 零回归：纯分镜画布的收集结果与 prompt 支持无关（prompt 无对白行时不影响）", () => {
    const nodes = [
      sb("s1", { sceneNumber: 1, dialogue: "旁白。" }),
      { id: "p", data: { nodeType: "prompt", title: "镜头 1", payload: { positivePrompt: "纯画面提示词" } } } as DubScanNode,
      { id: "v", data: { nodeType: "video_task", payload: {} } } as DubScanNode,
    ];
    const r = collectDubShots(nodes, [e("p", "v")]);
    expect(r.shots.map((s) => s.sbId)).toEqual(["s1"]);
    expect(r.total).toBe(1);
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
