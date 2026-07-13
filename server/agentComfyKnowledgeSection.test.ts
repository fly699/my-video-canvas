// 知识记忆体接入画布助手：把工程智能体学过的 ComfyUI 服务器真实资源（checkpoint/LoRA/
// 节点类）拼成一段规划上下文注入，让一次性规划的画布助手按真实存在的资源规划、禁止编造。
import { describe, it, expect } from "vitest";
import { buildComfyResourceSection } from "./routers/agent";
import type { ComfyKnowledge } from "./_core/comfyKnowledge";

function mk(partial: Partial<ComfyKnowledge["resources"]>, fetchedAt = Date.now()): ComfyKnowledge {
  return {
    baseUrl: "http://comfy:8188",
    objectInfo: null,
    resources: {
      checkpoints: [], loras: [], vaes: [], samplers: [], schedulers: [], nodeClasses: [],
      ...partial,
    },
    fetchedAt,
  };
}

describe("buildComfyResourceSection", () => {
  it("列出真实资源并强调只能从中选、禁止编造", () => {
    const s = buildComfyResourceSection(mk({
      checkpoints: ["sd_xl_base_1.0.safetensors", "dreamshaper_8.safetensors"],
      loras: ["add_detail.safetensors"],
      nodeClasses: ["KSampler", "CheckpointLoaderSimple", "VAEDecode"],
    }));
    expect(s).toContain("ComfyUI 服务器已装资源");
    expect(s).toContain("知识记忆体");
    expect(s).toContain("sd_xl_base_1.0.safetensors");
    expect(s).toContain("dreamshaper_8.safetensors");
    expect(s).toContain("add_detail.safetensors");
    expect(s).toContain("KSampler");
    // 明确约束：只能从真实项里选、禁止编造
    expect(s).toContain("只能从下面真实存在的项里选");
    expect(s).toContain("禁止编造");
    // 提示复位入口
    expect(s).toContain("复位全部记忆");
  });

  it("超过截断上限时标注总数、不逐一列全", () => {
    const many = Array.from({ length: 100 }, (_, i) => `ckpt_${i}.safetensors`);
    const s = buildComfyResourceSection(mk({ checkpoints: many }));
    expect(s).toContain("共 100 项");
    expect(s).toContain("checkpoints（大模型，共 100）");
    // 截断后不应出现第 90 个（超出 40 上限）
    expect(s).not.toContain("ckpt_90.safetensors");
    expect(s).toContain("ckpt_0.safetensors");
  });

  it("空类目省略，不塞无意义的行", () => {
    const s = buildComfyResourceSection(mk({ checkpoints: ["a.safetensors"] }));
    // 没有 VAE/采样器/调度器时不渲染这些行
    expect(s).not.toContain("VAE（");
    expect(s).not.toContain("采样器：");
    expect(s).not.toContain("调度器：");
    // checkpoints / LoRA 两行始终在（LoRA 为空显示「（无）」）
    expect(s).toContain("LoRA（共 0）：（无）");
  });

  it("按记忆时间给出「多久前学习」提示", () => {
    const s = buildComfyResourceSection(mk({ checkpoints: ["a.safetensors"] }, Date.now() - 25 * 60000));
    expect(s).toContain("分钟前学习");
  });
});
