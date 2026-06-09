import { storagePut } from "server/storage";
import { isImagePersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";
import type { GenerateImageOptions, GenerateImageResponse } from "./imageGeneration";

// kie.ai image models via the UNIFIED jobs API (POST /api/v1/jobs/createTask +
// GET /api/v1/jobs/recordInfo). `edit:true` models require reference image(s),
// sent as input.image_urls. `id` is kie's wire `model` value (from the API docs).
export interface KieImageSpec { id: string; label: string; family: string; edit: boolean }
export const KIE_IMAGE_MODELS: Record<string, KieImageSpec> = {
  // text-to-image
  kie_nano_banana:      { id: "google/nano-banana", label: "Nano Banana", family: "Nano Banana", edit: false },
  kie_nano_banana_pro:  { id: "nano-banana-pro", label: "Nano Banana Pro", family: "Nano Banana", edit: false },
  kie_seedream_v4:      { id: "bytedance/seedream-v4-text-to-image", label: "Seedream 4.0", family: "Seedream", edit: false },
  kie_seedream_45:      { id: "seedream/4.5-text-to-image", label: "Seedream 4.5", family: "Seedream", edit: false },
  kie_flux2_pro:        { id: "flux-2/pro-text-to-image", label: "Flux-2 Pro", family: "Flux-2", edit: false },
  kie_gpt_image_15:     { id: "gpt-image/1.5-text-to-image", label: "GPT Image 1.5", family: "GPT Image", edit: false },
  kie_imagen4:          { id: "google/imagen4", label: "Imagen 4", family: "Imagen", edit: false },
  kie_z_image:          { id: "z-image", label: "Z-Image", family: "Z-Image", edit: false },
  kie_grok_image:       { id: "grok-imagine/text-to-image", label: "Grok Image", family: "Grok", edit: false },
  // image-to-image / edit (require reference image)
  kie_nano_banana_edit: { id: "google/nano-banana-edit", label: "Nano Banana 编辑", family: "Nano Banana", edit: true },
  kie_seedream_v4_edit: { id: "bytedance/seedream-v4-edit", label: "Seedream 4.0 编辑", family: "Seedream", edit: true },
  kie_flux2_pro_i2i:    { id: "flux-2/pro-image-to-image", label: "Flux-2 Pro 图生图", family: "Flux-2", edit: true },
  kie_gpt_image_15_edit:{ id: "gpt-image/1.5-image-to-image", label: "GPT Image 1.5 编辑", family: "GPT Image", edit: true },
};

export function isKieImageModel(model?: string): boolean {
  return !!model && model in KIE_IMAGE_MODELS;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 60; // 3 min max — kie market models can be slower than Poyo

// The resolved kie key is passed in by the router (which owns the kie auth via
// resolveKieKey); this function never touches the whitelist or env directly.
export async function generateImageKie(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const apiKey = options.kieApiKey;
  if (!apiKey) throw new Error("kie API key 未解析（内部错误）");
  const spec = KIE_IMAGE_MODELS[options.model ?? ""];
  if (!spec) throw new Error(`未知 kie 图像模型：${options.model}`);

  const input: Record<string, unknown> = { prompt: options.prompt, output_format: "png" };
  const aspect = options.size ?? options.reveAspectRatio;
  if (aspect) input.aspect_ratio = aspect;
  if (spec.edit) {
    const refs = (options.originalImages ?? []).map((o) => o.url).filter((u): u is string => !!u);
    if (refs.length === 0) throw new Error(`${spec.label} 需要参考图，请先连接或上传参考图`);
    input.image_urls = refs;
  }

  // createTask
  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: spec.id, input }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`kie 图像提交失败 (${submitRes.status}): ${text.slice(0, 300)}`);
  }
  const submitData = (await submitRes.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submitData.code !== 200 || !submitData.data?.taskId) {
    throw new Error(`kie 图像提交返回错误 (code ${submitData.code}): ${submitData.msg ?? ""}`);
  }
  const taskId = submitData.data.taskId;

  // poll recordInfo until success/failed
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) {
      if (statusRes.status === 429 || statusRes.status >= 500) continue; // transient
      throw new Error(`kie 状态查询失败 (${statusRes.status})`);
    }
    const body = (await statusRes.json()) as {
      code?: number;
      data?: { successFlag?: number; errorMessage?: string; response?: { result_urls?: string[]; resultUrls?: string[] | string } };
    };
    const d = body.data;
    if (!d) continue;
    if (d.successFlag === 1) {
      // result_urls (array) for market models; some endpoints use resultUrls (may be a JSON string).
      let urls = d.response?.result_urls ?? [];
      if (!urls.length && d.response?.resultUrls) {
        const ru = d.response.resultUrls;
        urls = Array.isArray(ru) ? ru : (() => { try { return JSON.parse(ru) as string[]; } catch { return []; } })();
      }
      if (!urls.length) throw new Error("[CHARGED] kie 图像生成完成但未返回 URL（积分可能已扣，请勿重试）");
      return persistKieImages(urls);
    }
    if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`kie 图像生成失败：${d.errorMessage ?? "未知错误"}`);
    }
  }
  throw new Error("kie 图像生成超时");
}

// kie-generated media expires in 14 days → re-host to our storage when persistence
// is on (mirrors the Poyo path). Keeps the kie CDN URL as a short-lived fallback.
async function persistKieImages(urls: string[]): Promise<GenerateImageResponse> {
  if (!(await isImagePersistenceEnabled())) {
    return { url: urls[0], urls, sourceUrl: urls[0], sourceUrls: urls, sourceAt: Date.now() };
  }
  const out: string[] = [];
  const src: string[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) { out.push(u); src.push(u); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "image/png";
      const { url } = await storagePut(`generated/${Date.now()}-${out.length}.png`, buf, mime);
      out.push(url); src.push(u);
    } catch {
      out.push(u); src.push(u); // fall back to the kie URL on persist failure
    }
  }
  return { url: out[0], urls: out, sourceUrl: src[0], sourceUrls: src, sourceAt: Date.now() };
}
