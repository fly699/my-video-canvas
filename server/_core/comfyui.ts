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
import { storagePut, resolveToAbsoluteUrl, assertMinioOnlyWrite, isOwnStorageUrl, toInternalStoragePath } from "server/storage";
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

// Wan T2V (native): UNETLoader + CLIPLoader(type wan) + VAELoader + ModelSamplingSD3.
const WAN_T2V_TEMPLATE = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "__ckpt__", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "__clip__", type: "wan" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "__vae__" } },
  "10": { class_type: "ModelSamplingSD3", inputs: { shift: 8.0, model: ["1", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["2", 0] } },
  "5": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: "__width__", height: "__height__", length: "__frames__", batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "__sampler__", scheduler: "__scheduler__", denoise: "__denoise__", model: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_wan", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
};

// Wan I2V (native): adds CLIPVisionLoader/Encode + WanImageToVideo from a start frame.
const WAN_I2V_TEMPLATE = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "__ckpt__", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "__clip__", type: "wan" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "__vae__" } },
  "9": { class_type: "CLIPVisionLoader", inputs: { clip_name: "__clipVision__" } },
  "11": { class_type: "LoadImage", inputs: { image: "__refImageName__" } },
  "12": { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["9", 0], image: ["11", 0], crop: "none" } },
  "10": { class_type: "ModelSamplingSD3", inputs: { shift: 8.0, model: ["1", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["2", 0] } },
  "30": { class_type: "WanImageToVideo", inputs: { positive: ["6", 0], negative: ["7", 0], vae: ["3", 0], clip_vision_output: ["12", 0], start_image: ["11", 0], width: "__width__", height: "__height__", length: "__frames__", batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "__sampler__", scheduler: "__scheduler__", denoise: "__denoise__", model: ["10", 0], positive: ["30", 0], negative: ["30", 1], latent_image: ["30", 2] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_wan_i2v", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["8", 0] } },
};

// LTX-Video (native): fast T2V with LTXVConditioning + EmptyLTXVLatentVideo.
const LTXV_TEMPLATE = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__ckpt__" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "__clip__", type: "ltxv" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "__prompt__", clip: ["2", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "__negPrompt__", clip: ["2", 0] } },
  "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: "__fps__" } },
  "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width: "__width__", height: "__height__", length: "__frames__", batch_size: 1 } },
  "4": { class_type: "KSampler", inputs: { seed: "__seed__", steps: "__steps__", cfg: "__cfg__", sampler_name: "__sampler__", scheduler: "__scheduler__", denoise: "__denoise__", model: ["1", 0], positive: ["8", 0], negative: ["8", 1], latent_image: ["5", 0] } },
  "9": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
  "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: "__fps__", loop_count: 0, filename_prefix: "comfyui_ltxv", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["9", 0] } },
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
  clip?: string;
  clipVision?: string;
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
    __clip__: subs.clip ?? "",
    __clipVision__: subs.clipVision ?? "",
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

const endsGguf = (v: unknown) => typeof v === "string" && /\.gguf$/i.test(v);

/**
 * Core CLIP/UNet loaders can't read `.gguf` files — those need the ComfyUI-GGUF
 * loader variants. Our built-in templates use the core loaders, but the model
 * dropdown also lists GGUF encoders (scanned from CLIPLoaderGGUF), so a user can
 * pick a `.gguf` clip and hit "value_not_in_list" on the core CLIPLoader. Swap
 * any core loader whose file is `.gguf` to its GGUF class_type before submit.
 * Mutates the workflow in place. Safe for hand-pasted workflows (a GGUF graph
 * already uses the GGUF nodes, so nothing matches).
 */
export function normalizeGgufLoaders(workflow: unknown): void {
  if (!workflow || typeof workflow !== "object") return;
  for (const node of Object.values(workflow as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    const inputs = n.inputs;
    if (!n.class_type || !inputs) continue;
    switch (n.class_type) {
      case "CLIPLoader":
        if (endsGguf(inputs.clip_name)) n.class_type = "CLIPLoaderGGUF";
        break;
      case "DualCLIPLoader":
        if (endsGguf(inputs.clip_name1) || endsGguf(inputs.clip_name2)) n.class_type = "DualCLIPLoaderGGUF";
        break;
      case "TripleCLIPLoader":
        if (endsGguf(inputs.clip_name1) || endsGguf(inputs.clip_name2) || endsGguf(inputs.clip_name3)) n.class_type = "TripleCLIPLoaderGGUF";
        break;
      case "UNETLoader":
        if (endsGguf(inputs.unet_name)) {
          n.class_type = "UnetLoaderGGUF"; // GGUF unet loader takes only unet_name
          delete inputs.weight_dtype;
        }
        break;
    }
  }
}

/** Auth header for the official ComfyUI cloud — empty for local self-hosted
 * ComfyUI (apiKey undefined) so local requests are byte-for-byte unchanged. */
function comfyAuthHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { "X-API-Key": apiKey } : {};
}

async function submitWorkflow(baseUrl: string, workflow: unknown, signal?: AbortSignal, apiKey?: string): Promise<string> {
  normalizeGgufLoaders(workflow);
  const res = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...comfyAuthHeaders(apiKey) },
    body: JSON.stringify({ prompt: workflow }),
    signal: withTimeout(30_000, signal),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI 提交工作流失败 (${res.status}): ${text.slice(0, 500)}${comfyErrorHint(text)}`);
  }
  const data = (await res.json()) as PromptSubmitResponse;
  if (!data.prompt_id) throw new Error("ComfyUI 未返回 prompt_id");
  return data.prompt_id;
}

async function pollHistory(baseUrl: string, promptId: string, maxAttempts: number, signal?: AbortSignal, apiKey?: string): Promise<HistoryEntry> {
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
        ...(apiKey ? { headers: comfyAuthHeaders(apiKey) } : {}),
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
        const messages = entry.status.messages ?? [];
        const raw = JSON.stringify(messages);
        // The real reason lives in the `execution_error` tuple, which often sits
        // past a naive 500-char slice (after execution_start/execution_cached) —
        // surface its exception_message + failing node directly so it isn't lost.
        const detail = extractExecError(messages) ?? raw.slice(-600);
        throw new Error(`ComfyUI 执行失败: ${detail.slice(0, 800)}${comfyErrorHint(raw)}`);
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

/**
 * Sanitize a user-supplied SaveImage filename prefix: strip filesystem-illegal
 * characters and path separators, collapse whitespace, cap length. Falls back to
 * "comfyui_output" when empty so the SaveImage node always has a valid prefix.
 */
export function sanitizeFilenamePrefix(prefix?: string): string {
  if (!prefix) return "comfyui_output";
  const cleaned = prefix
    .replace(/\.[A-Za-z0-9]{1,12}$/, "")    // drop a trailing extension (.safetensors etc.)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") // filesystem-illegal + control chars
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 64);
  return cleaned || "comfyui_output";
}

/**
 * Pull the `execution_error` tuple out of ComfyUI's status.messages array and
 * format the failing node + exception_message. Returns null when not present.
 * messages items look like ["execution_error", { node_type, node_id, exception_message, ... }].
 */
export function extractExecError(messages: unknown[]): string | null {
  // 1) Canonical execution_error tuple: ["execution_error", { node_type, … }].
  for (const m of messages) {
    if (Array.isArray(m) && m[0] === "execution_error" && m[1] && typeof m[1] === "object") {
      return formatExecError(m[1] as Record<string, unknown>);
    }
  }
  // 2) Fallback — some ComfyUI builds / custom nodes report the failure under a
  //    different tag, or only as a validation `node_errors` map. Deep-scan every
  //    message payload for an exception or node-error shape so the real reason
  //    isn't lost behind execution_start/execution_cached noise.
  for (const m of messages) {
    const d = Array.isArray(m) ? m[1] : m;
    if (!d || typeof d !== "object") continue;
    const rec = d as Record<string, unknown>;
    if (typeof rec.exception_message === "string" || typeof rec.exception_type === "string") {
      return formatExecError(rec);
    }
    if (rec.node_errors && typeof rec.node_errors === "object") {
      const ne = formatNodeErrors(rec.node_errors as Record<string, unknown>);
      if (ne) return ne;
    }
  }
  return null;
}

/** Format a ComfyUI execution_error payload into "节点 X #id: <message>". */
function formatExecError(d: Record<string, unknown>): string {
  if (typeof d.exception_message !== "string" && typeof d.exception_type !== "string"
    && d.node_errors && typeof d.node_errors === "object") {
    const ne = formatNodeErrors(d.node_errors as Record<string, unknown>);
    if (ne) return ne;
  }
  const node = [d.node_type, d.node_id != null ? `#${d.node_id}` : ""].filter(Boolean).join(" ");
  const exc = typeof d.exception_message === "string"
    ? d.exception_message
    : (typeof d.exception_type === "string" ? d.exception_type : JSON.stringify(d).slice(0, 400));
  return node ? `节点 ${node}: ${exc}` : exc;
}

/** Format a validation node_errors map: { "4": { errors: [{ message, details }] } }. */
function formatNodeErrors(nodeErrors: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [nodeId, v] of Object.entries(nodeErrors)) {
    const errs = (v as { errors?: Array<{ message?: string; details?: string }> })?.errors;
    if (Array.isArray(errs)) {
      for (const e of errs) {
        const msg = [e.message, e.details].filter(Boolean).join(": ");
        if (msg) parts.push(`节点 #${nodeId}: ${msg}`);
      }
    }
  }
  return parts.length > 0 ? parts.join("；") : null;
}

