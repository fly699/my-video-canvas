import { useMemo } from "react";
import type { DirectorActor } from "../../../../../shared/types";
import { mannequinModel } from "../../../lib/directorScene";

// 参数化图元人偶（无需 GLB）：用胶囊+球体搭一个比例正确、站立的人形，
// 各肢体以「关节为枢轴」的 group 组织，便于 P2 加关节角度(FK)。颜色取自 actor.color，
// 用于「彩色人偶替换 / 黑底分离」等参考技法。选中时整体发光高亮。
const D = Math.PI / 180;

export function Mannequin({ actor, selected, onSelect }: {
  actor: DirectorActor;
  selected: boolean;
  onSelect: (e: { stopPropagation: () => void }) => void;
}) {
  const m = mannequinModel(actor.model);
  const H = m.height;          // 站高(米)
  const B = m.build;           // 体宽系数
  const pose = actor.pose ?? {};
  const rad = (k: string) => (pose[k] ?? 0) * D;

  // 关键高度（按 H 比例）
  const y = useMemo(() => ({
    hip: 0.50 * H, knee: 0.27 * H, ankle: 0.05 * H,
    chest: 0.70 * H, shoulder: 0.82 * H, neck: 0.86 * H, head: 0.93 * H,
  }), [H]);
  const hipDx = 0.09 * H * B;
  const shoulderDx = 0.20 * H * B;

  const mat = (extra = 1) => (
    <meshStandardMaterial
      color={actor.color}
      roughness={0.55}
      metalness={0.05}
      emissive={selected ? actor.color : "#000000"}
      emissiveIntensity={selected ? 0.35 * extra : 0}
    />
  );

  // 一段「枢轴在顶端、向下延伸」的肢体（胶囊），父 group 位于关节、旋转即绕关节。
  const Limb = ({ len, r }: { len: number; r: number }) => (
    <mesh position={[0, -len / 2, 0]} castShadow>
      <capsuleGeometry args={[r, Math.max(0.001, len - 2 * r), 4, 10]} />
      {mat()}
    </mesh>
  );

  return (
    <group
      position={actor.position}
      rotation={[actor.rotation[0] * D, actor.rotation[1] * D, actor.rotation[2] * D]}
      scale={actor.scale}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(e); }}
    >
      {/* 躯干（骨盆→胸） + 头 */}
      <group position={[0, y.hip, 0]} rotation={[rad("torsoForward"), rad("torsoTwist"), rad("torsoSide")]}>
        {/* 躯干主体 */}
        <mesh position={[0, (y.shoulder - y.hip) / 2, 0]} castShadow>
          <capsuleGeometry args={[0.115 * B, Math.max(0.02, (y.shoulder - y.hip) - 0.18 * B), 4, 12]} />
          {mat()}
        </mesh>
        {/* 骨盆 */}
        <mesh position={[0, -0.02 * H, 0]} castShadow>
          <capsuleGeometry args={[0.11 * B, 0.05 * H, 4, 12]} />
          {mat()}
        </mesh>
        {/* 颈 + 头 */}
        <group position={[0, y.shoulder - y.hip, 0]} rotation={[rad("headNod"), rad("headTurn"), rad("headTilt")]}>
          <mesh position={[0, (y.neck - y.shoulder) / 2 + 0.01, 0]} castShadow>
            <capsuleGeometry args={[0.035 * B, 0.04 * H, 4, 8]} />
            {mat()}
          </mesh>
          <mesh position={[0, (y.head - y.shoulder), 0]} castShadow>
            <sphereGeometry args={[0.072 * H, 18, 18]} />
            {mat(1.2)}
          </mesh>
        </group>

        {/* 左臂（朝向 +x），枢轴在肩 */}
        <group position={[shoulderDx, y.shoulder - y.hip - 0.02 * H, 0]}
          rotation={[rad("armLForward"), 0, (12 + (pose.armLOut ?? 0)) * D + (pose.armLTwist ?? 0) * 0]}>
          <Limb len={0.32 * H} r={0.045 * B} />
          {/* 肘 + 前臂 */}
          <group position={[0, -0.32 * H, 0]} rotation={[rad("elbowL"), 0, 0]}>
            <Limb len={0.30 * H} r={0.038 * B} />
          </group>
        </group>
        {/* 右臂（朝向 -x） */}
        <group position={[-shoulderDx, y.shoulder - y.hip - 0.02 * H, 0]}
          rotation={[rad("armRForward"), 0, -(12 + (pose.armROut ?? 0)) * D]}>
          <Limb len={0.32 * H} r={0.045 * B} />
          <group position={[0, -0.32 * H, 0]} rotation={[rad("elbowR"), 0, 0]}>
            <Limb len={0.30 * H} r={0.038 * B} />
          </group>
        </group>
      </group>

      {/* 左腿，枢轴在髋 */}
      <group position={[hipDx, y.hip, 0]} rotation={[rad("legLForward"), 0, (pose.legLOut ?? 0) * D]}>
        <Limb len={y.hip - y.knee} r={0.058 * B} />
        <group position={[0, -(y.hip - y.knee), 0]} rotation={[rad("kneeL"), 0, 0]}>
          <Limb len={y.knee - y.ankle} r={0.048 * B} />
          {/* 脚 */}
          <mesh position={[0, -(y.knee - y.ankle) - 0.01 * H, 0.05 * H]} castShadow>
            <boxGeometry args={[0.08 * B, 0.05 * H, 0.16 * H]} />
            {mat()}
          </mesh>
        </group>
      </group>
      {/* 右腿 */}
      <group position={[-hipDx, y.hip, 0]} rotation={[rad("legRForward"), 0, -(pose.legROut ?? 0) * D]}>
        <Limb len={y.hip - y.knee} r={0.058 * B} />
        <group position={[0, -(y.hip - y.knee), 0]} rotation={[rad("kneeR"), 0, 0]}>
          <Limb len={y.knee - y.ankle} r={0.048 * B} />
          <mesh position={[0, -(y.knee - y.ankle) - 0.01 * H, 0.05 * H]} castShadow>
            <boxGeometry args={[0.08 * B, 0.05 * H, 0.16 * H]} />
            {mat()}
          </mesh>
        </group>
      </group>

      {/* 选中描边圈（地面投影环） */}
      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.28 * B, 0.34 * B, 32]} />
          <meshBasicMaterial color={actor.color} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}
