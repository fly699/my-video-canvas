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
    case "box":
    default:
      return <mesh material={mat} castShadow position={[0, 0.4, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /></mesh>;
  }
}
