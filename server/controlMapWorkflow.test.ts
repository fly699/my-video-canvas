import { describe, it, expect } from "vitest";
import { buildControlMapWorkflow, CONTROL_MAP_PREPROCESSORS } from "./_core/controlMapWorkflow";

describe("buildControlMapWorkflow", () => {
  it("builds LoadImage → AIO_Preprocessor → SaveImage with the chosen preprocessor", () => {
    const wf = buildControlMapWorkflow("DWPreprocessor");
    expect(wf["1"].class_type).toBe("LoadImage");
    expect(wf["2"].class_type).toBe("AIO_Preprocessor");
    expect(wf["2"].inputs.preprocessor).toBe("DWPreprocessor");
    expect(wf["2"].inputs.image).toEqual(["1", 0]);
    expect(wf["2"].inputs.resolution).toBe(512);
    expect(wf["3"].class_type).toBe("SaveImage");
    expect(wf["3"].inputs.images).toEqual(["2", 0]);
  });

  it("sanitizes the filename prefix", () => {
    const wf = buildControlMapWorkflow("CannyEdgePreprocessor", "../../etc/passwd shot 1");
    expect(String(wf["3"].inputs.filename_prefix)).not.toContain("/");
    expect(String(wf["3"].inputs.filename_prefix)).not.toContain("..");
  });

  it("allowlist covers canny / depth / pose", () => {
    expect(CONTROL_MAP_PREPROCESSORS).toContain("CannyEdgePreprocessor");
    expect(CONTROL_MAP_PREPROCESSORS).toContain("DepthAnythingV2Preprocessor");
    expect(CONTROL_MAP_PREPROCESSORS).toContain("DWPreprocessor");
  });
});
