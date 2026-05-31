// ComfyUI integration — calls a self-hosted ComfyUI server with built-in workflow templates.
//
// Design notes:
// - This module intentionally does NOT call guardUrl()/assertSafeUrl(): ComfyUI servers
//   are typically internal/private and the project owner explicitly decided to allow them.
//   We still validate the URL is well-formed http(s) to reject data:/javascript:/etc.
// - Output is downloaded and re-uploaded into our own storage (storagePut) so the URL
//   remains stable even if ComfyUI's local file is cleaned up.
// - 4 built-in templates: txt2img / img2img / animatediff / svd.

import type { Server as SocketIOServer } from "socket.io";
import { storagePut, resolveToAbsoluteUrl } from "server/storage";
import { assertSafeUrl } from "./videoEditor";
import type { WorkflowParamBinding } from "@shared/types";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS_IMAGE = 100; // ~5 min
const POLL_MAX_ATTEMPTS_VIDEO = 200; // ~10 min — video workflows are slower
// Hard size caps on anything we suck into RAM via arrayBuffer().
// A misbehaving / malicious ComfyUI server could otherwise OOM the Node process.
const MAX_COMFY_OUTPUT_BYTES = 200 * 1024 * 1024; // 200 MB — generous for 10s video
const MAX_REF_IMAGE_BYTES = 30 * 1024 * 1024;     // 30 MB — sane upper bound for source image

// ── Socket.IO injection ───────────────────────────────────────────────────────

let _io: SocketIOServer | null = null;
export function setComfySocketIO(io: SocketIOServer): void { _io = io; }

// ── URL validation ────────────────────────────────────────────────────────────

