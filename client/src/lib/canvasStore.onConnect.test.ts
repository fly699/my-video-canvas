// onConnect 去重回归测试：
//   1. 同一对节点之间，汇入「不同输入口」的边必须能并存（剪辑节点 video-in / audio-in 是
//      两个独立输入，视频源→video-in 与音频源→audio-in 不能互相挤掉）——曾因去重只按
//      「源+目标」判断，第二根线被静默丢弃（圆点高亮却连不上，仅多输入节点中招）。
//   2. 同一对节点 + 同一输入口的重复线仍被拦下（防「一次拖拽落点不精确产生多条重叠重复边」）。
//   3. 图像源→参考图目标：含糊落点（input / 中部）被规正到 ref-image-in，故重复线仍判重拦下。
import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";

type AnyNode = { id: string; type: string; position: { x: number; y: number }; data: { nodeType: string; title: string; payload: Record<string, unknown>; projectId: number } };
const node = (id: string, nodeType: string, payload: Record<string, unknown> = {}): AnyNode => ({
  id, type: "custom", position: { x: 0, y: 0 }, data: { nodeType, title: id, payload, projectId: 1 },
});
function seed(nodes: AnyNode[]) {
  useCanvasStore.setState({ nodes: nodes as never, edges: [], past: [], future: [], _suppressHistory: true, currentUserId: null } as never);
}
const handles = () => useCanvasStore.getState().edges.map((e) => `${e.sourceHandle ?? "?"}->${e.targetHandle ?? "?"}`);

beforeEach(() => seed([]));

describe("onConnect 去重", () => {
  it("同一对节点的不同输入口（clip 的 video-in / audio-in）可并存", () => {
    seed([node("v", "video_task"), node("c", "clip")]);
    const { onConnect } = useCanvasStore.getState();
    onConnect({ source: "v", target: "c", sourceHandle: "output", targetHandle: "audio-in" });
    onConnect({ source: "v", target: "c", sourceHandle: "output", targetHandle: "video-in" });
    expect(handles()).toEqual(["output->audio-in", "output->video-in"]);
  });

  it("同一对节点 + 同一输入口的重复线被拦下", () => {
    seed([node("v", "video_task"), node("c", "clip")]);
    const { onConnect } = useCanvasStore.getState();
    onConnect({ source: "v", target: "c", sourceHandle: "output", targetHandle: "video-in" });
    onConnect({ source: "v", target: "c", sourceHandle: "output", targetHandle: "video-in" });
    expect(handles()).toEqual(["output->video-in"]);
  });

  it("图像源→视频节点：含糊落点规正到 ref-image-in，重复线仍判重拦下", () => {
    seed([node("img", "image_gen", { imageUrl: "https://x/a.png" }), node("v", "video_task")]);
    const { onConnect } = useCanvasStore.getState();
    // 第一根精确落到 ref-image-in
    onConnect({ source: "img", target: "v", sourceHandle: "output", targetHandle: "ref-image-in" });
    // 第二根落到中部 input —— effectiveTargetHandle 规正回 ref-image-in，应判为重复
    onConnect({ source: "img", target: "v", sourceHandle: "output", targetHandle: "input" });
    expect(handles()).toEqual(["output->ref-image-in"]);
  });
});
