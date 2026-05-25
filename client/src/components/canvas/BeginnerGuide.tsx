import { useState, useEffect } from "react";
import {
  X, Sparkles, Layers, Wand2, Video, Boxes, Bot, Users, ScrollText, Activity,
  Shield, ArrowRight,
} from "lucide-react";
import type { NodeType } from "../../../../shared/types";
import { getNodeConfig } from "../../lib/nodeConfig";
import {
  CONNECTION_HINTS,
  getCompatibleTargets,
  getCompatibleSources,
} from "../../lib/connectionRules";

const STORAGE_KEY = "avc:guide-seen";

const FLOW_STEPS: { type: NodeType; label: string }[] = [
  { type: "script", label: "脚本" },
  { type: "storyboard", label: "分镜" },
  { type: "image_gen", label: "图像" },
  { type: "video_task", label: "视频" },
];

// 药丸组件
function NodePill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        border: `1px solid ${color.replace(")", " / 0.3)")}`,
        background: color.replace(")", " / 0.1)"),
        color: color,
        whiteSpace: "nowrap" as const,
      }}
    >
      {label}
    </span>
  );
}

function WelcomeModal({ onClose }: { onClose: () => void }) {
  const [dontShow, setDontShow] = useState(false);

  function handleDismiss() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  }

  // 8 大核心工具（2 列 × 4 行布局，呼应图1）
  const features = [
    { Icon: Layers, color: "oklch(0.68 0.22 285)",
      title: "节点式工作流", desc: "脚本 / 分镜 / 提示词 / 图像 / 视频 / 剪辑节点自由编排，可视化连线" },
    { Icon: Wand2, color: "oklch(0.72 0.20 330)",
      title: "AI 图像生成", desc: "Manus Forge、Poyo、Higgsfield Soul / Flux Pro / Seedream 多模型支持" },
    { Icon: Video, color: "oklch(0.62 0.20 25)",
      title: "AI 视频生成", desc: "Higgsfield DoP、Poyo Seedance / Veo / Kling / Wan / Runway 等 12+ 模型" },
    { Icon: Boxes, color: "oklch(0.68 0.20 100)",
      title: "ComfyUI 自建集成", desc: "对接自建 ComfyUI 服务器，txt2img / img2img / AnimateDiff / SVD",
      badge: "NEW" },
    { Icon: Bot, color: "oklch(0.70 0.18 200)",
      title: "大模型对话", desc: "Claude Sonnet 4.6、Gemini 2.5、GPT-5.2，写脚本 / 润色 / 审查 / 多版本" },
    { Icon: ScrollText, color: "oklch(0.62 0.18 240)",
      title: "ScriptNode 高级 AI", desc: "场景细化、剧本审查、多版本生成、对白提取、Mood Board 等 7 项工具",
      badge: "PRO" },
    { Icon: Activity, color: "oklch(0.65 0.20 160)",
      title: "工作流状态面板", desc: "一键运行整条工作流，右侧面板实时展示每个节点进度、耗时、错误",
      badge: "NEW" },
    { Icon: Users, color: "oklch(0.66 0.18 140)",
      title: "多人实时协作", desc: "多用户同时编辑，节点变更秒同步，协作者光标可见" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        backgroundColor: "oklch(0.05 0.007 260 / 0.7)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 660,
          maxWidth: "100%",
          maxHeight: "92vh",
          backgroundColor: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.6)",
          overflow: "hidden",
        }}
      >
        {/* ── Hero banner ────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            padding: "20px 24px 24px",
            background: "linear-gradient(135deg, oklch(0.12 0.025 285) 0%, oklch(0.08 0.012 285) 100%)",
            borderBottom: "1px solid var(--c-bd2)",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Decorative glow */}
          <div
            style={{
              position: "absolute", top: -80, right: -80, width: 240, height: 240,
              borderRadius: "50%", pointerEvents: "none",
              background: "radial-gradient(circle, oklch(0.68 0.22 285 / 0.25) 0%, transparent 70%)",
            }}
          />
          {/* Close button */}
          <button
            onClick={handleDismiss}
            aria-label="关闭"
            style={{
              position: "absolute", top: 12, right: 12, zIndex: 2,
              width: 28, height: 28, borderRadius: 6, border: "none",
              background: "transparent", color: "var(--c-t3)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X size={16} />
          </button>

          <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
            {/* Brand logo */}
            <div
              style={{
                width: 56, height: 56, borderRadius: 12, flexShrink: 0,
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 6px 20px oklch(0.68 0.22 285 / 0.4)",
              }}
            >
              <Sparkles size={26} color="white" strokeWidth={2.2} />
            </div>

            {/* Title block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--c-t1)", letterSpacing: "-0.01em" }}>
                  AI 视频画布
                </h1>
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 6,
                    fontSize: 11, fontWeight: 600,
                    background: "oklch(0.68 0.22 285 / 0.18)",
                    color: "oklch(0.82 0.16 285)",
                    border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  }}
                >
                  <Sparkles size={11} />
                  v1.0 · 全新发布
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--c-t3)", marginBottom: 10 }}>
                专业 · AI 影视创作工作流 · 由 AI Video Canvas 出品
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--c-t2)" }}>
                支持 <Hl>23+ 种专业节点</Hl>、覆盖<Hl>脚本创作</Hl>、<Hl>AI 图像生成</Hl>、
                <Hl>视频任务</Hl>、<Hl>智能剪辑</Hl> 全流程，全新集成{" "}
                <Hl strong>ComfyUI 自建服务器</Hl> 与{" "}
                <Hl strong>多模型并行对比</Hl> 正式上线。
              </p>
            </div>
          </div>
        </div>

        {/* ── 8 core tools grid ──────────────────────────────────────── */}
        <div
          style={{
            flex: 1, overflowY: "auto",
            padding: "18px 24px 16px",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--c-t3)" }}>
            核心功能 · <span style={{ color: "var(--c-t2)", fontWeight: 600 }}>8 大工具</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {features.map((f) => (
              <div
                key={f.title}
                style={{
                  position: "relative",
                  padding: "12px 14px",
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-bd1)",
                  borderRadius: 10,
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = `${f.color}50`;
                  (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd1)";
                  (e.currentTarget as HTMLElement).style.background = "var(--c-surface)";
                }}
              >
                {f.badge && (
                  <span
                    style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "1px 6px", borderRadius: 4,
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                      background: `${f.color}26`,
                      color: f.color,
                      border: `1px solid ${f.color}48`,
                    }}
                  >
                    {f.badge}
                  </span>
                )}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: `${f.color}18`,
                      border: `1px solid ${f.color}32`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <f.Icon size={16} color={f.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)", marginBottom: 3 }}>
                      {f.title}
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.55, color: "var(--c-t4)" }}>
                      {f.desc}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Copyright block (style from reference image 2) ────────── */}
          <div
            style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "12px 14px",
              background: "oklch(0.65 0.20 160 / 0.06)",
              border: "1px solid oklch(0.65 0.20 160 / 0.30)",
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            <Shield size={16} color="oklch(0.70 0.18 160)" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.7, color: "var(--c-t3)" }}>
              <span style={{ color: "oklch(0.78 0.16 160)", fontWeight: 700 }}>
                © AI Video Canvas（AI 视频画布）
              </span>{" "}
              版权所有。本工具由 AI Video Canvas 团队自主研发，所有模板、预设库及界面设计均受版权保护。
              未经授权，禁止复制或商业使用。
            </p>
          </div>
        </div>

        {/* ── Footer: checkbox + dual buttons ────────────────────────── */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 24px",
            borderTop: "1px solid var(--c-bd2)",
            background: "var(--c-base)",
            flexShrink: 0,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--c-t3)", cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "oklch(0.68 0.22 285)" }}
            />
            不再显示此欢迎页
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleDismiss}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 8,
                background: "var(--c-surface)",
                border: "1px solid var(--c-bd2)",
                color: "var(--c-t2)",
                fontSize: 13, fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
            >
              查看新功能
              <ArrowRight size={12} />
            </button>
            <button
              onClick={handleDismiss}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 18px", borderRadius: 8,
                background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
                border: "none",
                color: "white",
                fontSize: 13, fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 0 0 1px oklch(0.68 0.22 285 / 0.4), 0 4px 16px oklch(0.68 0.22 285 / 0.3)",
              }}
            >
              <Sparkles size={13} />
              开始创作
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline highlight for hero text — orange for plain, purple-strong for big features
function Hl({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      style={{
        color: strong ? "oklch(0.82 0.16 285)" : "oklch(0.80 0.18 65)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function ConnectionHintsPanel({
  visible,
  selectedNodeType,
  onClose,
}: {
  visible: boolean;
  selectedNodeType: NodeType | null;
  onClose: () => void;
}) {
  const hints = selectedNodeType ? CONNECTION_HINTS[selectedNodeType] : null;
  const compatibleTargets = selectedNodeType
    ? getCompatibleTargets(selectedNodeType)
    : [];
  const compatibleSources = selectedNodeType
    ? getCompatibleSources(selectedNodeType)
    : [];

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 8,
        width: 240,
        zIndex: 100,
        transform: visible ? "translateX(0)" : "translateX(260px)",
        transition: "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
        backgroundColor: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 10,
        backdropFilter: "blur(12px)",
        overflow: "hidden",
        boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--c-bd2)",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--c-t1)",
          }}
        >
          连线指引
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--c-t3)",
            display: "flex",
            alignItems: "center",
            padding: 2,
            borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxHeight: "calc(100vh - 140px)",
          overflowY: "auto",
        }}
      >
        {hints ? (
          <>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: getNodeConfig(selectedNodeType!).color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--c-t1)",
                  }}
                >
                  {hints.label}
                </span>
              </div>

              {compatibleTargets.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--c-t3)",
                      marginBottom: 5,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    → 可输出到
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {compatibleTargets.map((t) => {
                      const cfg = getNodeConfig(t);
                      return (
                        <div
                          key={t}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              backgroundColor: cfg.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--c-t2)",
                            }}
                          >
                            {CONNECTION_HINTS[t].label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {compatibleSources.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--c-t3)",
                      marginBottom: 5,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    ← 可接收自
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {compatibleSources.map((s) => {
                      const cfg = getNodeConfig(s);
                      return (
                        <div
                          key={s}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              backgroundColor: cfg.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--c-t2)",
                            }}
                          >
                            {CONNECTION_HINTS[s].label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--c-t2)",
                marginBottom: 10,
              }}
            >
              标准工作流
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(
                [
                  "script",
                  "storyboard",
                  "image_gen",
                  "video_task",
                  "clip",
                ] as NodeType[]
              ).map((type, i, arr) => {
                const cfg = getNodeConfig(type);
                return (
                  <div key={type}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor: cfg.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{ fontSize: 12, color: "var(--c-t2)" }}
                      >
                        {CONNECTION_HINTS[type].label}
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <div
                        style={{
                          marginLeft: 4,
                          paddingLeft: 0,
                          color: "var(--c-t4)",
                          fontSize: 12,
                          lineHeight: 1,
                          marginTop: 2,
                          marginBottom: 2,
                        }}
                      >
                        ↓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid var(--c-bd2)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--c-t3)",
                  marginBottom: 6,
                }}
              >
                辅助流
              </div>
              {(
                [
                  { from: "audio" as NodeType, to: "clip" as NodeType },
                  { from: "character" as NodeType, to: "storyboard" as NodeType },
                ] as { from: NodeType; to: NodeType }[]
              ).map(({ from, to }) => {
                const fromCfg = getNodeConfig(from);
                const toCfg = getNodeConfig(to);
                return (
                  <div
                    key={`${from}-${to}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: fromCfg.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 11, color: "var(--c-t2)" }}
                    >
                      {CONNECTION_HINTS[from].label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--c-t4)" }}>
                      →
                    </span>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: toCfg.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 11, color: "var(--c-t2)" }}
                    >
                      {CONNECTION_HINTS[to].label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div
          style={{
            paddingTop: 10,
            borderTop: "1px solid var(--c-bd2)",
            fontSize: 11,
            color: "var(--c-t3)",
          }}
        >
          拖动节点端点即可连线
        </div>
      </div>
    </div>
  );
}

export function BeginnerGuide({ onShowPanel }: { onShowPanel?: () => void }) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setShowModal(true);
    }
  }, []);

  if (!showModal) return null;

  return <WelcomeModal onClose={() => setShowModal(false)} />;
}

export { WelcomeModal };
