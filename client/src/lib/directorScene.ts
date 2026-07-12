import type { DirectorScene, DirectorActor, DirectorGroup, DirectorCamera, DirectorLight, Vec3 } from "../../../shared/types";

// 导演台场景的默认值、预置体型、画幅与机位预设。纯数据 + 工厂，供 store/节点/编辑器共用。

/** 预置人偶体型：在「同一真人网格」上用身高/体宽/盆骨宽/肩宽塑形区分性别体型。 */
export interface MannequinModel {
  key: string;
  label: string;
  height: number;    // 站高(米)
  build: number;     // 整体体宽系数（瘦 0.85 ~ 壮 1.25）
  hip: number;       // 盆骨宽系数（<1 收窄盆骨+并腿=男性向；=1 保留宽臀=女性向）
  shoulder: number;  // 肩宽系数（>1 加宽肩/胸=男性 V 字；<1 收窄=女性向）
  head?: number;     // 头部缩放（>1 大头=二头身/Q版；默认 1）
  color: string;     // 默认配色
}

// 体型框架：内置网格本身偏「女性化」（细腰宽臀窄肩）。用 hip 收窄盆骨 + shoulder 加宽肩胸
// 即可塑出男性 V 字轮廓——男性 hip=0.56/shoulder=1.30（窄臀宽肩）、女性 hip=1.0/shoulder=0.95
// （宽臀窄肩）。height 区分身高，build 微调整体宽窄，head 放大头部出二头身/Q版。
export const MANNEQUIN_MODELS: MannequinModel[] = [
  { key: "male",   label: "男性",   height: 1.80, build: 1.00, hip: 0.78, shoulder: 1.16, color: "#4aa3ff" },
  { key: "female", label: "女性",   height: 1.63, build: 0.86, hip: 1.00, shoulder: 0.95, color: "#ff6fa5" },
  { key: "tall",   label: "高挑",   height: 1.92, build: 0.90, hip: 0.80, shoulder: 1.12, color: "#37d6a6" },
  { key: "burly",  label: "壮硕",   height: 1.84, build: 1.14, hip: 0.88, shoulder: 1.26, color: "#ffb020" },
  { key: "child",  label: "儿童",   height: 1.18, build: 0.84, hip: 0.88, shoulder: 1.00, color: "#c08bff" },
  { key: "chibi",  label: "二头身", height: 1.20, build: 1.10, hip: 0.84, shoulder: 1.05, head: 3.1, color: "#5ad1e6" },
];

export function mannequinModel(key: string): MannequinModel {
  return MANNEQUIN_MODELS.find((m) => m.key === key) ?? MANNEQUIN_MODELS[0];
}

/** 画幅比例预设（导演台取景框 + 截图输出）。 */
export const DIRECTOR_ASPECTS = ["16:9", "9:16", "2.35:1", "1:1", "4:3", "3:4", "21:9"] as const;

export function aspectRatioValue(aspect: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!m) return 16 / 9;
  const w = Number(m[1]), h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

let _seq = 0;
/** 角色 id（编辑器内唯一即可，无需全局 nanoid）。 */
function actorId(): string {
  _seq += 1;
  return `a${_seq}_${Math.round(performance.now())}`;
}

const ACTOR_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export function nextActorName(existing: DirectorActor[]): string {
  const used = new Set(existing.map((a) => a.name));
  for (const c of ACTOR_NAMES) { const n = `角色${c}`; if (!used.has(n)) return n; }
  return `角色${existing.length + 1}`;
}

