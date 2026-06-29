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

// 动作预设（部分关节，未列出的归零）。约定：前举/抬腿 正值=向前，屈肘 正值=前屈，
// 屈膝 正值=后屈；外展(armOut) 正值=向外抬起。摆个大概即可，AI 会脑补细节。
export const POSE_PRESETS: { key: string; label: string; pose: Pose }[] = [
  { key: "stand",   label: "站立", pose: {} },
  { key: "tpose",   label: "T 型", pose: { armLOut: 78, armROut: 78 } },
  { key: "handsup", label: "举手", pose: { armLOut: 160, armROut: 160 } },
  { key: "walk",    label: "行走", pose: { legLForward: 22, legRForward: -22, kneeR: 16, armLForward: -22, armRForward: 22, elbowL: 22, elbowR: 22 } },
  { key: "run",     label: "跑步", pose: { torsoForward: 18, legLForward: 45, legRForward: -30, kneeL: 25, kneeR: 65, armLForward: -50, armRForward: 50, elbowL: 80, elbowR: 80 } },
  { key: "sit",     label: "坐姿", pose: { legLForward: 90, legRForward: 90, kneeL: 90, kneeR: 90 } },
  { key: "crouch",  label: "蹲下", pose: { torsoForward: 20, legLForward: 75, legRForward: 75, kneeL: 115, kneeR: 115 } },
  { key: "kneel",   label: "单膝跪", pose: { legLForward: 60, kneeL: 120, legRForward: 80, kneeR: 95, torsoForward: 8 } },
  { key: "fight",   label: "格斗", pose: { torsoForward: 10, torsoTwist: 18, armLForward: 42, elbowL: 95, armRForward: 60, elbowR: 110, legLForward: 16, legRForward: -16, kneeL: 22, kneeR: 22 } },
  { key: "think",   label: "思考", pose: { headNod: 8, armRForward: 65, elbowR: 125, armROut: 6 } },
  { key: "wave",    label: "招手", pose: { armROut: 135, elbowR: 45 } },
  { key: "phone",   label: "看手机", pose: { headNod: 22, armLForward: 55, elbowL: 95, armRForward: 55, elbowR: 95 } },
];

export function applyPosePreset(presetKey: string): Pose {
  const p = POSE_PRESETS.find((x) => x.key === presetKey);
  if (!p) return {};
  // 归一化：未列关节显式置 0，避免叠加上一个预设的残留角度。
  const pose: Pose = {};
  for (const k of ALL_JOINT_KEYS) pose[k] = p.pose[k] ?? 0;
  return pose;
}
