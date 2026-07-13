import { describe, it, expect, beforeEach } from "vitest";
import { aspectToWH, buildLocalComfyImageInput } from "./comfyLocalImageGen";

// localStorage 桩：node/vitest 环境下 comfyLocalRoute 读的 localStorage 可能缺失，显式挂一个。
const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: () => null,
    length: 0,
  } as Storage;
});

describe("aspectToWH", () => {
  it("方图 1:1 → 512×512", () => expect(aspectToWH("1:1")).toEqual({ width: 512, height: 512 }));
  it("横 16:9 → 高固定 512、宽按比例取 64 倍数", () => {
    const r = aspectToWH("16:9");
    expect(r.height).toBe(512);
    expect(r.width).toBe(Math.round(512 * 16 / 9 / 64) * 64); // 896
    expect(r.width! % 64).toBe(0);
  });
  it("竖 9:16 → 宽固定 512、高按比例", () => {
    const r = aspectToWH("9:16");
    expect(r.width).toBe(512);
    expect(r.height! % 64).toBe(0);
  });
  it("非法/空 → 空对象（下游走 ComfyUI 默认尺寸）", () => {
    expect(aspectToWH(undefined)).toEqual({});
    expect(aspectToWH("banana")).toEqual({});
    expect(aspectToWH("0:5")).toEqual({});
  });
});

describe("buildLocalComfyImageInput", () => {
  it("缺 checkpoint → blocked", () => {
    const r = buildLocalComfyImageInput({ prompt: "a cat", projectId: 1, nodeId: "n1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocked).toContain("checkpoint");
  });

  it("缺提示词 → blocked", () => {
    store["canvas.comfyEditCkpt"] = "sd_xl.safetensors";
    const r = buildLocalComfyImageInput({ prompt: "   ", projectId: 1, nodeId: "n1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocked).toContain("提示词");
  });

  it("无参考 → txt2img；style 前缀 + 比例映射 + 地址透传", () => {
    store["canvas.comfyEditCkpt"] = "sd_xl.safetensors";
    store["canvas.comfyLocalBase"] = "http://172.16.0.8:8188";
    const r = buildLocalComfyImageInput({ prompt: "a cat", style: "watercolor", aspect: "1:1", batch: 2, projectId: 7, nodeId: "n2" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.workflowTemplate).toBe("txt2img");
      expect(r.input.prompt).toBe("Style: watercolor. a cat");
      expect(r.input.ckpt).toBe("sd_xl.safetensors");
      expect(r.input.customBaseUrl).toBe("http://172.16.0.8:8188");
      expect(r.input).toMatchObject({ width: 512, height: 512, batchSize: 2 });
      expect(r.input.referenceImageUrl).toBeUndefined();
    }
  });

  it("有参考 → img2img，携带 referenceImageUrl；地址留空则不带 customBaseUrl", () => {
    store["canvas.comfyEditCkpt"] = "sd_xl.safetensors";
    const r = buildLocalComfyImageInput({ prompt: "a dog", refUrl: "https://x/ref.png", negativePrompt: "blurry", projectId: 1, nodeId: "n3" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.workflowTemplate).toBe("img2img");
      expect(r.input.referenceImageUrl).toBe("https://x/ref.png");
      expect(r.input.negPrompt).toBe("blurry");
      expect(r.input.customBaseUrl).toBeUndefined();
    }
  });

  it("batch 夹取到 1–8", () => {
    store["canvas.comfyEditCkpt"] = "c.safetensors";
    const hi = buildLocalComfyImageInput({ prompt: "x", batch: 99, projectId: 1, nodeId: "n" });
    const lo = buildLocalComfyImageInput({ prompt: "x", batch: 0, projectId: 1, nodeId: "n" });
    if (hi.ok) expect(hi.input.batchSize).toBe(8);
    if (lo.ok) expect(lo.input.batchSize).toBe(1);
  });
});
