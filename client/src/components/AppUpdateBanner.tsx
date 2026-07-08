import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

// 应用更新横幅：轮询后端构建标识(system.buildId),与首次加载时记下的比对;
// 一旦变化(说明已重新部署),顶部横幅提示用户按 F5 / 点击刷新以载入最新版。
export function AppUpdateBanner() {
  const { data } = trpc.system.buildId.useQuery(undefined, {
    refetchInterval: 150_000,          // 每 2.5 分钟查一次
    refetchOnWindowFocus: true,        // 切回标签页也查一次(用户回来更可能撞上新版)
    retry: false,
    staleTime: 60_000,
  });
  const firstRef = useRef<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const id = data?.buildId;
    if (!id || id === "unknown") return;
    if (firstRef.current === null) { firstRef.current = id; return; }
    if (id !== firstRef.current) setUpdated(true);
  }, [data?.buildId]);

  if (!updated || dismissed) return null;

  return (
    <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2147483000,
      display: "flex", alignItems: "center", gap: 12, padding: "9px 12px 9px 14px", borderRadius: 12, maxWidth: "min(92vw, 520px)",
      background: "color-mix(in oklch, var(--c-elevated, #1b1b1f) 94%, transparent)", backdropFilter: "blur(18px)",
      border: "1px solid var(--color-brand, oklch(0.62 0.2 285))", boxShadow: "0 12px 34px oklch(0 0 0 / 0.34)" }}>
      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-brand, oklch(0.62 0.2 285))", color: "#fff" }}>
        <RefreshCw style={{ width: 14, height: 14 }} />
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--c-t1, #f0f0f4)" }}>
        应用已更新到新版本，<b>按 F5 或点击刷新</b>即可载入最新功能。
      </span>
      <button onClick={() => window.location.reload()}
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
          background: "var(--color-brand, oklch(0.62 0.2 285))", color: "#fff", border: "none", cursor: "pointer" }}>
        <RefreshCw style={{ width: 13, height: 13 }} /> 立即刷新
      </button>
      <button onClick={() => setDismissed(true)} title="稍后" aria-label="稍后"
        style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", color: "var(--c-t4, #888)", border: "none", cursor: "pointer" }}>
        <X style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}
