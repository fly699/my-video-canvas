import type { ImageEditOp } from "./types";

// ── Image-edit operation catalog ──────────────────────────────────────────────
// Shared by the ImageEditNode UI (labels/icons/which inputs to show) and the
// server route (buildImageEditInstruction composes the actual edit prompt). Kept
// pure + dependency-free so it is unit-testable and importable from both sides.

export interface ImageEditOpSpec {
  id: ImageEditOp;
  label: string;
  /** lucide-react icon name (resolved to a component in the node). */
  icon: string;
  desc: string;
  /** Mask painting is offered (inpaint/erase). */
  needsMask: boolean;
  /** A text instruction is required (vs. optional refinement). */
  needsPrompt: boolean;
  /** Target aspect ratio is relevant (outpaint/reframe). */
  needsAspect: boolean;
  promptPlaceholder: string;
}

export const IMAGE_EDIT_OPS: ImageEditOpSpec[] = [
  {
    id: "remove_bg", label: "抠图 / 去背景", icon: "Scissors",
    desc: "去除背景，仅保留主体（保边缘/发丝）",
    needsMask: false, needsPrompt: false, needsAspect: false,
    promptPlaceholder: "可选：补充说明要保留的主体，如「只保留前景人物」",
  },
  {
    id: "outpaint", label: "扩图 / 外扩", icon: "Maximize",
    desc: "向外延展画面，无缝续接场景与光照",
    needsMask: false, needsPrompt: false, needsAspect: true,
    promptPlaceholder: "可选：描述新扩展区域应出现的内容/环境",
  },
  {
    id: "inpaint", label: "局部重绘", icon: "Brush",
    desc: "在涂抹/指定区域重绘内容，其余保持不变",
    needsMask: true, needsPrompt: true, needsAspect: false,
    promptPlaceholder: "描述涂抹区域要替换成什么，如「换成一扇木门」",
  },
  {
    id: "erase", label: "擦除物体", icon: "Eraser",
    desc: "移除指定物体并用一致背景自然填补",
    needsMask: true, needsPrompt: true, needsAspect: false,
    promptPlaceholder: "描述要移除的物体，如「画面左侧的路人」",
  },
  {
    id: "relight", label: "重打光", icon: "Lightbulb",
    desc: "只改光照方向/强度/色温，内容与构图不变",
    needsMask: false, needsPrompt: true, needsAspect: false,
    promptPlaceholder: "描述目标光照，如「左侧暖色侧光，柔和电影感」",
  },
  {
    id: "upscale", label: "高清放大", icon: "Sparkles",
    desc: "内容构图不变，增强细节与锐度（指令式超分）",
    needsMask: false, needsPrompt: false, needsAspect: false,
    promptPlaceholder: "可选：补充强调，如「保留胶片颗粒感」",
  },
  {
    id: "reangle", label: "多角度 / 换机位", icon: "Camera",
    desc: "同一主体与场景，换一个机位角度重新拍摄",
    needsMask: false, needsPrompt: true, needsAspect: false,
    promptPlaceholder: "描述目标机位，如「水平环绕 45°，俯拍 30°，中景镜头」",
  },
  {
    id: "reframe", label: "改比例 / 重构图", icon: "Crop",
    desc: "重构图到新画幅，主体保持良好构图",
    needsMask: false, needsPrompt: false, needsAspect: true,
    promptPlaceholder: "可选：补充构图意图，如「主体居中留白」",
  },
];

export function getImageEditOp(id?: ImageEditOp | string): ImageEditOpSpec | undefined {
  return IMAGE_EDIT_OPS.find((o) => o.id === id);
}

// ── Edit-capable model groups (the three cloud backends) ──────────────────────
// Only models whose generateImage path activates an edit/i2i/kontext variant from
// a source image. The provider grouping is the user-facing "三条路". Values MUST be
// members of IMAGE_GEN_MODELS (guarded by a test).
export interface ImageEditModelGroup {
  provider: "higgsfield" | "kie" | "poyo";
  label: string;
  models: { value: string; label: string }[];
}

