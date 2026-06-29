import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { toast } from "sonner";
import { X, Camera, Plus, Trash2, RotateCcw, Eye, EyeOff, Loader2, Grid3x3, ChevronDown, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { DirectorScene, DirectorActor, DirectorCamera, Vec3 } from "../../../../../shared/types";
import {
  MANNEQUIN_MODELS, DIRECTOR_ASPECTS, aspectRatioValue, makeActor, makeDefaultDirectorScene, makeCrowd, bakeGroupTransform,
  ensureCameras, newCameraId, nextCameraName,
} from "../../../lib/directorScene";
import { JOINT_GROUPS, POSE_PRESETS, applyPosePreset } from "../../../lib/directorPose";
import { GRID_PRESETS, gridCameraPosition, type GridPreset } from "../../../lib/directorGrid";
import { Mannequin } from "./Mannequin";
import { GlbModel } from "./GlbModel";
import { PanoramaSphere } from "./Panorama";

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

// drei OrbitControls 实例（含 target / update）。
type OrbitImpl = { target: THREE.Vector3; update: () => void; object: THREE.Camera } | null;
export interface CaptureHandle { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; orbit: OrbitImpl; }

// ── 相机机架：初始 target、响应式 FOV、释放时回写机位、把渲染上下文暴露给截图/重置 ──
function CameraRig({ cam, onCommit, bind }: {
  cam: { position: Vec3; target: Vec3; fov: number };
  onCommit: (pos: Vec3, target: Vec3) => void;
  bind: (h: CaptureHandle) => void;
}) {
  const { gl, scene, camera } = useThree();
  const orbit = useRef<OrbitImpl>(null);
  const inited = useRef(false);

  useEffect(() => { // 初始 target（位置/FOV 由 Canvas camera 初值 + 下方 FOV effect 负责）
    if (inited.current || !orbit.current) return;
    inited.current = true;
    orbit.current.target.set(...cam.target); orbit.current.update();
  }, [cam.target]);

  useEffect(() => { // FOV 面板调节即时生效（不影响 OrbitControls 拥有的位置）
    (camera as THREE.PerspectiveCamera).fov = cam.fov;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, cam.fov]);

  useEffect(() => { bind({ gl, scene, camera, orbit: orbit.current }); }, [gl, scene, camera, bind]);

  return (
    <OrbitControls
      ref={orbit as never}
      makeDefault
      onEnd={() => { if (orbit.current) onCommit(camera.position.toArray() as Vec3, orbit.current.target.toArray() as Vec3); }}
    />
  );
}

export function DirectorEditor({ nodeId, projectId, onClose }: { nodeId: string; projectId: number; onClose: () => void }) {
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
  const selectActor = useCallback((id: string) => { setSelectedId(id); setSelectedGroupId(null); setCamSelected(false); }, []);
  const selectGroup = useCallback((id: string) => { setSelectedGroupId(id); setSelectedId(null); setCamSelected(false); }, []);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<CaptureHandle | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  // Canvas 初始机位（只在挂载时取一次，之后由 OrbitControls 拥有位置，避免受控 prop 与拖拽打架）。
  const initCam = useMemo(() => ({ fov: scene.camera.fov, position: scene.camera.position as Vec3, near: 0.1, far: 200 }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 持久化：关闭时把场景写回节点（不丢编辑）。
  useEffect(() => () => { updateNodeData(nodeId, { scene: sceneRef.current, aspectRatio: sceneRef.current.aspectRatio }, true); }, [nodeId, updateNodeData]);

  const selected = scene.actors.find((a) => a.id === selectedId) ?? null;
  const patchScene = useCallback((p: Partial<DirectorScene>) => setScene((s) => ({ ...s, ...p })), []);
  const patchActor = useCallback((id: string, p: Partial<DirectorActor>) => {
    setScene((s) => ({ ...s, actors: s.actors.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  }, []);
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
      const a = makeActor(model, s.actors, [s.actors.length * 0.6 - 0.3, 0, 0]);
      setSelectedId(a.id); setCamSelected(false);
      return { ...s, actors: [...s.actors, a] };
    });
  };
  const removeActor = (id: string) => {
    setScene((s) => ({ ...s, actors: s.actors.filter((a) => a.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // ── 群众群组 ──
  const groups = scene.groups ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const patchGroup = useCallback((id: string, p: Partial<NonNullable<DirectorScene["groups"]>[number]>) => {
    setScene((s) => ({ ...s, groups: (s.groups ?? []).map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  }, []);
  const addCrowd = (rows: number, cols: number) => {
    setScene((s) => {
      const { group, actors } = makeCrowd(rows, cols, s.actors);
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

  const uploadMut = trpc.upload.uploadImage.useMutation();

  // 导入本地 GLB 模型：上传 → 新建一个以 GLB 渲染的角色（无姿势，仅摆放）。
  const glbInputRef = useRef<HTMLInputElement>(null);
  const [glbBusy, setGlbBusy] = useState(false);
  const onGlbFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) { toast.error("当前支持 .glb 格式（.obj/.fbx 请先转 .glb）"); return; }
    if (file.size > 64 * 1024 * 1024) { toast.error("模型文件不能超过 64MB"); return; }
    setGlbBusy(true);
    try {
      const base64 = await blobToBase64(file);
      const r = await uploadMut.mutateAsync({ base64, mimeType: "model/gltf-binary", filename: file.name });
      setScene((s) => {
        const a = makeActor("male", s.actors, [s.actors.length * 0.6 - 0.3, 0, 0]);
        a.glbUrl = r.url; a.name = file.name.replace(/\.glb$/i, "").slice(0, 16) || a.name;
        setSelectedId(a.id); setSelectedGroupId(null); setCamSelected(false);
        return { ...s, actors: [...s.actors, a] };
      });
      toast.success("已导入模型");
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
      const r = await uploadMut.mutateAsync({ base64: await blobToBase64(file), mimeType: file.type, filename: file.name });
      patchScene({ panoramaUrl: r.url, groundVisible: false });
      toast.success("已设为全景背景");
    } catch (err) { toast.error("全景上传失败：" + (err instanceof Error ? err.message : String(err))); }
    finally { setPanoBusy(false); }
  };

  const onCommitCam = useCallback((position: Vec3, target: Vec3) => patchCam({ position, target }), [patchCam]);
  const bindCapture = useCallback((h: CaptureHandle) => { captureRef.current = h; }, []);

  // 重置机位：imperatively 把相机/控制器拨回默认，并同步场景（避免受控 prop 回灌打架）。
  const resetCamera = useCallback(() => {
    const dft = makeDefaultDirectorScene().camera;
    const cap = captureRef.current;
    if (cap) {
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
  const addCamera = useCallback(() => {
    setScene((s) => {
      const cams = ensureCameras(s);
      const nc: DirectorCamera = { ...s.camera, id: newCameraId(), name: nextCameraName(cams), lookAtActorId: undefined };
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
  const actorWorldPos = (a: DirectorActor): Vec3 => {
    if (!a.groupId) return a.position;
    const g = (scene.groups ?? []).find((x) => x.id === a.groupId);
    if (!g) return a.position;
    const ry = (g.rotation[1] ?? 0) * Math.PI / 180, s = g.scale;
    const lx = a.position[0] * s, lz = a.position[2] * s;
    return [g.position[0] + lx * Math.cos(ry) + lz * Math.sin(ry), g.position[1] + a.position[1] * s, g.position[2] - lx * Math.sin(ry) + lz * Math.cos(ry)];
  };
  const lookAtActor = useCallback((actorId: string | undefined) => {
    if (!actorId) { patchCam({ lookAtActorId: undefined }); return; }
    const a = scene.actors.find((x) => x.id === actorId); if (!a) return;
    const wp = actorWorldPos(a);
    const target: Vec3 = [wp[0], wp[1] + 1.0, wp[2]];
    const cap = captureRef.current; if (cap?.orbit) { cap.orbit.target.set(...target); cap.orbit.update(); }
    patchCam({ target, lookAtActorId: actorId });
  }, [scene.actors, scene.groups, patchCam]); // eslint-disable-line react-hooks/exhaustive-deps

  // 截图：用当前机位渲染一帧 → toBlob → 上传 → 写入节点 imageUrl（参考图）。
  const shoot = async () => {
    const cap = captureRef.current;
    if (!cap || saving) return;
    setSaving(true);
    try {
      cap.gl.render(cap.scene, cap.camera);
      const blob = await canvasToBlob(cap.gl);
      if (!blob) throw new Error("渲染截图失败");
      const base64 = await blobToBase64(blob);
      const result = await uploadMut.mutateAsync({ base64, mimeType: "image/png", filename: "director-3d.png" });
      updateNodeData(nodeId, { scene: sceneRef.current, imageUrl: result.url, imageStorageKey: result.storageKey, aspectRatio: scene.aspectRatio, status: "done" });
      toast.success("已截图并输出为参考图");
    } catch (e) {
      toast.error("截图失败：" + (e instanceof Error ? e.message : String(e)));
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
    const target = sceneRef.current.camera.target;
    const tVec = new THREE.Vector3(...target);
    try {
      const urls: string[] = [];
      for (let i = 0; i < preset.angles.length; i++) {
        const pos = gridCameraPosition(savePos.toArray() as Vec3, target, preset.angles[i]);
        cam.position.set(...pos); cam.lookAt(tVec); cam.updateMatrixWorld();
        cap.gl.render(cap.scene, cam);
        const blob = await canvasToBlob(cap.gl);
        if (!blob) continue;
        const r = await uploadMut.mutateAsync({ base64: await blobToBase64(blob), mimeType: "image/png", filename: `dir-grid-${preset.key}-${i}.png` });
        urls.push(r.url);
        setGridBusy(`${preset.label} ${i + 1}/${preset.angles.length}`);
      }
      // 还原机位
      cam.position.copy(savePos); cam.lookAt(tVec);
      if (cap.orbit) { cap.orbit.target.set(...target); cap.orbit.update(); }
      if (urls.length) {
        updateNodeData(nodeId, { scene: sceneRef.current }, true);
        addGridNodes(urls, { rows: preset.rows, cols: preset.cols, sourcePosition: nodePos, sourceNodeId: nodeId, titlePrefix: "机位", aspectRatio: sceneRef.current.aspectRatio });
        toast.success(`已生成 ${urls.length} 个机位分镜节点`);
        onClose();
      }
    } catch (e) {
      toast.error("多机位生成失败：" + (e instanceof Error ? e.message : String(e)));
    } finally { setGridBusy(null); }
  };

  const ar = aspectRatioValue(scene.aspectRatio);

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

  const panel: React.CSSProperties = { background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 12 };
  const headBtn = (active?: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9,
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: "1px solid var(--c-bd2)",
    background: active ? "var(--ui-accent, var(--c-accent))" : "var(--c-surface)", color: active ? "#0b0d12" : "var(--c-t2)",
  });

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "var(--c-bg, #0b0d12)" }}>
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4" style={{ height: 52, borderBottom: "1px solid var(--c-bd2)", background: "var(--c-elevated)" }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: "var(--c-t1)" }}>🎬 导演台</span>
        <span style={{ fontSize: 11, color: "var(--c-t4)" }}>3D 精准构图 · 截图即参考图</span>
        <div className="flex-1" />
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
        <button onClick={shoot} disabled={saving} style={{ ...headBtn(true), opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} {saving ? "输出中…" : "截图 → 参考图"}
        </button>
        <button onClick={onClose} style={headBtn()}><X size={14} /> 关闭</button>
      </div>

      <div className="flex-1 flex" style={{ minHeight: 0 }}>
        {/* 左：图层列表 */}
        <div className="flex flex-col gap-2 p-3" style={{ width: 220, borderRight: "1px solid var(--c-bd2)", overflowY: "auto" }}>
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
              <button onClick={() => selectActor(a.id)} style={{ ...rowBtn(!camSelected && a.id === selectedId), flex: 1 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: a.color, display: "inline-block", marginRight: 7 }} />
                {a.name}
              </button>
              <button onClick={() => removeActor(a.id)} title="删除" style={{ ...iconBtn }}><Trash2 size={12} /></button>
            </div>
          ))}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 8 }}>添加人偶</div>
          <div className="flex flex-wrap gap-1">
            {MANNEQUIN_MODELS.map((m) => (
              <button key={m.key} onClick={() => addActor(m.key)} style={{ ...chip }}><Plus size={11} /> {m.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", marginTop: 6 }}>添加群众（批量）</div>
          <div className="flex flex-wrap gap-1">
            {([[2, 3], [3, 3], [3, 4], [4, 5]] as const).map(([r, c]) => (
              <button key={`${r}x${c}`} onClick={() => addCrowd(r, c)} style={{ ...chip }}><Plus size={11} /> {c}×{r}</button>
            ))}
          </div>
          <button onClick={() => glbInputRef.current?.click()} disabled={glbBusy} style={{ ...chip, justifyContent: "center", marginTop: 6, opacity: glbBusy ? 0.6 : 1 }}>
            {glbBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} 导入 3D 模型（.glb）
          </button>
          <input ref={glbInputRef} type="file" accept=".glb,model/gltf-binary" style={{ display: "none" }} onChange={onGlbFile} />
        </div>

        {/* 中：3D 取景区 */}
        <div ref={stageRef} className="flex-1 flex items-center justify-center" style={{ minWidth: 0, background: "#07090e", position: "relative" }}>
          <div style={{ width: frame.w, height: frame.h, position: "relative", boxShadow: "0 0 0 1px var(--c-bd2), 0 8px 40px oklch(0 0 0 / 0.6)" }}>
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={initCam}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              style={{ width: "100%", height: "100%", borderRadius: 4 }}
              onPointerMissed={() => { setSelectedId(null); setSelectedGroupId(null); }}
            >
              <color attach="background" args={[scene.background || "#1a1d24"]} />
              {scene.panoramaUrl && !scene.background && (
                <Suspense fallback={null}><PanoramaSphere url={scene.panoramaUrl} /></Suspense>
              )}
              <ambientLight intensity={0.7} />
              <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
              <directionalLight position={[-5, 4, -3]} intensity={0.4} />
              {scene.groundVisible && (
                <Grid args={[40, 40]} cellSize={0.5} cellThickness={0.6} sectionSize={2} sectionThickness={1} infiniteGrid fadeDistance={26} cellColor="#2a2f3a" sectionColor="#3a4150" position={[0, 0, 0]} />
              )}
              {/* 群组成员：包在群组变换父级里（成员 position 为组内局部坐标） */}
              {groups.map((g) => (
                <group key={g.id} position={g.position} rotation={[g.rotation[0] * Math.PI / 180, g.rotation[1] * Math.PI / 180, g.rotation[2] * Math.PI / 180]} scale={g.scale}>
                  {scene.actors.filter((a) => a.groupId === g.id).map((a) => (
                    a.glbUrl
                      ? <GlbModel key={a.id} actor={a} selected={a.id === selectedId || g.id === selectedGroupId} onSelect={() => selectActor(a.id)} />
                      : <Mannequin key={a.id} actor={a} selected={a.id === selectedId || g.id === selectedGroupId} onSelect={() => selectActor(a.id)} />
                  ))}
                </group>
              ))}
              {/* 独立人偶 / 导入模型 */}
              {scene.actors.filter((a) => !a.groupId).map((a) => (
                a.glbUrl
                  ? <GlbModel key={a.id} actor={a} selected={!camSelected && a.id === selectedId} onSelect={() => selectActor(a.id)} />
                  : <Mannequin key={a.id} actor={a} selected={!camSelected && a.id === selectedId} onSelect={() => selectActor(a.id)} />
              ))}
              <CameraRig cam={scene.camera} onCommit={onCommitCam} bind={bindCapture} />
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
              <div style={sub}>位置</div>
              <Xyz v={scene.camera.position} onChange={(position) => patchCam({ position })} />
              <div style={sub}>注视目标</div>
              <select value={scene.camera.lookAtActorId ?? ""} onChange={(e) => lookAtActor(e.target.value || undefined)}
                style={{ width: "100%", padding: "4px 6px", fontSize: 11, background: "var(--c-input)", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 6, marginBottom: 6 }}>
                <option value="">手动坐标</option>
                {scene.actors.map((a) => <option key={a.id} value={a.id}>对准 {a.name}</option>)}
              </select>
              <Xyz v={scene.camera.target} onChange={(target) => patchCam({ target, lookAtActorId: undefined })} />
              <p style={hint}>在画面里拖拽即转动当前机位；松手自动记录。多机位便于一套场景出多个分镜角度。</p>
            </div>
          ) : selectedGroup ? (
            <div style={panel}>
              <input value={selectedGroup.name} onChange={(e) => patchGroup(selectedGroup.id, { name: e.target.value })}
                style={{ ...ttl, width: "100%", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 6, padding: "4px 6px" }} />
              <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginBottom: 6 }}>{selectedGroup.cols}×{selectedGroup.rows} = {selectedGroup.rows * selectedGroup.cols} 个成员（整组变换）</div>
              <div style={sub}>整组位置</div>
              <Xyz v={selectedGroup.position} onChange={(position) => patchGroup(selectedGroup.id, { position })} />
              <div style={sub}>整组旋转(°)</div>
              <Xyz v={selectedGroup.rotation} step={1} fixed={0} onChange={(rotation) => patchGroup(selectedGroup.id, { rotation })} />
              <div style={sub}>统一缩放</div>
              <DragNumber label="比例" value={selectedGroup.scale} step={0.02} onChange={(v) => patchGroup(selectedGroup.id, { scale: Math.max(0.2, Math.min(3, v)) })} />
              <div style={sub}>组配色</div>
              <input type="color" value={selectedGroup.color} onChange={(e) => { const color = e.target.value; patchGroup(selectedGroup.id, { color }); setScene((s) => ({ ...s, actors: s.actors.map((a) => (a.groupId === selectedGroup.id ? { ...a, color } : a)) })); }} style={{ width: "100%", height: 28, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
              <div className="flex gap-1" style={{ marginTop: 10 }}>
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
                  <Xyz v={selected.position} onChange={(position) => patchActor(selected.id, { position })} />
                  <div style={sub}>旋转(°)</div>
                  <Xyz v={selected.rotation} step={1} fixed={0} onChange={(rotation) => patchActor(selected.id, { rotation })} />
                  <div style={sub}>缩放</div>
                  <DragNumber label="比例" value={selected.scale} step={0.02} onChange={(v) => patchActor(selected.id, { scale: Math.max(0.2, Math.min(3, v)) })} />
                  <div style={sub}>颜色</div>
                  <input type="color" value={selected.color} onChange={(e) => patchActor(selected.id, { color: e.target.value })} style={{ width: "100%", height: 28, background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, cursor: "pointer" }} />
                </>
              ) : (
                <>
                  <div style={sub}>动作预设</div>
                  <div className="flex flex-wrap gap-1">
                    {POSE_PRESETS.map((p) => (
                      <button key={p.key} onClick={() => patchActor(selected.id, { pose: applyPosePreset(p.key) })} style={{ ...chip, fontSize: 10.5 }}>{p.label}</button>
                    ))}
                  </div>
                  {JOINT_GROUPS.map((g) => (
                    <div key={g.group}>
                      <div style={sub}>{g.group}</div>
                      <div className="flex flex-col gap-1">
                        {g.joints.map((j) => (
                          <DragNumber key={j.key} label={j.label} value={selected.pose?.[j.key] ?? 0} step={1} fixed={0} suffix="°"
                            onChange={(v) => patchActor(selected.id, { pose: { ...(selected.pose ?? {}), [j.key]: Math.max(j.min, Math.min(j.max, Math.round(v))) } })} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => patchActor(selected.id, { pose: {} })} style={{ ...chip, justifyContent: "center", marginTop: 8 }}>清空姿势（归零）</button>
                  <p style={hint}>摆个大概即可——AI 会脑补动作细节。提示词强调「人物姿态与参考图一致」。</p>
                </>
              )}
            </div>
          ) : (
            <div style={{ ...panel, color: "var(--c-t4)", fontSize: 12 }}>
              点选左侧图层或画面中的人偶/机位进行编辑。<br /><br />
              工作流：摆好站位与机位 → 「截图 → 参考图」→ 连到生图/视频节点，提示词里强调「人物站位与参考图一致」。
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

// ── 小样式/子组件 ─────────────────────────────────────────────────────────────
const ttl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--c-t1)", marginBottom: 8 };
const sub: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "8px 0 4px" };
const hint: React.CSSProperties = { fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5, marginTop: 10 };
const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "3px 7px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-surface)", color: "var(--c-t3)", cursor: "pointer" };
function rowBtn(active: boolean): React.CSSProperties {
  return { display: "flex", alignItems: "center", textAlign: "left", fontSize: 12, padding: "6px 9px", borderRadius: 8, cursor: "pointer", border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`, background: active ? "color-mix(in oklch, var(--ui-accent, var(--c-accent)) 16%, transparent)" : "var(--c-surface)", color: "var(--c-t2)", width: "100%" };
}
function Xyz({ v, onChange, step = 0.05, fixed = 2 }: { v: Vec3; onChange: (v: Vec3) => void; step?: number; fixed?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {(["X", "Y", "Z"] as const).map((ax, i) => (
        <DragNumber key={ax} label={ax} value={v[i]} step={step} fixed={fixed}
          onChange={(nv) => { const c = [...v] as Vec3; c[i] = nv; onChange(c); }} />
      ))}
    </div>
  );
}
