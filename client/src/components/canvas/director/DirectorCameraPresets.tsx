// #332 导演台动画层批5：相机「预设运镜」面板——12 种运镜预设（环绕/半弧/推近/拉远/
// 升降/横移/螺旋上升 + 手持抖动/甩镜/变焦推/跟随/俯冲）× 替换/追加两种合入模式。
// 纯 UI：点某预设即以当前模式回调 onApply(preset, mode)；base/时长由上层（选中机位）提供。
// 消费 directorTimeline.ts 的 CAMERA_PRESET_LABELS（单一数据源，顺序即展示顺序）。
import { useState } from "react";
import { CAMERA_PRESET_LABELS, type CameraPreset } from "@/lib/directorTimeline";

export interface DirectorCameraPresetsProps {
  disabled?: boolean;                 // 无选中机位/无时间线时禁用
  onApply: (preset: CameraPreset, mode: "replace" | "append") => void;
}

export function DirectorCameraPresets({ disabled, onApply }: DirectorCameraPresetsProps) {
  const [mode, setMode] = useState<"replace" | "append">("replace");

  const modeBtn = (m: "replace" | "append", label: string): React.CSSProperties => ({
    flex: 1, fontSize: 10.5, fontWeight: mode === m ? 700 : 500, padding: "3px 0", borderRadius: 6,
    cursor: "pointer", border: "1px solid var(--c-bd2, #3a3a3a)",
    background: mode === m ? "oklch(0.6 0.16 265 / 0.22)" : "transparent",
    color: mode === m ? "oklch(0.8 0.16 265)" : "var(--c-t3, #999)",
  });

  return (
    <div data-testid="director-camera-presets" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: "var(--c-t2, #ccc)" }}>预设运镜</span>
        <span style={{ fontSize: 9.5, color: "var(--c-t4, #666)" }}>点选即应用</span>
      </div>
      {/* 替换 / 追加 模式（替换=覆盖同通道；追加=接到现有关键帧末尾之后） */}
      <div style={{ display: "flex", gap: 5 }}>
        <button data-testid="preset-mode-replace" title="替换：覆盖该机位同类通道的已有关键帧" onClick={() => setMode("replace")} style={modeBtn("replace", "替换")}>替换</button>
        <button data-testid="preset-mode-append" title="追加：把预设关键帧接到现有末帧之后" onClick={() => setMode("append")} style={modeBtn("append", "追加")}>追加</button>
      </div>
      {/* 12 种预设网格 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
        {CAMERA_PRESET_LABELS.map((p) => (
          <button key={p.key} data-testid={`preset-${p.key}`} title={`${p.label}（${mode === "replace" ? "替换" : "追加"}）`}
            onClick={() => onApply(p.key, mode)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
              padding: "6px 2px", borderRadius: 7, cursor: "pointer",
              border: "1px solid var(--c-bd2, #333)", background: "var(--c-input, #1c1d21)", color: "var(--c-t2, #ccc)",
            }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{p.icon}</span>
            <span style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
