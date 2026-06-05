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
