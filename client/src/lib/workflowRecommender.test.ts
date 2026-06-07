import { describe, it, expect } from "vitest";
import { recommendWorkflows, workflowSearchLinks } from "./workflowRecommender";

const fam = (recs: ReturnType<typeof recommendWorkflows>) => recs.map((r) => r.family);

describe("recommendWorkflows", () => {
  it("classifies an SDXL checkpoint and recommends the built-in image templates", () => {
    const recs = recommendWorkflows({ ckpts: ["juggernautXL_v9.safetensors"] });
    expect(fam(recs)).toContain("sdxl");
    const sdxl = recs.find((r) => r.family === "sdxl")!;
    expect(sdxl.builtins.map((b) => b.workflowTemplate)).toEqual(["txt2img", "img2img"]);
    expect(sdxl.builtins[0].nodeType).toBe("comfyui_image");
    expect(sdxl.matched).toContain("juggernautXL_v9.safetensors");
  });

  it("detects Flux and prefers it over the SDXL/SD15 fallback", () => {
    const recs = recommendWorkflows({ unets: ["flux1-dev.safetensors"], ckpts: [] });
    expect(fam(recs)).toContain("flux");
    expect(fam(recs)).not.toContain("sd15");
  });

  it("falls back to SD1.5 for a plain checkpoint", () => {
    const recs = recommendWorkflows({ ckpts: ["realisticVision_v6.safetensors"] });
    expect(fam(recs)).toContain("sd15");
  });

  it("recommends Wan video templates from a Wan unet", () => {
    const recs = recommendWorkflows({ unets: ["wan2.1_i2v_480p.safetensors"] });
    const wan = recs.find((r) => r.family === "wan")!;
    expect(wan.builtins.map((b) => b.workflowTemplate).sort()).toEqual(["wan_i2v", "wan_t2v"]);
    expect(wan.builtins[0].nodeType).toBe("comfyui_video");
  });

  it("recommends AnimateDiff when motion modules are present (no base ckpt needed)", () => {
    const recs = recommendWorkflows({ motionModules: ["mm_sd_v15_v2.ckpt"] });
    expect(fam(recs)).toContain("animatediff");
  });

  it("adds ControlNet / IPAdapter / upscale as capability add-ons", () => {
    const recs = recommendWorkflows({
      ckpts: ["sd_xl_base_1.0.safetensors"],
      controlnets: ["control_v11p_sd15_openpose.pth"],
      ipadapters: ["ip-adapter_sdxl.safetensors"],
      upscaleModels: ["4x-UltraSharp.pth"],
    });
    expect(fam(recs)).toEqual(expect.arrayContaining(["sdxl", "controlnet", "ipadapter", "upscale"]));
  });

  it("recommends from LoRAs: speed LoRAs and general LoRA stacking", () => {
    const recs = recommendWorkflows({ ckpts: ["dreamshaper_8.safetensors"], loras: ["lcm_lora_sd15.safetensors", "myCharacter.safetensors"] });
    expect(fam(recs)).toContain("loraSpeed");
    expect(fam(recs)).toContain("lora");
    const lora = recs.find((r) => r.family === "lora")!;
    expect(lora.label).toContain("2");
  });

  it("does not add LoRA recs when the server has no LoRAs", () => {
    const recs = recommendWorkflows({ ckpts: ["sd_xl_base_1.0.safetensors"] });
    expect(fam(recs)).not.toContain("lora");
    expect(fam(recs)).not.toContain("loraSpeed");
  });

  it("returns nothing for an empty server", () => {
    expect(recommendWorkflows({})).toEqual([]);
  });

  it("builds browser search links across many workflow/model sites", () => {
    const links = workflowSearchLinks("Flux");
    expect(links.map((l) => l.label)).toEqual(["ComfyWorkflows", "OpenArt", "Civitai", "HuggingFace", "GitHub", "Reddit", "Google"]);
    expect(links[0].url).toContain("comfyworkflows.com/search?q=Flux");
    expect(links.find((l) => l.label === "GitHub")!.url).toContain("github.com/search?q=");
    // every URL is a valid absolute https URL
    for (const l of links) expect(() => new URL(l.url)).not.toThrow();
    expect(new URL(l0(links)).protocol).toBe("https:");
  });
});

function l0(links: { url: string }[]): string { return links[0].url; }
