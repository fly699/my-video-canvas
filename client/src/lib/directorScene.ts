import type { DirectorScene, DirectorActor, DirectorGroup, DirectorCamera, Vec3 } from "../../../shared/types";

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
