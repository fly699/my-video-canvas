import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { X, Sparkles, AlertCircle, AlertTriangle, Info, Target, ImageOff } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";

export interface ConsistencyIssue {
  sceneIndices: number[];
  aspect: string;
  severity: string;
  description: string;
}

export interface ConsistencyResult {
  overallScore: number;
  summary: string;
  issues: ConsistencyIssue[];
  recommendations: string[];
}

interface Props {
  characterName?: string;
  /** Storyboard node IDs in the SAME order as imageUrls passed to the mutation,
   * so sceneIndices in issues can map back to canvas node IDs (for fitView). */
  sceneNodeIds: string[];
  /** Image URLs in the same order — used to render thumbnails in the modal. */
  imageUrls: string[];
  result: ConsistencyResult;
  onClose: () => void;
}

const ASPECT_LABEL: Record<string, string> = {
  hairstyle: "发型",
  outfit: "服装",
  facial: "五官",
  age: "年龄/体型",
  signature: "标志性特征",
  other: "其他",
};

const SEVERITY_STYLE: Record<string, { color: string; bg: string; label: string; icon: typeof AlertCircle }> = {
  high:   { color: "oklch(0.62 0.20 25)",  bg: "oklch(0.62 0.20 25 / 0.12)",  label: "高",  icon: AlertCircle },
  medium: { color: "oklch(0.72 0.18 65)",  bg: "oklch(0.72 0.18 65 / 0.12)",  label: "中",  icon: AlertTriangle },
  low:    { color: "oklch(0.68 0.14 200)", bg: "oklch(0.68 0.14 200 / 0.12)", label: "低",  icon: Info },
};

function scoreColor(score: number): { color: string; bg: string; label: string } {
  if (score >= 85) return { color: "oklch(0.72 0.18 155)", bg: "oklch(0.72 0.18 155 / 0.12)", label: "优秀" };
  if (score >= 70) return { color: "oklch(0.72 0.16 95)",  bg: "oklch(0.72 0.16 95 / 0.12)",  label: "良好" };
  if (score >= 50) return { color: "oklch(0.72 0.18 65)",  bg: "oklch(0.72 0.18 65 / 0.12)",  label: "尚可" };
  return                 { color: "oklch(0.62 0.20 25)",  bg: "oklch(0.62 0.20 25 / 0.12)",  label: "较差" };
}

/**
 * 角色一致性审查结果面板。
 *
 * 数据流：
 * - CharacterNode 调用 trpc.scripts.checkCharacterConsistency → 拿到 result
 * - 同时记录 sceneNodeIds（与 imageUrls 同序）以便 issue 索引 → 节点 ID 映射
 * - 点击 "聚焦此分镜" 按钮 → reactFlow.fitView 到那些 storyboard 节点
 */
