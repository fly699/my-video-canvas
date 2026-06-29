import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import type { DirectorActor } from "../../../../../shared/types";

const D = Math.PI / 180;

// 本地导入的 GLB 模型渲染（参数化人偶之外的真实角色/道具）。无姿势（GLB 自带骨骼，
// 本期只做摆放：位置/旋转/缩放）。坏文件由外层 GlbErrorBoundary 兜底，不拖垮编辑器。
function GlbInner({ actor }: { actor: DirectorActor }) {
  const { scene } = useGLTF(actor.glbUrl!);
  const obj = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={obj} />;
}

function Wrapper({ actor, selected, onSelect, children }: {
  actor: DirectorActor; selected: boolean; onSelect: (e: { stopPropagation: () => void }) => void; children: ReactNode;
}) {
  return (
    <group
      position={actor.position}
      rotation={[actor.rotation[0] * D, actor.rotation[1] * D, actor.rotation[2] * D]}
      scale={actor.scale}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(e); }}
    >
      {children}
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.55, 32]} />
          <meshBasicMaterial color={actor.color} transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}

// 占位/出错回退：一个带色方块，仍可选中/变换。
function Placeholder({ actor }: { actor: DirectorActor }) {
  return (
    <mesh position={[0, 0.5, 0]} castShadow>
      <boxGeometry args={[0.5, 1, 0.5]} />
      <meshStandardMaterial color={actor.color} transparent opacity={0.5} wireframe />
    </mesh>
  );
}

class GlbErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function GlbModel({ actor, selected, onSelect }: {
  actor: DirectorActor; selected: boolean; onSelect: (e: { stopPropagation: () => void }) => void;
}) {
  return (
    <Wrapper actor={actor} selected={selected} onSelect={onSelect}>
      <GlbErrorBoundary fallback={<Placeholder actor={actor} />}>
        <Suspense fallback={<Placeholder actor={actor} />}>
          <GlbInner actor={actor} />
        </Suspense>
      </GlbErrorBoundary>
    </Wrapper>
  );
}
