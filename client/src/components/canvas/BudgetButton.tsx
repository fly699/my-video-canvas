import { useState, useRef, useEffect, useMemo } from "react";
import { Wallet, X, AlertTriangle, Server } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { trpc } from "@/lib/trpc";
import { estimateCanvasBudget } from "../../lib/costEstimate";
import { resolveActiveNodeModel } from "../../contexts/NodeDefaultModelsContext";
import { readProjectBudgetCap, writeProjectBudgetCap } from "../../lib/budgetCap";

// 工具栏「预算管控」弹层：把整张画布上所有生成节点按精确单价（docs/kie-pricing.md /
// docs/poyo-credits-pricing.md 同源的 costEstimate）汇总成 kie 点 / Poyo cr 两路总额，
// 对照当前 kie / Poyo 余额，并支持设「项目预算上限（kie 点）」超额告警。
// 预算上限按项目存 localStorage（lib/budgetCap.ts；智能体 autoRun 闸门同读此值）。

const KIE_TEMP_KEY = "kie:tempKey";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

export function BudgetButton({ orient = "h" }: { orient?: "h" | "v" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const projectId = useCanvasStore((s) => s.projectId);

  const [cap, setCap] = useState<number | null>(null);
  // 项目切换时读取该项目的预算上限。
  useEffect(() => { setCap(readProjectBudgetCap(projectId)); }, [projectId]);
  const persistCap = (n: number | null) => {
    setCap(n);
    writeProjectBudgetCap(projectId, n);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const edges = useCanvasStore((s) => s.edges);
  const budget = useMemo(
    () => estimateCanvasBudget(
      nodes.map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, payload: n.data.payload as Record<string, unknown> } })),
      resolveActiveNodeModel as (nt: string, slot: "llm" | "image" | "video") => string,
      edges.map((e) => ({ source: e.source, target: e.target })), // 分镜有下游 image_gen 时不计价（与运行器同口径）
    ),
    [nodes, edges],
  );

  const tempKey = typeof localStorage !== "undefined" ? localStorage.getItem(KIE_TEMP_KEY) ?? "" : "";
  const kieBal = trpc.kie.balance.useQuery(tempKey ? { tempKey } : undefined, { enabled: open, refetchInterval: open ? 30000 : false, retry: false });
  const poyoBal = trpc.poyo.balance.useQuery(undefined, { enabled: open, refetchInterval: open ? 30000 : false, retry: false });
  const kieAmount = kieBal.data?.configured ? (kieBal.data.creditsAmount ?? null) : null;
  const poyoAmount = poyoBal.data?.configured ? (poyoBal.data.creditsAmount ?? null) : null;

  const overCap = cap != null && budget.pt > cap;
  const overKieBal = kieAmount != null && budget.pt > kieAmount;
  const overPoyoBal = poyoAmount != null && budget.cr > poyoAmount;
  const warn = overCap || overKieBal || overPoyoBal;

  const ACCENT = "oklch(0.72 0.15 160)"; // 预算绿
  const RED = "oklch(0.62 0.20 25)";

  const Bar = ({ label, used, total, unit, color }: { label: string; used: number; total: number | null; unit: string; color: string }) => {
    const pct = total && total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const over = total != null && used > total;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-t1)" }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: over ? RED : color }}>{fmt(used)} {unit}</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-t4)" }}>
            {total != null ? `余额 ${fmt(total)} ${unit}` : "余额未配置"}
          </span>
        </div>
        {total != null && (
          <div style={{ height: 5, borderRadius: 3, background: "var(--c-bd1)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: over ? RED : color, transition: "width 200ms" }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="预算管控：画布预估消耗 vs 余额"
        data-active={open || undefined}
        className="topbar-btn"
        style={open ? { background: "var(--c-elevated)", color: "var(--c-t1)" } : undefined}
      >
        <Wallet className="w-3.5 h-3.5" />
        {warn && (
          <span style={{ position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "50%", background: RED, boxShadow: `0 0 5px ${RED}` }} />
        )}
      </button>

      {open && (
        <div
          className="animate-scale-in"
          style={{
            position: "absolute",
            bottom: orient === "v" ? "auto" : "calc(100% + 10px)",
            top: orient === "v" ? 0 : "auto",
            right: orient === "v" ? "calc(100% + 10px)" : 0,
            width: 320, maxHeight: "62vh", overflowY: "auto",
            background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14,
            boxShadow: "0 12px 40px oklch(0 0 0 / 0.45)", padding: 14, zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)", display: "flex", alignItems: "center", gap: 6 }}>
              <Wallet className="w-3.5 h-3.5" style={{ color: ACCENT }} /> 预算管控
            </div>
            <button onClick={() => setOpen(false)} className="topbar-btn" style={{ width: 24, height: 24 }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p style={{ fontSize: 10, color: "var(--c-t4)", lineHeight: 1.6, marginBottom: 10 }}>
            整张画布 {budget.runnableCount} 个生成节点的预估消耗（按当前模型/参数精算）。
            {budget.approx && " 含 ≈ 近似项。"}实际扣费以平台账单为准。
          </p>

          <Bar label="kie" used={budget.pt} total={kieAmount} unit="点" color={ACCENT} />
          <Bar label="Poyo" used={budget.cr} total={poyoAmount} unit="cr" color="oklch(0.66 0.18 250)" />

          {/* 项目预算上限（kie 点）*/}
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0", padding: "7px 9px", borderRadius: 9, background: "var(--c-surface)", border: `1px solid ${overCap ? RED + "55" : "var(--c-bd1)"}` }}>
            <span style={{ fontSize: 10.5, color: "var(--c-t3)", flex: 1 }}>项目预算上限（kie 点）</span>
            <input
              className="nodrag" type="number" min={0} placeholder="不限"
              value={cap ?? ""}
              onChange={(e) => { const n = Number(e.target.value); persistCap(Number.isFinite(n) && n > 0 ? n : null); }}
              style={{ width: 70, fontSize: 11, padding: "3px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", textAlign: "right" }}
            />
          </div>

          {warn && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 9px", borderRadius: 9, background: `${RED}12`, border: `1px solid ${RED}45`, marginBottom: 10 }}>
              <AlertTriangle className="w-3.5 h-3.5" style={{ color: RED, flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 10, color: RED, lineHeight: 1.5 }}>
                {overCap && `预估 ${fmt(budget.pt)} 点已超项目上限 ${fmt(cap!)} 点。`}
                {overKieBal && ` 预估 kie 点超当前余额，运行可能中途失败。`}
                {overPoyoBal && ` 预估 Poyo cr 超当前余额。`}
              </span>
            </div>
          )}

          {/* 按模型分组明细 */}
          {budget.lines.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t2)", marginBottom: 2 }}>按模型明细</div>
              {budget.lines.map((l) => (
                <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
                  <span style={{ color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={l.label}>{l.label}</span>
                  {l.count > 1 && <span style={{ color: "var(--c-t4)", flexShrink: 0 }}>×{l.count}</span>}
                  <span style={{ fontWeight: 700, color: "var(--c-t1)", flexShrink: 0, width: 56, textAlign: "right" }}>{fmt(l.credits)} {l.unit}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 10.5, color: "var(--c-t4)", textAlign: "center", margin: "8px 0" }}>画布暂无云端生成节点。</p>
          )}

          {(budget.localCount > 0 || budget.unknownCount > 0) && (
            <div style={{ display: "flex", gap: 10, fontSize: 9.5, color: "var(--c-t4)", borderTop: "1px solid var(--c-bd1)", paddingTop: 7 }}>
              {budget.localCount > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Server className="w-2.5 h-2.5" /> {budget.localCount} 项本地(免费)</span>}
              {budget.unknownCount > 0 && <span>{budget.unknownCount} 项未估价(未选模型/无固定价)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
