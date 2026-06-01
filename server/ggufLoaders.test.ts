import { describe, expect, it } from "vitest";
import { normalizeGgufLoaders } from "./_core/comfyui";

describe("normalizeGgufLoaders", () => {
  it("swaps CLIPLoader → CLIPLoaderGGUF for a .gguf clip", () => {
    const wf: any = { "2": { class_type: "CLIPLoader", inputs: { clip_name: "umt5-xxl-encoder-Q3_K_M.gguf", type: "wan" } } };
    normalizeGgufLoaders(wf);
    expect(wf["2"].class_type).toBe("CLIPLoaderGGUF");
    expect(wf["2"].inputs.type).toBe("wan");
  });
  it("swaps UNETLoader → UnetLoaderGGUF and drops weight_dtype for a .gguf unet", () => {
    const wf: any = { "1": { class_type: "UNETLoader", inputs: { unet_name: "wan2.1-Q4.gguf", weight_dtype: "default" } } };
    normalizeGgufLoaders(wf);
    expect(wf["1"].class_type).toBe("UnetLoaderGGUF");
    expect(wf["1"].inputs).not.toHaveProperty("weight_dtype");
  });
  it("handles DualCLIPLoader when either clip is gguf", () => {
    const wf: any = { "21": { class_type: "DualCLIPLoader", inputs: { clip_name1: "clip_l.safetensors", clip_name2: "t5xxl-Q4.gguf", type: "flux" } } };
    normalizeGgufLoaders(wf);
    expect(wf["21"].class_type).toBe("DualCLIPLoaderGGUF");
  });
  it("leaves safetensors loaders untouched", () => {
    const wf: any = { "2": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } }, "1": { class_type: "UNETLoader", inputs: { unet_name: "x.safetensors", weight_dtype: "default" } } };
    normalizeGgufLoaders(wf);
    expect(wf["2"].class_type).toBe("CLIPLoader");
    expect(wf["1"].class_type).toBe("UNETLoader");
    expect(wf["1"].inputs.weight_dtype).toBe("default");
  });
});
