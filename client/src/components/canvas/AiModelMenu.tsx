import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Bot, Server, KeyRound, Sparkles } from "lucide-react";
import { platformBadge, modelGroupOrder, type LLMModelMeta } from "@/lib/models";

// ── AI 客户端专用「二级展开」模型选择器 ──────────────────────────────────────
// 把长长的模型池按「自建/本地 › 自定义密钥 › Claude › GPT › Gemini …」分组，
// 每组一个可折叠的二级菜单（默认展开当前模型所在组），组内再列具体型号
// （色点 + 名称 + 计价 + 来源平台徽标 + 标签 + 选中勾）。替代原生 <select>。

const ACCENT = "oklch(0.70 0.20 300)";

// 分组顺序：自建/本地置顶（管理员自配基建），自定义密钥次之，其后各官方家族。
const CAT_ORDER = ["自建 / 本地", "自定义密钥", "Claude", "GPT", "Gemini", "Qwen"];

type CatMeta = { color: string; Icon: typeof Bot; hint: string };
const CAT_META: Record<string, CatMeta> = {
  "自建 / 本地": { color: "oklch(0.70 0.16 200)", Icon: Server, hint: "自建 vLLM / 本机桥接，零云成本" },
  "自定义密钥": { color: "oklch(0.68 0.18 320)", Icon: KeyRound, hint: "自带 OpenAI / Anthropic 官方密钥" },
  Claude: { color: "oklch(0.68 0.18 280)", Icon: Sparkles, hint: "Anthropic Claude 系" },
  GPT: { color: "oklch(0.62 0.16 240)", Icon: Sparkles, hint: "OpenAI GPT / Grok / Codex 系" },
  Gemini: { color: "oklch(0.68 0.18 160)", Icon: Sparkles, hint: "Google Gemini 系" },
  Qwen: { color: "oklch(0.70 0.16 200)", Icon: Sparkles, hint: "通义千问 / 其它" },
};

function categoryOf(m: LLMModelMeta): string {
  if (m.provider === "SelfHosted") return "自建 / 本地";
  if (m.provider === "Custom") return "自定义密钥";
  return m.family;
}

interface Props {
  value: string;
  options: LLMModelMeta[];
  onChange: (id: string) => void;
}

