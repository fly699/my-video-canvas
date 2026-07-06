import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X, ExternalLink } from "lucide-react";

// 「自定义模型」自带密钥录入面板（ChatGPT=custom_openai / Claude=custom_claude）。
// 仅存本机 localStorage，经 main.tsx 的全局请求头 x-openai-key / x-anthropic-key
// （+ x-*-model 可选底层模型名）随所有 LLM 请求透传，前端优先于后端 env。
// 服务端解析见 server/_core/customLlm.ts 与 llmWithKie.ts。

const ACCENT = "oklch(0.70 0.16 320)"; // 品红 — 与 kie(teal)/poyo(紫) 区分

type Slot = {
  label: string;
  keyLS: string;
  modelLS: string;
  placeholder: string;
  /** 默认底层模型 ID（留空时服务端用此默认）。 */
  defaultModel: string;
  /** 常用模型 ID 预设（下拉选项），避免误填「ChatGPT」这类产品名。 */
  presets: string[];
  manageUrl: string;
};

const SLOTS: Slot[] = [
  {
    label: "ChatGPT（OpenAI）",
    keyLS: "custom:openaiKey",
    modelLS: "custom:openaiModel",
    placeholder: "粘贴 OpenAI API key（sk-…）",
    defaultModel: "gpt-4o",
    presets: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
    manageUrl: "https://platform.openai.com/api-keys",
  },
  {
    label: "Claude（Anthropic）",
    keyLS: "custom:anthropicKey",
    modelLS: "custom:anthropicModel",
    placeholder: "粘贴 Anthropic API key（sk-ant-…）",
    defaultModel: "claude-sonnet-4-5",
    presets: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"],
    manageUrl: "https://console.anthropic.com/settings/keys",
  },
];

const CUSTOM_OPT = "__custom__"; // 下拉里「自定义…」选项值

const readLS = (k: string) => (typeof localStorage !== "undefined" ? localStorage.getItem(k) ?? "" : "");

