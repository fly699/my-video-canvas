// 剪辑器快捷键速查面板（? 开关 / Esc 关闭）：
// 上半部分是「键盘全键图」，下半部分是按组分列的快捷键清单——鼠标悬停某条功能时，
// 键盘图上对应的键位实时高亮（含修饰键 Ctrl/Shift/Alt 与方向键/编辑键区）。
// 键位设置对齐剪映（Ctrl+B 分割 / Q W 左右裁剪 / Ctrl+C X V 拷剪贴 / Ctrl+E 导出 /
// Ctrl+F 全屏预览 / Space 播放 / ←→ 逐帧 / Ctrl+Z 撤销 等），并保留本编辑器原有键位。
import { useState } from "react";
import { EC } from "./theme";

const ACCENT = "oklch(0.65 0.19 310)";

/** 一条快捷键：keys 为键盘图高亮 token（标准化 id，见 KEY_ROWS），desc 为功能名。
 *  jy=剪映同款键位（清单里加标记）。keys 为空 = 鼠标操作（不高亮键盘）。 */
interface SC { keys: string[]; label: string; desc: string; jy?: boolean }

const GROUPS: { group: string; items: SC[] }[] = [
  {
    group: "播放 / 定位",
    items: [
      { keys: ["SPACE"], label: "空格", desc: "播放 / 暂停（播完再按自动从头播）", jy: true },
      { keys: ["LEFT", "RIGHT"], label: "← / →", desc: "上一帧 / 下一帧", jy: true },
      { keys: ["SHIFT", "LEFT", "RIGHT"], label: "Shift + ←/→", desc: "一次跳 10 帧" },
      { keys: ["HOME"], label: "Home", desc: "跳到开头" },
      { keys: ["END"], label: "End", desc: "跳到结尾" },
      { keys: ["CTRL", "F"], label: "Ctrl + F", desc: "全屏预览", jy: true },
    ],
  },
  {
    group: "分割 / 裁剪",
    items: [
      { keys: ["CTRL", "B"], label: "Ctrl + B", desc: "在播放头分割选中片段", jy: true },
      { keys: ["S"], label: "S", desc: "分割（本编辑器同义键）" },
      { keys: ["SHIFT", "S"], label: "Shift + S", desc: "全轨分割（切所有轨道）" },
      { keys: ["Q"], label: "Q", desc: "向左裁剪（裁掉播放头左侧）", jy: true },
      { keys: ["W"], label: "W", desc: "向右裁剪（裁掉播放头右侧）", jy: true },
      { keys: ["M"], label: "M", desc: "合并相邻同源片段" },
      { keys: ["SHIFT", "M"], label: "Shift + M", desc: "波纹合并（容忍间隙 + 紧凑排布）" },
    ],
  },
  {
    group: "编辑",
    items: [
      { keys: ["CTRL", "C"], label: "Ctrl + C", desc: "复制选中片段", jy: true },
      { keys: ["CTRL", "X"], label: "Ctrl + X", desc: "剪切选中片段", jy: true },
      { keys: ["CTRL", "V"], label: "Ctrl + V", desc: "粘贴到播放头", jy: true },
      { keys: ["CTRL", "D"], label: "Ctrl + D", desc: "原地复制片段" },
      { keys: ["DEL", "BACKSPACE"], label: "Del / Backspace", desc: "删除选中片段", jy: true },
      { keys: ["SHIFT", "DEL"], label: "Shift + Del", desc: "波纹删除（关闭缺口）" },
      { keys: ["COMMA", "PERIOD"], label: ", / .", desc: "逐帧微移所选（Shift = 5 帧）" },
    ],
  },
  {
    group: "选择 / 历史",
    items: [
      { keys: ["CTRL", "A"], label: "Ctrl + A", desc: "全选所有片段", jy: true },
      { keys: [], label: "Shift/Ctrl + 点击", desc: "加选 / 减选片段" },
      { keys: [], label: "空白处拖拽", desc: "框选多个片段" },
      { keys: ["CTRL", "Z"], label: "Ctrl + Z", desc: "撤销", jy: true },
      { keys: ["CTRL", "SHIFT", "Z"], label: "Ctrl + Shift + Z", desc: "恢复（重做）", jy: true },
      { keys: ["CTRL", "Y"], label: "Ctrl + Y", desc: "重做（Windows）" },
    ],
  },
  {
    group: "标记 / 淡变",
    items: [
      { keys: ["K"], label: "K", desc: "在播放头打标记点（卡点旗标）" },
      { keys: [], label: "点击标尺旗标", desc: "播放头跳到该标记点" },
      { keys: [], label: "右键标尺旗标", desc: "删除该标记点" },
      { keys: [], label: "拖选中片段顶角三角", desc: "淡入 / 淡出时长" },
    ],
  },
  {
    group: "时间轴鼠标操作",
    items: [
      { keys: [], label: "拖动片段", desc: "移动位置 / 拖到其它轨道（换轨）" },
      { keys: [], label: "拖片段两端", desc: "裁切（调整入点 / 出点）" },
      { keys: ["SHIFT"], label: "Shift + 滚轮", desc: "缩放时间轴（以鼠标处为锚点）" },
      { keys: [], label: "素材卡拖入 / ＋", desc: "素材加入时间轴（插入到播放头）" },
    ],
  },
  {
    group: "导出 / 面板",
    items: [
      { keys: ["CTRL", "E"], label: "Ctrl + E", desc: "打开 / 关闭导出设置", jy: true },
      { keys: ["SHIFT", "SLASH"], label: "?", desc: "开关本速查面板" },
      { keys: ["ESC"], label: "Esc", desc: "关闭浮层 / 本面板" },
    ],
  },
];

