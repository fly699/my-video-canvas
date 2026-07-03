import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { goToAdminTab } from "@/lib/adminNav";

interface Notice {
  grantId: number;
  userId: number;
  requesterName: string | null;
  fileName: string | null;
  fileType: string | null;
  projectName: string | null;
  reason: string | null;
  createdAt: number;
}

/**
 * Admin-only, app-wide download-request notifier with two parts:
 *  - live popups (top-center) when a request arrives, with one-click approve
 *    (pick 1–24h validity), 查看, 忽略;
 *  - a persistent bottom-left badge showing the un-handled request count, so an
 *    admin who missed a popup still sees there's pending work (links to /admin).
 */
export function DownloadNotifier() {
  const { user } = useAuth();
  // 下载审批限管理员 L3+，故通知/待办计数也仅 L3+ 拉取（否则运营 L2 会 403）。
  const canApprove = user?.role === "admin" && (user?.adminLevel ?? 0) >= 3;
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [hours, setHours] = useState(1);
  const decideMut = trpc.admin.downloads.decide.useMutation();
  const pendingQ = trpc.admin.downloads.pendingCount.useQuery(undefined, {
    enabled: canApprove, refetchInterval: 20000, refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!canApprove) return;
    const socket: Socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true });
    socket.on("download:request", (n: Notice) => {
      setNotices((prev) => (prev.some((p) => p.grantId === n.grantId) ? prev : [n, ...prev].slice(0, 5)));
      void utils.admin.downloads.pendingCount.invalidate();
      void utils.admin.downloads.list.invalidate();
    });
    return () => { socket.disconnect(); };
  }, [canApprove, utils]);

  const dismiss = (grantId: number) => setNotices((prev) => prev.filter((p) => p.grantId !== grantId));
  const refreshCounts = () => { void utils.admin.downloads.pendingCount.invalidate(); void utils.admin.downloads.list.invalidate(); };

  if (!canApprove) return null;
  const pending = pendingQ.data ?? 0;

  return (
    <>
      {/* Persistent un-handled indicator (bottom-left) */}
      {pending > 0 && (
        <button
          onClick={() => goToAdminTab(navigate, "downloads")}
          title="有待审批的下载申请，点击前往审批"
          style={{
            position: "fixed", left: 16, bottom: 16, zIndex: 1090,
            display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 999,
            background: "oklch(0.62 0.2 285)", color: "#fff", border: "none", cursor: "pointer",
            boxShadow: "0 6px 24px oklch(0.62 0.2 285 / 0.45)", fontSize: 12.5, fontWeight: 600,
          }}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Bell size={15} />
            <span style={{ position: "absolute", top: -5, right: -6, minWidth: 15, height: 15, paddingInline: 3, borderRadius: 8, background: "oklch(0.62 0.22 25)", color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center" }}>{pending}</span>
          </span>
          待审批下载 {pending}
        </button>
      )}

      {/* Live popups (top-center) */}
      {notices.length > 0 && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1100, display: "flex", flexDirection: "column", gap: 8, width: "min(94vw, 440px)" }}>
          {notices.map((n) => (
            <div key={n.grantId} style={{ borderRadius: 12, background: "var(--c-elevated, #1a1a20)", border: "1px solid oklch(0.72 0.2 285 / 0.4)", boxShadow: "0 12px 36px oklch(0 0 0 / 0.5)", padding: "12px 14px" }}>
              <div style={{ fontSize: 13, color: "var(--c-t1)", fontWeight: 600 }}>下载申请 · {n.requesterName ?? `u${n.userId}`}</div>
              <div style={{ fontSize: 12, color: "var(--c-t3)", marginTop: 3, lineHeight: 1.5 }}>
                文件：{n.fileName ?? "（未知）"}{n.fileType ? `（${n.fileType}）` : ""}
                {n.projectName ? ` · 项目：${n.projectName}` : ""}
                {n.reason ? ` · 理由：${n.reason}` : ""}
              </div>
              <div style={{ fontSize: 11, color: "var(--c-t4)", marginTop: 2 }}>{new Date(n.createdAt).toLocaleString("zh-CN")}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 10 }}>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))} title="授权有效期"
                  style={{ fontSize: 11.5, padding: "4px 6px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "var(--c-input,rgba(255,255,255,0.05))", color: "var(--c-t1)", cursor: "pointer", marginRight: "auto" }}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h} 小时</option>)}
                </select>
                <button onClick={() => dismiss(n.grantId)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}>忽略</button>
                <button onClick={() => { dismiss(n.grantId); goToAdminTab(navigate, "downloads"); }} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}>查看</button>
                <button
                  disabled={decideMut.isPending}
                  onClick={() => decideMut.mutate(
                    { grantId: n.grantId, approve: true, expiresHours: hours },
                    { onSuccess: () => { toast.success(`已授权下载（${hours} 小时有效）`); dismiss(n.grantId); refreshCounts(); }, onError: (e) => toast.error("授权失败：" + e.message) },
                  )}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: "none", background: "oklch(0.6 0.16 155)", color: "#fff", cursor: "pointer" }}
                >授权（{hours}h）</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
