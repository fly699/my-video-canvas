// 导演台姿势：关节定义 + 动作预设库。
// 姿势用「命名关节角度(度)」FK 表达，写入 actor.pose；HumanModel 把这些角度映射到
// Mixamo 骨骼旋转（轴向经真机实测，见 HumanModel.applyPose）。
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
  // 跑步：左腿前/右腿后，配对侧手臂(右前/左后)、肘弯近身——对侧摆臂才自然。
  { key: "run",     label: "跑步", pose: { torsoForward: 18, legLForward: 45, legRForward: -30, kneeL: 25, kneeR: 65, armRForward: 42, armROut: 10, elbowR: 95, armLForward: -38, armLOut: 10, elbowL: 95 } },
  // 低姿势附带 rootY（身高比例，负=整体下沉），配合踝部自动贴地，使脚落到地面而非悬空。
  { key: "sit",     label: "坐姿", pose: { legLForward: 88, legRForward: 88, kneeL: 92, kneeR: 92, rootY: -0.24 } },
  { key: "crouch",  label: "蹲下", pose: { torsoForward: 22, legLForward: 95, legRForward: 95, kneeL: 135, kneeR: 135, rootY: -0.34 } },
  // 单膝跪：右腿前脚掌planted(thigh前90/膝90 小腿竖直)、左腿膝着地(thigh下垂/膝128 小腿后折)、整体下沉使膝触地。
  { key: "kneel",   label: "单膝跪", pose: { legRForward: 92, kneeR: 92, legLForward: -2, kneeL: 128, torsoForward: 6, rootY: -0.27 } },
  // 格斗：双拳举到下巴前护架(不交叉)、错步微蹲。需配 armOut 抬高上臂，否则拳会垂到胸前并交叉。
  { key: "fight",   label: "格斗", pose: { torsoForward: 8, torsoTwist: 14, armLForward: 60, armLOut: 52, elbowL: 128, armRForward: 52, armROut: 58, elbowR: 138, legLForward: 16, legRForward: -12, kneeL: 22, kneeR: 18 } },
  { key: "think",   label: "思考", pose: { headNod: 8, armRForward: 65, elbowR: 125, armROut: 6 } },
  { key: "wave",    label: "招手", pose: { armROut: 135, elbowR: 45 } },
  // 看手机：单手(右手)持机抬到身前胸口高度看，左手自然垂于身侧——手机是单手拿，不是平板。
  { key: "phone",   label: "看手机", pose: { headNod: 28, armRForward: 40, armROut: 16, elbowR: 105 } },
];

export function applyPosePreset(presetKey: string): Pose {
  const p = POSE_PRESETS.find((x) => x.key === presetKey);
  if (!p) return {};
  // 归一化：未列关节显式置 0，避免叠加上一个预设的残留角度。
  const pose: Pose = {};
  for (const k of ALL_JOINT_KEYS) pose[k] = p.pose[k] ?? 0;
  pose.rootY = p.pose.rootY ?? 0; // 整体升降（非关节，单独保留）
  return pose;
}

// 姿势左右镜像：交换左右肢体关节、对带符号的扭转/侧倾/转头/歪头取反。
const MIRROR_SWAP: [string, string][] = [
  ["armLForward", "armRForward"], ["armLOut", "armROut"], ["elbowL", "elbowR"],
  ["legLForward", "legRForward"], ["legLOut", "legROut"], ["kneeL", "kneeR"],
];
const MIRROR_NEG = ["torsoTwist", "torsoSide", "headTurn", "headTilt"];
export function mirrorPose(pose: Pose): Pose {
  const out: Pose = { ...pose };
  for (const [a, b] of MIRROR_SWAP) { out[a] = pose[b] ?? 0; out[b] = pose[a] ?? 0; }
  for (const k of MIRROR_NEG) out[k] = -(pose[k] ?? 0);
  out.rootY = pose.rootY ?? 0;
  return out;
}