const PALETTE = ["#4aa3ff", "#ff6fa5", "#37d6a6", "#ffb020", "#c08bff", "#ff7a59", "#5ad1e6", "#9bd34a"];
export function nextActorColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** 新建一个角色（默认站立，落在地面）。 */
export function makeActor(model: string, existing: DirectorActor[], position?: Vec3): DirectorActor {
  const m = mannequinModel(model);
  return {
    id: actorId(),
    name: nextActorName(existing),
    model: m.key,
    position: position ?? [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    color: nextActorColor(existing.length),
  };
}

// ── P4：群众群组 ──────────────────────────────────────────────────────────────
let _gseq = 0;
function groupId(): string { _gseq += 1; return `g${_gseq}_${Math.round(performance.now())}`; }

export const CROWD_SPACING = 0.85; // 成员默认间距(米)

/** 行列网格里第 r 行第 c 列成员的组内局部坐标（按间距居中铺开）。 */
function crowdLocalPos(r: number, c: number, rows: number, cols: number, spacing: number): Vec3 {
  return [(c - (cols - 1) / 2) * spacing, 0, (r - (rows - 1) / 2) * spacing];
}

/** 新建一个 rows×cols 群众群组 + 其成员（成员 position 为组内局部网格坐标，groupId 指向组）。 */
export function makeCrowd(rows: number, cols: number, existing: DirectorActor[], center?: Vec3): { group: DirectorGroup; actors: DirectorActor[] } {
  const gid = groupId();
  const color = nextActorColor((existing.length || 0));
  const group: DirectorGroup = {
    id: gid,
    name: `群众 (${cols}x${rows})`,
    rows, cols,
    position: center ?? [0, 0, -3],
    rotation: [0, 0, 0],
    scale: 1,
    color,
    spacing: CROWD_SPACING,
  };
  const actors: DirectorActor[] = [];
  let n = existing.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      actors.push({
        id: actorId(), name: nextActorName([...existing, ...actors]),
        model: n % 2 === 0 ? "male" : "female",
        position: crowdLocalPos(r, c, rows, cols, CROWD_SPACING), rotation: [0, 0, 0], scale: 1, color, groupId: gid,
      });
      n += 1;
    }
  }
  return { group, actors };
}

/** 调整群组间距：按组的 rows×cols 行优先顺序，重排各成员的组内局部坐标（保留个体姿势/体型/朝向）。 */
export function respaceCrowdMembers(group: DirectorGroup, members: DirectorActor[], spacing: number): DirectorActor[] {
  const { rows, cols } = group;
  return members.map((m, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    return r < rows ? { ...m, position: crowdLocalPos(r, c, rows, cols, spacing) } : m;
  });
}

/** 任意角色手动编组（LibTV 模块10「编组 Ctrl+G」）：把若干独立角色合成一个组——
 *  组心取成员世界坐标的水平质心，各成员局部坐标 = 世界坐标 − 组心（保留 Y 高度），
 *  manual=true 标记为手动组（不走行列网格/间距重排）。 */
export function makeGroupFromActors(members: DirectorActor[]): { group: DirectorGroup; actors: DirectorActor[] } {
  const gid = groupId();
  const n = Math.max(1, members.length);
  const cx = members.reduce((s, m) => s + m.position[0], 0) / n;
  const cz = members.reduce((s, m) => s + m.position[2], 0) / n;
  const color = members[0]?.color ?? nextActorColor(0);
  const group: DirectorGroup = {
    id: gid, name: `编组 (${members.length})`,
    rows: 1, cols: members.length,
    position: [cx, 0, cz], rotation: [0, 0, 0], scale: 1, color, manual: true,
  };
  const actors = members.map((m) => ({
    ...m, groupId: gid,
    position: [m.position[0] - cx, m.position[1], m.position[2] - cz] as Vec3,
  }));
  return { group, actors };
}

/** 复制整组：连同各成员（含自定义体型/姿势/局部位置）一起复制一份，新组右移 1.5m、新 id/名。 */
export function cloneGroupWithMembers(group: DirectorGroup, members: DirectorActor[], allActors: DirectorActor[]): { group: DirectorGroup; actors: DirectorActor[] } {
  const ng: DirectorGroup = { ...group, id: groupId(), name: `${group.name} 副本`, position: [group.position[0] + 1.5, group.position[1], group.position[2]] };
  const existing = [...allActors];
  const actors = members.map((m) => {
    const copy: DirectorActor = { ...m, id: actorId(), name: nextActorName(existing), groupId: ng.id, position: [...m.position] as Vec3, rotation: [...m.rotation] as Vec3, pose: m.pose ? { ...m.pose } : undefined };
    existing.push(copy);
    return copy;
  });
  return { group: ng, actors };
}

