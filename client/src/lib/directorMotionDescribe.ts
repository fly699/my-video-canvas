// #341 导演台批9：运镜数据 → 自然语言运镜描述（中文提示词闭环）。
// 输入 timelineToExportData 产出的逐帧相机轨迹，反推运镜语义（推近/拉远/环绕/升降/
// 横移/跟拍/甩镜/变焦推/手持/固定机位，可组合），拼成可直接喂给生视频模型的中文
// 运镜提示词。纯函数、无副作用，供 UI「生成运镜提示词」与单测共用。
//
// 语义还原与 presetMoveToKeyframes 的 12 种预设互为镜像：预设生成的轨迹必须被这里
// 分类回其本义（单测据此锁定），手工 K 帧的轨迹也按同一套特征归类。

import type { DirectorExportData, Vec3 } from "../../../shared/types";

type CamKf = { t: number; position: Vec3; target: Vec3; fov: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const lenXZ = (v: Vec3) => Math.hypot(v[0], v[2]);

/** 逐帧水平方位角（机位绕注视点，atan2(x,z)）做 unwrap 累计，返回总扫角（度，带符号）。 */
function sweepDeg(kfs: CamKf[], of: (k: CamKf) => Vec3): number {
  let acc = 0;
  let prev: number | null = null;
  for (const k of kfs) {
    const rel = of(k);
    if (lenXZ(rel) < 1e-4) continue; // 正上方/重合帧跳过，方位角无意义
    const ang = Math.atan2(rel[0], rel[2]);
    if (prev != null) {
      let d = ang - prev;
      while (d > Math.PI) d -= Math.PI * 2;   // unwrap 到 (-π, π]
      while (d <= -Math.PI) d += Math.PI * 2;
      acc += d;
    }
    prev = ang;
  }
  return (acc * 180) / Math.PI;
}

/** 机位轨迹总路径长 vs 净位移（手持抖动 = 路径远大于净位移的小幅高频运动）。 */
function pathStats(kfs: CamKf[]): { pathLen: number; netMove: number } {
  let pathLen = 0;
  for (let i = 1; i < kfs.length; i++) pathLen += len(sub(kfs[i].position, kfs[i - 1].position));
  return { pathLen, netMove: len(sub(kfs[kfs.length - 1].position, kfs[0].position)) };
}

/**
 * 单机位轨迹 → 中文运镜短语（可组合，如「下降 1.5 米并向主体推近约 50%」）。
 * 帧数 < 2 或全程静止 → 「固定机位」。
 */
export function describeCameraTrack(kfs: CamKf[]): string {
  if (!kfs || kfs.length < 2) return "固定机位";
  const first = kfs[0];
  const last = kfs[kfs.length - 1];

  const rel0 = sub(first.position, first.target);
  const rel1 = sub(last.position, last.target);
  const r0 = len(rel0);
  const r1 = len(rel1);
  const dy = last.position[1] - first.position[1];
  const dFov = last.fov - first.fov;
  const { pathLen, netMove } = pathStats(kfs);
  const posMoveXZ = lenXZ(sub(last.position, first.position));
  const tgtMove = len(sub(last.target, first.target));
  const camSweep = sweepDeg(kfs, (k) => sub(k.position, k.target));       // 机位绕注视点
  const focusSweep = sweepDeg(kfs, (k) => sub(k.target, k.position));     // 焦点绕机位（甩镜）

  // 手持抖动：净位移很小但路径来回折返（多频抖动路径长 ≫ 净位移）。
  if (netMove < 0.5 && pathLen > Math.max(0.2, netMove * 3) && Math.abs(camSweep) < 60) {
    return "手持微晃镜头（轻微自然抖动）";
  }

  const parts: string[] = [];

  // 环绕/弧线（机位绕主体扫角主导）
  const absSweep = Math.abs(camSweep);
  if (absSweep >= 300) {
    parts.push("围绕主体 360° 环绕");
  } else if (absSweep >= 100) {
    parts.push(`绕主体弧线运动约 ${Math.round(absSweep)}°`);
  }

  // 推近/拉远（径向距离变化 ≥15%）
  const radial = r0 > 1e-3 ? r1 / r0 : 1;
  const dollyIn = radial < 0.85;
  const dollyOut = radial > 1.15;
  if (dollyIn && dFov > 5) {
    parts.push(`希区柯克变焦推（推近 ${Math.round((1 - radial) * 100)}% 同时视角变广，主体大小不变、背景透视拉伸）`);
  } else if (dollyIn) {
    parts.push(`向主体推近约 ${Math.round((1 - radial) * 100)}%`);
  } else if (dollyOut) {
    parts.push(`从主体拉远约 ${Math.round((radial - 1) * 100)}%`);
  }

  // 升降
  if (dy > 0.4) parts.push(`升高 ${dy.toFixed(1)} 米`);
  else if (dy < -0.4) parts.push(`下降 ${(-dy).toFixed(1)} 米`);

  // 横移/跟拍（水平位移主导且非环绕/推拉解释掉的）
  if (absSweep < 100 && !dollyIn && !dollyOut && posMoveXZ > 0.5) {
    if (tgtMove > 0.5) parts.push(`跟随主体同步横移 ${posMoveXZ.toFixed(1)} 米（跟拍，保持构图）`);
    else parts.push(`水平横移 ${posMoveXZ.toFixed(1)} 米`);
  }

  // 甩镜：机位基本不动、焦点快速水平扫过
  if (netMove < 0.2 && Math.abs(focusSweep) >= 25) {
    parts.push(`快速甩镜水平扫过约 ${Math.round(Math.abs(focusSweep))}°`);
  }

  // 纯变焦（FOV 变了但没被变焦推吸收）
  if (Math.abs(dFov) > 5 && !(dollyIn && dFov > 5)) {
    parts.push(`视角从 ${Math.round(first.fov)}° ${dFov > 0 ? "变广至" : "收窄至"} ${Math.round(last.fov)}°（变焦）`);
  }

  return parts.length ? `镜头${parts.join("，")}` : "固定机位";
}

/**
 * 导出数据整体 → 运镜提示词（多机位逐条 + 节目流切点表 + 时长）。
 * camNames：机位 id → 显示名（缺省「机位」）。产出可直接粘贴进视频提示词。
 */
export function describeMotionExport(
  data: DirectorExportData,
  camNames?: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`【运镜】总时长 ${data.duration}s：`);
  for (const cam of data.camera) {
    const name = (cam.id && camNames?.[cam.id]) || "机位";
    lines.push(`- ${name}：${describeCameraTrack(cam.keyframes)}`);
  }
  if (data.camera.length === 0) lines.push("- 固定机位");
  if (data.program && data.program.cuts.length > 1) {
    const cuts = data.program.cuts
      .map((c) => `${c.t.toFixed(1)}s ${(c.cameraId && camNames?.[c.cameraId]) || c.cameraId}`)
      .join(" → ");
    lines.push(`【多机位剪辑】按时间切换视角：${cuts}（硬切）`);
  }
  return lines.join("\n");
}