function normalizeBaseUrl(raw: string): string {
  // Length cap — anything beyond 2048 chars is hostile input, not a real URL.
  if (raw.length > 2048) {
    throw new Error("ComfyUI URL 过长（最大 2048 字符）");
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ComfyUI URL 协议必须是 http 或 https，当前为 ${url.protocol}`);
  }
  // Reject userinfo (`user:pass@host`) — fetch would otherwise leak credentials
  // as Basic Auth to whatever host the user typed. Internal ComfyUI servers
  // should not require credentials; if they do, use a reverse proxy with token auth.
  if (url.username || url.password) {
    throw new Error("ComfyUI URL 不允许包含用户名/密码（user:pass@host）");
  }
  // Strip trailing slash for consistent path joining.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

// ── Interrupt ──────────────────────────────────────────────────────────────────

/** Ask ComfyUI to interrupt the currently-running prompt (POST /interrupt). */
export async function interruptComfy(rawBaseUrl: string): Promise<void> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const res = await fetch(`${baseUrl}/interrupt`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  // ComfyUI returns 200 with empty body; tolerate any 2xx.
  if (!res.ok) {
    throw new Error(`ComfyUI 中断失败 (${res.status})`);
  }
}

// ── Workflow templates ────────────────────────────────────────────────────────
//
// Templates use placeholder tokens like "__seed__", "__steps__" that we replace
// before submission. Numeric placeholders are quoted in JSON so we replace
// `"__seed__"` (with quotes) and inject the raw number — this preserves JSON validity.

// txt2img / img2img graphs are built programmatically — see buildImageWorkflow.

const ANIMATEDIFF_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "__sampler__", scheduler: "__scheduler__", denoise: "__denoise__", model: ["12", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__ckpt__" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: "__frames__" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "12": { class_type: "ADE_AnimateDiffLoaderGen1", inputs: { model_name: "__motionModule__", beta_schedule: "autoselect", model: ["4", 0] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_animatediff", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
};

const SVD_TEMPLATE = {
  "3": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "__sampler__", scheduler: "__scheduler__", denoise: "__denoise__", model: ["15", 0], positive: ["12", 0], negative: ["12", 1], latent_image: ["12", 2] } },
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
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  vae?: string;
  batchSize?: number;
}

function applyTemplate(template: unknown, subs: SubstitutionMap): unknown {
  // Walk the deep-cloned template tree and replace any string value that exactly
  // matches a placeholder with the corresponding substitution. This avoids the
  // string-replace-on-stringified-JSON approach which is unsafe when user-supplied
  // values (prompt / ckpt name) happen to contain placeholder tokens or characters
  // that break JSON parsing.
  const numeric: Record<string, number> = {
    __seed__: subs.seed ?? Math.floor(Math.random() * 2_147_483_647),
    __steps__: subs.steps ?? 20,
    __cfg__: subs.cfg ?? 7,
    __width__: subs.width ?? 512,
    __height__: subs.height ?? 512,
    __frames__: subs.frames ?? 16,
    __fps__: subs.fps ?? 8,
    __denoise__: subs.denoise ?? 1.0,
    __batchSize__: subs.batchSize ?? 1,
  };
  const stringy: Record<string, string> = {
    __ckpt__: subs.ckpt ?? "",
    __prompt__: subs.prompt ?? "",
    __negPrompt__: subs.negPrompt ?? "",
    __refImageName__: subs.refImageName ?? "",
    __motionModule__: subs.motionModule ?? "",
    __sampler__: subs.sampler ?? "euler",
    __scheduler__: subs.scheduler ?? "normal",
    __vae__: subs.vae ?? "",
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      // Only exact-match placeholders get substituted — user values are never
      // interpreted as placeholders even if they happen to equal a token.
      if (Object.prototype.hasOwnProperty.call(numeric, node)) return numeric[node];
      if (Object.prototype.hasOwnProperty.call(stringy, node)) return stringy[node];
      return node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  // Deep-clone via JSON round-trip first to avoid mutating the template constant,
  // then walk to substitute.
  return walk(JSON.parse(JSON.stringify(template)));
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

// Combine a per-request timeout with an optional external abort signal (used by
// the stress-test "立即停止" path to cancel in-flight fetches immediately).
function withTimeout(timeoutMs: number, external?: AbortSignal): AbortSignal {
  return external ? AbortSignal.any([AbortSignal.timeout(timeoutMs), external]) : AbortSignal.timeout(timeoutMs);
}

// Sleep that rejects immediately when the external signal aborts, instead of
// waiting out the full poll interval.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

async function submitWorkflow(baseUrl: string, workflow: unknown, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    signal: withTimeout(30_000, signal),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI 提交工作流失败 (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as PromptSubmitResponse;
  if (!data.prompt_id) throw new Error("ComfyUI 未返回 prompt_id");
  return data.prompt_id;
}

async function pollHistory(baseUrl: string, promptId: string, maxAttempts: number, signal?: AbortSignal): Promise<HistoryEntry> {
  // Early exit when the server keeps refusing connections (down / unreachable) —
  // bail after 5 consecutive transient failures (~15s) instead of waiting the full
  // 5/10-minute timeout.
  const MAX_CONSECUTIVE_NET_ERRORS = 5;
  let consecutiveNetErrors = 0;
  for (let i = 0; i < maxAttempts; i++) {
    await abortableSleep(POLL_INTERVAL_MS, signal);
    try {
      const res = await fetch(`${baseUrl}/history/${promptId}`, {
        signal: withTimeout(10_000, signal),
      });
      if (!res.ok) {
        if (res.status === 404 || res.status >= 500) {
          consecutiveNetErrors++;
          if (consecutiveNetErrors >= MAX_CONSECUTIVE_NET_ERRORS) {
            throw new Error(`ComfyUI 服务器持续无响应 (HTTP ${res.status} × ${consecutiveNetErrors} 次)`);
          }
          continue;
        }
        throw new Error(`ComfyUI 状态查询失败 (${res.status})`);
      }
      consecutiveNetErrors = 0;
      const data = (await res.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry && entry.status?.completed) return entry;
      if (entry?.status?.status_str === "error") {
        throw new Error(`ComfyUI 执行失败: ${JSON.stringify(entry.status.messages ?? []).slice(0, 500)}`);
      }
    } catch (err) {
      // External abort (立即停止) — propagate immediately, don't treat as a retryable net error.
      // Gated on `signal` being present so original node callers (signal === undefined) are
      // provably unaffected: their AbortSignal.timeout fires a TimeoutError, which must keep
      // flowing into the consecutiveNetErrors retry path exactly as before.
      if (signal && (signal.aborted || (err instanceof Error && err.name === "AbortError"))) throw new Error("已停止");
      if (err instanceof Error && (err.message.startsWith("ComfyUI 执行失败") || err.message.startsWith("ComfyUI 服务器持续无响应"))) throw err;
      consecutiveNetErrors++;
      if (consecutiveNetErrors >= MAX_CONSECUTIVE_NET_ERRORS) {
        throw new Error(`ComfyUI 服务器不可达 (连续 ${consecutiveNetErrors} 次连接失败): ${err instanceof Error ? err.message : String(err)}`);
      }
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

/** Pre-flight Content-Length check + STREAMING read with running byte-count cap.
 * Protects against a malicious server using chunked transfer (no Content-Length)
 * to stream multi-GB responses that arrayBuffer() would happily swallow into RAM. */
async function fetchWithSizeLimit(url: string, maxBytes: number, timeoutMs: number, label: string): Promise<{ buf: Buffer; contentType: string | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${label} 失败 (${res.status})`);
  const contentType = res.headers.get("content-type");
  const declared = res.headers.get("content-length");
  if (declared) {
    const n = parseInt(declared, 10);
    if (!isNaN(n) && n > maxBytes) {
      throw new Error(`${label} 文件过大 (${n} bytes，上限 ${maxBytes} bytes)`);
    }
  }
  // Stream the body, aborting the reader the instant we cross the byte cap.
  // This protects against chunked / no-Content-Length responses that could
  // otherwise bypass the pre-flight check.
  if (!res.body) throw new Error(`${label} 失败：响应无 body`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} 文件过大（流式累计超过 ${maxBytes} bytes 时已中断）`);
      }
      chunks.push(value);
    }
  } finally {
    // Ensure the reader is released even on error paths.
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { buf, contentType };
}

async function downloadAndStore(downloadUrlStr: string, ext: string, mimeType: string): Promise<{ url: string; key: string }> {
  const { buf, contentType } = await fetchWithSizeLimit(downloadUrlStr, MAX_COMFY_OUTPUT_BYTES, 120_000, "下载 ComfyUI 输出");
  const ct = contentType ?? mimeType;
  return await storagePut(`comfyui/${Date.now()}.${ext}`, buf, ct);
}

// ── Image upload (for img2img / SVD) ──────────────────────────────────────────

async function uploadImageToComfy(baseUrl: string, sourceUrl: string): Promise<string> {
  // SSRF protection: the source URL is user-supplied (referenceImageUrl).
  // Accept either absolute http(s) URLs (subject to assertSafeUrl) or our own
  // storage proxy paths (must start with `/manus-storage/` — trusted prefix).
  // Reject everything else including relative paths that could be re-resolved.
  let fetchUrl = sourceUrl;
  if (/^https?:\/\//i.test(sourceUrl)) {
    assertSafeUrl(sourceUrl);
  } else if (sourceUrl.startsWith("/manus-storage/")) {
    // node fetch() can't parse a relative path ("Failed to parse URL from
    // /manus-storage/…"). Resolve our trusted internal storage path to an
    // absolute (presigned) URL the app server can fetch — same as the
    // Poyo/Higgsfield reference-image handling. assertSafeUrl is intentionally
    // skipped: this is our own storage, whose host may legitimately be internal.
    fetchUrl = await resolveToAbsoluteUrl(sourceUrl);
  } else {
    throw new Error("参考图 URL 协议不受支持，仅允许 http/https 或 /manus-storage/ 相对路径");
  }
  const { buf, contentType } = await fetchWithSizeLimit(fetchUrl, MAX_REF_IMAGE_BYTES, 60_000, "下载参考图");
  const ct = contentType ?? "image/png";
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

// ── WebSocket progress subscription ──────────────────────────────────────────

interface ComfyProgressEvent {
  type: "progress" | "executing" | "executed" | "error";
  value?: number;
  max?: number;
  nodeId?: string;
  errorMessage?: string;
}

/** Connect to ComfyUI WS and relay progress events via callback until the job finishes. */
export function subscribeComfyProgress(
  baseUrl: string,
  promptId: string,
  callback: (event: ComfyProgressEvent) => void,
  timeoutMs = 600_000,
): Promise<void> {
  return new Promise((resolve) => {
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws?clientId=" + encodeURIComponent("cc_" + promptId.slice(0, 8));
    let settled = false;
    const done = () => {
      if (!settled) { settled = true; resolve(); }
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      done();
      return;
    }

    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } done(); }, timeoutMs);

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()) as {
          type: string;
          data?: Record<string, unknown>;
        };
        if (msg.data?.prompt_id && msg.data.prompt_id !== promptId) return;

        if (msg.type === "progress") {
          callback({
            type: "progress",
            value: msg.data?.value as number | undefined,
            max: msg.data?.max as number | undefined,
          });
        } else if (msg.type === "executing") {
          callback({ type: "executing", nodeId: msg.data?.node as string | undefined });
          if (msg.data?.node === null) {
            // null node = queue finished for this prompt
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            done();
          }
        } else if (msg.type === "executed") {
          callback({ type: "executed", nodeId: msg.data?.node as string | undefined });
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          done();
        } else if (msg.type === "execution_error") {
          callback({ type: "error", errorMessage: msg.data?.exception_message as string | undefined });
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          done();
        }
      } catch { /* malformed message */ }
    });

    ws.addEventListener("error", () => { clearTimeout(timer); done(); });
    ws.addEventListener("close", () => { clearTimeout(timer); done(); });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LoraSpec {
  name: string;
  strengthModel: number;
  strengthClip?: number;
}

export interface ControlNetSpec {
  model: string;
  imageName: string;       // already-uploaded ComfyUI image filename
  strength: number;
  startPercent?: number;
  endPercent?: number;
}

interface BuildImageWorkflowArgs {
  template: "txt2img" | "img2img";
  prompt: string;
  negPrompt: string;
  ckpt: string;
  loras: LoraSpec[];
  vae?: string;            // VAELoader name; empty = use checkpoint's VAE
  controlnet?: ControlNetSpec;
  refImageName?: string;   // img2img reference image filename
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  width: number;
  height: number;
  batchSize: number;
}

type NodeRef = [string, number];

/**
 * Build a ComfyUI prompt graph for txt2img / img2img programmatically so we can
 * inject a variable number of LoRA loaders, an optional ControlNet chain, and an
 * optional standalone VAE — none of which a static placeholder template can do.
 *
 * Graph shape:
 *   Checkpoint(4) ──model/clip──▶ [LoraLoader chain] ──▶ KSampler(3) + CLIP encodes(6/7)
 *   (optional) VAELoader(20) feeds VAEDecode/VAEEncode instead of checkpoint VAE
 *   (optional) ControlNet: Loader(30)+Image(31) ──▶ ControlNetApplyAdvanced(32)
 *              rewrites KSampler positive/negative conditioning
 */
export function buildImageWorkflow(a: BuildImageWorkflowArgs): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const wf: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};

  wf["4"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } };

  // VAE source: dedicated loader when provided, else the checkpoint's third output.
  let vaeRef: NodeRef = ["4", 2];
  if (a.vae && a.vae.trim()) {
    wf["20"] = { class_type: "VAELoader", inputs: { vae_name: a.vae.trim() } };
    vaeRef = ["20", 0];
  }

  // LoRA chain: each loader threads model+clip through, so they stack in order.
  let modelRef: NodeRef = ["4", 0];
  let clipRef: NodeRef = ["4", 1];
  a.loras.forEach((l, i) => {
    const nid = `lora_${i}`;
    wf[nid] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: l.name,
        strength_model: l.strengthModel,
        strength_clip: l.strengthClip ?? l.strengthModel,
        model: modelRef,
        clip: clipRef,
      },
    };
    modelRef = [nid, 0];
    clipRef = [nid, 1];
  });

  wf["6"] = { class_type: "CLIPTextEncode", inputs: { text: a.prompt, clip: clipRef } };
  wf["7"] = { class_type: "CLIPTextEncode", inputs: { text: a.negPrompt, clip: clipRef } };

  // Conditioning may be rewritten by ControlNet below.
  let positiveRef: NodeRef = ["6", 0];
  let negativeRef: NodeRef = ["7", 0];
  if (a.controlnet && a.controlnet.model.trim() && a.controlnet.imageName) {
    wf["30"] = { class_type: "ControlNetLoader", inputs: { control_net_name: a.controlnet.model.trim() } };
    wf["31"] = { class_type: "LoadImage", inputs: { image: a.controlnet.imageName } };
    wf["32"] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: positiveRef,
        negative: negativeRef,
        control_net: ["30", 0],
        image: ["31", 0],
        strength: a.controlnet.strength,
        start_percent: a.controlnet.startPercent ?? 0,
        end_percent: a.controlnet.endPercent ?? 1,
      },
    };
    positiveRef = ["32", 0];
    negativeRef = ["32", 1];
  }

  // Latent source: empty latent (txt2img) or VAE-encoded reference (img2img).
  let latentRef: NodeRef;
  if (a.template === "img2img") {
    wf["11"] = { class_type: "LoadImage", inputs: { image: a.refImageName ?? "" } };
    wf["10"] = { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: vaeRef } };
    latentRef = ["10", 0];
  } else {
    wf["5"] = { class_type: "EmptyLatentImage", inputs: { width: a.width, height: a.height, batch_size: a.batchSize } };
    latentRef = ["5", 0];
  }

  wf["3"] = {
    class_type: "KSampler",
    inputs: {
      seed: a.seed, steps: a.steps, cfg: a.cfg,
      sampler_name: a.sampler, scheduler: a.scheduler, denoise: a.denoise,
      model: modelRef, positive: positiveRef, negative: negativeRef, latent_image: latentRef,
    },
  };
  wf["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: vaeRef } };
  wf["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "comfyui_output", images: ["8", 0] } };

  return wf;
}

export interface GenerateComfyImageOptions {
  workflowTemplate: "txt2img" | "img2img";
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  // Single-LoRA fields kept for backward compatibility; `loras` takes precedence.
  lora?: string;
  loraStrength?: number;
  loras?: LoraSpec[];
  controlnet?: { model: string; imageUrl: string; strength?: number; startPercent?: number; endPercent?: number };
  steps?: number;
  cfg?: number;
  seed?: number;
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  vae?: string;
  batchSize?: number;
  referenceImageUrl?: string;
  // Progress relay (optional)
  projectId?: number;
  nodeId?: string;
}

export async function generateComfyImage(rawBaseUrl: string, options: GenerateComfyImageOptions): Promise<{ url: string; urls: string[] }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  let refImageName: string | undefined;
  if (options.workflowTemplate === "img2img") {
    if (!options.referenceImageUrl) throw new Error("img2img 模板需要参考图");
    refImageName = await uploadImageToComfy(baseUrl, options.referenceImageUrl);
  }

  // Normalize LoRA input: prefer the multi-LoRA array, fall back to the legacy
  // single lora/loraStrength pair, and drop entries without a name.
  const loras: LoraSpec[] = (options.loras && options.loras.length > 0)
    ? options.loras
    : (options.lora && options.lora.trim() ? [{ name: options.lora.trim(), strengthModel: options.loraStrength ?? 1.0 }] : []);
  const cleanLoras = loras.filter((l) => l.name && l.name.trim());

  // Upload the ControlNet guide image (if any) the same way as the img2img ref.
  let controlnet: ControlNetSpec | undefined;
  if (options.controlnet && options.controlnet.model.trim() && options.controlnet.imageUrl) {
    const cnImageName = await uploadImageToComfy(baseUrl, options.controlnet.imageUrl);
    controlnet = {
      model: options.controlnet.model.trim(),
      imageName: cnImageName,
      strength: options.controlnet.strength ?? 1.0,
      startPercent: options.controlnet.startPercent ?? 0,
      endPercent: options.controlnet.endPercent ?? 1,
    };
  }

  const workflow = buildImageWorkflow({
    template: options.workflowTemplate,
    prompt: options.prompt ?? "",
    negPrompt: options.negPrompt ?? "",
    ckpt: options.ckpt,
    loras: cleanLoras,
    vae: options.vae,
    controlnet,
    refImageName,
    seed: options.seed ?? Math.floor(Math.random() * 2_147_483_647),
    steps: options.steps ?? 20,
    cfg: options.cfg ?? 7,
    sampler: options.sampler ?? "euler",
    scheduler: options.scheduler ?? "normal",
    // img2img needs denoise < 1.0 to retain the reference image; 0.75 is the practical default
    denoise: options.workflowTemplate === "img2img" ? (options.denoise ?? 0.75) : (options.denoise ?? 1.0),
    width: options.width ?? 512,
    height: options.height ?? 512,
    batchSize: options.batchSize ?? 1,
  });

  const promptId = await submitWorkflow(baseUrl, workflow);

  // Fire-and-forget progress relay
  if (options.projectId != null && options.nodeId != null && _io != null) {
    const projectId = options.projectId;
    const nodeId = options.nodeId;
    subscribeComfyProgress(baseUrl, promptId, (ev) => {
      if (ev.type === "progress" && ev.value != null && ev.max != null) {
        _io?.to(`project:${projectId}`).emit("comfyui:progress", { nodeId, type: "progress", value: ev.value, max: ev.max });
      }
    }).catch(() => { /* progress is best-effort */ });
  }

  const entry = await pollHistory(baseUrl, promptId, POLL_MAX_ATTEMPTS_IMAGE);

  // Collect all SaveImage outputs (supports batchSize > 1)
  const urls: string[] = [];
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    for (const img of nodeOutput.images ?? []) {
      const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
      const stored = await downloadAndStore(dlUrl, "png", "image/png");
      urls.push(stored.url);
    }
  }
  if (urls.length === 0) throw new Error("ComfyUI 任务完成但未返回图像输出");
  return { url: urls[0], urls };
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
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  vae?: string;
  batchSize?: number;
  referenceImageUrl?: string;
  // Progress relay (optional)
  projectId?: number;
  nodeId?: string;
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
    sampler: options.sampler,
    // SVD requires karras scheduler to produce coherent frames; "normal" causes artifacts.
    // Use || (not ??) so that an empty string also falls back to "karras".
    scheduler: options.workflowTemplate === "svd" ? (options.scheduler || "karras") : options.scheduler,
    denoise: options.denoise,
    vae: options.vae,
    refImageName,
  });

  const promptId = await submitWorkflow(baseUrl, workflow);

  // Fire-and-forget progress relay
  if (options.projectId != null && options.nodeId != null && _io != null) {
    const projectId = options.projectId;
    const nodeId = options.nodeId;
    subscribeComfyProgress(baseUrl, promptId, (ev) => {
      if (ev.type === "progress" && ev.value != null && ev.max != null) {
        _io?.to(`project:${projectId}`).emit("comfyui:progress", { nodeId, type: "progress", value: ev.value, max: ev.max });
      }
    }).catch(() => { /* progress is best-effort */ });
  }

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
    if (img && /\.(mp4|webm|gif|webp)$/i.test(img.filename)) {
      const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
      const ext = img.filename.split(".").pop() || "mp4";
      const stored = await downloadAndStore(dlUrl, ext, "video/mp4");
      return { url: stored.url };
    }
  }
  throw new Error("ComfyUI 任务完成但未返回视频输出");
}

// ── Workflow analysis ─────────────────────────────────────────────────────────

// Known node types that mark video outputs
const VIDEO_OUTPUT_CLASS_TYPES = new Set(["VHS_VideoCombine", "SaveAnimatedWEBP", "SaveAnimatedPNG"]);
// Known node types that mark image outputs
const IMAGE_OUTPUT_CLASS_TYPES = new Set(["SaveImage", "PreviewImage"]);

type WorkflowJson = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export async function analyzeWorkflow(
  workflowJson: string,
  rawBaseUrl?: string,
): Promise<{ detectedParams: WorkflowParamBinding[]; outputNodeIds: string[]; outputType: "image" | "video" | "mixed" }> {
  let workflow: WorkflowJson;
  try {
    workflow = JSON.parse(workflowJson) as WorkflowJson;
  } catch {
    throw new Error("Workflow JSON 格式错误，无法解析");
  }
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Workflow JSON 结构无效：应为 { 节点ID: {...} } 的对象（ComfyUI API 格式，非 UI 导出格式）");
  }

  // Optionally fetch object_info to get enum options (best-effort)
  let info: ObjectInfo = {};
  if (rawBaseUrl) {
    try {
      const baseUrl = normalizeBaseUrl(rawBaseUrl);
      const res = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) info = (await res.json()) as ObjectInfo;
    } catch { /* ignore — we'll fall back to empty options */ }
  }

  const detectedParams: WorkflowParamBinding[] = [];
  const outputNodeIds: string[] = [];
  let hasImage = false;
  let hasVideo = false;

  // Pre-scan: identify which CLIPTextEncode nodes are wired to KSampler's negative input.
  // Walk the conditioning graph recursively so that intermediate nodes such as
  // ConditioningCombine / ConditioningSetMask are transparent. Also accepts numeric
  // node IDs (some exporters emit [7,0] rather than ["7",0]).
  const COND_PASSTHROUGH = new Set([
    "ConditioningCombine", "ConditioningConcat", "ConditioningSetMask",
    "ConditioningSetTimestepRange", "ConditioningSetArea", "ConditioningSetAreaPercentage",
    "ConditioningZeroOut", "ConditioningAverage",
  ]);
  const negativeClipNodeIds = new Set<string>();
  function collectNegClip(nodeId: string, visited: Set<string>): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const n = (workflow as Record<string, unknown>)[nodeId] as Record<string, unknown> | undefined;
    if (!n?.class_type) return;
    if (n.class_type === "CLIPTextEncode") { negativeClipNodeIds.add(nodeId); return; }
    if (!COND_PASSTHROUGH.has(n.class_type as string)) return;
    for (const v of Object.values((n.inputs as Record<string, unknown>) ?? {})) {
      if (Array.isArray(v) && v[0] != null) collectNegClip(String(v[0]), visited);
    }
  }
  // Samplers/guiders that expose a direct `negative` conditioning input:
  //   KSampler / KSamplerAdvanced  — standard sampling
  //   CFGGuider / DualCFGGuider    — paired with SamplerCustomAdvanced
  //   SamplerCustom                — direct positive/negative on the sampler itself
  const NEG_INPUT_SAMPLERS = new Set([
    "KSampler", "KSamplerAdvanced", "CFGGuider", "DualCFGGuider", "SamplerCustom",
  ]);
  for (const [, n] of Object.entries(workflow)) {
    if (typeof n !== "object" || !n.class_type) continue;
    if (NEG_INPUT_SAMPLERS.has(n.class_type as string)) {
      const negRef = (n.inputs ?? {}).negative;
      if (Array.isArray(negRef) && negRef[0] != null) collectNegClip(String(negRef[0]), new Set());
    }
  }

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (typeof node !== "object" || !node.class_type) continue;
    const ct = node.class_type;
    const inputs = node.inputs ?? {};

    if (ct === "CLIPTextEncode") {
      const isPositive = !negativeClipNodeIds.has(nodeId);
      detectedParams.push({
        nodeId, fieldPath: "inputs.text",
        label: isPositive ? "提示词" : "负向提示词",
        type: "text",
        defaultValue: inputs.text ?? "",
      });
    } else if (ct === "KSampler" || ct === "KSamplerAdvanced") {
      const ksamplerSamplers = pickFirstArray(info, "KSampler", "sampler_name");
      const ksamplerSchedulers = pickFirstArray(info, "KSampler", "scheduler");
      detectedParams.push(
        { nodeId, fieldPath: "inputs.seed", label: "随机种子", type: "number", defaultValue: inputs.seed ?? -1, min: -1, max: 2147483647, step: 1 },
        { nodeId, fieldPath: "inputs.steps", label: "步数", type: "number", defaultValue: inputs.steps ?? 20, min: 1, max: 150, step: 1 },
        { nodeId, fieldPath: "inputs.cfg", label: "CFG Scale", type: "number", defaultValue: inputs.cfg ?? 7, min: 1, max: 30, step: 0.5 },
        { nodeId, fieldPath: "inputs.denoise", label: "Denoise", type: "number", defaultValue: inputs.denoise ?? 1.0, min: 0, max: 1, step: 0.01 },
        { nodeId, fieldPath: "inputs.sampler_name", label: "采样器", type: ksamplerSamplers.length > 0 ? "select" : "text", defaultValue: inputs.sampler_name ?? "euler", options: ksamplerSamplers.length > 0 ? ksamplerSamplers : undefined },
        { nodeId, fieldPath: "inputs.scheduler", label: "调度器", type: ksamplerSchedulers.length > 0 ? "select" : "text", defaultValue: inputs.scheduler ?? "normal", options: ksamplerSchedulers.length > 0 ? ksamplerSchedulers : undefined },
      );
    } else if (ct === "CheckpointLoaderSimple" || ct === "ImageOnlyCheckpointLoader") {
      const ckpts = Array.from(new Set([
        ...pickFirstArray(info, "CheckpointLoaderSimple", "ckpt_name"),
        ...pickFirstArray(info, "ImageOnlyCheckpointLoader", "ckpt_name"),
      ]));
      detectedParams.push({
        nodeId, fieldPath: "inputs.ckpt_name",
        label: "模型 (Checkpoint)",
        type: ckpts.length > 0 ? "select" : "text",
        defaultValue: inputs.ckpt_name ?? "",
        options: ckpts.length > 0 ? ckpts : undefined,
      });
    } else if (ct === "UNETLoader") {
      const unetModels = pickFirstArray(info, "UNETLoader", "unet_name");
      detectedParams.push({
        nodeId, fieldPath: "inputs.unet_name",
        label: "UNET 模型",
        type: unetModels.length > 0 ? "select" : "text",
        defaultValue: inputs.unet_name ?? "",
        options: unetModels.length > 0 ? unetModels : undefined,
      });
    } else if (ct === "LoraLoader") {
      const loras = pickFirstArray(info, "LoraLoader", "lora_name");
      detectedParams.push(
        { nodeId, fieldPath: "inputs.lora_name", label: "LoRA 模型", type: loras.length > 0 ? "select" : "text", defaultValue: inputs.lora_name ?? "", options: loras.length > 0 ? loras : undefined },
        { nodeId, fieldPath: "inputs.strength_model", label: "LoRA 强度", type: "number", defaultValue: inputs.strength_model ?? 1.0, min: 0, max: 2, step: 0.05 },
      );
    } else if (ct === "LoadImage") {
      detectedParams.push({
        nodeId, fieldPath: "inputs.image",
        label: "输入图像",
        type: "image",
        defaultValue: inputs.image ?? "",
      });
    } else if (ct === "ControlNetLoader" || ct === "DiffControlNetLoader") {
      const nets = pickFirstArray(info, ct, "control_net_name");
      detectedParams.push({ nodeId, fieldPath: "inputs.control_net_name", label: "ControlNet 模型", type: nets.length > 0 ? "select" : "text", defaultValue: inputs.control_net_name ?? "", options: nets.length > 0 ? nets : undefined });
    } else if (ct === "VAELoader") {
      const vaes = pickFirstArray(info, "VAELoader", "vae_name");
      detectedParams.push({ nodeId, fieldPath: "inputs.vae_name", label: "VAE 模型", type: vaes.length > 0 ? "select" : "text", defaultValue: inputs.vae_name ?? "", options: vaes.length > 0 ? vaes : undefined });
    } else if (ct === "UpscaleModelLoader") {
      const ups = pickFirstArray(info, "UpscaleModelLoader", "model_name");
      detectedParams.push({ nodeId, fieldPath: "inputs.model_name", label: "放大模型", type: ups.length > 0 ? "select" : "text", defaultValue: inputs.model_name ?? "", options: ups.length > 0 ? ups : undefined });
    } else if (ct === "IPAdapterModelLoader") {
      const ips = pickFirstArray(info, "IPAdapterModelLoader", "ipadapter_file");
      detectedParams.push({ nodeId, fieldPath: "inputs.ipadapter_file", label: "IPAdapter 模型", type: ips.length > 0 ? "select" : "text", defaultValue: inputs.ipadapter_file ?? "", options: ips.length > 0 ? ips : undefined });
    } else if (ct === "CLIPVisionLoader") {
      const cvs = pickFirstArray(info, "CLIPVisionLoader", "clip_name");
      detectedParams.push({ nodeId, fieldPath: "inputs.clip_name", label: "CLIP Vision", type: cvs.length > 0 ? "select" : "text", defaultValue: inputs.clip_name ?? "", options: cvs.length > 0 ? cvs : undefined });
    } else if (ct === "EmptyLatentImage" || ct === "EmptySD3LatentImage" || ct === "EmptyHunyuanLatentVideo") {
      if ("width" in inputs) detectedParams.push({ nodeId, fieldPath: "inputs.width", label: "宽度", type: "number", defaultValue: inputs.width ?? 512, min: 64, max: 4096, step: 64 });
      if ("height" in inputs) detectedParams.push({ nodeId, fieldPath: "inputs.height", label: "高度", type: "number", defaultValue: inputs.height ?? 512, min: 64, max: 4096, step: 64 });
      if ("batch_size" in inputs) detectedParams.push({ nodeId, fieldPath: "inputs.batch_size", label: "批量数量", type: "number", defaultValue: inputs.batch_size ?? 1, min: 1, max: 16, step: 1 });
    } else if (ct === "VHS_VideoCombine") {
      if ("frame_rate" in inputs) detectedParams.push({ nodeId, fieldPath: "inputs.frame_rate", label: "帧率 (FPS)", type: "number", defaultValue: inputs.frame_rate ?? 8, min: 1, max: 60, step: 1 });
      outputNodeIds.push(nodeId);
      hasVideo = true;
    } else if (IMAGE_OUTPUT_CLASS_TYPES.has(ct)) {
      outputNodeIds.push(nodeId);
      hasImage = true;
    } else if (VIDEO_OUTPUT_CLASS_TYPES.has(ct)) {
      outputNodeIds.push(nodeId);
      hasVideo = true;
    }
  }

  const outputType = hasImage && hasVideo ? "mixed" : hasVideo ? "video" : "image";
  return { detectedParams, outputNodeIds, outputType };
}

// ── Custom workflow execution ─────────────────────────────────────────────────

export interface ExecuteCustomWorkflowOptions {
  workflowJson: string;
  paramValues: Record<string, unknown>;  // key = `${nodeId}.${fieldPath}`, e.g. "3.inputs.seed"
  outputNodeIds?: string[];
  outputType?: "image" | "video" | "auto";
  projectId?: number;
  nodeId?: string;
}

export async function executeCustomWorkflow(
  rawBaseUrl: string,
  options: ExecuteCustomWorkflowOptions,
): Promise<{ urls: string[]; outputType: "image" | "video" }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  let workflow: WorkflowJson;
  try {
    workflow = JSON.parse(options.workflowJson) as WorkflowJson;
  } catch {
    throw new Error("Workflow JSON 格式错误，无法解析");
  }

  // Deep-clone to avoid mutating the caller's object
  workflow = JSON.parse(JSON.stringify(workflow)) as WorkflowJson;

  // Inject paramValues into workflow nodes.
  // Key format: "nodeId.inputs.fieldName" (e.g., "3.inputs.seed")
  // or shorter "nodeId.fieldName" (legacy, treated as "nodeId.inputs.fieldName")
  for (const [key, value] of Object.entries(options.paramValues)) {
    const parts = key.split(".");
    if (parts.length < 2) continue;
    const [wfNodeId, ...pathParts] = parts;
    const node = workflow[wfNodeId];
    if (!node) continue;

    // Normalize: if path starts with "inputs", use it directly; otherwise prepend "inputs"
    const fieldParts = pathParts[0] === "inputs" ? pathParts.slice(1) : pathParts;
    if (fieldParts.length === 0) continue;

    // Handle image type — upload to ComfyUI first
    if (typeof value === "string" && (value.startsWith("http") || value.startsWith("/manus-storage/"))) {
      // Check if this field expects an image (best-effort)
      const binding = options.paramValues;
      void binding; // suppress unused warning
      // We inject the value as-is for non-image fields; for image fields the caller
      // should have already uploaded and stored the ComfyUI filename in paramValues.
    }

    // Walk the path and set the value
    if (fieldParts.length === 1) {
      node.inputs[fieldParts[0]] = value;
    } else {
      let obj: Record<string, unknown> = node.inputs;
      for (let i = 0; i < fieldParts.length - 1; i++) {
        if (obj[fieldParts[i]] == null || typeof obj[fieldParts[i]] !== "object") {
          obj[fieldParts[i]] = {};
        }
        obj = obj[fieldParts[i]] as Record<string, unknown>;
      }
      obj[fieldParts[fieldParts.length - 1]] = value;
    }
  }

  const promptId = await submitWorkflow(baseUrl, workflow);

  // Fire-and-forget progress relay
  if (options.projectId != null && options.nodeId != null && _io != null) {
    const projectId = options.projectId;
    const nodeId = options.nodeId;
    subscribeComfyProgress(baseUrl, promptId, (ev) => {
      if (ev.type === "progress" && ev.value != null && ev.max != null) {
        _io?.to(`project:${projectId}`).emit("comfyui:progress", { nodeId, type: "progress", value: ev.value, max: ev.max });
      }
    }).catch(() => { /* progress is best-effort */ });
  }

  // Use longer poll limit since we don't know the workflow complexity
  const entry = await pollHistory(baseUrl, promptId, POLL_MAX_ATTEMPTS_VIDEO);

  // Determine which output nodes to collect from
  const targetNodeIds = new Set(options.outputNodeIds ?? []);
  const useAll = targetNodeIds.size === 0;

  const imageUrls: string[] = [];
  const videoUrls: string[] = [];

  for (const [nodeId, nodeOutput] of Object.entries(entry.outputs ?? {})) {
    if (!useAll && !targetNodeIds.has(nodeId)) continue;

    // Video outputs (gifs array from VHS_VideoCombine)
    for (const v of nodeOutput.gifs ?? []) {
      const dlUrl = downloadUrl(baseUrl, v.filename, v.subfolder, v.type);
      const ext = v.filename.split(".").pop() || "mp4";
      const stored = await downloadAndStore(dlUrl, ext, "video/mp4");
      videoUrls.push(stored.url);
    }

    // Image outputs
    for (const img of nodeOutput.images ?? []) {
      if (/\.(mp4|webm|gif|webp)$/i.test(img.filename)) {
        const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
        const ext = img.filename.split(".").pop() || "mp4";
        const stored = await downloadAndStore(dlUrl, ext, "video/mp4");
        videoUrls.push(stored.url);
      } else {
        const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
        const stored = await downloadAndStore(dlUrl, "png", "image/png");
        imageUrls.push(stored.url);
      }
    }
  }

  const resolvedOutputType = options.outputType === "video" ? "video"
    : options.outputType === "image" ? "image"
    : videoUrls.length > 0 ? "video" : "image";

  const allUrls = resolvedOutputType === "video"
    ? (videoUrls.length > 0 ? videoUrls : imageUrls)
    : (imageUrls.length > 0 ? imageUrls : videoUrls);

  if (allUrls.length === 0) throw new Error("ComfyUI 任务完成但未返回任何输出");
  return { urls: allUrls, outputType: resolvedOutputType };
}

// ── Upload image to ComfyUI (public, for workflow node param binding) ─────────

export async function uploadImageForWorkflow(rawBaseUrl: string, sourceUrl: string): Promise<string> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  return uploadImageToComfy(baseUrl, sourceUrl);
}

// ── Model listing ─────────────────────────────────────────────────────────────

export interface ComfyModelList {
  ckpts: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  vaes: string[];
  motionModules: string[];
  // Extended categories (best-effort; empty when the server has none).
  unets: string[];          // UNETLoader / diffusion_models
  controlnets: string[];    // ControlNetLoader
  upscaleModels: string[];  // UpscaleModelLoader (ESRGAN etc.)
  clips: string[];          // CLIPLoader / DualCLIPLoader
  clipVisions: string[];    // CLIPVisionLoader
  ipadapters: string[];     // IPAdapterModelLoader
  styleModels: string[];    // StyleModelLoader (e.g. Flux Redux)
  gligen: string[];         // GLIGENLoader
  embeddings: string[];     // textual-inversion embeddings (from /embeddings)
}

export function emptyModelList(): ComfyModelList {
  return {
    ckpts: [], loras: [], samplers: [], schedulers: [], vaes: [], motionModules: [],
    unets: [], controlnets: [], upscaleModels: [], clips: [], clipVisions: [],
    ipadapters: [], styleModels: [], gligen: [], embeddings: [],
  };
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

/** Merge several (nodeClass, field) sources, de-duplicate, and sort. */
function collect(info: ObjectInfo, sources: Array<[string, string]>): string[] {
  const out = new Set<string>();
  for (const [node, field] of sources) {
    for (const v of pickFirstArray(info, node, field)) out.add(v);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

// Heuristic: scan EVERY node's enum fields whose name matches a known suffix and
// fold the values into the right category. This catches custom node packs that
// expose, e.g., `ckpt_name` on a loader class we don't hardcode — so the lists
// stay useful across the long tail of ComfyUI extensions, not just core nodes.
function genericScan(info: ObjectInfo, list: ComfyModelList): void {
  const add = (bucket: string[], vals: string[]) => {
    const seen = new Set(bucket);
    for (const v of vals) if (!seen.has(v)) { bucket.push(v); seen.add(v); }
  };
  for (const node of Object.values(info)) {
    const groups = [node?.input?.required, node?.input?.optional];
    for (const g of groups) {
      if (!g) continue;
      for (const [field, slot] of Object.entries(g)) {
        const first = slot?.[0];
        if (!Array.isArray(first)) continue;
        const vals = first.filter((x): x is string => typeof x === "string");
        if (vals.length === 0) continue;
        const f = field.toLowerCase();
        if (f === "ckpt_name") add(list.ckpts, vals);
        else if (f === "lora_name") add(list.loras, vals);
        else if (f === "vae_name") add(list.vaes, vals);
        else if (f === "control_net_name" || f === "controlnet_name") add(list.controlnets, vals);
        else if (f === "upscale_model_name") add(list.upscaleModels, vals);
        else if (f === "unet_name") add(list.unets, vals);
        else if (f === "clip_name" || f === "clip_name1" || f === "clip_name2") add(list.clips, vals);
        else if (f === "clip_vision_name") add(list.clipVisions, vals);
        else if (f === "ipadapter_file" || f === "ipadapter_name") add(list.ipadapters, vals);
        else if (f === "style_model_name") add(list.styleModels, vals);
        else if (f === "gligen_name") add(list.gligen, vals);
      }
    }
  }
  // Keep deterministic ordering after merges.
  for (const key of Object.keys(list) as (keyof ComfyModelList)[]) {
    list[key] = Array.from(new Set(list[key])).sort((a, b) => a.localeCompare(b));
  }
}

export async function fetchComfyModels(rawBaseUrl: string): Promise<ComfyModelList> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const res = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ComfyUI /object_info 查询失败 (${res.status})`);
  const info = (await res.json()) as ObjectInfo;

  const list: ComfyModelList = emptyModelList();
  // Known-node mappings first (authoritative for core nodes).
  list.ckpts = collect(info, [["CheckpointLoaderSimple", "ckpt_name"], ["ImageOnlyCheckpointLoader", "ckpt_name"], ["unCLIPCheckpointLoader", "ckpt_name"]]);
  list.loras = collect(info, [["LoraLoader", "lora_name"], ["LoraLoaderModelOnly", "lora_name"]]);
  list.samplers = collect(info, [["KSampler", "sampler_name"], ["KSamplerAdvanced", "sampler_name"]]);
  list.schedulers = collect(info, [["KSampler", "scheduler"], ["KSamplerAdvanced", "scheduler"]]);
  list.vaes = collect(info, [["VAELoader", "vae_name"]]);
  list.motionModules = collect(info, [["ADE_AnimateDiffLoaderGen1", "model_name"], ["AnimateDiffLoaderV1", "model_name"], ["ADE_LoadAnimateDiffModel", "model_name"]]);
  list.unets = collect(info, [["UNETLoader", "unet_name"]]);
  list.controlnets = collect(info, [["ControlNetLoader", "control_net_name"], ["DiffControlNetLoader", "control_net_name"]]);
  list.upscaleModels = collect(info, [["UpscaleModelLoader", "model_name"]]);
  list.clips = collect(info, [["CLIPLoader", "clip_name"], ["DualCLIPLoader", "clip_name1"], ["DualCLIPLoader", "clip_name2"]]);
  list.clipVisions = collect(info, [["CLIPVisionLoader", "clip_name"]]);
  list.ipadapters = collect(info, [["IPAdapterModelLoader", "ipadapter_file"]]);
  list.styleModels = collect(info, [["StyleModelLoader", "style_model_name"]]);
  list.gligen = collect(info, [["GLIGENLoader", "gligen_name"]]);

  // Generic pass: fold in any custom-node fields the hardcoded map missed.
  genericScan(info, list);

  // Embeddings live behind a dedicated endpoint, not /object_info.
  try {
    const embRes = await fetch(`${baseUrl}/embeddings`, { signal: AbortSignal.timeout(8_000) });
    if (embRes.ok) {
      const emb = (await embRes.json()) as unknown;
      if (Array.isArray(emb)) {
        list.embeddings = emb.filter((x): x is string => typeof x === "string").sort((a, b) => a.localeCompare(b));
      }
    }
  } catch {
    // Embeddings are optional; ignore failures so the main list still returns.
  }

  return list;
}



