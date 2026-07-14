// #175 首页「AI 客户端」独立入口：不进入画布、单窗口独占的全屏 AI 客户端页面。
// 复用画布内同一套 <AiClientPanel>（不解耦、自动匹配上下文）——通过 ReactFlowProvider +
// useCanvasStore 提供「专用项目」的节点上下文，@ 引用、落成节点等能力开箱即用。
// 约束（用户明确要求）：绝不跳转到其它网页、页面内无任何地址输入框 / 外链。
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useLocation } from "wouter";
import { Bot, FolderOpen, ChevronDown, ArrowLeft, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useCanvasStore, type CanvasNode } from "@/hooks/useCanvasStore";
import { useAiClient } from "@/hooks/useAiClient";
import { AiClientPanel } from "@/components/canvas/AiClientPanel";
import { ModelShowcaseCard } from "@/components/ModelShowcaseCard";
import { getNodeConfig } from "@/lib/nodeConfig";
import type { NodeType } from "../../../shared/types";

const ACCENT = "oklch(0.70 0.20 300)";
const TOPBAR_H = 116; // 顶栏（标题 + 模型跑马灯 + 项目切换）高度，面板从其下方铺满

function StandaloneInner() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const open = useAiClient((s) => s.open);

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

  // 强制展开面板并铺满窗口（用 setState 直接写内存态，不落 localStorage，避免污染画布内的悬浮窗几何）。
  useEffect(() => {
    const apply = () => {
      const w = Math.max(720, window.innerWidth - 40);
      const h = Math.max(460, window.innerHeight - TOPBAR_H - 20);
      useAiClient.setState({ open: true, minimized: false, geometry: { x: 20, y: TOPBAR_H, w, h } });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

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

  // 项目切换菜单
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const allProjects = useMemo(() => {
    const owned = projectsQuery.data?.owned ?? [];
    const shared = projectsQuery.data?.shared ?? [];
    return [...owned, ...shared];
  }, [projectsQuery.data]);
  const activeProject = allProjects.find((p) => p.id === projectId);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--c-bg, #0c0c10)", overflow: "hidden" }}>
      {/* 顶栏：品牌标题 + 模型跑马灯 + 项目切换（无地址栏 / 无外链） */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: TOPBAR_H, padding: "12px 20px 8px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--c-bd1)", background: "var(--c-surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "inline-flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`, color: ACCENT }}><Bot size={19} /></span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--c-t1)" }}>AI 客户端</span>
            <span style={{ fontSize: 11, color: "var(--c-t4)" }}>独立窗口 · 全部主流大模型一处对话（含代码模式 / @画布上下文）</span>
          </div>
          <div style={{ flex: 1, minWidth: 0, margin: "0 8px" }}>
            <ModelShowcaseCard compact />
          </div>
          {/* 项目上下文切换 */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={() => setSwitcherOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 9, border: "1px solid var(--c-bd2)", background: "var(--c-input)", color: "var(--c-t2)", cursor: "pointer", maxWidth: 220 }}
              title="切换会话所在项目（决定 @ 引用可选的画布节点）">
              <FolderOpen size={13} style={{ color: ACCENT, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeProject?.name ?? "AI 客户端"}</span>
              <ChevronDown size={13} style={{ flexShrink: 0 }} />
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
                      <button key={p.id} onClick={() => { setProjectId(p.id); setSwitcherOpen(false); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 9px", borderRadius: 8, border: "none", cursor: "pointer", background: on ? `color-mix(in oklch, ${ACCENT} 12%, transparent)` : "transparent", color: "var(--c-t1)" }}>
                        <FolderOpen size={13} style={{ flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }} />
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: on ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        {on && <Check size={13} style={{ color: ACCENT, flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {/* 返回首页（内部路由，非外链） */}
          <button onClick={() => navigate("/")}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "7px 11px", borderRadius: 9, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer", flexShrink: 0 }}
            title="返回首页">
            <ArrowLeft size={13} /> 首页
          </button>
        </div>
      </div>

      {/* 面板关闭时的兜底：展示跑马灯 + 重新打开按钮（本页永远不空白） */}
      {!open && (
        <div style={{ position: "absolute", top: TOPBAR_H, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
          <div style={{ width: "min(680px, 90%)" }}><ModelShowcaseCard /></div>
          <button onClick={() => useAiClient.setState({ open: true, minimized: false })}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 12, border: "none", cursor: "pointer", color: "#fff", background: `linear-gradient(135deg, ${ACCENT}, oklch(0.66 0.2 320))`, boxShadow: "0 8px 24px oklch(0.66 0.2 300 / 0.4)" }}>
            <Bot size={18} /> 打开 AI 客户端
          </button>
        </div>
      )}

      {/* 复用画布内同一套 AI 客户端面板（portal 到 body，position:fixed 悬浮） */}
      <AiClientPanel />
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
