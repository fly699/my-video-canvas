// #175 首页「AI 客户端」独立入口：不进入画布、单窗口独占的全屏 AI 客户端页面。
// 复用画布内同一套 <AiClientPanel embedded>（不解耦、自动匹配上下文）——通过 ReactFlowProvider +
// useCanvasStore 提供「专用项目」的节点上下文，@ 引用、落成节点等能力开箱即用。
// embedded 模式让面板无浮动壳、铺满内容区（不再「窗口套窗口」）。
// 约束（用户明确要求）：绝不跳转到其它网页、页面内无任何地址输入框 / 外链。
// 浏览器弹窗那行地址栏由浏览器安全策略强制、无法用代码去除；提供「全屏」按钮，一键进入全屏后
// 浏览器所有 UI（含地址栏）全部隐藏，达到真正独占。
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useLocation } from "wouter";
import { Bot, FolderOpen, ChevronDown, ArrowLeft, Check, Maximize2, Minimize2, SquareArrowOutUpRight, PanelsTopLeft, Download, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import { useTheme, THEMES } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useCanvasStore, type CanvasNode } from "@/hooks/useCanvasStore";
import { useAiClient } from "@/hooks/useAiClient";
import { AiClientPanel } from "@/components/canvas/AiClientPanel";
import { requestAgentPrefill } from "@/lib/agentPrefill";
import { NodeImageLightbox } from "@/components/canvas/NodeImageLightbox";
import { ModelShowcaseCard } from "@/components/ModelShowcaseCard";
import { getNodeConfig } from "@/lib/nodeConfig";
import type { NodeType } from "../../../shared/types";

const ACCENT = "oklch(0.70 0.20 300)";
const TOPBAR_H = 116; // 顶栏（标题 + 模型跑马灯 + 项目切换）高度，面板从其下方铺满
const TOPBAR_H_NARROW = 52; // 移动端顶栏：单行紧凑（隐藏跑马灯 + 副标题）