/** 键盘全键图布局：每键 {id(高亮 token), label, w(相对宽度)}。 */
type KeyDef = { id: string; label: string; w?: number };
const KEY_ROWS: KeyDef[][] = [
  [
    { id: "ESC", label: "Esc", w: 1.3 }, { id: "BACKQUOTE", label: "`" },
    { id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }, { id: "4", label: "4" },
    { id: "5", label: "5" }, { id: "6", label: "6" }, { id: "7", label: "7" }, { id: "8", label: "8" },
    { id: "9", label: "9" }, { id: "0", label: "0" }, { id: "MINUS", label: "-" }, { id: "EQUAL", label: "=" },
    { id: "BACKSPACE", label: "⌫", w: 1.7 },
  ],
  [
    { id: "TAB", label: "Tab", w: 1.6 },
    { id: "Q", label: "Q" }, { id: "W", label: "W" }, { id: "E", label: "E" }, { id: "R", label: "R" },
    { id: "T", label: "T" }, { id: "Y", label: "Y" }, { id: "U", label: "U" }, { id: "I", label: "I" },
    { id: "O", label: "O" }, { id: "P", label: "P" }, { id: "LBRACKET", label: "[" }, { id: "RBRACKET", label: "]" },
    { id: "BACKSLASH", label: "\\", w: 1.4 },
  ],
  [
    { id: "CAPS", label: "Caps", w: 1.9 },
    { id: "A", label: "A" }, { id: "S", label: "S" }, { id: "D", label: "D" }, { id: "F", label: "F" },
    { id: "G", label: "G" }, { id: "H", label: "H" }, { id: "J", label: "J" }, { id: "K", label: "K" },
    { id: "L", label: "L" }, { id: "SEMI", label: ";" }, { id: "QUOTE", label: "'" },
    { id: "ENTER", label: "Enter", w: 1.9 },
  ],
  [
    { id: "SHIFT", label: "Shift", w: 2.4 },
    { id: "Z", label: "Z" }, { id: "X", label: "X" }, { id: "C", label: "C" }, { id: "V", label: "V" },
    { id: "B", label: "B" }, { id: "N", label: "N" }, { id: "M", label: "M" },
    { id: "COMMA", label: "," }, { id: "PERIOD", label: "." }, { id: "SLASH", label: "/" },
    { id: "SHIFT", label: "Shift", w: 2.4 },
  ],
  [
    { id: "CTRL", label: "Ctrl", w: 1.6 }, { id: "ALT", label: "Alt", w: 1.4 },
    { id: "SPACE", label: "空格", w: 7.2 },
    { id: "ALT", label: "Alt", w: 1.4 }, { id: "CTRL", label: "Ctrl", w: 1.6 },
  ],
];
// 右侧编辑/导航键区（Home/End/Del + 方向键）
const NAV_ROWS: KeyDef[][] = [
  [{ id: "HOME", label: "Home" }, { id: "END", label: "End" }, { id: "DEL", label: "Del" }],
  [{ id: "_", label: "" }, { id: "UP", label: "↑" }, { id: "_", label: "" }],
  [{ id: "LEFT", label: "←" }, { id: "DOWN", label: "↓" }, { id: "RIGHT", label: "→" }],
];

