import { Suspense } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Grid, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { DirectorScene } from "../../../../../shared/types";
import { aspectRatioValue } from "../../../lib/directorScene";
import { HumanModel } from "./HumanModel";
import { GlbModel } from "./GlbModel";
import { PanoramaSphere } from "./Panorama";

// 机位画面实时预览小窗（LibTV 模块3/25「摄像机画面预览」）：在导演视角自由布局的同时，
// 右下角小窗实时显示「当前机位」的最终取景（所见即截图）。独立第二 Canvas，只读渲染，
// 相机每帧锁定到 scene.camera，不参与交互。

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
  const ar = aspectRatioValue(scene.aspectRatio);
  const w = 224, h = Math.max(80, Math.round(w / ar));
  const S = scene.sceneScale ?? 1;
  const oy = scene.sceneOffsetY ?? 0;
  const groups = scene.groups ?? [];
  const deg = Math.PI / 180;
  return (
    <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 5, width: w, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", boxShadow: "0 8px 28px oklch(0 0 0 / 0.6)", background: "#07090e" }}>
      <div style={{ height: h, position: "relative" }}>
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true }} style={{ width: "100%", height: "100%" }}
          camera={{ position: scene.camera.position, fov: scene.camera.fov, near: 0.1, far: 2000 }}>
          <color attach="background" args={[scene.background || (scene.panoramaUrl ? "#060608" : "#1a1d24")]} />
          <LockCam cam={scene.camera} />
          {scene.panoramaUrl && !scene.background && (
            <Suspense fallback={null}>
              <PanoramaSphere url={scene.panoramaUrl} yaw={scene.panoramaYaw ?? 0} scale={scene.panoramaScale ?? 1} />
            </Suspense>
          )}
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 8, 5]} intensity={1.1} />
          <directionalLight position={[-5, 4, -3]} intensity={0.4} />
          {scene.groundVisible && (
            <Grid args={[40, 40]} cellSize={0.5} cellThickness={0.6} sectionSize={2} sectionThickness={1} infiniteGrid fadeDistance={26} cellColor="#2a2f3a" sectionColor="#3a4150" />
          )}
          {scene.background !== "#000000" && (
            <ContactShadows position={[0, oy + 0.01, 0]} scale={24} resolution={512} blur={2.6} far={5} opacity={0.5} color="#000000" />
          )}
          <group position={[0, oy, 0]} scale={S}>
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
