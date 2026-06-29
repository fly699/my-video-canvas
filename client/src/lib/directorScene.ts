import type { DirectorScene, DirectorActor, DirectorGroup, Vec3 } from "../../../shared/types";

// 导演台场景的默认值、预置体型、画幅与机位预设。纯数据 + 工厂，供 store/节点/编辑器共用。

/** 预置人偶体型：参数化图元人偶的比例参数（asset-free，无需 GLB）。 */
export interface MannequinModel {
  key: string;
  label: string;
  height: number;   // 站高(米)
  build: number;    // 体宽系数（瘦 0.85 ~ 壮 1.25）
  color: string;    // 默认配色
}

export const MANNEQUIN_MODELS: MannequinModel[] = [
  { key: "male",   label: "男性",   height: 1.80, build: 1.0,  color: "#4aa3ff" },
  { key: "female", label: "女性",   height: 1.66, build: 0.9,  color: "#ff6fa5" },
  { key: "tall",   label: "高挑",   height: 1.92, build: 0.92, color: "#37d6a6" },
  { key: "burly",  label: "壮硕",   height: 1.82, build: 1.22, color: "#ffb020" },
  { key: "child",  label: "儿童",   height: 1.20, build: 0.85, color: "#c08bff" },
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

const CROWD_SPACING = 0.85; // 成员间距(米)

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
  };
  const actors: DirectorActor[] = [];
  let n = existing.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = (c - (cols - 1) / 2) * CROWD_SPACING;
      const lz = (r - (rows - 1) / 2) * CROWD_SPACING;
      actors.push({
        id: actorId(), name: nextActorName([...existing, ...actors]),
        model: n % 2 === 0 ? "male" : "female",
        position: [lx, 0, lz], rotation: [0, 0, 0], scale: 1, color, groupId: gid,
      });
      n += 1;
    }
  }
  return { group, actors };
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

export function makeDefaultDirectorScene(): DirectorScene {
  const actors = [makeActor("male", [])];
  return {
    actors,
    camera: { position: [0, 1.5, 4.2], target: [0, 1.0, 0], fov: 32 },
    aspectRatio: "16:9",
    background: "",
    groundVisible: true,
    labelsVisible: true,
  };
}
