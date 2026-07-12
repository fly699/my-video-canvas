import { storagePut, resolveToAbsoluteUrl } from "server/storage";
import { ENV } from "./env";
import { generateHiggsfieldImage, type HiggsfieldImageModel } from "./higgsfield";
import { isImagePersistenceEnabled } from "./storageConfig";
import { isKieImageModel, generateImageKie } from "./kieImage";

export type GenerateImageOptions = {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "720p" | "1080p";
  // Generic Poyo image params (extended model set)
  resolution?: string; // "0.5K" | "1K" | "2K" | "3K" | "4K"
  n?: number;
  outputFormat?: string; // "png" | "jpg" | "jpeg" | "webp"
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  // Soul Standard specific params
  widthAndHeight?: string;
  batchSize?: number;
  seed?: number;
  enhancePrompt?: boolean;
  // Reve / Seedream v4 / Flux Pro shared
  reveAspectRatio?: string;
  reveResolution?: string;
  // Flux Pro Kontext extra params
  fluxGuidanceScale?: number;
  fluxSeed?: number;
  fluxNumImages?: number;
  // kie.ai: the resolved key (router owns kie auth via resolveKieKey) — only set
  // for kie_* models, ignored by all other providers.
  kieApiKey?: string;
};

export type GenerateImageResponse = {
  url?: string;
  urls?: string[]; // multiple images when batchSize > 1
  // Original upstream AI-platform URL(s), set when we re-hosted the result to
  // our own storage. These remain fetchable by other upstream providers for a
  // short window (e.g. Poyo's ~24h CDN TTL), so the client can offer them as a
  // fallback reference when our re-hosted copy isn't publicly reachable.
  sourceUrl?: string;
  sourceUrls?: string[];
  sourceAt?: number; // ms epoch when generated
};

const POYO_BASE = "https://api.poyo.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40; // 2 min max

// ---------------------------------------------------------------------------
// Poyo image model specs — maps each UI model value to its wire name and which
// params it accepts, per docs/poyo-image-api.md. `sizeMode` selects the field
// name for size: "size" (most models), "aspect_ratio" (legacy flux-2 to avoid
// regressing the previously-working path), or false (no size param). `edit`
// names the -edit wire variant used when reference image(s) are supplied;
// `editOnly` means the model is always the edit variant (kling-o1).
// ---------------------------------------------------------------------------
type PoyoImageSpec = {
  wire: string;
  edit?: string;       // -edit variant wire name (when image_urls present)
  editOnly?: boolean;  // model is edit-only (image_urls required)
  /** Unified T2I/I2I models with NO separate -edit wire: the SAME wire auto-switches
   *  to image-to-image when image_urls is present (docs/poyo-image-api.md §八/速查表:
   *  z-image / grok-imagine-image=1 张, wan-2.7-image(-pro)=4 张). Value = image_urls
   *  cap. Without this, the reference图 was silently dropped → 图生图能力丢失。 */
  unifiedRef?: number;
  sizeMode?: "size" | "aspect_ratio" | false;
  resolution?: boolean;
  quality?: boolean;     // low/medium/high
  n?: boolean;
  outputFormat?: boolean;
};

