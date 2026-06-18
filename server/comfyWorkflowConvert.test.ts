import { describe, it, expect } from "vitest";
import { convertUiWorkflowToApiPrompt } from "./_core/comfyWorkflowConvert";

// Minimal object_info covering the nodes used below, with realistic input order.
const objectInfo = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["model.safetensors"]] } } },
  CLIPTextEncode: { input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } } },
  EmptyLatentImage: { input: { required: { width: ["INT", { default: 512 }], height: ["INT", { default: 512 }], batch_size: ["INT", { default: 1 }] } } },
  KSampler: { input: { required: {
    model: ["MODEL"], seed: ["INT", { default: 0 }], steps: ["INT", { default: 20 }], cfg: ["FLOAT", { default: 8 }],
    sampler_name: [["euler", "dpmpp_2m"]], scheduler: [["normal", "karras"]],
    positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"], denoise: ["FLOAT", { default: 1 }],
  } } },
  VAEDecode: { input: { required: { samples: ["LATENT"], vae: ["VAE"] } } },
  SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } } },
};

// [linkId, srcNode, srcSlot, dstNode, dstSlot, type]
const ui = {
  nodes: [
    { id: 4, type: "CheckpointLoaderSimple", widgets_values: ["model.safetensors"] },
    { id: 6, type: "CLIPTextEncode", inputs: [{ name: "clip", link: 1 }], widgets_values: ["a cat"] },
    { id: 7, type: "CLIPTextEncode", inputs: [{ name: "clip", link: 2 }], widgets_values: ["bad"] },
    { id: 5, type: "EmptyLatentImage", widgets_values: [512, 512, 1] },
    { id: 3, type: "KSampler",
      inputs: [{ name: "model", link: 3 }, { name: "positive", link: 4 }, { name: "negative", link: 5 }, { name: "latent_image", link: 6 }],
      // seed has a control_after_generate companion value ("randomize") after it
      widgets_values: [42, "randomize", 20, 8, "euler", "normal", 1] },
    { id: 8, type: "VAEDecode", inputs: [{ name: "samples", link: 7 }, { name: "vae", link: 8 }] },
    { id: 9, type: "SaveImage", inputs: [{ name: "images", link: 9 }], widgets_values: ["ComfyUI"] },
  ],
  links: [
    [1, 4, 1, 6, 0, "CLIP"], [2, 4, 1, 7, 0, "CLIP"], [3, 4, 0, 3, 0, "MODEL"],
    [4, 6, 0, 3, 1, "CONDITIONING"], [5, 7, 0, 3, 2, "CONDITIONING"], [6, 5, 0, 3, 3, "LATENT"],
    [7, 3, 0, 8, 0, "LATENT"], [8, 4, 2, 8, 1, "VAE"], [9, 8, 0, 9, 0, "IMAGE"],
  ],
};

describe("convertUiWorkflowToApiPrompt", () => {
  it("converts a standard txt2img UI graph to API format (widgets + links + seed control)", () => {
    const { prompt, error } = convertUiWorkflowToApiPrompt(ui, objectInfo);
    expect(error).toBeUndefined();
    expect(prompt).toBeTruthy();
    const p = prompt!;
    expect(p["4"].inputs.ckpt_name).toBe("model.safetensors");
    expect(p["6"].inputs.text).toBe("a cat");
    expect(p["6"].inputs.clip).toEqual(["4", 1]);
    expect(p["5"].inputs).toEqual({ width: 512, height: 512, batch_size: 1 });
    // KSampler: seed value 42, the "randomize" companion skipped, widgets aligned.
    const k = p["3"].inputs;
    expect(k.seed).toBe(42);
    expect(k.steps).toBe(20);
    expect(k.cfg).toBe(8);
    expect(k.sampler_name).toBe("euler");
    expect(k.scheduler).toBe("normal");
    expect(k.denoise).toBe(1);
    expect(k.model).toEqual(["4", 0]);
    expect(k.positive).toEqual(["6", 0]);
    expect(k.negative).toEqual(["7", 0]);
    expect(k.latent_image).toEqual(["5", 0]);
    expect(p["9"].inputs.images).toEqual(["8", 0]);
    expect(p["9"].inputs.filename_prefix).toBe("ComfyUI");
  });

  it("reports missing node definitions with an actionable message", () => {
    const bad = { nodes: [{ id: 1, type: "SomeCustomNodeNotInstalled", widgets_values: [] }], links: [] };
    const { prompt, error } = convertUiWorkflowToApiPrompt(bad, objectInfo);
    expect(prompt).toBeUndefined();
    expect(error).toMatch(/节点定义/);
    expect(error).toMatch(/Save \(API Format\)/);
  });

  it("resolves a PrimitiveNode-fed input to its literal widget value", () => {
    const g = {
      nodes: [
        { id: 1, type: "PrimitiveNode", widgets_values: [768] },
        { id: 2, type: "EmptyLatentImage", inputs: [{ name: "width", link: 1 }], widgets_values: [512, 1] },
      ],
      links: [[1, 1, 0, 2, 0, "INT"]],
    };
    const { prompt, error } = convertUiWorkflowToApiPrompt(g, objectInfo);
    expect(error).toBeUndefined();
    expect(prompt!["2"].inputs.width).toBe(768);  // literal from the Primitive
    expect(prompt!["2"].inputs.height).toBe(512); // remaining widgets shift correctly
    expect(prompt!["2"].inputs.batch_size).toBe(1);
    expect(prompt!["1"]).toBeUndefined();          // the Primitive itself is not emitted
  });

  it("skips muted/bypassed LEAF nodes (no downstream depends on them)", () => {
    const withMuted = { ...ui, nodes: [...ui.nodes, { id: 99, type: "SaveImage", mode: 4, inputs: [], widgets_values: ["x"] }] };
    const { prompt } = convertUiWorkflowToApiPrompt(withMuted, objectInfo);
    expect(prompt!["99"]).toBeUndefined();
  });

  it("rejects (clear error) when an active node depends on a BYPASSED upstream node — no dangling ref", () => {
    // Bypass the checkpoint loader (id 4); KSampler.model/CLIP/VAE all dangle off it.
    const bypassedCkpt = {
      ...ui,
      nodes: ui.nodes.map((n) => (n.id === 4 ? { ...n, mode: 4 } : n)),
    };
    const { prompt, error } = convertUiWorkflowToApiPrompt(bypassedCkpt, objectInfo);
    expect(prompt).toBeUndefined();
    expect(error).toBeTruthy();
    expect(error).toContain("未输出的上游节点"); // names the dangling edges instead of emitting a broken graph
    expect(error).toContain("KSampler.model→#4");
    expect(error).toMatch(/bypass|静音/);
  });

  it("returns an error for empty / non-UI input", () => {
    expect(convertUiWorkflowToApiPrompt({}, objectInfo).error).toBeTruthy();
  });
});
