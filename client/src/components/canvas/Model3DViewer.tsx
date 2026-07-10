import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Object3D } from "three";
import * as THREE from "three";
import { X, Loader2, Sparkles, RotateCcw, Boxes, Download, FolderPlus, Check } from "lucide-react";
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

export function Model3DViewer({ sourceImageUrl, initialGlbUrl, projectId, nodeId, savedToLibrary, comfyBaseUrl, onGlbReady, onSavedToLibrary, onGenerate, onClose }: {
  sourceImageUrl: string;
  /** 已生成过的 .glb（宿主节点 payload 持久化）——传入则直接载入，不再花钱重新生成。 */
  initialGlbUrl?: string;
  projectId?: number;
  nodeId?: string;
  /** 已存入过素材库（宿主持久化）——按钮显示「已在素材库」。 */
  savedToLibrary?: boolean;
  /** 混元 3D（本机 ComfyUI）引擎用的自定义地址（ComfyUI 节点才有；留空走全局默认）。 */
  comfyBaseUrl?: string;
  /** 生成完成回调：宿主把 glbUrl 写进节点 payload 持久化，下次免费重开。 */
  onGlbReady?: (glbUrl: string) => void;
  /** 存入素材库成功回调：宿主持久化标记。 */
  onSavedToLibrary?: () => void;
  /** 「从此视角生成」：回传截图 URL 给调用方去触发再生成。 */
  onGenerate: (capturedViewUrl: string) => void;
  onClose: () => void;
}) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(initialGlbUrl ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!savedToLibrary);
  const capRef = useRef<CaptureHandle | null>(null);
  const orbitRef = useRef<{ reset: () => void } | null>(null);
  const submittedRef = useRef(false);

  const submitMut = trpc.poyo.submitImageTo3d.useMutation();
  const uploadMut = trpc.upload.uploadImage.useMutation();
  const saveMut = trpc.poyo.save3dToLibrary.useMutation();
  const hunyuanMut = trpc.comfyui.imageTo3d.useMutation();
  // 引擎选择：null = 未选（显示选择界面）；记住上次选择。已有持久化模型时无需选择。
  const [engine, setEngine] = useState<"tripo" | "hunyuan" | null>(() =>
    initialGlbUrl ? "tripo" : null);

  // 提交图生 3D（StrictMode 双调用用 ref 去重）。已有持久化模型 → 直接复用，不再提交；
  // 未选引擎（选择界面）不提交。
  useEffect(() => {
    if (initialGlbUrl || engine !== "tripo" || submittedRef.current) return;
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
  }, [sourceImageUrl, engine]);

  // 混元 3D（本机 ComfyUI）：单次调用直至完成（内网短链路；1~10 分钟视显存）。
  const startHunyuan = async () => {
    setEngine("hunyuan");
    try { localStorage.setItem("avc:model3d:engine", "hunyuan"); } catch { /* ignore */ }
    try {
      const r = await hunyuanMut.mutateAsync({ sourceImageUrl, customBaseUrl: comfyBaseUrl?.trim() || undefined });
      setGlbUrl(r.glbUrl);
      onGlbReady?.(r.glbUrl);
      if (r.volatile) toast.warning("对象存储不可用：模型暂用 ComfyUI 直链（其输出目录清理后会失效），建议配置 MinIO/S3 后重新生成。");
    } catch (e) {
      setErr((e instanceof Error ? e.message : "混元 3D 生成失败") + "\n（需 ComfyUI 装有 Hunyuan3DWrapper 插件；默认工作流不匹配时可用 HUNYUAN3D_WORKFLOW_JSON 环境变量替换）");
    }
  };
  const startTripo = () => {
    setEngine("tripo");
    try { localStorage.setItem("avc:model3d:engine", "tripo"); } catch { /* ignore */ }
  };

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
      if (d.glbUrl) {
        setGlbUrl(d.glbUrl);
        onGlbReady?.(d.glbUrl); // 宿主持久化——关闭后可免费重开
      } else setErr("生成已完成，但未返回可用的 3D 模型文件");
    } else if (d.status === "failed") setErr(d.error || "图生 3D 失败");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQ.data]);

  // 导出 .glb：fetch → blob 下载（跨源 a[download] 会被忽略，统一走 blob 保证落盘）。
  const handleExport = useCallback(async () => {
    if (!glbUrl) return;
    try {
      const res = await fetch(glbUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      const o = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = o; a.download = "model3d.glb"; a.click();
      setTimeout(() => URL.revokeObjectURL(o), 30_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    }
  }, [glbUrl]);

  // 存入素材库（type=other）：下次可在素材库下载/复用；服务端按 storageKey 去重。
  const handleSaveToLibrary = useCallback(async () => {
    if (!glbUrl || saving || saved) return;
    setSaving(true);
    try {
      await saveMut.mutateAsync({ glbUrl, projectId, nodeId, name: "真3D模型" });
      setSaved(true);
      onSavedToLibrary?.();
      toast.success("已存入素材库（类型：其他文件）");
    } catch (e) {
      toast.error("存入素材库失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setSaving(false);
    }
  }, [glbUrl, saving, saved, saveMut, projectId, nodeId, onSavedToLibrary]);
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
        ) : !glbUrl && engine === null ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "rgba(255,255,255,0.85)", fontSize: 13 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>选择 3D 生成引擎</div>
            <button onClick={startTripo} style={{ width: 320, textAlign: "left", padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.12)", color: "#fff", cursor: "pointer" }}>
              <div style={{ fontWeight: 700 }}>Tripo3D（云端）</div>
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginTop: 3 }}>质量稳定 · 约消耗 30–60 credits · 1–3 分钟</div>
            </button>
            <button onClick={() => void startHunyuan()} style={{ width: 320, textAlign: "left", padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(167,139,250,0.5)", background: "rgba(167,139,250,0.12)", color: "#fff", cursor: "pointer" }}>
              <div style={{ fontWeight: 700 }}>混元 3D（本机 ComfyUI）</div>
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginTop: 3 }}>免费 · 需装 Hunyuan3DWrapper 插件 · 1–10 分钟视显存</div>
            </button>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>生成结果都会随节点保存，之后免费重开</div>
          </div>
        ) : !glbUrl ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
            <Loader2 size={22} className="animate-spin" />
            <div>{engine === "hunyuan" ? "本机 ComfyUI 混元 3D 生成中…（1–10 分钟视显存）" : "正在把图片生成为真 3D 网格…（Tripo3D，通常需 1–3 分钟）"}</div>
            {engine === "tripo" && progress != null && (
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
          {glbUrl ? "拖拽任意角度环绕真 3D 模型，选好视角后重绘（模型已随节点保存，关闭后可重开）" : engine === null ? "选择上方任一引擎开始生成" : "生成中，请稍候…"}
        </span>
        <button style={btn} disabled={!glbUrl} onClick={() => orbitRef.current?.reset()}><RotateCcw size={14} /> 复位视角</button>
        <button style={btn} disabled={!glbUrl} onClick={handleExport} title="下载 .glb 文件（可导入 Blender/UE 等）"><Download size={14} /> 导出 GLB</button>
        <button
          style={{ ...btn, opacity: saved ? 0.7 : 1 }}
          disabled={!glbUrl || saving || saved}
          onClick={handleSaveToLibrary}
          title={saved ? "已在素材库中" : "存入素材库，下次可直接下载/复用"}
        >
          {saved ? <Check size={14} /> : saving ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
          {saved ? " 已在素材库" : " 存入素材库"}
        </button>
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
