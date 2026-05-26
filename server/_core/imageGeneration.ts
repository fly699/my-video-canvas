import { storagePut, resolveToAbsoluteUrl } from "server/storage";
import { ENV } from "./env";
import { generateHiggsfieldImage, type HiggsfieldImageModel } from "./higgsfield";
import { isImagePersistenceEnabled } from "./storageConfig";

export type GenerateImageOptions = {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "720p" | "1080p";
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
};

export type GenerateImageResponse = {
  url?: string;
  urls?: string[]; // multiple images when batchSize > 1
};

const POYO_BASE = "https://api.poyo.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40; // 2 min max

async function generateImagePoyo(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const model = options.model ?? "gpt-image-2";
  const input: Record<string, unknown> = { prompt: options.prompt };

  if (model === "gpt-image-2") {
    input.size = options.size ?? "16:9";
    input.quality = options.quality ?? "medium";
  } else {
    // Flux models (flux-2-pro, flux-2-flex) use aspect_ratio
    input.aspect_ratio = options.size ?? "16:9";
  }

  if (options.originalImages?.[0]?.url) {
    // Upstream Poyo can't fetch our internal `/manus-storage/{key}` paths;
    // hand them an absolute presigned S3 URL.
    input.reference_image_url = await resolveToAbsoluteUrl(options.originalImages[0].url);
  }

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
            return { url };
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
  if (options.model === "poyo_gpt_image")  return generateImagePoyo({ ...options, model: "gpt-image-2" });
  if (options.model === "poyo_seedream")   return generateImagePoyo({ ...options, model: "seedream-4.5" });
  if (options.model === "poyo_grok_image") return generateImagePoyo({ ...options, model: "grok-imagine-image" });
  if (options.model === "poyo_wan_image")  return generateImagePoyo({ ...options, model: "wan-2.7-image" });
  if (options.model === "poyo_flux" || options.model === "poyo_sdxl") {
    // flux-2-pro: high quality Flux model; flux-2-flex: flexible/cheaper variant
    const poyoModel = options.model === "poyo_flux" ? "flux-2-pro" : "flux-2-flex";
    return generateImagePoyo({ ...options, model: poyoModel });
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
    return { url: result.url, urls: result.urls };
  }
  // Default: use poyo if key available, else forge
  if (ENV.poyoApiKey) return generateImagePoyo(options);
  return generateImageForge(options);
}
