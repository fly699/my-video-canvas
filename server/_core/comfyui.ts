// ComfyUI integration — calls a self-hosted ComfyUI server with built-in workflow templates.
//
// Design notes:
// - This module intentionally does NOT call guardUrl()/assertSafeUrl(): ComfyUI servers
//   are typically internal/private and the project owner explicitly decided to allow them.
//   We still validate the URL is well-formed http(s) to reject data:/javascript:/etc.
// - Output is downloaded and re-uploaded into our own storage (storagePut) so the URL
//   remains stable even if ComfyUI's local file is cleaned up.
// - 4 built-in templates: txt2img / img2img / animatediff / svd.

import { storagePut } from "server/storage";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS_IMAGE = 100; // ~5 min
const POLL_MAX_ATTEMPTS_VIDEO = 200; // ~10 min — video workflows are slower

// ── URL validation ────────────────────────────────────────────────────────────

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ComfyUI URL 协议必须是 http 或 https，当前为 ${url.protocol}`);
  }
  // Strip trailing slash for consistent path joining.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

// ── Workflow templates ────────────────────────────────────────────────────────
//
// Templates use placeholder tokens like "__seed__", "__steps__" that we replace
// before submission. Numeric placeholders are quoted in JSON so we replace
// `"__seed__"` (with quotes) and inject the raw number — this preserves JSON validity.

const TXT2IMG_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__ckpt__" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "__width__", height: "__height__", batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "comfyui_output", images: ["8", 0] } },
};

const IMG2IMG_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "euler", scheduler: "normal", denoise: 0.75, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["10", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__ckpt__" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "comfyui_output", images: ["8", 0] } },
  "10": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["4", 2] } },
  "11": { class_type: "LoadImage", inputs: { image: "__refImageName__" } },
};

const ANIMATEDIFF_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: ["12", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__ckpt__" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: "__frames__" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "12": { class_type: "ADE_AnimateDiffLoaderGen1", inputs: { model_name: "__motionModule__", beta_schedule: "autoselect", model: ["4", 0] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_animatediff", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
};

const SVD_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "euler", scheduler: "karras", denoise: 1.0, model: ["15", 0], positive: ["12", 0], negative: ["12", 1], latent_image: ["12", 2] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["15", 2] } },
  "11": { class_type: "LoadImage", inputs: { image: "__refImageName__" } },
  "12": { class_type: "SVD_img2vid_Conditioning", inputs: { width: 1024, height: 576, video_frames: "__frames__", motion_bucket_id: 127, fps: "__fps__", augmentation_level: 0, clip_vision: ["15", 1], init_image: ["11", 0], vae: ["15", 2] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_svd", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
  "15": { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "__ckpt__" } },
};

// ── Placeholder substitution ──────────────────────────────────────────────────

interface SubstitutionMap {
  seed?: number;
  steps?: number;
  cfg?: number;
  ckpt?: string;
  width?: number;
  height?: number;
  prompt?: string;
  negPrompt?: string;
  refImageName?: string;
  motionModule?: string;
  frames?: number;
  fps?: number;
}

/** Escape a string for safe embedding inside a JSON string literal. */
function jsonEscape(s: string): string {
  // JSON.stringify wraps in quotes & escapes special chars; slice off the outer quotes.
  return JSON.stringify(s).slice(1, -1);
}

function applyTemplate(template: unknown, subs: SubstitutionMap): unknown {
  let json = JSON.stringify(template);
  // Numeric replacements: replace `"__name__"` (with quotes) so the result is a raw number
  const numericKeys: Array<[string, number | undefined]> = [
    ["__seed__", subs.seed ?? Math.floor(Math.random() * 2_147_483_647)],
    ["__steps__", subs.steps ?? 20],
    ["__cfg__", subs.cfg ?? 7],
    ["__width__", subs.width ?? 512],
    ["__height__", subs.height ?? 512],
    ["__frames__", subs.frames ?? 16],
    ["__fps__", subs.fps ?? 8],
  ];
  for (const [key, val] of numericKeys) {
    json = json.split(`"${key}"`).join(String(val));
  }
  // String replacements: replace the placeholder INSIDE the quoted string with escaped value
  const stringKeys: Array<[string, string | undefined]> = [
    ["__ckpt__", subs.ckpt ?? ""],
    ["__prompt__", subs.prompt ?? ""],
    ["__negPrompt__", subs.negPrompt ?? ""],
    ["__refImageName__", subs.refImageName ?? ""],
    ["__motionModule__", subs.motionModule ?? ""],
  ];
  for (const [key, val] of stringKeys) {
    json = json.split(key).join(jsonEscape(val ?? ""));
  }
  return JSON.parse(json);
}

// ── ComfyUI HTTP API ──────────────────────────────────────────────────────────

interface PromptSubmitResponse {
  prompt_id: string;
  number?: number;
}

interface HistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<
    string,
    {
      images?: Array<{ filename: string; subfolder: string; type: string }>;
      gifs?: Array<{ filename: string; subfolder: string; type: string; format?: string }>;
    }
  >;
}

async function submitWorkflow(baseUrl: string, workflow: unknown): Promise<string> {
  const res = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI 提交工作流失败 (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as PromptSubmitResponse;
  if (!data.prompt_id) throw new Error("ComfyUI 未返回 prompt_id");
  return data.prompt_id;
}

async function pollHistory(baseUrl: string, promptId: string, maxAttempts: number): Promise<HistoryEntry> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const res = await fetch(`${baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        if (res.status === 404 || res.status >= 500) continue;
        throw new Error(`ComfyUI 状态查询失败 (${res.status})`);
      }
      const data = (await res.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry && entry.status?.completed) return entry;
      if (entry?.status?.status_str === "error") {
        throw new Error(`ComfyUI 执行失败: ${JSON.stringify(entry.status.messages ?? []).slice(0, 500)}`);
      }
    } catch (err) {
      // Tolerate transient network errors; rethrow only if it's clearly fatal
      if (err instanceof Error && err.message.startsWith("ComfyUI 执行失败")) throw err;
    }
  }
  throw new Error("ComfyUI 任务超时");
}