/** 解组：把群组变换烘焙进各成员的世界坐标（绕 Y 旋转 + 缩放 + 平移），清除 groupId。 */
export function bakeGroupTransform(group: DirectorGroup, member: DirectorActor): DirectorActor {
  const [gx, gy, gz] = group.position;
  const ry = (group.rotation[1] ?? 0) * Math.PI / 180;
  const s = group.scale;
  const [lx, , lz] = member.position;
  const sx = lx * s, sz = lz * s;
  // 绕 Y 旋转局部偏移（群众通常只整体转向）
  const wx = gx + sx * Math.cos(ry) + sz * Math.sin(ry);
  const wz = gz - sx * Math.sin(ry) + sz * Math.cos(ry);
  const wy = gy + member.position[1] * s;
  return {
    ...member,
    groupId: undefined,
    position: [wx, wy, wz],
    rotation: [member.rotation[0], (member.rotation[1] ?? 0) + (group.rotation[1] ?? 0), member.rotation[2]],
    scale: member.scale * s,
  };
}

// ── 模块3：多命名机位 ─────────────────────────────────────────────────────────
let _cseq = 0;
export function newCameraId(): string { _cseq += 1; return `c${_cseq}_${Math.round(performance.now())}`; }

/** 取场景的命名机位列表；空时从单机位 camera 迁移出一个「机位1」。 */
export function ensureCameras(scene: DirectorScene): DirectorCamera[] {
  if (scene.cameras && scene.cameras.length) return scene.cameras;
  return [{ ...scene.camera, id: scene.camera.id ?? "cam1", name: scene.camera.name ?? "机位1" }];
}

export function nextCameraName(cams: DirectorCamera[]): string {
  for (let i = 1; i <= cams.length + 1; i++) { const n = `机位${i}`; if (!cams.some((c) => c.name === n)) return n; }
  return `机位${cams.length + 1}`;
}

// ── 取景/朝向几何（纯函数，供编辑器的注视/景别/面向机位复用，便于单测） ──────────────

/** 角色的世界坐标：独立角色即其 position；组内成员则叠加所属群组的 Y 旋转+缩放+平移
 *  （与渲染的嵌套 group、bakeGroupTransform 同一约定）。 */
export function actorWorldPosition(a: DirectorActor, groups: DirectorGroup[] | undefined): Vec3 {
  if (!a.groupId) return a.position;
  const g = (groups ?? []).find((x) => x.id === a.groupId);
  if (!g) return a.position;
  const ry = (g.rotation[1] ?? 0) * Math.PI / 180, s = g.scale;
  const lx = a.position[0] * s, lz = a.position[2] * s;
  return [g.position[0] + lx * Math.cos(ry) + lz * Math.sin(ry), g.position[1] + a.position[1] * s, g.position[2] - lx * Math.sin(ry) + lz * Math.cos(ry)];
}

/** 注视点世界坐标：主体脚点 base 经「场景缩放 S + 平移 offset」，胸高偏移 aimY 再按「场景缩放 ×
 *  角色自身缩放」放大——否则放大过的角色（比例滑杆可到 30×）会被对准脚踝、头部出框。 */
export function shotAimTarget(
  base: Vec3,
  o: { sceneScale?: number; offsetX?: number; offsetY?: number; offsetZ?: number; actorScale?: number; aimY: number },
): Vec3 {
  const S = o.sceneScale ?? 1, as = o.actorScale ?? 1;
  return [
    (o.offsetX ?? 0) + base[0] * S,
    (o.offsetY ?? 0) + base[1] * S + o.aimY * S * as,
    (o.offsetZ ?? 0) + base[2] * S,
  ];
}