function Key({ k, hl }: { k: KeyDef; hl: Set<string> }) {
  const on = k.id !== "_" && hl.has(k.id);
  return (
    <div style={{
      flex: k.w ?? 1, minWidth: 0, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: 5, fontSize: 9.5, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden",
      visibility: k.id === "_" ? "hidden" : undefined,
      border: `1px solid ${on ? ACCENT : EC.border}`,
      background: on ? `color-mix(in oklch, ${ACCENT} 26%, transparent)` : EC.elevated,
      color: on ? ACCENT : EC.t3,
      fontWeight: on ? 800 : 500,
      boxShadow: on ? `0 0 8px color-mix(in oklch, ${ACCENT} 45%, transparent)` : "none",
      transition: "all 100ms",
    }}>{k.label}</div>
  );
}

export function EditorShortcutsPanel() {
  const [hl, setHl] = useState<Set<string>>(new Set());
  const hover = (keys: string[]) => setHl(new Set(keys));

  return (
    <div
      style={{
        position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, width: 720, maxWidth: "calc(100vw - 32px)",
        // 键盘图始终悬浮在顶部：外层不滚动（flex 列），只让下方清单区滚动。
        maxHeight: "min(76vh, 780px)", display: "flex", flexDirection: "column",
        borderRadius: 16, padding: 16,
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        backdropFilter: "blur(24px)", border: `1px solid ${EC.border}`,
        boxShadow: "0 16px 48px oklch(0 0 0 / 0.55), 0 4px 12px oklch(0 0 0 / 0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: EC.t4, margin: 0 }}>剪辑器快捷键（对齐剪映）</p>
        <span style={{ fontSize: 10, color: EC.t4 }}>· 鼠标移到功能上，下方键盘图对应键位会高亮 · <span style={{ color: ACCENT }}>●</span> = 剪映同款键位</span>
      </div>

      {/* 键盘全键图（主键区 + 编辑/导航键区）——固定不随清单滚动 */}
      <div style={{ flexShrink: 0, display: "flex", gap: 10, marginBottom: 14, padding: 10, borderRadius: 12, background: "oklch(0 0 0 / 0.18)", border: `1px solid ${EC.border}` }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {KEY_ROWS.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              {row.map((k, j) => <Key key={`${k.id}-${j}`} k={k} hl={hl} />)}
            </div>
          ))}
        </div>
        <div style={{ width: 118, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, justifyContent: "flex-end" }}>
          {NAV_ROWS.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              {row.map((k, j) => <Key key={`${k.id}-${j}`} k={k} hl={hl} />)}
            </div>
          ))}
        </div>
      </div>

      {/* 分组快捷键清单（两列；悬停行 → 键盘高亮）——仅此区滚动，键盘图常驻可见 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px", overflowY: "auto", minHeight: 0 }} onMouseLeave={() => setHl(new Set())}>
        {GROUPS.map(({ group, items }) => (
          <div key={group} style={{ marginBottom: 12, breakInside: "avoid" }}>
            <p style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, color: EC.t4 }}>{group}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {items.map((sc) => {
                const active = sc.keys.length > 0 && sc.keys.every((k) => hl.has(k)) && hl.size === sc.keys.length;
                return (
                  <div
                    key={sc.label + sc.desc}
                    onMouseEnter={() => hover(sc.keys)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      padding: "3px 6px", borderRadius: 6, cursor: "default",
                      background: active ? `color-mix(in oklch, ${ACCENT} 10%, transparent)` : "transparent",
                    }}
                  >
                    <span style={{ fontSize: 11, color: EC.t2, display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sc.jy && <span title="剪映同款键位" style={{ color: ACCENT, fontSize: 7, flexShrink: 0 }}>●</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{sc.desc}</span>
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, padding: "1px 6px", borderRadius: 6, background: EC.elevated, border: `1px solid ${active ? ACCENT : "var(--c-bd3, " + EC.border + ")"}`, color: active ? ACCENT : "oklch(0.72 0.12 285)", whiteSpace: "nowrap", flexShrink: 0 }}>{sc.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
