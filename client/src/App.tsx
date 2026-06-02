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
import { useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { setDownloadGate } from "@/lib/download";

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
  useEffect(() => {
    setDownloadGate(async (rawUrl, assetId) => {
      let cfg: { enabled: boolean; isAdmin: boolean };
      try { cfg = await utils.downloads.config.fetch(); } catch { return true; }
      if (!cfg.enabled || cfg.isAdmin) return true;
      try {
        const access = await utils.downloads.checkAccess.fetch({ url: rawUrl, assetId });
        if (access.allowed) return true;
      } catch { return true; } // can't determine → don't block UX (server still enforces)
      toast("需要下载授权", {
        description: "你没有该文件的下载授权，可向管理员申请",
        action: {
          label: "申请下载",
          onClick: () => requestMut.mutate(
            { url: rawUrl, assetId },
            { onSuccess: () => toast.success("已提交下载申请，等待管理员批准"), onError: (e) => toast.error("申请失败：" + e.message) },
          ),
        },
      });
      return false;
    });
    return () => setDownloadGate(null);
  }, [utils, requestMut]);
  return null;
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
          <WhitelistBlockedDialog />
        </TooltipProvider>
        </CanvasModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