// ── Stress-test probe ─────────────────────────────────────────────────────────
//
// A single "probe" submits one workflow and measures latency. Used by the
// stress-test job manager (comfyStress.ts) which drives many probes concurrently.
//
// Crucially, seeds are randomized on every probe: ComfyUI caches node outputs, so
// re-submitting an identical workflow returns almost instantly and would make the
// stress numbers meaningless. Randomizing `seed`/`noise_seed` forces real work.

/** Replace every `seed` / `noise_seed` input with a fresh random value (in place). */
function randomizeSeeds(wf: WorkflowJson): void {
  for (const node of Object.values(wf)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const key of Object.keys(inputs)) {
      if (key === "seed" || key === "noise_seed") {
        inputs[key] = Math.floor(Math.random() * 2_147_483_647);
      }
    }
  }
}

export interface ComfyProbeResult {
  submitMs: number;   // POST /prompt round-trip — how fast the queue accepts work
  waitMs: number;     // submit → completion — queue wait + actual GPU execution
  downloadMs: number; // 0 in lean mode; time to pull (and re-store) outputs in full mode
  totalMs: number;
  outputCount: number; // number of output files the workflow produced
}

export interface ComfyProbeOptions {
  workflowJson: string;
  /** full = also download every output via /view and re-store it (matches the real app pipeline). */
  mode: "lean" | "full";
  /** Randomize seeds to defeat ComfyUI's result cache. Default true. */
  randomizeSeed?: boolean;
  /** Override poll attempt cap (each attempt is POLL_INTERVAL_MS apart). */
  maxAttempts?: number;
  /** External abort signal — when aborted, in-flight fetches are cancelled immediately (立即停止). */
  signal?: AbortSignal;
}

