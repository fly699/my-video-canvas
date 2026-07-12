import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, TransformControls, ContactShadows, Html } from "@react-three/drei";
import * as THREE from "three";
import { toast } from "sonner";
import { X, Camera, Plus, Trash2, RotateCcw, Eye, EyeOff, Loader2, Grid3x3, ChevronDown, Upload, Copy, Boxes, PersonStanding, Download, Crosshair } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { propagateControlMap } from "../../../lib/refImagePropagation";
import { drawOpenpose } from "../../../lib/directorOpenpose";

// 渲控制图时用来隔离「只渲人物、避开网格/阴影/全景/gizmo」的 actors 组名。
const ACTORS_GROUP = "__director_actors__";
import type { DirectorScene, DirectorActor, DirectorCamera, DirectorLight, Vec3 } from "../../../../../shared/types";
import {
  MANNEQUIN_MODELS, DIRECTOR_ASPECTS, aspectRatioValue, makeActor, makeDefaultDirectorScene, makeCrowd, bakeGroupTransform, cloneGroupWithMembers, respaceCrowdMembers, makeGroupFromActors, CROWD_SPACING,
  ensureCameras, newCameraId, nextCameraName, actorWorldPosition, shotAimTarget, faceCameraYaw,
  PROP_PRIMS, makeProp, LAYOUT_TEMPLATES, templateActors, type PropPrim,
  makeLight, LIGHT_RIG_PRESETS, lightsFromRig, describeLights, LIGHT_KIND_LABEL, type LightRigPreset,
  loadMyLightRigs, saveMyLightRig, deleteMyLightRig, type MyLightRig,
} from "../../../lib/directorScene";
import { usePerfStore, selectPerfLite } from "../../../lib/perfMode";
// #71 多格式导入/导出：obj/stl/fbx/gltf 客户端解析 → 统一转 glb 上传；场景可导出 glb。
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { JOINT_GROUPS, POSE_PRESETS, applyPosePreset, mirrorPose, type Pose } from "../../../lib/directorPose";
import { GRID_PRESETS, gridCameraPosition, type GridPreset } from "../../../lib/directorGrid";
import { uploadAssetFileForUrl } from "../../../lib/assetUpload";
import { HumanModel } from "./HumanModel";
import { PropModel } from "./PropModel";
import { GlbModel } from "./GlbModel";
import { PanoramaSphere } from "./Panorama";
import { ShotPreview } from "./ShotPreview";

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res((r.result as string).split(",")[1]);
  r.onerror = () => rej(new Error("读取失败"));
  r.readAsDataURL(blob);
});
const canvasToBlob = (gl: THREE.WebGLRenderer): Promise<Blob | null> =>
  new Promise((res) => gl.domElement.toBlob((b) => res(b), "image/png"));

// 全屏 3D 导演台编辑器（P1）：摆放/选中人偶（数值精确 + Alt 微调）、控制机位(FOV)、
// 画幅取景框、截图→上传作为本节点的参考图。双视角/姿势/宫格/全景见后续期次。

// ── 可拖拽数值输入（支持 Alt 微调，步长缩到 1/10）─────────────────────────────
function DragNumber({ value, onChange, step = 0.05, label, fixed = 2, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; label?: string; fixed?: number; suffix?: string;
}) {
  const start = useRef<{ x: number; v: number; step: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, v: value, step: e.altKey ? step / 10 : step };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const s = e.altKey ? step / 10 : start.current.step;
    onChange(Number((start.current.v + (e.clientX - start.current.x) * s).toFixed(4)));
  };
  const onUp = () => { start.current = null; };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t3)" }}>
      {label && <span
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ minWidth: 30, cursor: "ew-resize", userSelect: "none", color: "var(--c-t4)" }}
        title="拖动调节，按住 Alt 微调（1/10 步长）"
      >{label}</span>}
      <input
        type="number" value={Number.isFinite(value) ? Number(value.toFixed(fixed)) : 0} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 72, padding: "3px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, outline: "none" }}
      />
      {suffix && <span style={{ color: "var(--c-t4)", fontSize: 10 }}>{suffix}</span>}
    </label>
  );
}

// LibTV 风格滑条：标签 + 横向滑轨（含 0 中点刻度）+ 实时数值框。用于关节/位置/旋转/缩放等。
function Slider({ label, value, min, max, step = 1, fixed = 0, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; fixed?: number; onChange: (v: number) => void;
}) {
  const span = max - min;
  const zeroPct = span > 0 ? ((0 - min) / span) * 100 : 50;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const reset = () => onChange(clamp(0)); // 双击重置为 0（模块6）
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span onDoubleClick={reset} title="双击重置为 0" style={{ width: 38, fontSize: 11, color: "var(--c-t3)", flexShrink: 0, cursor: "pointer", userSelect: "none" }}>{label}</span>
      <div style={{ position: "relative", flex: 1, height: 18, display: "flex", alignItems: "center" }}>
        {min < 0 && max > 0 && (
          <span style={{ position: "absolute", left: `${zeroPct}%`, top: 2, bottom: 2, width: 1, background: "var(--c-bd2)", pointerEvents: "none" }} />
        )}
        <input type="range" min={min} max={max} step={step} value={value}
          onDoubleClick={reset}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--ui-accent, var(--c-accent))", cursor: "pointer", margin: 0 }} />
      </div>
      <input type="number" value={Number(value.toFixed(fixed))} min={min} max={max} step={step}
        onDoubleClick={reset}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        style={{ width: 46, padding: "2px 4px", fontSize: 10.5, textAlign: "right", fontVariantNumeric: "tabular-nums", background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 5, outline: "none" }} />
    </div>
  );
}

// ── #78 真 3D 灯光实体：真实 three 光源（实时照亮人偶/道具）+ 可点选标记球（截图时隐藏）──
// 标记组 name="light-marker"：shoot/renderGrid/截图入库前统一隐藏（hideLightMarkers），
// 控制图渲染走「顶层非 ACTORS_GROUP 全隐藏」路径自然covered。decay=0 使强度手感线性可控。
function LightObj({ light, selected, onSelect, bindMarker }: {
  light: DirectorLight; selected: boolean; onSelect: () => void;
  bindMarker?: (el: THREE.Object3D | null) => void;
}) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const tgtRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (light.kind === "spot" && spotRef.current && tgtRef.current) {
      spotRef.current.target = tgtRef.current;
      tgtRef.current.updateMatrixWorld();
    }
  }, [light.kind, light.target]);
  const tgt = light.target ?? [0, 1.0, 0];
  return (
    <>
      {light.kind === "spot" ? (
        <>
          <spotLight ref={spotRef} position={light.position} color={light.color} intensity={light.intensity}
            angle={(light.angle ?? 40) * Math.PI / 180} penumbra={0.35} decay={0}
            castShadow={!!light.castShadow} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
          <object3D ref={tgtRef} position={tgt} />
        </>
      ) : (
        <pointLight position={light.position} color={light.color} intensity={light.intensity} decay={0} castShadow={!!light.castShadow} shadow-mapSize={[512, 512]} />
      )}
      {/* 标记球（可点选/拖拽；截图时隐藏）+ 选中线框环 + 聚光指向虚线 */}
      <group name="light-marker" position={light.position} ref={bindMarker as never}>
        <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={light.color} />
        </mesh>
        {selected && (
          <mesh>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshBasicMaterial color={light.color} wireframe transparent opacity={0.55} />
          </mesh>
        )}
      </group>
      {selected && light.kind === "spot" && (
        <group name="light-marker">
          {/* 指向线：光位 → 指向点（选中时可视化聚光方向） */}
          <line>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[new Float32Array([...light.position, ...tgt]), 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={light.color} transparent opacity={0.6} />
          </line>
          <mesh position={tgt}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <meshBasicMaterial color={light.color} transparent opacity={0.8} />
          </mesh>
        </group>
      )}
    </>
  );
}

// ── #84 3D 机位实体（对齐 LibTV 视频）：橙色相机本体 + FOV 视锥线框 + 名字标签 ──
// 点选即激活该机位并打开机位面板；激活机位可用移动/旋转手柄拖拽（移动改 position、
// 旋转改 target 朝向）。组名 "cam-marker"：截图/宫格/入库时统一隐藏（同灯光标记），
// 控制图渲染走「顶层非 ACTORS_GROUP 全隐藏」自然覆盖；Html 标签是 DOM 覆盖层，
// 本就不进 WebGL 截图缓冲。机位视角下隐藏当前机位自身（正从它眼里看，实体会糊脸）。
function CameraGizmo({ cam, active, hidden, labelsVisible, onSelect, bindRef }: {
  cam: DirectorCamera; active: boolean; hidden: boolean; labelsVisible: boolean;
  onSelect: () => void; bindRef?: (el: THREE.Object3D | null) => void;
}) {
  // 朝向：相机约定 -Z 指向注视点（Matrix4.lookAt 即相机式构造）
  const quat = useMemo(() => {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...cam.position), new THREE.Vector3(...cam.target), new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [cam.position, cam.target]);
  // FOV 视锥线框（局部空间，-Z 向前）：长度随机位到注视点距离取 35%，夹在 0.5~2.2m
  const frustum = useMemo(() => {
    const dist = Math.hypot(cam.target[0] - cam.position[0], cam.target[1] - cam.position[1], cam.target[2] - cam.position[2]);
    const len = Math.max(0.4, Math.min(1.25, dist * 0.22)); // #85 视锥更紧凑（此前过大喧宾夺主）
    const hh = len * Math.tan((cam.fov * Math.PI) / 360);
    const hw = hh * 16 / 9;
    const c = [[-hw, -hh, -len], [hw, -hh, -len], [hw, hh, -len], [-hw, hh, -len]];
    const pts: number[] = [];
    for (const p of c) pts.push(0, 0, 0, ...p);                     // 原点 → 四角
    for (let i = 0; i < 4; i++) pts.push(...c[i], ...c[(i + 1) % 4]); // 远端矩形
    return new Float32Array(pts);
  }, [cam.fov, cam.position, cam.target]);
  if (hidden) return null;
  const col = active ? "#ffb020" : "#c8933f";
  return (
    <group name="cam-marker" position={cam.position} quaternion={quat} ref={bindRef as never}>
      {/* 相机本体：机身 + 镜筒（可点选——点选热区用一个略大的透明包围盒承接，
          比逐 mesh 命中更好点；handler 直接挂 mesh 上） */}
      <mesh
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <boxGeometry args={[0.3, 0.26, 0.24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.18, 0.125, 0.1]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={active ? 0.55 : 0.2} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.08, 16]} />
        <meshStandardMaterial color="#2b2f38" roughness={0.3} />
      </mesh>
      <mesh position={[-0.04, 0.115, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.06, 12]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.25} roughness={0.5} />
      </mesh>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[frustum, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={col} transparent opacity={active ? 0.85 : 0.45} />
      </lineSegments>
      {labelsVisible && (
        <Html center position={[0, 0.26, 0]} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "1px 7px", borderRadius: 6, whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,0.8)", border: active ? "1px solid #ffb02088" : "1px solid transparent" }}>
            📷 {cam.name ?? "机位"}
          </div>
        </Html>
      )}
    </group>
  );
}

// drei OrbitControls 实例（含 target / update）。
type OrbitImpl = { target: THREE.Vector3; update: () => void; object: THREE.Camera } | null;
export interface CaptureHandle { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; orbit: OrbitImpl; }

// ── 相机机架：初始 target、响应式 FOV、释放时回写机位、把渲染上下文暴露给截图/重置 ──
// #71 非全景背景图：加载为 scene.background（屏幕空间静态背景，不随机位转动）。
function FlatBackground({ url }: { url: string }) {
  const { scene } = useThree();
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(url, (tex) => {
      if (!alive) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.background = tex;
    });
    return () => { alive = false; if (scene.background instanceof THREE.Texture) scene.background.dispose(); scene.background = null; };
  }, [url, scene]);
  return null;
}

// #85 导演视角的自由相机初始视点：俯瞰全场（能同时看到人偶与机位1 实体）。
// 与任何机位彻底解耦——环绕只是「看」，永远不会写回机位数据。
const FREE_CAM_POS: Vec3 = [4.6, 3.4, 6.8];
const FREE_CAM_TARGET: Vec3 = [0, 0.9, 0];

function CameraRig({ cam, onCommit, bind, locked, grab }: {
  cam: { position: Vec3; target: Vec3; fov: number };
  onCommit: (pos: Vec3, target: Vec3) => void;
  bind: (h: CaptureHandle) => void;
  locked: boolean; // true=机位视角（吸附到活动机位；拖拽即瞄准该机位，松手提交）；false=导演视角（自由环绕，绝不写机位）
  grab: boolean;   // true=抓背景拖（反转水平拖拽方向，像 360 看图器）；false=绕主体转（标准 3D 环绕）
}) {
  const { gl, scene, camera } = useThree();
  const orbit = useRef<OrbitImpl>(null);
  const inited = useRef(false);
  // 提交守卫：OrbitControls 的 onStart/onEnd 是原生 canvas 监听，R3F 的 stopPropagation
  // 拦不住——点选机位/灯光 gizmo 的那一下也会触发 onEnd。守卫：真实位移 > 1cm 才算拖拽。
  const dragStart = useRef<THREE.Vector3 | null>(null);

  // 拖拽手感：仅反转水平方向（three-stdlib OrbitControls 的 reverseHorizontalOrbit），不动俯仰。
  useEffect(() => {
    const o = orbit.current as unknown as { reverseHorizontalOrbit?: boolean } | null;
    if (o) o.reverseHorizontalOrbit = grab;
  }, [grab]);

  useEffect(() => { // 初始 target：导演视角自由俯瞰（#85 与机位解耦，不再取机位注视点）
    if (inited.current || !orbit.current) return;
    inited.current = true;
    orbit.current.target.set(...FREE_CAM_TARGET); orbit.current.update();
  }, []);

  useEffect(() => { // FOV：仅机位视角跟随机位 FOV；导演视角自由相机固定 50°（#85 解耦）
    (camera as THREE.PerspectiveCamera).fov = locked ? cam.fov : 50;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, cam.fov, locked]);

  // 机位视角：把相机精确拨到该机位的位置/注视点（所见即截图所得）；导演视角不动，保留自由环绕。
  useEffect(() => {
    if (!locked || !orbit.current) return;
    camera.position.set(...cam.position);
    orbit.current.target.set(...cam.target);
    orbit.current.update();
  }, [locked, camera, cam.position, cam.target]);

  useEffect(() => { bind({ gl, scene, camera, orbit: orbit.current }); }, [gl, scene, camera, bind]);

  return (
    <OrbitControls
      ref={orbit as never}
      makeDefault
      // #85 机位视角也开放环绕：透过机位拖拽即瞄准（松手提交回机位）；导演视角自由看
      enabled
      // 关阻尼惯性：drei 默认 enableDamping，松手后相机还会滑行几帧，而 onEnd 在松手瞬间就提交，
      // 导致存下的机位落后于视觉最终位置（甩得越快偏差越大），破坏「所见即截图所得」。关掉即一致。
      enableDamping={false}
      // 夹住俯仰极角：禁止越过头顶/钻到地面以下，避免相机翻转导致「地平线来回乱晃、上下颠倒」。
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.92}
      onStart={() => { dragStart.current = camera.position.clone(); }}
      onEnd={() => {
        if (!orbit.current) return;
        const moved = !dragStart.current || camera.position.distanceTo(dragStart.current) >= 0.01;
        dragStart.current = null;
        // #85 只有「机位视角」的拖拽才写回机位（透过取景器瞄准）；导演视角环绕纯看不写，
        // 机位数据只能被 实体拖拽 / 面板滑杆 / 景别 / 注视 等显式操作改动。
        if (!locked || !moved) return;
        onCommit(camera.position.toArray() as Vec3, orbit.current.target.toArray() as Vec3);
      }}
    />
  );
}