/** 「面向机位」要写入的角色局部 yaw(度)：使其世界朝向机位。扣除所属群组的 Y 旋转——渲染时
 *  成员朝向 = 群组 yaw + 成员 yaw，不扣的话组内成员会偏掉整整一个群组转角。 */
export function faceCameraYaw(worldX: number, worldZ: number, camX: number, camZ: number, groupYawDeg = 0): number {
  const world = Math.atan2(camX - worldX, camZ - worldZ) * 180 / Math.PI;
  return world - groupYawDeg;
}

export function makeDefaultDirectorScene(): DirectorScene {
  const actors = [makeActor("male", [])];
  // FOV 默认 50°（自然视角，对齐 LibTV）；32° 长焦会把人物「放大」显得过大。
  const cam: DirectorCamera = { id: "cam1", name: "机位1", position: [0, 1.5, 4.2], target: [0, 1.0, 0], fov: 50 };
  return {
    actors,
    camera: cam,
    cameras: [cam],
    activeCameraId: "cam1",
    aspectRatio: "16:9",
    background: "",
    groundVisible: true,
    labelsVisible: true,
  };
}

// ── #71 多物体：几何体道具 ─────────────────────────────────────────────
export const PROP_PRIMS = [
  { key: "box", label: "方块" },
  { key: "sphere", label: "球体" },
  { key: "cylinder", label: "圆柱" },
  { key: "cone", label: "圆锥" },
  { key: "plane", label: "平面板" },
  // #71 预置素材（参数化复合道具，纯几何拼装、零外部资源）
  { key: "table", label: "桌子" },
  { key: "chair", label: "椅子" },
  { key: "bed", label: "床" },
  { key: "doorframe", label: "门框" },
  { key: "stairs", label: "台阶" },
  { key: "tree", label: "树" },
] as const;
export type PropPrim = (typeof PROP_PRIMS)[number]["key"];

export function makeProp(prim: PropPrim, existing: DirectorActor[], position?: Vec3): DirectorActor {
  const a = makeActor("male", existing, position);
  const n = existing.filter((x) => x.prim).length + 1;
  a.prim = prim;
  a.name = `${PROP_PRIMS.find((pp) => pp.key === prim)?.label ?? "物体"} ${n}`;
  a.color = "#8a93a6"; // 道具默认中性灰，与人偶配色区分
  return a;
}

