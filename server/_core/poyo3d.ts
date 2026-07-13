/**
 * Poyo 图生 3D（Tripo3D H3.1 image-to-3d）——B 档「真 360°」的服务端底座。
 *
 * 权威 schema 严格取自 PoYo 官方文档 `/api-manual/3d-series/tripo-h31-3d`：
 *   model: "tripo3d-h3.1-image-to-3d"（图生 3D，image_urls 恰好 1 张）
 *   input: { image_urls:[url]（必填）, texture?(默认true), pbr?, face_limit?(1000-2000000),
 *            texture_quality?("standard"|"detailed"), geometry_quality?("standard"|"detailed"),
 *            quad?(默认false), auto_size?, model_seed?/texture_seed? }
 *   输出：统一 files[]，取 label==="model_glb" 或 format/后缀为 glb 的直链。
 * 禁止凭同族猜参数——以上字段逐条对齐官方 schema。
 */
import { ENV } from "./env";
import { resolveToAbsoluteUrl } from "../storage";
import { storagePutStream, storageBackend } from "../storage";
import { assertPublicUrl } from "./ssrfGuard";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

const POYO_BASE = "https://api.poyo.ai";
const IMAGE_TO_3D_MODEL = "tripo3d-h3.1-image-to-3d";

// ── #151 图生 3D 可选模型（wire 与字段严格按 api-manual/3d-series 各页 schema；
//    计价按 docs/incremental-models/2026-07-round2-final-v2.json）──
// 每模型的 input 字段集各不相同，提交时按 fields 白名单裁剪，绝不跨模型透传。
export const POYO_3D_MODELS: Record<string, { wire: string; label: string; costLabel: string; fields: ReadonlySet<string> }> = {
  tripo_h31: {
    wire: "tripo3d-h3.1-image-to-3d", label: "Tripo3D H3.1（高细节·默认）",
    costLabel: "无纹理30/标准45/HD 60 cr",
    fields: new Set(["texture", "pbr", "texture_quality", "geometry_quality", "quad", "face_limit"]),
  },
  tripo_p1: {
    wire: "tripo3d-p1-image-to-3d", label: "Tripo3D P1（低多边形）",
    costLabel: "无纹理56/带纹理70 cr",
    fields: new Set(["texture", "face_limit"]),
  },
  meshy_6: {
    wire: "meshy-6-image-to-3d", label: "Meshy 6",
    costLabel: "60 cr",
    // meshy 用 should_texture/enable_pbr/target_polycount/topology，由 builder 从通用 opts 映射
    fields: new Set(["should_texture", "enable_pbr", "target_polycount", "topology"]),
  },
  hunyuan_rapid: {
    wire: "hunyuan-3d/v3.1/rapid/image-to-3d", label: "混元 3D v3.1 Rapid",
    costLabel: "36-60 cr",
    fields: new Set(["enable_pbr"]),
  },
  hunyuan_pro: {
    wire: "hunyuan-3d/v3.1/pro/image-to-3d", label: "混元 3D v3.1 Pro",
    costLabel: "36-60 cr（+PBR 24）",
    fields: new Set(["enable_pbr", "face_count"]),
  },
};
export type Poyo3DModelKey = keyof typeof POYO_3D_MODELS;

export interface SubmitPoyo3DOpts {
  imageUrl: string;
  /** #151：可选云端 3D 模型（默认 tripo_h31，保持历史行为不变）。 */
  model3d?: string;
  /** 是否生成纹理（默认 true）。false = 无纹理，最省 credits。 */
  texture?: boolean;
  /** 纹理精度：standard(默认) / detailed。 */
  textureQuality?: "standard" | "detailed";
  /** 几何精度：standard(默认) / detailed（detailed 额外 +30 credits）。 */
  geometryQuality?: "standard" | "detailed";
  /** 四边面网格拓扑（+7.5 credits）。默认 false。 */
  quad?: boolean;
  /** PBR 材质（需 texture=true）。 */
  pbr?: boolean;
  /** 目标面数 1000–2000000。 */
  faceLimit?: number;
}