export function CharacterConsistencyPanel({
  characterName, sceneNodeIds, imageUrls, result, onClose,
}: Props) {
  const reactFlow = useReactFlow();
  const scoreStyle = scoreColor(result.overallScore);

  const focusScenes = (sceneIndices: number[]) => {
    const nodeIds = sceneIndices
      .map((i) => sceneNodeIds[i])
      .filter((id): id is string => !!id);
    if (nodeIds.length === 0) return;
    const store = useCanvasStore.getState();
    const targets = store.nodes.filter((n) => nodeIds.includes(n.id));
    if (targets.length === 0) return;
    reactFlow.fitView({
      nodes: targets.map((n) => ({ id: n.id })),
      duration: 400,
      padding: 0.4,
    });
    // Highlight by toggling selected flag (uses setNodes so React Flow stays in sync).
    store.setNodes(store.nodes.map((n) => ({ ...n, selected: nodeIds.includes(n.id) })));
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col"
        style={{
          width: "min(820px, 94vw)",
          height: "min(720px, 90vh)",
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          borderRadius: 14,
          boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--c-bd1)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--c-t1)" }}>
              🔍 一致性审查结果
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--c-t3)" }}>
              {characterName ? `角色「${characterName}」` : "角色"} · 跨 {imageUrls.length} 个分镜的视觉连贯性分析
            </p>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{
              width: 26, height: 26, padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "1px solid var(--c-bd2)",
              borderRadius: 6, color: "var(--c-t3)", cursor: "pointer",
            }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div className="nowheel" style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {/* Score */}
          <div
            style={{
              padding: "16px",
              background: scoreStyle.bg,
              border: `1px solid ${scoreStyle.color}40`,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ textAlign: "center", minWidth: 80 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: scoreStyle.color, lineHeight: 1 }}>
                {result.overallScore}
              </div>
              <div style={{ fontSize: 10.5, color: scoreStyle.color, marginTop: 2, fontWeight: 600 }}>
                {scoreStyle.label}
              </div>
            </div>
            <div style={{ flex: 1, fontSize: 12, color: "var(--c-t2)", lineHeight: 1.6 }}>
              {result.summary || "（未提供整体评价）"}
            </div>
          </div>

          {/* Thumbnail strip */}
          <div style={{ marginBottom: 18 }}>
            <h4 style={sectionTitle}>分镜序列（点击聚焦）</h4>
            <div className="flex gap-2 flex-wrap">
              {imageUrls.map((url, i) => {
                const nodeId = sceneNodeIds[i];
                return (
                  <button
                    key={i}
                    onClick={() => nodeId && focusScenes([i])}
                    disabled={!nodeId}
                    style={{
                      position: "relative",
                      width: 84,
                      height: 84,
                      borderRadius: 6,
                      overflow: "hidden",
                      border: "1px solid var(--c-bd2)",
                      cursor: nodeId ? "pointer" : "default",
                      padding: 0,
                      background: "var(--c-input)",
                      transition: "transform 150ms ease, border-color 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (nodeId) {
                        (e.currentTarget as HTMLElement).style.transform = "scale(1.04)";
                        (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.6)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)";
                    }}
                  >
                    <img
                      src={url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url}
                      alt={`分镜 ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 2, left: 2,
                        background: "oklch(0 0 0 / 0.6)",
                        color: "white",
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 99,
                        fontWeight: 600,
                      }}
                    >
                      #{i + 1}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Issues */}
          <div style={{ marginBottom: 18 }}>
            <h4 style={sectionTitle}>
              发现的问题 <span style={{ color: "var(--c-t4)", fontWeight: 400 }}>({result.issues.length})</span>
            </h4>
            {result.issues.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  background: "oklch(0.72 0.18 155 / 0.08)",
                  border: "1px solid oklch(0.72 0.18 155 / 0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "oklch(0.72 0.18 155)",
                  textAlign: "center",
                }}
              >
                <Sparkles style={{ width: 14, height: 14, display: "inline", marginRight: 4 }} />
                未发现明显的不一致问题
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {result.issues.map((issue, i) => {
                  const sev = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.medium;
                  const SevIcon = sev.icon;
                  return (
                    <div
                      key={i}
                      style={{
                        padding: "10px 12px",
                        background: "var(--c-surface)",
                        border: `1px solid ${sev.color}40`,
                        borderLeft: `3px solid ${sev.color}`,
                        borderRadius: 8,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <SevIcon style={{ width: 14, height: 14, color: sev.color, flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
                            <span
                              style={{
                                padding: "1px 7px",
                                fontSize: 10,
                                background: sev.bg,
                                color: sev.color,
                                borderRadius: 99,
                                fontWeight: 700,
                              }}
                            >
                              {sev.label}级
                            </span>
                            <span
                              style={{
                                padding: "1px 7px",
                                fontSize: 10,
                                background: "var(--c-elevated)",
                                color: "var(--c-t3)",
                                borderRadius: 99,
                                fontWeight: 500,
                              }}
                            >
                              {ASPECT_LABEL[issue.aspect] ?? issue.aspect}
                            </span>
                            <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>
                              涉及分镜 {issue.sceneIndices.map((i) => `#${i + 1}`).join(" / ")}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--c-t2)", lineHeight: 1.5 }}>
                            {issue.description}
                          </p>
                          {issue.sceneIndices.length > 0 && (
                            <button
                              onClick={() => focusScenes(issue.sceneIndices)}
                              style={{
                                marginTop: 6,
                                padding: "3px 9px",
                                fontSize: 10.5,
                                background: "transparent",
                                border: `1px solid ${sev.color}60`,
                                borderRadius: 99,
                                color: sev.color,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontWeight: 500,
                              }}
                            >
                              <Target style={{ width: 10, height: 10 }} />
                              聚焦这些分镜
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div>
              <h4 style={sectionTitle}>改进建议</h4>
              <ul style={{ margin: 0, padding: "0 0 0 20px", fontSize: 12, color: "var(--c-t2)", lineHeight: 1.7 }}>
                {result.recommendations.map((rec, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          {imageUrls.length === 0 && (
            <div className="flex flex-col items-center justify-center" style={{ padding: 30, color: "var(--c-t4)" }}>
              <ImageOff style={{ width: 32, height: 32, opacity: 0.5, marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12 }}>没有分镜可用于分析</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-t3)",
};
