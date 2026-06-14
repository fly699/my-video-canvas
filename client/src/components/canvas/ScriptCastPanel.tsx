import { Mic } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { SideShell, collectCharacterNames } from "./ScriptSidePanels";
import { DUBBING_MODELS, voicesForModel } from "./nodes/AudioNode";
import { extractRoles, type CastVoice } from "../../lib/dialogueCasting";
import type { ScriptNodeData } from "../../../../shared/types";

const CAST_ACCENT = "oklch(0.70 0.18 340)"; // 配音粉（与 ShotListPanel casting 区一致）

/**
 * 角色配音映射面板：从脚本自动识别角色（对白「角色名：台词」+ 连线角色节点 / @提及），
 * 为每个角色指定配音模型 + 音色，写入 payload.castVoices。镜头表批量配音与此共享同一份
 * castVoices（ShotListPanel 读它作默认），改一处两处生效。
 */
export function ScriptCastPanel({ id, payload, onClose }: {
  id: string; payload: ScriptNodeData; onClose: () => void;
}) {
  const { updateNodeData } = useCanvasStore();
  const cast = payload.castVoices ?? {};

  // 角色来源：① 脚本正文里的对白角色（角色名：台词）② 连线角色节点 / @提及角色。合并去重。
  const mentionText = [payload.content, payload.synopsis, payload.logline].filter(Boolean).join("\n");
  const fromDialogue = extractRoles([payload.content]);
  const fromCharacters = collectCharacterNames(id, mentionText);
  const roles = Array.from(new Set([...fromDialogue, ...fromCharacters]));
  const assigned = roles.filter((r) => cast[r]).length;

  const setRoleVoice = (role: string, cv: CastVoice | null) => {
    const next = { ...(payload.castVoices ?? {}) };
    if (cv) next[role] = cv; else delete next[role];
    updateNodeData(id, { castVoices: next });
  };

  return (
    <SideShell title="角色配音 · Casting" icon={<Mic style={{ width: 14, height: 14 }} />} accent={CAST_ACCENT} onClose={onClose} width={400}>
      <p style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.6, flexShrink: 0 }}>
        为每个角色指定配音模型与音色。镜头表批量配音会按「角色名：台词」逐段套用，未分配的角色与旁白用全局音色。此处与镜头表共享同一份配置。
      </p>

      {roles.length === 0 ? (
        <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--c-t4)", fontSize: 11 }}>
          未识别到角色<br />
          <span style={{ fontSize: 10, color: "var(--c-bd3)" }}>在脚本中用「角色名：台词」书写对白，或连线角色节点 / 用 @角色 提及</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>已分配 {assigned} / 共 {roles.length} 个角色</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {roles.map((role) => {
              const cv = cast[role];
              const voices = cv ? voicesForModel(cv.model) : [];
              return (
                <div key={role} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", borderRadius: 7, background: cv ? `${CAST_ACCENT}12` : "var(--c-input)", border: `1px solid ${cv ? `${CAST_ACCENT}40` : "var(--c-bd1)"}` }}>
                  <span title={role} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-t1)", width: 84, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{role}</span>
                  <select className="nodrag" value={cv?.model ?? ""}
                    onChange={(e) => {
                      const m = e.target.value;
                      if (!m) { setRoleVoice(role, null); return; }
                      const vs = voicesForModel(m);
                      const keep = cv && vs.some((v) => v.value === cv.voice) ? cv.voice : vs[0]?.value ?? "";
                      setRoleVoice(role, { model: m, voice: keep });
                    }}
                    style={{ fontSize: 10, padding: "3px 6px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: cv ? "var(--c-t1)" : "var(--c-t4)", outline: "none", flex: 1, minWidth: 0 }}>
                    <option value="">（用全局音色）</option>
                    {DUBBING_MODELS.filter((m) => m.value !== "voxcpm-local").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  {cv && voices.length > 0 && (
                    <select className="nodrag" value={voices.some((v) => v.value === cv.voice) ? cv.voice : voices[0]?.value ?? ""}
                      onChange={(e) => setRoleVoice(role, { model: cv.model, voice: e.target.value })}
                      style={{ fontSize: 10, padding: "3px 6px", borderRadius: 6, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", maxWidth: 116 }}>
                      {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </SideShell>
  );
}