export interface SubmitPoyo3DResult { externalTaskId: string; }

/** 提交图生 3D 任务，返回 Poyo task_id。 */
export async function submitPoyoImageTo3D(opts: SubmitPoyo3DOpts): Promise<SubmitPoyo3DResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");
  const raw = opts.imageUrl?.trim();
  if (!raw) throw new Error("图生 3D 需要一张输入图片");
  // Poyo 从上游抓取图片，相对路径 /manus-storage/{key} 它那边解析不到 → 先转绝对预签名 URL。
  const absUrl = await resolveToAbsoluteUrl(raw);

  const spec = POYO_3D_MODELS[opts.model3d ?? "tripo_h31"] ?? POYO_3D_MODELS.tripo_h31;
  const F = spec.fields;
  const input: Record<string, unknown> = { image_urls: [absUrl] };
  // 通用 opts → 各模型 schema 字段（仅写入该模型 fields 白名单内的键）。
  if (opts.texture !== undefined) {
    if (F.has("texture")) input.texture = opts.texture;
    if (F.has("should_texture")) input.should_texture = opts.texture; // meshy 语义等价
  }
  if (opts.pbr !== undefined) {
    if (F.has("pbr")) input.pbr = opts.pbr;
    if (F.has("enable_pbr")) input.enable_pbr = opts.pbr;
  }
  if (opts.textureQuality && F.has("texture_quality")) input.texture_quality = opts.textureQuality;
  if (opts.geometryQuality && F.has("geometry_quality")) input.geometry_quality = opts.geometryQuality;
  if (opts.quad !== undefined) {
    if (F.has("quad")) input.quad = opts.quad;
    if (F.has("topology")) input.topology = opts.quad ? "quad" : "triangle"; // meshy 拓扑
  }
  if (typeof opts.faceLimit === "number" && Number.isFinite(opts.faceLimit)) {
    const n = Math.trunc(opts.faceLimit);
    if (F.has("face_limit")) input.face_limit = Math.max(1000, Math.min(2_000_000, n));
    if (F.has("target_polycount")) input.target_polycount = Math.max(1000, Math.min(2_000_000, n));
    if (F.has("face_count")) input.face_count = Math.max(40_000, Math.min(1_500_000, n)); // hunyuan pro 范围
  }

  const res = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.poyoApiKey}` },
    body: JSON.stringify({ model: spec.wire, input }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Poyo 3D submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  const externalTaskId = data.data?.task_id;
  if (externalTaskId) return { externalTaskId };
  const isErrorCode = data.code !== undefined && data.code !== 0 && data.code !== 200;
  if (isErrorCode) throw new Error(`Poyo 3D submit error (code ${data.code}): ${data.message ?? JSON.stringify(data)}`);
  throw new Error("Poyo 3D submit: no task_id returned");
}

export interface Poyo3DFile {
  file_url?: string;
  file_type?: string;
  label?: string;
  format?: string;
}

export interface Poyo3DStatus {
  status: "not_started" | "running" | "finished" | "failed";
  progress?: number;
  glbUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
}

// 与 poyoVideo/poyoAudio 同款：只有明确「在途」的状态继续轮询，其余（failed/cancelled/expired/
// timeout/未知）一律判 failed 立即收敛，避免对未知状态永久轮询、永不失败。
const IN_PROGRESS = new Set(["not_started", "queued", "pending", "processing", "running", "submitted", "in_progress", "started"]);

/** 纯函数：从 files[] 里挑出 glb 模型直链与缩略图。供单测与 status 复用。 */
export function pickGlb(files: Poyo3DFile[] | undefined): { glbUrl?: string; thumbnailUrl?: string } {
  if (!Array.isArray(files)) return {};
  const isGlb = (f: Poyo3DFile) =>
    f.label === "model_glb" ||
    (typeof f.format === "string" && f.format.toLowerCase() === "glb") ||
    (typeof f.file_url === "string" && /\.glb(?:$|\?)/i.test(f.file_url));
  const isThumb = (f: Poyo3DFile) =>
    f.label === "thumbnail" ||
    (typeof f.file_type === "string" && f.file_type.toLowerCase() === "image") ||
    (typeof f.file_url === "string" && /\.(png|jpe?g|webp)(?:$|\?)/i.test(f.file_url));
  const glb = files.find(isGlb)?.file_url;
  const thumb = files.find(isThumb)?.file_url;
  return { glbUrl: typeof glb === "string" ? glb : undefined, thumbnailUrl: typeof thumb === "string" ? thumb : undefined };
}

/** 纯函数：把原始 Poyo status body 归一化为 Poyo3DStatus。供单测复用。 */
export function parse3DStatus(body: {
  code?: number; message?: string;
  data?: { status?: string; progress?: number; files?: Poyo3DFile[]; error_message?: string };
}): Poyo3DStatus {
  if (body.code !== undefined && body.code !== 0 && body.code !== 200) {
    throw new Error(`Poyo 3D status error (code ${body.code}): ${body.message ?? JSON.stringify(body)}`);
  }
  const d = body.data ?? {};
  const raw = d.status ?? "";
  const status: Poyo3DStatus["status"] =
    raw === "finished" ? "finished" : IN_PROGRESS.has(raw) ? "running" : "failed";
  const { glbUrl, thumbnailUrl } = pickGlb(d.files);
  return { status, progress: d.progress, glbUrl, thumbnailUrl, errorMessage: d.error_message };
}

/** 查询任务状态；finished 时含 glbUrl（上游 24h 直链，调用方负责转存）。 */
export async function checkPoyo3DStatus(externalTaskId: string): Promise<Poyo3DStatus> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");
  const res = await fetch(`${POYO_BASE}/api/generate/status/${externalTaskId}`, {
    headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Poyo 3D status check failed (${res.status})`);
  const body = await res.json();
  const parsed = parse3DStatus(body as Parameters<typeof parse3DStatus>[0]);
  if (parsed.status === "failed" && (body?.data?.status ?? "") !== "failed") {
    console.warn(`[checkPoyo3DStatus] Non-progress status "${body?.data?.status}" for task ${externalTaskId}; treating as failed`);
  }
  return parsed;
}