export function AiModelMenu({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);

  const current = options.find((m) => m.id === value);
  const currentColor = current?.color ?? ACCENT;

  // 分组 + 组内按来源平台优先级排序（内置先于 kie）。
  const groups = useMemo(() => {
    const byCat = new Map<string, LLMModelMeta[]>();
    for (const m of options) {
      const c = categoryOf(m);
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(m);
    }
    const ordered: { cat: string; items: LLMModelMeta[] }[] = [];
    const seen = new Set<string>();
    for (const cat of CAT_ORDER) {
      const items = byCat.get(cat);
      if (items && items.length) { ordered.push({ cat, items }); seen.add(cat); }
    }
    // 兜底：未在 CAT_ORDER 里的分组按出现顺序补在末尾。
    for (const [cat, items] of Array.from(byCat)) if (!seen.has(cat)) ordered.push({ cat, items });
    for (const g of ordered) g.items.sort((a, b) => modelGroupOrder(a.provider) - modelGroupOrder(b.provider));
    return ordered;
  }, [options]);

  // 展开状态：默认展开当前模型所在组；打开菜单时重算。
  const currentCat = current ? categoryOf(current) : groups[0]?.cat;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setExpanded(new Set(currentCat ? [currentCat] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleCat = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        className="nodrag"
        title={`当前模型：${current?.label ?? value}`}
        style={{
          marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 210,
          fontSize: 11.5, fontWeight: 600, padding: "4px 8px", borderRadius: 8,
          background: "var(--c-input)", border: `1px solid ${open ? `${currentColor}70` : "var(--c-bd2)"}`,
          color: "var(--c-t2)", cursor: "pointer", outline: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: currentColor, flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.label ?? value}</span>
        <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }} />
      </button>

      {open && btnRect && createPortal(
        (() => {
          const GAP = 6, MIN_H = 200, MAX_H = 460, W = 320;
          const spaceBelow = window.innerHeight - btnRect.bottom - GAP;
          const spaceAbove = btnRect.top - GAP;
          const openDown = spaceBelow >= spaceAbove;
          const maxH = Math.max(MIN_H, Math.min(MAX_H, (openDown ? spaceBelow : spaceAbove) - 4));
          const vpos = openDown ? { top: btnRect.bottom + GAP } : { bottom: window.innerHeight - btnRect.top + GAP };
          return (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99990 }}
                onMouseDown={(e) => { if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }} />
              <div className="nodrag nowheel"
                style={{
                  position: "fixed", zIndex: 99991, ...vpos,
                  left: Math.max(8, Math.min(btnRect.left, window.innerWidth - W - 8)),
                  width: W, maxHeight: maxH, overflowY: "auto",
                  background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14,
                  boxShadow: "0 16px 48px oklch(0 0 0 / 0.55)",
                }}>
                <div style={{
                  position: "sticky", top: 0, zIndex: 2, background: "var(--c-base)",
                  padding: "9px 12px 7px", borderBottom: "1px solid var(--c-bd1)",
                  fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--c-t4)",
                }}>
                  选择 AI 模型 · 按类展开
                </div>
                {groups.map(({ cat, items }) => {
                  const meta = CAT_META[cat] ?? { color: ACCENT, Icon: Bot, hint: "" };
                  const isOpen = expanded.has(cat);
                  const hasCurrent = current ? categoryOf(current) === cat : false;
                  return (
                    <div key={cat} style={{ borderBottom: "1px solid var(--c-bd1)" }}>
                      {/* 一级：分组头（可折叠） */}
                      <button onMouseDown={(e) => { e.stopPropagation(); toggleCat(cat); }} className="nodrag"
                        title={meta.hint}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px",
                          border: "none", cursor: "pointer", textAlign: "left",
                          background: isOpen ? `color-mix(in oklch, ${meta.color} 8%, transparent)` : "transparent",
                        }}>
                        <span style={{ display: "inline-flex", width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 6, background: `color-mix(in oklch, ${meta.color} 18%, transparent)`, color: meta.color, flexShrink: 0 }}>
                          <meta.Icon size={12} />
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t1)" }}>{cat}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--c-t4)", background: "var(--c-bd1)", borderRadius: 20, padding: "1px 6px" }}>{items.length}</span>
                        {hasCurrent && !isOpen && (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
                        )}
                        <span style={{ flex: 1 }} />
                        <ChevronDown size={14} style={{ color: "var(--c-t3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }} />
                      </button>
                      {/* 二级：组内型号 */}
                      {isOpen && items.map((m) => {
                        const selected = m.id === value;
                        const badge = platformBadge(m.provider);
                        return (
                          <button key={m.id} onMouseDown={(e) => { e.stopPropagation(); onChange(m.id); setOpen(false); }} className="nodrag"
                            style={{
                              display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 12px 8px 22px",
                              border: "none", cursor: "pointer", textAlign: "left",
                              background: selected ? `${m.color}18` : "transparent",
                            }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11.5, fontWeight: selected ? 700 : 500, color: selected ? "var(--c-t1)" : "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {m.label}
                              </div>
                              {/* 计价：有 costNote 显示精确点数（kie 系）；否则回退计费档（Forge/Poyo/自定义
                                  等按 token 计费、无固定点数）——保证每个模型都能看到费用信息，不再只有 kie 有。 */}
                              <div style={{ fontSize: 8.5, color: "var(--c-t4)", marginTop: 1, fontWeight: 600 }}>
                                {m.costNote ? `${m.costNote} 点/百万tokens` : `计费档：${m.costTier}（按 tokens）`}
                              </div>
                            </div>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: badge.bg, color: badge.fg, letterSpacing: "0.04em", flexShrink: 0 }}>{m.provider}</span>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: selected ? `${m.color}25` : "var(--c-bd1)", color: selected ? m.color : "var(--c-t4)", letterSpacing: "0.04em", flexShrink: 0 }}>{m.tag}</span>
                            {selected && <Check size={12} style={{ color: m.color, flexShrink: 0 }} />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })(),
        document.body,
      )}
    </>
  );
}
