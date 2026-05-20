import { useLocation } from "wouter";
import { Film } from "lucide-react";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div
      className="w-screen h-screen flex flex-col items-center justify-center gap-6"
      style={{ background: "oklch(0.07 0.005 260)" }}
    >
      {/* Logo */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
          boxShadow: "0 8px 32px oklch(0.68 0.22 285 / 0.30)",
        }}
      >
        <Film className="w-6 h-6 text-white" />
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
        <p className="text-base font-medium mb-1" style={{ color: "oklch(0.75 0.006 260)" }}>
          页面未找到
        </p>
        <p className="text-sm" style={{ color: "oklch(0.42 0.006 260)" }}>
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
