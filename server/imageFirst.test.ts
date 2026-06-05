import { describe, it, expect } from "vitest";
import { enforceImageFirst } from "./_core/imageFirst";
import type { AgentOperation } from "../shared/types";

const has = (ops: AgentOperation[], pred: (o: AgentOperation) => boolean) => ops.some(pred);
const creates = (ops: AgentOperation[], t: string) => ops.filter((o) => o.op === "create" && o.nodeType === t);

describe("enforceImageFirst", () => {
  it("splices image_gen between a text source and a video node", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "海边日落", aspectRatio: "9:16" } },
      { op: "connect", sourceRef: "sb1", targetRef: "vt1" },
      { op: "connect", sourceRef: "vt1", targetRef: "merge1" },
    ];
    const out = enforceImageFirst(ops);
    // one image_gen inserted, carrying the video's prompt/aspect
    const imgs = creates(out, "image_gen");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].payload).toMatchObject({ prompt: "海边日落", aspectRatio: "9:16" });
    const imgRef = imgs[0].tempId!;
    // sb1 → image_gen, image_gen → vt1 (no direct sb1 → vt1 anymore)
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "sb1" && o.targetRef === imgRef)).toBe(true);
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === imgRef && o.targetRef === "vt1")).toBe(true);
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "sb1" && o.targetRef === "vt1")).toBe(false);
    // the video → merge connection is preserved
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "vt1" && o.targetRef === "merge1")).toBe(true);
  });

  it("image_gen create op precedes the connects that reference it (apply order)", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "x" } },
      { op: "connect", sourceRef: "p1", targetRef: "vt1" },
    ];
    const out = enforceImageFirst(ops);
    const imgRef = creates(out, "image_gen")[0].tempId!;
    const createIdx = out.findIndex((o) => o.op === "create" && o.tempId === imgRef);
    const firstUse = out.findIndex((o) => o.op === "connect" && (o.sourceRef === imgRef || o.targetRef === imgRef));
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeLessThan(firstUse);
  });

  it("leaves a video already fed by an image producer untouched", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "image_gen", tempId: "img1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "x" } },
      { op: "connect", sourceRef: "img1", targetRef: "vt1" },
    ];
    const out = enforceImageFirst(ops);
    expect(creates(out, "image_gen")).toHaveLength(1); // no extra one added
    expect(out).toHaveLength(ops.length);
  });

  it("handles multiple shots, one image_gen per video", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb1", payload: {} },
      { op: "create", nodeType: "storyboard", tempId: "sb2", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "镜头1" } },
      { op: "create", nodeType: "video_task", tempId: "vt2", payload: { prompt: "镜头2" } },
      { op: "connect", sourceRef: "sb1", targetRef: "vt1" },
      { op: "connect", sourceRef: "sb2", targetRef: "vt2" },
    ];
    const out = enforceImageFirst(ops);
    expect(creates(out, "image_gen")).toHaveLength(2);
  });

  it("no video nodes → unchanged", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "s1", payload: {} },
      { op: "create", nodeType: "image_gen", tempId: "img1", payload: {} },
      { op: "connect", sourceRef: "s1", targetRef: "img1" },
    ];
    expect(enforceImageFirst(ops)).toEqual(ops);
  });
});
