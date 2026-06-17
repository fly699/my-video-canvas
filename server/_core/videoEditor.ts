import { execFile } from "child_process";
import { promisify } from "util";
import { storagePut, assertObjectStorageWritable, resolveToAbsoluteUrl, toInternalStoragePath, isOwnStorageUrl } from "../storage";
import { assertPublicUrl } from "./ssrfGuard";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";

const _execFileRaw = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 120_000;
const FFPROBE_TIMEOUT_MS = 30_000;

// Resolve the ffmpeg/ffprobe binary WITHOUT relying solely on PATH. On Windows a
// winget/choco install often isn't on the PATH of the running service/pm2 process
// → `spawn ffmpeg ENOENT`. Check an env override, then common install locations,
// then fall back to the bare command (PATH). Result is cached.
const _ffCache: Record<string, string> = {};
function resolveFf(cmd: "ffmpeg" | "ffprobe"): string {
  if (_ffCache[cmd]) return _ffCache[cmd];
  const exe = process.platform === "win32" ? `${cmd}.exe` : cmd;
  const candidates: string[] = [];
  const envOverride = cmd === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (envOverride) candidates.push(envOverride);
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA;
    if (la) {
      candidates.push(path.join(la, "Microsoft", "WinGet", "Links", exe)); // winget shim
      try { // winget package dir: Gyan.FFmpeg.*/ffmpeg-*/bin/ffmpeg.exe
        const pkgRoot = path.join(la, "Microsoft", "WinGet", "Packages");
        for (const d of fsSync.readdirSync(pkgRoot)) {
          if (!/ffmpeg/i.test(d)) continue;
          for (const sub of fsSync.readdirSync(path.join(pkgRoot, d))) {
            candidates.push(path.join(pkgRoot, d, sub, "bin", exe));
          }
        }
      } catch { /* dir may not exist */ }
    }
    candidates.push("C:\\ProgramData\\chocolatey\\bin\\" + exe, "C:\\ffmpeg\\bin\\" + exe, "C:\\Program Files\\ffmpeg\\bin\\" + exe);
  } else {
    candidates.push(`/usr/bin/${cmd}`, `/usr/local/bin/${cmd}`, `/opt/homebrew/bin/${cmd}`, `/snap/bin/${cmd}`);
  }
  for (const c of candidates) { try { if (fsSync.existsSync(c)) { _ffCache[cmd] = c; return c; } } catch { /* ignore */ } }
  _ffCache[cmd] = cmd; // last resort: rely on PATH
  return cmd;
}

