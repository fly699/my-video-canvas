import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { Canvas, useThree, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { X, Loader2, Sparkles, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── 图片「伪 3D 换视角」查看器 ──────────────────────────────────────────────
// 把一张 2D 图深度位移成一张「浮雕网格」（原图贴纹理 + 深度图做顶点位移），用 OrbitControls
// 小幅拖拽预览不同视角，再把当前视角截图作为「结构参考图」送回生成节点，重绘出该视角的干净图。
// 深度来自 ComfyUI 的 DepthAnythingV2 预处理器（复用 extractControlMap）。
// 局限（2.5D 物理天花板）：被遮挡区域无数据，大角度会拉丝/撕裂——故 orbit 角度被夹在小范围内。

type CaptureHandle = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };

/** 深度位移网格：原图贴 emissiveMap（不受光=还原原色），深度图做 displacement。 */
function DepthMesh({ colorUrl, depthUrl, scale, invert }: {
  colorUrl: string; depthUrl: string; scale: number; invert: boolean;
}) {
  const [color, depth] = useLoader(THREE.TextureLoader, [colorUrl, depthUrl]);
  color.colorSpace = THREE.SRGBColorSpace;
  // 平面按图片真实比例（从纹理读），最长边约 2 个单位。细分越高位移越细腻（256×256 顶点）。
  const iw = (color.image as { width?: number })?.width ?? 1;
  const ih = (color.image as { height?: number })?.height ?? 1;
  const aspect = iw / Math.max(1, ih);
  const w = aspect >= 1 ? 2 : 2 * aspect;
  const h = aspect >= 1 ? 2 / aspect : 2;
  const s = invert ? -scale : scale;
  return (
    <mesh>
      <planeGeometry args={[w, h, 256, 256]} />
      <meshStandardMaterial
        map={color}
        emissiveMap={color}
        emissive={0xffffff}
        emissiveIntensity={1}
        displacementMap={depth}
        displacementScale={s}
        displacementBias={-s / 2}
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
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

export function Depth3DViewer({ sourceImageUrl, comfyBaseUrl, onGenerate, onClose }: {
  sourceImageUrl: string;
  /** ComfyUI 自定义地址（ComfyUI 节点才有；图像节点留空走服务端默认）。 */
  comfyBaseUrl?: string;
  /** 「从此视角生成」：回传截图 URL 给调用方去触发再生成。 */
  onGenerate: (capturedViewUrl: string) => void;
  onClose: () => void;
}) {
  const [depthUrl, setDepthUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(0.35);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const capRef = useRef<CaptureHandle | null>(null);
  const orbitRef = useRef<{ reset: () => void } | null>(null);

  const extractMut = trpc.comfyui.extractControlMap.useMutation();
  const uploadMut = trpc.upload.uploadImage.useMutation();

  // P1：取深度图（DepthAnythingV2）。无 ComfyUI / 失败 → 明确报错。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url } = await extractMut.mutateAsync({
          customBaseUrl: comfyBaseUrl?.trim() || undefined,
          sourceImageUrl,
          preprocessor: "DepthAnythingV2Preprocessor",
        });
        if (!cancelled) setDepthUrl(url);
      } catch (e) {
        if (!cancelled) setErr("提取深度失败——需要可用的 ComfyUI 服务器（装有 DepthAnythingV2 / controlnet_aux 插件）。可在 管理后台 →「ComfyUI 服务器」添加并测试。" + (e instanceof Error ? `\n${e.message}` : ""));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceImageUrl, comfyBaseUrl]);

  const bind = useCallback((h: CaptureHandle) => { capRef.current = h; }, []);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // P3+P4：截当前视角 → 上传 → 回调触发再生成。
  const handleGenerate = useCallback(async () => {
    const cap = capRef.current;
    if (!cap) return;
    setBusy(true);
    try {
      cap.gl.render(cap.scene, cap.camera); // 确保捕获的是当前帧
      const blob = await new Promise<Blob | null>((res) => cap.gl.domElement.toBlob(res, "image/png"));
      if (!blob) throw new Error("截图失败（画布可能被跨源图片污染，请用本站存储的图片）");
      const base64 = await blobToBase64(blob);
      const r = await uploadMut.mutateAsync({ base64, mimeType: "image/png", filename: "depth3d-view.png" });
      onGenerate(r.url);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }, [uploadMut, onGenerate, onClose]);

  const clamp = 0.42; // ±~24°，防 2.5D 撕裂
  const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff" };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.9)", display: "flex", flexDirection: "column" }}>
      {/* 顶栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.12)", color: "#fff", flexShrink: 0 }}>
        <Sparkles size={16} style={{ color: "#a78bfa" }} />
        <b style={{ fontSize: 14 }}>3D 换视角</b>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>拖拽旋转（小幅），从新视角重绘</span>
        <div style={{ marginLeft: "auto" }} />
        <button onClick={onClose} title="关闭 (Esc)" style={{ ...btn, padding: 8 }}><X size={16} /></button>
      </div>

      {/* 3D 视口 */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {err ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ maxWidth: 460, color: "#fca5a5", fontSize: 13, whiteSpace: "pre-wrap", textAlign: "center", lineHeight: 1.6 }}>{err}</div>
          </div>
        ) : !depthUrl ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
            <Loader2 size={18} className="animate-spin" /> 正在把图片虚拟化为 3D 深度结构…
          </div>
        ) : (
          <Canvas
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            camera={{ fov: 45, position: [0, 0, 3], near: 0.01, far: 100 }}
            style={{ position: "absolute", inset: 0 }}
          >
            <ambientLight intensity={1} />
            <Suspense fallback={null}>
              <DepthMesh colorUrl={sourceImageUrl} depthUrl={depthUrl} scale={scale} invert={invert} />
            </Suspense>
            <OrbitControls
              ref={orbitRef as never}
              enablePan={false}
              enableDamping
              minDistance={1.5}
              maxDistance={6}
              minPolarAngle={Math.PI / 2 - clamp}
              maxPolarAngle={Math.PI / 2 + clamp}
              minAzimuthAngle={-clamp}
              maxAzimuthAngle={clamp}
            />
            <CaptureBridge bind={bind} />
          </Canvas>
        )}
      </div>

      {/* 底部控制条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.12)", color: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
          立体强度
          <input type="range" min={0} max={1} step={0.01} value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ width: 160 }} disabled={!depthUrl} />
          <span style={{ minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{scale.toFixed(2)}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.8)", cursor: "pointer" }}>
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} disabled={!depthUrl} /> 反转深度
        </label>
        <button style={btn} disabled={!depthUrl} onClick={() => orbitRef.current?.reset()}><RotateCcw size={14} /> 复位视角</button>
        <div style={{ marginLeft: "auto" }} />
        <button
          onClick={handleGenerate}
          disabled={!depthUrl || busy}
          style={{ ...btn, background: depthUrl && !busy ? "#7c3aed" : "rgba(124,58,237,0.4)", border: "1px solid #7c3aed", padding: "8px 16px", fontWeight: 600, cursor: depthUrl && !busy ? "pointer" : "not-allowed" }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 从此视角生成
        </button>
      </div>
    </div>,
    document.body,
  );
}
