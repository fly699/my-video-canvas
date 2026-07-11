import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { DownloadCloud, UploadCloud, Loader2, ShieldCheck, KeyRound } from "lucide-react";

// #75 管理后台全量配置导入/导出（站长 L5 独占；服务端 ownerProc 硬门控）。
// 导出：全部后台配置（含 SMTP/日志邮送等敏感密码）→ gzip + AES-256-GCM 口令加密 →
// 二进制 .avccfg 下载，绝不明文出站。导入：选文件 + 口令 → 服务端解密校验后按节写回。

const SECTION_NAMES: Record<string, string> = {
  auth: "注册/SMTP 邮箱", storage: "存储与下载策略", whitelistFlags: "白名单开关",
  whitelistEntries: "白名单条目", comfy: "ComfyUI 服务器", selfHostedLlm: "自建 LLM",
  bridgeMcp: "本地桥接 MCP", tunnel: "公网隧道", chat: "聊天室设置",
  logEmail: "日志邮送（含密码）", ops: "运维设置", adminPerms: "权限矩阵", systemDefaultModels: "系统默认模型",
};
const cnSections = (keys: string[]) => keys.map((k) => SECTION_NAMES[k] ?? k).join("、");

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64 = (buf: ArrayBuffer): string => {
  const u8 = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
  return btoa(s);
};

export function ConfigBackupSection() {
  const [passphrase, setPassphrase] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const exportMut = trpc.admin.configBackup.export.useMutation();
  const importMut = trpc.admin.configBackup.import.useMutation();

  const doExport = async () => {
    if (passphrase.length < 6) { toast.error("请先输入至少 6 位的加密口令"); return; }
    try {
      const r = await exportMut.mutateAsync({ passphrase });
      const blob = new Blob([b64ToBytes(r.data)], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = r.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast.success(`已导出 ${r.sections.length} 节配置（已压缩加密，请妥善保管口令——丢失无法恢复）`);
    } catch (e) { toast.error("导出失败：" + (e instanceof Error ? e.message : String(e))); }
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!passphrase) { toast.error("请先输入该备份文件的解密口令"); return; }
    if (!window.confirm(`确认导入「${file.name}」？\n\n导入将覆盖现有后台配置（白名单条目为增量合并）。建议先用当前口令导出一份现有配置作回退。`)) return;
    try {
      const data = bytesToB64(await file.arrayBuffer());
      const r = await importMut.mutateAsync({ passphrase, data });
      toast.success(`导入完成：已应用 ${r.applied.length} 节（${cnSections(r.applied)}）` + (r.skipped.length ? `；跳过 ${cnSections(r.skipped)}` : ""), { duration: 9000 });
    } catch (err) { toast.error("导入失败：" + (err instanceof Error ? err.message : String(err))); }
  };

  const busy = exportMut.isPending || importMut.isPending;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 20px", background: "var(--c-base, rgba(255,255,255,0.02))", border: "1px solid var(--c-bd1, rgba(255,255,255,0.08))", borderRadius: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <ShieldCheck style={{ width: 18, height: 18, color: "oklch(0.72 0.18 155)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--c-t1, #f0f0f4)" }}>配置导入 / 导出（仅站长）</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.5 }}>
            一键备份/恢复全部后台配置（含 SMTP、日志邮送等敏感密码）。导出文件自动 gzip 压缩并以
            AES-256-GCM 口令加密，<b>密码等敏感项绝不明文落盘</b>；口令丢失无法恢复，请妥善保管。
          </p>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <KeyRound style={{ width: 14, height: 14, color: "var(--c-t3)" }} />
        <input
          type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
          placeholder="加密/解密口令（至少 6 位）" autoComplete="new-password"
          style={{ flex: "1 1 220px", maxWidth: 320, padding: "7px 10px", fontSize: 12.5, background: "var(--c-input, rgba(0,0,0,0.25))", color: "var(--c-t1)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", borderRadius: 8, outline: "none" }}
        />
        <button onClick={() => void doExport()} disabled={busy}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: busy ? "wait" : "pointer", background: "oklch(0.58 0.22 285 / 0.85)", border: "1px solid oklch(0.68 0.22 285 / 0.4)", color: "#fff", opacity: busy ? 0.6 : 1 }}>
          {exportMut.isPending ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <DownloadCloud style={{ width: 13, height: 13 }} />}
          导出配置（压缩加密）
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: busy ? "wait" : "pointer", background: "var(--c-surface, rgba(255,255,255,0.06))", border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", color: "var(--c-t1, #f0f0f4)", opacity: busy ? 0.6 : 1 }}>
          {importMut.isPending ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <UploadCloud style={{ width: 13, height: 13 }} />}
          导入配置…
        </button>
        <input ref={fileRef} type="file" accept=".avccfg,application/octet-stream" style={{ display: "none" }} onChange={(e) => void onImportFile(e)} />
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", lineHeight: 1.5 }}>
        覆盖范围：{cnSections(Object.keys(SECTION_NAMES))}。导入为整节覆盖（白名单条目增量合并），操作前建议先导出当前配置留档；导入/导出均写入操作日志。
      </p>
    </div>
  );
}
