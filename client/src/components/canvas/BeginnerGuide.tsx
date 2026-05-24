import { useState, useEffect } from "react";
import { X, PenLine, Sparkles, Scissors } from "lucide-react";
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
  function handleClose() {
    localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  }

  const coreFlow = [
    { label: "脚本", color: "oklch(0.62 0.18 240)" },
    { label: "分镜", color: "oklch(0.65 0.20 160)" },
    { label: "图像生成", color: "oklch(0.72 0.20 330)" },
    { label: "视频任务", color: "oklch(0.62 0.20 25)" },
    { label: "剪辑", color: "oklch(0.68 0.20 55)" },
  ];

  const nodeCategories = [
    {
      title: "创作层",
      nodes: [
        { label: "脚本", color: "oklch(0.62 0.18 240)" },
        { label: "分镜", color: "oklch(0.65 0.20 160)" },
        { label: "提示词", color: "oklch(0.68 0.22 300)" },
        { label: "AI对话", color: "oklch(0.70 0.18 200)" },
        { label: "便签", color: "oklch(0.60 0.10 90)" },
        { label: "角色/场景", color: "oklch(0.66 0.18 140)" },
      ],
    },
    {
      title: "生成层",
      nodes: [
        { label: "图像生成", color: "oklch(0.72 0.20 330)" },
        { label: "视频任务", color: "oklch(0.62 0.20 25)" },
        { label: "素材", color: "oklch(0.65 0.18 60)" },
        { label: "音频", color: "oklch(0.68 0.20 340)" },
        { label: "构图控制", color: "oklch(0.65 0.20 310)" },
      ],
    },
    {
      title: "后期层",
      nodes: [
        { label: "剪辑", color: "oklch(0.68 0.20 55)" },
        { label: "合并", color: "oklch(0.62 0.20 270)" },
        { label: "叠加", color: "oklch(0.65 0.18 30)" },
        { label: "字幕", color: "oklch(0.65 0.18 170)" },
        { label: "动态字幕", color: "oklch(0.68 0.20 175)" },
        { label: "智能剪辑", color: "oklch(0.68 0.22 65)" },
        { label: "后处理", color: "oklch(0.65 0.18 190)" },
      ],
    },
    {
      title: "高级层",
      nodes: [
        { label: "声音克隆", color: "oklch(0.65 0.18 350)" },
        { label: "唇形同步", color: "oklch(0.62 0.20 220)" },
        { label: "数字人", color: "oklch(0.65 0.20 290)" },
      ],
    },
  ];

  const shortcuts = [
    { action: "添加节点", key: '点击"添加"按钮' },
    { action: "连接节点", key: "拖拽连接点" },
    { action: "撤销重做", key: "Ctrl+Z / Y" },
    { action: "搜索节点", key: "Ctrl+K" },
    { action: "运行工作流", key: '点击"运行"' },
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
      }}
    >
      <div
        style={{
          width: 580,
          maxHeight: "80vh",
          backgroundColor: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.6)",
          overflow: "hidden",
        }}
      >
        {/* Hero 区 */}
        <div
          style={{
            height: 80,
            background: "linear-gradient(135deg, oklch(0.68 0.22 285 / 0.18), oklch(0.60 0.20 310 / 0.12))",
            borderBottom: "1px solid var(--c-bd2)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--c-t1)",
            }}
          >
            AI 视频画布
          </div>
          <div style={{ fontSize: 12, color: "var(--c-t3)" }}>
            21 种节点 · 全流程可视化创作
          </div>
        </div>

        {/* 主体内容（可滚动） */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* 核心工作流 */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--c-t3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              核心工作流
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {coreFlow.map((step, i) => (
                <div
                  key={step.label}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      backgroundColor: step.color.replace(")", " / 0.12)"),
                      border: `1.5px solid ${step.color.replace(")", " / 0.35)")}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      color: step.color,
                      textAlign: "center",
                      lineHeight: 1.2,
                    }}
                  >
                    {step.label}
                  </div>
                  {i < coreFlow.length - 1 && (
                    <div style={{ fontSize: 16, color: "var(--c-t4)", lineHeight: 1 }}>
                      →
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 全部节点 */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--c-t3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              全部节点
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {nodeCategories.map((cat) => (
                <div
                  key={cat.title}
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-bd1)",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--c-t2)",
                      marginBottom: 8,
                    }}
                  >
                    {cat.title}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {cat.nodes.map((node) => (
                      <NodePill key={node.label} label={node.label} color={node.color} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 快捷键提示 */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--c-t3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              快捷键提示
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 6,
              }}
            >
              {shortcuts.map((s) => (
                <div
                  key={s.action}
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-bd1)",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--c-t3)", marginBottom: 2 }}>
                    {s.action}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--c-t2)" }}>
                    {s.key}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部按钮区 */}
        <div
          style={{
            borderTop: "1px solid var(--c-bd2)",
            padding: "16px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleClose}
            style={{
              width: "100%",
              padding: "11px 0",
              borderRadius: 8,
              border: "none",
              backgroundColor: "oklch(0.68 0.22 285)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            开始使用
          </button>
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--c-t3)",
              fontSize: 12,
              cursor: "pointer",
              padding: "2px 8px",
            }}
          >
            不再显示
          </button>
        </div>
      </div>
    </div>
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
