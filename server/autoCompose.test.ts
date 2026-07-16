import { describe, it, expect } from "vitest";
import { parseAutoComposePlan, buildAutoComposeDoc, type ComposeAsset } from "./_core/autoCompose";

const ASSETS: ComposeAsset[] = [
  { url: "/a/v1.mp4", kind: "video", name: "开场", durationSec: 20, assetId: 1 },
  { url: "/a/p1.png", kind: "image", name: "海报", assetId: 2 },
  { url: "/a/bgm.mp3", kind: "audio", name: "配乐", durationSec: 90, assetId: 3 },
  { url: "/a/v2.mp4", kind: "video", name: "结尾", durationSec: 8, assetId: 4 },
];
const DIMS = { width: 1920, height: 1080, fps: 30 };

describe("parseAutoComposePlan", () => {
  it("解析标准方案（容忍围栏与前后文字）", () => {
    const p = parseAutoComposePlan('方案如下：```json\n{"clips":[{"asset":0,"trimIn":2,"trimOut":8,"transition":"fade"},{"asset":1,"durationSec":3}],"texts":[{"content":"标题","at":0,"durationSec":3,"role":"title"}],"bgm":2,"grade":"subtle"}\n```');
    expect(p?.clips.length).toBe(2);
    expect(p?.bgm).toBe(2);
    expect(p?.grade).toBe("subtle");
    expect(p?.texts?.[0].role).toBe("title");
  });

  it("不被解释文字里的诱饵对象骗走；无 clips 数组 → null", () => {
    expect(parseAutoComposePlan('{"clips":"很多"} 之后才是 {"clips":[{"asset":0}]}')?.clips.length).toBe(1);
    expect(parseAutoComposePlan('{"keep":[{"start":0,"end":1}]}')).toBeNull();
    expect(parseAutoComposePlan("不是 JSON")).toBeNull();
  });

  it("非法 grade / 越界文本被清洗", () => {
    const p = parseAutoComposePlan(`{"clips":[{"asset":0}],"grade":"acid","texts":[{"content":"${"x".repeat(200)}","at":1}]}`);
    expect(p?.grade).toBeUndefined();
    expect(p?.texts?.[0].content.length).toBe(60);
  });
});

describe("buildAutoComposeDoc", () => {
  it("按方案排片：视频截取 + 图片默认时长 + 首尾相接 + 转场只从第二段起", () => {
    const { doc, stats } = buildAutoComposeDoc(ASSETS, {
      clips: [
        { asset: 0, trimIn: 2, trimOut: 8, transition: "fade" }, // 第一段的 transition 应被忽略
        { asset: 1, durationSec: 3, transition: "slideleft" },
        { asset: 3, transition: "notreal" },                       // 非白名单转场丢弃
      ],
    }, DIMS);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v.length).toBe(3);
    expect(v[0].start).toBe(0);
    expect(v[0].trimIn).toBe(2); expect(v[0].trimOut).toBe(8);
    expect(v[0].transitionIn).toBeUndefined();
    expect(v[1].start).toBe(6);                 // 6s 视频段后接图片
    expect(v[1].trimOut).toBe(3);               // 图片 duration=trimOut
    expect(v[1].transitionIn?.type).toBe("slideleft");
    expect(v[2].transitionIn).toBeUndefined();  // 非法转场被丢弃
    expect(v[2].trimOut).toBe(8);               // v2 默认全长（8s）
    expect(stats.totalSec).toBe(17);
  });

  it("越界索引 / 音频进主轨 / 越界截取全部安全处理", () => {
    const { doc } = buildAutoComposeDoc(ASSETS, {
      clips: [
        { asset: 99 },                             // 越界 → 丢
        { asset: 2 },                              // 音频 → 不进主轨
        { asset: 0, trimIn: 15, trimOut: 999 },    // trimOut 夹到 20
        { asset: 1, durationSec: 999 },            // 图片夹到 10
      ],
    }, DIMS);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v.length).toBe(2);
    expect(v[0].trimOut).toBe(20);
    expect(v[1].trimOut).toBe(10);
  });

  it("bgm 铺满成片（不超素材长）+ ducking + 淡出；文字 at/时长夹进成片范围", () => {
    const { doc, stats } = buildAutoComposeDoc(ASSETS, {
      clips: [{ asset: 0, trimIn: 0, trimOut: 10 }],
      texts: [{ content: "标题", at: 0, durationSec: 3, role: "title" }, { content: "尾注", at: 999 }],
      bgm: 2,
    }, DIMS);
    const a = doc.tracks.find((t) => t.type === "audio")!.clips;
    expect(a.length).toBe(1);
    expect(a[0].trimOut).toBe(10);
    expect(a[0].ducking).toBe(true);
    const t = doc.tracks.find((t) => t.type === "text")!.clips;
    expect(t.length).toBe(2);
    expect(t[1].start).toBeLessThanOrEqual(10);   // at=999 被夹进成片末端
    expect(stats.hasBgm).toBe(true);
    expect(stats.texts).toBe(2);
  });

  it("bgm 指到非音频素材 → 忽略；空方案 → 0 片段", () => {
    const r1 = buildAutoComposeDoc(ASSETS, { clips: [{ asset: 0 }], bgm: 0 }, DIMS);
    expect(r1.stats.hasBgm).toBe(false);
    const r2 = buildAutoComposeDoc(ASSETS, { clips: [] }, DIMS);
    expect(r2.stats.clips).toBe(0);
  });

  it("整体调色写进每个画面片段", () => {
    const { doc } = buildAutoComposeDoc(ASSETS, { clips: [{ asset: 0 }, { asset: 1 }], grade: "warm_cinematic" }, DIMS);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v.every((c) => c.effects?.filter === "warm_cinematic")).toBe(true);
  });
});