export const POYO_IMAGE_SPECS: Record<string, PoyoImageSpec> = {
  // Nano Banana (Google)
  poyo_nano_banana:     { wire: "nano-banana",     edit: "nano-banana-edit" },
  poyo_nano_banana_2:   { wire: "nano-banana-2",   edit: "nano-banana-2-edit" },
  poyo_nano_banana_pro: { wire: "nano-banana-pro", edit: "nano-banana-pro-edit", sizeMode: "size", resolution: true, outputFormat: true },
  // Nano Banana 2 New（Gemini 3.1 Flash Image Preview）：2K/4K，最多 14 张参考图，含 official 变体。
  poyo_nano_banana_2_new:      { wire: "nano-banana-2-new",      edit: "nano-banana-2-new-edit",      sizeMode: "size", resolution: true, outputFormat: true },
  poyo_nano_banana_2_official: { wire: "nano-banana-2-official", edit: "nano-banana-2-official-edit", sizeMode: "size", resolution: true, outputFormat: true },
  // GPT Image (OpenAI)
  poyo_gpt_4o_image: { wire: "gpt-4o-image",  edit: "gpt-4o-image-edit" },
  poyo_gpt_image_15: { wire: "gpt-image-1.5", edit: "gpt-image-1.5-edit", quality: true },
  poyo_gpt_image:    { wire: "gpt-image-2",   edit: "gpt-image-2-edit", sizeMode: "size", resolution: true, quality: true },
  // Flux (Black Forest Labs)
  poyo_flux:             { wire: "flux-2-pro",        edit: "flux-2-pro-edit",  sizeMode: "aspect_ratio" },
  poyo_sdxl:             { wire: "flux-2-flex",       edit: "flux-2-flex-edit", sizeMode: "aspect_ratio" },
  poyo_flux_kontext_pro: { wire: "flux-kontext-pro",  edit: "flux-kontext-pro-edit", sizeMode: "size", outputFormat: true },
  poyo_flux_kontext_max: { wire: "flux-kontext-max",  edit: "flux-kontext-max-edit", sizeMode: "size", outputFormat: true },
  // Seedream (ByteDance)
  poyo_seedream_4:      { wire: "seedream-4",        edit: "seedream-4-edit",        sizeMode: "size", resolution: true, n: true },
  // 4.5 / 5.0-lite: resolution preset is a `size` value (no separate resolution field).
  poyo_seedream:        { wire: "seedream-4.5",      edit: "seedream-4.5-edit",      sizeMode: "size" },
  poyo_seedream_5_lite: { wire: "seedream-5.0-lite", edit: "seedream-5.0-lite-edit", sizeMode: "size" },
  // Wan (Alibaba) — unified model, auto-edit when image_urls present (no -edit suffix; ≤4 ref)
  poyo_wan_image:     { wire: "wan-2.7-image",     sizeMode: "size", n: true, unifiedRef: 4 },
  poyo_wan_image_pro: { wire: "wan-2.7-image-pro", sizeMode: "size", n: true, unifiedRef: 4 },
  // Kling (Kuaishou)
  poyo_kling_o1_image: { wire: "kling-o1-image-edit", editOnly: true, sizeMode: "size", resolution: true, n: true, outputFormat: true },
  poyo_kling_o3_image: { wire: "kling-o3-image", edit: "kling-o3-image-edit", sizeMode: "size", resolution: true, n: true, outputFormat: true },
  // Others — unified models, auto-edit when image_urls present (1 ref image each)
  poyo_z_image:    { wire: "z-image",            sizeMode: "size", unifiedRef: 1 },
  poyo_grok_image: { wire: "grok-imagine-image", sizeMode: "size", unifiedRef: 1 },
  // Legacy aliases (kept so old payloads keep routing)。edit 变体必须与上面的正式 spec
  // 同步：默认管线（model 未传）走的正是 "gpt-image-2" 别名，此前漏配 edit → 带参考图的
  // 请求参考图被静默丢弃（画面推演/多角度宫格真实故障：产物与源图完全无关）。
  "gpt-image-2":  { wire: "gpt-image-2", edit: "gpt-image-2-edit", sizeMode: "size", resolution: true, quality: true },
  "seedream-4.5": { wire: "seedream-4.5", edit: "seedream-4.5-edit", sizeMode: "size" },
  "flux-2-pro":   { wire: "flux-2-pro", edit: "flux-2-pro-edit", sizeMode: "aspect_ratio" },
  "flux-2-flex":  { wire: "flux-2-flex", edit: "flux-2-flex-edit", sizeMode: "aspect_ratio" },
  "wan-2.7-image":      { wire: "wan-2.7-image", sizeMode: "size", n: true, unifiedRef: 4 },
  "grok-imagine-image": { wire: "grok-imagine-image", sizeMode: "size", unifiedRef: 1 },
};

