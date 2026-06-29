import { useTexture } from "@react-three/drei";
import { BackSide } from "three";

// 720°全景背景：把等距(equirectangular)全景图贴到一个大球内壁，角色置于其中即融入真实场景。
// 球在世界空间，转动视角时背景同步——与文档「全景图融入导演台」一致。
// yaw 旋转背景朝向、y 升降全景球（对齐地面与脚底）、scale 缩放全景球（匹配人物/场景尺度，模块16）。
export function PanoramaSphere({ url, yaw = 0, y = 0, scale = 1 }: { url: string; yaw?: number; y?: number; scale?: number }) {
  const tex = useTexture(url);
  const s = scale > 0 ? scale : 1;
  return (
    <mesh position={[0, y, 0]} rotation={[0, yaw * Math.PI / 180, 0]} scale={[-s, s, s]}>
      {/* 反面渲染 + x 翻转，使贴图正确朝内、左右不镜像 */}
      <sphereGeometry args={[60, 60, 40]} />
      <meshBasicMaterial map={tex} side={BackSide} toneMapped={false} />
    </mesh>
  );
}
