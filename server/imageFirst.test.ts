import { describe, it, expect } from "vitest";
import { enforceImageFirst, enforceImageFirstComfy } from "./_core/imageFirst";
import type { AgentOperation } from "../shared/types";

const has = (ops: AgentOperation[], pred: (o: AgentOperation) => boolean) => ops.some(pred);
const creates = (ops: AgentOperation[], t: string) => ops.filter((o) => o.op === "create" && o.nodeType === t);

describe("enforceImageFirst", () => {
  it("splices image_gen between a text source and a video node", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "海边日落", aspectRatio: "9:16" } },
      { op: "connect", sourceRef: "p1", targetRef: "vt1" },
      { op: "connect", sourceRef: "vt1", targetRef: "merge1" },
    ];
    const out = enforceImageFirst(ops);
    // one image_gen inserted, carrying the video's prompt/aspect
    const imgs = creates(out, "image_gen");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].payload).toMatchObject({ prompt: "海边日落", aspectRatio: "9:16" });
    const imgRef = imgs[0].tempId!;
    // p1 → image_gen, image_gen → vt1 (no direct p1 → vt1 anymore)
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "p1" && o.targetRef === imgRef)).toBe(true);
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === imgRef && o.targetRef === "vt1")).toBe(true);
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "p1" && o.targetRef === "vt1")).toBe(false);
    // the video → merge connection is preserved
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "vt1" && o.targetRef === "merge1")).toBe(true);
  });

  it("storyboard → video 直连保留：分镜本身是生图工位，不插 image_gen（避免一镜两次生图、批量管线断链）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "sb1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "海边日落" } },
      { op: "connect", sourceRef: "sb1", targetRef: "vt1" },
    ];
    const out = enforceImageFirst(ops);
    expect(creates(out, "image_gen")).toHaveLength(0);
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "sb1" && o.targetRef === "vt1")).toBe(true);
    expect(out).toEqual(ops);
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
      { op: "create", nodeType: "script", tempId: "sb1", payload: {} },
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
      { op: "create", nodeType: "prompt", tempId: "sb1", payload: {} },
      { op: "create", nodeType: "prompt", tempId: "sb2", payload: {} },
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

  it("把视频的 negativePrompt 一并搬到中间 image_gen（审计修复）", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "森林晨雾", negativePrompt: "模糊, 畸变", aspectRatio: "16:9" } },
      { op: "connect", sourceRef: "p1", targetRef: "vt1" },
    ];
    const img = creates(enforceImageFirst(ops), "image_gen")[0];
    expect(img.payload).toMatchObject({ prompt: "森林晨雾", negativePrompt: "模糊, 畸变", aspectRatio: "16:9" });
  });

  it("sceneGroup 透传到中间 image_gen", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: {} },
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "x" }, sceneGroup: "s2" },
      { op: "connect", sourceRef: "p1", targetRef: "vt1" },
    ];
    expect(creates(enforceImageFirst(ops), "image_gen")[0].sceneGroup).toBe("s2");
  });

  it("源是画布已存在节点（非本批 tempId）→ 不强插 image_gen（可能本就是图片节点，强插会改画面+多烧钱）", () => {
    const ops: AgentOperation[] = [
      // existing_img 未在本批 create（= 画布已有图片节点 id），LLM 让它直接喂新视频作首帧
      { op: "create", nodeType: "video_task", tempId: "vt1", payload: { prompt: "让这张图动起来" } },
      { op: "connect", sourceRef: "existing_img", targetRef: "vt1" },
    ];
    const out = enforceImageFirst(ops);
    expect(creates(out, "image_gen")).toHaveLength(0); // 绝不插入
    // 原连线原样保留（existing_img → vt1，未被重定向）
    expect(has(out, (o) => o.op === "connect" && o.sourceRef === "existing_img" && o.targetRef === "vt1")).toBe(true);
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

  it("carries the video cw's aspectRatio + overrideRatioSize onto the spliced image cw", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: { positivePrompt: "猫" } },
      { op: "create", nodeType: "comfyui_workflow", tempId: "vcw1", payload: { templateId: 20, prompt: "猫", negPrompt: "模糊", aspectRatio: "9:16", overrideRatioSize: true } },
      { op: "connect", sourceRef: "p1", targetRef: "vcw1" },
    ];
    const img = cw(enforceImageFirstComfy(ops, IMG, VID, 10)).find((o) => (o.payload as { templateId?: number }).templateId === 10)!;
    const p = img.payload as Record<string, unknown>;
    expect(p.prompt).toBe("猫");
    expect(p.negPrompt).toBe("模糊");
    expect(p.aspectRatio).toBe("9:16");        // 比例带到首帧，避免变形
    expect(p.overrideRatioSize).toBe(true);    // 配套开关一并搬运
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

  it("源是画布已存在节点（非本批 tempId）→ 不强插出图工作流", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "comfyui_workflow", tempId: "vcw1", payload: { templateId: 20 } },
      { op: "connect", sourceRef: "existing_cw", targetRef: "vcw1" }, // 源是已存在节点
    ];
    const out = enforceImageFirstComfy(ops, IMG, VID, 10);
    expect(cw(out)).toHaveLength(1); // 未新增出图工作流
    expect(out.some((o) => o.op === "connect" && o.sourceRef === "existing_cw" && o.targetRef === "vcw1")).toBe(true);
  });
});