function SlotEditor({ slot }: { slot: Slot }) {
  const [savedKey, setSavedKey] = useState<string>(() => readLS(slot.keyLS));
  const [draftKey, setDraftKey] = useState("");
  // 模型选择：保存的值若在预设里则下拉选中它，否则视为「自定义」并把值放进文本框。
  // 自愈：清掉明显非法的旧值（产品名如「ChatGPT」「Claude」——真实模型 ID 一定含数字），
  // 否则会被当作 model 发去官方端点直接 404（曾经的 `The model 'ChatGPT' does not exist`）。
  const initialModel = (() => {
    const v = readLS(slot.modelLS);
    if (v && !/\d/.test(v)) { try { localStorage.removeItem(slot.modelLS); } catch { /* ignore */ } return ""; }
    return v;
  })();
  const [model, setModel] = useState<string>(initialModel);
  const [isCustom, setIsCustom] = useState<boolean>(!!initialModel && !slot.presets.includes(initialModel));

  const applyKey = () => {
    const v = draftKey.trim();
    if (!v) return;
    localStorage.setItem(slot.keyLS, v);
    setSavedKey(v);
    setDraftKey("");
  };
  const clearKey = () => {
    localStorage.removeItem(slot.keyLS);
    setSavedKey("");
  };
  // 空 = 用服务端默认（slot.defaultModel）；非空写入 localStorage 经请求头透传。
  const saveModel = (v: string) => {
    setModel(v);
    if (v.trim()) localStorage.setItem(slot.modelLS, v.trim());
    else localStorage.removeItem(slot.modelLS);
  };
  const onSelectChange = (v: string) => {
    if (v === CUSTOM_OPT) { setIsCustom(true); return; }
    setIsCustom(false);
    saveModel(v === slot.defaultModel ? "" : v); // 选默认值就清空（回退服务端默认）
  };
  // 下拉当前选中值：自定义态固定显示自定义项；否则用已存模型，未存则默认值。
  const selectValue = isCustom ? CUSTOM_OPT : (model || slot.defaultModel);

  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--c-elevated)" }}>
      <label style={{ fontSize: 11, color: "var(--c-t3)", display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
        <KeyRound className="w-3 h-3" /> {slot.label}
      </label>
      {savedKey ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12, marginBottom: 6 }}>
          <span style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", borderRadius: 8, color: "var(--c-t2)", fontFamily: "monospace" }}>
            已启用 · …{savedKey.slice(-4)}
          </span>
          <button onClick={clearKey} title="清除密钥" className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
          <input
            type="password"
            placeholder={slot.placeholder}
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyKey(); }}
            style={{ flex: 1, padding: "6px 9px", fontSize: 12, background: "var(--c-input, var(--c-surface))", color: "var(--c-t1)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }}
          />
          <button onClick={applyKey} disabled={!draftKey.trim()} className="px-2.5 py-1.5 rounded-lg text-xs" style={{ background: ACCENT.replace(")", " / 0.14)"), border: `1px solid ${ACCENT.replace(")", " / 0.3)")}`, color: ACCENT, cursor: draftKey.trim() ? "pointer" : "not-allowed", opacity: draftKey.trim() ? 1 : 0.5 }}>
            使用
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <select
          value={selectValue}
          onChange={(e) => onSelectChange(e.target.value)}
          title="底层模型 ID（直连官方端点用的真实 model 名）"
          style={{ flex: 1, padding: "5px 9px", fontSize: 11.5, background: "var(--c-input, var(--c-surface))", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none", cursor: "pointer" }}
        >
          {slot.presets.map((p) => (
            <option key={p} value={p}>{p}{p === slot.defaultModel ? "（默认）" : ""}</option>
          ))}
          <option value={CUSTOM_OPT}>自定义…</option>
        </select>
        <a href={slot.manageUrl} target="_blank" rel="noopener noreferrer" title="获取 / 管理密钥" className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT.replace(")", " / 0.12)"), border: `1px solid ${ACCENT.replace(")", " / 0.3)")}`, color: ACCENT }}>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {isCustom && (
        <input
          type="text"
          placeholder="填官方文档的准确模型 ID（如 gpt-4o-mini / claude-…-20250929）"
          value={model}
          onChange={(e) => saveModel(e.target.value)}
          style={{ width: "100%", marginTop: 6, padding: "5px 9px", fontSize: 11.5, background: "var(--c-input, var(--c-surface))", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", borderRadius: 8, outline: "none" }}
        />
      )}
    </div>
  );
}

export function CustomLlmKeyDashboard({ compact }: { compact?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  // 是否已配置任一自带 key（决定徽标高亮）。打开面板时实时读，避免子组件状态同步复杂度。
  const anyConfigured = SLOTS.some((s) => readLS(s.keyLS));

  const openPanel = () => {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPanel}
        title="自定义模型密钥（ChatGPT / Claude 自带 key）"
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs transition-all"
        style={{
          background: open ? ACCENT.replace(")", " / 0.12)") : "transparent",
          border: `1px solid ${open ? ACCENT.replace(")", " / 0.3)") : "transparent"}`,
          color: anyConfigured ? ACCENT : "var(--c-t4)",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "var(--c-elevated)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
      >
        <KeyRound className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
        {!compact && <span>自定义模型</span>}
        {anyConfigured && (
          <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 4, background: ACCENT.replace(")", " / 0.15)"), lineHeight: "14px" }}>已配</span>
        )}
      </button>

      {open && btnRect && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99980 }}
            onMouseDown={(e) => { if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }}
          />
          <div
            style={{
              position: "fixed", zIndex: 99981, top: btnRect.bottom + 6,
              left: Math.max(8, Math.min(btnRect.left, window.innerWidth - 360 - 8)),
              minWidth: 320, maxWidth: 380,
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12,
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.6)", padding: 14, color: "var(--c-t1)",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--c-t3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              自定义模型 · 自带密钥
            </div>
            <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 12, lineHeight: 1.5 }}>
              在模型选择器里选「ChatGPT / Claude（自定义密钥）」即用以下密钥直连官方端点。
              仅存本机、随请求透传；留空则回退后端环境变量（OPENAI_API_KEY / ANTHROPIC_API_KEY）。
            </div>
            {SLOTS.map((s) => <SlotEditor key={s.keyLS} slot={s} />)}
            <div style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5 }}>
              费用按 OpenAI / Anthropic 官方账单计，由你的密钥自付。
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