// ── #71 场景人物位置模板 ───────────────────────────────────────────────
// 坐标相对场景原点；rotY 按「0=面向默认机位(+Z)」约定（faceCameraYaw 同系）。
export interface LayoutTemplate {
  key: string;
  label: string;
  desc: string;
  specs: { model: string; dx: number; dz: number; rotY: number }[];
}
export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  { key: "duo", label: "对话双人", desc: "两人面对面（近景对话/正反打）", specs: [
    { model: "male", dx: -0.7, dz: 0, rotY: 90 }, { model: "female", dx: 0.7, dz: 0, rotY: -90 },
  ] },
  { key: "trio", label: "三人三角", desc: "三人围成三角、面向圆心（群像对话）", specs: [
    { model: "male", dx: 0, dz: -0.9, rotY: 180 }, { model: "female", dx: -1.0, dz: 0.6, rotY: 55 }, { model: "tall", dx: 1.0, dz: 0.6, rotY: -55 },
  ] },
  { key: "lineup", label: "一字排开", desc: "四人横排面向机位（阵容/海报位）", specs: [
    { model: "male", dx: -1.2, dz: 0, rotY: 0 }, { model: "female", dx: -0.4, dz: 0, rotY: 0 }, { model: "tall", dx: 0.4, dz: 0, rotY: 0 }, { model: "male", dx: 1.2, dz: 0, rotY: 0 },
  ] },
  { key: "roundtable", label: "圆桌围坐", desc: "六人围圈、面向圆心（会议/篝火）", specs: Array.from({ length: 6 }, (_, i) => {
    const ang = (i / 6) * Math.PI * 2;
    const dx = Math.sin(ang) * 1.2, dz = Math.cos(ang) * 1.2;
    return { model: i % 2 ? "female" : "male", dx: Number(dx.toFixed(2)), dz: Number(dz.toFixed(2)), rotY: Math.round(Math.atan2(-dx, -dz) * 180 / Math.PI) };
  }) },
  { key: "confront", label: "两组对峙", desc: "两两对峙、间隔拉开（冲突/谈判）", specs: [
    { model: "male", dx: -1.1, dz: -0.2, rotY: 90 }, { model: "tall", dx: -1.7, dz: 0.5, rotY: 90 },
    { model: "female", dx: 1.1, dz: -0.2, rotY: -90 }, { model: "male", dx: 1.7, dz: 0.5, rotY: -90 },
  ] },
  { key: "hero", label: "主角+群像", desc: "主角前置、四人背景横排（纵深层次）", specs: [
    { model: "male", dx: 0, dz: 1.0, rotY: 0 },
    { model: "female", dx: -1.5, dz: -1.2, rotY: 0 }, { model: "tall", dx: -0.5, dz: -1.4, rotY: 0 }, { model: "male", dx: 0.5, dz: -1.4, rotY: 0 }, { model: "female", dx: 1.5, dz: -1.2, rotY: 0 },
  ] },
];

// ── #78 真 3D 灯光（LibTV 无此能力的超越点） ───────────────────────────────────
let _lseq = 0;
export function newLightId(): string { _lseq += 1; return `l${_lseq}_${Math.round(performance.now())}`; }

export const LIGHT_KIND_LABEL: Record<DirectorLight["kind"], string> = { point: "点光", spot: "聚光" };

export function nextLightName(kind: DirectorLight["kind"], existing: DirectorLight[]): string {
  const base = LIGHT_KIND_LABEL[kind];
  for (let i = 1; i <= existing.length + 1; i++) { const n = `${base}${i}`; if (!existing.some((l) => l.name === n)) return n; }
  return `${base}${existing.length + 1}`;
}

/** 新建一盏灯（默认落在主体右前上方，聚光指向原点胸高）。 */
export function makeLight(kind: DirectorLight["kind"], existing: DirectorLight[], position?: Vec3): DirectorLight {
  return {
    id: newLightId(),
    kind,
    name: nextLightName(kind, existing),
    position: position ?? [1.6, 2.2, 2.0],
    target: kind === "spot" ? [0, 1.0, 0] : undefined,
    color: "#fff1d6",
    intensity: kind === "spot" ? 2.6 : 1.6,
    angle: kind === "spot" ? 40 : undefined,
    castShadow: kind === "spot",
  };
}

