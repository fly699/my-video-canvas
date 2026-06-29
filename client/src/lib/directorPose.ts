// 导演台姿势：关节定义（与 Mannequin 的命名关节一一对应）+ 动作预设库。
// 姿势用「命名关节角度(度)」FK 表达，写入 actor.pose；Mannequin 直接读取旋转对应 group。
// 理念（见 LibTV 文档）：只需摆大概姿势，AI 会脑补细节——故预设为起点，滑杆精调。

export interface JointDef { key: string; label: string; min: number; max: number; }

export const JOINT_GROUPS: { group: string; joints: JointDef[] }[] = [
  { group: "躯干", joints: [
    { key: "torsoForward", label: "前倾", min: -40, max: 50 },
    { key: "torsoTwist", label: "扭转", min: -70, max: 70 },
    { key: "torsoSide", label: "侧倾", min: -35, max: 35 },
  ] },
  { group: "头部", joints: [
    { key: "headNod", label: "点头", min: -40, max: 40 },
    { key: "headTurn", label: "转头", min: -75, max: 75 },
    { key: "headTilt", label: "歪头", min: -40, max: 40 },
  ] },
  { group: "左臂", joints: [
    { key: "armLForward", label: "前举", min: -180, max: 90 },
    { key: "armLOut", label: "外展", min: -12, max: 160 },
    { key: "elbowL", label: "屈肘", min: -10, max: 150 },
  ] },
  { group: "右臂", joints: [
    { key: "armRForward", label: "前举", min: -180, max: 90 },
    { key: "armROut", label: "外展", min: -12, max: 160 },
    { key: "elbowR", label: "屈肘", min: -10, max: 150 },
  ] },
  { group: "左腿", joints: [
    { key: "legLForward", label: "抬腿", min: -60, max: 110 },
    { key: "legLOut", label: "外展", min: -25, max: 45 },
    { key: "kneeL", label: "屈膝", min: 0, max: 150 },
  ] },
  { group: "右腿", joints: [
    { key: "legRForward", label: "抬腿", min: -60, max: 110 },
    { key: "legROut", label: "外展", min: -25, max: 45 },
    { key: "kneeR", label: "屈膝", min: 0, max: 150 },
  ] },
];

export const ALL_JOINT_KEYS = JOINT_GROUPS.flatMap((g) => g.joints.map((j) => j.key));

export type Pose = Record<string, number>;

// 动作预设（部分关节，未列出的归零）。值为「大概姿势」，对称处尽量对称以降低观感风险。
export const POSE_PRESETS: { key: string; label: string; pose: Pose }[] = [
  { key: "stand",   label: "站立", pose: {} },
  { key: "tpose",   label: "T 型", pose: { armLOut: 78, armROut: 78 } },
  { key: "handsup", label: "举手", pose: { armLForward: -160, armROut: 12, armLOut: 6, armRForward: -160 } },
  { key: "walk",    label: "行走", pose: { legLForward: 22, legRForward: -22, kneeL: 12, kneeR: 18, armLForward: -22, armRForward: 22, elbowL: 28, elbowR: 28 } },
  { key: "run",     label: "跑步", pose: { torsoForward: 18, legLForward: 48, legRForward: -32, kneeL: 28, kneeR: 70, armLForward: -55, armRForward: 50, elbowL: 85, elbowR: 85 } },
  { key: "sit",     label: "坐姿", pose: { legLForward: 90, legRForward: 90, kneeL: 92, kneeR: 92 } },
  { key: "crouch",  label: "蹲下", pose: { torsoForward: 22, legLForward: 78, legRForward: 78, kneeL: 115, kneeR: 115 } },
  { key: "kneel",   label: "单膝跪", pose: { legLForward: 60, kneeL: 120, legRForward: 80, kneeR: 95, torsoForward: 8 } },
  { key: "fight",   label: "格斗", pose: { torsoForward: 10, torsoTwist: 18, armLForward: -42, elbowL: 95, armRForward: -65, elbowR: 110, legLForward: 16, legRForward: -16, kneeL: 22, kneeR: 22 } },
  { key: "think",   label: "思考", pose: { headNod: 8, armRForward: -70, elbowR: 130, armROut: 6, armLOut: -6 } },
  { key: "wave",    label: "招手", pose: { armRForward: -120, elbowR: 40, armROut: 20 } },
  { key: "phone",   label: "看手机", pose: { headNod: 22, armLForward: -55, elbowL: 95, armRForward: -55, elbowR: 95 } },
];

export function applyPosePreset(presetKey: string): Pose {
  const p = POSE_PRESETS.find((x) => x.key === presetKey);
  if (!p) return {};
  // 归一化：未列关节显式置 0，避免叠加上一个预设的残留角度。
  const pose: Pose = {};
  for (const k of ALL_JOINT_KEYS) pose[k] = p.pose[k] ?? 0;
  return pose;
}