// Build the Poyo `input` payload for a model spec from the generic options.
export async function buildPoyoImageInput(spec: PoyoImageSpec, options: GenerateImageOptions): Promise<{ model: string; input: Record<string, unknown> }> {
  const input: Record<string, unknown> = { prompt: options.prompt };

  // Resolve reference image(s) → absolute URLs Poyo can fetch (our internal
  // `/manus-storage/{key}` paths aren't reachable upstream).
  const refUrls: string[] = [];
  for (const img of options.originalImages ?? []) {
    if (img?.url) refUrls.push(await resolveToAbsoluteUrl(img.url));
  }
  const hasRefs = refUrls.length > 0;
  const isEdit = spec.editOnly || (hasRefs && !!spec.edit);

  if (spec.sizeMode === "size" && options.size) input.size = options.size;
  else if (spec.sizeMode === "aspect_ratio") input.aspect_ratio = options.size ?? "16:9";

  if (spec.resolution && options.resolution) input.resolution = options.resolution;
  if (spec.quality && options.quality) input.quality = options.quality;
  if (spec.n && options.n) input.n = options.n;
  if (spec.outputFormat && options.outputFormat) input.output_format = options.outputFormat;

  // Attach reference images where the model can consume them:
  //  - Edit-variant models (`editOnly` or `isEdit` switched to the -edit wire) →
  //    image_urls + legacy reference_image_url。
  //  - Unified T2I/I2I models (z-image / grok-imagine-image / wan-2.7-image(-pro))
  //    自动编辑：同一 wire 接收 image_urls 即转图生图，按文档上限截断（docs §八/速查表）。
  //    此前这些被当成"纯文生"直接丢弃参考图 → 图生图多模态能力丢失，现按文档恢复。
  if (hasRefs && isEdit) {
    input.image_urls = refUrls;
    input.reference_image_url = refUrls[0]; // legacy single-ref field for edit wires
  } else if (hasRefs && spec.unifiedRef) {
    input.image_urls = refUrls.slice(0, spec.unifiedRef);
  }

  const model = isEdit && spec.edit ? spec.edit : spec.wire;
  return { model, input };
}

async function generateImagePoyo(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  // Resolve the model spec (by UI value or legacy wire alias); fall back to a
  // gpt-image-2-like default so an unknown value still produces a valid call.
  const specKey = options.model ?? "gpt-image-2";
  const spec = POYO_IMAGE_SPECS[specKey] ?? { wire: specKey, sizeMode: "size" as const, resolution: true, quality: true };
  const { model, input } = await buildPoyoImageInput(spec, options);

  // Submit task
  const submitRes = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`Poyo image submit failed (${submitRes.status}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code: number; data: { task_id: string } };
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error("Poyo image submit: no task_id returned");

  // Poll until finished
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(`${POYO_BASE}/api/generate/status/${taskId}`, {
      headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusRes.ok) {
      if (statusRes.status === 429 || statusRes.status >= 500) continue; // transient, retry
      throw new Error(`Poyo status check failed (${statusRes.status})`);
    }

    const statusData = (await statusRes.json()) as {
      code: number;
      data: {
        status: string;
        files?: Array<{ file_url: string; file_type: string }>;
        error_message?: string;
      };
    };
    const d = statusData.data;

    if (d.status === "finished") {
      // Look for any file with image MIME type or image-extension URL; older
      // matching by index can miss multi-output responses (e.g. Soul Standard
      // batches). Falls back to first file on no-match so we don't regress.
      const isImageLike = (f: { file_type?: string; file_url?: string }): boolean => {
        const ft = (f.file_type ?? "").toLowerCase();
        const url = f.file_url ?? "";
        return ft.includes("image") || /\.(png|jpe?g|webp|gif|bmp)(?:$|\?)/i.test(url);
      };
      const fileUrl = d.files?.find(isImageLike)?.file_url ?? d.files?.[0]?.file_url;
      if (!fileUrl) {
        // Credits spent upstream; [CHARGED] prefix lets the frontend warn the
        // user instead of letting them click "generate" again and re-pay.
        throw new Error("[CHARGED] Poyo 图像生成完成但响应未含 file URL（积分已扣，请勿重试）");
      }

      // Re-host to Manus S3 so the URL doesn't die after Poyo's 24h CDN TTL.
      // Admin can disable via the StoragePanel persistImage toggle (saves S3
      // quota at the cost of upstream URL expiry).
      if (await isImagePersistenceEnabled()) {
        try {
          const imgRes = await fetch(fileUrl);
          if (!imgRes.ok) {
            console.warn(`[poyo-image] persist skipped: upstream fetch ${imgRes.status} ${imgRes.statusText}; returning upstream URL (expires in 24h)`);
          } else {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const mimeType = imgRes.headers.get("content-type") ?? "image/png";
            const { url } = await storagePut(`generated/${Date.now()}.png`, buf, mimeType);
            // Keep the original Poyo CDN URL as a short-lived public fallback.
            return { url, sourceUrl: fileUrl, sourceAt: Date.now() };
          }
        } catch (err) {
          // Audit log: which step broke. Without this the admin sees "开关打开
          // 了但没存" with no clue whether it's a Forge config issue, network
          // issue, or S3 quota issue.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[poyo-image] persist FAILED, falling back to upstream URL (expires in 24h): ${msg.slice(0, 300)}`);
        }
      }
      return { url: fileUrl };
    }

    if (d.status === "failed") {
      throw new Error(`Poyo image generation failed: ${d.error_message ?? "unknown error"}`);
    }
  }

  throw new Error("Poyo image generation timed out");
}