/**
 * Translate the most common ComfyUI execution errors into an actionable Chinese
 * hint appended to the raw message. Empty string when nothing matches.
 */
export function comfyErrorHint(raw: string): string {
  // Missing custom node, e.g.
  //   {"type":"missing_node_type", "message":"Node 'VHS_VideoCombine' not found.
  //    The custom node may not be installed.", "class_type":"VHS_VideoCombine"}
  if (/missing_node_type|custom node may not be installed/i.test(raw)) {
    const m = raw.match(/Node '([^']+)' not found|"class_type":\s*"([^"]+)"/);
    const node = m?.[1] || m?.[2] || "";
    // Map well-known class_type prefixes to the plugin that provides them.
    const PLUGIN: Array<[RegExp, string]> = [
      [/^VHS_/, "ComfyUI-VideoHelperSuite"],
      [/^(UNETLoaderGGUF|CLIPLoaderGGUF|DualCLIPLoaderGGUF|.*GGUF)$/, "ComfyUI-GGUF"],
      [/^(WanModelLoader|Wan)/, "ComfyUI-WanVideoWrapper"],
      [/^(LTXV|LTX)/, "ComfyUI-LTXVideo"],
      [/^(IPAdapter)/, "ComfyUI_IPAdapter_plus"],
      [/^(ControlNet|ACN_|Adv)/, "ComfyUI-Advanced-ControlNet"],
      [/^(Reactor|ReActor)/, "comfyui-reactor-node"],
      [/^(Impact|UltralyticsDetectorProvider)/, "ComfyUI-Impact-Pack"],
    ];
    const plugin = PLUGIN.find(([re]) => re.test(node))?.[1];
    return `\n\n⚠️ 该 ComfyUI 服务器未安装节点「${node || "未知"}」。` +
      (plugin
        ? `它来自插件 ${plugin}，请用 ComfyUI-Manager 安装该插件并重启 ComfyUI（多地址时每台都要装）。`
        : `它来自某个第三方自定义节点插件，请用 ComfyUI-Manager 搜索该节点名安装对应插件并重启（多地址时每台都要装）。`);
  }
  // Text-encoder ↔ model dimension mismatch, e.g.
  //   "Given normalized_shape=[3584], expected input with shape [*, 3584], but got input of size[1, 71, 2560]"
  const shape = raw.match(/normalized_shape=\[(\d+)\][^]*?got input of size\s*\[[^\]]*?(\d+)\]/);
  if (shape) {
    const expected = Number(shape[1]);
    const got = Number(shape[2]);
    const dimHint: Record<number, string> = {
      3584: "3584 = Qwen2.5-VL（Qwen-Image）：架构选「Qwen-Image」，CLIP 来源选「单独 CLIP」、类型 qwen_image、选 Qwen 文本编码器（如 qwen_2.5_vl_7b…）。",
      4096: "4096 = T5-XXL：Flux 用「双 CLIP（flux）」clip_l + t5xxl；SD3 用「三 CLIP」clip_g + clip_l + t5xxl。",
      2048: "2048 = SDXL（clip_g+clip_l 拼接）：架构选「经典 SD/SDXL」并用含 CLIP 的 SDXL checkpoint，或「双 CLIP（sdxl）」。",
    };
    return `\n\n⚠️ 文本编码器与模型不匹配：模型期望条件维度 ${expected}，实际编码器输出 ${got}。` +
      `说明所选 CLIP / 文本编码器与该模型架构不符。${dimHint[expected] ?? "请核对「架构」与「CLIP 来源」是否与该模型一致（含 type 与 CLIP 文件）。"}`;
  }
  // Submitted a model/file name the server doesn't have, e.g.
  //   {"type":"value_not_in_list", ... "details":"unet_name: 'x.safetensors' not in [...]"}
  if (/value_not_in_list/.test(raw)) {
    const m = raw.match(/(\w+):\s*'([^']*)'\s*not in/);
    const field = m?.[1];
    const dir: Record<string, string> = {
      unet_name: "models/diffusion_models（或 models/unet）",
      ckpt_name: "models/checkpoints",
      vae_name: "models/vae",
      clip_name: "models/text_encoders（或 models/clip）",
      clip_name1: "models/text_encoders（或 models/clip）",
      clip_name2: "models/text_encoders（或 models/clip）",
      clip_name3: "models/text_encoders（或 models/clip）",
      lora_name: "models/loras",
      control_net_name: "models/controlnet",
    };
    const where = field && dir[field] ? `（应放入 ComfyUI 的 ${dir[field]} 目录）` : "";
    // 加载方式选混的常见情形：checkpoint 模式填了 UNet 文件，或反之。给出对调建议。
    const crossHint =
      field === "unet_name" ? "若它其实是完整 checkpoint（含 CLIP/VAE），请把「模型加载方式」改为 完整 Checkpoint。"
      : field === "ckpt_name" ? "若它其实是单独的 UNet/扩散模型（diffusion_models 目录），请把「模型加载方式」改为 单独 UNet。"
      : "";
    return `\n\n⚠️ 该文件不在这台 ComfyUI 服务器上${m ? `：${m[2]}` : ""}${where}。` +
      `请把文件放入对应模型目录、点「刷新模型」后从下拉里选择；多地址压测时该文件需在每台服务器都存在。` +
      crossHint;
  }
  // Null CLIP from a checkpoint that doesn't embed one.
  if (/clip input is invalid:\s*None/i.test(raw)) {
    return "\n\n⚠️ 该 checkpoint 不含 CLIP：在「CLIP 来源」选 单独/双/三 CLIP 并指定文本编码器文件（Flux/SD3/Qwen 等需单独加载）。";
  }
  return "";
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
async function fetchWithSizeLimit(url: string, maxBytes: number, timeoutMs: number, label: string, headers?: Record<string, string>): Promise<{ buf: Buffer; contentType: string | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...(headers ? { headers } : {}) });
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

