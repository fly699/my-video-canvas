import { useRef } from "react";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { BackSide, type Mesh } from "three";

// 720°全景背景：把等距(equirectangular)全景图贴到一个大球内壁，角色置于其中即融入真实场景。
// 关键：球做成「天空盒」——每帧把球心跟随相机水平位置(仅 X/Z)，使相机永远在球内、背景始终
// 环绕(无论怎么缩放/拉远都不会变成飘在一旁的小球，修复「空间位置根本不对」)；Y 固定在 panoY，
// 让画中的地面/地平线相对人物稳定。yaw 旋转朝向、scale=球半径(影响透视与距离感)。
export function PanoramaSphere({ url, yaw = 0, y = 0, scale = 1 }: { url: string; yaw?: number; y?: number; scale?: number }) {
  const tex = useTexture(url);
  const ref = useRef<Mesh>(null);
  const s = scale > 0 ? scale : 1;
  useFrame(({ camera }) => {
    const m = ref.current;
    if (m) m.position.set(camera.position.x, y, camera.position.z);
  });
  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[0, yaw * Math.PI / 180, 0]} scale={[-s, s, s]}>
      {/* 反面渲染 + x 翻转，使贴图正确朝内、左右不镜像 */}
      <sphereGeometry args={[60, 60, 40]} />
      <meshBasicMaterial map={tex} side={BackSide} toneMapped={false} />
    </mesh>
  );
}
