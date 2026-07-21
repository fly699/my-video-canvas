// #313 角色/场景节点滞留运行态清洗（加载时）——用户实报「图已生成却显示生成中/失败」。
import { describe, it, expect } from "vitest";
import { sanitizeCharacterRuntimeOnLoad } from "./nodeRuntimeSanitize";

const IMG = "https://cdn.example.com/portrait.png";

describe("#313 sanitizeCharacterRuntimeOnLoad", () => {
  it("processing 一律清（死流程遗留），有图无图都清，errorMessage 一并清", () => {
    expect(sanitizeCharacterRuntimeOnLoad("character", { status: "processing", referenceImageUrl: IMG })).toMatchObject({ status: undefined, errorMessage: undefined, referenceImageUrl: IMG });
    expect(sanitizeCharacterRuntimeOnLoad("character", { status: "processing" })).toMatchObject({ status: undefined });
  });

  it("failed + 已有图 → 清状态与横幅（迟到失败糊图的遗留）", () => {
    const out = sanitizeCharacterRuntimeOnLoad("character", { status: "failed", errorMessage: "自动生成失败：[CHARGED?] Poyo 图像生成超时", referenceImageUrl: IMG });
    expect(out.status).toBeUndefined();
    expect(out.errorMessage).toBeUndefined();
    expect(out.referenceImageUrl).toBe(IMG);
  });

  it("failed + 无图 → 原样保留（真实失败，供 #304 失败诊断）", () => {
    const p = { status: "failed", errorMessage: "自动生成失败：额度不足" };
    expect(sanitizeCharacterRuntimeOnLoad("character", p)).toBe(p); // 引用不变
  });

  it("非 character 类型 / 无运行态 → 原对象原样返回（引用不变，不扰动加载基线）", () => {
    const img = { status: "processing", imageUrl: IMG };
    expect(sanitizeCharacterRuntimeOnLoad("image_gen", img)).toBe(img); // 其他类型有自己的恢复机制
    const clean = { referenceImageUrl: IMG };
    expect(sanitizeCharacterRuntimeOnLoad("character", clean)).toBe(clean);
    const success = { status: "success", referenceImageUrl: IMG };
    expect(sanitizeCharacterRuntimeOnLoad("character", success)).toBe(success);
  });
});