async function downloadAndStore(downloadUrlStr: string, ext: string, mimeType: string, apiKey?: string): Promise<{ url: string; key: string }> {
  const { buf, contentType } = await fetchWithSizeLimit(downloadUrlStr, MAX_COMFY_OUTPUT_BYTES, 120_000, "下载 ComfyUI 输出", apiKey ? comfyAuthHeaders(apiKey) : undefined);
  const ct = contentType ?? mimeType;
  // ComfyUI 内网节点产物永久硬锁 MinIO/S3：无视管理员开关，未配 MinIO/S3 一律拒绝（绝不落 Forge）。
  assertMinioOnlyWrite();
  return await storagePut(`comfyui/${Date.now()}.${ext}`, buf, ct);
}

// ── Image upload (for img2img / SVD) ──────────────────────────────────────────

async function uploadImageToComfy(baseUrl: string, sourceUrl: string, apiKey?: string): Promise<string> {
  // SSRF protection: the source URL is user-supplied (referenceImageUrl).
  // Accept either absolute http(s) URLs (subject to assertSafeUrl) or our own
  // storage proxy paths (must start with `/manus-storage/` — trusted prefix).
  // Reject everything else including relative paths that could be re-resolved.
  let fetchUrl = sourceUrl;
  // Our own /manus-storage/ proxy path — relative OR an absolute same-origin URL
  // like https://172.16.0.114:3000/manus-storage/… . Resolve to a fetchable
  // (presigned) URL and SKIP the SSRF guard: this is our own storage, and only
  // the key is used (host ignored), so it can never be redirected elsewhere.
  const internalPath = toInternalStoragePath(sourceUrl);
  if (internalPath) {
    fetchUrl = await resolveToAbsoluteUrl(internalPath);
  } else if (/^https?:\/\//i.test(sourceUrl)) {
    // Genuinely external URL. Allow our own MinIO/S3 host (may be private);
    // SSRF-guard everything else.
    if (!isOwnStorageUrl(sourceUrl)) assertSafeUrl(sourceUrl);
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
    ...(apiKey ? { headers: comfyAuthHeaders(apiKey) } : {}),
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
  preprocessor?: string;   // comfyui_controlnet_aux node class (e.g. CannyEdgePreprocessor)
}

export interface IPAdapterSpec {
  model: string;
  imageName: string;       // already-uploaded ComfyUI image filename (primary; back-compat)
  imageNames?: string[];   // multi-image style/face conditioning (chained IPAdapterAdvanced)
  clipVision?: string;     // CLIPVisionLoader name; empty = sensible default
  weight?: number;
}

interface BuildImageWorkflowArgs {
  template: "txt2img" | "img2img" | "inpaint";
  prompt: string;
  negPrompt: string;
  ckpt: string;
  filenamePrefix?: string; // SaveImage filename_prefix (default "comfyui_output")
  loras: LoraSpec[];
  // Diffusion architecture — selects the graph shape. Default "sd" = classic.
  arch?: "sd" | "flux" | "sd3" | "qwen";
  // Model loader: full checkpoint (CheckpointLoaderSimple) or a standalone UNet
  // file (UNETLoader). New architectures usually ship as a UNet + separate CLIP/VAE.
  modelSource?: "checkpoint" | "unet";
  unetWeightDtype?: string; // UNETLoader weight_dtype (default "default")
  guidance?: number;        // Flux: FluxGuidance value (default 3.5)
  shift?: number;           // SD3/Qwen: ModelSampling shift
  // Separate CLIP loader for checkpoints that don't embed CLIP (Flux/SD3/etc).
  // 1 name → CLIPLoader; 2 → DualCLIPLoader; 3 → TripleCLIPLoader (SD3).
  clip?: { clipType: string; name1: string; name2?: string; name3?: string };
  vae?: string;            // VAELoader name; empty = use checkpoint's VAE
  controlnet?: ControlNetSpec;
  ipadapter?: IPAdapterSpec;
  upscaleModel?: string;   // UpscaleModelLoader name; empty = no upscale
  refImageName?: string;   // img2img / inpaint reference image filename
  maskName?: string;       // inpaint mask filename (white = regenerate)
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
  const arch = a.arch ?? "sd";
  const isNewArch = arch !== "sd";

  // Model loader: a standalone UNet/diffusion-model file (UNETLoader, no embedded
  // CLIP/VAE — those must come from the separate CLIP loader + VAELoader) or a
  // full checkpoint (CheckpointLoaderSimple → model/clip/vae).
  if ((a.modelSource ?? "checkpoint") === "unet") {
    wf["4"] = { class_type: "UNETLoader", inputs: { unet_name: a.ckpt, weight_dtype: a.unetWeightDtype || "default" } };
  } else {
    wf["4"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } };
  }

  // VAE source: dedicated loader when provided, else the checkpoint's third output.
  let vaeRef: NodeRef = ["4", 2];
  if (a.vae && a.vae.trim()) {
    wf["20"] = { class_type: "VAELoader", inputs: { vae_name: a.vae.trim() } };
    vaeRef = ["20", 0];
  }

  // CLIP source: a dedicated CLIPLoader / DualCLIPLoader when the checkpoint
  // doesn't embed a CLIP (Flux / SD3 / UNet-only), else the checkpoint's CLIP.
  let modelRef: NodeRef = ["4", 0];
  let clipRef: NodeRef = ["4", 1];
  if (a.clip && a.clip.name1.trim()) {
    const n1 = a.clip.name1.trim();
    const n2 = a.clip.name2?.trim();
    const n3 = a.clip.name3?.trim();
    if (n2 && n3) {
      wf["21"] = { class_type: "TripleCLIPLoader", inputs: { clip_name1: n1, clip_name2: n2, clip_name3: n3 } };
    } else if (n2) {
      wf["21"] = { class_type: "DualCLIPLoader", inputs: { clip_name1: n1, clip_name2: n2, type: a.clip.clipType } };
    } else {
      wf["21"] = { class_type: "CLIPLoader", inputs: { clip_name: n1, type: a.clip.clipType } };
    }
    clipRef = ["21", 0];
  }

  // LoRA chain: each loader threads model+clip through, so they stack in order.
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

  // IPAdapter (optional): a style/face reference image that modulates the model.
  // Uses the explicit-model variant (IPAdapterModelLoader + CLIPVisionLoader +
  // IPAdapterAdvanced) which is the most stable across ipadapter-pack versions.
  {
    const ipImages = a.ipadapter
      ? (a.ipadapter.imageNames?.length ? a.ipadapter.imageNames : (a.ipadapter.imageName ? [a.ipadapter.imageName] : []))
      : [];
    if (arch === "sd" && a.ipadapter && a.ipadapter.model.trim() && ipImages.length) {
      wf["40"] = { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: a.ipadapter.model.trim() } };
      wf["41"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: a.ipadapter.clipVision?.trim() || "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" } };
      // Chain one IPAdapterAdvanced per reference image (robust across image
      // sizes / ipadapter-pack versions — avoids ImageBatch dimension errors).
      // Each stage modulates the running model from the previous stage.
      ipImages.forEach((name, i) => {
        const li = `42_${i}`;
        const ia = `43_${i}`;
        wf[li] = { class_type: "LoadImage", inputs: { image: name } };
        wf[ia] = {
          class_type: "IPAdapterAdvanced",
          inputs: {
            model: modelRef,
            ipadapter: ["40", 0],
            image: [li, 0],
            clip_vision: ["41", 0],
            weight: a.ipadapter!.weight ?? 1.0,
            weight_type: "linear",
            combine_embeds: "concat",
            start_at: 0,
            end_at: 1,
            embeds_scaling: "V only",
          },
        };
        modelRef = [ia, 0];
      });
    }
  }

  wf["6"] = { class_type: "CLIPTextEncode", inputs: { text: a.prompt, clip: clipRef } };
  wf["7"] = { class_type: "CLIPTextEncode", inputs: { text: a.negPrompt, clip: clipRef } };

  // Conditioning may be rewritten by ControlNet below.
  let positiveRef: NodeRef = ["6", 0];
  let negativeRef: NodeRef = ["7", 0];

  // Architecture-specific conditioning / model sampling (DiT models):
  // - Flux is guidance-distilled → FluxGuidance on the positive (KSampler cfg=1).
  // - SD3 / Qwen need a ModelSampling shift node on the model path.
  if (arch === "flux") {
    wf["60"] = { class_type: "FluxGuidance", inputs: { conditioning: positiveRef, guidance: a.guidance ?? 3.5 } };
    positiveRef = ["60", 0];
  } else if (arch === "sd3") {
    wf["61"] = { class_type: "ModelSamplingSD3", inputs: { model: modelRef, shift: a.shift ?? 3 } };
    modelRef = ["61", 0];
  } else if (arch === "qwen") {
    wf["61"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: modelRef, shift: a.shift ?? 3.1 } };
    modelRef = ["61", 0];
  }

  if (arch === "sd" && a.controlnet && a.controlnet.model.trim() && a.controlnet.imageName) {
    wf["30"] = { class_type: "ControlNetLoader", inputs: { control_net_name: a.controlnet.model.trim() } };
    wf["31"] = { class_type: "LoadImage", inputs: { image: a.controlnet.imageName } };
    // Optional aux preprocessor (canny/depth/openpose…) turns the raw guide image
    // into the control map before it feeds ControlNetApplyAdvanced.
    let cnImageRef: NodeRef = ["31", 0];
    if (a.controlnet.preprocessor && a.controlnet.preprocessor.trim()) {
      wf["33"] = { class_type: a.controlnet.preprocessor.trim(), inputs: { image: ["31", 0], resolution: 512 } };
      cnImageRef = ["33", 0];
    }
    wf["32"] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: positiveRef,
        negative: negativeRef,
        control_net: ["30", 0],
        image: cnImageRef,
        strength: a.controlnet.strength,
        start_percent: a.controlnet.startPercent ?? 0,
        end_percent: a.controlnet.endPercent ?? 1,
      },
    };
    positiveRef = ["32", 0];
    negativeRef = ["32", 1];
  }

  // Latent source. DiT architectures (Flux/SD3/Qwen) use EmptySD3LatentImage;
  // their ControlNet/inpaint graphs differ from classic SD, so new-arch supports
  // txt2img (empty latent) and img2img (VAEEncode) only — inpaint falls back to
  // a plain encode. Classic SD keeps the full empty/img2img/inpaint behavior.
  let latentRef: NodeRef;
  if (isNewArch) {
    if ((a.template === "img2img" || a.template === "inpaint") && a.refImageName) {
      wf["11"] = { class_type: "LoadImage", inputs: { image: a.refImageName } };
      wf["10"] = { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: vaeRef } };
      latentRef = ["10", 0];
    } else {
      wf["5"] = { class_type: "EmptySD3LatentImage", inputs: { width: a.width, height: a.height, batch_size: a.batchSize } };
      latentRef = ["5", 0];
    }
  } else if (a.template === "inpaint") {
    wf["11"] = { class_type: "LoadImage", inputs: { image: a.refImageName ?? "" } };
    wf["12"] = { class_type: "LoadImageMask", inputs: { image: a.maskName ?? "", channel: "red" } };
    wf["10"] = { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["11", 0], vae: vaeRef, mask: ["12", 0], grow_mask_by: 6 } };
    latentRef = ["10", 0];
  } else if (a.template === "img2img") {
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
      // Flux is guidance-distilled: CFG must be 1 (real guidance comes from FluxGuidance).
      seed: a.seed, steps: a.steps, cfg: arch === "flux" ? 1 : a.cfg,
      sampler_name: a.sampler, scheduler: a.scheduler, denoise: a.denoise,
      model: modelRef, positive: positiveRef, negative: negativeRef, latent_image: latentRef,
    },
  };
  wf["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: vaeRef } };

  // Optional model-based upscale (ESRGAN etc.) applied to the decoded image.
  let imageRef: NodeRef = ["8", 0];
  if (a.upscaleModel && a.upscaleModel.trim()) {
    wf["50"] = { class_type: "UpscaleModelLoader", inputs: { model_name: a.upscaleModel.trim() } };
    wf["51"] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["50", 0], image: ["8", 0] } };
    imageRef = ["51", 0];
  }
  wf["9"] = { class_type: "SaveImage", inputs: { filename_prefix: sanitizeFilenamePrefix(a.filenamePrefix), images: imageRef } };

  return wf;
}

