import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { ndcToPixel, OPENPOSE_BONES, OPENPOSE_PAIRS, OPENPOSE_COLORS, actorKeypoints } from "./directorOpenpose";

describe("ndcToPixel", () => {
  it("maps NDC center to canvas center", () => {
    expect(ndcToPixel(new THREE.Vector3(0, 0, 0), 100, 200)).toMatchObject({ x: 50, y: 100, visible: true });
  });
  it("maps NDC corners (Y is flipped: +1 → top)", () => {
    expect(ndcToPixel(new THREE.Vector3(-1, 1, 0), 100, 200)).toMatchObject({ x: 0, y: 0 });
    expect(ndcToPixel(new THREE.Vector3(1, -1, 0), 100, 200)).toMatchObject({ x: 100, y: 200 });
  });
  it("marks points behind the camera / beyond far as invisible", () => {
    expect(ndcToPixel(new THREE.Vector3(0, 0, -1.5), 10, 10).visible).toBe(false);
    expect(ndcToPixel(new THREE.Vector3(0, 0, 1.5), 10, 10).visible).toBe(false);
    expect(ndcToPixel(new THREE.Vector3(0, 0, 0.5), 10, 10).visible).toBe(true);
  });
});

describe("OpenPose COCO-18 constants", () => {
  it("has 18 keypoints and 18 colors", () => {
    expect(OPENPOSE_BONES).toHaveLength(18);
    expect(OPENPOSE_COLORS).toHaveLength(18);
  });
  it("every limb pair references valid keypoint indices", () => {
    for (const [a, b] of OPENPOSE_PAIRS) {
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(18);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(18);
    }
  });
});

describe("actorKeypoints", () => {
  it("projects real bone world positions and derives face points from the head", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1.5, 4);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    // 造一个最小骨架：仅头/颈两块骨，验证投影落在画面内、面部点被派生。
    const root = new THREE.Group();
    const head = new THREE.Object3D(); head.name = "mixamorigHead"; head.position.set(0, 1.7, 0);
    const neck = new THREE.Object3D(); neck.name = "mixamorigNeck"; neck.position.set(0, 1.5, 0);
    root.add(head, neck);
    root.updateMatrixWorld(true);
    const kp = actorKeypoints(root, camera, 512, 512);
    expect(kp[0]).not.toBeNull();               // 鼻(头)可见
    expect(kp[1]).not.toBeNull();               // 颈可见
    expect(kp[0]!.x).toBeGreaterThan(150); expect(kp[0]!.x).toBeLessThan(362); // 大致居中
    expect(kp[14]).not.toBeNull();              // 右眼由头派生
    expect(kp[15]).not.toBeNull();              // 左眼由头派生
    expect(kp[15]!.x).toBeGreaterThan(kp[14]!.x); // 左眼在右眼右侧（屏幕 x 更大）
    expect(kp[4]).toBeNull();                   // 无右腕骨 → null
  });
});
