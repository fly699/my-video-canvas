import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Camera } from "lucide-react";
import { RigViewfinderPreview } from "./CameraMotionPreview";

/**
 * 摄像机参数选择器（对齐 LibTV 图三）：相机 / 镜头 / 焦距 / 光圈 四列选择，
 * 「应用」把英文拍摄参数片段注入提示词（重复应用先替换旧片段），「清除」移除。
 * 纯提示词注入（与风格库同思路），对图像与视频生成通用。
 */
const CAMERAS = [
  { v: "Red V-Raptor", label: "Red V-Raptor" },
  { v: "ARRI Alexa 65", label: "ARRI Alexa 65" },
  { v: "Sony Venice 2", label: "Sony Venice 2" },
  { v: "Canon C70", label: "Canon C70" },
  { v: "RED Komodo", label: "RED Komodo" },
  { v: "Super 8 film camera", label: "Super 8 胶片机" },
  { v: "IMAX 70mm camera", label: "IMAX 70mm" },
];
const LENSES = [
  { v: "Helios 44-2", label: "Helios（旋焦）" },
  { v: "Zeiss Master Prime", label: "Zeiss Master Prime" },
  { v: "Cooke S4", label: "Cooke S4（柔润）" },
  { v: "Canon FD", label: "Canon FD（复古）" },
  { v: "anamorphic lens", label: "变形宽银幕" },
  { v: "Lensbaby", label: "Lensbaby（梦幻）" },
];
const FOCALS = [14, 24, 35, 50, 75, 85, 135];
const APERTURES = ["1.2", "1.4", "2", "2.8", "4", "5.6", "8", "16"];

/** 已注入片段的识别/清除（应用时先移除旧片段再追加新片段）。 */
const RIG_RE = /(?:[，,]\s*)?shot on [^，,。]+(?:[，,]\s*[^，,。]*? lens)?(?:[，,]\s*\d+mm)?(?:[，,]\s*f\/[\d.]+)?/i;
export function stripCameraRig(prompt: string): string {
  return prompt.replace(RIG_RE, "").replace(/^[，,]\s*/, "").trim();
}
export function buildCameraRig(cam: string, lens: string, focal: number, ap: string): string {
  return `shot on ${cam}，${lens} lens，${focal}mm，f/${ap}`;
}

function Col<T extends string | number>({ title, items, value, onChange, render }: {
  title: string; items: readonly T[]; value: T; onChange: (v: T) => void; render?: (v: T) => string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t3)", textAlign: "center" }}>{title}</div>
      <div className="nowheel" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto", padding: 2 }}>
        {items.map((it) => {
          const active = it === value;
          return (
            <button key={String(it)} onClick={() => onChange(it)}
              style={{ padding: "7px 8px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500, textAlign: "center", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 16%, var(--c-surface))" : "var(--c-surface)",
                border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd2)"}`,
                color: active ? "var(--c-t1)" : "var(--c-t2)" }}>
              {render ? render(it) : String(it)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CameraRigPicker({ active, onApply, onClear, onClose }: {
  /** 当前提示词里是否已有注入片段（决定是否显示「清除」）。 */
  active: boolean;
  onApply: (fragment: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [cam, setCam] = useState(CAMERAS[0].v);
  const [lens, setLens] = useState(LENSES[0].v);
  const [focal, setFocal] = useState(75);
  const [ap, setAp] = useState("1.4");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(640px, 92vw)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--c-bd1)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}><Camera size={15} /> 摄像机</span>
          <button onClick={onClose} title="关闭（Esc）"
            style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t3)", cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          ><X size={14} /></button>
        </div>
        {/* #135 实时取景窗：焦距→推拉、光圈→景深虚化、镜头→宽银幕眩光/渐晕、机身→胶片质感 */}
        <div style={{ padding: "14px 16px 0" }}>
          <RigViewfinderPreview cam={cam} lens={lens} focal={focal} ap={ap} />
        </div>
        <div style={{ display: "flex", gap: 10, padding: 16 }}>
          <Col title="相机" items={CAMERAS.map((c) => c.v)} value={cam} onChange={setCam} render={(v) => CAMERAS.find((c) => c.v === v)?.label ?? v} />
          <Col title="镜头" items={LENSES.map((c) => c.v)} value={lens} onChange={setLens} render={(v) => LENSES.find((c) => c.v === v)?.label ?? v} />
          <Col title="焦距" items={FOCALS} value={focal} onChange={setFocal} render={(v) => `${v} mm`} />
          <Col title="光圈" items={APERTURES} value={ap} onChange={setAp} render={(v) => `f/${v}`} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "0 16px 14px" }}>
          {active && (
            <button onClick={() => { onClear(); onClose(); }}
              style={{ height: 32, padding: "0 14px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
              清除已注入参数
            </button>
          )}
          <button onClick={() => { onApply(buildCameraRig(cam, lens, focal, ap)); onClose(); }}
            style={{ height: 32, padding: "0 18px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, background: "var(--ui-accent, var(--c-accent))", border: "none", color: "#0b0d12", cursor: "pointer" }}>
            应用到提示词
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
