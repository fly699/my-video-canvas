import { describe, expect, it } from "vitest";
import { comfyErrorHint } from "./_core/comfyui";

describe("comfyErrorHint", () => {
  it("explains the Qwen (3584) text-encoder dimension mismatch", () => {
    const raw = 'Given normalized_shape=[3584], expected input with shape [*, 3584], but got input of size[1, 71, 2560]';
    const h = comfyErrorHint(raw);
    expect(h).toContain("文本编码器与模型不匹配");
    expect(h).toContain("3584");
    expect(h).toContain("2560");
    expect(h).toContain("qwen_image");
  });

  it("flags a checkpoint without embedded CLIP", () => {
    expect(comfyErrorHint("ERROR: clip input is invalid: None")).toContain("不含 CLIP");
  });

  it("returns empty for unrelated errors", () => {
    expect(comfyErrorHint("CUDA out of memory")).toBe("");
  });
});
