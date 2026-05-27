import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * /invite/:token — landing for one-time / multi-use share links.
 * Unauthenticated visitors are redirected to /login?next=/invite/:token; on
 * return we call acceptShareLink and forward to the project canvas.
 */
export default function AcceptInvite() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");

  const acceptMutation = trpc.collaboration.acceptShareLink.useMutation();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);
      return;
    }
    if (!params.token) return;
    let cancelled = false;
    acceptMutation.mutateAsync({ token: params.token })
      .then((res) => {
        if (cancelled) return;
        setStatus("ok");
        setTimeout(() => navigate(`/canvas/${res.projectId}`), 600);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrMsg(err?.message ?? "邀请处理失败");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, loading, params.token]);

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--c-base)" }}>
      {status === "loading" && (
        <>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "oklch(0.68 0.22 285)" }} />
          <p className="text-sm" style={{ color: "var(--c-t2)" }}>正在加入项目…</p>
        </>
      )}
      {status === "ok" && (
        <>
          <CheckCircle2 className="w-8 h-8" style={{ color: "oklch(0.72 0.18 155)" }} />
          <p className="text-sm" style={{ color: "var(--c-t2)" }}>已加入，正在跳转…</p>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="w-8 h-8" style={{ color: "oklch(0.62 0.20 25)" }} />
          <p className="text-sm" style={{ color: "var(--c-t2)" }}>{errMsg}</p>
          <button
            onClick={() => navigate("/")}
            className="mt-2 px-4 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
          >返回首页</button>
        </>
      )}
    </div>
  );
}
