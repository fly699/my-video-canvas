import { useId } from "react";

/**
 * 品牌动画 Logo — 纯 SVG 矢量动画。
 * 元素：渐变描边底板 + 旋转流转的品牌渐变（SMIL）+ 虚线轨道 + 轨道粒子
 * （CSS 动画，见 index.css 的 blg-* 关键帧）+ 呼吸播放三角 + 星闪。
 * 替代静态的 /chat-icon.svg，用于首页 / 管理后台等品牌位。
 */
export function BrandLogo({ size = 28, className }: { size?: number; className?: string }) {
  // 同页多实例时 SVG 渐变/滤镜 id 必须唯一，否则 url(#…) 互相串引。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const g = `blg-g-${uid}`;
  const bg = `blg-bg-${uid}`;
  const glow = `blg-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="AI Video Canvas"
    >
      <defs>
        <linearGradient id={g} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="45%" stopColor="#7c5cfc" />
          <stop offset="100%" stopColor="#e879f9" />
          {/* 渐变绕中心缓慢旋转 — 流光效果 */}
          <animateTransform
            attributeName="gradientTransform"
            type="rotate"
            from="0 32 32"
            to="360 32 32"
            dur="8s"
            repeatCount="indefinite"
          />
        </linearGradient>
        <radialGradient id={bg} cx="30%" cy="20%" r="95%">
          <stop offset="0%" stopColor="#1c1632" />
          <stop offset="100%" stopColor="#0b0a13" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 底板 + 渐变描边 */}
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${bg})`} />
      <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="15.25" stroke={`url(#${g})`} strokeWidth="1.5" opacity="0.9" />

      {/* 虚线内轨道（缓慢自转） */}
      <circle
        cx="32" cy="32" r="19"
        stroke={`url(#${g})`} strokeWidth="1.2"
        strokeDasharray="4 5" strokeLinecap="round"
        opacity="0.55"
        className="blg-spin-slow"
      />

      {/* 左侧帧线 — 影片/时间轴隐喻 */}
      <rect x="18" y="23" width="3" height="18" rx="1.5" fill={`url(#${g})`} opacity="0.85" />

      {/* 播放三角（呼吸光晕） */}
      <g className="blg-pulse" filter={`url(#${glow})`}>
        <path
          d="M27 22.6c0-1.93 2.08-3.13 3.74-2.15l14.4 8.5c1.63.96 1.63 3.32 0 4.28l-14.4 8.5c-1.66.98-3.74-.22-3.74-2.15V22.6z"
          fill={`url(#${g})`}
        />
      </g>

      {/* 轨道粒子（正反双轨） */}
      <g className="blg-orbit">
        <circle cx="32" cy="13" r="2" fill="#ffffff" filter={`url(#${glow})`} />
      </g>
      <g className="blg-orbit-rev">
        <circle cx="51" cy="32" r="1.3" fill="#22d3ee" />
      </g>

      {/* 星闪 */}
      <path
        className="blg-blink"
        d="M49 10.5l1.3 3.4 3.4 1.3-3.4 1.3-1.3 3.4-1.3-3.4-3.4-1.3 3.4-1.3 1.3-3.4z"
        fill="#ffffff"
        opacity="0.9"
      />
    </svg>
  );
}
