// #333 抽音时间轴保真回归测试（真 ffmpeg 集成测试，无 ffmpeg 环境自动跳过）。
//
// 背景：合并成片/云端生成的视频常见「音频流 start_time > 0」（起始延迟）。默认
// `ffmpeg -vn` 抽音会把音频平移到 0 开头、丢掉这段偏移——转录字幕整体提前
// （用户实报），音频分离产物与原视频对位同样前移。修复 = 抽音加
// `-af aresample=first_pts=0`（按输入时间轴补前置静音）。
// 本测试用「已知时间 beep 标记」量化锁定：延迟容器保真、普通容器零影响。
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
let hasFfmpeg = false;
try { await exec("ffmpeg", ["-version"]); hasFfmpeg = true; } catch { hasFfmpeg = false; }

/** silencedetect 找第一个 silence_end（= 首个 beep 起点，秒）。 */
async function firstBeepAt(file: string): Promise<number> {
  const { stderr } = await exec("ffmpeg", ["-i", file, "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-"]).catch((e) => e as { stderr: string });
  const m = /silence_end:\s*([\d.]+)/.exec(String(stderr));
  if (!m) throw new Error("no beep found");
  return Number(m[1]);
}

describe.skipIf(!hasFfmpeg)("#333 转录/音频分离抽音的时间轴保真（aresample=first_pts=0）", () => {
  const dir = mkdtempSync(join(tmpdir(), "sub-sync-"));
  const beeps = join(dir, "beeps.wav");
  const base = join(dir, "base.mp4");
  const delayed = join(dir, "delayed.mp4");
  // 与 voiceTranscription.ts 抽音命令保持同参（转录）；extractAudio 同滤镜不同码率，行为等价。
  const EXTRACT = ["-vn", "-af", "aresample=first_pts=0", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3"];

  beforeAll(async () => {
    // 20s 音轨：10s 处 1s beep；黑视频 mux 成 base；再造音频流延迟 3s 的 delayed
    await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-filter_complex", "[1:a]atrim=0:10[s1];[1:a]atrim=0:9[s2];[s1][0:a][s2]concat=n=3:v=0:a=1[out]", "-map", "[out]", "-t", "20", beeps]);
    await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=black:s=160x120:d=20:r=10", "-i", beeps, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", base]);
    await exec("ffmpeg", ["-y", "-i", base, "-itsoffset", "3", "-i", beeps, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", delayed]);
  }, 120000);

  it("音频流延迟 3s 的容器：抽音保留偏移（beep@≈13s，与播放器语义一致）", async () => {
    const out = join(dir, "delayed.mp3");
    await exec("ffmpeg", ["-y", "-i", delayed, ...EXTRACT, out]);
    const t = await firstBeepAt(out);
    expect(t).toBeGreaterThan(12.5);
    expect(t).toBeLessThan(13.5);
  }, 60000);

  it("普通无偏移容器：抽音时间不变（beep@≈10s，零影响守卫）", async () => {
    const out = join(dir, "base.mp3");
    await exec("ffmpeg", ["-y", "-i", base, ...EXTRACT, out]);
    const t = await firstBeepAt(out);
    expect(t).toBeGreaterThan(9.5);
    expect(t).toBeLessThan(10.5);
  }, 60000);

  it("回归对照：不带 first_pts=0 的旧命令在延迟容器上确实丢偏移（证明修复必要性）", async () => {
    const out = join(dir, "delayed_old.mp3");
    await exec("ffmpeg", ["-y", "-i", delayed, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", out]);
    const t = await firstBeepAt(out);
    expect(t).toBeLessThan(11); // 旧命令 beep 回到 ~10s（偏移丢失 → 字幕提前）
  }, 60000);
});
