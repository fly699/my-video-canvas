// #175 模型动图卡片：展示已接入的各家大模型（ChatGPT/Claude/Grok/Gemini/Qwen…），
// 炫酷现代、循环滚动。纯前端、无外部资源（品牌用文字 + 品牌色渐变芯片 + 跑马灯动画）。
import { LLM_MODELS } from "@/lib/models";

interface Brand { key: string; label: string; c1: string; c2: string; emoji: string }
// 品牌 → 展示（按 family 归并；颜色取品牌色调）。
const BRANDS: Brand[] = [
  { key: "GPT", label: "ChatGPT", c1: "oklch(0.72 0.15 165)", c2: "oklch(0.62 0.13 190)", emoji: "✦" },
  { key: "Claude", label: "Claude", c1: "oklch(0.72 0.16 45)", c2: "oklch(0.66 0.19 30)", emoji: "✳" },
  { key: "Grok", label: "Grok", c1: "oklch(0.78 0.02 260)", c2: "oklch(0.5 0.02 260)", emoji: "𝕏" },
  { key: "Gemini", label: "Gemini", c1: "oklch(0.72 0.16 250)", c2: "oklch(0.66 0.18 300)", emoji: "✧" },
  { key: "Qwen", label: "通义千问", c1: "oklch(0.7 0.17 300)", c2: "oklch(0.62 0.2 330)", emoji: "☯" },
];

/** 已接入的品牌（按 LLM_MODELS 实际 family 过滤，避免展示未接入的）。 */
function activeBrands(): Brand[] {
  const fams = new Set(LLM_MODELS.filter((m) => !m.hidden).map((m) => m.family));
  // Grok 归在 GPT family 下（models.ts），单独判断 label 含 Grok 的模型是否存在。
  const hasGrok = LLM_MODELS.some((m) => !m.hidden && /grok/i.test(m.label));
  return BRANDS.filter((b) => (b.key === "Grok" ? hasGrok : fams.has(b.key as never)));
}

function Chip({ b }: { b: Brand }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0,
      padding: "10px 18px", borderRadius: 999, fontSize: 15, fontWeight: 700, color: "#fff",
      background: `linear-gradient(135deg, ${b.c1}, ${b.c2})`,
      boxShadow: `0 6px 20px color-mix(in oklch, ${b.c1} 40%, transparent)`,
      whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 17 }}>{b.emoji}</span>{b.label}
    </span>
  );
}

export function ModelShowcaseCard({ compact = false }: { compact?: boolean }) {
  const brands = activeBrands();
  const loop = [...brands, ...brands]; // 两遍拼接做无缝跑马灯
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 18,
      padding: compact ? "16px 0" : "26px 0",
      background: "radial-gradient(120% 140% at 0% 0%, oklch(0.28 0.06 300 / 0.9), oklch(0.18 0.03 260 / 0.9))",
      border: "1px solid oklch(0.6 0.1 300 / 0.35)",
    }}>
      <style>{`
        @keyframes avc-showcase-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes avc-showcase-glow { 0%,100% { opacity: .5 } 50% { opacity: 1 } }
        .avc-showcase-track { display:inline-flex; gap:14px; padding:0 7px; animation: avc-showcase-marquee 22s linear infinite; will-change: transform; }
        .avc-showcase:hover .avc-showcase-track { animation-play-state: paused; }
      `}</style>
      {!compact && (
        <div style={{ textAlign: "center", marginBottom: 16, padding: "0 20px" }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: "0.02em" }}>
            全部主流大模型 · 一处对话
          </div>
          <div style={{ fontSize: 12.5, color: "oklch(0.8 0.04 300)", marginTop: 5 }}>
            ChatGPT · Claude · Grok · Gemini · 通义千问 等已全部接入（含本地桥接 / 自建）
          </div>
        </div>
      )}
      {/* 跑马灯：两遍拼接 + translateX(-50%) 无缝循环 */}
      <div className="avc-showcase" style={{ width: "100%", overflow: "hidden", maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}>
        <div className="avc-showcase-track">
          {loop.map((b, i) => <Chip key={`${b.key}-${i}`} b={b} />)}
        </div>
      </div>
      {/* 底部微光 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(60% 40% at 50% 120%, oklch(0.7 0.2 300 / 0.25), transparent)",
        animation: "avc-showcase-glow 4s ease-in-out infinite" }} />
    </div>
  );
}
