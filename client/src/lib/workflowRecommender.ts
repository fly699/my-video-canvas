// Pure, side-effect-free recommender: given the models a ComfyUI server actually
// has (from /object_info via comfyui.fetchModels), detect the model families and
// suggest (a) the app's built-in workflow templates those models can run — for
// one-click node creation — and (b) a curated catalog of popular external
// workflows, each with browser search links (the user's browser can reach the
// workflow sites even when our server's egress is blocked).
//
// Detection is deterministic filename heuristics; no network, fully unit-testable.

export interface RecModelList {
  ckpts?: string[];
  loras?: string[];
  unets?: string[];
  vaes?: string[];
  motionModules?: string[];
  controlnets?: string[];
  upscaleModels?: string[];
  ipadapters?: string[];
  clips?: string[];
  clipVisions?: string[];
}

export type ModelFamily =
  | "flux" | "sd3" | "sdxl" | "pony" | "sd15"
  | "wan" | "ltxv" | "hunyuanVideo" | "svd" | "animatediff"
  | "controlnet" | "ipadapter" | "upscale";

export type BuiltinNodeType = "comfyui_image" | "comfyui_video";

export interface BuiltinRec {
  nodeType: BuiltinNodeType;
  workflowTemplate: string; // image: txt2img/img2img/inpaint · video: animatediff/svd/wan_t2v/wan_i2v/ltxv
  title: string;
  desc: string;
}

export interface ExternalRec {
  title: string;
  desc: string;
  needs: string; // human-readable model requirement
}

export interface FamilyRec {
  family: ModelFamily;
  label: string;
  matched: string[]; // up to a few model filenames that triggered this family
  builtins: BuiltinRec[];
  externals: ExternalRec[];
  /** Suggested search query for the external workflow sites. */
  query: string;
}

const has = (arr: string[] | undefined, re: RegExp) => Array.isArray(arr) && arr.some((s) => re.test(s));
const pick = (arr: string[] | undefined, re: RegExp, n = 3) => (arr ?? []).filter((s) => re.test(s)).slice(0, n);

/** Build browser search URLs for a query across the popular workflow sites. */
export function workflowSearchLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query);
  return [
    { label: "ComfyWorkflows", url: `https://comfyworkflows.com/search?q=${q}` },
    { label: "OpenArt", url: `https://openart.ai/workflows/search?q=${q}` },
    { label: "Civitai", url: `https://civitai.com/search/models?query=${q}` },
    { label: "Google", url: `https://www.google.com/search?q=${q}+ComfyUI+workflow+json` },
  ];
}

const IMG = (workflowTemplate: string, title: string, desc: string): BuiltinRec => ({ nodeType: "comfyui_image", workflowTemplate, title, desc });
const VID = (workflowTemplate: string, title: string, desc: string): BuiltinRec => ({ nodeType: "comfyui_video", workflowTemplate, title, desc });

/**
 * Detect families and produce recommendations, most-relevant first. Pure.
 */
