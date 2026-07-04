import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeWorkflow } from "./_core/comfyui";

// Phase 1: the generic widget sweep should read authoritative input schema from
// /object_info — custom-node number widgets get real min/max/step, and enum
// fields become installed-model dropdowns instead of plain text.
describe("analyzeWorkflow — object_info authoritative param extraction", () => {
  afterEach(() => vi.unstubAllGlobals());

  const workflow = JSON.stringify({
    "1": { class_type: "MyCustomSampler", inputs: { my_steps: 12, my_model: "foo.safetensors", my_flag: true } },
    "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
  });

  const objectInfo = {
    MyCustomSampler: {
      input: {
        required: {
          my_steps: ["INT", { default: 20, min: 1, max: 100, step: 1 }],
          my_model: [["foo.safetensors", "bar.safetensors"]],
          my_flag: ["BOOLEAN", { default: false }],
        },
      },
    },
  };

  function stubFetch(info: unknown) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/object_info")) {
        return { ok: true, json: async () => info } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }));
  }

  it("upgrades custom-node widgets using the schema (number range + enum dropdown)", async () => {
    stubFetch(objectInfo);
    const a = await analyzeWorkflow(workflow, "http://localhost:8188");
    const byField = Object.fromEntries(a.detectedParams.map((p) => [p.fieldPath, p]));

    expect(byField["inputs.my_steps"]).toMatchObject({ type: "number", min: 1, max: 100, step: 1 });
    expect(byField["inputs.my_model"]).toMatchObject({ type: "select", options: ["foo.safetensors", "bar.safetensors"] });
    expect(byField["inputs.my_flag"]).toMatchObject({ type: "boolean" });
  });

  it("falls back to JS-typeof heuristics when no object_info is available", async () => {
    const a = await analyzeWorkflow(workflow); // no baseUrl → no schema
    const byField = Object.fromEntries(a.detectedParams.map((p) => [p.fieldPath, p]));
    // Without schema, the model field is just text (no installed-options list).
    expect(byField["inputs.my_model"]).toMatchObject({ type: "text" });
    expect(byField["inputs.my_model"].options).toBeUndefined();
    expect(byField["inputs.my_steps"]).toMatchObject({ type: "number" });
  });

  it("ignores absurd INT bounds (e.g. 64-bit seed max) so the input stays usable", async () => {
    stubFetch({
      MyCustomSampler: {
        input: { required: { my_steps: ["INT", { min: 0, max: 18446744073709551615 }] } },
      },
    });
    const wf = JSON.stringify({
      "1": { class_type: "MyCustomSampler", inputs: { my_steps: 5 } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    });
    const a = await analyzeWorkflow(wf, "http://localhost:8188");
    const p = a.detectedParams.find((x) => x.fieldPath === "inputs.my_steps")!;
    expect(p.type).toBe("number");
    expect(p.max).toBeUndefined(); // absurd bound dropped
    expect(p.min).toBe(0);
  });
});

describe("analyzeWorkflow — 视频输出节点识别", () => {
  it("新版核心 SaveVideo（CreateVideo→SaveVideo，Wan/InfiniteTalk 等）识别为视频输出", async () => {
    const wf = JSON.stringify({
      "1": { class_type: "WanVideoSampler", inputs: { steps: 4 } },
      "2": { class_type: "WanVideoDecode", inputs: { samples: ["1", 0] } },
      "3": { class_type: "CreateVideo", inputs: { fps: 25, images: ["2", 0] } },
      "4": { class_type: "SaveVideo", inputs: { filename_prefix: "video/ComfyUI", video: ["3", 0] } },
    });
    const a = await analyzeWorkflow(wf); // 无 baseUrl 也应识别输出类型
    expect(a.outputType).toBe("video");
    expect(a.outputNodeIds).toContain("4");
    expect(a.outputNodes.find((n) => n.id === "4")).toMatchObject({ classType: "SaveVideo", isVideo: true });
  });

  it("SaveWEBM 同样识别为视频输出", async () => {
    const wf = JSON.stringify({
      "1": { class_type: "KSampler", inputs: {} },
      "2": { class_type: "SaveWEBM", inputs: { images: ["1", 0] } },
    });
    const a = await analyzeWorkflow(wf);
    expect(a.outputType).toBe("video");
    expect(a.outputNodes.find((n) => n.id === "2")).toMatchObject({ classType: "SaveWEBM", isVideo: true });
  });
});

describe("analyzeWorkflow — 中央守卫（连线不当参数 / 幻影字段 / null 节点）", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (info: unknown) => vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("/object_info")
      ? ({ ok: true, json: async () => info } as unknown as Response)
      : ({ ok: false, json: async () => ({}) } as unknown as Response)));

  it("连线输入不暴露为可编辑参数（Qwen prompt 被上游节点接线 → 跳过，写回会断线）", async () => {
    const wf = JSON.stringify({
      "19": { class_type: "PrimitiveString", inputs: { value: "上游提示词" } },
      "20": { class_type: "TextEncodeQwenImageEditPlus", inputs: { prompt: ["19", 0] } },
      "9": { class_type: "SaveImage", inputs: { images: ["20", 0] } },
    });
    const a = await analyzeWorkflow(wf); // 无 baseUrl 也应生效（纯结构判断）
    expect(a.detectedParams.some((p) => p.nodeId === "20" && p.fieldPath === "inputs.prompt")).toBe(false);
  });

  it("KSamplerAdvanced 不再绑出幻影 seed/denoise，真字段 noise_seed 由通用扫描补上", async () => {
    stub({
      KSamplerAdvanced: { input: { required: { noise_seed: ["INT", { default: 0 }], steps: ["INT", { default: 20 }] } } },
    });
    const wf = JSON.stringify({
      "3": { class_type: "KSamplerAdvanced", inputs: { noise_seed: 7, steps: 25 } },
      "9": { class_type: "SaveImage", inputs: { images: ["3", 0] } },
    });
    const a = await analyzeWorkflow(wf, "http://localhost:8188");
    const fields = a.detectedParams.filter((p) => p.nodeId === "3").map((p) => p.fieldPath);
    expect(fields).not.toContain("inputs.seed");     // 幻影（节点无此字段、schema 也查无）
    expect(fields).not.toContain("inputs.denoise");  // 幻影
    expect(fields).toContain("inputs.noise_seed");   // 真字段由通用扫描补上
    // 「随机种子」只出现一次（此前幻影 seed 与真 noise_seed 同名并存）
    expect(a.detectedParams.filter((p) => p.nodeId === "3" && p.label.includes("随机种子"))).toHaveLength(1);
  });

  it("值为 null 的节点不再抛 TypeError（合法 JSON，需优雅跳过）", async () => {
    const wf = JSON.stringify({ "1": null, "9": { class_type: "SaveImage", inputs: { images: ["2", 0] } } });
    await expect(analyzeWorkflow(wf)).resolves.toBeTruthy();
  });
});