export function execFileAsync(cmd: "ffmpeg" | "ffprobe", args: string[], opts?: { timeoutMs?: number }) {
  const timeout = opts?.timeoutMs ?? (cmd === "ffprobe" ? FFPROBE_TIMEOUT_MS : FFMPEG_TIMEOUT_MS);
  return _execFileRaw(resolveFf(cmd), args, { timeout, maxBuffer: 10 * 1024 * 1024 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Delegate to the shared strong guard (covers integer/hex IPv4 forms the old
// dotted-only regexes missed, e.g. http://2130706433/). Kept as a named export so
// existing call sites stay unchanged.
export function assertSafeUrl(url: string): void {
  assertPublicUrl(url);
}

export async function downloadToTemp(url: string, ext: string): Promise<string> {
  // Our own /manus-storage/ proxy path (relative OR an absolute same-origin URL
  // like https://172.16.0.114:3000/manus-storage/…) → resolve to a fetchable
  // (presigned) URL and SKIP the SSRF guard. The host is discarded; only the
  // storage key is used against our own backend, so it can't be redirected
  // elsewhere. Direct MinIO/S3 host is allowed; everything else is SSRF-guarded.
  let fetchUrl = url;
  const internal = toInternalStoragePath(url);
  if (internal) {
    fetchUrl = await resolveToAbsoluteUrl(internal);
  } else if (!isOwnStorageUrl(url)) {
    assertSafeUrl(url);
  }
  const uniqueName = `ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const tmpPath = path.join(os.tmpdir(), uniqueName);

  const res = await fetch(fetchUrl);
  // SSRF: re-validate the post-redirect URL for externally-supplied inputs — a
  // public URL can 302 to an internal host the initial guard couldn't see. (Skip
  // for our own storage, whose presigned host is trusted.)
  if (!internal && !isOwnStorageUrl(url) && res.url) assertSafeUrl(res.url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(tmpPath, buf);
  return tmpPath;
}

export function buildAtempoFilters(speed: number): string[] {
  // atempo supports 0.5–2.0; chain multiple filters for values outside this range
  const filters: string[] = [];

  // Guard: speed must be a finite positive number. speed=0 would make the `< 0.5`
  // loop below spin forever (0/0.5=0), and a non-positive speed is meaningless for
  // tempo. The editor API already clamps to [0.1, 8]; this is defense-in-depth so the
  // shared helper can never hang regardless of caller.
  if (!(speed > 0) || !Number.isFinite(speed)) return filters; // treat as 1× (no atempo)
  speed = Math.min(speed, 256);

  if (speed < 0.5) {
    // e.g. speed=0.25 → atempo=0.5,atempo=0.5
    let remaining = speed;
    while (remaining < 0.5) {
      filters.push("atempo=0.5");
      remaining /= 0.5;
    }
    // Remaining adjustment (if exactly lands on 0.5 chains, no extra needed)
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(6)}`);
    }
  } else if (speed > 2.0) {
    // e.g. speed=4.0 → atempo=2.0,atempo=2.0
    let remaining = speed;
    while (remaining > 2.0) {
      filters.push("atempo=2.0");
      remaining /= 2.0;
    }
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(6)}`);
    }
  } else {
    filters.push(`atempo=${speed.toFixed(6)}`);
  }

  return filters;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AudioTrackInput {
  url: string;
  volume?: number;   // 0..2, default 1
  delay?: number;    // seconds start offset, default 0
  fadeIn?: number;   // seconds
  fadeOut?: number;  // seconds
  isVoice?: boolean; // mark as the ducking key (others duck to it)
}

export interface ClipOutputSettings {
  resolution?: "source" | "720p" | "1080p" | "4k";
  fps?: number;                 // 1..60
  format?: "mp4" | "webm";
}

export interface TrimOptions {
  inputUrl: string;
  startTime: number;    // seconds
  endTime: number;      // seconds
  speed?: number;       // 0.1–10.0, default 1.0 (1.0 = no change)
  audioUrl?: string;    // legacy single external audio (→ folded into audioTracks)
  audioVolume?: number; // legacy volume for the single external audio (default 1.0)
  audioTracks?: AudioTrackInput[]; // multi-track external audio
  loudnorm?: boolean;   // EBU R128 loudness normalization on the final mix
  ducking?: boolean;    // enable voice ducking when a source is marked isVoice
  colorPreset?: string; // one-click look (see buildColorPresetFilters)
  output?: ClipOutputSettings;
  edit?: ClipEdit;      // optional picture/audio adjustments (default = none)
}

/** Picture/audio adjustments applied during a clip trim. All optional; omitting a
 *  field leaves that aspect untouched (neutral). Pure filter strings are built by
 *  buildClipVideoFilters / buildClipAudioFilters (unit-tested). */
export interface ClipEdit {
  // Picture
  reverse?: boolean;                 // play the clip backwards (video + audio)
  rotate?: 0 | 90 | 180 | 270;       // clockwise rotation
  flipH?: boolean;                   // mirror horizontally
  flipV?: boolean;                   // mirror vertically
  brightness?: number;               // eq brightness, -1..1 (neutral 0)
  contrast?: number;                 // eq contrast, 0..2 (neutral 1)
  saturation?: number;               // eq saturation, 0..3 (neutral 1)
  aspect?: string;                   // center-crop to "9:16" | "16:9" | "1:1" (else original)
  fadeIn?: number;                   // seconds; fades picture + sound in from black/silence
  fadeOut?: number;                  // seconds; fades out at the clip's end
  // Audio
  muteOriginal?: boolean;            // drop the source's own audio
  mixAudio?: boolean;                // when an external audio is connected, MIX it with the
                                     //   original instead of replacing it
  originalVolume?: number;           // 0..2 volume for the source's own audio (default 1.0)
  originalIsVoice?: boolean;         // mark the source audio as the ducking voice key
  denoiseAudio?: boolean;            // afftdn noise reduction on the source audio
  originalFadeIn?: number;           // seconds (audio-only fade for the source track)
  originalFadeOut?: number;          // seconds
}

export interface TrimResult {
  url: string;
  duration: number;
}

/** Pure: ordered ffmpeg `-vf` chain for a clip edit. `clipDuration` is the trimmed,
 *  speed-adjusted output length (needed to anchor the fade-out). */
export function buildClipVideoFilters(o: ClipEdit, speed: number, clipDuration: number): string[] {
  const f: string[] = [];
  if (o.reverse) f.push("reverse");
  if (o.rotate === 90) f.push("transpose=1");
  else if (o.rotate === 180) f.push("transpose=2,transpose=2");
  else if (o.rotate === 270) f.push("transpose=2");
  if (o.flipH) f.push("hflip");
  if (o.flipV) f.push("vflip");
  if (o.aspect && o.aspect !== "original") {
    const [aw, ah] = o.aspect.split(":").map(Number);
    if (aw > 0 && ah > 0) {
      const ar = (aw / ah).toFixed(6);
      // Center-crop to the target ratio; force even dimensions for yuv420p.
      f.push(`crop='trunc(min(iw,ih*${ar})/2)*2':'trunc(min(ih,iw/${ar})/2)*2'`);
    }
  }
  const b = o.brightness ?? 0, c = o.contrast ?? 1, s = o.saturation ?? 1;
  if (Math.abs(b) > 1e-3 || Math.abs(c - 1) > 1e-3 || Math.abs(s - 1) > 1e-3) {
    f.push(`eq=brightness=${b.toFixed(3)}:contrast=${c.toFixed(3)}:saturation=${s.toFixed(3)}`);
  }
  if (Math.abs(speed - 1) > 1e-3) f.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
  if (o.fadeIn && o.fadeIn > 0) f.push(`fade=t=in:st=0:d=${o.fadeIn.toFixed(3)}`);
  if (o.fadeOut && o.fadeOut > 0) {
    f.push(`fade=t=out:st=${Math.max(0, clipDuration - o.fadeOut).toFixed(3)}:d=${o.fadeOut.toFixed(3)}`);
  }
  return f;
}

/** Pure: ordered ffmpeg audio filter chain for ONE audio stream (the source's own
 *  track). `applySpeed` is false for an external replacement track (independent music
 *  shouldn't be time-stretched), true for the source audio. */
export function buildClipAudioFilters(
  o: ClipEdit, speed: number, clipDuration: number, volume: number, applySpeed: boolean,
): string[] {
  const f: string[] = [];
  if (o.reverse && applySpeed) f.push("areverse");
  if (Math.abs(volume - 1) > 1e-3) f.push(`volume=${volume.toFixed(4)}`);
  if (applySpeed && Math.abs(speed - 1) > 1e-3) f.push(...buildAtempoFilters(speed));
  if (o.fadeIn && o.fadeIn > 0) f.push(`afade=t=in:st=0:d=${o.fadeIn.toFixed(3)}`);
  if (o.fadeOut && o.fadeOut > 0) {
    f.push(`afade=t=out:st=${Math.max(0, clipDuration - o.fadeOut).toFixed(3)}:d=${o.fadeOut.toFixed(3)}`);
  }
  return f;
}

/** Pure: video filters for a one-click color "look". Inserted into the -vf chain
 *  after the manual eq adjustment, before speed/fade. */
export function buildColorPresetFilters(preset?: string): string[] {
  switch (preset) {
    case "cinematic": return ["eq=contrast=1.08:saturation=0.90", "colorbalance=rs=-0.06:bs=0.06:rm=0.03:bh=0.05"];
    case "warm":      return ["colorbalance=rm=0.10:rh=0.06:bm=-0.06:bh=-0.04"];
    case "cool":      return ["colorbalance=bm=0.10:bh=0.06:rm=-0.06:rh=-0.04"];
    case "bw":        return ["hue=s=0", "eq=contrast=1.05"];
    case "vintage":   return ["curves=preset=vintage"];
    case "vivid":     return ["eq=saturation=1.35:contrast=1.08"];
    default:          return [];
  }
}

/** A normalized audio source feeding the clip's final mix. */
export interface AudioSourceSpec {
  label: string;     // ffmpeg input label, e.g. "0:a" (original) or "1:a" (track)
  volume?: number;   // default 1
  delay?: number;    // seconds, default 0 (start offset)
  reverse?: boolean; // areverse
  atempo?: number;   // time-stretch factor (1 = none); only the original uses this
  denoise?: boolean; // afftdn
  fadeIn?: number;   // seconds
  fadeOut?: number;  // seconds
  isVoice?: boolean; // ducking key
}

const _br = (l: string) => (l.startsWith("[") ? l : `[${l}]`);

/** Build a per-source audio chain (returns the filter list without the wrapping). */
export function buildAudioSourceChain(s: AudioSourceSpec, clipDuration: number): string[] {
  const f: string[] = [];
  if (s.denoise) f.push("afftdn");
  if (s.reverse) f.push("areverse");
  if (s.delay && s.delay > 0) f.push(`adelay=${Math.round(s.delay * 1000)}:all=1`);
  if (s.atempo && Math.abs(s.atempo - 1) > 1e-3) f.push(...buildAtempoFilters(s.atempo));
  if (s.volume != null && Math.abs(s.volume - 1) > 1e-3) f.push(`volume=${s.volume.toFixed(4)}`);
  if (s.fadeIn && s.fadeIn > 0) f.push(`afade=t=in:st=0:d=${s.fadeIn.toFixed(3)}`);
  if (s.fadeOut && s.fadeOut > 0) f.push(`afade=t=out:st=${Math.max(0, clipDuration - s.fadeOut).toFixed(3)}:d=${s.fadeOut.toFixed(3)}`);
  return f;
}

/** Pure: assemble the AUDIO portion of a filter_complex from N sources, with optional
 *  voice-ducking (sidechaincompress) and final loudness normalization (EBU R128).
 *  Returns null when there are no audio sources (caller emits -an). */
export function buildAudioMixGraph(
  sources: AudioSourceSpec[],
  o: { clipDuration: number; loudnorm?: boolean; ducking?: boolean },
): { complex: string; outLabel: string } | null {
  if (sources.length === 0) return null;
  const parts: string[] = [];
  const labels: string[] = [];
  sources.forEach((s, i) => {
    const chain = buildAudioSourceChain(s, o.clipDuration);
    const out = `s${i}`;
    parts.push(`${_br(s.label)}${chain.length ? chain.join(",") : "anull"}[${out}]`);
    labels.push(out);
  });

  // Helper: amix a label list into one (passthrough when single).
  const mix = (ls: string[], outName: string): string => {
    if (ls.length === 1) return ls[0];
    parts.push(`${ls.map(_br).join("")}amix=inputs=${ls.length}:duration=longest:normalize=0[${outName}]`);
    return outName;
  };

  let mixed: string;
  const voice = sources.map((s, i) => ({ s, l: labels[i] })).filter((x) => x.s.isVoice).map((x) => x.l);
  const music = sources.map((s, i) => ({ s, l: labels[i] })).filter((x) => !x.s.isVoice).map((x) => x.l);
  if (o.ducking && voice.length > 0 && music.length > 0) {
    const vm = mix(voice, "vm");
    const mm = mix(music, "mm");
    parts.push(`${_br(mm)}${_br(vm)}sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck]`);
    parts.push(`${_br("duck")}${_br(vm)}amix=inputs=2:duration=longest:normalize=0[mx]`);
    mixed = "mx";
  } else {
    mixed = mix(labels, "mx");
  }

  let outLabel = mixed;
  if (o.loudnorm) { parts.push(`${_br(mixed)}loudnorm[aout]`); outLabel = "aout"; }
  return { complex: parts.join(";"), outLabel };
}

/** Whether a local media file has at least one audio stream (ffprobe). A muted
 *  source must NOT be referenced as `[0:a]` in a filtergraph — that errors with
 *  "matches no streams". Best-effort: on probe failure assume there IS audio
 *  (preserves prior behavior for normal videos). */
async function hasAudioStream(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
      "-of", "csv=p=0", path,
    ]);
    return (stdout ?? "").trim().length > 0;
  } catch {
    return true;
  }
}

export async function trimVideo(opts: TrimOptions): Promise<TrimResult> {
  const speed = opts.speed ?? 1.0;
  const audioVolume = opts.audioVolume ?? 1.0;
  const edit = opts.edit ?? {};
  const clipDuration = (opts.endTime - opts.startTime) / speed;

    // Resolve output container/codec from settings.
    const fmt = opts.output?.format ?? "mp4";
    const ext = fmt === "webm" ? "webm" : "mp4";
    const inputPath = await downloadToTemp(opts.inputUrl, "mp4");

    const outName = `ffmpeg-out-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const outPath = path.join(os.tmpdir(), outName);

  // Normalize legacy single-audio input into the multi-track list.
  const trackInputs: AudioTrackInput[] = [
    ...(opts.audioUrl ? [{ url: opts.audioUrl, volume: opts.audioVolume, isVoice: false }] : []),
    ...(opts.audioTracks ?? []),
  ];
  const trackPaths: string[] = [];

  try {
    for (const t of trackInputs) trackPaths.push(await downloadToTemp(t.url, "m4a"));

    const args: string[] = [];
    // Fast seek before the video input.
    args.push("-ss", String(opts.startTime));
    args.push("-to", String(opts.endTime));
    args.push("-i", inputPath);
    for (const p of trackPaths) args.push("-i", p);

    // ── Video filter chain (incl. color preset + output scale/fps) ──
    const videoFilters = buildClipVideoFilters(edit, speed, clipDuration);
    // Color preset goes after the manual eq (which buildClipVideoFilters already
    // emitted) but the helper appended speed/fade last; insert preset before those.
    const presetFilters = buildColorPresetFilters(opts.colorPreset);
    const scaleFilter = resolutionScaleFilter(opts.output?.resolution);
    const allVideoFilters = [...videoFilters, ...presetFilters, ...(scaleFilter ? [scaleFilter] : [])];
    const fpsArg = opts.output?.fps && opts.output.fps > 0 ? opts.output.fps : null;
    const needVideoEncode = allVideoFilters.length > 0 || fpsArg != null || fmt === "webm";

    // ── Audio sources (original + external tracks) ──
    // Only include the source's own audio if it actually has an audio stream —
    // a silent video would make `[0:a]` match no streams and abort ffmpeg.
    const originalHasAudio = !edit.muteOriginal && await hasAudioStream(inputPath);
    const sources: AudioSourceSpec[] = [];
    if (originalHasAudio) {
      sources.push({
        label: "0:a",
        volume: edit.originalVolume ?? 1.0,
        reverse: edit.reverse,
        atempo: speed,
        denoise: edit.denoiseAudio,
        fadeIn: edit.originalFadeIn ?? edit.fadeIn,
        fadeOut: edit.originalFadeOut ?? edit.fadeOut,
        isVoice: edit.originalIsVoice,
      });
    }
    trackInputs.forEach((t, i) => {
      sources.push({ label: `${i + 1}:a`, volume: t.volume, delay: t.delay, fadeIn: t.fadeIn, fadeOut: t.fadeOut, isVoice: t.isVoice });
    });

    const audioGraph = buildAudioMixGraph(sources, { clipDuration, loudnorm: opts.loudnorm, ducking: opts.ducking });

    // ── Assemble ffmpeg args. Use filter_complex whenever audio is mixed (≥2
    //    sources / ducking / loudnorm); otherwise the simpler -vf/-af path. ──
    const vcodec = fmt === "webm" ? "libvpx-vp9" : "libx264";
    const acodec = fmt === "webm" ? "libopus" : "aac";
    const useComplexAudio = sources.length >= 2 || !!opts.ducking || !!opts.loudnorm;

    if (audioGraph && useComplexAudio) {
      const parts: string[] = [];
      if (needVideoEncode) parts.push(`[0:v]${allVideoFilters.join(",")}[vout]`);
      parts.push(audioGraph.complex);
      args.push("-filter_complex", parts.join(";"));
      args.push("-map", needVideoEncode ? "[vout]" : "0:v");
      args.push("-map", `[${audioGraph.outLabel}]`);
      args.push("-c:v", needVideoEncode ? vcodec : "copy");
      if (needVideoEncode) args.push("-preset", fmt === "webm" ? "realtime" : "fast");
      if (fpsArg) args.push("-r", String(fpsArg));
      args.push("-c:a", acodec);
      args.push("-shortest");
    } else if (audioGraph) {
      // Exactly one audio source (original OR one external track) → -vf/-af.
      const single = sources[0];
      const af = buildAudioSourceChain(single, clipDuration);
      args.push("-map", needVideoEncode ? "0:v" : "0:v");
      args.push("-map", single.label);
      if (needVideoEncode) args.push("-vf", allVideoFilters.join(","));
      if (af.length) args.push("-af", af.join(","));
      args.push("-c:v", needVideoEncode ? vcodec : "copy");
      if (needVideoEncode) args.push("-preset", fmt === "webm" ? "realtime" : "fast");
      if (fpsArg) args.push("-r", String(fpsArg));
      args.push("-c:a", af.length ? acodec : (fmt === "webm" ? acodec : "copy"));
      if (trackPaths.length > 0) args.push("-shortest");
    } else {
      // No audio at all.
      if (needVideoEncode) { args.push("-vf", allVideoFilters.join(",")); args.push("-c:v", vcodec, "-preset", fmt === "webm" ? "realtime" : "fast"); }
      else args.push("-c:v", "copy");
      if (fpsArg) args.push("-r", String(fpsArg));
      args.push("-an");
    }

    // Output options
    if (fmt === "mp4") args.push("-movflags", "+faststart");
    args.push("-y"); // overwrite without prompt
    args.push(outPath);

    let stderrOutput = "";
    try {
      const result = await execFileAsync("ffmpeg", args);
      stderrOutput = result.stderr ?? "";
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      stderrOutput = execErr.stderr ?? "";
      throw new Error(
        `FFmpeg failed:\n${stderrOutput || (execErr.message ?? String(err))}`
      );
    }

    // Read output and upload to storage
    const outBuffer = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const mime = fmt === "webm" ? "video/webm" : "video/mp4";
    const { url } = await storagePut(`generated/clip-${Date.now()}.${ext}`, outBuffer, mime);

    return { url, duration: clipDuration };
  } finally {
    // Clean up all temp files
    await fs.unlink(inputPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
    for (const p of trackPaths) await fs.unlink(p).catch(() => undefined);
  }
}

/** Map an output resolution preset to an ffmpeg scale filter (keeps aspect; pads to
 *  even dims). Returns null for "source"/undefined. */
function resolutionScaleFilter(res?: ClipOutputSettings["resolution"]): string | null {
  const h = res === "720p" ? 720 : res === "1080p" ? 1080 : res === "4k" ? 2160 : null;
  if (h == null) return null;
  // Scale by height, keep aspect, force even width.
  return `scale=-2:${h}`;
}

// ── Extract a single frame as a PNG (clip cover / still) ───────────────────────

export interface ExtractFrameResult { url: string }

export async function extractFrame(opts: { inputUrl: string; time: number }): Promise<ExtractFrameResult> {
  const inputPath = await downloadToTemp(opts.inputUrl, "mp4");
  const outPath = path.join(os.tmpdir(), `frame-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    // -ss before -i = fast seek; one frame; high quality.
    await execFileAsync("ffmpeg", ["-ss", String(Math.max(0, opts.time)), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outPath]);
    const buf = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/frame-${Date.now()}.png`, buf, "image/png");
    return { url };
  } finally {
    await fs.unlink(inputPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Merge ─────────────────────────────────────────────────────────────────────

export interface MergeOptions {
  inputUrls: string[];
  transition?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  /** 逐切点转场（长度 = 段数-1；来自分镜镜头表的 transition 字段）。给出时覆盖全局
   *  transition。"none"/cut 用 1 帧 xfade 实现硬切（避免 concat/xfade 混链时基问题）。 */
  transitions?: ("none" | "fade" | "dissolve" | "wipe")[];
  /** 逐段配音轨（与 inputUrls 对位；null=该段无配音）。每条按所在段起点 adelay 后
   *  与原声/BGM amix——视频+配音对位混装（装配端）。 */
  voiceUrls?: (string | null)[];
  /** 逐段音效轨（与 inputUrls 对位）。同配音的 adelay 对位机制，混入权重 0.6
   *  （氛围声不压人声）。 */
  sfxUrls?: (string | null)[];
}

export interface MergeResult {
  url: string;
  duration: number;
  /** xfade 路径下各段在成片中的精确起点（offset 累计值）——下游字幕对位的时间轴真相源。 */
  segStarts?: number[];
}

export async function mergeVideos(opts: MergeOptions): Promise<MergeResult> {
  const transition = opts.transition ?? "none";
  const td = opts.transitionDuration ?? 0.5;
  const bgVol = opts.bgMusicVolume ?? 0.3;
  // 装配模式：带逐切点转场或逐段配音/音效时强制走 filter 路径（旧 concat 快路径不动）。
  const segTransitions = opts.transitions?.length ? opts.transitions : null;
  const voiceList = opts.voiceUrls?.some(Boolean) ? opts.voiceUrls! : null;
  const sfxList = opts.sfxUrls?.some(Boolean) ? opts.sfxUrls! : null;
  const advanced = !!(segTransitions || voiceList || sfxList);

  const inputPaths: string[] = [];
  const outName = `ffmpeg-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);
  let bgMusicPath: string | null = null;

  try {
    // Download sequentially so inputPaths is populated incrementally;
    // the finally block can then clean up whichever files were created
    // even if a mid-array download fails.
    for (const u of opts.inputUrls) {
      inputPaths.push(await downloadToTemp(u, "mp4"));
    }
    if (opts.bgMusicUrl) {
      bgMusicPath = await downloadToTemp(opts.bgMusicUrl, "mp3");
    }

    let totalDuration = 0;
    let outSegStarts: number[] | undefined;
    const args: string[] = [];

    if (transition === "none" && !advanced) {
      const listName = `ffmpeg-list-${Date.now()}.txt`;
      const listPath = path.join(os.tmpdir(), listName);
      const listContent = inputPaths.map((p) => `file '${p}'`).join("\n");
      await fs.writeFile(listPath, listContent, "utf8");

      args.push("-f", "concat", "-safe", "0", "-i", listPath);
      if (bgMusicPath) args.push("-i", bgMusicPath);

      if (bgMusicPath) {
        args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c:v", "libx264", "-preset", "fast");
        args.push("-af", `volume=${bgVol.toFixed(4)}`);
        args.push("-c:a", "aac", "-shortest");
      } else {
        args.push("-c:v", "copy", "-c:a", "copy");
      }
      args.push("-movflags", "+faststart", "-y", outPath);

      try {
        await execFileAsync("ffmpeg", args);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg merge failed:\n${e.stderr || e.message || String(err)}`);
      } finally {
        await fs.unlink(listPath).catch(() => undefined);
      }

      for (const p of inputPaths) {
        try {
          const r = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
          totalDuration += parseFloat(r.stdout.trim()) || 0;
        } catch { /* skip */ }
      }
    } else {
      const n = inputPaths.length;
      inputPaths.forEach((p) => { args.push("-i", p); });

      const durations: number[] = [];
      for (const p of inputPaths) {
        try {
          const r = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
          durations.push(parseFloat(r.stdout.trim()) || 5);
        } catch { durations.push(5); }
      }

      const globalXfade = transition === "dissolve" ? "dissolve" : "fade";
      // 逐切点：type/duration 各自决定。"none"(cut/match-cut) → 极短 fade ≈ 硬切。
      // 硬切时长必须 ≥ 一个帧间隔：真实 ffmpeg 复现发现 1/30 经 toFixed(3) 得 0.033 <
      // 帧间隔 0.0333…，亚帧 duration 会让 xfade 在第一路 EOF 处提前终止、后段整段丢失
      // （成片被截断）。取 1/15≈0.067（2 帧 @30fps；对 24fps 源也 > 单帧间隔 0.0417），
      // 视觉上仍是硬切。
      const XFADE_MAP: Record<string, string> = { fade: "fade", dissolve: "dissolve", wipe: "wipeleft", none: "fade" };
      const cutAt = (i: number): { type: string; dur: number } => {
        const t = segTransitions?.[i] ?? (transition === "none" ? "none" : transition);
        if (t === "none") return { type: "fade", dur: 1 / 15 };
        // 夹取转场时长 ≤ 相邻两段各自时长（transition i crossfades 段 i 与 i+1）。否则 xfade 会
        // 超出短段帧数，使 offset 倒退、相邻转场重叠、短镜头被洗掉（实测 6.1.1：0.3s 段配 0.5s 转场
        // → 中间帧变红蓝混合品红、绿段丢失）。与 composeTimeline 的 Math.min(td, curDur, dur) 同理。
        const dur = Math.min(td, durations[i] ?? td, durations[i + 1] ?? td);
        return { type: XFADE_MAP[t] ?? globalXfade, dur };
      };
      let filterStr = "";
      let lastLabel = "[0:v]";
      let timeOffset = 0;
      const segStarts: number[] = [0]; // 各段在成片中的起点（配音 adelay 对位用）

      for (let i = 1; i < n; i++) {
        const c = cutAt(i - 1);
        timeOffset = Math.max(0, timeOffset + durations[i - 1] - c.dur);
        segStarts.push(timeOffset);
        const outLabel = i === n - 1 ? "[vout]" : `[v${i}]`;
        filterStr += `${lastLabel}[${i}:v]xfade=transition=${c.type}:duration=${c.dur.toFixed(3)}:offset=${timeOffset.toFixed(3)}${outLabel};`;
        lastLabel = `[v${i}]`;
      }
      if (n === 1) filterStr = "[0:v]copy[vout];";
      filterStr = filterStr.replace(/;$/, "");

      // Only build audio filter when all inputs have an audio track.
      // hasAudioTrack returns true on ffprobe failure (conservative), so a single
      // silent video in the mix will cause FFmpeg to fail on [i:a] reference.
      const hasAudioFlags = await Promise.all(inputPaths.map((p) => hasAudioTrack(p)));
      const allHaveAudio = hasAudioFlags.every(Boolean);

      // bgMusicPath is pushed as an input only here, after the audio check, so the
      // input index (n or n+1) is known and the stream is always referenced.
      // 配音/音效轨（装配端）：逐段下载，按段起点 adelay 对位。输入索引在 bg 之后排布。
      // 音效权重 0.6（氛围声不压人声）。
      const voicePaths: { path: string; segIdx: number; weight: number; tag: string }[] = [];
      for (const [list, weight, tag] of [[voiceList, 1, "vc"], [sfxList, 0.6, "fx"]] as const) {
        if (!list) continue;
        for (let i = 0; i < Math.min(list.length, n); i++) {
          const vu = list[i];
          if (!vu) continue;
          voicePaths.push({ path: await downloadToTemp(vu, "mp3"), segIdx: i, weight, tag });
          inputPaths.push(voicePaths[voicePaths.length - 1].path); // 纳入 finally 清理
        }
      }

      let audioFilter = "";
      const mixParts: { label: string; weight: number }[] = [];
      let nextIdx = n; // 后续输入（bg / voices）的 ffmpeg 输入索引
      let pre = "";
      if (allHaveAudio) {
        // 原声与视频同步交叠：视频走 xfade（相邻段重叠 c.dur），音频若用 concat 则不
        // 重叠，每个切点音画漂移累计一次转场时长（3 段 0.5s 转场即漂 1s+，且与按视频
        // 时间轴 adelay 的配音/音效错位）——真实 ffmpeg 复现确认。改用 acrossfade 链、
        // 每切点取与视频相同的时长，音频总长 = 视频总长，逐段起点与 segStarts 对齐。
        if (n === 1) {
          pre += `;[0:a]anull[acat]`;
        } else {
          let lastA = "[0:a]";
          for (let i = 1; i < n; i++) {
            const c = cutAt(i - 1);
            // acrossfade 要求两路都长于 d：用相邻段视频时长的一半夹取，极短段也能过。
            const d = Math.max(0.03, Math.min(c.dur, (durations[i - 1] ?? 2) / 2, (durations[i] ?? 2) / 2));
            const outLabel = i === n - 1 ? "[acat]" : `[ac${i}]`;
            pre += `;${lastA}[${i}:a]acrossfade=d=${d.toFixed(3)}${outLabel}`;
            lastA = `[ac${i}]`;
          }
        }
        mixParts.push({ label: "[acat]", weight: 1 });
      }
      if (bgMusicPath) {
        args.push("-i", bgMusicPath);
        mixParts.push({ label: `[${nextIdx}:a]`, weight: bgVol });
        nextIdx++;
      }
      for (const vp of voicePaths) {
        args.push("-i", vp.path);
        const startMs = Math.round((segStarts[vp.segIdx] ?? 0) * 1000);
        pre += `;[${nextIdx}:a]adelay=${startMs}|${startMs},aresample=async=1[${vp.tag}${vp.segIdx}]`;
        mixParts.push({ label: `[${vp.tag}${vp.segIdx}]`, weight: vp.weight });
        nextIdx++;
      }
      if (mixParts.length > 1) {
        audioFilter = `${pre};${mixParts.map((m) => m.label).join("")}amix=inputs=${mixParts.length}:normalize=0:weights=${mixParts.map((m) => m.weight.toFixed(4)).join("|")},alimiter=limit=0.95[aout]`;
      } else if (mixParts.length === 1) {
        audioFilter = mixParts[0].label === "[acat]" ? `${pre};[acat]anull[aout]` : `${pre};${mixParts[0].label}aresample=async=1[aout]`;
      }

      args.push("-filter_complex", filterStr + audioFilter);
      if (audioFilter) {
        args.push("-map", "[vout]", "-map", "[aout]");
        args.push("-c:v", "libx264", "-preset", "fast", "-c:a", "aac");
      } else {
        args.push("-map", "[vout]");
        args.push("-c:v", "libx264", "-preset", "fast");
      }
      args.push("-movflags", "+faststart", "-y", outPath);

      try {
        await execFileAsync("ffmpeg", args);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg xfade merge failed:\n${e.stderr || e.message || String(err)}`);
      }

      // 末段起点 + 末段时长 = 成片总长（逐切点 duration 各异时仍精确；
      // 全局统一转场时与旧公式 Σdur - td*(n-1) 等价）。
      totalDuration = (segStarts[n - 1] ?? 0) + (durations[n - 1] ?? 0);
      outSegStarts = segStarts;
    }

    const outBuffer = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/merge-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url, duration: Math.max(0, totalDuration), segStarts: outSegStarts };
  } finally {
    await Promise.all(inputPaths.map((p) => fs.unlink(p).catch(() => undefined)));
    await fs.unlink(outPath).catch(() => undefined);
    if (bgMusicPath) await fs.unlink(bgMusicPath).catch(() => undefined);
  }
}

// ── Audio segment concat（多角色配音 casting：分段 TTS 后拼接为镜级单条配音）────
/** 把多段音频按顺序拼接为一条 mp3。各段先统一重采样 44.1kHz/单声道再 concat，
 *  规避不同 TTS 提供商采样率/声道不一致导致的 concat 失败或变调。 */
export async function concatAudioSegments(urls: string[]): Promise<{ url: string; duration: number }> {
  const inputPaths: string[] = [];
  const outPath = path.join(os.tmpdir(), `ffmpeg-acat-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  try {
    for (const u of urls) {
      inputPaths.push(await downloadToTemp(u, "mp3"));
    }
    const n = inputPaths.length;
    const args: string[] = [];
    inputPaths.forEach((p) => args.push("-i", p));
    const pre = inputPaths.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono[a${i}]`).join(";");
    const cat = inputPaths.map((_, i) => `[a${i}]`).join("") + `concat=n=${n}:v=0:a=1[aout]`;
    args.push("-filter_complex", `${pre};${cat}`, "-map", "[aout]", "-c:a", "libmp3lame", "-q:a", "2", "-y", outPath);
    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg audio concat failed:\n${e.stderr || e.message || String(err)}`);
    }
    let duration = 0;
    try {
      const r = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outPath]);
      duration = parseFloat(r.stdout.trim()) || 0;
    } catch { /* duration best-effort */ }
    const buf = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/dub-cast-${Date.now()}.mp3`, buf, "audio/mpeg");
    return { url, duration };
  } finally {
    await Promise.all(inputPaths.map((p) => fs.unlink(p).catch(() => undefined)));
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Subtitles ─────────────────────────────────────────────────────────────────

export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

export interface BurnSubtitleOptions {
  fontSize?: number;
  fontColor?: string;
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function generateSRT(entries: SubtitleEntry[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${formatSRTTime(e.start)} --> ${formatSRTTime(e.end)}\n${e.text}`)
    .join("\n\n");
}

