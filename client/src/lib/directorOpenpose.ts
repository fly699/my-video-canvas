// 导演台「像素级 OpenPose 骨架控制图」（③ 硬结构句柄）。
//
// 我们的差异化：人偶骑在真实的 Mixamo 骨架上（骨名 `mixamorigLeftArm` 等），
// 于是可以取【真实 3D 关节世界坐标】投影到屏幕，画出与最终取景像素级对齐的 OpenPose
// 骨架图，直接注入下游 ComfyUI ControlNet（openpose）。这比从 2D 图估计骨架精确得多——
// 姿态是「硬约束」，而非「提示词祈祷」。
//
// 采用 OpenPose COCO-18 关键点布局与其标准配色/连线（ControlNet openpose 预处理器同款），
// 因此 preprocessor 置空即可直接当作已处理好的控制图使用。

import * as THREE from "three";

// COCO-18 关键点 → Mixamo 骨名（均为「人物自身」左右，与 OpenPose 的 L/R 语义一致）。
// 面部点(14-17 眼/耳)由头部关键点在屏幕空间近似派生（xbot 无独立眼骨）。
export const OPENPOSE_BONES: (string | null)[] = [
  "Head",         // 0  nose（近似取头骨原点）
  "Neck",         // 1  neck
  "RightArm",     // 2  右肩
  "RightForeArm", // 3  右肘
  "RightHand",    // 4  右腕
  "LeftArm",      // 5  左肩
  "LeftForeArm",  // 6  左肘
  "LeftHand",     // 7  左腕
  "RightUpLeg",   // 8  右髋
  "RightLeg",     // 9  右膝
  "RightFoot",    // 10 右踝
  "LeftUpLeg",    // 11 左髋
  "LeftLeg",      // 12 左膝
  "LeftFoot",     // 13 左踝
  null,           // 14 右眼（派生）
  null,           // 15 左眼（派生）
  null,           // 16 右耳（派生）
  null,           // 17 左耳（派生）
];

// OpenPose 标准连线（0-indexed 关键点对），第 i 条肢体用 OPENPOSE_COLORS[i] 着色。
export const OPENPOSE_PAIRS: [number, number][] = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];

// OpenPose 18 色标准调色板（RGB）。
export const OPENPOSE_COLORS: [number, number, number][] = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0],
  [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255],
  [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

export type Pt = { x: number; y: number };

/** NDC(-1..1) → 画布像素坐标；z 落在 [-1,1] 之外(相机背后/超远)记为不可见。纯函数，可单测。 */
export function ndcToPixel(ndc: THREE.Vector3, w: number, h: number): { x: number; y: number; visible: boolean } {
  return {
    x: (ndc.x * 0.5 + 0.5) * w,
    y: (1 - (ndc.y * 0.5 + 0.5)) * h,
    visible: ndc.z > -1 && ndc.z < 1,
  };
}

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** 取单个角色的 18 关键点屏幕坐标（缺失/背对相机的点为 null）。派生面部点。 */
export function actorKeypoints(root: THREE.Object3D, camera: THREE.Camera, w: number, h: number): (Pt | null)[] {
  const v = new THREE.Vector3();
  const pt = (boneName: string): Pt | null => {
    const b = root.getObjectByName("mixamorig" + boneName);
    if (!b) return null;
    b.getWorldPosition(v);
    v.project(camera);
    const p = ndcToPixel(v, w, h);
    return p.visible ? { x: p.x, y: p.y } : null;
  };
  const kp: (Pt | null)[] = OPENPOSE_BONES.map((bn) => (bn ? pt(bn) : null));
  // 眼/耳由「鼻(头)」在屏幕上向两侧小偏移派生，偏移量按 头↔颈 屏幕距离自适应（远近一致）。
  const nose = kp[0], neck = kp[1];
  if (nose) {
    const span = neck ? Math.hypot(nose.x - neck.x, nose.y - neck.y) : h * 0.05;
    const e = Math.max(3, span * 0.22);
    kp[14] = { x: nose.x - e, y: nose.y - e * 0.4 };      // 右眼
    kp[15] = { x: nose.x + e, y: nose.y - e * 0.4 };      // 左眼
    kp[16] = { x: nose.x - e * 2, y: nose.y };            // 右耳
    kp[17] = { x: nose.x + e * 2, y: nose.y };            // 左耳
  }
  return kp;
}

/**
 * 把若干角色的 OpenPose 骨架画到 2D 画布（黑底 + 彩色棒 + 彩色关节点）。
 * 返回实际画出的关节点总数（0 = 无可用骨架，调用方据此判失败）。
 */
export function drawOpenpose(
  ctx: CanvasRenderingContext2D,
  actorRoots: THREE.Object3D[],
  camera: THREE.Camera,
  w: number,
  h: number,
): number {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const stroke = Math.max(2, Math.round(w / 128));
  const radius = Math.max(2, Math.round(w / 120));
  ctx.lineCap = "round";
  let drawn = 0;
  for (const root of actorRoots) {
    const kp = actorKeypoints(root, camera, w, h);
    OPENPOSE_PAIRS.forEach((pair, i) => {
      const a = kp[pair[0]], b = kp[pair[1]];
      if (!a || !b) return;
      ctx.strokeStyle = rgb(OPENPOSE_COLORS[i % OPENPOSE_COLORS.length], 0.9);
      ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    kp.forEach((p, i) => {
      if (!p) return;
      ctx.fillStyle = rgb(OPENPOSE_COLORS[i % OPENPOSE_COLORS.length]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      drawn++;
    });
  }
  return drawn;
}
