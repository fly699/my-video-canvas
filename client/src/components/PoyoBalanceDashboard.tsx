import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Wallet, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const THRESHOLD_KEY = "poyo:balanceThreshold";
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

export function PoyoBalanceDashboard() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const [threshold, setThreshold] = useState<number | null>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(THRESHOLD_KEY) : null;
    const n = v != null && v !== "" ? Number(v) : null;
    return n != null && Number.isFinite(n) ? n : null; // ignore corrupt/NaN stored values
  });
  const alertedRef = useRef<number | null>(null);

  const balanceQ = trpc.poyo.balance.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const historyQ = trpc.poyo.history.useQuery({ limit: 30 }, { enabled: open });

  const data = balanceQ.data;
  const configured = data?.configured ?? false;
  const amount = configured ? (data?.creditsAmount ?? null) : null;

  // Low-balance alert — fire once per threshold "band" per session.
  useEffect(() => {
    if (amount == null || threshold == null) return;
    if (amount < threshold) {
      if (alertedRef.current !== threshold) {
        toast.warning(`Poyo 余额偏低：${fmt(amount)}（阈值 ${fmt(threshold)}）`);
        alertedRef.current = threshold;
      }
    } else {
      alertedRef.current = null;
    }
  }, [amount, threshold]);

  // Recent consumption from adjacent snapshots (newest first; positive = spent).
  const { lastSpend, points } = useMemo(() => {
    const rows = historyQ.data ?? [];
    const pts = rows.map((r) => ({ amount: r.creditsAmount, at: new Date(r.at) }));
    let last = 0;
    if (pts.length >= 2) last = pts[1].amount - pts[0].amount; // prev - cur
    return { lastSpend: last, points: pts };
  }, [historyQ.data]);

  // Badge color state
  let badgeColor = "oklch(0.68 0.22 285)"; // brand (normal)
  if (!configured) badgeColor = "var(--c-t4)";
  else if (amount != null && threshold != null) {
    if (amount < threshold / 2) badgeColor = "oklch(0.63 0.23 25)"; // red
    else if (amount < threshold) badgeColor = "oklch(0.75 0.15 80)"; // yellow
  }

  const label = balanceQ.isLoading
    ? "…"
    : !configured
      ? "Poyo 未配置"
      : amount != null
        ? fmt(amount)
        : balanceQ.isError ? "余额错误" : "—";

  const openPanel = () => {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  const saveThreshold = (raw: string) => {
    const n = raw.trim() === "" ? null : Number(raw);
    setThreshold(n != null && Number.isFinite(n) ? n : null);
    if (n != null && Number.isFinite(n)) localStorage.setItem(THRESHOLD_KEY, String(n));
    else localStorage.removeItem(THRESHOLD_KEY);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPanel}
        title="Poyo 账户余额"
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs transition-all"
        style={{
          background: open ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
          border: `1px solid ${open ? "oklch(0.68 0.22 285 / 0.3)" : "transparent"}`,
          color: badgeColor,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "var(--c-elevated)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
      >
        <Wallet className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
      </button>

      {open && btnRect && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99980 }}
            onMouseDown={(e) => {
              if (btnRef.current?.contains(e.target as Node)) return;
              setOpen(false);
            }}
          />
          <div
            style={{
              position: "fixed",
              zIndex: 99981,
              top: btnRect.bottom + 6,
              left: btnRect.left,
              minWidth: 280,
              maxWidth: 340,
              background: "var(--c-base)",
              border: "1px solid var(--c-bd2)",
              borderRadius: 12,
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)",
              padding: 14,
              color: "var(--c-t1)",
            }}
          >
            {!configured ? (
              <div style={{ fontSize: 12, color: "var(--c-t2)", lineHeight: 1.6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)", marginBottom: 4 }}>Poyo 未配置</div>
                设置环境变量 <code style={{ fontFamily: "monospace", color: "var(--c-t1)" }}>POYO_API_KEY</code> 后即可显示账户余额与消耗趋势。
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between" style={{ marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--c-t3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>当前余额</span>
                  <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: badgeColor }}>
                    {amount != null ? fmt(amount) : "—"}
                  </span>
                </div>
                {data?.email && (
                  <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 10 }}>{data.email}</div>
                )}

                {/* Recent consumption */}
                <div style={{ fontSize: 12, color: "var(--c-t2)", marginBottom: 8 }}>
                  最近一次消耗：<strong style={{ color: lastSpend > 0 ? "oklch(0.75 0.15 80)" : "var(--c-t2)" }}>{lastSpend > 0 ? `-${fmt(lastSpend)}` : "—"}</strong>
                </div>

                {/* Trend list */}
                {points.length > 1 && (
                  <div style={{ marginBottom: 10, maxHeight: 120, overflowY: "auto" }} className="nowheel">
                    <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginBottom: 4 }}>余额快照（新→旧）</div>
                    {points.slice(0, 8).map((p, i) => {
                      const delta = i + 1 < points.length ? points[i + 1].amount - p.amount : null;
                      return (
                        <div key={i} className="flex items-center justify-between" style={{ fontSize: 11, color: "var(--c-t3)", padding: "2px 0", fontVariantNumeric: "tabular-nums" }}>
                          <span>{p.at.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                          <span>{fmt(p.amount)}</span>
                          <span style={{ color: delta && delta > 0 ? "oklch(0.75 0.15 80)" : "var(--c-t4)", width: 56, textAlign: "right" }}>
                            {delta != null && delta > 0 ? `-${fmt(delta)}` : delta != null && delta < 0 ? `+${fmt(-delta)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Threshold input */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: "var(--c-t3)", display: "block", marginBottom: 4 }}>余额预警阈值</label>
                  <input
                    type="number"
                    placeholder="低于此值时提醒（留空关闭）"
                    defaultValue={threshold ?? ""}
                    onBlur={(e) => saveThreshold(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{
                      width: "100%", padding: "6px 9px", fontSize: 12,
                      background: "var(--c-input, var(--c-surface))", color: "var(--c-t1)",
                      border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none",
                    }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { balanceQ.refetch(); historyQ.refetch(); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                    style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
                  >
                    <RefreshCw className="w-3 h-3" /> 刷新
                  </button>
                  <a
                    href="https://poyo.ai/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                    style={{ background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.78 0.18 285)", textDecoration: "none" }}
                  >
                    <ExternalLink className="w-3 h-3" /> 去充值
                  </a>
                </div>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
