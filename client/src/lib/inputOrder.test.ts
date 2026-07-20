import { describe, it, expect } from "vitest";
import { nearestUpstreamStoryboard, upstreamSceneNumber, makeShotOrderComparator, compareUpstreamNodes } from "./inputOrder";

// #280 合并段序权威化守卫：镜号（多跳回溯）→ 标题尾号 → Y → 连接序。
// MergeNode 段列表与 useWorkflowRunner.collectInputVideoUrls 共用该比较器。

const n = (id: string, nodeType: string, payload: Record<string, unknown> = {}, title = id, y = 0) =>
  ({ id, position: { y }, data: { nodeType, title, payload } });
const byIdOf = (arr: ReturnType<typeof n>[]) => new Map(arr.map((x) => [x.id, x]));

describe("#280 nearestUpstreamStoryboard / upstreamSceneNumber", () => {
  it("一跳直连与隔 image_gen 工位的多跳都能回溯到分镜", () => {
    const nodes = [
      n("sb", "storyboard", { sceneNumber: 7 }),
      n("ig", "image_gen"), n("v1", "video_task"), n("v2", "video_task"),
    ];
    const edges = [
      { source: "sb", target: "v1" },                                     // 一跳
      { source: "sb", target: "ig" }, { source: "ig", target: "v2" },     // 两跳（隔工位）
    ];
    const byId = byIdOf(nodes);
    expect(nearestUpstreamStoryboard("v1", edges, byId)?.id).toBe("sb");
    expect(nearestUpstreamStoryboard("v2", edges, byId)?.id).toBe("sb");
    expect(upstreamSceneNumber("v2", edges, byId)).toBe(7);
  });
  it("不穿透 merge 等汇聚节点；无分镜/无效镜号 → Infinity", () => {
    const nodes = [
      n("sb", "storyboard", { sceneNumber: 1 }), n("m0", "merge"), n("v", "video_task"),
      n("sbBad", "storyboard", { sceneNumber: "x" }), n("v2", "video_task"),
    ];
    const edges = [
      { source: "sb", target: "m0" }, { source: "m0", target: "v" },
      { source: "sbBad", target: "v2" },
    ];
    const byId = byIdOf(nodes);
    expect(nearestUpstreamStoryboard("v", edges, byId)).toBeUndefined(); // merge 不可穿透
    expect(upstreamSceneNumber("v", edges, byId)).toBe(Number.POSITIVE_INFINITY);
    expect(upstreamSceneNumber("v2", edges, byId)).toBe(Number.POSITIVE_INFINITY); // 非法镜号
  });
});

describe("#280 makeShotOrderComparator", () => {
  it("镜号优先（隔工位回溯），无镜号者按原口径殿后", () => {
    const nodes = [
      n("sb2", "storyboard", { sceneNumber: 2 }), n("sb1", "storyboard", { sceneNumber: 1 }),
      n("ig2", "image_gen"),
      n("va", "video_task", {}, "镜头 A", 300),   // 无分镜：标题无尾号 → 按 Y 殿后
      n("vb", "video_task", {}, "素材2", 100),    // 无分镜：尾号 2
      n("v2", "video_task", {}, "任意", 999),     // 镜号 2（隔工位）
      n("v1", "video_task", {}, "任意", 999),     // 镜号 1
    ];
    const edges = [
      { source: "sb1", target: "v1" },
      { source: "sb2", target: "ig2" }, { source: "ig2", target: "v2" },
    ];
    const cmp = makeShotOrderComparator(byIdOf(nodes) as never, edges);
    const order = ["va", "vb", "v2", "v1"].sort((a, b) => cmp(a, b));
    // 有镜号的按镜号在前；无镜号的按 标题尾号(vb=2) → Y(va) 殿后
    expect(order).toEqual(["v1", "v2", "vb", "va"]);
  });
  it("#280 完全不用分镜节点的画布：按标题镜号排序（「镜头 N：描述」数字不在结尾也认）", () => {
    const nodes = [
      n("x3", "video_task", {}, "镜头 3：高潮对决", 10),
      n("x1", "video_task", {}, "镜头 1：日出海面", 400),   // Y 故意最大——旧口径按 Y 会排最后
      n("x2", "video_task", {}, "s2 追逐", 200),
      n("x4", "video_task", {}, "第4镜 收尾", 5),
    ];
    const cmp = makeShotOrderComparator(byIdOf(nodes) as never, []);
    expect(["x3", "x1", "x2", "x4"].sort((a, b) => cmp(a, b))).toEqual(["x1", "x2", "x3", "x4"]);
  });
  it("titleShotNumber：尾号优先，其次镜头N/sN/第N镜等写法，无数字 → Infinity", async () => {
    const { titleShotNumber } = await import("./inputOrder");
    expect(titleShotNumber("素材12")).toBe(12);
    expect(titleShotNumber("镜头 3：日出")).toBe(3);
    expect(titleShotNumber("镜7 奔跑")).toBe(7);
    expect(titleShotNumber("S2 海边")).toBe(2);
    expect(titleShotNumber("第10镜 收尾")).toBe(10);
    expect(titleShotNumber("scene 05")).toBe(5);
    // 用户实报画布的真实命名（SH 前缀 + 数字不在结尾）
    expect(titleShotNumber("SH11 视频")).toBe(11);
    expect(titleShotNumber("SH06 首帧")).toBe(6);
    expect(titleShotNumber("SH06 易平安跃墙")).toBe(6);
    expect(titleShotNumber("无数字标题")).toBe(Number.POSITIVE_INFINITY);
    expect(titleShotNumber("")).toBe(Number.POSITIVE_INFINITY);
  });
  it("零回归：画布无分镜时与 compareUpstreamNodes 排序逐项一致", () => {
    const nodes = [
      n("a", "video_task", {}, "片段3", 10), n("b", "video_task", {}, "片段1", 50),
      n("c", "video_task", {}, "无号", 5), n("d", "video_task", {}, "无号", 90),
    ];
    const byId = byIdOf(nodes);
    const cmp = makeShotOrderComparator(byId as never, []);
    const ids = ["a", "b", "c", "d"];
    const withShot = [...ids].sort((x, y) => cmp(x, y));
    const legacy = [...ids].sort((x, y) => compareUpstreamNodes(byId.get(x), byId.get(y)));
    expect(withShot).toEqual(legacy);
  });
});
