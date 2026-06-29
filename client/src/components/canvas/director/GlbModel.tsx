import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, Mesh, MeshStandardMaterial, Color } from "three";
import type { DirectorActor } from "../../../../../shared/types";

// GLB 网格人物（内置真人模型 / 本地导入）。无参数化姿势（GLB 自带骨骼）。tint 时把材质染成
// actor.color（纯色人偶，便于黑底分离/彩色替换）。自动归一化到约 1.8m 站高、脚底贴地，
// 使其与场景比例一致、好摆位。坏文件由外层兜底，不拖垮编辑器。
function GlbInner({ actor }: { actor: DirectorActor }) {
  const { scene } = useGLTF(actor.glbUrl!);
  const obj = useMemo(() => {
    const root = scene.clone(true);
    // 归一化：缩放到 ~1.8m 高、底部落到 y=0、水平居中。
    // 先刷新世界矩阵：部分 GLB 的 Armature/根节点自带缩放，未刷新则 Box3 量错、缩放失真。
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);
    const targetH = 1.8;
    const s = size.y > 1e-4 ? targetH / size.y : 1;
    root.scale.setScalar(s);
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    if (actor.tint) {
      const col = new Color(actor.color);
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.material = new MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
          mesh.castShadow = true;
        }
      });
    }
    return root;
  }, [scene, actor.tint, actor.color]);
  return <primitive object={obj} />;
}

function Placeholder({ actor }: { actor: DirectorActor }) {
  return (
    <mesh position={[0, 0.9, 0]} castShadow>
      <boxGeometry args={[0.5, 1.8, 0.5]} />
      <meshStandardMaterial color={actor.color} transparent opacity={0.5} wireframe />
    </mesh>
  );
}

class GlbErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// 选中环 + GLB 网格（不含 actor 变换——变换由编辑器外层 group / 拖拽手柄负责）。
export function GlbModel({ actor, selected }: { actor: DirectorActor; selected: boolean }) {
  return (
    <>
      <GlbErrorBoundary fallback={<Placeholder actor={actor} />}>
        <Suspense fallback={<Placeholder actor={actor} />}>
          <GlbInner actor={actor} />
        </Suspense>
      </GlbErrorBoundary>
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.55, 40]} />
          <meshBasicMaterial color={actor.color} transparent opacity={0.85} />
        </mesh>
      )}
    </>
  );
}
