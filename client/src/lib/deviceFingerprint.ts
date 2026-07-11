// 设备指纹：多特征哈希（canvas 渲染 + WebGL 显卡 + 屏幕 + 时区 + 语言 + 硬件并发 + 平台），
// SHA-256 → 32 位十六进制，localStorage 缓存（同设备同浏览器跨会话稳定）。随每个 tRPC 请求
// 经 x-device-fp 头上报，与 IP / UA / 会话指纹一起写入行为日志——同一账号被多人/多设备使用
// 时可精确区分溯源。指纹只做「同设备聚类」，不含任何个人信息。

const STORE_KEY = "device:fp";

function canvasFeature(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 220; c.height = 40;
    const ctx = c.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(2, 2, 100, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("avc-fp-🎬-中文", 4, 4);
    ctx.strokeStyle = "rgba(120, 60, 200, 0.7)";
    ctx.arc(60, 20, 15, 0, Math.PI * 1.5);
    ctx.stroke();
    return c.toDataURL();
  } catch { return "canvas-err"; }
}

function webglFeature(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return `${vendor}|${renderer}`;
  } catch { return "webgl-err"; }
}

async function computeFingerprint(): Promise<string> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages ?? []).join(","),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    String(new Date().getTimezoneOffset()),
    `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio}`,
    String(navigator.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    navigator.platform ?? "",
    String(navigator.maxTouchPoints ?? 0),
    canvasFeature(),
    webglFeature(),
  ].join("§");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

let cached: string | null = null;
let computing: Promise<void> | null = null;

/** 同步取指纹：已缓存立即返回；否则触发后台计算（首个请求可能不带，后续都带）。 */
export function getDeviceFingerprint(): string | null {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (stored && /^[a-f0-9]{16,64}$/.test(stored)) { cached = stored; return cached; }
  } catch { /* 无 localStorage */ }
  if (!computing && typeof crypto !== "undefined" && crypto.subtle) {
    computing = computeFingerprint()
      .then((fp) => { cached = fp; try { localStorage.setItem(STORE_KEY, fp); } catch { /* ignore */ } })
      .catch(() => { computing = null; });
  }
  return null;
}