function downloadUrl(baseUrl: string, filename: string, subfolder: string, type: string): string {
  const u = new URL(`${baseUrl}/view`);
  u.searchParams.set("filename", filename);
  u.searchParams.set("subfolder", subfolder);
  u.searchParams.set("type", type);
  return u.toString();
}

async function downloadAndStore(downloadUrlStr: string, ext: string, mimeType: string): Promise<{ url: string; key: string }> {
  const res = await fetch(downloadUrlStr, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载 ComfyUI 输出失败 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? mimeType;
  return await storagePut(`comfyui/${Date.now()}.${ext}`, buf, ct);
}

// ── Image upload (for img2img / SVD) ──────────────────────────────────────────

async function uploadImageToComfy(baseUrl: string, sourceUrl: string): Promise<string> {
  const imgRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`下载参考图失败 (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const ct = imgRes.headers.get("content-type") ?? "image/png";
  const ext = ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const filename = `comfy_input_${Date.now()}.${ext}`;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: ct });
  form.append("image", blob, filename);
  form.append("overwrite", "true");

  const upRes = await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!upRes.ok) {
    const text = await upRes.text().catch(() => "");
    throw new Error(`上传参考图到 ComfyUI 失败 (${upRes.status}): ${text.slice(0, 200)}`);
  }
  const data = (await upRes.json()) as { name?: string; subfolder?: string };
  return data.name ?? filename;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateComfyImageOptions {
  workflowTemplate: "txt2img" | "img2img";
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  lora?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  width?: number;
  height?: number;
  referenceImageUrl?: string;
}

export async function generateComfyImage(rawBaseUrl: string, options: GenerateComfyImageOptions): Promise<{ url: string }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  let refImageName: string | undefined;
  if (options.workflowTemplate === "img2img") {
    if (!options.referenceImageUrl) throw new Error("img2img 模板需要参考图");
    refImageName = await uploadImageToComfy(baseUrl, options.referenceImageUrl);
  }

  const template = options.workflowTemplate === "img2img" ? IMG2IMG_TEMPLATE : TXT2IMG_TEMPLATE;
  const workflow = applyTemplate(template, {
    prompt: options.prompt,
    negPrompt: options.negPrompt,
    ckpt: options.ckpt,
    steps: options.steps,
    cfg: options.cfg,
    seed: options.seed,
    width: options.width,
    height: options.height,
    refImageName,
  });

  const promptId = await submitWorkflow(baseUrl, workflow);
  const entry = await pollHistory(baseUrl, promptId, POLL_MAX_ATTEMPTS_IMAGE);

  // Find SaveImage output
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    const img = nodeOutput.images?.[0];
    if (img) {
      const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
      const stored = await downloadAndStore(dlUrl, "png", "image/png");
      return { url: stored.url };
    }
  }
  throw new Error("ComfyUI 任务完成但未返回图像输出");
}

export interface GenerateComfyVideoOptions {
  workflowTemplate: "animatediff" | "svd";
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  motionModule?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  frames?: number;
  fps?: number;
  referenceImageUrl?: string;
}

export async function generateComfyVideo(rawBaseUrl: string, options: GenerateComfyVideoOptions): Promise<{ url: string }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  let refImageName: string | undefined;
  if (options.workflowTemplate === "svd") {
    if (!options.referenceImageUrl) throw new Error("SVD 模板需要参考图");
    refImageName = await uploadImageToComfy(baseUrl, options.referenceImageUrl);
  }

  const template = options.workflowTemplate === "svd" ? SVD_TEMPLATE : ANIMATEDIFF_TEMPLATE;
  const workflow = applyTemplate(template, {
    prompt: options.prompt,
    negPrompt: options.negPrompt,
    ckpt: options.ckpt,
    motionModule: options.motionModule,
    steps: options.steps,
    cfg: options.cfg,
    seed: options.seed,
    frames: options.frames,
    fps: options.fps,
    refImageName,
  });

  const promptId = await submitWorkflow(baseUrl, workflow);
  const entry = await pollHistory(baseUrl, promptId, POLL_MAX_ATTEMPTS_VIDEO);

  // Find VHS_VideoCombine output (lives in `gifs` array regardless of mp4 format)
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    const v = nodeOutput.gifs?.[0];
    if (v) {
      const dlUrl = downloadUrl(baseUrl, v.filename, v.subfolder, v.type);
      const ext = v.filename.split(".").pop() || "mp4";
      const stored = await downloadAndStore(dlUrl, ext, "video/mp4");
      return { url: stored.url };
    }
    // Fallback: some templates expose video via images array
    const img = nodeOutput.images?.[0];
    if (img && /\.(mp4|webm|gif)$/i.test(img.filename)) {
      const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
      const ext = img.filename.split(".").pop() || "mp4";
      const stored = await downloadAndStore(dlUrl, ext, "video/mp4");
      return { url: stored.url };
    }
  }
  throw new Error("ComfyUI 任务完成但未返回视频输出");
}

// ── Model listing ─────────────────────────────────────────────────────────────

export interface ComfyModelList {
  ckpts: string[];
  loras: string[];
  samplers: string[];
  motionModules: string[];
}

interface ObjectInfo {
  [nodeName: string]: {
    input?: {
      required?: Record<string, [unknown[] | string, unknown?]>;
      optional?: Record<string, [unknown[] | string, unknown?]>;
    };
  };
}

function pickFirstArray(info: ObjectInfo, nodeName: string, fieldName: string): string[] {
  const node = info[nodeName];
  const slot = node?.input?.required?.[fieldName] ?? node?.input?.optional?.[fieldName];
  const first = slot?.[0];
  if (Array.isArray(first)) {
    return first.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export async function fetchComfyModels(rawBaseUrl: string): Promise<ComfyModelList> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const res = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ComfyUI 模型列表查询失败 (${res.status})`);
  const info = (await res.json()) as ObjectInfo;

  const ckpts = Array.from(new Set([
    ...pickFirstArray(info, "CheckpointLoaderSimple", "ckpt_name"),
    ...pickFirstArray(info, "ImageOnlyCheckpointLoader", "ckpt_name"),
  ]));
  const loras = pickFirstArray(info, "LoraLoader", "lora_name");
  const samplers = pickFirstArray(info, "KSampler", "sampler_name");
  const motionModules = Array.from(new Set([
    ...pickFirstArray(info, "ADE_AnimateDiffLoaderGen1", "model_name"),
    ...pickFirstArray(info, "AnimateDiffLoaderV1", "model_name"),
    ...pickFirstArray(info, "ADE_LoadAnimateDiffModel", "model_name"),
  ]));

  return { ckpts, loras, samplers, motionModules };
}
