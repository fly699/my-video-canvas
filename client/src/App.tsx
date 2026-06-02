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

function CanvasWithKey() {
  const params = useParams<{ projectId: string }>();
  return <Canvas key={params.projectId} />;
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
          <WhitelistBlockedDialog />
        </TooltipProvider>
        </CanvasModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
