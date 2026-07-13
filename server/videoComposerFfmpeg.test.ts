import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFilterGraph, type Segment, type OverlayInput, type AudioInput } from "./_core/videoComposer";

// 真机 ffmpeg 集成回归：把 buildFilterGraph 产出的完整滤镜图喂给真 ffmpeg 渲到 null，
// 抓「字符串级单测抓不到」的滤镜语法/图结构回归（CLAUDE.md：导出滤镜必须真机验证）。
// 无 ffmpeg 的环境（CI/开发机）自动跳过，不影响常规测试。
const exec = promisify(execFile);

let hasFfmpeg = false;
try { const { execFileSync } = await import("node:child_process"); execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); hasFfmpeg = true; } catch { hasFfmpeg = false; }

const d = describe.skipIf(!hasFfmpeg);

let dir: string;
let avPath: string; // 0.6s 64x48 带音频的小 mp4，充当所有真实输入

beforeAll(async () => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vc-ffm-"));
  avPath = join(dir, "av.mp4");
  await exec("ffmpeg", ["-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=0.6", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.6", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", avPath], { timeout: 30_000 });
  return () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };
}, 40_000);

/** 跑一张图：inputSpecs 按滤镜图的输入序（seg→overlay→audio）排列。断言 ffmpeg 退出 0。 */
async function render(graph: { filterComplex: string; outV: string; outA: string }, inputSpecs: string[][]): Promise<void> {
  const args = [...inputSpecs.flat(), "-filter_complex", graph.filterComplex, "-map", graph.outV, "-map", graph.outA, "-f", "null", "-", "-y"];
  await exec("ffmpeg", ["-hide_banner", "-v", "error", ...args], { timeout: 60_000 });
}

const OPTS = { width: 128, height: 96, fps: 10 };
const av = () => ["-i", avPath];

d("buildFilterGraph × 真机 ffmpeg（音频/转场/叠加全链路）", () => {
  it("转场 xfade + acrossfade（含变速 0.25×/4× 的 atempo 链）", async () => {
    const segs: Segment[] = [
      { isImage: false, hasAudio: true, trimIn: 0, trimOut: 0.5, speed: 0.25, fadeIn: 0.2 },           // 0.5s 源 → 2s，atempo 0.25 需链式
      { isImage: false, hasAudio: true, trimIn: 0, trimOut: 0.6, speed: 4, transition: { type: "dissolve", duration: 0.1 }, fadeOut: 0.05, fadeCurve: "qsin" },
    ];
    const g = buildFilterGraph(segs, OPTS);
    await render(g, [av(), av()]);
  }, 60_000);

  it("叠加层（chromaKey+mask+淡入淡出）+ 音频轨（ducking+denoise+adelay+变速）混音", async () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 0.6, speed: 1 }];
    const ov: OverlayInput = {
      isImage: false, trimIn: 0, trimOut: 0.4, speed: 1, start: 0.1, duration: 0.4,
      chromaKey: { color: "#00ff00" }, mask: { type: "ellipse", x: 0.2, y: 0.2, w: 0.6, h: 0.6, feather: 0.2 },
      fadeIn: 0.1, fadeOut: 0.1,
    };
    const audio: AudioInput[] = [
      { trimIn: 0, trimOut: 0.5, speed: 1, start: 0.05, volume: 0.8, fadeIn: 0.1, fadeOut: 0.1, ducking: true, denoise: true },  // BGM：降噪+闪避
      { trimIn: 0, trimOut: 0.4, speed: 2, start: 0, volume: 1.2, fadeIn: 0, fadeOut: 0 },                                        // 人声：变速
    ];
    const g = buildFilterGraph(segs, OPTS, [ov], { audioClips: audio });
    await render(g, [av(), av(), av(), av()]);
  }, 60_000);

  it("响度归一化 loudnorm + 整片首尾淡入淡出（finalize 链）", async () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 0.6, speed: 1 }];
    const g = buildFilterGraph(segs, { ...OPTS, normalizeAudio: true, masterFadeIn: 0.1, masterFadeOut: 0.1 }, [], { audioClips: [{ trimIn: 0, trimOut: 0.3, speed: 1, start: 0.2, volume: 1, fadeIn: 0, fadeOut: 0 }] });
    await render(g, [av(), av()]);
  }, 60_000);

  it("#137 动态样片形状：image 段 Ken-Burns 关键帧 + dissolve/fade 转场 + 逐镜音频对位", async () => {
    // buildAnimaticDoc 产出的 doc 经 composeTimeline 映射后的 Segment 形状（image 时长编码
    // trimIn=0/trimOut=秒数、fit=cover、keyframes 交替推拉、transition 取前镜转场）。
    const pngPath = join(dir, "kf.png");
    await exec("ffmpeg", ["-f", "lavfi", "-i", "testsrc=size=64x48:rate=1:duration=1", "-frames:v", "1", "-y", pngPath], { timeout: 30_000 });
    const segs: Segment[] = [
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 1, speed: 1, fit: "cover", keyframes: [{ t: 0, scale: 1, ease: "inout" }, { t: 1, scale: 1.08 }] },
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 0.8, speed: 1, fit: "cover", keyframes: [{ t: 0, scale: 1.08, ease: "inout" }, { t: 0.8, scale: 1 }], transition: { type: "dissolve", duration: 0.3 } },
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 0.8, speed: 1, fit: "cover", transition: { type: "fade", duration: 0.3 } },
    ];
    const img = (t: number) => ["-loop", "1", "-t", t.toFixed(3), "-i", pngPath];
    const g = buildFilterGraph(segs, OPTS, [], { audioClips: [{ trimIn: 0, trimOut: 0.5, speed: 1, start: 1, volume: 1, fadeIn: 0, fadeOut: 0 }] });
    await render(g, [img(1), img(0.8), img(0.8), av()]);
  }, 60_000);

  it("基轨黑场空隙段（lavfi 无音频→静音补齐）+ 绝对定位叠加/音频", async () => {
    const segs: Segment[] = [
      { isImage: false, hasAudio: false, trimIn: 0, trimOut: 0.3, speed: 1 }, // 黑场 gap（lavfi color 输入）
      { isImage: false, hasAudio: true, trimIn: 0, trimOut: 0.6, speed: 1 },
    ];
    const ov: OverlayInput = { isImage: false, trimIn: 0, trimOut: 0.3, speed: 1, start: 0.3, duration: 0.3 };
    const g = buildFilterGraph(segs, OPTS, [ov], { audioClips: [{ trimIn: 0, trimOut: 0.4, speed: 1, start: 0.3, volume: 1, fadeIn: 0, fadeOut: 0 }] });
    await render(g, [["-f", "lavfi", "-t", "0.3", "-i", "color=c=black:s=128x96:r=10"], av(), av(), av()]);
    expect(g.duration).toBeCloseTo(0.9, 3);
  }, 60_000);
});