export async function runComfyProbe(rawBaseUrl: string, opts: ComfyProbeOptions): Promise<ComfyProbeResult> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const signal = opts.signal;

  let workflow: WorkflowJson;
  try {
    workflow = JSON.parse(opts.workflowJson) as WorkflowJson;
  } catch {
    throw new Error("Workflow JSON 格式错误，无法解析");
  }
  workflow = JSON.parse(JSON.stringify(workflow)) as WorkflowJson; // clone before mutating
  if (opts.randomizeSeed !== false) randomizeSeeds(workflow);

  const t0 = Date.now();
  const promptId = await submitWorkflow(baseUrl, workflow, signal);
  const t1 = Date.now();
  const entry = await pollHistory(baseUrl, promptId, opts.maxAttempts ?? POLL_MAX_ATTEMPTS_VIDEO, signal);
  const t2 = Date.now();

  let outputCount = 0;
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    outputCount += (nodeOutput.images?.length ?? 0) + (nodeOutput.gifs?.length ?? 0);
  }

  let downloadMs = 0;
  if (opts.mode === "full") {
    const td = Date.now();
    for (const nodeOutput of Object.values(entry.outputs ?? {})) {
      if (signal?.aborted) throw new Error("已停止");
      for (const img of nodeOutput.images ?? []) {
        const isVideo = /\.(mp4|webm|gif|webp)$/i.test(img.filename);
        const ext = isVideo ? (img.filename.split(".").pop() || "mp4") : "png";
        await downloadAndStore(downloadUrl(baseUrl, img.filename, img.subfolder, img.type), ext, isVideo ? "video/mp4" : "image/png");
      }
      for (const v of nodeOutput.gifs ?? []) {
        const ext = v.filename.split(".").pop() || "mp4";
        await downloadAndStore(downloadUrl(baseUrl, v.filename, v.subfolder, v.type), ext, "video/mp4");
      }
    }
    downloadMs = Date.now() - td;
  }

  return { submitMs: t1 - t0, waitMs: t2 - t1, downloadMs, totalMs: Date.now() - t0, outputCount };
}
