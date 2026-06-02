import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { CanvasModeProvider } from "./contexts/CanvasModeContext";
import Home from "./pages/Home";
import Canvas from "./pages/Canvas";
import LoginPage from "./pages/LoginPage";
import AdminPage from "./pages/AdminPage";
import AcceptInvite from "./pages/AcceptInvite";
import ChatPage from "./pages/ChatPage";
import Library from "./pages/Library";
import { WhitelistBlockedDialog } from "./components/WhitelistBlockedDialog";
import { useParams } from "wouter";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { setDownloadGate } from "@/lib/download";
import { DownloadNotifier } from "./components/DownloadNotifier";

function CanvasWithKey() {
  const params = useParams<{ projectId: string }>();
  return <Canvas key={params.projectId} />;
}

/**
 * Registers the global download gate. When strict download authorization is on
 * and the user lacks a grant, blocks the download and offers to file a request.
 * No-op (transparent) when the feature is off or the user is an admin.
 */
function DownloadGateRegistrar() {
  const utils = trpc.useUtils();
  const requestMut = trpc.downloads.request.useMutation();
  const [blocked, setBlocked] = useState<{ url: string; assetId?: number } | null>(null);
  useEffect(() => {
    setDownloadGate(async (rawUrl, assetId) => {
      let cfg: { enabled: boolean; isAdmin: boolean };
      try { cfg = await utils.downloads.config.fetch(); } catch { return true; }
      if (!cfg.enabled || cfg.isAdmin) return true;
      try {
        const access = await utils.downloads.checkAccess.fetch({ url: rawUrl, assetId });
        if (access.allowed) return true;
      } catch { return true; } // can't determine → don't block UX (server still enforces)
      setBlocked({ url: rawUrl, assetId });
      return false;
    });
    return () => setDownloadGate(null);
  }, [utils]);

  if (!blocked) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(6px)" }}
      onClick={() => setBlocked(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(92vw, 380px)", borderRadius: 14, background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2)", boxShadow: "0 16px 48px oklch(0 0 0 / 0.5)", padding: 20 }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--c-t1)", margin: 0 }}>需要下载授权</h3>
        <p style={{ fontSize: 13, color: "var(--c-t3)", lineHeight: 1.6, marginTop: 10 }}>
          该文件已启用「严格下载授权」，需管理员批准后才能下载。是否提交下载申请？管理员通过后你将可以下载一次。
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            onClick={() => setBlocked(null)}
            style={{ fontSize: 13, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}
          >取消</button>
          <button
            disabled={requestMut.isPending}
            onClick={() => requestMut.mutate(
              { url: blocked.url, assetId: blocked.assetId },
              { onSuccess: () => { toast.success("已提交下载申请，等待管理员批准"); setBlocked(null); }, onError: (e) => toast.error("申请失败：" + e.message) },
            )}
            style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8, border: "none", background: "oklch(0.62 0.2 285)", color: "#fff", cursor: "pointer" }}
          >{requestMut.isPending ? "提交中…" : "申请下载"}</button>
        </div>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/canvas/:projectId" component={CanvasWithKey} />
      <Route path="/login" component={LoginPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/invite/:token" component={AcceptInvite} />
      <Route path="/i/:code" component={AcceptInvite} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/library" component={Library} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <CanvasModeProvider>
        <TooltipProvider delayDuration={400}>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--c-surface)",
                border: "1px solid var(--c-bd2)",
                color: "var(--c-t1)",
              },
            }}
          />
          <Router />
          <DownloadGateRegistrar />
          <DownloadNotifier />
          <WhitelistBlockedDialog />
        </TooltipProvider>
        </CanvasModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
