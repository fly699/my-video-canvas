import { describe, it, expect } from "vitest";
import { applyAspectToWorkflow, parseAspectRatioFromText } from "./comfyWorkflowParams";

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

  it("img2video 缩放节点（ImageResizeKJv2 480×832，无空 latent）也按比例覆盖", () => {
    // Wan2.1/InfiniteTalk 类工作流：分辨率来自 ImageResizeKJv2，不存在 Empty*Latent。
    const json = JSON.stringify({
      "340": { class_type: "ImageResizeKJv2", inputs: { width: 480, height: 832, keep_proportion: "crop", divisible_by: 16, image: ["284", 0] } },
      "333": { class_type: "WanVideoSampler", inputs: { steps: 4 } },
    });
    const r = applyAspectToWorkflow(json, "16:9");
    expect(r.patched).toBe(1);
    const n = JSON.parse(r.json)["340"].inputs as { width: number; height: number };
    expect(n.width / n.height).toBeGreaterThan(1.6); // 竖屏 → 横屏 16:9 邻域
    expect(n.width).toBeGreaterThan(n.height);
    expect(n.width % 64).toBe(0);
    expect(n.height % 64).toBe(0);
  });

  it("裁剪类节点（带 width/height 但非分辨率定义）不被误改", () => {
    // ImageCrop 的 width/height 是裁剪区域，不应被比例覆盖动到。
    const json = JSON.stringify({ "9": { class_type: "ImageCrop", inputs: { width: 256, height: 256, x: 0, y: 0 } } });
    expect(applyAspectToWorkflow(json, "16:9").patched).toBe(0);
  });
});

describe("parseAspectRatioFromText", () => {
  it("从提示词里识别常见画面比例（半角 / 全角冒号 / 含空格）", () => {
    expect(parseAspectRatioFromText("cinematic shot, 16:9")).toBe("16:9");
    expect(parseAspectRatioFromText("竖屏 9：16 人物")).toBe("9:16");
    expect(parseAspectRatioFromText("ratio 4 : 3")).toBe("4:3");
    expect(parseAspectRatioFromText("画面比例 21:9 宽银幕")).toBe("21:9");
  });

  it("命中多个时取最后一个", () => {
    expect(parseAspectRatioFromText("先 1:1 再改成 16:9")).toBe("16:9");
  });

  it("非比例 token 不误判（时间 / 比分 / 分辨率 / 空）", () => {
    expect(parseAspectRatioFromText("拍摄于 2:30 下午")).toBeUndefined(); // 2:30 不在白名单
    expect(parseAspectRatioFromText("分辨率 1024:768")).toBeUndefined();   // 4 位数不匹配
    expect(parseAspectRatioFromText("没有比例")).toBeUndefined();
    expect(parseAspectRatioFromText(undefined)).toBeUndefined();
    expect(parseAspectRatioFromText("")).toBeUndefined();
  });
});
