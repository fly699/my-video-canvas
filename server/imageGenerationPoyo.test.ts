import { describe, it, expect } from "vitest";
import { buildPoyoImageInput, POYO_IMAGE_SPECS } from "./_core/imageGeneration";

// 用绝对 http URL，使 resolveToAbsoluteUrl 原样返回（no-op），便于断言字段映射。
const A = "https://cdn.example.com/a.png";
const B = "https://cdn.example.com/b.png";
const C = "https://cdn.example.com/c.png";
const refs = (...urls: string[]) => ({ prompt: "p", originalImages: urls.map((url) => ({ url })) });

describe("buildPoyoImageInput — 统一模型图生图（多模态能力恢复，docs/poyo-image-api.md §八/速查表）", () => {
  it("z-image：1 张参考图 → image_urls=[A]，wire 不变（同 wire 自动编辑）", async () => {
    const { model, input } = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_z_image, refs(A));
    expect(model).toBe("z-image");
    expect(input.image_urls).toEqual([A]);
    expect("reference_image_url" in input).toBe(false); // 统一模型只发 image_urls
  });

  it("z-image / grok：参考图截断到恰 1 张", async () => {
    expect((await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_z_image, refs(A, B))).input.image_urls).toEqual([A]);
    expect((await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_grok_image, refs(A, B))).input.image_urls).toEqual([A]);
  });

  it("wan-2.7-image：参考图截断到 4 张", async () => {
    const { model, input } = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_wan_image, refs(A, B, C, A, B));
    expect(model).toBe("wan-2.7-image");
    expect(input.image_urls).toEqual([A, B, C, A]);
  });

  it("无参考图：统一模型走文生图，不带 image_urls", async () => {
    const { input } = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_z_image, { prompt: "p" });
    expect("image_urls" in input).toBe(false);
  });

  it("编辑变体模型(nano-banana)：有参考图 → 切到 -edit wire + image_urls + 旧单数字段", async () => {
    const { model, input } = await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_nano_banana, refs(A, B));
    expect(model).toBe("nano-banana-edit");
    expect(input.image_urls).toEqual([A, B]);
    expect(input.reference_image_url).toBe(A);
  });

  it("新增 nano-banana-2-new 家族：wire 正确，有参考图切 -edit", async () => {
    expect((await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_nano_banana_2_new, { prompt: "p" })).model).toBe("nano-banana-2-new");
    expect((await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_nano_banana_2_new, refs(A))).model).toBe("nano-banana-2-new-edit");
    expect((await buildPoyoImageInput(POYO_IMAGE_SPECS.poyo_nano_banana_2_official, refs(A))).model).toBe("nano-banana-2-official-edit");
  });
});