export const IMAGE_EDIT_MODEL_GROUPS: ImageEditModelGroup[] = [
  {
    provider: "higgsfield", label: "Higgsfield",
    models: [
      { value: "hf_flux_pro", label: "Flux Pro Kontext" },
      { value: "hf_seedream_v4", label: "Seedream 4" },
    ],
  },
  {
    provider: "kie", label: "KIE 云端",
    models: [
      { value: "kie_nano_banana_edit", label: "Nano Banana Edit" },
      { value: "kie_seedream_v4_edit", label: "Seedream 4 Edit" },
      { value: "kie_flux_kontext_pro", label: "Flux Kontext Pro" },
      { value: "kie_qwen_image_edit", label: "Qwen-Image Edit" },
      { value: "kie_gpt_image_15_edit", label: "GPT Image 1.5 Edit" },
    ],
  },
  {
    provider: "poyo", label: "Poyo",
    models: [
      { value: "poyo_nano_banana", label: "Nano Banana" },
      { value: "poyo_nano_banana_pro", label: "Nano Banana Pro" },
      { value: "poyo_flux_kontext_pro", label: "Flux Kontext Pro" },
      { value: "poyo_seedream_4", label: "Seedream 4" },
      { value: "poyo_gpt_image", label: "GPT Image 2" },
    ],
  },
];

/** Flat allow-list of edit-capable models (for server input validation). */
export const IMAGE_EDIT_MODELS: string[] = IMAGE_EDIT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.value));

/** Server default when the node leaves model empty — same proven path as pose_control. */
export const DEFAULT_IMAGE_EDIT_MODEL = "hf_flux_pro";

// ── ComfyUI-local backend mapping ─────────────────────────────────────────────
// Maps an edit operation (+ whether a painted mask exists) to the ComfyUI
// workflowTemplate the comfyui.generateImage executor understands. Mask-based ops
// (inpaint/erase with a mask) → true "inpaint"; everything else → "img2img"
// restyle from the source. Pure & unit-tested.
export function comfyTemplateForOp(op: ImageEditOp, hasMask: boolean): "inpaint" | "img2img" {
  if ((op === "inpaint" || op === "erase") && hasMask) return "inpaint";
  return "img2img";
}

/** ComfyUI img2img denoise per op: lower = preserve more of the source. Inpaint
 *  uses the executor default (full denoise inside the mask). */
export function comfyDenoiseForOp(op: ImageEditOp): number {
  switch (op) {
    case "upscale": return 0.35;   // enhance only — structure must not drift
    case "relight": return 0.55;   // keep structure, change light
    case "reangle": return 0.7;    // camera move = big structural change, keep identity/style
    case "reframe": return 0.5;
    case "remove_bg": return 0.6;
    case "outpaint": return 0.7;
    default: return 0.65;
  }
}

// ── Instruction builder ───────────────────────────────────────────────────────
// Turns (operation + optional user text + optional aspect) into a single English
// edit instruction for the edit model. Pure & deterministic → unit-tested.
export function buildImageEditInstruction(
  op: ImageEditOp,
  userPrompt?: string,
  aspectRatio?: string,
): string {
  const extra = userPrompt?.trim() ? ` ${userPrompt.trim()}` : "";
  const aspect = aspectRatio?.trim();
  switch (op) {
    case "remove_bg":
      return `Remove the background completely, keeping only the main subject cleanly cut out on a plain solid white background. Preserve the subject's exact edges, hair detail, colors and lighting.${extra}`;
    case "outpaint":
      return `Extend and uncrop the image outward${aspect ? ` to a ${aspect} aspect ratio` : ""}, seamlessly continuing the existing scene, perspective, lighting and style into the newly generated areas. Do not alter the original content.${extra}`;
    case "inpaint":
      return `In the masked / indicated region only, regenerate the content${extra ? `:${extra}` : " to blend naturally with the surroundings"}. Keep everything outside that region exactly unchanged.`;
    case "erase":
      return `Remove${extra ? extra : " the indicated object"} from the image and realistically fill the area with background consistent in texture, lighting and perspective. Keep everything else unchanged.`;
    case "relight":
      return `Relight the image${extra ? `:${extra}` : " with soft cinematic key lighting"}. Change only the lighting direction, intensity and color temperature — keep the subject, pose, composition and all content identical.`;
    case "upscale":
      return `Upscale and enhance this image to a higher-fidelity, high-resolution version. Sharpen fine details, textures and edges, remove blur and compression artifacts. Keep the content, composition, colors, lighting and style exactly identical — do not add, remove or alter anything.${extra}`;
    case "reangle":
      return `Re-render the exact same subject and scene from a different camera angle${extra ? `:${extra}` : ""}. Keep the subject's identity, outfit, environment, lighting mood and overall style strictly identical — only the camera position, viewing angle and framing change.`;
    case "reframe":
      return `Recompose and reframe the image${aspect ? ` to a ${aspect} aspect ratio` : ""}, keeping the main subject well composed and naturally extending or filling the edges as needed.${extra}`;
    default:
      return `Edit the image.${extra}`;
  }
}
