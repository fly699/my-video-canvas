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
  { type: "storyboard", label: "分镖" },
  { type: "image_gen", label: "图像" },
  { type: "video_task", label: "视频" },
];

function WelcomeModal({ onClose }: { onClose: () => void }) {
  function handleClose() {
    localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  }

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
          width: 480,
          backgroundColor: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 16,
          padding: "32px 36px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          boxShadow: "0 24px 64px oklch(0 0 0 / 0.6)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "var(--c-t1)",
              marginBottom: 6,
            }}
          >
            欢迎使用 AI 视频画布
          </div>
          <div style={{ fontSize: 14, color: "var(--c-t3)" }}>
            三步掌握工作流
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            {
              icon: <PenLine size={15} />,
              color: "oklch(0.62 0.14 250)",
              title: "创作内容",
              desc: "添加脚本节点，写下你的视频创意或故事",
            },
            {
              icon: <Sparkles size={15} />,
              color: "oklch(0.62 0.14 145)",
              title: "生成素材",
              desc: "连接分镖 → 图像生成 → 视频任务，AI 自动生成画面",
            },
            {
              icon: <Scissors size={15} />,
              color: "oklch(0.62 0.16 30)",
              title: "剪辑输出",
              desc: "用剪辑节点修剪时长、调整速度、混合音频",
            },
          ].map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                backgroundColor: "var(--c-surface)",
                border: "1px solid var(--c-bd2)",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: `${step.color.replace(")", " / 0.12)")}`,
                  border: `1px solid ${step.color.replace(")", " / 0.28)")}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: step.color,
                  flexShrink: 0,
                }}
              >
                {step.icon}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--c-t1)",
                    marginBottom: 3,
                  }}
                >
                  {step.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--c-t3)" }}>
                  {step.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {FLOW_STEPS.map((step, i) => {
            const cfg = getNodeConfig(step.type);
            return (
              <div
                key={step.type}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    backgroundColor: `color-mix(in oklch, ${cfg.color} 14%, transparent)`,
                    border: `1.5px solid color-mix(in oklch, ${cfg.color} 40%, transparent)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: cfg.color,
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}
                >
                  {step.label}
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <div
                    style={{
                      fontSize: 18,
                      color: "var(--c-t4)",
                      lineHeight: 1,
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "center",
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
              color: "var(--c-t1)",
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
        backgroundColor: "oklch(0.10 0.007 260 / 0.97)",
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