// ── glb 转存到自有存储（上游 24h 直链会失效，落库前必须转存）──────────────────────
const MAX_GLB_BYTES = 200 * 1024 * 1024; // 200 MB 上限（glb 通常远小于此）
const _inflight = new Map<string, Promise<string>>();

function capStream(src: Readable, maxBytes: number): Readable {
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) { cb(new Error(`stream exceeded ${maxBytes} bytes`)); return; }
      cb(null, chunk);
    },
  });
  src.on("error", (e) => counter.destroy(e));
  return src.pipe(counter);
}

/** 转存 glb 到自有 S3/MinIO，返回自有 URL；任何失败回退上游 URL（至少 24h 内可用）。 */
export async function persist3DModelOrFallback(upstreamUrl: string): Promise<string> {
  const existing = _inflight.get(upstreamUrl);
  if (existing) return existing;
  const p = persist3DImpl(upstreamUrl).finally(() => _inflight.delete(upstreamUrl));
  _inflight.set(upstreamUrl, p);
  return p;
}

async function persist3DImpl(upstreamUrl: string): Promise<string> {
  if (storageBackend() !== "s3") return upstreamUrl; // 非 S3 后端不转存，保留上游直链
  try {
    assertPublicUrl(upstreamUrl);
    const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(120_000) });
    if (res.url) assertPublicUrl(res.url);
    if (!res.ok || !res.body) return upstreamUrl;
    const declared = res.headers.get("content-length");
    if (declared) { const n = parseInt(declared, 10); if (!isNaN(n) && n > MAX_GLB_BYTES) return upstreamUrl; }
    const src = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    const { url } = await storagePutStream(
      `generated-3d/tripo3d-${Date.now()}.glb`,
      capStream(src, MAX_GLB_BYTES),
      "model/gltf-binary",
    );
    return url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[persist3DModel] persist failed, keeping upstream URL: ${msg.slice(0, 200)}`);
    return upstreamUrl;
  }
}
