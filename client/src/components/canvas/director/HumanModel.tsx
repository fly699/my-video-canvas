import { Suspense, useLayoutEffect, useMemo, type ReactNode, Component } from "react";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Box3, Vector3, MeshStandardMaterial, Color, type Object3D, type Mesh } from "three";
import type { DirectorActor } from "../../../../../shared/types";
import { mannequinModel } from "../../../lib/directorScene";

// 内置真人模型（Mixamo Xbot 平滑人形，染成 actor.color 的纯色人偶——靠近 LibTV 质感）。
// 骨骼姿势：把 actor.pose 的关节角度映射到 mixamorig 骨骼。SkeletonUtils.clone 让每个实例
// 拥有独立骨架，互不干扰。坏加载由外层兜底（不退回图元人偶）。
useGLTF.preload("/models/xbot.glb");
const D = Math.PI / 180;

const MODEL_URL = "/models/xbot.glb";

// 关节角度(度) → Mixamo 骨骼旋转。
// 注意：本 GLB 导出时把骨名里的冒号去掉了，真实骨名是 `mixamorigHips`（无冒号），
// 此前用 `mixamorig:Hips` 取骨一律取不到 → 所有姿势失效。轴向均经真机(GLTFLoader)逐条实测：
//   绑定姿势为 T 字（双臂水平外伸 ±X，正面 +Z）。
//   左臂抬垂 z=(armOut-75)°，右臂 z=(75-armOut)°（默认 armOut=0 → 双臂自然下垂）；
//   前举：左 -y / 右 +y；屈肘：左 -y / 右 +y；
//   抬腿 -x；屈膝 +x；腿外展 左 +z / 右 -z；躯干前倾 +x、转体 y、侧倾 z；头点头 +x、转头 y。
function applyPose(root: Object3D, pose: Record<string, number>) {
  const v = (k: string) => (pose[k] ?? 0) * D;
  const set = (bone: string, x = 0, y = 0, z = 0) => {
    const b = root.getObjectByName("mixamorig" + bone);
    if (b) b.rotation.set(x, y, z);
  };
  // 躯干（分摊到 Spine/Spine1/Spine2，自然分布弯曲）
  set("Spine", v("torsoForward") * 0.4, v("torsoTwist") * 0.5, v("torsoSide") * 0.4);
  set("Spine1", v("torsoForward") * 0.35, v("torsoTwist") * 0.3, v("torsoSide") * 0.3);
  set("Spine2", v("torsoForward") * 0.25, v("torsoTwist") * 0.2, v("torsoSide") * 0.2);
  // 头颈（颈分担一部分，更自然）
  set("Neck", v("headNod") * 0.35, v("headTurn") * 0.4, v("headTilt") * 0.35);
  set("Head", v("headNod") * 0.65, v("headTurn") * 0.6, v("headTilt") * 0.65);
  // 手臂：z 抬/垂（外展 0=下垂、75=水平、160=过头），y 前后摆，前臂(elbow) y 前屈
  const elevL = ((pose.armLOut ?? 0) - 75) * D;
  const elevR = (75 - (pose.armROut ?? 0)) * D;
  set("LeftArm", 0, -v("armLForward"), elevL);
  set("RightArm", 0, v("armRForward"), elevR);
  set("LeftForeArm", 0, -v("elbowL"), 0);
  set("RightForeArm", 0, v("elbowR"), 0);
  // 腿：x 抬腿(-x=前)，z 外展；小腿(knee) +x=屈膝
  set("LeftUpLeg", -v("legLForward"), 0, v("legLOut"));
  set("RightUpLeg", -v("legRForward"), 0, -v("legROut"));
  set("LeftLeg", v("kneeL"), 0, 0);
  set("RightLeg", v("kneeR"), 0, 0);
  // 踝部回正，使脚底尽量水平贴地（抵消大腿/小腿在 x 上的累计倾角）
  set("LeftFoot", v("legLForward") - v("kneeL"), 0, 0);
  set("RightFoot", v("legRForward") - v("kneeR"), 0, 0);
}