async function generateImageForge(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  if (!ENV.forgeApiUrl) throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  if (!ENV.forgeApiKey) throw new Error("BUILT_IN_FORGE_API_KEY is not configured");

  const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL("images.v1.ImageService/GenerateImage", baseUrl).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({
      prompt: options.prompt,
      original_images: options.originalImages ?? [],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Image generation request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
  }

  const result = (await response.json()) as { image: { b64Json: string; mimeType: string } };
  const buffer = Buffer.from(result.image.b64Json, "base64");
  // NOTE: Forge returns base64-inline (no upstream URL), so the persistImage
  // admin toggle does NOT apply here — we always have to put to S3 or the
  // frontend has no URL to render. Saving the toggle for Poyo/Higgsfield only.
  const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, result.image.mimeType);
  return { url };
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  // Route by explicit model selection
  if (options.model === "manus_forge") return generateImageForge(options);
  // All Poyo image models (incl. legacy wire aliases) resolve via POYO_IMAGE_SPECS.
  if (options.model && (options.model.startsWith("poyo_") || options.model in POYO_IMAGE_SPECS)) {
    return generateImagePoyo(options);
  }
  // Higgsfield image models
  if (options.model === "hf_soul_standard" || options.model === "hf_reve" || options.model === "hf_seedream_v4" || options.model === "hf_flux_pro") {
    const hfModel: HiggsfieldImageModel =
      options.model === "hf_soul_standard" ? "higgsfield-ai/soul/standard"
      : options.model === "hf_seedream_v4" ? "bytedance/seedream/v4/text-to-image"
      : options.model === "hf_flux_pro" ? "flux-pro/kontext/max/text-to-image"
      : "reve/text-to-image";
    const result = await generateHiggsfieldImage({
      model: hfModel,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      referenceImageUrl: options.originalImages?.[0]?.url,
      // Soul Standard specific params
      widthAndHeight: options.widthAndHeight,
      quality: options.quality as string | undefined,
      batchSize: options.batchSize,
      seed: options.seed,
      enhancePrompt: options.enhancePrompt,
      // Reve / Seedream v4 / Flux Pro aspect ratio
      aspectRatio: options.reveAspectRatio,
      resolution: options.reveResolution,
      // Flux Pro Kontext extra
      guidanceScale: options.fluxGuidanceScale,
      numImages: options.fluxNumImages,
      fluxSeed: options.fluxSeed,
    });
    return {
      url: result.url,
      urls: result.urls,
      sourceUrl: result.sourceUrl,
      sourceUrls: result.sourceUrls,
      sourceAt: result.sourceAt,
    };
  }
  // kie.ai image models (unified jobs API) — additive branch, key resolved by router.
  if (isKieImageModel(options.model)) return generateImageKie(options);
  // Default: use poyo if key available, else forge
  if (ENV.poyoApiKey) return generateImagePoyo(options);
  return generateImageForge(options);
}
