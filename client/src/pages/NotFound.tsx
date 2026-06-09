import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div
      className="w-screen h-screen flex flex-col items-center justify-center gap-6"
      style={{ background: "var(--c-canvas)" }}
    >
      {/* Logo */}
      <div
        className="w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ boxShadow: "0 8px 32px oklch(0.68 0.22 285 / 0.30)" }}
      >
        <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
      </div>

      {/* 404 */}
      <div className="text-center">
        <p
          className="text-8xl font-bold tracking-tight mb-2"
          style={{
            background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            lineHeight: 1,
          }}
        >
          404
        </p>
        <p className="text-base font-medium mb-1" style={{ color: "var(--c-t2)" }}>
          页面未找到
        </p>
        <p className="text-sm" style={{ color: "var(--c-t4)" }}>
          你访问的页面不存在或已被移除
        </p>
      </div>

      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
        style={{
          background: "oklch(0.68 0.22 285 / 0.15)",
          border: "1px solid oklch(0.68 0.22 285 / 0.35)",
          color: "oklch(0.78 0.18 285)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.22 285 / 0.25)";
          (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.55)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.22 285 / 0.15)";
          (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.35)";
        }}
      >
        返回首页
      </button>
    </div>
  );
}
