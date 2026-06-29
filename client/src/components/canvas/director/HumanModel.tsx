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

// 关节角度(度) → mixamorig 骨骼旋转。约定：默认手臂自然下垂(A 型)，外展(armOut)增大→抬向水平；
// 前举(forward)→前后摆；屈肘/屈膝→弯曲。轴向按 Mixamo 习惯设定，可按反馈逐条校正。
function applyPose(root: Object3D, pose: Record<string, number>) {
  const v = (k: string) => (pose[k] ?? 0) * D;
  const set = (bone: string, x = 0, y = 0, z = 0) => {
    const b = root.getObjectByName("mixamorig:" + bone);
    if (b) b.rotation.set(x, y, z);
  };
  // 躯干（分摊到 Spine/Spine1/Spine2）
  set("Spine", v("torsoForward") * 0.4, v("torsoTwist") * 0.5, v("torsoSide") * 0.4);
  set("Spine1", v("torsoForward") * 0.35, v("torsoTwist") * 0.3, v("torsoSide") * 0.3);
  set("Spine2", v("torsoForward") * 0.25, v("torsoTwist") * 0.2, v("torsoSide") * 0.2);
  // 头颈
  set("Neck", v("headNod") * 0.35, v("headTurn") * 0.4, v("headTilt") * 0.35);
  set("Head", v("headNod") * 0.65, v("headTurn") * 0.6, v("headTilt") * 0.65);
  // 手臂：z 控制抬/垂（默认下垂 ≈ (75-armOut)°），x 控制前后摆；前臂(elbow)弯曲
  const armDownL = (75 - (pose.armLOut ?? 0)) * D;
  const armDownR = (75 - (pose.armROut ?? 0)) * D;
  set("LeftArm", -v("armLForward"), 0, armDownL);
  set("RightArm", -v("armRForward"), 0, -armDownR);
  set("LeftForeArm", 0, 0, v("elbowL"));
  set("RightForeArm", 0, 0, -v("elbowR"));
  // 腿：x 前后抬腿，z 外展；小腿(knee)弯曲（后屈为正）
  set("LeftUpLeg", v("legLForward"), 0, v("legLOut"));
  set("RightUpLeg", v("legRForward"), 0, -v("legROut"));
  set("LeftLeg", -v("kneeL"), 0, 0);
  set("RightLeg", -v("kneeR"), 0, 0);
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
    return root;
  }, [scene, actor.color]);

  // 归一化到 ~1.8m × 体型缩放、脚底贴地、水平居中（在绑定姿势下量一次）。
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(obj);
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);
    const h = mannequinModel(actor.model).height;
    const s = size.y > 1e-4 ? h / size.y : 1;
    return { s, px: -center.x * s, py: -box.min.y * s, pz: -center.z * s };
  }, [obj, actor.model]);

  useLayoutEffect(() => { applyPose(obj, actor.pose ?? {}); }, [obj, actor.pose]);

  return (
    <group position={[fit.px, fit.py, fit.pz]} scale={fit.s}>
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