export async function burnSubtitles(
  videoUrl: string,
  entries: SubtitleEntry[],
  opts?: BurnSubtitleOptions,
): Promise<{ url: string }> {
  const fontSize = opts?.fontSize ?? 22;
  const fontColor = opts?.fontColor ?? "white";

  const videoPath = await downloadToTemp(videoUrl, "mp4");
  const srtName = `subs-${Date.now()}-${Math.random().toString(36).slice(2)}.srt`;
  const srtPath = path.join(os.tmpdir(), srtName);
  const outName = `ffmpeg-subs-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    const hasAudio = await hasAudioTrack(videoPath);
    await fs.writeFile(srtPath, generateSRT(entries), "utf8");

    // FFmpeg filtergraph escaping: backslash → \\, colon → \:, comma → \,, single-quote → \'
    const escapedSrtPath = srtPath
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,")
      .replace(/'/g, "\\'");
    const subsFilter = `subtitles='${escapedSrtPath}':force_style='FontSize=${fontSize},PrimaryColour=&H${cssColorToASSHex(fontColor)}&'`;
    const args = [
      "-i", videoPath,
      "-vf", subsFilter,
      "-c:v", "libx264", "-preset", "fast",
      ...(hasAudio ? ["-c:a", "copy"] : []),
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg subtitle burn failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/subtitled-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(srtPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

/** CSS color → ASS colour hex `BBGGRR` (ASS is BGR, not RGB). Accepts named colors,
 *  #RGB / #RRGGBB / #RRGGBBAA (alpha ignored here — see cssColorToASSAlpha), and
 *  rgb()/rgba(). Falls back to white on anything unparseable. */
export function cssColorToASSHex(color: string): string {
  const MAP: Record<string, string> = {
    white: "FFFFFF", yellow: "00FFFF", red: "0000FF", blue: "FF0000",
    green: "00FF00", black: "000000", orange: "0080FF",
  };
  const c = (color ?? "").trim().toLowerCase();
  if (MAP[c]) return MAP[c];
  const hex = c.replace(/^#/, "");
  const dup = (s: string) => (s.length === 1 ? s + s : s);
  if (/^[0-9a-f]{3}$/.test(hex)) {
    const r = dup(hex[0]), g = dup(hex[1]), b = dup(hex[2]);
    return (b + g + r).toUpperCase();
  }
  if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
    return (hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2)).toUpperCase();
  }
  const m = c.match(/^rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((s) => parseFloat(s.trim()));
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, "0");
    if (p.length >= 3) return (h(p[2]) + h(p[1]) + h(p[0])).toUpperCase();
  }
  return "FFFFFF";
}

/** Alpha of a CSS color → ASS alpha hex. NOTE: ASS alpha is inverted vs CSS —
 *  `00` = fully opaque, `FF` = fully transparent. Returns `00` (opaque) when no
 *  alpha is present (#RRGGBB, named, rgb()). */
export function cssColorToASSAlpha(color: string): string {
  const c = (color ?? "").trim().toLowerCase();
  const hex = c.replace(/^#/, "");
  if (/^[0-9a-f]{8}$/.test(hex)) {
    const a = parseInt(hex.slice(6, 8), 16); // CSS: FF = opaque
    return (255 - a).toString(16).padStart(2, "0").toUpperCase();
  }
  const m = c.match(/^rgba\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((s) => s.trim());
    if (p.length >= 4) {
      const a = Math.max(0, Math.min(255, Math.round(parseFloat(p[3]) * 255)));
      return (255 - a).toString(16).padStart(2, "0").toUpperCase();
    }
  }
  return "00";
}

// ── ASS Motion Subtitles ──────────────────────────────────────────────────────

export type SubtitleMotionStyle = "fade" | "roll" | "karaoke" | "bounce";

export function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  // Math.round can produce 100 for values like 0.999999; clamp to 99 to keep 2-digit ASS format
  const cs = Math.min(99, Math.round((seconds % 1) * 100));
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function escapeASSText(raw: string): string {
  // In ASS Dialogue text fields, { } delimit override tag blocks.
  // Escape { and } so user text cannot inject ASS control tags.
  return raw.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

function buildASSDialogue(entry: SubtitleEntry, style: SubtitleMotionStyle): string {
  const text = escapeASSText(entry.text);
  let effectTags: string;
  switch (style) {
    case "fade":
      effectTags = "{\\fad(250,250)}";
      break;
    case "roll":
      // Slide in from right (off-screen) to resting position in 400ms, fade out
      effectTags = "{\\an2\\move(1920,1050,960,1050,0,400)\\fad(0,300)}";
      break;
    case "karaoke": {
      // Split on the original text BEFORE escaping so that \n boundaries become word boundaries.
      const rawWords = entry.text.split(/[\s\n]+/).filter(Boolean);
      if (rawWords.length === 0) { effectTags = "{\\fad(200,200)}"; break; }
      const durMs = (entry.end - entry.start) * 1000;
      const csPerWord = Math.max(1, Math.round((durMs / 10) / rawWords.length));
      return `Dialogue: 0,${formatASSTime(entry.start)},${formatASSTime(entry.end)},Default,,0,0,0,,${rawWords.map((w) => `{\\kf${csPerWord}}${escapeASSText(w)}`).join(" ")}`;
    }
    case "bounce":
      // Pop in with scale bounce then fade out
      effectTags = "{\\fad(0,200)\\t(0,200,\\fscx120\\fscy120)\\t(200,400,\\fscx100\\fscy100)}";
      break;
    default:
      effectTags = "{\\fad(200,200)}";
  }
  return `Dialogue: 0,${formatASSTime(entry.start)},${formatASSTime(entry.end)},Default,,0,0,0,,${effectTags}${text}`;
}

function generateASS(entries: SubtitleEntry[], style: SubtitleMotionStyle, fontSize: number, fontColor: string): string {
  const assHex = cssColorToASSHex(fontColor);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00${assHex},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,10,10,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  return header + "\n" + entries.map((e) => buildASSDialogue(e, style)).join("\n");
}

export interface BurnMotionSubtitleOptions {
  motionStyle?: SubtitleMotionStyle;
  fontSize?: number;
  fontColor?: string;
}

export async function burnAssSubtitles(
  videoUrl: string,
  entries: SubtitleEntry[],
  opts?: BurnMotionSubtitleOptions,
): Promise<{ url: string }> {
  const style = opts?.motionStyle ?? "fade";
  const fontSize = opts?.fontSize ?? 22;
  const fontColor = opts?.fontColor ?? "white";

  const videoPath = await downloadToTemp(videoUrl, "mp4");
  const assName = `subs-ass-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`;
  const assPath = path.join(os.tmpdir(), assName);
  const outName = `ffmpeg-motion-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    const hasAudio = await hasAudioTrack(videoPath);
    await fs.writeFile(assPath, generateASS(entries, style, fontSize, fontColor), "utf8");

    const escapedAssPath = assPath
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,")
      .replace(/'/g, "\\'");
    const args = [
      "-i", videoPath,
      "-vf", `ass='${escapedAssPath}'`,
      "-c:v", "libx264", "-preset", "fast",
      ...(hasAudio ? ["-c:a", "copy"] : []),
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg ASS burn failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/motion-sub-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(assPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Smart Cut (multi-segment extraction) ──────────────────────────────────────

export interface SmartCutOptions {
  inputUrl: string;
  keepSegments: Array<{ start: number; end: number }>;
}

export interface SmartCutResult {
  url: string;
  outputDuration: number;
}

export async function hasAudioTrack(videoPath: string): Promise<boolean> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_streams",
      "-select_streams", "a", videoPath,
    ]));
  } catch {
    // ffprobe unavailable or crashed — assume audio exists so the audio
    // filter path is attempted; FFmpeg will fail with a clear error if the
    // video truly has no audio track, which is preferable to silently
    // dropping the audio track when probing fails.
    return true;
  }
  try {
    const probe = JSON.parse(stdout) as { streams?: unknown[] };
    return Array.isArray(probe.streams) && probe.streams.length > 0;
  } catch {
    return true;
  }
}

