import { useState } from "react";
import { X, Check, BookmarkPlus, Cloud, Server } from "lucide-react";
import { getNodeConfig } from "../../lib/nodeConfig";
import { colorForTemplate, type ComfyNodeType } from "../../lib/comfyNodeTemplates";

interface Props {
  nodeType: ComfyNodeType;
  defaultName: string;
  /** Model / param summary shown read-only so the user knows what they're saving. */
  modelInfo: string;
  useCloud: boolean;
  onSave: (label: string, note: string) => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: 13,
  background: "var(--c-elevated)", border: "1px solid var(--c-bd3)",
  color: "var(--c-t1)", outline: "none", fontFamily: "var(--font-sans)",
};

export function SaveComfyTemplateDialog({ nodeType, defaultName, modelInfo, useCloud, onSave, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");
  const color = colorForTemplate(nodeType, useCloud);
  const config = getNodeConfig(nodeType);
  const canSave = name.trim().length > 0;
  const submit = () => { if (canSave) onSave(name.trim(), note); };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.62)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-2xl overflow-hidden animate-scale-in flex flex-col"
        style={{ width: "min(420px, 94vw)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 24px 80px oklch(0 0 0 / 0.65)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}40` }}>
            <BookmarkPlus className="w-4 h-4" style={{ color }} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>存入节点模板库</p>
            <p className="text-[11px]" style={{ color: "var(--c-t4)" }}>含全部参数（提示词 / 模型 / 工作流）</p>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ color: "var(--c-t4)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Node type + model info preview */}
          <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: "var(--c-surface)", border: `1px solid ${color}30` }}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}>
                {config.label}
              </span>
              {nodeType === "comfyui_workflow" && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: `${color}12`, border: `1px solid ${color}28`, color }}>
                  {useCloud ? <><Cloud className="w-2.5 h-2.5" /> 云端</> : <><Server className="w-2.5 h-2.5" /> 本地</>}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--c-t3)" }}>{modelInfo}</p>
          </div>

          {/* Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium" style={{ color: "var(--c-t3)" }}>模板名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              style={inputStyle}
              autoFocus
              maxLength={40}
              placeholder="模板名称（默认填入模型名，可修改）"
            />
          </label>

          {/* Note */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium" style={{ color: "var(--c-t3)" }}>注释（可选）</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              maxLength={300}
              placeholder="备注用途、参数要点等，便于日后检索"
            />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--c-elevated)" }}>
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}>
            取消
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"
            style={{ background: canSave ? color : "var(--c-surface)", border: canSave ? "none" : "1px solid var(--c-bd2)", color: canSave ? "#fff" : "var(--c-t4)", cursor: canSave ? "pointer" : "not-allowed" }}
          >
            <Check className="w-3.5 h-3.5" /> 保存
          </button>
        </div>
      </div>
    </div>
  );
}
