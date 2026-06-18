import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

// Locate (or download) the cloudflared binary. We look in a managed app dir first, then
// on PATH. If absent, the admin can trigger a one-click download of the official binary
// from Cloudflare's GitHub releases for the current platform.

const dataDir = process.env.CLOUDFLARED_DIR || path.join(process.cwd(), ".cloudflared");
const binName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
function managedBinPath(): string { return path.join(dataDir, binName); }

/** Whether a binary runs (`--version` exits 0). */
function works(bin: string): Promise<boolean> {
  return new Promise((res) => {
    try {
      const p = spawn(bin, ["--version"], { stdio: "ignore" });
      p.on("error", () => res(false));
      p.on("exit", (code) => res(code === 0));
    } catch { res(false); }
  });
}

let cachedPath: string | null = null;
/** Resolve cloudflared: managed download dir → PATH → null. Cached once found. */
export async function resolveCloudflaredPath(): Promise<string | null> {
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  const managed = managedBinPath();
  if (fs.existsSync(managed) && await works(managed)) { cachedPath = managed; return managed; }
  if (await works("cloudflared")) { cachedPath = "cloudflared"; return "cloudflared"; }
  cachedPath = null;
  return null;
}

/** Official release asset for this OS/arch, or null if we can't auto-install it. */
function assetName(): string | null {
  const a = process.arch, p = process.platform;
  if (p === "linux") return a === "arm64" ? "cloudflared-linux-arm64" : a === "arm" ? "cloudflared-linux-arm" : a === "x64" ? "cloudflared-linux-amd64" : null;
  if (p === "win32") return a === "arm64" ? "cloudflared-windows-arm64.exe" : "cloudflared-windows-amd64.exe";
  if (p === "darwin") return a === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz"; // tgz — needs extraction
  return null;
}

// ── Download status (polled by the admin UI) ──
let dl: { downloading: boolean; error: string | null; installedPath: string | null } = { downloading: false, error: null, installedPath: null };
export function getCloudflaredDownloadStatus() { return { ...dl }; }

/** Download the official cloudflared binary for this platform into the managed dir. */
async function downloadCloudflared(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const asset = assetName();
  if (!asset) return { ok: false, error: `当前平台不支持自动下载（${process.platform}/${process.arch}），请手动安装 cloudflared` };
  if (asset.endsWith(".tgz")) return { ok: false, error: "macOS 请手动安装：brew install cloudflared（或下载 .tgz 解压）" };
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) return { ok: false, error: `下载失败 HTTP ${res.status}` };
    const dest = managedBinPath();
    const tmp = dest + ".part";
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(tmp));
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
    if (!(await works(dest))) { try { fs.unlinkSync(dest); } catch { /* ignore */ } return { ok: false, error: "下载的二进制无法运行（架构不符？）" }; }
    cachedPath = dest;
    return { ok: true, path: dest };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}

/** Kick off a download in the background; status is polled via getCloudflaredDownloadStatus. */
export async function startCloudflaredDownload(): Promise<void> {
  if (dl.downloading) return;
  dl = { downloading: true, error: null, installedPath: null };
  const r = await downloadCloudflared();
  dl = { downloading: false, error: r.ok ? null : (r.error ?? "下载失败"), installedPath: r.ok ? (r.path ?? null) : null };
}

/** For the admin UI: is cloudflared available + which kind (managed/PATH) + can we auto-download. */
export async function cloudflaredInfo() {
  const p = await resolveCloudflaredPath();
  return {
    installed: !!p,
    source: p === managedBinPath() ? "downloaded" : p ? "path" : null,
    canAutoDownload: !!assetName() && !assetName()!.endsWith(".tgz"),
    platform: `${process.platform}/${process.arch}`,
    ...getCloudflaredDownloadStatus(),
  };
}
