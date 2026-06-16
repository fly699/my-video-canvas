import { describe, it, expect } from "vitest";
import { extractTemplateModelRefs, flattenModelList, qualifyingServers, requiredModelsFor, serverFailures } from "./_core/templateServerSync";

describe("templateServerSync", () => {
  it("extractTemplateModelRefs：图像/视频 payload 的模型字段", () => {
    const refs = extractTemplateModelRefs({ payload: {
      ckpt: "sdxl.safetensors", vae: "vae.pt", loraStrength: 1, steps: 20,
      loras: [{ lora: "a.safetensors", strength: 0.8 }, { lora: "b.safetensors" }],
      controlnet: { model: "cn.pth", strength: 1 },
      serverUrls: ["http://x:8188"],
    } });
    expect(new Set(refs)).toEqual(new Set(["sdxl.safetensors", "vae.pt", "a.safetensors", "b.safetensors", "cn.pth"]));
    expect(refs).not.toContain("http://x:8188"); // serverUrls 不是模型
    expect(refs.length).toBe(5);
  });

  it("extractTemplateModelRefs：workflowJson 里的模型 widget（忽略 sampler/scheduler）", () => {
    const wf = JSON.stringify({
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux.safetensors" } },
      "2": { class_type: "LoraLoader", inputs: { lora_name: "style.safetensors", strength_model: 1 } },
      "3": { class_type: "KSampler", inputs: { sampler_name: "euler", scheduler: "normal", seed: 1 } },
    });
    const refs = extractTemplateModelRefs({ payload: { workflowJson: wf } });
    expect(new Set(refs)).toEqual(new Set(["flux.safetensors", "style.safetensors"]));
    expect(refs).not.toContain("euler"); // sampler 不计入
    expect(refs).not.toContain("normal"); // scheduler 不计入
  });

  it("flattenModelList 展平各类别", () => {
    const flat = flattenModelList({ ckpts: ["a", "b"], loras: ["c"], samplers: ["euler"], vaes: [] });
    expect(new Set(flat)).toEqual(new Set(["a", "b", "c", "euler"]));
  });

  it("qualifyingServers：在线+含全部所需模型才入选；缺一个则排除", () => {
    const servers = [
      { url: "s1", models: new Set(["a.ckpt", "b.lora", "v.vae"]) },
      { url: "s2", models: new Set(["a.ckpt"]) }, // 缺 b.lora
      { url: "s3", models: new Set(["a.ckpt", "b.lora", "v.vae", "x"]) },
    ];
    const q = qualifyingServers(["a.ckpt", "b.lora"], servers);
    expect(new Set(q)).toEqual(new Set(["s1", "s3"])); // s2 缺 b.lora 被排除
  });

  it("qualifyingServers：引用了无人拥有的模型 → 不阻塞（视作非约束）", () => {
    const servers = [{ url: "s1", models: new Set(["a.ckpt"]) }];
    expect(qualifyingServers(["a.ckpt", "ghost.ckpt"], servers)).toEqual(["s1"]); // ghost 无人有→不算 required
  });

  it("qualifyingServers：无模型约束 → 所有在线服务器入选", () => {
    const servers = [{ url: "s1", models: new Set(["a"]) }, { url: "s2", models: new Set(["b"]) }];
    expect(new Set(qualifyingServers([], servers))).toEqual(new Set(["s1", "s2"]));
  });

  it("requiredModelsFor：只保留至少某台在线服务器确有的模型", () => {
    const online = [{ models: new Set(["a.ckpt", "b.lora"]) }];
    expect(new Set(requiredModelsFor(["a.ckpt", "b.lora", "ghost.ckpt"], online))).toEqual(new Set(["a.ckpt", "b.lora"]));
  });

  it("serverFailures：离线→offline、在线缺模型→missing_models、在线全模型→不失效", () => {
    const scan = new Map<string, { online: boolean; models: Set<string> }>([
      ["s1", { online: true, models: new Set(["a.ckpt", "b.lora"]) }], // 全有
      ["s2", { online: true, models: new Set(["a.ckpt"]) }],            // 缺 b.lora
      ["s3", { online: false, models: new Set() }],                     // 离线
    ]);
    const required = ["a.ckpt", "b.lora"];
    const fails = serverFailures(["s1", "s2", "s3", "sUnknown"], required, scan);
    expect(fails).toEqual([
      { url: "s2", reason: "missing_models" },
      { url: "s3", reason: "offline" },
      { url: "sUnknown", reason: "offline" }, // 扫描里没有 → 当作离线/失效
    ]);
    expect(fails.find((f) => f.url === "s1")).toBeUndefined(); // s1 全有 → 不失效
  });
});
