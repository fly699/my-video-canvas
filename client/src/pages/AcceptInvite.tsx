import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * /invite/:token — landing for one-time / multi-use share links (long form).
 * /i/:code     — same flow via the short form ({id}.{tokenPrefix}).
 *
 * Unauthenticated visitors are redirected to /login?next=…; on return we
 * call the corresponding accept mutation and forward to the project canvas.
 */
export default function AcceptInvite() {
  // wouter passes whichever named param the route declared. Either token or
  // code will be set on `params` depending on which route matched.
  const params = useParams<{ token?: string; code?: string }>();
  const isShort = !!params.code;
  const tokenOrCode = params.code ?? params.token ?? "";
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");
  const [retryTick, setRetryTick] = useState(0); // #R5-7 重试：递增即重跑 accept（瞬时网络失败可救）

  const acceptLong = trpc.collaboration.acceptShareLink.useMutation();
  const acceptShort = trpc.collaboration.acceptShareLinkShort.useMutation();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      const path = isShort ? `/i/${tokenOrCode}` : `/invite/${tokenOrCode}`;
      navigate(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
    if (!tokenOrCode) return;
    let cancelled = false;
    const promise = isShort
      ? acceptShort.mutateAsync({ code: tokenOrCode })
      : acceptLong.mutateAsync({ token: tokenOrCode });
    promise
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
  }, [isAuthenticated, loading, tokenOrCode, isShort, retryTick]);

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
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => { setStatus("loading"); setErrMsg(""); setRetryTick((t) => t + 1); }}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "oklch(0.62 0.2 285)", border: "none", color: "#fff" }}
            >↻ 重试</button>
            <button
              onClick={() => navigate("/")}
              className="px-4 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
            >返回首页</button>
          </div>
        </>
      )}
    </div>
  );
}
