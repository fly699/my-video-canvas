import { useTexture } from "@react-three/drei";
import { BackSide } from "three";

// 720°全景背景：把等距(equirectangular)全景图贴到一个大球内壁，角色置于其中即融入真实场景。
// 球在世界空间，转动视角时背景同步——与文档「全景图融入导演台」一致。
export function PanoramaSphere({ url }: { url: string }) {
  const tex = useTexture(url);
  return (
    <mesh scale={[-1, 1, 1]}>
      {/* 反面渲染 + x 翻转，使贴图正确朝内、左右不镜像 */}
      <sphereGeometry args={[60, 60, 40]} />
      <meshBasicMaterial map={tex} side={BackSide} toneMapped={false} />
    </mesh>
  );
}
