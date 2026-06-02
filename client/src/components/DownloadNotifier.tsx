import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

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
 * Admin-only, app-wide listener for new download requests. When a user submits a
 * request and an admin is online (anywhere — canvas, library, …), a popup shows
 * top-center with the file/requester info and one-click 授权 / 查看 / 忽略, so the
 * admin doesn't have to dig into the admin panel.
 */
export function DownloadNotifier() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [notices, setNotices] = useState<Notice[]>([]);
  const decideMut = trpc.admin.downloads.decide.useMutation();

  useEffect(() => {
    if (!isAdmin) return;
    const socket: Socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true });
    socket.on("download:request", (n: Notice) => {
      setNotices((prev) => (prev.some((p) => p.grantId === n.grantId) ? prev : [n, ...prev].slice(0, 5)));
    });
    return () => { socket.disconnect(); };
  }, [isAdmin]);

  const dismiss = (grantId: number) => setNotices((prev) => prev.filter((p) => p.grantId !== grantId));

  if (!isAdmin || notices.length === 0) return null;
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1100, display: "flex", flexDirection: "column", gap: 8, width: "min(94vw, 420px)" }}>
      {notices.map((n) => (
        <div key={n.grantId} style={{ borderRadius: 12, background: "var(--c-elevated, #1a1a20)", border: "1px solid oklch(0.72 0.2 285 / 0.4)", boxShadow: "0 12px 36px oklch(0 0 0 / 0.5)", padding: "12px 14px" }}>
          <div style={{ fontSize: 13, color: "var(--c-t1)", fontWeight: 600 }}>
            下载申请 · {n.requesterName ?? `u${n.userId}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--c-t3)", marginTop: 3, lineHeight: 1.5 }}>
            文件：{n.fileName ?? "（未知）"}{n.fileType ? `（${n.fileType}）` : ""}
            {n.projectName ? ` · 项目：${n.projectName}` : ""}
            {n.reason ? ` · 理由：${n.reason}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--c-t4)", marginTop: 2 }}>{new Date(n.createdAt).toLocaleString("zh-CN")}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
            <button onClick={() => dismiss(n.grantId)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}>忽略</button>
            <button onClick={() => { dismiss(n.grantId); navigate("/admin"); }} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}>查看</button>
            <button
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate(
                { grantId: n.grantId, approve: true },
                { onSuccess: () => { toast.success("已授权下载（3 天有效）"); dismiss(n.grantId); void utils.admin.downloads.list.invalidate(); }, onError: (e) => toast.error("授权失败：" + e.message) },
              )}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: "none", background: "oklch(0.6 0.16 155)", color: "#fff", cursor: "pointer" }}
            >授权</button>
          </div>
        </div>
      ))}
    </div>
  );
}
