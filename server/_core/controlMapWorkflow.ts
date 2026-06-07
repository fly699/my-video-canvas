// Pure builder for the "shot continuity" control-map extraction workflow. Kept in
// its own module (no heavy imports) so it's trivially unit-testable.
//
// Turns a shot's output image into a ControlNet guide (depth/pose/canny…) via a
// minimal LoadImage → AIO_Preprocessor → SaveImage graph. AIO_Preprocessor (from
// comfyui_controlnet_aux) handles every preprocessor by name with a single node,
// so we don't have to special-case each one's inputs.

export const CONTROL_MAP_PREPROCESSORS = [
  "CannyEdgePreprocessor",
  "DepthAnythingV2Preprocessor",
  "MiDaS-DepthMapPreprocessor",
  "DWPreprocessor",
  "OpenposePreprocessor",
  "LineArtPreprocessor",
  "ScribblePreprocessor",
  "HEDPreprocessor",
] as const;
export type ControlMapPreprocessor = (typeof CONTROL_MAP_PREPROCESSORS)[number];

type WfNode = { class_type: string; inputs: Record<string, unknown> };

/** Strip filesystem-illegal chars from a SaveImage filename prefix. */
function safePrefix(p: string): string {
  const s = (p || "").replace(/[^\w.\-]+/g, "_").replace(/^[._-]+/, "").slice(0, 64);
  return s || "control_map";
}

/** Pure: LoadImage → AIO_Preprocessor(<preprocessor>) → SaveImage. The source image
 *  is uploaded into node "1.inputs.image" by the caller (executeCustomWorkflow). */
export function buildControlMapWorkflow(preprocessor: string, filenamePrefix = "control_map"): Record<string, WfNode> {
  return {
    "1": { class_type: "LoadImage", inputs: { image: "input.png" } },
    "2": { class_type: "AIO_Preprocessor", inputs: { image: ["1", 0], preprocessor, resolution: 512 } },
    "3": { class_type: "SaveImage", inputs: { filename_prefix: safePrefix(filenamePrefix), images: ["2", 0] } },
  };
}
