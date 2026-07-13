import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { X, Camera, Loader2, PersonStanding, Clapperboard } from "lucide-react";
import { HumanModel } from "./director/HumanModel";
import { POSE_PRESETS, applyPosePreset } from "../../lib/directorPose";
import type { DirectorActor, StoryboardNodeData, ReferenceImage } from "../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { normalizeRefImages, refPatch, makeRefImage } from "../../lib/referenceImages";

/**
 * #100 姿势库选择器：把导演台的 22 款姿势预设开放给姿势控制节点——
 * 3D 人偶实时摆姿（可拖拽换角度）→ 截图上传 → 作为姿势控制的参考构图图像。
 * 复用 director/HumanModel + directorPose（骨骼轴向已真机校准），零重复实现。
 */
export function PosePresetPicker({ onApply, onClose }: { onApply: (url: string) => void; onClose: () => void }) {
  const [presetKey, setPresetKey] = useState("stand");
  const wrapRef = useRef<HTMLDivElement>(null);
  const uploadMut = trpc.upload.uploadImage.useMutation();
  const actor: DirectorActor = {
    id: "pose-preview", name: "姿势", model: "male",
    position: [0, 0, 0], rotation: [0, 0, 0], scale: 1,
    color: "#9db4d0", pose: applyPosePreset(presetKey),
  };
  // #111 姿势截图直通分镜：画布上有分镜节点时，展示「应用到分镜」行——截图直接
  // 写入所选分镜的参考图（referenceImages 追加 + [0] 镜像 referenceImageUrl），
  // 省去「下载再手动上传」。打开时快照一次即可（弹窗生命周期内画布不会变）。
  const storyboards = useMemo(() => {
    return useCanvasStore.getState().nodes
      .filter((n) => n.data.nodeType === "storyboard")
      .map((n) => {
        const p = n.data.payload as StoryboardNodeData;
        const sn = p.sceneNumber != null && `${p.sceneNumber}`.trim() !== "" ? `分镜 ${p.sceneNumber}` : (n.data.title || "分镜");
        const desc = (p.description ?? "").trim();
        return { id: n.id, selected: !!n.selected, label: desc ? `${sn} · ${desc.slice(0, 16)}${desc.length > 16 ? "…" : ""}` : sn };
      });
  }, []);
  const [sbTarget, setSbTarget] = useState(() => storyboards.find((s) => s.selected)?.id ?? storyboards[0]?.id ?? "");

  // 截图 → 上传，返回 URL（失败返回 null 并已 toast）。两个应用入口共用。
  const captureUpload = async (): Promise<string | null> => {
    const cv = wrapRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!cv) { toast.error("3D 视图未就绪，请稍候再试"); return null; }
    const base64 = cv.toDataURL("image/png").split(",")[1];
    if (!base64) { toast.error("截图失败"); return null; }
    const r = await uploadMut.mutateAsync({ base64, mimeType: "image/png", filename: `pose-${presetKey}.png` });
    return r.url;
  };
  const capture = async () => {
    if (uploadMut.isPending) return;
    try {
      const url = await captureUpload();
      if (!url) return;
      onApply(url);
      toast.success(`已用「${POSE_PRESETS.find((p) => p.key === presetKey)?.label ?? presetKey}」姿势截图作参考构图`);
      onClose();
    } catch (e) { toast.error("截图上传失败：" + (e instanceof Error ? e.message : String(e))); }
  };
  const applyToStoryboard = async () => {
    if (uploadMut.isPending || !sbTarget) return;
    try {
      const url = await captureUpload();
      if (!url) return;
      const st = useCanvasStore.getState();
      const node = st.nodes.find((n) => n.id === sbTarget);
      if (!node) { toast.error("目标分镜不存在（可能已被删除）"); return; }
      const cur = normalizeRefImages(node.data.payload as { referenceImageUrl?: string; referenceImages?: ReferenceImage[] });
      st.updateNodeData(sbTarget, refPatch([...cur, makeRefImage(url, "url")]));
      const label = storyboards.find((s) => s.id === sbTarget)?.label ?? "分镜";
      toast.success(`姿势截图已加入「${label}」的参考图`);
      onClose();
    } catch (e) { toast.error("截图上传失败：" + (e instanceof Error ? e.message : String(e))); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(640px, 94vw)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--c-bd1)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>
            <PersonStanding size={15} /> 姿势库（导演台 22 款预设）
          </span>
          <button onClick={onClose} title="关闭"
            style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t3)", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, padding: 14, minHeight: 0 }}>
          {/* 姿势预设列表 */}
          <div className="nowheel" style={{ width: 128, maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
            {POSE_PRESETS.map((p) => {
              const active = p.key === presetKey;
              return (
                <button key={p.key} onClick={() => setPresetKey(p.key)}
                  style={{ padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500, textAlign: "left", cursor: "pointer",
                    background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 16%, var(--c-surface))" : "var(--c-surface)",
                    border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
                    color: active ? "var(--c-t1)" : "var(--c-t2)" }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          {/* 3D 摆姿视口（可拖拽换角度；preserveDrawingBuffer 供截图） */}
          <div ref={wrapRef} style={{ flex: 1, height: 400, background: "#14161c", borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd1)" }}>
            <Canvas dpr={1.5} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [0, 1.2, 3.4], fov: 45 }}>
              <color attach="background" args={["#14161c"]} />
              <ambientLight intensity={0.85} />
              <directionalLight position={[3, 6, 4]} intensity={1.2} />
              <directionalLight position={[-4, 3, -3]} intensity={0.45} />
              <HumanModel actor={actor} selected={false} />
              <gridHelper args={[8, 16, "#2a2f3a", "#20242e"]} />
              <OrbitControls target={[0, 0.95, 0]} enablePan={false} minDistance={1.4} maxDistance={7} />
            </Canvas>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 14px" }}>
          <span style={{ fontSize: 10.5, color: "var(--c-t4)", flex: 1 }}>拖拽视口换角度、滚轮缩放——截图即为姿势控制的参考构图</span>
          <button onClick={() => void capture()} disabled={uploadMut.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, background: "var(--ui-accent, var(--c-accent))", border: "none", color: "#0b0d12", cursor: uploadMut.isPending ? "not-allowed" : "pointer" }}>
            {uploadMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
            用当前姿势作参考
          </button>
        </div>
        {/* #111 直通分镜：截图直接写入所选分镜的参考图（追加，不覆盖已有参考） */}
        {storyboards.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 14px", borderTop: "1px solid var(--c-bd1)", paddingTop: 12 }}>
            <Clapperboard size={13} style={{ color: "var(--c-t3)", flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t2)", whiteSpace: "nowrap", flexShrink: 0 }}>应用到分镜</span>
            <select
              value={sbTarget}
              onChange={(e) => setSbTarget(e.target.value)}
              title="选择要接收姿势截图的分镜节点（截图追加进其参考图列表）"
              style={{ flex: 1, minWidth: 0, height: 30, padding: "0 8px", borderRadius: 8, fontSize: 11.5, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}>
              {storyboards.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button onClick={() => void applyToStoryboard()} disabled={uploadMut.isPending}
              title="用当前姿势截图，直接写入所选分镜节点的参考图（无需下载再上传）"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 13px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "var(--c-surface)", border: "1px solid var(--ui-accent, var(--c-accent))", color: "var(--ui-accent, var(--c-accent))", cursor: uploadMut.isPending ? "not-allowed" : "pointer", flexShrink: 0 }}>
              {uploadMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
              截图并应用
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
