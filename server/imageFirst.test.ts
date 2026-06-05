import { describe, it, expect } from "vitest";
import { enforceImageFirst, enforceImageFirstComfy } from "./_core/imageFirst";
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

  it("a video with two non-image sources gets ONE image node and ONE image→video edge", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb1", payload: {} },
      { op: "create", nodeType: "prompt", tempId: "p1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "x" } },
      { op: "connect", sourceRef: "sb1", targetRef: "vt1" },
      { op: "connect", sourceRef: "p1", targetRef: "vt1" },
    ];
    const out = enforceImageFirst(ops);
    expect(creates(out, "image_gen")).toHaveLength(1);
    const imgRef = creates(out, "image_gen")[0].tempId!;
    const imgToVid = out.filter((o) => o.op === "connect" && o.sourceRef === imgRef && o.targetRef === "vt1");
    expect(imgToVid).toHaveLength(1); // not duplicated per source
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

describe("enforceImageFirstComfy", () => {
  const IMG = new Set([10]);   // image-output template ids
  const VID = new Set([20]);   // video-output template ids
  const cw = (ops: AgentOperation[]) => ops.filter((o) => o.op === "create" && o.nodeType === "comfyui_workflow");

  it("splices an image comfyui_workflow before a video comfyui_workflow fed by a prompt", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: { positivePrompt: "猫" } },
      { op: "create", nodeType: "comfyui_workflow", tempId: "vcw1", payload: { templateId: 20, prompt: "猫" } },
      { op: "connect", sourceRef: "p1", targetRef: "vcw1" },
      { op: "connect", sourceRef: "vcw1", targetRef: "merge1" },
    ];
    const out = enforceImageFirstComfy(ops, IMG, VID, 10);
    const cws = cw(out);
    // original video cw + inserted image cw
    expect(cws).toHaveLength(2);
    const img = cws.find((o) => (o.payload as { templateId?: number }).templateId === 10)!;
    expect(img).toBeTruthy();
    expect((img.payload as { prompt?: string }).prompt).toBe("猫"); // carries the video's prompt
    const imgRef = img.tempId!;
    expect(out.some((o) => o.op === "connect" && o.sourceRef === "p1" && o.targetRef === imgRef)).toBe(true);
    expect(out.some((o) => o.op === "connect" && o.sourceRef === imgRef && o.targetRef === "vcw1")).toBe(true);
    expect(out.some((o) => o.op === "connect" && o.sourceRef === "p1" && o.targetRef === "vcw1")).toBe(false);
  });

  it("leaves a video cw already fed by an image cw untouched", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "comfyui_workflow", tempId: "icw1", payload: { templateId: 10 } },
      { op: "create", nodeType: "comfyui_workflow", tempId: "vcw1", payload: { templateId: 20 } },
      { op: "connect", sourceRef: "icw1", targetRef: "vcw1" },
    ];
    const out = enforceImageFirstComfy(ops, IMG, VID, 10);
    expect(cw(out)).toHaveLength(2); // no extra inserted
  });

  it("no video-template cw → unchanged", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "comfyui_workflow", tempId: "icw1", payload: { templateId: 10 } },
      { op: "connect", sourceRef: "p1", targetRef: "icw1" },
    ];
    expect(enforceImageFirstComfy(ops, IMG, VID, 10)).toEqual(ops);
  });
});