function HumanInner({ actor }: { actor: DirectorActor }) {
  const { scene } = useGLTF(MODEL_URL);
  const obj = useMemo(() => {
    const root = cloneSkeleton(scene);
    const col = new Color(actor.color);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.material = new MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.04 });
        mesh.castShadow = true;
      }
    });
    // 体型塑形：内置网格为「细腰宽臀窄肩」女性轮廓。
    //   ① 盆骨：缩 Hips 的 X/Z（连同盆骨皮肤、双腿位置与腿围一起收窄并拢），仅对 Spine 反缩
    //      回去，使上身宽度不变（避免级联畸变）；双腿随之变细并拢，呈男性窄臀下身。
    //   ② 肩胸：放宽 Spine2 的 X（胸廓变宽、双肩外移=V 字），仅对 Neck 反缩回去，使头颈不被
    //      横向拉宽（避免大头畸变）。手臂随肩略宽，符合男性体型。
    const m = mannequinModel(actor.model);
    const get = (n: string) => root.getObjectByName("mixamorig" + n) as Object3D | undefined;
    if (m.hip !== 1) {
      const hips = get("Hips"), spine = get("Spine");
      if (hips) hips.scale.set(m.hip, 1, m.hip);
      if (spine) spine.scale.set(1 / m.hip, 1, 1 / m.hip);
    }
    if (m.shoulder !== 1) {
      const spine2 = get("Spine2"), neck = get("Neck");
      if (spine2) spine2.scale.set(m.shoulder, 1, 1);
      if (neck) neck.scale.set(1 / m.shoulder, 1, 1);
    }
    //   ③ 头部：放大 Head 骨出二头身/Q版（在颈部之上对头单独缩放）。
    if (m.head && m.head !== 1) {
      const head = get("Head");
      if (head) head.scale.setScalar(m.head);
    }
    return root;
  }, [scene, actor.color, actor.model]);

  // 归一化到「目标身高 × 体宽」、脚底贴地、水平居中（在绑定姿势下量一次）。
  // 必须先 updateMatrixWorld(true)：Mixamo Armature 自带 0.01 缩放，未刷新世界矩阵则
  // Box3 量出的尺寸不可靠，缩放会算错（此前「人物比例太大」的根因之一）。
  // 性别/体型框架：身高(sy) 取模型 height，体宽(sxz) = sy × build，使男/女/高挑/壮硕/儿童
  // 在「同一真人网格」上以协调比例区分（女性更瘦小、壮硕更宽、儿童更矮）。
  const fit = useMemo(() => {
    obj.updateMatrixWorld(true);
    const box = new Box3().setFromObject(obj);
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);
    const m = mannequinModel(actor.model);
    const sy = size.y > 1e-4 ? m.height / size.y : 1;
    const sxz = sy * m.build;
    return { sx: sxz, sy, px: -center.x * sxz, py: -box.min.y * sy, pz: -center.z * sxz };
  }, [obj, actor.model]);

  useLayoutEffect(() => { applyPose(obj, actor.pose ?? {}); }, [obj, actor.pose]);

  return (
    <group position={[fit.px, fit.py, fit.pz]} scale={[fit.sx, fit.sy, fit.sx]}>
      <primitive object={obj} />
    </group>
  );
}

function Loading({ actor }: { actor: DirectorActor }) {
  // 加载/失败占位：一个细长发光柱（非图元人偶），仅作临时标记。
  return (
    <mesh position={[0, 0.9, 0]}>
      <capsuleGeometry args={[0.12, 1.4, 6, 12]} />
      <meshStandardMaterial color={actor.color} transparent opacity={0.35} emissive={actor.color} emissiveIntensity={0.2} />
    </mesh>
  );
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  constructor(p: { fallback: ReactNode; children: ReactNode }) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function HumanModel({ actor, selected }: { actor: DirectorActor; selected: boolean }) {
  const rootDrop = (actor.pose?.rootY ?? 0) * mannequinModel(actor.model).height;
  return (
    <group position={[0, rootDrop, 0]}>
      <Boundary fallback={<Loading actor={actor} />}>
        <Suspense fallback={<Loading actor={actor} />}>
          <HumanInner actor={actor} />
        </Suspense>
      </Boundary>
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.32, 0.4, 40]} />
          <meshBasicMaterial color={actor.color} transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}
