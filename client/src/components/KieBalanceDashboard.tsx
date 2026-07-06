import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Sparkles, RefreshCw, ExternalLink, KeyRound, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

const TEMP_KEY = "kie:tempKey";
const ACCENT = "oklch(0.72 0.15 200)"; // teal — distinct from Poyo's purple
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

const SOURCE_TEXT: Record<string, string> = { temp: "临时 key", assigned: "分配 key", house: "公用 key" };

export function KieBalanceDashboard({ compact }: { compact?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const [tempKey, setTempKey] = useState<string>(() => (typeof localStorage !== "undefined" ? localStorage.getItem(TEMP_KEY) ?? "" : ""));
  const [draft, setDraft] = useState("");

  const balanceQ = trpc.kie.balance.useQuery(tempKey ? { tempKey } : undefined, {
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const data = balanceQ.data;
  const configured = data?.configured ?? false;
  const amount = configured ? (data?.creditsAmount ?? null) : null;
  const source = data?.source ?? null;

  const badgeColor = !configured ? "var(--c-t4)" : ACCENT;
  const label = balanceQ.isLoading
    ? "…"
    : !configured
      ? "kie 未授权"
      : amount != null
        ? fmt(amount)
        : balanceQ.isError ? "余额错误" : "—";

  const openPanel = () => {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    setDraft("");
    setOpen((o) => !o);
  };

  const applyTempKey = () => {
    const v = draft.trim();
    if (!v) return;
    localStorage.setItem(TEMP_KEY, v);
    setTempKey(v);
    setDraft("");
    // refetch happens automatically via query-key change
  };
  const clearTempKey = () => {
    localStorage.removeItem(TEMP_KEY);
    setTempKey("");
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPanel}
        title="kie.ai 余额（当前生效 key）"
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs transition-all"
        style={{
          background: open ? `${ACCENT.replace(")", " / 0.12)")}` : "transparent",
          border: `1px solid ${open ? ACCENT.replace(")", " / 0.3)") : "transparent"}`,
          color: badgeColor,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "var(--c-elevated)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
      >
        <Sparkles className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{compact ? label : `kie ${label}`}</span>
        {configured && source && source !== "house" && (
          <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 4, background: `${ACCENT.replace(")", " / 0.15)")}`, lineHeight: "14px" }}>
            {source === "temp" ? "临时" : "分配"}
          </span>
        )}
      </button>

      {open && btnRect && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99980 }}
            onMouseDown={(e) => { if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }}
          />
          <div
            style={{
              position: "fixed", zIndex: 99981, top: btnRect.bottom + 6, left: btnRect.left,
              minWidth: 300, maxWidth: 360,
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12,
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)", padding: 14, color: "var(--c-t1)",
            }}
          >
            <div className="flex items-baseline justify-between" style={{ marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: "var(--c-t3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>kie.ai 当前余额</span>
              <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: badgeColor }}>
                {configured && amount != null ? fmt(amount) : "—"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 10 }}>
              {configured
                ? <>来源：<strong style={{ color: ACCENT }}>{data?.label ?? (source ? SOURCE_TEXT[source] : "")}</strong></>
                : "无可用 key — 请向管理员申请分配，或在下方录入临时 key"}
            </div>

            {/* Temp key entry */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: "var(--c-t3)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <KeyRound className="w-3 h-3" /> 临时 API key（仅存本机，优先于分配/公用 key）
              </label>
              {tempKey ? (
                <div className="flex items-center gap-2" style={{ fontSize: 12 }}>
                  <span style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", borderRadius: 8, color: "var(--c-t2)", fontFamily: "monospace" }}>
                    已启用 · …{tempKey.slice(-4)}
                  </span>
                  <button onClick={clearTempKey} title="清除临时 key" className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder="粘贴 kie.ai API key 后回车"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") applyTempKey(); }}
                    style={{ flex: 1, padding: "6px 9px", fontSize: 12, background: "var(--c-input, var(--c-surface))", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }}
                  />
                  <button onClick={applyTempKey} disabled={!draft.trim()} className="px-2.5 py-1.5 rounded-lg text-xs" style={{ background: ACCENT.replace(")", " / 0.14)"), border: `1px solid ${ACCENT.replace(")", " / 0.3)")}`, color: ACCENT, cursor: draft.trim() ? "pointer" : "not-allowed", opacity: draft.trim() ? 1 : 0.5 }}>
                    使用
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => balanceQ.refetch()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}
              >
                <RefreshCw className="w-3 h-3" /> 刷新
              </button>
              <a
                href="https://kie.ai/api-key" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{ background: ACCENT.replace(")", " / 0.12)"), border: `1px solid ${ACCENT.replace(")", " / 0.3)")}`, color: ACCENT, textDecoration: "none" }}
              >
                <ExternalLink className="w-3 h-3" /> 管理 / 充值
              </a>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