export interface GenerateComfyImageOptions {
  workflowTemplate: "txt2img" | "img2img" | "inpaint";
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  filenamePrefix?: string; // SaveImage filename_prefix (default "comfyui_output")
  maskUrl?: string;
  // Single-LoRA fields kept for backward compatibility; `loras` takes precedence.
  lora?: string;
  loraStrength?: number;
  loras?: LoraSpec[];
  controlnet?: { model: string; imageUrl: string; strength?: number; startPercent?: number; endPercent?: number; preprocessor?: string };
  ipadapter?: { model: string; imageUrl: string; imageUrls?: string[]; clipVision?: string; weight?: number };
  clip?: { clipType: string; name1: string; name2?: string; name3?: string };
  arch?: "sd" | "flux" | "sd3" | "qwen";
  modelSource?: "checkpoint" | "unet";
  unetWeightDtype?: string;
  guidance?: number;
  shift?: number;
  upscaleModel?: string;
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
  let maskName: string | undefined;
  if (options.workflowTemplate === "img2img" || options.workflowTemplate === "inpaint") {
    if (!options.referenceImageUrl) throw new Error(`${options.workflowTemplate} 模板需要参考图`);
    refImageName = await uploadImageToComfy(baseUrl, options.referenceImageUrl);
  }
  if (options.workflowTemplate === "inpaint") {
    if (!options.maskUrl) throw new Error("inpaint 模板需要蒙版");
    maskName = await uploadImageToComfy(baseUrl, options.maskUrl);
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
      preprocessor: options.controlnet.preprocessor,
    };
  }

  // Upload the IPAdapter reference image(s) (if any). Supports multiple
  // style/face references — each is uploaded and chained server-side.
  let ipadapter: IPAdapterSpec | undefined;
  if (options.ipadapter && options.ipadapter.model.trim()) {
    const srcUrls = Array.from(new Set([
      ...(options.ipadapter.imageUrls?.length ? options.ipadapter.imageUrls : (options.ipadapter.imageUrl ? [options.ipadapter.imageUrl] : [])),
    ].map((u) => u.trim()).filter(Boolean)));
    if (srcUrls.length) {
      const names = [];
      for (const u of srcUrls) names.push(await uploadImageToComfy(baseUrl, u));
      ipadapter = {
        model: options.ipadapter.model.trim(),
        imageName: names[0],
        imageNames: names,
        clipVision: options.ipadapter.clipVision,
        weight: options.ipadapter.weight ?? 1.0,
      };
    }
  }

  const workflow = buildImageWorkflow({
    template: options.workflowTemplate,
    prompt: options.prompt ?? "",
    negPrompt: options.negPrompt ?? "",
    ckpt: options.ckpt,
    filenamePrefix: options.filenamePrefix,
    loras: cleanLoras,
    clip: options.clip,
    arch: options.arch,
    modelSource: options.modelSource,
    unetWeightDtype: options.unetWeightDtype,
    guidance: options.guidance,
    shift: options.shift,
    vae: options.vae,
    controlnet,
    ipadapter,
    upscaleModel: options.upscaleModel,
    refImageName,
    maskName,
    seed: options.seed ?? Math.floor(Math.random() * 2_147_483_647),
    steps: options.steps ?? 20,
    cfg: options.cfg ?? 7,
    sampler: options.sampler ?? "euler",
    scheduler: options.scheduler ?? "normal",
    // img2img keeps the reference (denoise < 1.0); inpaint regenerates the masked
    // area fully (1.0 default); txt2img is always 1.0.
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

export type ComfyVideoTemplate = "animatediff" | "svd" | "wan_t2v" | "wan_i2v" | "ltxv";

export interface GenerateComfyVideoOptions {
  workflowTemplate: ComfyVideoTemplate;
  prompt: string;
  negPrompt?: string;
  ckpt: string;
  motionModule?: string;
  clip?: string;
  clipVision?: string;
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

  const tpl = options.workflowTemplate;
  const needsRef = tpl === "svd" || tpl === "wan_i2v";
  let refImageName: string | undefined;
  if (needsRef) {
    if (!options.referenceImageUrl) throw new Error(`${tpl} 模板需要起始图/参考图`);
    refImageName = await uploadImageToComfy(baseUrl, options.referenceImageUrl);
  }

  const TEMPLATES: Record<ComfyVideoTemplate, unknown> = {
    animatediff: ANIMATEDIFF_TEMPLATE,
    svd: SVD_TEMPLATE,
    wan_t2v: WAN_T2V_TEMPLATE,
    wan_i2v: WAN_I2V_TEMPLATE,
    ltxv: LTXV_TEMPLATE,
  };
  const isWan = tpl === "wan_t2v" || tpl === "wan_i2v";
  // Per-template sensible defaults for the separate CLIP/VAE/CLIP-Vision loaders
  // and frame/size/sampler conventions, applied only when the user left them blank.
  const defaults = isWan
    ? { clip: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", vae: "wan_2.1_vae.safetensors", clipVision: "clip_vision_h.safetensors", frames: 81, fps: 16, width: 832, height: 480, cfg: 6, scheduler: "simple" }
    : tpl === "ltxv"
    ? { clip: "t5xxl_fp16.safetensors", vae: "", clipVision: "", frames: 97, fps: 25, width: 768, height: 512, cfg: 3, scheduler: "normal" }
    : { clip: "", vae: options.vae ?? "", clipVision: "", frames: options.frames ?? 16, fps: options.fps ?? 8, width: options.width ?? 512, height: options.height ?? 512, cfg: options.cfg ?? 7, scheduler: options.scheduler };

  const workflow = applyTemplate(TEMPLATES[tpl], {
    prompt: options.prompt,
    negPrompt: options.negPrompt,
    ckpt: options.ckpt,
    motionModule: options.motionModule,
    clip: options.clip?.trim() || defaults.clip,
    clipVision: options.clipVision?.trim() || defaults.clipVision,
    steps: options.steps,
    cfg: options.cfg ?? defaults.cfg,
    seed: options.seed,
    frames: options.frames ?? defaults.frames,
    fps: options.fps ?? defaults.fps,
    width: options.width ?? defaults.width,
    height: options.height ?? defaults.height,
    sampler: options.sampler,
    // SVD needs karras for coherent frames; otherwise use the per-template default.
    scheduler: tpl === "svd" ? (options.scheduler || "karras") : (options.scheduler || defaults.scheduler),
    denoise: options.denoise,
    vae: options.vae?.trim() || defaults.vae,
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

type WorkflowJson = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

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
      // Skip when `text` is wired from an upstream node (array ref): the prompt
      // is produced by another node (e.g. "easy promptLine" which splits a
      // multi-line prompt into a list → one image per line). Exposing it here as
      // an editable field would let the user overwrite the connection and
      // silently collapse the batch to a single image. The upstream source node
      // is surfaced instead by the generic prompt/text fallback below.
      if (Array.isArray(inputs.text)) continue;
      const isPositive = !negativeClipNodeIds.has(nodeId);
      detectedParams.push({
        nodeId, fieldPath: "inputs.text",
        label: isPositive ? "提示词" : "负向提示词",
        type: "text",
        defaultValue: inputs.text ?? "",
      });
    } else if (ct === "TextEncodeQwenImageEditPlus" || ct === "TextEncodeQwenImageEdit") {
      // Qwen-Image-Edit(-Plus): the edit instruction lives in `prompt`, and the
      // node fuses up to 3 reference images (image1/2/3) per that instruction.
      // Surface the prompt so users can vary the fusion ("把图1的角色放到图2中" 等)
      // without touching the workflow. The image1/2/3 inputs come from LoadImage
      // nodes, which are detected separately as bindable image params.
      detectedParams.push({
        nodeId, fieldPath: "inputs.prompt",
        label: node._meta?.title?.trim() || "编辑指令（提示词）",
        type: "text",
        defaultValue: inputs.prompt ?? "",
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
      // Use the node's title (e.g. 加载图像1 / 加载图像2) as the label so multiple
      // reference inputs in a fusion/edit workflow stay distinguishable in the UI.
      detectedParams.push({
        nodeId, fieldPath: "inputs.image",
        label: node._meta?.title?.trim() || "输入图像",
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
    } else {
      // Generic fallback for unrecognized nodes: surface a LITERAL `prompt` /
      // `text` string so custom prompt-source nodes (e.g. "easy promptLine",
      // wildcard / batch-prompt nodes) become editable. Multi-line prompts in
      // such nodes drive ComfyUI's per-line list execution → multiple images.
      // Only literal strings are exposed; wired (array) inputs are left alone.
      for (const field of ["prompt", "text"]) {
        if (typeof (inputs as Record<string, unknown>)[field] === "string") {
          detectedParams.push({
            nodeId, fieldPath: `inputs.${field}`,
            label: node._meta?.title?.trim() || "提示词",
            type: "text",
            defaultValue: (inputs as Record<string, unknown>)[field] as string,
          });
          break;
        }
      }
    }
  }

  const outputType = hasImage && hasVideo ? "mixed" : hasVideo ? "video" : "image";
  return { detectedParams, outputNodeIds, outputType };
}

// ── Custom workflow execution ─────────────────────────────────────────────────

export interface ExecuteCustomWorkflowOptions {
  workflowJson: string;
  paramValues: Record<string, unknown>;  // key = `${nodeId}.${fieldPath}`, e.g. "3.inputs.seed"
  // Keys (same format as paramValues) whose value is an image: a URL here is
  // auto-uploaded to ComfyUI and replaced with the returned input filename.
  imageParamKeys?: string[];
  outputNodeIds?: string[];
  outputType?: "image" | "video" | "auto";
  projectId?: number;
  nodeId?: string;
  // When set, requests carry an `X-API-Key` header — used for the official
  // ComfyUI cloud (cloud.comfy.org). Undefined for local self-hosted ComfyUI.
  apiKey?: string;
}

export async function executeCustomWorkflow(
  rawBaseUrl: string,
  options: ExecuteCustomWorkflowOptions,
): Promise<{ urls: string[]; outputType: "image" | "video" }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const apiKey = options.apiKey;

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
  const imageKeys = new Set(options.imageParamKeys ?? []);
  for (const [key, rawValue] of Object.entries(options.paramValues)) {
    const parts = key.split(".");
    if (parts.length < 2) continue;
    const [wfNodeId, ...pathParts] = parts;
    const node = workflow[wfNodeId];
    if (!node) continue;

    // Normalize: if path starts with "inputs", use it directly; otherwise prepend "inputs"
    const fieldParts = pathParts[0] === "inputs" ? pathParts.slice(1) : pathParts;
    if (fieldParts.length === 0) continue;

    // Image params: a URL is not a valid ComfyUI input value (LoadImage expects a
    // filename already present in ComfyUI's input dir), so upload it first and
    // substitute the returned filename. This makes both manual URL entry and
    // upstream-node image feeds work without a separate client upload step.
    let value = rawValue;
    if (imageKeys.has(key) && typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("/manus-storage/"))) {
      value = await uploadImageToComfy(baseUrl, value, apiKey);
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

  const promptId = await submitWorkflow(baseUrl, workflow, undefined, apiKey);

  // Fire-and-forget progress relay (websocket; best-effort, local only — cloud
  // progress would need a separate auth scheme, so it's simply skipped there).
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
  const entry = await pollHistory(baseUrl, promptId, POLL_MAX_ATTEMPTS_VIDEO, undefined, apiKey);

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
      const stored = await downloadAndStore(dlUrl, ext, "video/mp4", apiKey);
      videoUrls.push(stored.url);
    }

    // Image outputs
    for (const img of nodeOutput.images ?? []) {
      if (/\.(mp4|webm|gif|webp)$/i.test(img.filename)) {
        const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
        const ext = img.filename.split(".").pop() || "mp4";
        const stored = await downloadAndStore(dlUrl, ext, "video/mp4", apiKey);
        videoUrls.push(stored.url);
      } else {
        const dlUrl = downloadUrl(baseUrl, img.filename, img.subfolder, img.type);
        const stored = await downloadAndStore(dlUrl, "png", "image/png", apiKey);
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

// ── Official ComfyUI cloud (cloud.comfy.org) ──────────────────────────────────
// The cloud REST API differs from local self-hosted ComfyUI (so it gets its own
// client rather than reusing submitWorkflow/pollHistory). Per the official docs
// (https://docs.comfy.org/development/cloud/overview — experimental, may change):
//   submit : POST {base}/api/prompt           (X-API-Key) body {prompt}  → {prompt_id}
//   status : GET  {base}/api/job/{id}/status              → {status: pending|in_progress|completed|failed|cancelled}
//   detail : GET  {base}/api/jobs/{id}                    → {outputs: {...}} (ComfyUI outputs shape)
//   view   : GET  {base}/api/view?filename&subfolder&type → 302 → temporary signed URL
// The local code path is untouched; this is only used when a custom-flow node is
// switched to 云端 by an admin / whitelisted user.

interface CloudJobDetail {
  outputs?: HistoryEntry["outputs"];
  status?: string;
  error?: string;
  message?: string;
}

async function cloudSubmit(baseUrl: string, workflow: unknown, apiKey: string): Promise<string> {
  normalizeGgufLoaders(workflow);
  const res = await fetch(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) throw new Error("云端 API Key 无效或无权限（需 Creator/Pro 套餐）");
    throw new Error(`云端提交工作流失败 (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { prompt_id?: string; promptId?: string; id?: string };
  const id = data.prompt_id ?? data.promptId ?? data.id;
  if (!id) throw new Error("云端未返回 prompt_id");
  return id;
}

/** Poll the cloud job until it reaches a terminal state; on success fetch and
 * return the job detail (with outputs). */
async function cloudPoll(baseUrl: string, promptId: string, apiKey: string, maxAttempts: number): Promise<CloudJobDetail> {
  const headers = { "X-API-Key": apiKey };
  let netErrors = 0;
  for (let i = 0; i < maxAttempts; i++) {
    await abortableSleep(POLL_INTERVAL_MS);
    let status: string;
    try {
      const res = await fetch(`${baseUrl}/api/job/${promptId}/status`, { headers, signal: AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) throw new Error("云端 API Key 无效或无权限");
      if (!res.ok) {
        if (res.status === 404 || res.status >= 500) {
          if (++netErrors >= 5) throw new Error(`云端持续无响应 (HTTP ${res.status} × ${netErrors})`);
          continue;
        }
        throw new Error(`云端状态查询失败 (${res.status})`);
      }
      netErrors = 0;
      const data = (await res.json()) as { status?: string };
      status = (data.status ?? "").toLowerCase();
    } catch (err) {
      // Surface explicit API/auth errors immediately; retry only transient ones.
      if (err instanceof Error && /API Key|查询失败|无响应/.test(err.message)) throw err;
      if (++netErrors >= 5) throw new Error("云端连接持续失败");
      continue;
    }
    if (status === "completed" || status === "success" || status === "succeeded") {
      const dRes = await fetch(`${baseUrl}/api/jobs/${promptId}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!dRes.ok) throw new Error(`云端获取结果失败 (${dRes.status})`);
      return (await dRes.json()) as CloudJobDetail;
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      let detail = "";
      try {
        const dRes = await fetch(`${baseUrl}/api/jobs/${promptId}`, { headers, signal: AbortSignal.timeout(10_000) });
        if (dRes.ok) { const d = (await dRes.json()) as CloudJobDetail; detail = d.error ?? d.message ?? JSON.stringify(d).slice(0, 400); }
      } catch { /* best-effort */ }
      throw new Error(`云端任务${status === "failed" || status === "error" ? "执行失败" : "已取消"}${detail ? ": " + detail : ""}`);
    }
    // pending / in_progress / queued → keep polling
  }
  throw new Error("云端任务超时未完成");
}

/** Download a cloud output via /api/view (follows the 302 to a signed storage URL
 * WITHOUT forwarding X-API-Key, so the key never leaks to the storage backend). */
async function cloudDownloadAndStore(baseUrl: string, filename: string, subfolder: string, type: string, apiKey: string, ext: string, mime: string): Promise<{ url: string; key: string }> {
  const u = new URL(`${baseUrl}/api/view`);
  u.searchParams.set("filename", filename);
  u.searchParams.set("subfolder", subfolder);
  u.searchParams.set("type", type);
  const res = await fetch(u.toString(), { headers: { "X-API-Key": apiKey }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  let buf: Buffer, contentType: string | null;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("云端 /api/view 未返回下载地址");
    const signed = new URL(loc, baseUrl).toString();
    ({ buf, contentType } = await fetchWithSizeLimit(signed, MAX_COMFY_OUTPUT_BYTES, 120_000, "下载云端输出"));
  } else if (res.ok) {
    // Direct stream (no redirect) — re-fetch through the size-limited reader.
    ({ buf, contentType } = await fetchWithSizeLimit(u.toString(), MAX_COMFY_OUTPUT_BYTES, 120_000, "下载云端输出", { "X-API-Key": apiKey }));
  } else {
    throw new Error(`下载云端输出失败 (${res.status})`);
  }
  assertMinioOnlyWrite();
  return await storagePut(`comfyui/${Date.now()}.${ext}`, buf, contentType ?? mime);
}

/** Upload a reference image to the cloud (POST {base}/api/upload/image) and
 * return the stored input filename for use in a LoadImage node. */
async function uploadImageToCloud(baseUrl: string, sourceUrl: string, apiKey: string): Promise<string> {
  let fetchUrl = sourceUrl;
  const internalPath = toInternalStoragePath(sourceUrl);
  if (internalPath) fetchUrl = await resolveToAbsoluteUrl(internalPath);
  else if (/^https?:\/\//i.test(sourceUrl)) { if (!isOwnStorageUrl(sourceUrl)) assertSafeUrl(sourceUrl); }
  else throw new Error("参考图 URL 协议不受支持，仅允许 http/https 或 /manus-storage/ 相对路径");
  const { buf, contentType } = await fetchWithSizeLimit(fetchUrl, MAX_REF_IMAGE_BYTES, 60_000, "下载参考图");
  const ct = contentType ?? "image/png";
  const ext = ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)], { type: ct }), `comfy_input_${Date.now()}.${ext}`);
  form.append("overwrite", "true");
  const upRes = await fetch(`${baseUrl}/api/upload/image`, { method: "POST", body: form, headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(60_000) });
  if (!upRes.ok) { const t = await upRes.text().catch(() => ""); throw new Error(`上传参考图到云端失败 (${upRes.status}): ${t.slice(0, 200)}`); }
  const data = (await upRes.json()) as { name?: string; subfolder?: string };
  if (!data.name) throw new Error("云端上传未返回文件名");
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

export async function executeCloudWorkflow(
  rawBaseUrl: string,
  options: ExecuteCustomWorkflowOptions,
): Promise<{ urls: string[]; outputType: "image" | "video" }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("云端 API Key 未配置（请在服务端设置 COMFYUI_CLOUD_API_KEY）");

  let workflow: WorkflowJson;
  try { workflow = JSON.parse(options.workflowJson) as WorkflowJson; }
  catch { throw new Error("Workflow JSON 格式错误，无法解析"); }
  workflow = JSON.parse(JSON.stringify(workflow)) as WorkflowJson;

  // Inject paramValues (same key format as local). Image-typed params with a URL
  // are uploaded to the cloud first and replaced with the returned filename.
  const imageKeys = new Set(options.imageParamKeys ?? []);
  for (const [key, rawValue] of Object.entries(options.paramValues)) {
    const parts = key.split("."); if (parts.length < 2) continue;
    const [wfNodeId, ...pathParts] = parts;
    const node = workflow[wfNodeId]; if (!node) continue;
    const fieldParts = pathParts[0] === "inputs" ? pathParts.slice(1) : pathParts;
    if (fieldParts.length === 0) continue;
    let value = rawValue;
    if (imageKeys.has(key) && typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("/manus-storage/"))) {
      value = await uploadImageToCloud(baseUrl, value, apiKey);
    }
    if (fieldParts.length === 1) { node.inputs[fieldParts[0]] = value; }
    else {
      let obj: Record<string, unknown> = node.inputs;
      for (let i = 0; i < fieldParts.length - 1; i++) {
        if (obj[fieldParts[i]] == null || typeof obj[fieldParts[i]] !== "object") obj[fieldParts[i]] = {};
        obj = obj[fieldParts[i]] as Record<string, unknown>;
      }
      obj[fieldParts[fieldParts.length - 1]] = value;
    }
  }

  const promptId = await cloudSubmit(baseUrl, workflow, apiKey);
  const detail = await cloudPoll(baseUrl, promptId, apiKey, POLL_MAX_ATTEMPTS_VIDEO);

  const targetNodeIds = new Set(options.outputNodeIds ?? []);
  const useAll = targetNodeIds.size === 0;
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  for (const [nodeId, nodeOutput] of Object.entries(detail.outputs ?? {})) {
    if (!useAll && !targetNodeIds.has(nodeId)) continue;
    for (const v of nodeOutput.gifs ?? []) {
      const ext = v.filename.split(".").pop() || "mp4";
      const s = await cloudDownloadAndStore(baseUrl, v.filename, v.subfolder, v.type, apiKey, ext, "video/mp4");
      videoUrls.push(s.url);
    }
    for (const img of nodeOutput.images ?? []) {
      if (/\.(mp4|webm|gif|webp)$/i.test(img.filename)) {
        const ext = img.filename.split(".").pop() || "mp4";
        const s = await cloudDownloadAndStore(baseUrl, img.filename, img.subfolder, img.type, apiKey, ext, "video/mp4");
        videoUrls.push(s.url);
      } else {
        const s = await cloudDownloadAndStore(baseUrl, img.filename, img.subfolder, img.type, apiKey, "png", "image/png");
        imageUrls.push(s.url);
      }
    }
  }

  const resolvedOutputType = options.outputType === "video" ? "video"
    : options.outputType === "image" ? "image"
    : videoUrls.length > 0 ? "video" : "image";
  const allUrls = resolvedOutputType === "video"
    ? (videoUrls.length > 0 ? videoUrls : imageUrls)
    : (imageUrls.length > 0 ? imageUrls : videoUrls);
  if (allUrls.length === 0) throw new Error("云端任务完成但未返回任何输出");
  return { urls: allUrls, outputType: resolvedOutputType };
}

/** Lightweight cloud connectivity + API-key check for the node's 测试 button.
 * No documented ping endpoint exists, so we probe the status endpoint with a
 * sentinel id: 401/403 ⇒ bad key, 5xx ⇒ server down, anything else (incl. 404
 * "job not found") ⇒ reachable and authenticated. */
export async function testCloudConnection(rawBaseUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey) return { ok: false, message: "服务端未配置 COMFYUI_CLOUD_API_KEY" };
  let baseUrl: string;
  try { baseUrl = normalizeBaseUrl(rawBaseUrl); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "地址无效" }; }
  try {
    const res = await fetch(`${baseUrl}/api/job/__connectivity_check__/status`, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) return { ok: false, message: "API Key 无效或无权限（需 Creator/Pro 套餐）" };
    if (res.status >= 500) return { ok: false, message: `云端服务器错误 (${res.status})` };
    return { ok: true, message: "云端连接正常，API Key 有效" };
  } catch (e) {
    return { ok: false, message: "无法连接云端：" + (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
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
