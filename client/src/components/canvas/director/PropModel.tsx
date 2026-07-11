import { useMemo } from "react";
import * as THREE from "three";
import type { DirectorActor } from "../../../../../shared/types";

/**
 * #71 多物体：几何体道具渲染（方块/球体/圆柱/圆锥/平面板）。
 * 与人偶同为 DirectorActor（prim 置位），共享选中/变换/编组/控制图链路：
 * 道具网格进 ACTORS_GROUP，深度/法线控制图自然包含道具结构。
 * 尺寸按「米」贴合人偶比例（人高 ~1.7m）：方块 0.8m、球径 0.8m、柱高 1m、平面 1.6m 宽。
 */
export function PropModel({ actor, selected }: { actor: DirectorActor; selected: boolean }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: actor.color || "#8a93a6",
    roughness: 0.65,
    metalness: 0.05,
    side: actor.prim === "plane" ? THREE.DoubleSide : THREE.FrontSide,
    emissive: selected ? new THREE.Color("#4f8dff") : new THREE.Color("#000000"),
    emissiveIntensity: selected ? 0.35 : 0,
  }), [actor.color, actor.prim, selected]);

  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: actor.color && actor.color !== "#8a93a6" ? actor.color : "#8a6a4f",
    roughness: 0.75, metalness: 0.02,
    emissive: selected ? new THREE.Color("#4f8dff") : new THREE.Color("#000000"),
    emissiveIntensity: selected ? 0.3 : 0,
  }), [actor.color, selected]);
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#3f7a4a", roughness: 0.8,
    emissive: selected ? new THREE.Color("#4f8dff") : new THREE.Color("#000000"),
    emissiveIntensity: selected ? 0.3 : 0,
  }), [selected]);

  switch (actor.prim) {
    case "sphere":
      return <mesh material={mat} castShadow position={[0, 0.4, 0]}><sphereGeometry args={[0.4, 32, 24]} /></mesh>;
    case "cylinder":
      return <mesh material={mat} castShadow position={[0, 0.5, 0]}><cylinderGeometry args={[0.3, 0.3, 1, 28]} /></mesh>;
    case "cone":
      return <mesh material={mat} castShadow position={[0, 0.5, 0]}><coneGeometry args={[0.35, 1, 28]} /></mesh>;
    case "plane":
      // 立板（宽1.6m×高1.2m），常用作墙面/幕布/桌板占位；贴地竖立
      return <mesh material={mat} castShadow position={[0, 0.6, 0]}><boxGeometry args={[1.6, 1.2, 0.04]} /></mesh>;
    // ── 复合道具（米制贴合人偶：桌高0.75 椅座0.45 床高0.45 门高2.1 树高2.6）──
    case "table":
      return (
        <group>
          <mesh material={woodMat} castShadow position={[0, 0.73, 0]}><boxGeometry args={[1.4, 0.05, 0.8]} /></mesh>
          {[[-0.63, -0.33], [0.63, -0.33], [-0.63, 0.33], [0.63, 0.33]].map(([x, z], i) => (
            <mesh key={i} material={woodMat} castShadow position={[x, 0.355, z]}><boxGeometry args={[0.06, 0.71, 0.06]} /></mesh>
          ))}
        </group>
      );
    case "chair":
      return (
        <group>
          <mesh material={woodMat} castShadow position={[0, 0.44, 0]}><boxGeometry args={[0.45, 0.04, 0.45]} /></mesh>
          <mesh material={woodMat} castShadow position={[0, 0.75, -0.205]}><boxGeometry args={[0.45, 0.62, 0.04]} /></mesh>
          {[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([x, z], i) => (
            <mesh key={i} material={woodMat} castShadow position={[x, 0.21, z]}><boxGeometry args={[0.045, 0.42, 0.045]} /></mesh>
          ))}
        </group>
      );
    case "bed":
      return (
        <group>
          <mesh material={woodMat} castShadow position={[0, 0.18, 0]}><boxGeometry args={[1.1, 0.36, 2.05]} /></mesh>
          <mesh material={mat} castShadow position={[0, 0.42, 0]}><boxGeometry args={[1.05, 0.14, 2.0]} /></mesh>
          <mesh material={woodMat} castShadow position={[0, 0.55, -1.0]}><boxGeometry args={[1.1, 0.75, 0.06]} /></mesh>
        </group>
      );
    case "doorframe":
      return (
        <group>
          <mesh material={woodMat} castShadow position={[-0.48, 1.05, 0]}><boxGeometry args={[0.1, 2.1, 0.12]} /></mesh>
          <mesh material={woodMat} castShadow position={[0.48, 1.05, 0]}><boxGeometry args={[0.1, 2.1, 0.12]} /></mesh>
          <mesh material={woodMat} castShadow position={[0, 2.13, 0]}><boxGeometry args={[1.06, 0.1, 0.12]} /></mesh>
        </group>
      );
    case "stairs":
      return (
        <group>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} material={mat} castShadow position={[0, 0.09 + i * 0.18, -i * 0.28]}><boxGeometry args={[1.2, 0.18, 0.28]} /></mesh>
          ))}
        </group>
      );
    case "tree":
      return (
        <group>
          <mesh material={woodMat} castShadow position={[0, 0.55, 0]}><cylinderGeometry args={[0.09, 0.13, 1.1, 12]} /></mesh>
          <mesh material={leafMat} castShadow position={[0, 1.5, 0]}><coneGeometry args={[0.75, 1.5, 14]} /></mesh>
          <mesh material={leafMat} castShadow position={[0, 2.15, 0]}><coneGeometry args={[0.5, 1.0, 14]} /></mesh>
        </group>
      );
    case "box":
    default:
      return <mesh material={mat} castShadow position={[0, 0.4, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /></mesh>;
  }
}
