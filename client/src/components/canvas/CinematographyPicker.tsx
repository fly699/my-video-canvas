import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import {
  CINEMATOGRAPHY_TEMPLATES,
  CINEMATOGRAPHY_CATEGORIES,
  providerSupportsNativeCameraMotion,
  type CinematographyTemplate,
  type CinematographyCategory,
} from "../../lib/cinematographyTemplates";

interface Props {
  /** Current provider (video model). Determines whether native camera_motion
   * params actually apply, or whether the template only injects prompt text. */
  provider: string;
  /** ID of the currently active template (if any) — gets a "已选" check mark. */
  activeTemplateId?: string | null;
  onSelect: (template: CinematographyTemplate) => void;
  onClear?: () => void;
  onClose: () => void;
}

/**
 * Modal cinematography template picker. Categories tab on the left, card grid
 * on the right. Card shows emoji + label + EN subtitle + description; clicking
 * a card calls onSelect and closes the modal.
 *
 * Cards for templates that don't have a native camera_motion mapping for the
 * current provider show a small "仅 Prompt 注入" hint, so the user understands
 * the model will rely on prompt language rather than a structured parameter.
 */
export function CinematographyPicker({ provider, activeTemplateId, onSelect, onClear, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<CinematographyCategory>("推拉");
  const supportsNative = providerSupportsNativeCameraMotion(provider);

  const filtered = CINEMATOGRAPHY_TEMPLATES.filter((t) => t.category === activeCategory);
  const counts: Record<string, number> = {};
  for (const t of CINEMATOGRAPHY_TEMPLATES) counts[t.category] = (counts[t.category] ?? 0) + 1;

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
          width: "min(900px, 92vw)",
          height: "min(620px, 86vh)",
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
              🎬 运镜模板库
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--c-t3)" }}>
              {supportsNative
                ? "当前模型支持原生 camera_motion，模板会同步应用结构化参数 + prompt 注入"
                : "当前模型不支持原生 camera_motion，模板仅注入 prompt 自然语言（依赖模型理解）"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {activeTemplateId && onClear && (
              <button
                onClick={() => { onClear(); onClose(); }}
                title="清除运镜模板"
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  background: "transparent",
                  border: "1px solid var(--c-bd2)",
                  borderRadius: 6,
                  color: "var(--c-t3)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.20 25)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
              >
                清除
              </button>
            )}
            <button
              onClick={onClose}
              title="关闭"
              style={{
                width: 26, height: 26, padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--c-bd2)",
                borderRadius: 6,
                color: "var(--c-t3)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Body — categories sidebar + grid */}
        <div className="flex" style={{ flex: 1, minHeight: 0 }}>
          {/* Sidebar */}
          <div
            style={{
              width: 130,
              flexShrink: 0,
              borderRight: "1px solid var(--c-bd1)",
              padding: "8px 4px",
              overflowY: "auto",
            }}
          >
            {CINEMATOGRAPHY_CATEGORIES.map((cat) => {
              const isActive = cat === activeCategory;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 12,
                    background: isActive ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${isActive ? "oklch(0.68 0.22 285)" : "transparent"}`,
                    color: isActive ? "oklch(0.78 0.18 285)" : "var(--c-t2)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontWeight: isActive ? 600 : 400,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background 120ms ease, color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <span>{cat}</span>
                  <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{counts[cat] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Card grid */}
          <div
            className="nowheel"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
              alignContent: "start",
            }}
          >
            {filtered.map((t) => {
              const isActive = activeTemplateId === t.id;
              const hasNativeMap =
                (provider.startsWith("hf_dop_") && !!t.providerParams.higgsfield) ||
                (provider === "poyo_seedance" && !!t.providerParams.seedance);
              return (
                <button
                  key={t.id}
                  onClick={() => { onSelect(t); onClose(); }}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: isActive ? "oklch(0.68 0.22 285 / 0.08)" : "var(--c-surface)",
                    border: `1px solid ${isActive ? "oklch(0.68 0.22 285 / 0.5)" : "var(--c-bd2)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    transition: "transform 150ms ease, border-color 150ms ease, background 150ms ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.transform = "translateY(-1px)";
                    if (!isActive) el.style.borderColor = "var(--c-t4)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.transform = "translateY(0)";
                    if (!isActive) el.style.borderColor = "var(--c-bd2)";
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{t.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-t1)" }}>
                          {t.label}
                        </span>
                        {isActive && <Check style={{ width: 12, height: 12, color: "oklch(0.78 0.18 285)" }} />}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{t.englishLabel}</span>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--c-t3)", lineHeight: 1.45 }}>
                    {t.description}
                  </p>
                  <div className="flex items-center justify-between" style={{ marginTop: 2 }}>
                    {t.recommendedScenarios && t.recommendedScenarios.length > 0 && (
                      <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>
                        适合：{t.recommendedScenarios.join("/")}
                      </span>
                    )}
                    {supportsNative && hasNativeMap && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 99,
                          background: "oklch(0.72 0.18 155 / 0.18)",
                          color: "oklch(0.72 0.18 155)",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        原生支持
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