export function recommendWorkflows(models: RecModelList): FamilyRec[] {
  const recs: FamilyRec[] = [];
  const ckpts = models.ckpts ?? [];
  const unets = models.unets ?? [];
  const base = [...ckpts, ...unets];

  // ── Image base-model families (mutually exclusive primary classification) ──
  if (has(base, /flux/i)) {
    recs.push({
      family: "flux", label: "Flux", matched: pick(base, /flux/i),
      query: "Flux",
      builtins: [IMG("txt2img", "Flux 文生图", "用你的 Flux 模型直接文生图（内置节点，一键创建）。")],
      externals: [
        { title: "Flux Dev/Schnell 基础工作流", desc: "官方推荐的 Flux 文生图基础流，含 CLIP/T5 双编码。", needs: "flux1-dev/schnell + t5xxl + clip_l + ae(VAE)" },
        { title: "Flux + ControlNet / Redux", desc: "结构/风格参考引导生成。", needs: "Flux + ControlNet 或 Redux(styleModel)" },
      ],
    });
  } else if (has(base, /sd3|stable.?diffusion.?3|sd_?3/i)) {
    recs.push({
      family: "sd3", label: "SD3 / SD3.5", matched: pick(base, /sd3|sd_?3/i),
      query: "Stable Diffusion 3.5",
      builtins: [IMG("txt2img", "SD3 文生图", "用 SD3/3.5 模型文生图（内置节点）。")],
      externals: [{ title: "SD3.5 Large/Medium 基础工作流", desc: "三文本编码器的 SD3.5 标准流。", needs: "sd3.5 + clip_g/clip_l/t5xxl" }],
    });
  } else if (has(base, /pony/i)) {
    recs.push({
      family: "pony", label: "Pony (SDXL)", matched: pick(base, /pony/i),
      query: "Pony Diffusion XL",
      builtins: [IMG("txt2img", "Pony 文生图", "Pony 属 SDXL 体系，用内置 txt2img。"), IMG("img2img", "Pony 图生图", "基于已有图改绘。")],
      externals: [{ title: "Pony 角色/风格工作流", desc: "Pony 专用提示词风格 + LoRA 叠加。", needs: "Pony XL ckpt + 对应 LoRA" }],
    });
  } else if (has(base, /xl|sdxl|sd_xl/i)) {
    recs.push({
      family: "sdxl", label: "SDXL", matched: pick(base, /xl|sdxl|sd_xl/i),
      query: "SDXL",
      builtins: [IMG("txt2img", "SDXL 文生图", "用 SDXL 模型文生图（内置节点）。"), IMG("img2img", "SDXL 图生图", "基于参考图改绘。")],
      externals: [
        { title: "SDXL Base + Refiner", desc: "Base 出图 + Refiner 精修的经典两段式。", needs: "sdxl base + refiner" },
        { title: "SDXL Lightning / Turbo", desc: "4~8 步极速出图。", needs: "对应 Lightning/Turbo ckpt 或 LoRA" },
      ],
    });
  } else if (ckpts.length > 0) {
    // Default any remaining checkpoint family to SD1.5-style.
    recs.push({
      family: "sd15", label: "SD1.5", matched: ckpts.slice(0, 3),
      query: "SD1.5",
      builtins: [IMG("txt2img", "文生图", "用你的模型文生图（内置节点）。"), IMG("img2img", "图生图", "基于参考图改绘。")],
      externals: [{ title: "SD1.5 + LCM/LoRA 加速", desc: "LCM LoRA 少步快出图。", needs: "SD1.5 ckpt + LCM LoRA" }],
    });
  }

  // ── Video model families ──
  if (has(base, /wan/i)) {
    recs.push({
      family: "wan", label: "Wan 视频", matched: pick(base, /wan/i),
      query: "Wan 2.1 image to video",
      builtins: [VID("wan_i2v", "Wan 图生视频", "图片→视频（内置节点，单镜约 5s）。"), VID("wan_t2v", "Wan 文生视频", "文字→视频（内置节点）。")],
      externals: [{ title: "Wan2.1 I2V/T2V 官方工作流", desc: "Wan 高质量图/文生视频。", needs: "wan unet + umt5 + wan vae" }],
    });
  }
  if (has(base, /ltx/i)) {
    recs.push({
      family: "ltxv", label: "LTX-Video", matched: pick(base, /ltx/i),
      query: "LTX Video",
      builtins: [VID("ltxv", "LTXV 文/图生视频", "LTX-Video 快速视频生成（内置节点）。")],
      externals: [{ title: "LTXV 0.9 工作流", desc: "实时级 LTX-Video 流。", needs: "ltx-video ckpt + t5xxl" }],
    });
  }
  if (has(base, /hunyuan.?video|hyvideo|hunyuan_video/i)) {
    recs.push({
      family: "hunyuanVideo", label: "HunyuanVideo", matched: pick(base, /hunyuan/i),
      query: "HunyuanVideo",
      builtins: [],
      externals: [{ title: "HunyuanVideo 文生视频工作流", desc: "腾讯混元视频（App 暂无内置模板，建议用工作流节点）。", needs: "hunyuan_video + llava/clip + vae" }],
    });
  }
  if (has(base, /svd|stable.?video/i)) {
    recs.push({
      family: "svd", label: "Stable Video Diffusion", matched: pick(base, /svd|stable.?video/i),
      query: "Stable Video Diffusion",
      builtins: [VID("svd", "SVD 图生视频", "静帧→短视频（内置节点）。")],
      externals: [{ title: "SVD XT 工作流", desc: "SVD 图生视频 25 帧。", needs: "svd_xt ckpt" }],
    });
  }
  if ((models.motionModules ?? []).length > 0 || has(base, /animatediff|mm_sd|motion/i)) {
    recs.push({
      family: "animatediff", label: "AnimateDiff", matched: pick(models.motionModules, /.*/) ,
      query: "AnimateDiff",
      builtins: [VID("animatediff", "AnimateDiff 动图", "SD1.5/SDXL + 动作模块生成动画（内置节点）。")],
      externals: [{ title: "AnimateDiff Evolved + ControlNet", desc: "可控运镜/姿态的动画流。", needs: "motion module + 底模 + ControlNet" }],
    });
  }

  // ── Capability add-ons (no base model, just enrich) ──
  if ((models.controlnets ?? []).length > 0) {
    recs.push({
      family: "controlnet", label: "ControlNet", matched: (models.controlnets ?? []).slice(0, 3),
      query: "ControlNet",
      builtins: [],
      externals: [{ title: "ControlNet 结构控制工作流", desc: "用线稿/深度/姿态精确控制构图。", needs: "对应 ControlNet 模型 + 预处理器" }],
    });
  }
  if ((models.ipadapters ?? []).length > 0) {
    recs.push({
      family: "ipadapter", label: "IPAdapter", matched: (models.ipadapters ?? []).slice(0, 3),
      query: "IPAdapter",
      builtins: [],
      externals: [{ title: "IPAdapter 风格/人脸参考工作流", desc: "用参考图迁移风格或保持人物一致。", needs: "ipadapter 模型 + clip_vision" }],
    });
  }
  if ((models.upscaleModels ?? []).length > 0) {
    recs.push({
      family: "upscale", label: "高清放大", matched: (models.upscaleModels ?? []).slice(0, 3),
      query: "ComfyUI upscale",
      builtins: [],
      externals: [{ title: "超分放大工作流", desc: "ESRGAN/4x 等模型放大 + 细节修复。", needs: "upscale 模型（如 4x-UltraSharp）" }],
    });
  }

  return recs;
}
