import { describe, it, expect } from "vitest";
import { applyAspectToWorkflow } from "./comfyWorkflowParams";

const wf = (w: number, h: number, ct = "EmptyLatentImage") =>
  JSON.stringify({ "5": { class_type: ct, inputs: { width: w, height: h, batch_size: 1 } }, "3": { class_type: "KSampler", inputs: { seed: 1 } } });

const latent = (json: string) => (JSON.parse(json)["5"].inputs as { width: number; height: number });

describe("applyAspectToWorkflow", () => {
  it("改 16:9 时保留原像素面积、只改比例并 /64 对齐", () => {
    const { json, patched } = applyAspectToWorkflow(wf(1024, 1024), "16:9");
    expect(patched).toBe(1);
    const { width, height } = latent(json);
    expect(width).toBe(1344);   // round64(sqrt(1024²*16/9)) = round64(1365)=1344
    expect(height).toBe(768);   // round64(sqrt(1024²*9/16)) = round64(768)=768
    expect(width % 64).toBe(0);
    expect(height % 64).toBe(0);
    expect(width / height).toBeCloseTo(16 / 9, 1); // 比例正确
  });

  it("竖屏 9:16：宽高互换量级", () => {
    const { width, height } = latent(applyAspectToWorkflow(wf(1024, 1024), "9:16").json);
    expect(width).toBe(768);
    expect(height).toBe(1344);
  });

  it("视频 latent（已接近 16:9）面积守恒、改动很小", () => {
    const { json, patched } = applyAspectToWorkflow(wf(832, 480, "EmptyWanLatentVideo"), "16:9");
    expect(patched).toBe(1);
    const { width, height } = latent(json);
    expect(width * height).toBeGreaterThan(832 * 480 * 0.85); // 面积大体守恒
    // /64 对齐在小尺寸上有几个百分点比例误差，大体落在 16:9 邻域即可
    expect(width / height).toBeGreaterThan(1.6);
    expect(width / height).toBeLessThan(2.0);
  });

  it("非法/缺省比例 或 无 latent 时原样返回（patched=0）", () => {
    expect(applyAspectToWorkflow(wf(1024, 1024), "abc").patched).toBe(0);
    expect(applyAspectToWorkflow(wf(1024, 1024), undefined).patched).toBe(0);
    expect(applyAspectToWorkflow('{"3":{"class_type":"KSampler","inputs":{}}}', "16:9").patched).toBe(0);
    expect(applyAspectToWorkflow("not json", "16:9")).toEqual({ json: "not json", patched: 0 });
  });

  it("1:1 比例对方形 latent 基本不变", () => {
    const { width, height } = latent(applyAspectToWorkflow(wf(1024, 1024), "1:1").json);
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });
});
