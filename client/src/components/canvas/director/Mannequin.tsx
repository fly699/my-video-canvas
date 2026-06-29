import { useMemo } from "react";
import type { DirectorActor } from "../../../../../shared/types";
import { mannequinModel } from "../../../lib/directorScene";

// 参数化「艺用人偶」（无需 GLB，靠近 LibTV 质感）：平滑胶囊肢段 + 各关节球 + 可分辨正脸的头。
// 各肢体以「关节为枢轴」的 group 组织(FK)。关节方向规整为「正值=直觉方向」：
//   前举/抬腿 正值=向前(+z)，屈肘 正值=前屈，屈膝 正值=后屈；外展 正值=向外抬。
// 颜色取自 actor.color（彩色人偶/黑底分离参考技法），选中时发光 + 地面环高亮。
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
  const P = (k: string) => (pose[k] ?? 0) * D;        // 正值=直觉方向
  const Pn = (k: string) => -(pose[k] ?? 0) * D;      // 前后向关节取负，让正值=向前

  const yk = useMemo(() => ({
    hip: 0.50 * H, knee: 0.27 * H, ankle: 0.05 * H,
    shoulder: 0.82 * H, neck: 0.86 * H, head: 0.93 * H,
  }), [H]);
  // 7.5 头身比例（协调）：手臂指尖约到大腿中部、头约 1/7.5 身高。
  const hipDx = 0.082 * H * B;
  const shoulderDx = 0.15 * H * B;
  const headLocalY = yk.head - yk.hip;
  const rHead = 0.062 * H;
  const torsoLen = yk.shoulder - yk.hip;
  const upperArm = 0.165 * H, foreArm = 0.155 * H;
  const thigh = yk.hip - yk.knee, shin = yk.knee - yk.ankle;

  const mat = (extra = 1) => (
    <meshStandardMaterial color={actor.color} roughness={0.5} metalness={0.04}
      emissive={selected ? actor.color : "#000000"} emissiveIntensity={selected ? 0.3 * extra : 0} />
  );
  const dark = (c = "#15171c", rough = 0.4) => <meshStandardMaterial color={c} roughness={rough} />;

  // 球关节
  const Ball = ({ r }: { r: number }) => (
    <mesh castShadow><sphereGeometry args={[r, 18, 18]} />{mat()}</mesh>
  );
  // 一段肢体：顶端球关节 + 平滑胶囊（向下延伸） + 可选末端球（手）
  const Limb = ({ len, r, joint, hand }: { len: number; r: number; joint: number; hand?: boolean }) => (
    <>
      <Ball r={joint} />
      <mesh position={[0, -len / 2, 0]} castShadow>
        <capsuleGeometry args={[r, Math.max(0.001, len - 2 * r), 8, 18]} />
        {mat()}
      </mesh>
      {hand && <mesh position={[0, -len, 0]} castShadow><sphereGeometry args={[r * 1.3, 12, 12]} />{mat()}</mesh>}
    </>
  );

  return (
    <group
      position={actor.position}
      rotation={[actor.rotation[0] * D, actor.rotation[1] * D, actor.rotation[2] * D]}
      scale={actor.scale}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(e); }}
    >
      {/* 髋部球 + 躯干 + 头 */}
      <group position={[0, yk.hip, 0]} rotation={[P("torsoForward"), P("torsoTwist"), P("torsoSide")]}>
        {/* 骨盆（宽） */}
        <mesh position={[0, 0.0 * H, 0]} scale={[1.05, 0.9, 0.78]} castShadow>
          <sphereGeometry args={[0.115 * B, 20, 16]} />{mat()}
        </mesh>
        {/* 腰（细） */}
        <mesh position={[0, torsoLen * 0.34, 0]} scale={[1, 1, 0.78]} castShadow>
          <sphereGeometry args={[0.082 * B, 18, 16]} />{mat()}
        </mesh>
        {/* 胸/肋（上宽下窄、前后扁，更像躯干） */}
        <mesh position={[0, torsoLen * 0.66, 0]} scale={[1.15, 1.25, 0.72]} castShadow>
          <sphereGeometry args={[0.125 * B, 24, 20]} />{mat()}
        </mesh>
        {/* 肩/锁骨横连 */}
        <mesh position={[0, torsoLen * 0.9, 0.01 * H]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.055 * B, shoulderDx * 1.5, 8, 14]} />{mat()}
        </mesh>
        {/* 胸前朝向片：标明身体正面(+z) */}
        <mesh position={[0, torsoLen * 0.66, 0.1 * B]}>
          <boxGeometry args={[0.12 * B, 0.15 * H, 0.012]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.14} />
        </mesh>

        {/* 颈 + 头（五官朝 +z，随 head 关节转动）。头略呈蛋形(上窄下宽)更像真人。 */}
        <group position={[0, torsoLen + 0.005 * H, 0]} rotation={[P("headNod"), P("headTurn"), P("headTilt")]}>
          {/* 颈 + 斜方/锁骨过渡 */}
          <mesh position={[0, (yk.neck - yk.shoulder) / 2, 0]} castShadow>
            <capsuleGeometry args={[0.036 * B, 0.05 * H, 8, 14]} />
            {mat()}
          </mesh>
          {(() => { const hy = headLocalY - torsoLen; return (
            <group position={[0, hy, 0]}>
              {/* 颅 + 下颌：用两层球叠出蛋形 */}
              <mesh position={[0, rHead * 0.12, 0]} scale={[1, 1.18, 1.04]} castShadow>
                <sphereGeometry args={[rHead, 28, 28]} />{mat(1.2)}
              </mesh>
              <mesh position={[0, -rHead * 0.5, rHead * 0.1]} scale={[0.86, 0.8, 0.92]} castShadow>
                <sphereGeometry args={[rHead, 20, 20]} />{mat(1.2)}
              </mesh>
              {/* 双眼 + 眉 */}
              {[-1, 1].map((s) => (
                <group key={s}>
                  <mesh position={[s * rHead * 0.38, rHead * 0.16, rHead * 0.84]}>
                    <sphereGeometry args={[rHead * 0.17, 14, 14]} />{dark("#15171c", 0.25)}
                  </mesh>
                  <mesh position={[s * rHead * 0.38, rHead * 0.36, rHead * 0.82]} rotation={[0, 0, s * 0.2]}>
                    <boxGeometry args={[rHead * 0.34, rHead * 0.07, rHead * 0.12]} />{dark("#2a2d36", 0.7)}
                  </mesh>
                  {/* 耳 */}
                  <mesh position={[s * rHead * 0.96, 0, 0]} scale={[0.5, 1, 0.7]}>
                    <sphereGeometry args={[rHead * 0.28, 12, 12]} />{mat()}
                  </mesh>
                </group>
              ))}
              {/* 鼻 */}
              <mesh position={[0, -rHead * 0.02, rHead * 0.95]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[rHead * 0.15, rHead * 0.34, 12]} />{mat()}
              </mesh>
              {/* 嘴 */}
              <mesh position={[0, -rHead * 0.42, rHead * 0.78]}>
                <boxGeometry args={[rHead * 0.34, rHead * 0.06, rHead * 0.08]} />{dark("#7a3b3b", 0.6)}
              </mesh>
              {/* 脑后发块（区分前后） */}
              <mesh position={[0, rHead * 0.34, -rHead * 0.42]} scale={[1.04, 1.1, 1.0]}>
                <sphereGeometry args={[rHead * 0.82, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.62]} />{dark("#2a2d36", 0.85)}
              </mesh>
            </group>
          ); })()}
        </group>

        {/* 左臂 */}
        <group position={[shoulderDx, torsoLen * 0.92, 0]} rotation={[Pn("armLForward"), 0, (12 + (pose.armLOut ?? 0)) * D]}>
          <Limb len={upperArm} r={0.044 * B} joint={0.055 * B} />
          <group position={[0, -upperArm, 0]} rotation={[Pn("elbowL"), 0, 0]}>
            <Limb len={foreArm} r={0.036 * B} joint={0.044 * B} hand />
          </group>
        </group>
        {/* 右臂 */}
        <group position={[-shoulderDx, torsoLen * 0.92, 0]} rotation={[Pn("armRForward"), 0, -(12 + (pose.armROut ?? 0)) * D]}>
          <Limb len={upperArm} r={0.044 * B} joint={0.055 * B} />
          <group position={[0, -upperArm, 0]} rotation={[Pn("elbowR"), 0, 0]}>
            <Limb len={foreArm} r={0.036 * B} joint={0.044 * B} hand />
          </group>
        </group>
      </group>

      {/* 左腿 */}
      <group position={[hipDx, yk.hip, 0]} rotation={[Pn("legLForward"), 0, (pose.legLOut ?? 0) * D]}>
        <Limb len={thigh} r={0.062 * B} joint={0.072 * B} />
        <group position={[0, -thigh, 0]} rotation={[P("kneeL"), 0, 0]}>
          <Limb len={shin} r={0.05 * B} joint={0.058 * B} />
          <mesh position={[0, -shin - 0.01 * H, 0.045 * H]} castShadow>
            <boxGeometry args={[0.085 * B, 0.055 * H, 0.17 * H]} />{mat()}
          </mesh>
        </group>
      </group>
      {/* 右腿 */}
      <group position={[-hipDx, yk.hip, 0]} rotation={[Pn("legRForward"), 0, -(pose.legROut ?? 0) * D]}>
        <Limb len={thigh} r={0.062 * B} joint={0.072 * B} />
        <group position={[0, -thigh, 0]} rotation={[P("kneeR"), 0, 0]}>
          <Limb len={shin} r={0.05 * B} joint={0.058 * B} />
          <mesh position={[0, -shin - 0.01 * H, 0.045 * H]} castShadow>
            <boxGeometry args={[0.085 * B, 0.055 * H, 0.17 * H]} />{mat()}
          </mesh>
        </group>
      </group>

      {selected && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.28 * B, 0.34 * B, 40]} />
          <meshBasicMaterial color={actor.color} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}