/** 布光预设（一键成套布光，替换现有灯光并压暗基础光）。 */
export interface LightRigPreset {
  key: string;
  label: string;
  desc: string;
  lights: Omit<DirectorLight, "id">[];
}
export const LIGHT_RIG_PRESETS: LightRigPreset[] = [
  { key: "threepoint", label: "三点布光", desc: "经典人像：主光（左前上）+ 辅光（右前弱）+ 轮廓光（后上勾边）", lights: [
    { kind: "spot", name: "主光", position: [-1.9, 2.3, 2.2], target: [0, 1.0, 0], color: "#fff1d6", intensity: 3.0, angle: 44, castShadow: true },
    { kind: "point", name: "辅光", position: [2.1, 1.3, 1.9], color: "#cfe0ff", intensity: 0.8 },
    { kind: "spot", name: "轮廓光", position: [0.7, 2.6, -2.4], target: [0, 1.25, 0], color: "#dfe8ff", intensity: 2.4, angle: 36 },
  ] },
  { key: "backlight", label: "逆光轮廓", desc: "背后强光勾出剪影轮廓，正面弱补光保细节", lights: [
    { kind: "spot", name: "逆光", position: [0, 2.4, -2.8], target: [0, 1.1, 0], color: "#8fb7ff", intensity: 4.2, angle: 50, castShadow: true },
    { kind: "point", name: "补光", position: [0.6, 1.2, 2.6], color: "#ffe9cf", intensity: 0.45 },
  ] },
  { key: "neon", label: "双色霓虹", desc: "品红/青色左右交叉照明，赛博朋克夜景", lights: [
    { kind: "point", name: "品红霓虹", position: [-2.2, 1.6, 1.2], color: "#ff2d95", intensity: 2.2 },
    { kind: "point", name: "青色霓虹", position: [2.2, 1.6, 1.2], color: "#00e5ff", intensity: 2.2 },
    { kind: "spot", name: "顶部弱光", position: [0, 3.0, 0.4], target: [0, 1.0, 0], color: "#c5b6ff", intensity: 1.0, angle: 55 },
  ] },
  { key: "stage", label: "顶光舞台", desc: "头顶一束窄光打下，舞台聚光戏剧感", lights: [
    { kind: "spot", name: "舞台顶光", position: [0, 3.6, 0.5], target: [0, 0.9, 0], color: "#fff7e6", intensity: 5.0, angle: 26, castShadow: true },
  ] },
  // #110 导演台打磨：内置布光 4 → 8（经典影视布光族谱补齐）
  { key: "rembrandt", label: "伦勃朗光", desc: "主光 45° 高位侧打，暗侧脸颊留三角光斑，弱辅光保层次", lights: [
    { kind: "spot", name: "伦勃朗主光", position: [-2.2, 2.6, 1.4], target: [0, 1.35, 0], color: "#ffe7c4", intensity: 3.6, angle: 38, castShadow: true },
    { kind: "point", name: "暗侧辅光", position: [2.4, 1.1, 1.6], color: "#b9c6dd", intensity: 0.35 },
  ] },
  { key: "butterfly", label: "蝴蝶光", desc: "派拉蒙式正面高位直打，鼻下蝶形影，美人像经典", lights: [
    { kind: "spot", name: "蝶光主灯", position: [0, 2.9, 2.2], target: [0, 1.3, 0], color: "#fff3e0", intensity: 3.4, angle: 34, castShadow: true },
    { kind: "point", name: "颌下反光", position: [0, 0.4, 1.8], color: "#ffe9d0", intensity: 0.5 },
  ] },
  { key: "horror", label: "恐怖底光", desc: "下方仰打面部，影子上翻的经典恐怖片光效", lights: [
    { kind: "spot", name: "底光", position: [0, 0.15, 1.5], target: [0, 1.5, 0], color: "#cfe8d2", intensity: 3.8, angle: 46, castShadow: true },
    { kind: "point", name: "背景冷光", position: [0, 2.2, -2.6], color: "#4c6a8f", intensity: 0.7 },
  ] },
  { key: "moonlight", label: "月夜冷光", desc: "高位冷蓝月光洒下 + 极弱暖辅光，夜戏氛围", lights: [
    { kind: "spot", name: "月光", position: [1.8, 3.4, -1.2], target: [0, 1.0, 0], color: "#9fc0ff", intensity: 2.6, angle: 52, castShadow: true },
    { kind: "point", name: "暖辅光", position: [-1.4, 0.9, 2.2], color: "#ffd9a8", intensity: 0.3 },
  ] },
];