export function DirectorEditor({ nodeId, projectId, onClose }: { nodeId: string; projectId: number; onClose: () => void }) {
  // #81 lite：3D 视口降 dpr/关抗锯齿（灯光/阴影等功能表现不降级）。
  const perfLite = usePerfStore(selectPerfLite);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addGridNodes = useCanvasStore((s) => s.addStoryboardGridNodes);
  const nodePos = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId)?.position);
  const initialScene = useCanvasStore((s) => {
    const n = s.nodes.find((x) => x.id === nodeId);
    return (n?.data.payload as { scene?: DirectorScene })?.scene;
  });
  const [scene, setScene] = useState<DirectorScene>(() => initialScene ?? makeDefaultDirectorScene());
  const [selectedId, setSelectedId] = useState<string | null>(scene.actors[0]?.id ?? null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [camSelected, setCamSelected] = useState(false);
  const [actorTab, setActorTab] = useState<"transform" | "pose">("transform");
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "scale">("translate");
  // 导演视角(自由环绕，整体布局) / 机位视角(锁定到当前机位的精确取景，预览最终构图)（模块2）
  const [viewMode, setViewMode] = useState<"director" | "camera">("director");
  // 拖拽手感：orbit=绕主体转(标准3D)；grab=抓背景拖(反转水平，像360看图器)。记忆到 localStorage。
  const [dragMode, setDragMode] = useState<"orbit" | "grab">(() => {
    try { return localStorage.getItem("director:dragMode") === "grab" ? "grab" : "orbit"; } catch { return "orbit"; }
  });
  useEffect(() => { try { localStorage.setItem("director:dragMode", dragMode); } catch { /* ignore */ } }, [dragMode]);
  const [gizmoTarget, setGizmoTarget] = useState<THREE.Object3D | null>(null);
  // #78 灯光选中 + 拖拽手柄目标 + 网格吸附
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [lightGizmoTarget, setLightGizmoTarget] = useState<THREE.Object3D | null>(null);
  // #84 机位 gizmo 拖拽手柄目标（激活机位且机位面板打开时绑定）
  const [camGizmoTarget, setCamGizmoTarget] = useState<THREE.Object3D | null>(null);
  const [snap, setSnap] = useState<boolean>(() => {
    try { return localStorage.getItem("director:snap") === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("director:snap", snap ? "1" : "0"); } catch { /* ignore */ } }, [snap]);
  // 多选（用于「任意角色手动编组」，模块10）：Shift/Ctrl 点击独立角色加入多选集。
  const [multiSel, setMultiSel] = useState<Set<string>>(() => new Set());
  const selectActor = useCallback((id: string) => { setSelectedId(id); setSelectedGroupId(null); setCamSelected(false); setSelectedLightId(null); setMultiSel(new Set()); }, []);
  const toggleMultiActor = useCallback((id: string) => {
    setMultiSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setSelectedId(id); setSelectedGroupId(null); setCamSelected(false); setSelectedLightId(null);
  }, []);
  const selectGroup = useCallback((id: string) => { setSelectedGroupId(id); setSelectedId(null); setCamSelected(false); setSelectedLightId(null); setMultiSel(new Set()); }, []);
  const selectLight = useCallback((id: string) => { setSelectedLightId(id); setSelectedId(null); setSelectedGroupId(null); setCamSelected(false); setMultiSel(new Set()); }, []);
  const [saving, setSaving] = useState(false);
  // ③ 结构锁强度：注入下游 ControlNet 的 strength（0=不约束，1=强约束）。记忆到 localStorage。
  const [ctrlStrength, setCtrlStrength] = useState<number>(() => {
    const v = Number(typeof localStorage !== "undefined" ? localStorage.getItem("director:ctrlStrength") : "");
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.85;
  });
  useEffect(() => { try { localStorage.setItem("director:ctrlStrength", String(ctrlStrength)); } catch { /* ignore */ } }, [ctrlStrength]);
  const captureRef = useRef<CaptureHandle | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  // Canvas 初始视角：#85 导演视角=独立自由俯瞰相机（能同时看到人偶与机位实体），
  // 与机位彻底解耦——此前初始即机位1眼位，导致「机位1永远看不见 + 环绕误写机位」。
  // far 必须大于全景天空盒最大半径(60×球半径上限8=480)，否则球的远半球会被远裁剪面切掉、
  // 露出背景色形成「黑芯」。给到 2000 既覆盖全景球，也覆盖放大场景里被拉远的机位。
  const initCam = useMemo(() => ({ fov: 50, position: FREE_CAM_POS, near: 0.1, far: 2000 }), []);

  // #78 相机截图库（LibTV「摄像机截图」）：多张暂存、清空、发送到画布；随节点持久化。
  const initialShots = useCanvasStore((s) => {
    const n = s.nodes.find((x) => x.id === nodeId);
    return (n?.data.payload as { shots?: { url: string; name: string }[] })?.shots;
  });
  const [shots, setShots] = useState<{ url: string; name: string }[]>(() => initialShots ?? []);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  // 持久化：关闭时把场景写回节点（不丢编辑）。
  useEffect(() => () => { updateNodeData(nodeId, { scene: sceneRef.current, aspectRatio: sceneRef.current.aspectRatio, shots: shotsRef.current }, true); }, [nodeId, updateNodeData]);

  const selected = scene.actors.find((a) => a.id === selectedId) ?? null;
  const patchScene = useCallback((p: Partial<DirectorScene>) => setScene((s) => ({ ...s, ...p })), []);
  const patchActor = useCallback((id: string, p: Partial<DirectorActor>) => {
    setScene((s) => ({ ...s, actors: s.actors.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  }, []);
  // 全部人物统一缩放（匹配全景/场景尺度时一键放大所有人物 + 群组）。
  const scaleAllActors = useCallback((v: number) => setScene((s) => ({
    ...s,
    actors: s.actors.map((a) => ({ ...a, scale: v })),
    groups: (s.groups ?? []).map((g) => ({ ...g, scale: v })),
  })), []);
  // 改动当前机位：同时写「镜像 camera（渲染/截图直接读）」与命名机位列表里的激活项。
  const patchCam = useCallback((p: Partial<DirectorCamera>) => {
    setScene((s) => {
      const cams = ensureCameras(s);
      const activeId = s.activeCameraId ?? cams[0].id!;
      const merged = { ...(cams.find((c) => c.id === activeId) ?? cams[0]), ...p };
      return { ...s, camera: merged, cameras: cams.map((c) => (c.id === activeId ? merged : c)), activeCameraId: activeId };
    });
  }, []);

  const addActor = (model: string) => {
    setScene((s) => {
      const o = s.origin ?? [0, 0, 0];
      const a = makeActor(model, s.actors, [o[0] + s.actors.length * 0.6 - 0.3, 0, o[2]]);
      setSelectedId(a.id); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, actors: [...s.actors, a] };
    });
  };
  const removeActor = (id: string) => {
    setScene((s) => ({ ...s, actors: s.actors.filter((a) => a.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  };
  // 复制角色：连同体型/姿势/旋转/缩放/导入模型一起复制一份，落在右侧偏移处（便于快速摆同款）。
  const duplicateActor = (id: string) => {
    setScene((s) => {
      const src = s.actors.find((a) => a.id === id); if (!src) return s;
      const base = makeActor(src.model, s.actors, [src.position[0] + 0.6, src.position[1], src.position[2]]);
      // prim/color/name 必须显式带上：{...base} 会用 makeActor 的新名新色覆盖，
      // 否则几何道具复制出来变成人偶、名字错乱（#71 Ctrl+D 真机逮到）。
      const copy: DirectorActor = { ...base, rotation: [...src.rotation] as Vec3, scale: src.scale, pose: src.pose ? { ...src.pose } : undefined, glbUrl: src.glbUrl, tint: src.tint, prim: src.prim, color: src.color, name: src.prim || src.glbUrl ? `${src.name}·副本`.slice(0, 18) : base.name };
      setSelectedId(copy.id); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, actors: [...s.actors, copy] };
    });
  };

  // ── 群众群组 ──
  const groups = scene.groups ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const patchGroup = useCallback((id: string, p: Partial<NonNullable<DirectorScene["groups"]>[number]>) => {
    setScene((s) => ({ ...s, groups: (s.groups ?? []).map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  }, []);
  const addCrowd = (rows: number, cols: number) => {
    setScene((s) => {
      const o = s.origin ?? [0, 0, 0];
      const { group, actors } = makeCrowd(rows, cols, s.actors, [o[0], 0, o[2] - 1.2]);
      setSelectedGroupId(group.id); setSelectedId(null); setCamSelected(false);
      return { ...s, groups: [...(s.groups ?? []), group], actors: [...s.actors, ...actors] };
    });
  };
  const ungroupGroup = (gid: string) => {
    setScene((s) => {
      const g = (s.groups ?? []).find((x) => x.id === gid); if (!g) return s;
      const actors = s.actors.map((a) => (a.groupId === gid ? bakeGroupTransform(g, a) : a));
      return { ...s, actors, groups: (s.groups ?? []).filter((x) => x.id !== gid) };
    });
    setSelectedGroupId((cur) => (cur === gid ? null : cur));
  };
  const deleteGroup = (gid: string) => {
    setScene((s) => ({ ...s, actors: s.actors.filter((a) => a.groupId !== gid), groups: (s.groups ?? []).filter((x) => x.id !== gid) }));
    setSelectedGroupId((cur) => (cur === gid ? null : cur));
  };
  const duplicateGroup = (gid: string) => {
    setScene((s) => {
      const g = (s.groups ?? []).find((x) => x.id === gid); if (!g) return s;
      const members = s.actors.filter((a) => a.groupId === gid);
      const { group: ng, actors: na } = cloneGroupWithMembers(g, members, s.actors);
      setSelectedGroupId(ng.id); setSelectedId(null); setCamSelected(false);
      return { ...s, groups: [...(s.groups ?? []), ng], actors: [...s.actors, ...na] };
    });
  };
  // 任意角色手动编组（模块10，Ctrl+G）：把多选的独立角色合成一个手动组（保留各自世界位置）。
  const groupSelectedActors = useCallback(() => {
    setScene((s) => {
      const ids = multiSelRef.current;
      const members = s.actors.filter((a) => ids.has(a.id) && !a.groupId);
      if (members.length < 2) return s;
      const { group, actors: grouped } = makeGroupFromActors(members);
      const byId = new Map(grouped.map((m) => [m.id, m]));
      setSelectedGroupId(group.id); setSelectedId(null); setCamSelected(false); setMultiSel(new Set());
      return { ...s, groups: [...(s.groups ?? []), group], actors: s.actors.map((a) => byId.get(a.id) ?? a) };
    });
  }, [setScene]); // eslint-disable-line react-hooks/exhaustive-deps
  // 调整群组成员间距（模块08）：重排成员组内局部坐标，保留各自姿势/体型/朝向。
  const setGroupSpacing = (gid: string, spacing: number) => {
    setScene((s) => {
      const g = (s.groups ?? []).find((x) => x.id === gid); if (!g) return s;
      const members = s.actors.filter((a) => a.groupId === gid);
      const respaced = respaceCrowdMembers(g, members, spacing);
      const byId = new Map(respaced.map((m) => [m.id, m]));
      return {
        ...s,
        groups: (s.groups ?? []).map((x) => (x.id === gid ? { ...x, spacing } : x)),
        actors: s.actors.map((a) => byId.get(a.id) ?? a),
      };
    });
  };

  const uploadMut = trpc.upload.uploadImage.useMutation();

  // 导入本地 GLB 模型：流式/预签名上传（经素材库通道，顺带入库可复用）→ 新建一个以 GLB
  // 渲染的角色（无姿势，仅摆放）。不能走 base64 uploadImage：16MB 上限 + 大文件撞 express
  // 50MB body 限时返回 HTML 错误页，前端报「<!DOCTYPE html is not valid JSON」（真实翻车）。
  const glbInputRef = useRef<HTMLInputElement>(null);
  const [glbBusy, setGlbBusy] = useState(false);
  const trpcUtils = trpc.useUtils();
  // #71 多格式：obj/stl/fbx/gltf 客户端解析 → GLTFExporter 转成 .glb 再上传（存储/渲染统一走 glb）。
  const convertToGlb = async (file: File): Promise<File> => {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    if (ext === "glb") return file.type ? file : new File([file], file.name, { type: "model/gltf-binary" });
    let obj3d: THREE.Object3D;
    if (ext === "obj") {
      obj3d = new OBJLoader().parse(await file.text());
    } else if (ext === "stl") {
      const geo = new STLLoader().parse(await file.arrayBuffer());
      geo.computeVertexNormals();
      obj3d = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#9aa3b5", roughness: 0.6 }));
    } else if (ext === "fbx") {
      obj3d = new FBXLoader().parse(await file.arrayBuffer(), "");
    } else if (ext === "gltf") {
      // 仅支持自包含 .gltf（嵌入 data URI 缓冲）；外部 .bin 依赖无法随单文件解析
      const gltf = await new GLTFLoader().parseAsync(await file.text(), "");
      obj3d = gltf.scene;
    } else {
      throw new Error(`不支持的格式 .${ext}（支持 .glb/.gltf/.obj/.stl/.fbx）`);
    }
    const bin = await new Promise<ArrayBuffer>((res, rej) => {
      new GLTFExporter().parse(obj3d, (r) => res(r as ArrayBuffer), (err) => rej(err), { binary: true });
    });
    return new File([bin], file.name.replace(/\.[a-z0-9]+$/i, ".glb"), { type: "model/gltf-binary" });
  };
  const onGlbFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setGlbBusy(true);
    try {
      const glbFile = await convertToGlb(file);
      const url = await uploadAssetFileForUrl(trpcUtils.client, glbFile, projectId);
      if (!url) return; // uploadAssetFileForUrl 已弹出具体错误
      setScene((s) => {
        const o = s.origin ?? [0, 0, 0];
        const a = makeActor("male", s.actors, [o[0] + s.actors.length * 0.6 - 0.3, 0, o[2]]);
        a.glbUrl = url; a.name = file.name.replace(/\.glb$/i, "").slice(0, 16) || a.name;
        setSelectedId(a.id); setSelectedGroupId(null); setCamSelected(false);
        return { ...s, actors: [...s.actors, a] };
      });
      toast.success("已导入模型（并已存入素材库）");
    } catch (err) {
      toast.error("模型导入失败：" + (err instanceof Error ? err.message : String(err)));
    } finally { setGlbBusy(false); }
  };

  // 全景背景：上传一张等距全景图作 360° 背景（角色融入真实场景）。
  const panoInputRef = useRef<HTMLInputElement>(null);
  const [panoBusy, setPanoBusy] = useState(false);
  const onPanoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !file.type.startsWith("image/")) { if (file) toast.error("请选择全景图片"); return; }
    setPanoBusy(true);
    try {
      // #71 全景比例结构校验：等距全景标准为 2:1（360°×180°）。偏差大时贴到球上会把
      // 地平线/建筑结构纵向拉伸变形，先给出明确提示（仍允许继续，用户可能有意为之）。
      const dims = await new Promise<{ w: number; h: number } | null>((res) => {
        const u = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(u); res({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { URL.revokeObjectURL(u); res(null); };
        img.src = u;
      });
      if (dims && dims.h > 0 && Math.abs(dims.w / dims.h - 2) > 0.25) {
        toast.warning(`全景图比例 ${dims.w}×${dims.h}（≈${(dims.w / dims.h).toFixed(2)}:1），等距全景标准为 2:1——偏差过大时地平线与结构会拉伸变形，建议换用 2:1 全景图`, { duration: 7000 });
      }
      const r = await uploadMut.mutateAsync({ base64: await blobToBase64(file), mimeType: file.type, filename: file.name });
      patchScene({ panoramaUrl: r.url, groundVisible: false });
      toast.success("已设为全景背景");
    } catch (err) { toast.error("全景上传失败：" + (err instanceof Error ? err.message : String(err))); }
    finally { setPanoBusy(false); }
  };

  // #71 非全景背景图：与全景/黑底分离互斥（全景优先、黑底压过一切）
  const flatBgActive = !!scene.backgroundImageUrl && !scene.panoramaUrl && scene.background !== "#000000";
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const onBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !file.type.startsWith("image/")) { if (file) toast.error("请选择图片"); return; }
    setBgBusy(true);
    try {
      const r = await uploadMut.mutateAsync({ base64: await blobToBase64(file), mimeType: file.type, filename: file.name });
      patchScene({ backgroundImageUrl: r.url });
      toast.success("已设为背景图（整屏静态背景；机位转动时背景不动）");
    } catch (err) { toast.error("背景图上传失败：" + (err instanceof Error ? err.message : String(err))); }
    finally { setBgBusy(false); }
  };

  // #71 原点可位移：新增人物/群众/物体/模板一律落在原点附近；网格与原点标记随之移动。
  const origin: Vec3 = scene.origin ?? [0, 0, 0];
  const setOriginXZ = (x: number, z: number) => patchScene({ origin: [Number(x.toFixed(2)), 0, Number(z.toFixed(2))] });
  const originToViewCenter = () => {
    const cap = captureRef.current; if (!cap?.orbit) return;
    const t = cap.orbit.target;
    setOriginXZ(t.x, t.z);
    toast.success("原点已移到当前视点中心");
  };

  // #71 操控便利性：双击地面在点击处直接放置人偶。世界坐标 → 场景组（缩放+平移）局部坐标，
  // 保证全景模式下调过「场景缩放/平移」后落点依旧踩在双击的位置上。
  const placeActorAt = useCallback((wx: number, wz: number) => {
    setScene((s) => {
      const S = s.sceneScale ?? 1;
      const lx = (wx - (s.sceneOffsetX ?? 0)) / S, lz = (wz - (s.sceneOffsetZ ?? 0)) / S;
      const a = makeActor("male", s.actors, [Number(lx.toFixed(2)), 0, Number(lz.toFixed(2))]);
      setSelectedId(a.id); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, actors: [...s.actors, a] };
    });
  }, []);

  // #71 多物体：几何道具（与人偶同链路：选中/变换/编组/控制图）
  const addProp = (prim: PropPrim) => {
    setScene((s) => {
      const o = s.origin ?? [0, 0, 0];
      const a = makeProp(prim, s.actors, [o[0] + (s.actors.length % 5) * 0.5 - 1, 0, o[2] + 0.6]);
      setSelectedId(a.id); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, actors: [...s.actors, a] };
    });
  };

  // #71 位置模板：一键布景（追加式，落点相对原点）
  const applyLayoutTemplate = (key: string) => {
    const tpl = LAYOUT_TEMPLATES.find((t) => t.key === key); if (!tpl) return;
    setScene((s) => {
      const added = templateActors(tpl, s.actors, s.origin ?? [0, 0, 0]);
      if (added[0]) { setSelectedId(added[0].id); setSelectedGroupId(null); setCamSelected(false); }
      return { ...s, actors: [...s.actors, ...added] };
    });
    toast.success(`已应用模板「${tpl.label}」（${tpl.specs.length} 人，落在原点处）`);
  };

  // #110 我的布光：当前布光存为命名预设（localStorage），可一键应用/删除
  const [myRigs, setMyRigs] = useState<MyLightRig[]>(() => loadMyLightRigs());
  // ── #78 真 3D 灯光：CRUD + 布光预设 + 指向 ────────────────────────────────
  const lights = scene.lights ?? [];
  const selectedLight = lights.find((l) => l.id === selectedLightId) ?? null;
  const patchLight = useCallback((id: string, p: Partial<DirectorLight>) => {
    setScene((s) => ({ ...s, lights: (s.lights ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  }, []);
  const addLightKind = (kind: DirectorLight["kind"]) => {
    setScene((s) => {
      const ls = s.lights ?? [];
      // 新灯错落落位（避免重叠）：按序绕主体换边
      const side = ls.length % 2 === 0 ? 1 : -1;
      const nl = makeLight(kind, ls, [side * (1.4 + ls.length * 0.3), 2.0 + (ls.length % 3) * 0.4, 1.8]);
      setSelectedLightId(nl.id); setSelectedId(null); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, lights: [...ls, nl], dimBase: s.dimBase ?? true };
    });
  };
  const removeLight = (id: string) => {
    setScene((s) => ({ ...s, lights: (s.lights ?? []).filter((l) => l.id !== id) }));
    setSelectedLightId((cur) => (cur === id ? null : cur));
  };
  const applyLightRig = (rig: LightRigPreset) => {
    setScene((s) => {
      const ls = lightsFromRig(rig);
      setSelectedLightId(ls[0]?.id ?? null); setSelectedId(null); setSelectedGroupId(null); setCamSelected(false);
      return { ...s, lights: ls, dimBase: s.dimBase ?? true };
    });
    toast.success(`已应用布光「${rig.label}」（${rig.lights.length} 盏灯，基础光已压暗）`);
  };
  // 聚光指向：对准角色（胸高，含场景缩放/平移换算——与注视目标同一套几何）
  const aimLightAtActor = (lightId: string, actorId: string) => {
    const scn = sceneRef.current;
    const a = scn.actors.find((x) => x.id === actorId); if (!a) return;
    const base = actorWorldPosition(a, scn.groups);
    const target = shotAimTarget(base, { sceneScale: scn.sceneScale, offsetX: scn.sceneOffsetX, offsetY: scn.sceneOffsetY, offsetZ: scn.sceneOffsetZ, actorScale: a.scale, aimY: 1.0 });
    patchLight(lightId, { target });
  };
  // 截图前隐藏灯光标记球/指向线 + 机位 gizmo + TransformControls 手柄
  // （不隐藏光源本身——光照必须留在成片里；#84 机位实体同为编辑器专属标记）。
  const hideLightMarkers = useCallback(() => {
    const cap = captureRef.current;
    const hidden: THREE.Object3D[] = [];
    cap?.scene.traverse((o) => {
      const anyO = o as THREE.Object3D & { isTransformControls?: boolean };
      if ((o.name === "light-marker" || o.name === "cam-marker" || anyO.isTransformControls) && o.visible) { o.visible = false; hidden.push(o); }
    });
    return () => hidden.forEach((o) => { o.visible = true; });
  }, []);

  // #84 点选画面中的机位实体：激活该机位并打开机位面板（不动导演视角的自由环绕；
  // 机位视角下 CameraRig 的 locked effect 会随 cam.position/target 变化自动吸附）。
  const selectCameraFromScene = useCallback((id: string) => {
    setScene((s) => {
      const cams = ensureCameras(s);
      const c = cams.find((x) => x.id === id) ?? cams[0];
      return { ...s, camera: c, cameras: cams, activeCameraId: c.id };
    });
    setCamSelected(true); setSelectedId(null); setSelectedGroupId(null); setSelectedLightId(null);
  }, []);

  // #71 导出场景 .glb：把 ACTORS_GROUP（人物+道具+导入模型）打包下载，可导入任何 3D 工具复用
  const exportSceneGlb = () => {
    const cap = captureRef.current;
    const grp = cap?.scene.getObjectByName(ACTORS_GROUP);
    if (!grp) { toast.error("场景里没有可导出的对象"); return; }
    new GLTFExporter().parse(grp, (bin) => {
      const blob = new Blob([bin as ArrayBuffer], { type: "model/gltf-binary" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "director-scene.glb"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast.success("场景已导出为 .glb");
    }, (err) => toast.error("导出失败：" + String(err)), { binary: true });
  };

  // #85 提交入口只剩「机位视角拖拽瞄准」一条路（CameraRig 内已按 locked 门控）。
  const onCommitCam = useCallback((position: Vec3, target: Vec3) => patchCam({ position, target }), [patchCam]);
  const bindCapture = useCallback((h: CaptureHandle) => { captureRef.current = h; }, []);
  // moveLiveCamera 等回调是稳定引用，读视角模式走 ref。
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  // #85 产出统一从「活动机位」渲染：导演视角随便飞，截图/控制图/宫格/入库永远是机位构图。
  // 渲染前把 live 相机拨到活动机位（位置/注视/FOV），渲染后原样还原（含自由视角的姿态）。
  const withActiveCamera = useCallback(<T,>(fn: () => T): T => {
    const cap = captureRef.current;
    if (!cap) return fn();
    const cam = cap.camera as THREE.PerspectiveCamera;
    const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    const ac = sceneRef.current.camera;
    cam.position.set(...ac.position);
    cam.lookAt(new THREE.Vector3(...ac.target));
    cam.fov = ac.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    try { return fn(); } finally {
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      cam.fov = saved.fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }
  }, []);

  // 重置机位：imperatively 把相机/控制器拨回默认，并同步场景（避免受控 prop 回灌打架）。
  const resetCamera = useCallback(() => {
    const dft = makeDefaultDirectorScene().camera;
    const cap = captureRef.current;
    if (cap && viewModeRef.current === "camera") {
      cap.camera.position.set(...dft.position);
      (cap.camera as THREE.PerspectiveCamera).fov = dft.fov;
      (cap.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      if (cap.orbit) { cap.orbit.target.set(...dft.target); cap.orbit.update(); }
    }
    patchCam(dft);
  }, [patchCam]);

  // ── 多命名机位 ──
  const cameras = ensureCameras(scene);
  const activeCameraId = scene.activeCameraId ?? cameras[0].id!;
  // imperatively 把 live 相机拨到某机位（切换/对准时复用）。
  const moveLiveCamera = useCallback((c: DirectorCamera) => {
    // #85 导演视角是独立自由相机：机位数据操作（切换/景别/注视/全景滑杆）不再劫持它，
    // 构图反馈看右下「机位预览」小窗或切「机位视角」；仅机位视角下才把视口拨到机位。
    if (viewModeRef.current !== "camera") return;
    const cap = captureRef.current; if (!cap) return;
    cap.camera.position.set(...c.position);
    (cap.camera as THREE.PerspectiveCamera).fov = c.fov;
    (cap.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    if (cap.orbit) { cap.orbit.target.set(...c.target); cap.orbit.update(); }
  }, []);
  const switchCamera = useCallback((id: string) => {
    const c = cameras.find((x) => x.id === id) ?? cameras[0];
    moveLiveCamera(c);
    setScene((s) => ({ ...s, camera: c, cameras: ensureCameras(s), activeCameraId: id }));
  }, [cameras, moveLiveCamera]);

  // ── 全景合成：相机锚定模型 ───────────────────────────────────────────────────
  // 角色保持真实尺寸站在 y=0 地面；全景地平线恒在「相机视高」那条线上。于是：
  //  · 相机视高 ↑/↓ 决定地平线压在角色身上的高度（脚始终贴地，不靠平移角色）。
  //  · 机位距离 远/近 决定角色在画面里的大小（透视正确，不靠缩放角色）。
  // 这样「脚贴全景地面」与「比例对应」都成立，且缩放/升降不再各自为政破坏构图。
  const camHeight = scene.camera.position[1];
  const camDist = Math.hypot(scene.camera.position[0] - scene.camera.target[0], scene.camera.position[2] - scene.camera.target[2]);
  const setCamHeight = useCallback((h: number) => {
    const cam = sceneRef.current.camera;
    const position: Vec3 = [cam.position[0], h, cam.position[2]];
    patchCam({ position }); moveLiveCamera({ ...cam, position });
  }, [patchCam, moveLiveCamera]);
  const setCamDistance = useCallback((d: number) => {
    const cam = sceneRef.current.camera;
    const tx = cam.target[0], tz = cam.target[2];
    let dx = cam.position[0] - tx, dz = cam.position[2] - tz;
    let hd = Math.hypot(dx, dz); if (hd < 1e-4) { dx = 0; dz = 1; hd = 1; }
    const position: Vec3 = [tx + (dx / hd) * d, cam.position[1], tz + (dz / hd) * d];
    patchCam({ position }); moveLiveCamera({ ...cam, position });
  }, [patchCam, moveLiveCamera]);
  // 「落到地面」：纯天空盒全景没有真实地面深度，无法对任意照片完美自适应；这里把人物脚底落到
  // 当前机位画面「下方约 0.42×纵向FOV」处——即画面下半近地面位置，作为不悬空的合理默认，
  // 再由「垂直贴地」滑杆微调到照片里的具体地面。高视角俯瞰图尤其需要往下落。
  const dropToGround = useCallback(() => {
    const cam = sceneRef.current.camera;
    const camH = cam.position[1];
    const d = Math.hypot(cam.position[0] - cam.target[0], cam.position[2] - cam.target[2]) || 4;
    const beta = (cam.fov * 0.42) * Math.PI / 180;
    const oy = camH - d * Math.tan(beta);
    patchScene({ sceneOffsetY: Number(oy.toFixed(2)) });
  }, [patchScene]);
  const addCamera = useCallback(() => {
    // #85 导演视角：把「当前自由视角」快照成新机位（所见即新机位构图，也避免与旧机位原地重叠）；
    // 机位视角：复制活动机位并右移 1m 防重叠。
    const cap = captureRef.current;
    setScene((s) => {
      const cams = ensureCameras(s);
      let nc: DirectorCamera;
      if (viewModeRef.current !== "camera" && cap?.orbit) {
        nc = { id: newCameraId(), name: nextCameraName(cams), position: cap.camera.position.toArray() as Vec3, target: cap.orbit.target.toArray() as Vec3, fov: s.camera.fov, lookAtActorId: undefined };
      } else {
        nc = { ...s.camera, id: newCameraId(), name: nextCameraName(cams), position: [s.camera.position[0] + 1, s.camera.position[1], s.camera.position[2]] as Vec3, lookAtActorId: undefined };
      }
      return { ...s, cameras: [...cams, nc], camera: nc, activeCameraId: nc.id };
    });
  }, []);
  const deleteCamera = useCallback((id: string) => {
    setScene((s) => {
      const cams = ensureCameras(s);
      if (cams.length <= 1) return s; // 至少保留一个
      const rest = cams.filter((c) => c.id !== id);
      const next = rest[0];
      return { ...s, cameras: rest, camera: next, activeCameraId: next.id };
    });
  }, []);
  // 注视目标=指定角色：把当前机位 target 对准该角色（约胸高），并记下 lookAtActorId。
  // 全部读 sceneRef.current（永远新鲜）：调完「垂直贴地/场景缩放/平移」后 scene.actors 引用不变，
  // 若靠 useCallback 依赖会锁住旧偏移，取景高度整体算错（人物掉出框）——与 dropToGround 同款做法。
  const lookAtActor = useCallback((actorId: string | undefined) => {
    if (!actorId) { patchCam({ lookAtActorId: undefined }); return; }
    const scn = sceneRef.current;
    const a = scn.actors.find((x) => x.id === actorId); if (!a) return;
    const base = actorWorldPosition(a, scn.groups);
    const target = shotAimTarget(base, { sceneScale: scn.sceneScale, offsetX: scn.sceneOffsetX, offsetY: scn.sceneOffsetY, offsetZ: scn.sceneOffsetZ, actorScale: a.scale, aimY: 1.0 });
    const cap = captureRef.current; if (cap?.orbit) { cap.orbit.target.set(...target); cap.orbit.update(); }
    patchCam({ target, lookAtActorId: actorId });
  }, [patchCam]);

  // 景别预设（LibTV 模块28「五种景别」）：保持当前机位方位角，按景别设定 FOV + 与主体距离 +
  // 注视高度，一键在 远景/全景/中景/近景/特写 间切换，配合多机位实现叙事镜头序列。
  const applyShot = useCallback((shot: { fov: number; dist: number; aimY: number }) => {
    const scn = sceneRef.current;
    const cam = scn.camera;
    const subj = scn.actors.find((a) => a.id === cam.lookAtActorId)
      ?? scn.actors.find((a) => !a.groupId) ?? scn.actors[0];
    const base = subj ? actorWorldPosition(subj, scn.groups) : ([0, 0, 0] as Vec3);
    const as = subj?.scale ?? 1;
    const target = shotAimTarget(base, { sceneScale: scn.sceneScale, offsetX: scn.sceneOffsetX, offsetY: scn.sceneOffsetY, offsetZ: scn.sceneOffsetZ, actorScale: as, aimY: shot.aimY });
    const T = new THREE.Vector3(...target);
    const dir = new THREE.Vector3(...cam.position).sub(new THREE.Vector3(...cam.target));
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.15, 1);
    if (dir.y < 0.05) dir.y = 0.12; // 不要俯冲到地面以下
    dir.normalize();
    // 与主体的距离也按「场景缩放 × 角色自身缩放」放大，否则放大过的角色景别距离过近、构图错。
    const np = T.clone().addScaledVector(dir, shot.dist * (scn.sceneScale ?? 1) * as);
    const position: Vec3 = [np.x, np.y, np.z];
    const next: DirectorCamera = { ...cam, position, target, fov: shot.fov };
    patchCam({ position, target, fov: shot.fov });
    moveLiveCamera(next);
  }, [patchCam, moveLiveCamera]);

  // 面向机位：把选中角色绕 Y 旋转，使其正面(+Z)朝向当前机位——肖像/对话快速摆位。
  const faceCameraActor = (id: string) => {
    const scn = sceneRef.current;
    const a = scn.actors.find((x) => x.id === id); if (!a) return;
    const S = scn.sceneScale ?? 1, ox = scn.sceneOffsetX ?? 0, oz = scn.sceneOffsetZ ?? 0;
    const wp = actorWorldPosition(a, scn.groups);
    const ax = ox + wp[0] * S, az = oz + wp[2] * S;
    // 组内成员：扣除所属群组的 Y 旋转（渲染时会叠加），否则偏掉一个群组转角。
    const g = a.groupId ? (scn.groups ?? []).find((x) => x.id === a.groupId) : undefined;
    const yaw = faceCameraYaw(ax, az, scn.camera.position[0], scn.camera.position[2], g?.rotation[1] ?? 0);
    patchActor(id, { rotation: [a.rotation[0], Number(yaw.toFixed(1)), a.rotation[2]] as Vec3 });
  };

  // 截图：用当前机位渲染一帧 → toBlob → 上传 → 写入节点 imageUrl（参考图）。
  const shoot = async () => {
    const cap = captureRef.current;
    if (!cap || saving) return;
    setSaving(true);
    try {
      // #78 灯光标记球/手柄不入成片（光照本身保留）
      const restore = hideLightMarkers();
      let blob: Blob | null;
      try {
        withActiveCamera(() => cap.gl.render(cap.scene, cap.camera)); // #85 产出=活动机位构图
        blob = await canvasToBlob(cap.gl);
      } finally { restore(); }
      if (!blob) throw new Error("渲染截图失败");
      const base64 = await blobToBase64(blob);
      const result = await uploadMut.mutateAsync({ base64, mimeType: "image/png", filename: "director-3d.png" });
      // #78 光效中文描述随截图落进节点，下游提示词可直接引用（无布光则清空）
      const lightingDesc = describeLights(sceneRef.current.lights, sceneRef.current.dimBase) || undefined;
      updateNodeData(nodeId, { scene: sceneRef.current, imageUrl: result.url, imageStorageKey: result.storageKey, aspectRatio: scene.aspectRatio, status: "done", lightingDesc });
      toast.success(lightingDesc ? "已截图输出参考图（含布光描述）" : "已截图并输出为参考图");
    } catch (e) {
      toast.error("截图失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };

  // #78 截图入库：渲染当前机位一帧存入相机截图库（不覆盖节点主图）。
  const shootToLibrary = async () => {
    const cap = captureRef.current;
    if (!cap || saving) return;
    setSaving(true);
    try {
      const restore = hideLightMarkers();
      let blob: Blob | null;
      try {
        withActiveCamera(() => cap.gl.render(cap.scene, cap.camera)); // #85 产出=活动机位构图
        blob = await canvasToBlob(cap.gl);
      } finally { restore(); }
      if (!blob) throw new Error("渲染截图失败");
      const r = await uploadMut.mutateAsync({ base64: await blobToBase64(blob), mimeType: "image/png", filename: `director-shot-${shotsRef.current.length + 1}.png` });
      const camName = sceneRef.current.camera.name ?? "机位";
      setShots((prev) => [...prev, { url: r.url, name: `${camName}-截图${String(prev.length + 1).padStart(2, "0")}` }]);
      toast.success("已存入相机截图库");
    } catch (e) {
      toast.error("截图入库失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };
  // 发送到画布：截图库整批落成连好线的分镜节点网格（同多机位宫格通道）。
  const sendShotsToCanvas = () => {
    const list = shotsRef.current;
    if (!list.length || !nodePos) return;
    const urls = list.map((s) => s.url);
    const cols = Math.min(3, urls.length);
    const rows = Math.ceil(urls.length / cols);
    updateNodeData(nodeId, { scene: sceneRef.current, shots: list }, true);
    addGridNodes(urls, { rows, cols, sourcePosition: nodePos, sourceNodeId: nodeId, titlePrefix: "截图", aspectRatio: sceneRef.current.aspectRatio });
    toast.success(`已把 ${urls.length} 张截图发送到画布`);
    onClose();
  };

  // ①③ 控制图：用当前机位【只渲人物】重渲一张像素级精确的控制图，直接注入下游 ComfyUI
  //   ControlNet（比从 2D 图估计的控制图更准，把结构锁从「提示词祈祷」升级为像素级约束）。
  //   · depth / normal：override 材质渲染 3D 网格。
  //   · pose（③）：取真实 Mixamo 骨架关节世界坐标投影，画标准 OpenPose 骨架图。
  //   注入带「结构锁强度」，并把控制图持久化到节点（连线即自动重注入下游）。
  const shootControlPass = async (kind: "depth" | "normal" | "pose") => {
    const cap = captureRef.current;
    if (!cap || saving) return;
    setSaving(true);
    const strength = ctrlStrength;
    const label = kind === "depth" ? "深度" : kind === "normal" ? "法线" : "骨架";
    try {
      let blob: Blob | null;
      if (kind === "pose") {
        // 骨架图：不渲染 3D，直接把每个人偶的骨架关节投影到 2D 画布画 OpenPose。
        const w = cap.gl.domElement.width, h = cap.gl.domElement.height;
        const c2d = document.createElement("canvas"); c2d.width = w; c2d.height = h;
        const ctx = c2d.getContext("2d");
        if (!ctx) throw new Error("2D 画布上下文不可用");
        cap.scene.updateMatrixWorld(true);
        let actorsGroup: THREE.Object3D | undefined;
        cap.scene.children.forEach((o) => { if (o.name === ACTORS_GROUP) actorsGroup = o; });
        const roots: THREE.Object3D[] = [];
        actorsGroup?.traverse((o) => { if (o.name.startsWith("actor:")) roots.push(o); });
        const drawn = withActiveCamera(() => drawOpenpose(ctx, roots, cap.camera, w, h)); // #85 骨架投影取活动机位
        if (!drawn) throw new Error("未找到可用的人物骨架（导入的 GLB 模型无骨架，请用内置人偶）");
        blob = await new Promise<Blob | null>((res) => c2d.toBlob((b) => res(b), "image/png"));
      } else {
        const scene = cap.scene;
        const cam = cap.camera as THREE.PerspectiveCamera;
        // 隐藏一切非人物：网格/接触阴影/全景/灯光/gizmo（顶层 name!==ACTORS_GROUP 者），
        // 以及 actors 组内的选中环（ringGeometry）——否则会污染控制图。
        const hidden: THREE.Object3D[] = [];
        const hide = (o: THREE.Object3D) => { if (o.visible) { o.visible = false; hidden.push(o); } };
        let actorsGroup: THREE.Object3D | undefined;
        scene.children.forEach((o) => { if (o.name === ACTORS_GROUP) actorsGroup = o; else hide(o); });
        actorsGroup?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.geometry as THREE.BufferGeometry)?.type === "RingGeometry") hide(o); });
        const prevBg = scene.background;
        const prevOverride = scene.overrideMaterial;
        // depth：视空间线性深度、近=亮（与 MiDaS/ControlNet depth 约定一致），背景黑=最远。
        // normal：MeshNormalMaterial 直接给标准法线 RGB，背景取「朝相机」的平面法线(128,128,255)。
        let mat: THREE.Material;
        if (kind === "depth") {
          const acRef = sceneRef.current.camera;
          const camDist = new THREE.Vector3(...acRef.position).distanceTo(new THREE.Vector3(...acRef.target));
          const spread = Math.max(1, camDist * 0.6);
          mat = new THREE.ShaderMaterial({
            uniforms: { uNear: { value: Math.max(0.01, camDist - spread) }, uFar: { value: camDist + spread } },
            vertexShader: "varying float vZ; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vZ = -mv.z; gl_Position = projectionMatrix*mv; }",
            fragmentShader: "uniform float uNear; uniform float uFar; varying float vZ; void main(){ float d = clamp((vZ-uNear)/(uFar-uNear),0.0,1.0); gl_FragColor = vec4(vec3(1.0-d),1.0); }",
            side: THREE.DoubleSide,
          });
          scene.background = new THREE.Color(0x000000);
        } else {
          mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
          scene.background = new THREE.Color(0x8080ff);
        }
        try {
          scene.overrideMaterial = mat;
          withActiveCamera(() => cap.gl.render(scene, cam)); // #85 控制图=活动机位构图
          blob = await canvasToBlob(cap.gl);
        } finally {
          // 无论渲染/抓帧成败，都在上传网络等待之前还原可见画面并释放材质，避免视口停在控制图上或泄漏 GPU 材质。
          scene.overrideMaterial = prevOverride;
          scene.background = prevBg;
          hidden.forEach((o) => { o.visible = true; });
          mat.dispose();
        }
      }
      if (!blob) throw new Error("渲染控制图失败");
      const r = await uploadMut.mutateAsync({ base64: await blobToBase64(blob), mimeType: "image/png", filename: `director-${kind}.png` });
      const n = propagateControlMap(nodeId, r.url, strength);
      updateNodeData(nodeId, { controlMap: { url: r.url, kind, strength } });
      toast.success(n > 0 ? `${label}控制图已注入 ${n} 个下游 ComfyUI 图像节点（结构强度 ${strength}）` : `已生成${label}控制图，暂无下游 ComfyUI 图像节点（连线后自动注入）`);
    } catch (e) {
      toast.error("控制图失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };

  // 多机位宫格：绕注视点按预设角度渲染多张 → 落成连好线的分镜节点网格（确定性、免抽卡）。
  const [gridBusy, setGridBusy] = useState<string | null>(null);
  const [gridMenu, setGridMenu] = useState(false);
  const renderGrid = async (preset: GridPreset) => {
    const cap = captureRef.current;
    setGridMenu(false);
    if (!cap || gridBusy || !nodePos) return;
    setGridBusy(preset.label);
    const cam = cap.camera as THREE.PerspectiveCamera;
    const savePos = cam.position.clone();
    const saveQuat = cam.quaternion.clone();
    const saveFov = cam.fov;
    // #85 宫格基准=活动机位（不再依赖 live 视角），FOV 也用机位的
    const ac = sceneRef.current.camera;
    const basePos: Vec3 = [...ac.position] as Vec3;
    const target = ac.target;
    const tVec = new THREE.Vector3(...target);
    cam.fov = ac.fov; cam.updateProjectionMatrix();
    const restoreMarkers = hideLightMarkers(); // #78 灯光标记不入宫格成片
    try {
      const urls: string[] = [];
      for (let i = 0; i < preset.angles.length; i++) {
        const pos = gridCameraPosition(basePos, target, preset.angles[i]);
        cam.position.set(...pos); cam.lookAt(tVec); cam.updateMatrixWorld();
        cap.gl.render(cap.scene, cam);
        const blob = await canvasToBlob(cap.gl);
        if (!blob) continue;
        const r = await uploadMut.mutateAsync({ base64: await blobToBase64(blob), mimeType: "image/png", filename: `dir-grid-${preset.key}-${i}.png` });
        urls.push(r.url);
        setGridBusy(`${preset.label} ${i + 1}/${preset.angles.length}`);
      }
      restoreMarkers();

      if (urls.length) {
        updateNodeData(nodeId, { scene: sceneRef.current }, true);
        addGridNodes(urls, { rows: preset.rows, cols: preset.cols, sourcePosition: nodePos, sourceNodeId: nodeId, titlePrefix: "机位", aspectRatio: sceneRef.current.aspectRatio });
        toast.success(`已生成 ${urls.length} 个机位分镜节点`);
        onClose();
      }
    } catch (e) {
      toast.error("多机位生成失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      // 还原自由视角（位置/朝向/FOV 全还原；异常路径同样还原）
      cam.position.copy(savePos); cam.quaternion.copy(saveQuat); cam.fov = saveFov; cam.updateProjectionMatrix();
      restoreMarkers(); setGridBusy(null);
    }
  };

  const ar = aspectRatioValue(scene.aspectRatio);

  // 自适应位置范围：滑杆 min/max 随「场景缩放 / 该对象自身缩放 / 当前已有坐标」自动放大，
  // 使放大场景/人物后仍能把对象拖到足够远（解决「位置调节范围太小、不能自适应缩放」）。
  const sceneS = scene.sceneScale ?? 1;
  const reachFor = useCallback((vec: Vec3, ownScale = 1) => {
    const need = Math.max(20, sceneS * 20, ownScale * 6, ...vec.map((n) => Math.abs(n) * 1.3));
    // 取整到 10 的倍数，滑杆刻度好看
    return Math.ceil(need / 10) * 10;
  }, [sceneS]);

  // 取景容器：在中央区按画幅比例取最大内接矩形，使 R3F 画布即为最终取景。
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 960, h: 540 });
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const fit = () => {
      const aw = el.clientWidth - 24, ah = el.clientHeight - 24;
      let w = aw, h = w / ar; if (h > ah) { h = ah; w = h * ar; }
      setFrame({ w: Math.max(160, Math.floor(w)), h: Math.max(90, Math.floor(h)) });
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [ar]);

  // 动作预设悬停预览（模块05）：悬停时临时套用预设，移开恢复原姿势，点击才正式应用。
  const poseHoverBackup = useRef<Pose | null>(null);
  useEffect(() => { poseHoverBackup.current = null; }, [selectedId]); // 切换角色时丢弃未落地的预览备份
  // Ctrl/Cmd+G 把多选的独立角色一键编组（模块10）。
  const multiSelRef = useRef(multiSel);
  multiSelRef.current = multiSel;
  // #71 操控便利性：Delete/Backspace 删除选中（人偶/道具/整组），Ctrl/Cmd+D 复制选中。
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const selectedGroupIdRef = useRef(selectedGroupId); selectedGroupIdRef.current = selectedGroupId;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) {
        if (multiSelRef.current.size >= 2) { e.preventDefault(); groupSelectedActors(); }
        return;
      }
      // 输入框内不劫持（改名/数值输入时 Delete 是正常编辑）
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedGroupIdRef.current) { e.preventDefault(); deleteGroup(selectedGroupIdRef.current); return; }
        if (selectedIdRef.current) { e.preventDefault(); removeActor(selectedIdRef.current); return; }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        if (selectedGroupIdRef.current) { e.preventDefault(); duplicateGroup(selectedGroupIdRef.current); return; }
        if (selectedIdRef.current) { e.preventDefault(); duplicateActor(selectedIdRef.current); return; }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSelectedActors]);

  const panel: React.CSSProperties = { background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 12 };
  const headBtn = (active?: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9,
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: "1px solid var(--c-bd2)",
    background: active ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: active ? "#0b0d12" : "var(--c-t2)",
  });

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "var(--c-canvas)" }}>
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4" style={{ height: 52, borderBottom: "1px solid var(--c-bd2)", background: "var(--c-elevated)" }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: "var(--c-t1)" }}>🎬 导演台</span>
        <span style={{ fontSize: 11, color: "var(--c-t4)" }}>3D 精准构图 · 截图即参考图</span>
        <div className="flex-1" />
        {/* 导演视角 / 机位视角 切换（模块2）：自由布局 vs 锁定预览最终取景 */}
        <div className="flex items-center" style={{ padding: 3, borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", marginRight: 4 }}>
          {([["director", "导演视角"], ["camera", "机位视角"]] as const).map(([m, lbl]) => (
            <button key={m} onClick={() => setViewMode(m)} title={m === "director" ? "独立自由视角：环绕布光摆位，不影响任何机位" : "透过当前机位取景：拖拽即瞄准该机位（松手记录），所见即截图"}
              style={{ fontSize: 11, fontWeight: viewMode === m ? 700 : 500, padding: "3px 9px", borderRadius: 7, border: "none", cursor: "pointer", background: viewMode === m ? "var(--ui-accent, var(--c-accent))" : "transparent", color: viewMode === m ? "#0b0d12" : "var(--c-t3)" }}>{lbl}</button>
          ))}
        </div>
        {/* 拖拽手感切换：绕主体转(标准3D) / 抓背景拖(360看图器，反转水平方向) */}
        <div className="flex items-center" style={{ padding: 3, borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", marginRight: 4 }}>
          {([["orbit", "绕主体转"], ["grab", "抓背景拖"]] as const).map(([m, lbl]) => (
            <button key={m} onClick={() => setDragMode(m)} title={m === "orbit" ? "标准 3D 环绕：向右拖=绕主体转，背景往左滚" : "360 看图器手感：向右拖=抓住背景往右拖（仅反转水平，不影响上下）"}
              style={{ fontSize: 11, fontWeight: dragMode === m ? 700 : 500, padding: "3px 9px", borderRadius: 7, border: "none", cursor: "pointer", background: dragMode === m ? "var(--ui-accent, var(--c-accent))" : "transparent", color: dragMode === m ? "#0b0d12" : "var(--c-t3)" }}>{lbl}</button>
          ))}
        </div>
        {/* 多机位宫格 */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setGridMenu((v) => !v)} disabled={!!gridBusy} style={{ ...headBtn(), opacity: gridBusy ? 0.7 : 1 }}>
            {gridBusy ? <Loader2 size={14} className="animate-spin" /> : <Grid3x3 size={14} />} {gridBusy ?? "多机位宫格"} {!gridBusy && <ChevronDown size={12} />}
          </button>
          {gridMenu && !gridBusy && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 1 }} onClick={() => setGridMenu(false)} />
              <div style={{ position: "absolute", top: 38, right: 0, zIndex: 2, minWidth: 200, background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 10, boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)", padding: 6 }}>
                {GRID_PRESETS.map((p) => (
                  <button key={p.key} onClick={() => renderGrid(p)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", fontSize: 12, color: "var(--c-t2)", background: "none", border: "none", borderRadius: 7, cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-surface)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                    <span>{p.label}</span><span style={{ fontSize: 10, color: "var(--c-t4)" }}>{p.rows}×{p.cols}</span>
                  </button>
                ))}
                <div style={{ fontSize: 10, color: "var(--c-t4)", padding: "4px 10px 2px", lineHeight: 1.4 }}>绕场景多机位渲染 → 落成连好线的分镜节点</div>
              </div>
            </>
          )}
        </div>
        {/* ①③ 结构锁：当前机位只渲人物 → 像素级 depth/normal/骨架 → 按强度注入下游 ComfyUI ControlNet */}
        <div className="flex items-center" style={{ gap: 4, padding: "3px 6px", borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t4)" }}>结构锁</span>
          <button onClick={() => shootControlPass("depth")} disabled={saving} title="只渲人物，输出像素级深度图注入下游 ComfyUI ControlNet（比 2D 估计更准）"
            style={{ ...headBtn(false), height: 26, padding: "0 8px", opacity: saving ? 0.6 : 1 }}>
            <Boxes size={13} /> 深度
          </button>
          <button onClick={() => shootControlPass("normal")} disabled={saving} title="只渲人物，输出法线图注入下游 ComfyUI ControlNet"
            style={{ ...headBtn(false), height: 26, padding: "0 8px", opacity: saving ? 0.6 : 1 }}>
            <Boxes size={13} /> 法线
          </button>
          <button onClick={() => shootControlPass("pose")} disabled={saving} title="取真实 3D 骨架关节，输出像素级精确 OpenPose 骨架图注入下游 ComfyUI ControlNet（姿态硬约束，远胜 2D 估计）"
            style={{ ...headBtn(false), height: 26, padding: "0 8px", opacity: saving ? 0.6 : 1 }}>
            <PersonStanding size={13} /> 骨架
          </button>
          <label title="注入下游 ControlNet 的结构约束强度（0=不约束，1=最强）" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--c-t4)" }}>
            强度
            <input type="number" min={0} max={1} step={0.05} value={ctrlStrength}
              onChange={(e) => setCtrlStrength(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
              style={{ width: 44, padding: "2px 4px", fontSize: 10.5, textAlign: "right", background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 5, outline: "none" }} />
          </label>
        </div>
        <button onClick={shoot} disabled={saving} style={{ ...headBtn(true), opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} {saving ? "输出中…" : "截图 → 参考图"}
        </button>
        <button onClick={onClose} style={headBtn()}><X size={14} /> 关闭</button>
      </div>

      <div className="flex-1 flex" style={{ minHeight: 0 }}>
        {/* 左：图层列表。director-leftcol：子项 flex-shrink:0——内容超高时正常滚动，
            否则 flex 列会把每个 chip 行压缩到重叠挤成一团（#84 灯光区加入后真实翻车）。 */}
        <div className="director-leftcol flex flex-col gap-2 p-3" style={{ width: 220, borderRight: "1px solid var(--c-bd2)", overflowY: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>场景图层</div>
          <button onClick={() => { setCamSelected(true); setSelectedId(null); setSelectedGroupId(null); }} style={{ ...rowBtn(camSelected) }}>📷 机位（{scene.camera.fov.toFixed(0)}°）</button>
          {/* 群众群组（可展开成员、解组/删除） */}
          {groups.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-1">
                <button onClick={() => selectGroup(g.id)} style={{ ...rowBtn(g.id === selectedGroupId), flex: 1 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, display: "inline-block", marginRight: 7 }} />
                  {g.name}
                </button>
                <button onClick={() => ungroupGroup(g.id)} title="解组" style={{ ...iconBtn, fontSize: 9 }}>解</button>
                <button onClick={() => deleteGroup(g.id)} title="删除整组" style={{ ...iconBtn }}><Trash2 size={12} /></button>
              </div>
              {scene.actors.filter((a) => a.groupId === g.id).map((a) => (
                <button key={a.id} onClick={() => selectActor(a.id)} style={{ ...rowBtn(a.id === selectedId), marginLeft: 14, marginTop: 2, fontSize: 11, padding: "4px 8px" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.color, display: "inline-block", marginRight: 6 }} />{a.name}
                </button>
              ))}
            </div>
          ))}
          {/* 独立人偶 */}
          {scene.actors.filter((a) => !a.groupId).map((a) => (
            <div key={a.id} className="flex items-center gap-1">
              <button
                onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey) ? toggleMultiActor(a.id) : selectActor(a.id)}
                title="点击选中；Shift/Ctrl 点击多选以编组"
                style={{ ...rowBtn(!camSelected && a.id === selectedId), flex: 1, boxShadow: multiSel.has(a.id) ? "inset 0 0 0 1.5px var(--ui-accent, var(--c-accent))" : undefined }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: a.color, display: "inline-block", marginRight: 7 }} />
                {a.name}{multiSel.has(a.id) ? " ✓" : ""}
              </button>
              <button onClick={() => duplicateActor(a.id)} title="复制角色（含体型/姿势/缩放）" style={{ ...iconBtn }}><Copy size={12} /></button>
              <button onClick={() => removeActor(a.id)} title="删除" style={{ ...iconBtn }}><Trash2 size={12} /></button>
            </div>
          ))}
          {multiSel.size >= 2 && (
            <button onClick={groupSelectedActors} style={{ ...chip, justifyContent: "center", color: "var(--ui-accent, var(--c-accent))" }} title="把所选独立角色合并为一个手动编组（Ctrl+G）">
              <Grid3x3 size={12} /> 编组所选 ({multiSel.size}) · Ctrl+G
            </button>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 8 }}>添加人物（真人模型）</div>
          <div className="flex flex-wrap gap-1">
            {MANNEQUIN_MODELS.map((m) => (
              <button key={m.key} onClick={() => addActor(m.key)} style={{ ...chip }}><Plus size={11} /> {m.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 6 }}>添加群众（批量）</div>
          <div className="flex flex-wrap gap-1">
            {([[2, 3], [3, 3], [3, 4], [4, 5], [5, 6], [6, 8]] as const).map(([r, c]) => (
              <button key={`${r}x${c}`} onClick={() => addCrowd(r, c)} style={{ ...chip }}><Plus size={11} /> {c}×{r}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 6 }}>添加物体（几何道具）</div>
          <div className="flex flex-wrap gap-1">
            {PROP_PRIMS.map((pp) => (
              <button key={pp.key} onClick={() => addProp(pp.key)} title={`在原点附近放置一个${pp.label}`} style={{ ...chip }}><Plus size={11} /> {pp.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 6 }}>位置模板（一键布景）</div>
          <div className="flex flex-wrap gap-1">
            {LAYOUT_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => applyLayoutTemplate(t.key)} title={t.desc} style={{ ...chip }}>{t.label}</button>
            ))}
          </div>
          {/* #78 真 3D 灯光（LibTV 没有）：布光预设 + 单灯添加 + 灯光列表 */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 6 }}>灯光（真 3D 布光）</div>
          <div className="flex flex-wrap gap-1">
            {LIGHT_RIG_PRESETS.map((r) => (
              <button key={r.key} onClick={() => applyLightRig(r)} title={r.desc} style={{ ...chip }}>💡 {r.label}</button>
            ))}
          </div>
          {/* #110 我的布光：存当前布光为预设 + 已存预设应用/删除 */}
          <div className="flex flex-wrap gap-1">
            <button
              disabled={lights.length === 0}
              onClick={() => {
                if (lights.length === 0) return;
                const name = window.prompt("给当前布光起个名字（同名覆盖）：", `布光 ${myRigs.length + 1}`)?.trim();
                if (!name) return;
                setMyRigs(saveMyLightRig(name, lights));
                toast.success(`已保存我的布光「${name}」（${lights.length} 盏灯）`);
              }}
              title={lights.length === 0 ? "先摆几盏灯再保存" : "把当前全部灯光存为我的布光预设（本机保存）"}
              style={{ ...chip, opacity: lights.length === 0 ? 0.5 : 1 }}
            >⭐ 存为我的布光</button>
            {myRigs.map((r) => (
              <span key={r.name} style={{ display: "inline-flex", alignItems: "center" }}>
                <button
                  onClick={() => {
                    setScene((sc) => ({ ...sc, lights: r.lights.map((l) => ({ ...l, id: `L${Math.random().toString(36).slice(2, 9)}`, position: [...l.position] as [number, number, number], target: l.target ? [...l.target] as [number, number, number] : undefined })), dimBase: sc.dimBase ?? true }));
                    setSelectedLightId(null);
                    toast.success(`已应用我的布光「${r.name}」（${r.lights.length} 盏灯）`);
                  }}
                  title={`应用我的布光「${r.name}」（${r.lights.length} 盏灯，替换现有灯光）`}
                  style={{ ...chip, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                >⭐ {r.name}</button>
                <button
                  onClick={() => { setMyRigs(deleteMyLightRig(r.name)); toast.success(`已删除「${r.name}」`); }}
                  title={`删除我的布光「${r.name}」`}
                  style={{ ...chip, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "none", paddingLeft: 5, paddingRight: 5, color: "oklch(0.65 0.2 25)" }}
                >×</button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => addLightKind("spot")} title="添加一盏聚光灯（锥形光束，可指向角色）" style={{ ...chip }}><Plus size={11} /> 聚光</button>
            <button onClick={() => addLightKind("point")} title="添加一盏点光源（向四周发散）" style={{ ...chip }}><Plus size={11} /> 点光</button>
            {lights.length > 0 && (
              <button onClick={() => { setScene((s) => ({ ...s, lights: [] })); setSelectedLightId(null); }} title="清空所有灯光（恢复默认基础光）" style={{ ...chip, color: "oklch(0.65 0.2 25)" }}>清空灯光</button>
            )}
          </div>
          {lights.map((l) => (
            <div key={l.id} className="flex items-center gap-1">
              <button onClick={() => selectLight(l.id)} style={{ ...rowBtn(l.id === selectedLightId), flex: 1 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.color, boxShadow: `0 0 6px ${l.color}`, display: "inline-block", marginRight: 7 }} />
                {l.name}<span style={{ marginLeft: 5, fontSize: 9.5, color: "var(--c-t4)" }}>{LIGHT_KIND_LABEL[l.kind]}</span>
              </button>
              <button onClick={() => removeLight(l.id)} title="删除灯光" style={{ ...iconBtn }}><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={() => glbInputRef.current?.click()} disabled={glbBusy} style={{ ...chip, justifyContent: "center", marginTop: 6, opacity: glbBusy ? 0.6 : 1 }}
            title="导入本地 3D 模型：glb 直传；gltf/obj/stl/fbx 自动转换为 glb（gltf 需自包含）">
            {glbBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 导入 3D 模型（glb/obj/stl/fbx）
          </button>
          <button onClick={exportSceneGlb} style={{ ...chip, justifyContent: "center", marginTop: 4 }}
            title="把当前场景（人物+道具+导入模型）导出为 .glb，可在 Blender 等工具打开或再导入">
            <Download size={11} /> 导出场景（.glb）
          </button>
          <input ref={glbInputRef} type="file" accept=".glb,.gltf,.obj,.stl,.fbx,model/gltf-binary" style={{ display: "none" }} onChange={onGlbFile} />
        </div>

        {/* 中：3D 取景区 */}
        <div ref={stageRef} className="flex-1 flex items-center justify-center" style={{ minWidth: 0, background: "#07090e", position: "relative" }}>
          {/* 拖拽手柄模式（选中独立人偶时在画面里直接拖动） */}
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 5, display: "flex", gap: 4, padding: 4, borderRadius: 10, background: "color-mix(in oklch, var(--c-elevated) 90%, transparent)", border: "1px solid var(--c-bd2)", backdropFilter: "blur(10px)" }}>
            {([["translate", "移动"], ["rotate", "旋转"], ["scale", "缩放"]] as const).map(([mode, lbl]) => (
              <button key={mode} onClick={() => setGizmoMode(mode)} style={{ ...chip, fontWeight: gizmoMode === mode ? 700 : 500, background: gizmoMode === mode ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: gizmoMode === mode ? "#0b0d12" : "var(--c-t3)" }}>{lbl}</button>
            ))}
            {/* #78 网格吸附（LibTV）：拖拽步进 移动0.25m/旋转15°/缩放0.1 */}
            <button onClick={() => setSnap((v) => !v)} title="网格吸附：拖拽手柄按步进对齐（移动 0.25m / 旋转 15° / 缩放 0.1）"
              style={{ ...chip, fontWeight: snap ? 700 : 500, background: snap ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: snap ? "#0b0d12" : "var(--c-t3)" }}>吸附</button>
          </div>
          {/* #71 原点可位移：布景原点（新增人物/群众/物体/模板的落点 + 网格中心 + 三色轴标记） */}
          <div style={{ position: "absolute", top: 56, left: 12, zIndex: 5, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 10, background: "color-mix(in oklch, var(--c-elevated) 90%, transparent)", border: "1px solid var(--c-bd2)", backdropFilter: "blur(10px)" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t3)" }} title="布景原点：新增人物/群众/物体/位置模板都落在这里；画面中的三色轴即原点">原点</span>
            <DragNumber label="X" value={origin[0]} step={0.1} fixed={1} onChange={(v) => setOriginXZ(v, origin[2])} />
            <DragNumber label="Z" value={origin[2]} step={0.1} fixed={1} onChange={(v) => setOriginXZ(origin[0], v)} />
            <button onClick={originToViewCenter} title="把原点移到当前视点中心（先环绕到目标区域再点）" style={{ ...iconBtn }}><Crosshair size={12} /></button>
            <button onClick={() => setOriginXZ(0, 0)} title="原点归零" style={{ ...iconBtn }}><RotateCcw size={11} /></button>
          </div>
          {/* 全景对齐：仅在已设全景时显示。升降/缩放使全景地面与人物脚底对齐（LibTV 模块16） */}
          {scene.panoramaUrl && !scene.background && (
            <div style={{ position: "absolute", bottom: 60, left: 12, zIndex: 5, width: 210, padding: 10, borderRadius: 12, background: "color-mix(in oklch, var(--c-elevated) 92%, transparent)", border: "1px solid var(--c-bd2)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t2)" }}>全景对齐</div>
              <div style={{ fontSize: 9.5, color: "var(--c-t4)", lineHeight: 1.4, marginBottom: 2 }}>人物真实身高站在地面。① 地平线歪→「俯仰/翻滚」扳平；②「机位距离」定大小；③ 人物悬空→点「落到地面」或拖「垂直贴地」把脚对到照片地面（俯瞰图需往下落）。</div>
              <button onClick={dropToGround} style={{ ...chip, justifyContent: "center", color: "var(--ui-accent, var(--c-accent))", fontWeight: 700 }} title="把人物脚底落到画面下方地面（纯全景无深度，落好后用「垂直贴地」微调）">⤓ 人物落到地面</button>
              <Slider label="背景转" value={scene.panoramaYaw ?? 0} min={0} max={360} step={1} onChange={(v) => patchScene({ panoramaYaw: v })} />
              <Slider label="俯仰" value={scene.panoramaPitch ?? 0} min={-45} max={45} step={0.5} fixed={1} onChange={(v) => patchScene({ panoramaPitch: v })} />
              <Slider label="翻滚" value={scene.panoramaRoll ?? 0} min={-45} max={45} step={0.5} fixed={1} onChange={(v) => patchScene({ panoramaRoll: v })} />
              <Slider label="球半径" value={scene.panoramaScale ?? 1} min={0.2} max={8} step={0.05} fixed={2} onChange={(v) => patchScene({ panoramaScale: v })} />
              {/* 相机锚定：视高决定地平线高度、距离决定人物大小(透视正确) */}
              <Slider label="相机视高" value={camHeight} min={0.1} max={4} step={0.02} fixed={2} onChange={setCamHeight} />
              <Slider label="机位距离" value={camDist} min={0.8} max={20} step={0.05} fixed={2} onChange={setCamDistance} />
              {/* 垂直贴地：纯全景无真实地面深度，留此手动把脚对到照片地面（俯瞰图往下、仰视往上） */}
              <Slider label="垂直贴地" value={scene.sceneOffsetY ?? 0} min={-20} max={8} step={0.05} fixed={2} onChange={(v) => patchScene({ sceneOffsetY: v })} />
              <Slider label="平移X" value={scene.sceneOffsetX ?? 0} min={-8 * sceneS} max={8 * sceneS} step={0.05} fixed={2} onChange={(v) => patchScene({ sceneOffsetX: v })} />
              <Slider label="平移Z" value={scene.sceneOffsetZ ?? 0} min={-8 * sceneS} max={8 * sceneS} step={0.05} fixed={2} onChange={(v) => patchScene({ sceneOffsetZ: v })} />
            </div>
          )}
          {/* 机位画面实时预览小窗（模块3/25）：导演视角自由布局时，右下角实时显示当前机位取景 */}
          {viewMode === "director" && <ShotPreview scene={scene} />}
          <div style={{ width: frame.w, height: frame.h, position: "relative", boxShadow: "0 0 0 1px var(--c-bd2), 0 8px 40px oklch(0 0 0 / 0.6)" }}>
            <Canvas
              shadows
              // #81 lite：dpr 锁 1（高分屏 4× 像素量是老旧集显最大负担）+ 关抗锯齿。
              // 刻意保留 shadows——灯光投影是导演台灯光系统的功能表现（#78），不属可降视觉。
              // 提示：lite 下 3D 截图分辨率随 dpr 降低，追求产出画质时切回「画质」档再拍。
              dpr={perfLite ? 1 : [1, 2]}
              camera={initCam}
              gl={{ preserveDrawingBuffer: true, antialias: !perfLite }}
              style={{ width: "100%", height: "100%", borderRadius: 4 }}
              onPointerMissed={() => { setSelectedId(null); setSelectedGroupId(null); setSelectedLightId(null); }}
            >
              {/* 天空颜色：默认深空黑 #060608（对齐 LibTV 模块16），全景未覆盖处即此色 */}
              {/* 背景图激活时不 attach 纯色（两者都写 scene.background 会互相覆盖） */}
              {!flatBgActive && <color attach="background" args={[scene.background || (scene.panoramaUrl ? "#060608" : "#1a1d24")]} />}
              {flatBgActive && <FlatBackground url={scene.backgroundImageUrl!} />}
              {scene.panoramaUrl && !scene.background && (
                <Suspense fallback={null}>
                  <PanoramaSphere url={scene.panoramaUrl} yaw={scene.panoramaYaw ?? 0} pitch={scene.panoramaPitch ?? 0} roll={scene.panoramaRoll ?? 0} scale={scene.panoramaScale ?? 1} />
                </Suspense>
              )}
              {/* #78 基础光：有布光且开「压暗基础光」时压到极低，让布光造型主导明暗 */}
              <ambientLight intensity={lights.length && scene.dimBase !== false ? 0.12 : 0.7} />
              <directionalLight position={[4, 8, 5]} intensity={lights.length && scene.dimBase !== false ? 0.15 : 1.1} castShadow shadow-mapSize={[1024, 1024]} />
              <directionalLight position={[-5, 4, -3]} intensity={lights.length && scene.dimBase !== false ? 0.06 : 0.4} />
              {/* #78 真 3D 灯光：真实光源实时照亮人偶/道具 + 可点选标记球（截图时隐藏标记） */}
              {lights.map((l) => (
                <LightObj key={l.id} light={l} selected={l.id === selectedLightId}
                  onSelect={() => selectLight(l.id)}
                  bindMarker={l.id === selectedLightId ? ((el) => setLightGizmoTarget(el)) : undefined} />
              ))}
              {/* #84 3D 机位实体（对齐 LibTV）：全部命名机位在场景中可见/可点选/可拖拽；
                  机位视角下隐藏当前机位自身（正从它眼里看） */}
              {cameras.map((c) => (
                <CameraGizmo key={c.id} cam={c} active={c.id === activeCameraId}
                  hidden={viewMode === "camera" && c.id === activeCameraId}
                  labelsVisible={scene.labelsVisible !== false}
                  onSelect={() => selectCameraFromScene(c.id!)}
                  bindRef={camSelected && c.id === activeCameraId ? ((el) => setCamGizmoTarget(el)) : undefined} />
              ))}
              {scene.groundVisible && (
                <Grid args={[40, 40]} cellSize={0.5} cellThickness={0.6} sectionSize={2} sectionThickness={1} infiniteGrid fadeDistance={26} cellColor="#2a2f3a" sectionColor="#3a4150" position={[origin[0], 0, origin[2]]} />
              )}
              {/* #71 原点标记：三色轴小十字，标出布景原点（新增人物/模板落点） */}
              {scene.groundVisible && <axesHelper args={[0.7]} position={[origin[0], 0.02, origin[2]]} />}
              {/* 接触阴影：始终在 y=0 给人物落一层柔和投影，让角色「站在地面上」——
                  尤其全景模式(隐藏网格)下，否则人物会显得悬浮空中。纯黑分离模式下不渲染（看不到且干扰）。 */}
              {scene.background !== "#000000" && (
                <ContactShadows position={[scene.sceneOffsetX ?? 0, (scene.sceneOffsetY ?? 0) + 0.01, scene.sceneOffsetZ ?? 0]} scale={24} resolution={1024} blur={2.6} far={5} opacity={0.5} color="#000000" />
              )}
              {/* #71 双击地面放置人偶：透明拾取地面（世界 y=0，不参与截图/控制图/导出——顶层非
                  ACTORS_GROUP 对象在控制图渲染前会被隐藏，导出只打包 ACTORS_GROUP）。
                  单击空地=取消选中（与 onPointerMissed 行为一致）；双击=在点击处放一个人偶。
                  intersections[0] 守卫：点在人偶/道具上时它们离相机更近，此时不触发地面行为。 */}
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, -0.001, 0]}
                onClick={(e) => {
                  if (e.delta > 5 || e.intersections[0]?.eventObject !== e.eventObject) return;
                  setSelectedId(null); setSelectedGroupId(null); setSelectedLightId(null);
                }}
                onDoubleClick={(e) => {
                  if (e.delta > 5 || e.intersections[0]?.eventObject !== e.eventObject) return;
                  e.stopPropagation();
                  placeActorAt(e.point.x, e.point.z);
                }}
              >
                <planeGeometry args={[600, 600]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              {/* 场景缩放 + 升降：把整个「人物场景」(角色+群组) 包一层统一缩放与上下平移，相对全景
                  空间整体放大/缩小、升降，使人物与全景尺度/地面线匹配（LibTV 场景缩放）。 */}
              <group name={ACTORS_GROUP} position={[scene.sceneOffsetX ?? 0, scene.sceneOffsetY ?? 0, scene.sceneOffsetZ ?? 0]} scale={scene.sceneScale ?? 1}>
              {/* 群组成员：包在群组变换父级里（成员 position 为组内局部坐标），每个成员再包一层
                  变换 group（actor 变换）。 */}
              {groups.map((g) => (
                <group key={g.id} position={g.position} rotation={[g.rotation[0] * Math.PI / 180, g.rotation[1] * Math.PI / 180, g.rotation[2] * Math.PI / 180]} scale={g.scale}>
                  {scene.actors.filter((a) => a.groupId === g.id).map((a) => (
                    <group key={a.id} name={`actor:${a.id}`} position={a.position} rotation={[a.rotation[0] * Math.PI / 180, a.rotation[1] * Math.PI / 180, a.rotation[2] * Math.PI / 180]} scale={a.scale}
                      onPointerDown={(e) => { e.stopPropagation(); selectActor(a.id); }}>
                      {a.prim ? <PropModel actor={a} selected={a.id === selectedId || g.id === selectedGroupId} /> : a.glbUrl ? <GlbModel actor={a} selected={a.id === selectedId || g.id === selectedGroupId} /> : <HumanModel actor={a} selected={a.id === selectedId || g.id === selectedGroupId} />}
                    </group>
                  ))}
                </group>
              ))}
              {/* 独立人偶 / 导入模型：选中项挂 ref 供拖拽手柄 */}
              {scene.actors.filter((a) => !a.groupId).map((a) => {
                const sel = !camSelected && a.id === selectedId;
                return (
                  <group key={a.id} name={`actor:${a.id}`} ref={sel ? ((el) => setGizmoTarget(el)) : undefined}
                    position={a.position} rotation={[a.rotation[0] * Math.PI / 180, a.rotation[1] * Math.PI / 180, a.rotation[2] * Math.PI / 180]} scale={a.scale}
                    onPointerDown={(e) => { e.stopPropagation(); selectActor(a.id); }}>
                    {a.prim ? <PropModel actor={a} selected={sel} /> : a.glbUrl ? <GlbModel actor={a} selected={sel} /> : <HumanModel actor={a} selected={sel} />}
                  </group>
                );
              })}
              </group>
              {/* 拖拽手柄：选中独立人偶时可在画面里直接移动/旋转/缩放 */}
              {selected && !selected.groupId && gizmoTarget && (
                <TransformControls
                  object={gizmoTarget} mode={gizmoMode} size={0.8}
                  translationSnap={snap ? 0.25 : undefined}
                  rotationSnap={snap ? Math.PI / 12 : undefined}
                  scaleSnap={snap ? 0.1 : undefined}
                  onMouseUp={() => {
                    const o = gizmoTarget;
                    patchActor(selected.id, {
                      position: o.position.toArray() as Vec3,
                      rotation: [o.rotation.x * 180 / Math.PI, o.rotation.y * 180 / Math.PI, o.rotation.z * 180 / Math.PI] as Vec3,
                      scale: Number(((o.scale.x + o.scale.y + o.scale.z) / 3).toFixed(3)),
                    });
                  }}
                />
              )}
              {/* #78 灯光拖拽手柄（仅移动；标记组即手柄目标） */}
              {selectedLight && lightGizmoTarget && (
                <TransformControls
                  object={lightGizmoTarget} mode="translate" size={0.7}
                  translationSnap={snap ? 0.25 : undefined}
                  onMouseUp={() => {
                    patchLight(selectedLight.id, { position: lightGizmoTarget.position.toArray() as Vec3 });
                  }}
                />
              )}
              {/* #84 机位拖拽手柄：移动=挪机位（注视点不变）；旋转=转镜头朝向（重算 target）。
                  仅导演视角下可拖（机位视角正从它眼里看，实体已隐藏）。 */}
              {camSelected && camGizmoTarget && viewMode === "director" && (
                <TransformControls
                  object={camGizmoTarget}
                  mode={gizmoMode === "rotate" ? "rotate" : "translate"}
                  size={0.7}
                  translationSnap={snap ? 0.25 : undefined}
                  rotationSnap={snap ? Math.PI / 12 : undefined}
                  onMouseUp={() => {
                    const o = camGizmoTarget;
                    const cur = sceneRef.current.camera;
                    if (gizmoMode === "rotate") {
                      // 旋转：取 gizmo 新朝向的 -Z 前向，注视距离保持不变，重算 target
                      const dist = Math.hypot(cur.target[0] - cur.position[0], cur.target[1] - cur.position[1], cur.target[2] - cur.position[2]) || 3;
                      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion);
                      const t = new THREE.Vector3(...cur.position).addScaledVector(fwd, dist);
                      patchCam({ target: [t.x, t.y, t.z], lookAtActorId: undefined });
                    } else {
                      patchCam({ position: o.position.toArray() as Vec3 });
                    }
                  }}
                />
              )}
              <CameraRig cam={scene.camera} onCommit={onCommitCam} bind={bindCapture} locked={viewMode === "camera"} grab={dragMode === "grab"} />
            </Canvas>
            {/* 取景安全框（三分线） */}
            <div className="nodrag" style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 4 }}>
              <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, width: 1, background: "oklch(1 0 0 / 0.12)" }} />
              <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, width: 1, background: "oklch(1 0 0 / 0.12)" }} />
              <div style={{ position: "absolute", top: "33.33%", left: 0, right: 0, height: 1, background: "oklch(1 0 0 / 0.12)" }} />
              <div style={{ position: "absolute", top: "66.66%", left: 0, right: 0, height: 1, background: "oklch(1 0 0 / 0.12)" }} />
            </div>
          </div>
          {/* 底部画幅/开关条 */}
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", background: "color-mix(in oklch, var(--c-elevated) 92%, transparent)", border: "1px solid var(--c-bd2)", borderRadius: 12, backdropFilter: "blur(12px)" }}>
            <span style={{ fontSize: 11, color: "var(--c-t4)" }}>画幅</span>
            {DIRECTOR_ASPECTS.map((r) => (
              <button key={r} onClick={() => patchScene({ aspectRatio: r })} style={{ ...chip, fontWeight: scene.aspectRatio === r ? 700 : 500, background: scene.aspectRatio === r ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: scene.aspectRatio === r ? "#0b0d12" : "var(--c-t3)" }}>{r}</button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--c-bd2)" }} />
            <button onClick={() => patchScene({ groundVisible: !scene.groundVisible })} title="显示/隐藏地面" style={{ ...iconBtn, color: scene.groundVisible ? "var(--c-t3)" : "var(--c-t4)" }}>{scene.groundVisible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            {/* 黑底分离：纯黑背景 + 只留彩色人偶，导出仅控站位的参考图，避免全景/复杂背景畸变污染 AI（文档模块19）。 */}
            <button
              onClick={() => patchScene({ background: scene.background === "#000000" ? "" : "#000000", ...(scene.background === "#000000" ? {} : { groundVisible: false }) })}
              title="黑底分离：纯黑背景只控人物站位（防背景畸变，背景交给 AI 自由生成）"
              style={{ ...chip, fontWeight: scene.background === "#000000" ? 700 : 500, background: scene.background === "#000000" ? "#000" : "var(--c-surface)", color: scene.background === "#000000" ? "#fff" : "var(--c-t3)", border: `1px solid ${scene.background === "#000000" ? "#fff5" : "var(--c-bd2)"}` }}
            >黑底</button>
            {/* 720° 全景背景：上传等距全景图作 360° 背景；已设则可清除（文档模块15-16） */}
            {scene.panoramaUrl ? (
              <button onClick={() => patchScene({ panoramaUrl: undefined })} title="清除全景背景" style={{ ...chip, background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontWeight: 700 }}>全景 ×</button>
            ) : (
              <button onClick={() => panoInputRef.current?.click()} disabled={panoBusy} title="上传等距全景图作 360° 背景（可用任意图像模型生成全景图）" style={{ ...chip, opacity: panoBusy ? 0.6 : 1 }}>
                {panoBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 全景
              </button>
            )}
            {/* #71 非全景背景图：整屏静态背景（机位转动背景不动；全景已设时全景优先） */}
            {scene.backgroundImageUrl ? (
              <button onClick={() => patchScene({ backgroundImageUrl: undefined })} title="清除背景图" style={{ ...chip, background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontWeight: 700 }}>背景图 ×</button>
            ) : (
              <button onClick={() => bgInputRef.current?.click()} disabled={bgBusy} title="上传普通背景图（非全景）：整屏静态背景，适合平面剧照/概念图垫底；全景已设时全景优先" style={{ ...chip, opacity: bgBusy ? 0.6 : 1 }}>
                {bgBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 背景图
              </button>
            )}
            <input ref={bgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onBgFile} />
            <input ref={panoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPanoFile} />
          </div>
        </div>

        {/* 右：参数面板 */}
        <div className="flex flex-col gap-3 p-3" style={{ width: 248, borderLeft: "1px solid var(--c-bd2)", overflowY: "auto" }}>
          {camSelected ? (
            <div style={panel}>
              <div style={ttl}>机位参数</div>
              {/* 切换机位 + 添加/删除 */}
              <div className="flex items-center gap-1" style={{ marginBottom: 8 }}>
                <select value={activeCameraId} onChange={(e) => switchCamera(e.target.value)}
                  style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6 }}>
                  {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={addCamera} title="新增机位（快照当前视角）" style={{ ...iconBtn }}><Plus size={12} /></button>
                <button onClick={() => deleteCamera(activeCameraId)} title="删除当前机位" disabled={cameras.length <= 1} style={{ ...iconBtn, opacity: cameras.length <= 1 ? 0.4 : 1 }}><Trash2 size={12} /></button>
              </div>
              <input value={scene.camera.name ?? "机位"} onChange={(e) => patchCam({ name: e.target.value })}
                style={{ width: "100%", padding: "4px 6px", fontSize: 11.5, fontWeight: 600, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, marginBottom: 8 }} />
              <DragNumber label="FOV" value={scene.camera.fov} step={0.5} fixed={1} suffix="°" onChange={(v) => patchCam({ fov: Math.max(8, Math.min(120, v)) })} />
              {/* 景别预设（模块28 五种景别）：一键设定 FOV+距离，远→特写逐步推进 */}
              <div style={sub}>景别</div>
              <div className="flex flex-wrap gap-1">
                {SHOTS.map((sh) => (
                  <button key={sh.label} onClick={() => applyShot(sh)} title={`${sh.label} · FOV ${sh.fov}°`} style={{ ...chip }}>{sh.label}</button>
                ))}
              </div>
              <div style={sub}>位置</div>
              <Xyz v={scene.camera.position} min={-reachFor(scene.camera.position)} max={reachFor(scene.camera.position)} onChange={(position) => { patchCam({ position }); moveLiveCamera({ ...scene.camera, position }); }} />
              <div style={sub}>注视目标</div>
              <select value={scene.camera.lookAtActorId ?? ""} onChange={(e) => lookAtActor(e.target.value || undefined)}
                style={{ width: "100%", padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, marginBottom: 6 }}>
                <option value="">手动坐标</option>
                {scene.actors.map((a) => <option key={a.id} value={a.id}>对准 {a.name}</option>)}
              </select>
              <Xyz v={scene.camera.target} min={-reachFor(scene.camera.target)} max={reachFor(scene.camera.target)} onChange={(target) => { patchCam({ target, lookAtActorId: undefined }); moveLiveCamera({ ...scene.camera, target }); }} />
              {/* #78 相机截图库（LibTV「摄像机截图」）：多张暂存 → 全部清空 / 发送到画布 */}
              <div style={sub}>相机截图库{shots.length ? `（${shots.length}）` : ""}</div>
              <button onClick={shootToLibrary} disabled={saving} style={{ ...chip, justifyContent: "center", width: "100%", opacity: saving ? 0.6 : 1 }}
                title="把当前机位画面渲染一张存入截图库（不覆盖节点主图）；换机位/换布光可连拍多张再一起发送到画布">
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />} 截图入库
              </button>
              {shots.length > 0 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 6 }}>
                    {shots.map((s, i) => (
                      <div key={`${s.url}-${i}`} style={{ position: "relative", borderRadius: 7, overflow: "hidden", border: "1px solid var(--c-bd2)" }}>
                        <img src={s.url} alt={s.name} style={{ width: "100%", aspectRatio: String(ar), objectFit: "cover", display: "block" }} />
                        <div style={{ fontSize: 8.5, color: "var(--c-t4)", padding: "2px 4px", background: "var(--c-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                        <button onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))} title="删除这张截图"
                          style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 5, border: "none", background: "oklch(0 0 0 / 0.55)", color: "#fff", fontSize: 10, lineHeight: "16px", cursor: "pointer", padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1" style={{ marginTop: 6 }}>
                    <button onClick={() => setShots([])} style={{ ...chip, flex: 1, justifyContent: "center" }}>全部清空</button>
                    <button onClick={sendShotsToCanvas} style={{ ...chip, flex: 1, justifyContent: "center", background: "var(--ui-accent, var(--c-accent))", color: "#0b0d12", fontWeight: 700 }}
                      title="把截图库整批落成连好线的分镜节点网格">发送到画布</button>
                  </div>
                </>
              )}
              <p style={hint}>导演视角自由环绕只是「看」，不会改机位；要瞄准请切「机位视角」拖拽取景（松手记录），或直接拖画面中的机位实体/上方滑杆。截图/宫格/控制图永远按当前机位输出。</p>
            </div>
          ) : selectedLight ? (
            <div style={panel}>
              <input value={selectedLight.name} onChange={(e) => patchLight(selectedLight.id, { name: e.target.value.slice(0, 12) })}
                style={{ ...ttl, width: "100%", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "4px 6px" }} />
              <div className="flex gap-1" style={{ marginBottom: 6 }}>
                {(["spot", "point"] as const).map((k) => (
                  <button key={k} onClick={() => patchLight(selectedLight.id, { kind: k, ...(k === "spot" ? { target: selectedLight.target ?? [0, 1.0, 0], angle: selectedLight.angle ?? 40 } : {}) })}
                    style={{ ...chip, flex: 1, justifyContent: "center", fontWeight: selectedLight.kind === k ? 700 : 500, background: selectedLight.kind === k ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: selectedLight.kind === k ? "#0b0d12" : "var(--c-t3)" }}>{LIGHT_KIND_LABEL[k]}</button>
                ))}
              </div>
              <div style={sub}>位置（可在画面里直接拖标记球）</div>
              <Xyz v={selectedLight.position} min={-12} max={12} onChange={(position) => patchLight(selectedLight.id, { position })} />
              <div style={sub}>光色</div>
              <div className="flex items-center gap-1">
                <input type="color" value={selectedLight.color} onChange={(e) => patchLight(selectedLight.id, { color: e.target.value })} style={{ flex: 1, height: 26, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
                {["#fff1d6", "#dfe8ff", "#ff2d95", "#00e5ff", "#ffb020"].map((c) => (
                  <button key={c} onClick={() => patchLight(selectedLight.id, { color: c })} title={c}
                    style={{ width: 18, height: 18, borderRadius: "50%", border: selectedLight.color === c ? "2px solid var(--c-t1)" : "1px solid var(--c-bd2)", background: c, cursor: "pointer", padding: 0 }} />
                ))}
              </div>
              <div style={sub}>强度</div>
              <Slider label="强度" value={selectedLight.intensity} min={0.1} max={8} step={0.1} fixed={1} onChange={(v) => patchLight(selectedLight.id, { intensity: v })} />
              {selectedLight.kind === "spot" && (
                <>
                  <Slider label="锥角" value={selectedLight.angle ?? 40} min={8} max={90} step={1} onChange={(v) => patchLight(selectedLight.id, { angle: v })} />
                  <div style={sub}>聚光指向</div>
                  <select value="" onChange={(e) => { if (e.target.value === "__origin__") patchLight(selectedLight.id, { target: [origin[0], 1.0, origin[2]] }); else if (e.target.value) aimLightAtActor(selectedLight.id, e.target.value); }}
                    style={{ width: "100%", padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, marginBottom: 6 }}>
                    <option value="">指向坐标（下方微调）…</option>
                    <option value="__origin__">对准原点</option>
                    {scene.actors.filter((a) => !a.prim).map((a) => <option key={a.id} value={a.id}>对准 {a.name}</option>)}
                  </select>
                  <Xyz v={selectedLight.target ?? [0, 1.0, 0]} min={-12} max={12} onChange={(target) => patchLight(selectedLight.id, { target })} />
                </>
              )}
              <label className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--c-t3)", marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={!!selectedLight.castShadow} onChange={(e) => patchLight(selectedLight.id, { castShadow: e.target.checked })} />
                投射阴影（更真实，稍耗性能）
              </label>
              <label className="flex items-center gap-2" style={{ fontSize: 11, color: "var(--c-t3)", marginTop: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={scene.dimBase !== false} onChange={(e) => patchScene({ dimBase: e.target.checked })} />
                压暗基础光（布光造型主导明暗）
              </label>
              <button onClick={() => removeLight(selectedLight.id)} style={{ ...chip, justifyContent: "center", width: "100%", marginTop: 10, color: "oklch(0.65 0.2 25)" }}><Trash2 size={11} /> 删除灯光</button>
              <p style={hint}>光照实时作用于人偶/道具（LibTV 只有天空色没有布光）。截图时标记球自动隐藏、光照保留，并生成中文光效描述随节点输出。</p>
            </div>
          ) : selectedGroup ? (
            <div style={panel}>
              <input value={selectedGroup.name} onChange={(e) => patchGroup(selectedGroup.id, { name: e.target.value })}
                style={{ ...ttl, width: "100%", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "4px 6px" }} />
              <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginBottom: 6 }}>
                {selectedGroup.manual
                  ? `${scene.actors.filter((a) => a.groupId === selectedGroup.id).length} 个成员 · 手动编组（整组变换）`
                  : `${selectedGroup.cols}×${selectedGroup.rows} = ${selectedGroup.rows * selectedGroup.cols} 个成员（整组变换）`}
              </div>
              <div style={sub}>整组位置</div>
              <Xyz v={selectedGroup.position} min={-reachFor(selectedGroup.position, selectedGroup.scale)} max={reachFor(selectedGroup.position, selectedGroup.scale)} onChange={(position) => patchGroup(selectedGroup.id, { position })} />
              <div style={sub}>整组旋转(°)</div>
              <Xyz v={selectedGroup.rotation} min={-180} max={180} step={1} fixed={0} onChange={(rotation) => patchGroup(selectedGroup.id, { rotation })} />
              <div style={sub}>整组统一缩放</div>
              <Slider label="比例" value={selectedGroup.scale} min={0.1} max={30} step={0.1} fixed={1} onChange={(v) => patchGroup(selectedGroup.id, { scale: v })} />
              {!selectedGroup.manual && <>
                <div style={sub}>成员间距(米)</div>
                <Slider label="间距" value={selectedGroup.spacing ?? CROWD_SPACING} min={0.4} max={3} step={0.05} fixed={2} onChange={(v) => setGroupSpacing(selectedGroup.id, v)} />
              </>}
              <div style={sub}>组配色</div>
              <input type="color" value={selectedGroup.color} onChange={(e) => { const color = e.target.value; patchGroup(selectedGroup.id, { color }); setScene((s) => ({ ...s, actors: s.actors.map((a) => (a.groupId === selectedGroup.id ? { ...a, color } : a)) })); }} style={{ width: "100%", height: 28, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
              <div className="flex gap-1" style={{ marginTop: 10 }}>
                <button onClick={() => duplicateGroup(selectedGroup.id)} style={{ ...chip, flex: 1, justifyContent: "center" }} title="连同成员体型/姿势复制整组"><Copy size={12} /> 复制整组</button>
                <button onClick={() => ungroupGroup(selectedGroup.id)} style={{ ...chip, flex: 1, justifyContent: "center" }}>解组</button>
                <button onClick={() => deleteGroup(selectedGroup.id)} style={{ ...chip, flex: 1, justifyContent: "center", color: "oklch(0.65 0.2 25)" }}>删除整组</button>
              </div>
              <p style={hint}>解组后每个成员可独立调姿势/位置。点开左侧成员可单独选中。</p>
            </div>
          ) : selected ? (
            <div style={panel}>
              <div style={ttl}>{selected.name}{selected.glbUrl ? "（导入模型）" : ""}</div>
              {/* 变换 / 姿势 标签页（GLB 导入模型无参数化姿势，仅摆放） */}
              {!selected.glbUrl && (
                <div className="flex gap-1" style={{ marginBottom: 10 }}>
                  {([["transform", "变换"], ["pose", "姿势"]] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setActorTab(k)} style={{ ...chip, flex: 1, justifyContent: "center", fontWeight: actorTab === k ? 700 : 500, background: actorTab === k ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: actorTab === k ? "#0b0d12" : "var(--c-t3)" }}>{lbl}</button>
                  ))}
                </div>
              )}

              {(selected.glbUrl || actorTab === "transform") ? (
                <>
                  {!selected.glbUrl && (
                    <label style={{ display: "block", fontSize: 11, color: "var(--c-t3)", marginBottom: 8 }}>
                      体型
                      <select value={selected.model} onChange={(e) => patchActor(selected.id, { model: e.target.value })}
                        style={{ width: "100%", marginTop: 4, padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6 }}>
                        {MANNEQUIN_MODELS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div style={sub}>位置</div>
                  <Xyz v={selected.position} min={-reachFor(selected.position, selected.scale)} max={reachFor(selected.position, selected.scale)} onChange={(position) => patchActor(selected.id, { position })} />
                  <div style={sub}>旋转(°)</div>
                  <Xyz v={selected.rotation} min={-180} max={180} step={1} fixed={0} onChange={(rotation) => patchActor(selected.id, { rotation })} />
                  <button onClick={() => faceCameraActor(selected.id)} title="把角色转向当前机位" style={{ ...chip, justifyContent: "center", width: "100%", marginTop: 4 }}><Camera size={11} /> 面向机位</button>
                  <div style={sub}>缩放（放大以匹配全景场景）</div>
                  <Slider label="比例" value={selected.scale} min={0.1} max={30} step={0.1} fixed={1} onChange={(v) => patchActor(selected.id, { scale: v })} />
                  <div style={sub}>颜色</div>
                  <input type="color" value={selected.color} onChange={(e) => patchActor(selected.id, { color: e.target.value })} style={{ width: "100%", height: 28, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
                </>
              ) : (
                <>
                  <div style={sub}>动作预设<span style={{ color: "var(--c-t4)", fontWeight: 400 }}> · 悬停预览，点击应用</span></div>
                  <div className="flex flex-wrap gap-1">
                    {POSE_PRESETS.map((p) => (
                      <button key={p.key}
                        onMouseEnter={() => { if (poseHoverBackup.current === null) poseHoverBackup.current = selected.pose ?? {}; patchActor(selected.id, { pose: applyPosePreset(p.key) }); }}
                        onMouseLeave={() => { if (poseHoverBackup.current !== null) { patchActor(selected.id, { pose: poseHoverBackup.current }); poseHoverBackup.current = null; } }}
                        onClick={() => { poseHoverBackup.current = null; patchActor(selected.id, { pose: applyPosePreset(p.key) }); }}
                        style={{ ...chip, fontSize: 10.5 }}>{p.label}</button>
                    ))}
                  </div>
                  <div style={sub}>整体升降（脚贴地微调）</div>
                  <Slider label="升降" value={(selected.pose?.rootY ?? 0) * 100} min={-50} max={20} step={1} fixed={0}
                    onChange={(v) => patchActor(selected.id, { pose: { ...(selected.pose ?? {}), rootY: v / 100 } })} />
                  {JOINT_GROUPS.map((g) => (
                    <div key={g.group}>
                      <div style={sub}>{g.group}</div>
                      <div className="flex flex-col" style={{ gap: 5 }}>
                        {g.joints.map((j) => (
                          <Slider key={j.key} label={j.label} value={selected.pose?.[j.key] ?? 0} min={j.min} max={j.max}
                            onChange={(v) => patchActor(selected.id, { pose: { ...(selected.pose ?? {}), [j.key]: v } })} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-1" style={{ marginTop: 8 }}>
                    <button onClick={() => patchActor(selected.id, { pose: mirrorPose(selected.pose ?? {}) })} style={{ ...chip, justifyContent: "center", flex: 1 }} title="左右镜像当前姿势">⇄ 镜像左右</button>
                    <button onClick={() => patchActor(selected.id, { pose: {} })} style={{ ...chip, justifyContent: "center", flex: 1 }}>清空姿势（归零）</button>
                  </div>
                  <p style={hint}>摆个大概即可——AI 会脑补动作细节。提示词强调「人物姿态与参考图一致」。</p>
                </>
              )}
            </div>
          ) : (
            <div style={panel}>
              <div style={ttl}>场景</div>
              {scene.actors.length > 0 && (
                <>
                  <div style={sub}>全部人物缩放（匹配全景尺度）</div>
                  <Slider label="比例" value={scene.actors[0]?.scale ?? 1} min={0.1} max={30} step={0.1} fixed={1} onChange={scaleAllActors} />
                </>
              )}
              <p style={{ ...hint, marginTop: 10 }}>
                点选左侧图层或画面中的人偶/机位进行编辑；选中独立人偶后可用画面左上「移动/旋转/缩放」手柄直接拖；<b>双击地面</b>可在点击处直接放置人偶。<br /><br />
                工作流：摆好站位与机位 → 「截图 → 参考图」→ 连到生图/视频节点，提示词强调「人物站位与参考图一致」。
              </p>
            </div>
          )}
          <button onClick={resetCamera} style={{ ...headBtn(), justifyContent: "center" }}>
            <RotateCcw size={13} /> 重置机位
          </button>
        </div>
      </div>
    </div>
  );
}

// 五种景别预设（LibTV 模块28）：fov=视野角度、dist=机位到主体距离(米)、aimY=注视高度(米)。
// 远→特写 FOV 渐小、距离渐近、注视点由全身中部上移到面部，逐步推进情绪。
const SHOTS = [
  { label: "远景", fov: 66, dist: 9.0, aimY: 0.95 },
  { label: "全景", fov: 54, dist: 4.5, aimY: 0.95 },
  { label: "中景", fov: 47, dist: 2.6, aimY: 1.12 },
  { label: "近景", fov: 40, dist: 1.55, aimY: 1.45 },
  { label: "特写", fov: 30, dist: 0.95, aimY: 1.55 },
] as const;

// ── 小样式/子组件 ─────────────────────────────────────────────────────────────
const ttl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)", marginBottom: 8 };
const sub: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "8px 0 4px" };
const hint: React.CSSProperties = { fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5, marginTop: 10 };
const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "3px 7px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };
function rowBtn(active: boolean): React.CSSProperties {
  return { display: "flex", alignItems: "center", textAlign: "left", fontSize: 12, padding: "6px 9px", borderRadius: 8, cursor: "pointer", border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: active ? "color-mix(in oklch, var(--ui-accent, var(--c-accent)) 16%, transparent)" : "var(--c-surface)", color: "var(--c-t2)", width: "100%" };
}
// 三轴滑条（位置/旋转/注视点）。min/max/step 默认按「位置(米)」，旋转传 -180..180。
function Xyz({ v, onChange, min = -8, max = 8, step = 0.05, fixed = 2 }: {
  v: Vec3; onChange: (v: Vec3) => void; min?: number; max?: number; step?: number; fixed?: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 5 }}>
      {(["X", "Y", "Z"] as const).map((ax, i) => (
        <Slider key={ax} label={ax} value={v[i]} min={min} max={max} step={step} fixed={fixed}
          onChange={(nv) => { const c = [...v] as Vec3; c[i] = nv; onChange(c); }} />
      ))}
    </div>
  );
}
