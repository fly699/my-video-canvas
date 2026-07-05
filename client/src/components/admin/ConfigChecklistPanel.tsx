import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { downloadTextFile } from "@/lib/download";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, RefreshCw, Loader2, ClipboardCheck, Download, Copy } from "lucide-react";

type Status = "ok" | "warn" | "missing" | "off";
interface CheckItem { id: string; group: string; label: string; status: Status; detail: string; fix?: string }
const STATUS_META: Record<Status, { icon: typeof CheckCircle2; color: string; label: string }> = {
  ok: { icon: CheckCircle2, color: "oklch(0.72 0.17 150)", label: "已配置" },
  warn: { icon: AlertTriangle, color: "oklch(0.75 0.16 75)", label: "需注意" },
  missing: { icon: XCircle, color: "oklch(0.65 0.22 25)", label: "缺失" },
  off: { icon: MinusCircle, color: "var(--c-t4)", label: "未启用" },
};

/** 配置体检：把散落在 .env / 数据库 / CLI 凭证三处的部署配置汇总成逐项核对清单，
 *  新部署照单补齐，避免遗漏。只显示「已配/缺失/风险/未启用」状态，绝不显示任何密钥值。 */
export function ConfigChecklistPanel() {
  const q = trpc.admin.config.checklist.useQuery(undefined, { refetchOnWindowFocus: false });
  const items = (q.data?.items ?? []) as CheckItem[];

  const groups = useMemo(() => {
    const m = new Map<string, CheckItem[]>();
    for (const it of items) { const g = m.get(it.group) ?? []; g.push(it); m.set(it.group, g); }
    return Array.from(m.entries());
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { ok: 0, warn: 0, missing: 0, off: 0 };
    for (const it of items) c[it.status as Status]++;
    return c;
  }, [items]);

  const copyEnv = () => {
    const t = q.data?.envExample;
    if (!t) { toast.error("未找到 .env.example 模板"); return; }
    navigator.clipboard?.writeText(t).then(() => toast.success("已复制 .env.example 全文到剪贴板")).catch(() => toast.error("复制失败，请用「下载」"));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
          <ClipboardCheck className="w-5 h-5" style={{ color: "oklch(0.72 0.17 150)" }} /> 配置体检
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => q.refetch()} disabled={q.isFetching} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ fontSize: 12, fontWeight: 600, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: q.isFetching ? "wait" : "pointer" }}>
          {q.isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 重新检查
        </button>
      </div>

      <p style={{ fontSize: 12, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
        汇总 <code>.env</code> 环境变量、数据库配置、服务器上的 CLI 与订阅凭证三处的部署配置，逐项核对是否就位。
        新部署照此补齐即可，避免遗漏。<strong>本页只显示配置状态，不显示任何密钥明文。</strong>
        改完 <code>.env</code> 需重启服务（系统更新页可一键重启）；改完后台配置即时生效——改完点「重新检查」刷新。
      </p>

      {/* 概览计数 + .env 模板 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["ok", "warn", "missing", "off"] as Status[]).map((s) => {
          const M = STATUS_META[s]; const Icon = M.icon;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "4px 10px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
              <Icon className="w-3.5 h-3.5" style={{ color: M.color }} /> <span style={{ color: "var(--c-t2)" }}>{M.label}</span>
              <strong style={{ color: M.color }}>{counts[s]}</strong>
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={copyEnv} className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
          <Copy className="w-3.5 h-3.5" /> 复制 .env 模板
        </button>
        <button onClick={() => q.data?.envExample ? downloadTextFile(".env.example", q.data.envExample) : toast.error("未找到模板")} className="nodrag flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
          <Download className="w-3.5 h-3.5" /> 下载 .env 模板
        </button>
      </div>

      {q.isLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--c-t3)", fontSize: 13, padding: 20 }}><Loader2 className="w-4 h-4 animate-spin" /> 正在检查配置（含 ffmpeg / CLI 探测，稍候）…</div>}
      {q.error && <div style={{ color: "oklch(0.65 0.22 25)", fontSize: 13 }}>检查失败：{q.error.message}</div>}

      {groups.map(([group, gItems]) => (
        <div key={group} style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 700, background: "var(--c-input)", color: "var(--c-t2)", borderBottom: "1px solid var(--c-bd2)" }}>{group}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {gItems.map((it) => {
              const M = STATUS_META[it.status as Status]; const Icon = M.icon;
              return (
                <div key={it.id} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--c-bd1)", alignItems: "flex-start" }}>
                  <Icon className="w-4 h-4" style={{ color: M.color, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)" }}>{it.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--c-t3)", lineHeight: 1.6, marginTop: 2 }}>{it.detail}</div>
                    {it.fix && (
                      <div style={{ fontSize: 11.5, color: M.color, lineHeight: 1.6, marginTop: 3 }}>
                        <strong>怎么修：</strong>{it.fix}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