// ── #110 我的布光（用户自定义预设，localStorage 持久化，与内置预设并列展示） ──
const MY_RIGS_KEY = "avc:director:my-light-rigs:v1";
export interface MyLightRig { name: string; lights: Omit<DirectorLight, "id">[] }
export function loadMyLightRigs(): MyLightRig[] {
  try {
    const a = JSON.parse(localStorage.getItem(MY_RIGS_KEY) || "[]");
    return Array.isArray(a) ? a.filter((r) => r && typeof r.name === "string" && Array.isArray(r.lights)) : [];
  } catch { return []; }
}
export function saveMyLightRig(name: string, lights: DirectorLight[]): MyLightRig[] {
  const rigs = loadMyLightRigs().filter((r) => r.name !== name);
  const stripped = lights.map(({ id: _id, ...rest }) => ({ ...rest, position: [...rest.position] as Vec3, target: rest.target ? [...rest.target] as Vec3 : undefined }));
  rigs.push({ name, lights: stripped });
  try { localStorage.setItem(MY_RIGS_KEY, JSON.stringify(rigs.slice(-24))); } catch { /* quota */ }
  return loadMyLightRigs();
}
export function deleteMyLightRig(name: string): MyLightRig[] {
  const rigs = loadMyLightRigs().filter((r) => r.name !== name);
  try { localStorage.setItem(MY_RIGS_KEY, JSON.stringify(rigs)); } catch { /* quota */ }
  return rigs;
}

/** 用布光预设实例化一套灯（配新 id）。 */
export function lightsFromRig(rig: LightRigPreset): DirectorLight[] {
  return rig.lights.map((l) => ({ ...l, id: newLightId(), position: [...l.position] as Vec3, target: l.target ? [...l.target] as Vec3 : undefined }));
}

/** 灯位 → 中文方位描述（相对原点主体：+Z=前/机位侧，+X=右）。 */
export function lightPosLabel(p: Vec3): string {
  const [x, y, z] = p;
  const hd = Math.hypot(x, z);
  const elev = Math.atan2(y - 0.9, Math.max(0.001, hd)) * 180 / Math.PI; // 相对胸高的仰角
  let h: string;
  const a = Math.atan2(x, z) * 180 / Math.PI; // 0=正前，90=右，±180=后
  const aa = Math.abs(a);
  if (aa <= 30) h = "正前方";
  else if (aa < 75) h = a > 0 ? "右前方" : "左前方";
  else if (aa <= 105) h = a > 0 ? "右侧" : "左侧";
  else if (aa < 150) h = a > 0 ? "右后方" : "左后方";
  else h = "正后方";
  if (elev >= 62) return hd < 0.6 ? "正上方（顶光）" : `${h}高位（近顶光）`;
  if (elev >= 22) return `${h}上方`;
  if (elev > -18) return h;
  return `${h}低位（底光）`;
}

/** 灯光列表 → 中文光效描述句（截图时写入节点，供下游提示词直接引用）。 */
export function describeLights(lights: DirectorLight[] | undefined, dimBase?: boolean): string {
  if (!lights || !lights.length) return "";
  const parts = lights.map((l) => {
    const bits = [`${l.name}（${LIGHT_KIND_LABEL[l.kind]}）来自${lightPosLabel(l.position)}`, `光色 ${l.color}`, `强度 ${Number(l.intensity.toFixed(1))}`];
    if (l.kind === "spot" && l.angle) bits.push(`锥角 ${Math.round(l.angle)}°`);
    if (l.castShadow) bits.push("带投影");
    return bits.join("、");
  });
  const tail = dimBase !== false ? "；基础环境光已压暗，布光造型主导画面明暗" : "";
  return `画面布光：${parts.join("；")}${tail}`;
}

/** 按模板生成一批新角色（追加式；落点相对 origin），返回新角色数组。 */
export function templateActors(tpl: LayoutTemplate, existing: DirectorActor[], origin: Vec3): DirectorActor[] {
  const out: DirectorActor[] = [];
  for (const sp of tpl.specs) {
    const a = makeActor(sp.model, [...existing, ...out], [origin[0] + sp.dx, origin[1], origin[2] + sp.dz]);
    a.rotation = [0, sp.rotY, 0];
    out.push(a);
  }
  return out;
}
