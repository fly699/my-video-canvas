import { useRef } from "react";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { BackSide, type Mesh } from "three";

// 720°全景背景：把等距(equirectangular)全景图贴到一个大球内壁，角色置于其中即融入真实场景。
// 关键：球做成「天空盒」——每帧把球心完全跟随相机(X/Y/Z)，相机永远在球心、地平线恒在视平线
// 高度、背景始终环绕(怎么缩放/拉远都不会变成飘在一旁的小球)。人物与全景的高低/大小关系改由
// 「场景升降 / 场景缩放」控制人物本身(更直观)，避免动全景球导致地面错位。
// yaw 旋转朝向、scale=球半径(影响透视与距离感)。
export function PanoramaSphere({ url, yaw = 0, scale = 1 }: { url: string; yaw?: number; scale?: number }) {
  const tex = useTexture(url);
  const ref = useRef<Mesh>(null);
  const s = scale > 0 ? scale : 1;
  useFrame(({ camera }) => {
    const m = ref.current;
    if (m) m.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} rotation={[0, yaw * Math.PI / 180, 0]} scale={[-s, s, s]}>
      {/* 反面渲染 + x 翻转，使贴图正确朝内、左右不镜像 */}
      <sphereGeometry args={[60, 60, 40]} />
      <meshBasicMaterial map={tex} side={BackSide} toneMapped={false} />
    </mesh>
  );
}
