import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Object3D } from "three";
import * as THREE from "three";
import { X, Loader2, Sparkles, RotateCcw, Boxes } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── B 档「真 3D 换视角」查看器 ──────────────────────────────────────────────
// 把一张 2D 图交给 Poyo Tripo3D H3.1 图生 3D → 拿回真正的 .glb 网格 → 载入 three.js 用
// OrbitControls **完整 360° 环绕**（真几何，非 A 档的 2.5D 深度位移，无遮挡拉丝天花板）→
// 把当前视角截图作为「结构参考图」送回生成节点，重绘该视角的干净图。
// 生成需数分钟：客户端提交拿 task_id，每 4s 轮询一次，finished 后服务端已把 glb 转存到自有存储。

type CaptureHandle = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };

/** 载入 glb、居中并归一化到约 2.4 个单位（最长边），供 orbit 观察。 */
function GlbMesh({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => scene.clone(true), [scene]);
  const fit = useMemo(() => {
    obj.updateMatrixWorld(true);
    const box = new Box3().setFromObject(obj);
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 2.4 / maxDim;
    return { s, px: -center.x * s, py: -center.y * s, pz: -center.z * s };
  }, [obj]);
  return (
    <group position={[fit.px, fit.py, fit.pz]} scale={fit.s}>
      <primitive object={obj as Object3D} />
    </group>
  );
}

function CaptureBridge({ bind }: { bind: (h: CaptureHandle) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => { bind({ gl, scene, camera }); }, [gl, scene, camera, bind]);
  return null;
}

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = reject;
  r.readAsDataURL(blob);
});

export function Model3DViewer({ sourceImageUrl, onGenerate, onClose }: {
  sourceImageUrl: string;
  /** 「从此视角生成」：回传截图 URL 给调用方去触发再生成。 */
  onGenerate: (capturedViewUrl: string) => void;
  onClose: () => void;
}) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const capRef = useRef<CaptureHandle | null>(null);
  const orbitRef = useRef<{ reset: () => void } | null>(null);
  const submittedRef = useRef(false);

  const submitMut = trpc.poyo.submitImageTo3d.useMutation();
  const uploadMut = trpc.upload.uploadImage.useMutation();

  // 提交图生 3D（StrictMode 双调用用 ref 去重）。
  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    (async () => {
      try {
        const r = await submitMut.mutateAsync({ imageUrl: sourceImageUrl, texture: true });
        setTaskId(r.taskId);
      } catch (e) {
        setErr((e instanceof Error ? e.message : "图生 3D 提交失败") + "\n（需平台已配置 Poyo API Key）");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceImageUrl]);

  // 轮询状态：每 4s 一次，直到拿到 glb 或失败。
  const statusQ = trpc.poyo.status3d.useQuery(
    { taskId: taskId ?? "" },
    { enabled: !!taskId && !glbUrl && !err, refetchInterval: 4000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    const d = statusQ.data;
    if (!d) return;
    if (d.status === "finished") {
      // finished 但无 glb（未挑到模型文件）也要收敛为错误，否则 enabled 恒真会无限轮询。
      if (d.glbUrl) setGlbUrl(d.glbUrl);
      else setErr("生成已完成，但未返回可用的 3D 模型文件");
    } else if (d.status === "failed") setErr(d.error || "图生 3D 失败");
  }, [statusQ.data]);
  const progress = statusQ.data?.progress ?? null;

  const bind = useCallback((h: CaptureHandle) => { capRef.current = h; }, []);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 截当前视角 → 上传 → 回调触发再生成。
  const handleGenerate = useCallback(async () => {
    const cap = capRef.current;
    if (!cap) return;
    setBusy(true);
    try {
      cap.gl.render(cap.scene, cap.camera);
      const blob = await new Promise<Blob | null>((res) => cap.gl.domElement.toBlob(res, "image/png"));
      if (!blob) throw new Error("截图失败（画布可能被跨源纹理污染）");
      const base64 = await blobToBase64(blob);
      const r = await uploadMut.mutateAsync({ base64, mimeType: "image/png", filename: "model3d-view.png" });
      onGenerate(r.url);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }, [uploadMut, onGenerate, onClose]);

  const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff" };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.12)", color: "#fff", flexShrink: 0 }}>
        <Boxes size={16} style={{ color: "#34d399" }} />
        <b style={{ fontSize: 14 }}>真 3D 换视角</b>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>图生 3D 网格（Tripo3D）· 完整 360° 环绕 · 从新视角重绘</span>
        <div style={{ marginLeft: "auto" }} />
        <button onClick={onClose} title="关闭 (Esc)" style={{ ...btn, padding: 8 }}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {err ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ maxWidth: 460, color: "#fca5a5", fontSize: 13, whiteSpace: "pre-wrap", textAlign: "center", lineHeight: 1.6 }}>{err}</div>
          </div>
        ) : !glbUrl ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
            <Loader2 size={22} className="animate-spin" />
            <div>正在把图片生成为真 3D 网格…（Tripo3D，通常需 1–3 分钟）</div>
            {progress != null && (
              <div style={{ width: 240, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(3, Math.min(100, progress))}%`, height: "100%", background: "#34d399", transition: "width 0.4s" }} />
              </div>
            )}
          </div>
        ) : (
          <Canvas
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            camera={{ fov: 40, position: [0, 0.6, 4], near: 0.01, far: 100 }}
            style={{ position: "absolute", inset: 0 }}
          >
            <color attach="background" args={["#0b0d12"]} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[4, 6, 5]} intensity={1.2} />
            <directionalLight position={[-5, 3, -4]} intensity={0.5} />
            <Suspense fallback={null}>
              <GlbMesh url={glbUrl} />
            </Suspense>
            <OrbitControls ref={orbitRef as never} enablePan={false} enableDamping minDistance={2} maxDistance={9} />
            <CaptureBridge bind={bind} />
          </Canvas>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.12)", color: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
          {glbUrl ? "拖拽任意角度环绕真 3D 模型，选好视角后重绘" : "生成中，请稍候…"}
        </span>
        <button style={btn} disabled={!glbUrl} onClick={() => orbitRef.current?.reset()}><RotateCcw size={14} /> 复位视角</button>
        <div style={{ marginLeft: "auto" }} />
        <button
          onClick={handleGenerate}
          disabled={!glbUrl || busy}
          style={{ ...btn, background: glbUrl && !busy ? "#059669" : "rgba(5,150,105,0.4)", border: "1px solid #059669", padding: "8px 16px", fontWeight: 600, cursor: glbUrl && !busy ? "pointer" : "not-allowed" }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 从此视角生成
        </button>
      </div>
    </div>,
    document.body,
  );
}