// PWA「下载为应用」的 beforeinstallprompt 事件类型（浏览器扩展事件，标准库无声明）。
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function StandaloneInner() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  // 专用「AI 客户端」项目（会话空间独立于画布工作）。默认落在它上面；也可切到任意项目取其节点作上下文。
  const [projectId, setProjectId] = useState<number | null>(null);
  const initRef = useRef(false);
  const getOrCreateMut = trpc.projects.getOrCreateAiClient.useMutation();
  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const nodesQuery = trpc.nodes.list.useQuery({ projectId: projectId ?? 0 }, { enabled: !!projectId && isAuthenticated });

  // 未登录 → 去登录页（本页不放任何外链，用内部路由跳转）。
  useEffect(() => { if (!loading && !isAuthenticated) navigate("/login"); }, [loading, isAuthenticated, navigate]);

  // 首次：获取/创建专用项目。
  useEffect(() => {
    if (!isAuthenticated || initRef.current) return;
    initRef.current = true;
    getOrCreateMut.mutate(undefined, { onSuccess: (p) => { if (p) setProjectId(p.id); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // 嵌入模式的面板始终渲染，但仍确保全局态为「展开」，避免其它 open 依赖逻辑异常。
  useEffect(() => { useAiClient.setState({ open: true, minimized: false }); }, []);

  // 选中项目 → 灌入画布 store（projectId + 节点快照），让 @ 引用/落成节点等自动匹配当前项目上下文。
  useEffect(() => {
    if (!projectId) return;
    const store = useCanvasStore.getState();
    store.setProjectId(projectId);
    store.setCurrentUserId(user?.id ?? null);
  }, [projectId, user?.id]);

  useEffect(() => {
    if (!projectId || !nodesQuery.data) return;
    const flow: CanvasNode[] = nodesQuery.data.map((n) => {
      const cfg = getNodeConfig(n.type as NodeType);
      return {
        id: n.id,
        type: "custom",
        position: { x: n.posX, y: n.posY },
        data: { nodeType: n.type as NodeType, title: n.title ?? cfg.defaultTitle, payload: (n.data as Record<string, unknown>) ?? {}, projectId },
        zIndex: n.zIndex,
      } as CanvasNode;
    });
    useCanvasStore.getState().setNodes(flow);
  }, [nodesQuery.data, projectId]);

  // 全屏（隐藏浏览器地址栏 / 所有浏览器 UI，真正独占）。需用户手势触发。
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  // 「下载为应用」（PWA 安装）：把全站 manifest 换成 /ai 专用（安装后打开即 AI 客户端）；
  // 捕获 beforeinstallprompt 供按钮触发；已安装（standalone 显示模式）则隐藏按钮。
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true);
  useEffect(() => {
    // 换 manifest：安装此页时用 start_url=/ai 的清单（否则用全站 /chat 清单会装成聊天）。
    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const prev = link?.getAttribute("href") ?? null;
    if (link) link.setAttribute("href", "/ai-client.webmanifest");
    const onBIP = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
      if (link && prev) link.setAttribute("href", prev); // 离开 /ai 时恢复全站清单
    };
  }, []);
  // 深/浅主题切换（复用全站 ThemeContext；移动端 /ai 无设置入口，这里给一个直达开关）。
  const { theme, setTheme } = useTheme();
  const isDark = THEMES.find((t) => t.id === theme)?.dark ?? true;
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  const installApp = () => {
    if (installPrompt) {
      void installPrompt.prompt();
      void installPrompt.userChoice.then((r) => { if (r.outcome === "accepted") setInstalled(true); setInstallPrompt(null); });
      return;
    }
    // 无 beforeinstallprompt（iOS/Safari 或尚未满足条件）：给出手动安装指引。
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast.info(iOS ? "Safari：点底部「分享」→「添加到主屏幕」即可把 AI 客户端装成应用。" : "在浏览器地址栏右侧点「安装」图标，或菜单里选「安装应用 / 添加到主屏幕」。", { duration: 6000 });
  };

  // 移动端：窄屏（<640）时收起跑马灯 + 副标题，顶栏单行紧凑、按钮仅图标。
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const topbarH = narrow ? TOPBAR_H_NARROW : TOPBAR_H;

  // 项目切换菜单
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // 最新一条 AI 回复（由 AiClientPanel 上抛）——「进入画布」时携带它，自动填入画布助手输入框。
  const [latestReply, setLatestReply] = useState<string | null>(null);
  const enterCanvas = (pid: number) => { if (latestReply) requestAgentPrefill(pid, latestReply); navigate(`/canvas/${pid}`); };
  const allProjects = useMemo(() => {
    const owned = projectsQuery.data?.owned ?? [];
    const shared = projectsQuery.data?.shared ?? [];
    return [...owned, ...shared];
  }, [projectsQuery.data]);
  const activeProject = allProjects.find((p) => p.id === projectId);

  const topBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "7px 11px", borderRadius: 9, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer", flexShrink: 0 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--c-bg, #0c0c10)", overflow: "hidden" }}>
      {/* 顶栏：品牌标题 + 模型跑马灯 + 项目切换 + 全屏 + 返回（无地址栏 / 无外链） */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: topbarH, padding: narrow ? "0 10px" : "12px 20px 8px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, borderBottom: "1px solid var(--c-bd1)", background: "var(--c-surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: narrow ? 8 : 12 }}>
          <span style={{ display: "inline-flex", width: narrow ? 28 : 32, height: narrow ? 28 : 32, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 10, background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`, color: ACCENT }}><Bot size={narrow ? 17 : 19} /></span>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--c-t1)" }}>AI 客户端</span>
            {!narrow && <span style={{ fontSize: 11, color: "var(--c-t4)" }}>独立窗口 · 全部主流大模型一处对话（含代码模式 / @画布上下文）</span>}
          </div>
          {!narrow && (
            <div style={{ flex: 1, minWidth: 0, margin: "0 8px" }}>
              <ModelShowcaseCard compact />
            </div>
          )}
          {narrow && <div style={{ flex: 1, minWidth: 0 }} />}
          {/* 项目上下文切换 */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={() => setSwitcherOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: narrow ? "7px 9px" : "7px 12px", borderRadius: 9, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t2)", cursor: "pointer", maxWidth: narrow ? 130 : 220 }}
              title="切换会话所在项目（决定 @ 引用可选的画布节点）">
              <FolderOpen size={13} style={{ color: ACCENT, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeProject?.name ?? "AI 客户端"}</span>
              {!narrow && <ChevronDown size={13} style={{ flexShrink: 0 }} />}
            </button>
            {switcherOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 400 }} onClick={() => setSwitcherOpen(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 401, width: 260, maxHeight: 380, overflowY: "auto", borderRadius: 12, border: "1px solid var(--c-bd2)", background: "var(--c-elevated, var(--c-surface))", boxShadow: "0 16px 48px rgba(0,0,0,0.5)", padding: 6 }}>
                  <div style={{ fontSize: 10.5, color: "var(--c-t4)", padding: "6px 8px 4px" }}>选择项目作为对话上下文</div>
                  {allProjects.length === 0 && <div style={{ fontSize: 12, color: "var(--c-t4)", padding: "10px 8px" }}>暂无项目</div>}
                  {allProjects.map((p) => {
                    const on = p.id === projectId;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 2, borderRadius: 8, background: on ? `color-mix(in oklch, ${ACCENT} 12%, transparent)` : "transparent" }}>
                        <button onClick={() => { setProjectId(p.id); setSwitcherOpen(false); }}
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 9px", borderRadius: 8, border: "none", cursor: "pointer", background: "transparent", color: "var(--c-t1)" }}
                          title="选为对话上下文">
                          <FolderOpen size={13} style={{ flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }} />
                          <span style={{ flex: 1, fontSize: 12.5, fontWeight: on ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                          {on && <Check size={13} style={{ color: ACCENT, flexShrink: 0 }} />}
                        </button>
                        {/* 一键进入该项目画布（内部路由，非外链） */}
                        <button onClick={() => { setSwitcherOpen(false); navigate(`/canvas/${p.id}`); }}
                          title={`进入「${p.name}」的画布`}
                          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, marginRight: 4, borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}>
                          <SquareArrowOutUpRight size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {/* 一键进入当前选中项目的画布（内部路由，非外链）——仅在选了某个真实项目时显示 */}
          {activeProject && projectId && (
            <button onClick={() => enterCanvas(projectId)} style={narrow ? { ...topBtn, padding: "7px 9px" } : topBtn} title={`进入「${activeProject.name}」的画布${latestReply ? "（携带最后一条回复到画布助手）" : ""}`}>
              <PanelsTopLeft size={13} /> {!narrow && "进入画布"}
            </button>
          )}
          {/* 深/浅主题切换 */}
          <button onClick={toggleTheme} style={narrow ? { ...topBtn, padding: "7px 9px" } : topBtn} title={isDark ? "切换到浅色主题" : "切换到深色主题"}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />} {!narrow && (isDark ? "浅色" : "深色")}
          </button>
          {/* 下载为应用（PWA 安装）——已安装则隐藏 */}
          {!installed && (
            <button onClick={installApp} style={narrow ? { ...topBtn, padding: "7px 9px" } : topBtn} title="下载为应用（安装到桌面 / 主屏幕，独立窗口打开）">
              <Download size={13} /> {!narrow && "下载为应用"}
            </button>
          )}
          {/* 全屏（隐藏浏览器地址栏，真正独占） */}
          <button onClick={toggleFullscreen} style={narrow ? { ...topBtn, padding: "7px 9px" } : topBtn} title={isFs ? "退出全屏" : "全屏独占（隐藏浏览器地址栏）"}>
            {isFs ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {!narrow && (isFs ? "退出全屏" : "全屏")}
          </button>
          {/* 返回首页（内部路由，非外链） */}
          <button onClick={() => navigate("/")} style={narrow ? { ...topBtn, padding: "7px 9px" } : topBtn} title="返回首页">
            <ArrowLeft size={13} /> {!narrow && "首页"}
          </button>
        </div>
      </div>

      {/* 复用画布内同一套 AI 客户端面板（embedded：无浮动壳、铺满内容区，不再窗口套窗口） */}
      <div style={{ position: "absolute", top: topbarH, left: 0, right: 0, bottom: 0 }}>
        <AiClientPanel embedded onLatestReply={setLatestReply} />
      </div>
      {/* 图片放大预览层（AiClientPanel 点击图片附件走 openNodeImage → 该组件监听）。画布页由
          Canvas.tsx 挂载；/ai 独立页需自挂，否则「点击图片不能放大」。 */}
      <NodeImageLightbox />
    </div>
  );
}

export default function AiClientStandalone() {
  return (
    <ReactFlowProvider>
      <StandaloneInner />
    </ReactFlowProvider>
  );
}
