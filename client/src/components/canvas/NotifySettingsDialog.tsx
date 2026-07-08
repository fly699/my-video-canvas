import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Bell, X, Loader2, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** 个人「产物推送」设置：产物生成完成时，除了推到站内「我的产物通知」聊天室，还可选配一个
 *  外部 webhook（Bark / Server酱 / Telegram / Slack / Discord / 通用 JSON），让你关着页面/在
 *  手机上也能收到。url 在服务端保存并经 SSRF 守卫（禁私网/环回/元数据地址）。 */

const KIND_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "bark", label: "Bark（iOS）", hint: "填你的 Bark 推送地址，如 https://api.day.app/你的Key" },
  { value: "serverchan", label: "Server 酱", hint: "填 https://sctapi.ftqq.com/你的SendKey.send" },
  { value: "telegram", label: "Telegram", hint: "填 https://api.telegram.org/bot<token>/sendMessage?chat_id=<聊天ID>" },
  { value: "discord", label: "Discord", hint: "填频道 Webhook URL（频道设置 → 整合 → Webhook）" },
  { value: "slack", label: "Slack", hint: "填 Incoming Webhook URL" },
  { value: "generic", label: "通用 JSON", hint: "POST {title, body, url, type, name, model} 到你的地址" },
];

export function NotifySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cfgQuery = trpc.chat.getNotifyWebhook.useQuery(undefined, { enabled: open, staleTime: 10_000 });
  const saveMut = trpc.chat.setNotifyWebhook.useMutation();
  const testMut = trpc.chat.testNotifyWebhook.useMutation({
    onSuccess: () => toast.success("测试推送已发送，请到你的推送渠道查收"),
    onError: (e) => toast.error("测试推送失败：" + e.message),
  });
  const utils = trpc.useUtils();

  const [enabled, setEnabled] = useState(false);
  const [kind, setKind] = useState("bark");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (open && cfgQuery.data) {
      setEnabled(cfgQuery.data.enabled);
      setKind(cfgQuery.data.kind || "bark");
      setUrl(cfgQuery.data.url || "");
    }
  }, [open, cfgQuery.data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeHint = KIND_OPTIONS.find((k) => k.value === kind)?.hint ?? "";
  const urlMissing = enabled && !url.trim(); // #R5-5 启用但未填 URL：禁用保存 + 警告（服务端也会拒，这里 fail-fast）

  const save = async () => {
    try {
      await saveMut.mutateAsync({ enabled, kind: kind as never, url: url.trim() || null });
      await utils.chat.getNotifyWebhook.invalidate();
      toast.success(enabled ? "已保存并启用外部推送" : "已保存（外部推送已关闭）");
      onClose();
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  const input: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13,
    background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none",
  };

  return createPortal((
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "oklch(0 0 0 / 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 12px 40px oklch(0 0 0 / 0.5)", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Bell style={{ width: 16, height: 16, color: "oklch(0.72 0.2 285)" }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--c-t1)" }}>产物推送设置</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--c-t3)" }}><X style={{ width: 16, height: 16 }} /></button>
        </div>

        {/* 站内通知房说明（始终开启） */}
        <div style={{ fontSize: 12, lineHeight: 1.65, color: "var(--c-t2)", background: "oklch(0.65 0.20 160 / 0.08)", border: "1px solid oklch(0.65 0.20 160 / 0.28)", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
          ✅ 你生成的每个产物（图/视频/音频/ComfyUI）都会自动推送到聊天里的
          <strong style={{ color: "var(--c-t1)" }}>「我的产物通知」</strong>房间——不进画布也能在聊天实时收、历史随时查。<b>此项始终开启，无需配置。</b>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t2)", marginBottom: 8 }}>外部推送（可选：关页面/离线也能收到）</div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-t1)", cursor: "pointer", marginBottom: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ cursor: "pointer", accentColor: "oklch(0.68 0.22 285)" }} />
          启用外部 webhook 推送
        </label>

        <div style={{ display: enabled ? "block" : "none" }}>
          <div style={{ fontSize: 11.5, color: "var(--c-t3)", marginBottom: 5 }}>推送渠道</div>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...input, marginBottom: 10 }}>
            {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>

          <div style={{ fontSize: 11.5, color: "var(--c-t3)", marginBottom: 5 }}>推送地址（URL）</div>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ ...input, marginBottom: 6 }} />
          <div style={{ fontSize: 11, color: "var(--c-t4)", lineHeight: 1.6, marginBottom: 4 }}>{activeHint}</div>
          <div style={{ fontSize: 11, color: "var(--c-t4)", lineHeight: 1.6, display: "flex", alignItems: "center", gap: 4 }}>
            <ExternalLink size={11} /> 仅支持公网 http(s) 地址；私网/内网/环回地址会被拒绝。
          </div>
          {urlMissing && (
            <div style={{ fontSize: 11.5, color: "oklch(0.7 0.17 60)", marginTop: 8 }}>⚠ 已启用推送但未填 URL，保存会被拒绝——请填写地址或关闭推送。</div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          {/* 发送测试推送，验证 webhook 是否可用（需已启用并填了 URL） */}
          {enabled && (
            <button onClick={() => testMut.mutate()} disabled={testMut.isPending || urlMissing}
              title={urlMissing ? "请先填写推送地址" : "向当前地址发送一条测试推送"}
              style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: "transparent", border: "1px solid var(--c-bd2)", color: (testMut.isPending || urlMissing) ? "var(--c-t4)" : "var(--c-t2)", cursor: (testMut.isPending || urlMissing) ? "not-allowed" : "pointer" }}>
              {testMut.isPending ? "发送中…" : "🔔 发送测试推送"}
            </button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>取消</button>
            <button onClick={save} disabled={saveMut.isPending || urlMissing} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))", border: "none", color: "white", opacity: urlMissing ? 0.5 : 1, cursor: (saveMut.isPending || urlMissing) ? "not-allowed" : "pointer" }}>
              {saveMut.isPending && <Loader2 size={13} className="animate-spin" />} 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
