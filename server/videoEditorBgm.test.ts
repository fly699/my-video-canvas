// #139 合成片配乐超长 bug：mergeVideos 高级路径（转场/装配）amix 默认 duration=longest
// 且输出无 -shortest —— 超长配乐把成片拉长，画面播完后黑屏放音乐（用户实报）。
// 修复：配乐 atrim 到画面总长 + 尾部淡出；[aout] 统一 apad+atrim 对齐画面总长
// （不能用 -shortest：短音轨会反把画面裁短）。本文件：纯函数语义 + 真机 ffmpeg
// 复现验证（修复前滤镜确实拉长 / 修复后恒等于画面长；无 ffmpeg 的环境自动跳过）。
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bgmAlignChain, audioAlignTail } from "./_core/videoEditor";

const exec = promisify(execFile);

describe("bgmAlignChain / audioAlignTail（#139 纯函数语义）", () => {
  it("配乐链：atrim 裁到画面总长 + 尾部 ≤2s 淡出，输出 label [bgm]", () => {
    expect(bgmAlignChain("[2:a]", 10)).toBe("[2:a]atrim=0:10.000,afade=t=out:st=8.000:d=2.000,aresample=async=1[bgm]");
  });
  it("极短片：淡出取 1/4 片长（下限 0.2s），起点不为负", () => {
    expect(bgmAlignChain("[1:a]", 1)).toContain("afade=t=out:st=0.750:d=0.250");
    expect(bgmAlignChain("[1:a]", 0.4)).toContain("st=0.200:d=0.200");
    expect(bgmAlignChain("[1:a]", 0)).toContain("atrim=0:0.100"); // 总长钳制下限
  });
  it("对齐尾巴：apad 补静音到画面总长 + atrim 裁断", () => {
    expect(audioAlignTail(7.5)).toBe(",apad=whole_dur=7.500,atrim=0:7.500");
  });
});

// ── 真机 ffmpeg 复现与验证 ────────────────────────────────────────────────────
let hasFfmpeg = false;
try { const { execFileSync } = await import("node:child_process"); execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); hasFfmpeg = true; } catch { hasFfmpeg = false; }
const d = describe.skipIf(!hasFfmpeg);

async function probeDuration(p: string): Promise<number> {
  const r = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
  return parseFloat(r.stdout.trim()) || 0;
}

d("mergeVideos 配乐对齐 × 真机 ffmpeg", () => {
  it("复现旧 bug + 验证修复：10s 配乐混 2×1s 画面，旧滤镜成片≈10s、新滤镜恒=画面长", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bgm139-"));
    const v1 = join(dir, "v1.mp4"), v2 = join(dir, "v2.mp4"), music = join(dir, "m.m4a");
    // 两段 1s 带音轨小视频 + 一条 10s 音乐
    for (const [p, color] of [[v1, "red"], [v2, "blue"]] as const) {
      await exec("ffmpeg", ["-f", "lavfi", "-i", `color=${color}:s=64x48:d=1:r=10`, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", p], { timeout: 30_000 });
    }
    await exec("ffmpeg", ["-f", "lavfi", "-i", "sine=frequency=220:duration=10", "-c:a", "aac", "-y", music], { timeout: 30_000 });

    // 与 mergeVideos advanced 路径同构的滤镜（1 个 0.067s 硬切转场 → 画面总长 ≈ 1.933s）
    const cutDur = 1 / 15;
    const total = 1 + (1 - cutDur); // segStarts[1] + durations[1]
    const vChain = `[0:v][1:v]xfade=transition=fade:duration=${cutDur.toFixed(3)}:offset=${(1 - cutDur).toFixed(3)}[vout]`;
    const aCat = `;[0:a][1:a]acrossfade=d=${Math.min(cutDur, 0.5).toFixed(3)}[acat]`;

    // 旧滤镜（修复前）：音乐原样进 amix（默认 longest）、无对齐尾巴 → 成片被音乐拉长
    const oldOut = join(dir, "old.mp4");
    const oldFilter = `${vChain}${aCat};[acat][2:a]amix=inputs=2:normalize=0:weights=1.0000|0.3000,alimiter=limit=0.95[aout]`;
    await exec("ffmpeg", ["-i", v1, "-i", v2, "-i", music, "-filter_complex", oldFilter, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", oldOut], { timeout: 60_000 });
    const oldDur = await probeDuration(oldOut);
    expect(oldDur).toBeGreaterThan(8); // bug 复现：≈10s（画面只有 ~1.93s）

    // 新滤镜（修复后）：bgmAlignChain + audioAlignTail → 成片 ≈ 画面总长
    const newOut = join(dir, "new.mp4");
    const newFilter = `${vChain}${aCat};${bgmAlignChain("[2:a]", total)};[acat][bgm]amix=inputs=2:normalize=0:weights=1.0000|0.3000,alimiter=limit=0.95${audioAlignTail(total)}[aout]`;
    await exec("ffmpeg", ["-i", v1, "-i", v2, "-i", music, "-filter_complex", newFilter, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", newOut], { timeout: 60_000 });
    const newDur = await probeDuration(newOut);
    expect(Math.abs(newDur - total)).toBeLessThan(0.25);
  }, 120_000);

  it("音乐短于画面：apad 补齐，成片仍=画面总长（不被反向裁短）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bgm139b-"));
    const v1 = join(dir, "v1.mp4"), music = join(dir, "m.m4a");
    await exec("ffmpeg", ["-f", "lavfi", "-i", "color=green:s=64x48:d=4:r=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", v1], { timeout: 30_000 });
    await exec("ffmpeg", ["-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-c:a", "aac", "-y", music], { timeout: 30_000 });
    const out = join(dir, "out.mp4");
    const filter = `[0:v]copy[vout];[0:a]anull[acat];${bgmAlignChain("[1:a]", 4)};[acat][bgm]amix=inputs=2:normalize=0:weights=1.0000|0.3000,alimiter=limit=0.95${audioAlignTail(4)}[aout]`;
    await exec("ffmpeg", ["-i", v1, "-i", music, "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", out], { timeout: 60_000 });
    expect(Math.abs(await probeDuration(out) - 4)).toBeLessThan(0.25);
  }, 120_000);
});
