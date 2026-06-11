/**
 * 全屏动态氛围背景 — 点阵网格 + 三团缓慢漂移的极光渐变 + 顶部光晕 + 底部渐隐。
 * 纯 CSS 动画（aurora-* 关键帧见 index.css）、pointer-events:none，
 * 深 / 浅主题均适用（低透明度品牌色），prefers-reduced-motion 下自动静止。
 */
export function AuroraBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* 点阵网格 */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.55]"
        xmlns="http://www.w3.org/2000/svg"
        style={{ color: "var(--c-bd2)" }}
      >
        <defs>
          <pattern id="avc-dot-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#avc-dot-grid)" />
      </svg>

      {/* 极光光团（漂移） */}
      <div className="aurora-blob aurora-blob-a" />
      <div className="aurora-blob aurora-blob-b" />
      <div className="aurora-blob aurora-blob-c" />

      {/* 顶部光晕 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 50% -12%, oklch(0.68 0.22 285 / 0.12) 0%, transparent 70%)",
        }}
      />

      {/* 底部渐隐 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-64"
        style={{ background: "linear-gradient(to top, var(--c-canvas), transparent)" }}
      />
    </div>
  );
}
