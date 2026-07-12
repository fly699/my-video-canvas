import { Suspense } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Grid, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { DirectorScene } from "../../../../../shared/types";
import { aspectRatioValue } from "../../../lib/directorScene";
import { usePerfStore, selectPerfLite } from "../../../lib/perfMode";
import { HumanModel } from "./HumanModel";
import { GlbModel } from "./GlbModel";
import { PanoramaSphere } from "./Panorama";

// 机位画面实时预览小窗（LibTV 模块3/25「摄像机画面预览」）：在导演视角自由布局的同时，
// 右下角小窗实时显示「当前机位」的最终取景（所见即截图）。独立第二 Canvas，只读渲染，
// 相机每帧锁定到 scene.camera，不参与交互。

// #78 预览里的聚光（挂 target，无标记球）
function PreviewSpot({ position, target, color, intensity, angle }: {
  position: [number, number, number]; target: [number, number, number]; color: string; intensity: number; angle: number;
}) {
  const ref = { light: null as THREE.SpotLight | null, tgt: null as THREE.Object3D | null };
  return (
    <>
      <spotLight ref={(l) => { ref.light = l; if (l && ref.tgt) l.target = ref.tgt; }} position={position} color={color} intensity={intensity} angle={angle} penumbra={0.35} decay={0} />
      <object3D ref={(o) => { ref.tgt = o; if (o && ref.light) { ref.light.target = o; o.updateMatrixWorld(); } }} position={target} />
    </>
  );
}

function LockCam({ cam }: { cam: { position: [number, number, number]; target: [number, number, number]; fov: number } }) {
  const { camera } = useThree();
  useFrame(() => {
    const c = camera as THREE.PerspectiveCamera;
    c.position.set(...cam.position);
    c.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    if (c.fov !== cam.fov) { c.fov = cam.fov; c.updateProjectionMatrix(); }
  });
  return null;
}

export function ShotPreview({ scene }: { scene: DirectorScene }) {
  // #81 lite：第二 3D 视口是纯预览，降 dpr/关抗锯齿（取景内容与主视口锁定逻辑不变）。
  const perfLite = usePerfStore(selectPerfLite);
  const ar = aspectRatioValue(scene.aspectRatio);
  const w = 224, h = Math.max(80, Math.round(w / ar));
  const S = scene.sceneScale ?? 1;
  const oy = scene.sceneOffsetY ?? 0;
  const ox = scene.sceneOffsetX ?? 0;
  const oz = scene.sceneOffsetZ ?? 0;
  const groups = scene.groups ?? [];
  const deg = Math.PI / 180;
  return (
    <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 5, width: w, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", boxShadow: "0 8px 28px oklch(0 0 0 / 0.6)", background: "#07090e" }}>
      <div style={{ height: h, position: "relative" }}>
        <Canvas dpr={perfLite ? 1 : [1, 1.5]} gl={{ antialias: !perfLite }} style={{ width: "100%", height: "100%" }}
          camera={{ position: scene.camera.position, fov: scene.camera.fov, near: 0.1, far: 2000 }}>
          <color attach="background" args={[scene.background || (scene.panoramaUrl ? "#060608" : "#1a1d24")]} />
          <LockCam cam={scene.camera} />
          {scene.panoramaUrl && !scene.background && (
            <Suspense fallback={null}>
              <PanoramaSphere url={scene.panoramaUrl} yaw={scene.panoramaYaw ?? 0} pitch={scene.panoramaPitch ?? 0} roll={scene.panoramaRoll ?? 0} scale={scene.panoramaScale ?? 1} />
            </Suspense>
          )}
          {/* #78 与主视口一致：有布光且压暗基础光时压低环境光，并渲染真实灯光（无标记球） */}
          <ambientLight intensity={(scene.lights?.length ?? 0) && scene.dimBase !== false ? 0.12 : 0.7} />
          <directionalLight position={[4, 8, 5]} intensity={(scene.lights?.length ?? 0) && scene.dimBase !== false ? 0.15 : 1.1} />
          <directionalLight position={[-5, 4, -3]} intensity={(scene.lights?.length ?? 0) && scene.dimBase !== false ? 0.06 : 0.4} />
          {(scene.lights ?? []).map((l) => (
            l.kind === "spot"
              ? <PreviewSpot key={l.id} position={l.position} target={l.target ?? [0, 1, 0]} color={l.color} intensity={l.intensity} angle={(l.angle ?? 40) * Math.PI / 180} />
              : <pointLight key={l.id} position={l.position} color={l.color} intensity={l.intensity} decay={0} />
          ))}
          {scene.groundVisible && (
            <Grid args={[40, 40]} cellSize={0.5} cellThickness={0.6} sectionSize={2} sectionThickness={1} infiniteGrid fadeDistance={26} cellColor="#2a2f3a" sectionColor="#3a4150" />
          )}
          {scene.background !== "#000000" && (
            <ContactShadows position={[ox, oy + 0.01, oz]} scale={24} resolution={512} blur={2.6} far={5} opacity={0.5} color="#000000" />
          )}
          <group position={[ox, oy, oz]} scale={S}>
            {groups.map((g) => (
              <group key={g.id} position={g.position} rotation={[g.rotation[0] * deg, g.rotation[1] * deg, g.rotation[2] * deg]} scale={g.scale}>
                {scene.actors.filter((a) => a.groupId === g.id).map((a) => (
                  <group key={a.id} position={a.position} rotation={[a.rotation[0] * deg, a.rotation[1] * deg, a.rotation[2] * deg]} scale={a.scale}>
                    {a.glbUrl ? <GlbModel actor={a} selected={false} /> : <HumanModel actor={a} selected={false} />}
                  </group>
                ))}
              </group>
            ))}
            {scene.actors.filter((a) => !a.groupId).map((a) => (
              <group key={a.id} position={a.position} rotation={[a.rotation[0] * deg, a.rotation[1] * deg, a.rotation[2] * deg]} scale={a.scale}>
                {a.glbUrl ? <GlbModel actor={a} selected={false} /> : <HumanModel actor={a} selected={false} />}
              </group>
            ))}
          </group>
        </Canvas>
        {/* 取景三分线 */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, width: 1, background: "oklch(1 0 0 / 0.1)" }} />
          <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, width: 1, background: "oklch(1 0 0 / 0.1)" }} />
          <div style={{ position: "absolute", top: "33.33%", left: 0, right: 0, height: 1, background: "oklch(1 0 0 / 0.1)" }} />
          <div style={{ position: "absolute", top: "66.66%", left: 0, right: 0, height: 1, background: "oklch(1 0 0 / 0.1)" }} />
        </div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--c-t3)", padding: "3px 8px", background: "color-mix(in oklch, var(--c-elevated) 92%, transparent)", display: "flex", justifyContent: "space-between" }}>
        <span>📷 机位预览</span>
        <span style={{ color: "var(--c-t4)" }}>{scene.camera.name ?? "机位"} · {scene.aspectRatio}</span>
      </div>
    </div>
  );
}