/**
 * Probe a media file for both video and audio stream presence in a single
 * ffprobe call. Used by the editor composer to skip clips that claim to be
 * "video" but carry no real video stream (e.g. an audio file dragged onto a
 * video track, or a corrupt source) — such clips otherwise make the
 * `-filter_complex` graph reference a non-existent `[i:v]` pad, producing an
 * empty video output and the opaque "Could not open encoder before EOF" /
 * code -22 failure at the libx264 stage.
 *
 * On probe failure we report `hasVideo:true` (conservative — let ffmpeg try
 * and surface its own error) but `hasAudio:false` is NOT assumed; we mirror
 * hasAudioTrack's conservative true so the audio path is attempted.
 */
export async function probeStreams(filePath: string): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_streams", filePath,
    ]));
  } catch {
    return { hasVideo: true, hasAudio: true };
  }
  try {
    const probe = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> };
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    return {
      hasVideo: streams.some((s) => s.codec_type === "video"),
      hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
  } catch {
    return { hasVideo: true, hasAudio: true };
  }
}

export async function smartCutVideo(opts: SmartCutOptions): Promise<SmartCutResult> {
  if (opts.keepSegments.length === 0) throw new Error("keepSegments 不能为空");

  const videoPath = await downloadToTemp(opts.inputUrl, "mp4");
  const outName = `ffmpeg-smartcut-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    const hasAudio = await hasAudioTrack(videoPath);
    const n = opts.keepSegments.length;
    const filterParts: string[] = [];

    if (n === 1) {
      // split=1 and concat=n=1 are both invalid in FFmpeg — handle single-segment as direct trim.
      const { start, end } = opts.keepSegments[0];
      filterParts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[outv]`);
      if (hasAudio) {
        filterParts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[outa]`);
      }
    } else {
      // FFmpeg stream labels can only be used as filter input once.
      // Use split/asplit to fan out N independent copies before trimming.
      const vSplitOutputs = Array.from({ length: n }, (_, i) => `[vs${i}]`).join("");
      filterParts.push(`[0:v]split=${n}${vSplitOutputs}`);
      if (hasAudio) {
        const aSplitOutputs = Array.from({ length: n }, (_, i) => `[as${i}]`).join("");
        filterParts.push(`[0:a]asplit=${n}${aSplitOutputs}`);
      }

      let concatInputs = "";
      for (let i = 0; i < n; i++) {
        const { start, end } = opts.keepSegments[i];
        filterParts.push(`[vs${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
        if (hasAudio) {
          filterParts.push(`[as${i}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
          concatInputs += `[v${i}][a${i}]`;
        } else {
          concatInputs += `[v${i}]`;
        }
      }
      if (hasAudio) {
        filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`);
      } else {
        filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=0[outv]`);
      }
    }

    const args = [
      "-i", videoPath,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]",
      ...(hasAudio ? ["-map", "[outa]", "-c:a", "aac"] : []),
      "-c:v", "libx264", "-preset", "fast",
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg smart cut failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    await assertObjectStorageWritable();
    const { url } = await storagePut(`generated/smartcut-${Date.now()}.mp4`, outBuffer, "video/mp4");
    const outputDuration = opts.keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    return { url, outputDuration };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────

type OverlayMode = "watermark" | "pip" | "color_correction";

export interface OverlayOptions {
  inputUrl: string;
  mode: OverlayMode;
  // Watermark
  overlayImageUrl?: string;
  overlayPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  overlayScale?: number;
  overlayOpacity?: number;
  // PiP
  pipVideoUrl?: string;
  pipPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  pipScale?: number;
  // Color correction
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export async function overlayVideo(opts: OverlayOptions): Promise<{ url: string }> {
  const inputPath = await downloadToTemp(opts.inputUrl, "mp4");
  const outputPath = path.join(os.tmpdir(), `overlay-out-${Date.now()}.mp4`);
  const tempFiles = [inputPath, outputPath];

  try {
    if (opts.mode === "watermark" && opts.overlayImageUrl) {
      const overlayPath = await downloadToTemp(opts.overlayImageUrl, "png");
      tempFiles.push(overlayPath);

      const posMap: Record<string, string> = {
        "top-left": "10:10",
        "top-right": "W-w-10:10",
        "bottom-left": "10:H-h-10",
        "bottom-right": "W-w-10:H-h-10",
        "center": "(W-w)/2:(H-h)/2",
      };
      const xy = posMap[opts.overlayPosition ?? "bottom-right"];
      const scale = opts.overlayScale ?? 0.2;
      const opacity = opts.overlayOpacity ?? 1.0;

      // -2 ensures even dimensions required by libx264; -map 0:a? passes audio only if present
      const overlayFilter = opacity < 1.0
        ? `[1:v]scale=iw*${scale}:-2,format=rgba,colorchannelmixer=aa=${opacity}[ovr];[0:v][ovr]overlay=${xy}`
        : `[1:v]scale=iw*${scale}:-2[ovr];[0:v][ovr]overlay=${xy}`;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath, "-i", overlayPath,
          "-filter_complex", overlayFilter,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg watermark overlay failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else if (opts.mode === "pip" && opts.pipVideoUrl) {
      const pipPath = await downloadToTemp(opts.pipVideoUrl, "mp4");
      tempFiles.push(pipPath);

      const posMap: Record<string, string> = {
        "top-left": "10:10",
        "top-right": "W-w-10:10",
        "bottom-left": "10:H-h-10",
        "bottom-right": "W-w-10:H-h-10",
      };
      const xy = posMap[opts.pipPosition ?? "bottom-right"];
      const scale = opts.pipScale ?? 0.25;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath, "-i", pipPath,
          "-filter_complex", `[1:v]scale=iw*${scale}:-2[pip];[0:v][pip]overlay=${xy}`,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg PiP overlay failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else if (opts.mode === "color_correction") {
      const brightness = opts.brightness ?? 0;
      const contrast = opts.contrast ?? 1.0;
      const saturation = opts.saturation ?? 1.0;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath,
          "-vf", `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg color correction failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else {
      throw new Error("无效的叠加模式或缺少参数");
    }

    const buf = await fs.readFile(outputPath);
    const key = `overlay-${Date.now()}.mp4`;
    await assertObjectStorageWritable();
    const { url } = await storagePut(key, buf, "video/mp4");
    return { url };
  } finally {
    await Promise.all(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
  }
}

export async function getVideoDuration(url: string): Promise<number> {
  let tmpPath: string | null = null;

  try {
    tmpPath = await downloadToTemp(url, "mp4");

    const args = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      tmpPath,
    ];

    let stdout = "";
    try {
      const result = await execFileAsync("ffprobe", args);
      stdout = result.stdout ?? "";
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      throw new Error(
        `ffprobe failed: ${execErr.stderr ?? execErr.message ?? String(err)}`
      );
    }

    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) {
      throw new Error(`ffprobe returned non-numeric duration: ${stdout.trim()}`);
    }

    return duration;
  } finally {
    if (tmpPath) {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  }
}
