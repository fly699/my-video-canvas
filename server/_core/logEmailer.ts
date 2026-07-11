// 日志加密打包邮送：三类行为日志（操作/LLM/ComfyUI）按管理员设置定时导出 CSV、
// 打包成 AES-256 加密 zip（7-Zip / WinRAR 可解），经「注册认证」页配置的 SMTP 发送到
// 多个收件邮箱。调度由内置定时器驱动（每 5 分钟检查一次，shouldSendNow 纯函数判定）。
import archiver from "archiver";
// @ts-expect-error archiver-zip-encrypted 无类型声明（注册 zip-encrypted 格式插件）
import zipEncrypted from "archiver-zip-encrypted";
import { PassThrough } from "node:stream";
import nodemailer from "nodemailer";
import * as db from "../db";
import type { LogEmailSettingsRow } from "../../drizzle/schema";

try { archiver.registerFormat("zip-encrypted", zipEncrypted); } catch { /* 已注册（热重载） */ }

// ── CSV 序列化（防公式注入 + BOM，Excel 可直开）────────────────────────────────
export function rowsToCsv(header: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

/** 收件人解析：逗号 / 分号 / 换行分隔，去重去空，粗校验邮箱形状。 */
export function parseRecipients(raw: string | null | undefined): string[] {
  return Array.from(new Set((raw ?? "").split(/[,;\n]/).map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))));
}

/** 调度判定（纯函数，供单测）：本次 tick 是否应该发送。
 *  hours：距上次发送 ≥ intervalHours；daily/weekly/monthly：到达设定时点（小时粒度）
 *  且本周期内未发过。lastSentAt=null 视为「从未发过」→ 到达时点即发。 */
export function shouldSendNow(s: Pick<LogEmailSettingsRow, "enabled" | "scheduleMode" | "intervalHours" | "sendHour" | "sendWeekday" | "sendMonthday" | "lastSentAt">, now: Date): boolean {
  if (!s.enabled) return false;
  const last = s.lastSentAt ? s.lastSentAt.getTime() : 0;
  if (s.scheduleMode === "hours") {
    const iv = Math.max(1, s.intervalHours) * 3600_000;
    return now.getTime() - last >= iv;
  }
  if (now.getHours() < s.sendHour) return false;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const lastD = s.lastSentAt;
  if (s.scheduleMode === "daily") {
    return !lastD || !sameDay(lastD, now);
  }
  if (s.scheduleMode === "weekly") {
    if (now.getDay() !== s.sendWeekday) return false;
    return !lastD || now.getTime() - lastD.getTime() > 24 * 3600_000 || !sameDay(lastD, now);
  }
  if (s.scheduleMode === "monthly") {
    if (now.getDate() !== s.sendMonthday) return false;
    return !lastD || now.getTime() - lastD.getTime() > 24 * 3600_000 || !sameDay(lastD, now);
  }
  return false;
}

// ── 导出 + 打包 ────────────────────────────────────────────────────────────────
const EXPORT_CAP = 50_000; // 每类日志单次导出上限（防超大附件）

async function buildCsvFiles(s: LogEmailSettingsRow): Promise<{ name: string; content: string }[]> {
  const sinceMs = s.rangeDays > 0 ? Date.now() - s.rangeDays * 86400_000 : undefined;
  const files: { name: string; content: string }[] = [];
  const stamp = new Date().toISOString().slice(0, 10);
  if (s.includeAudit) {
    const { rows } = await db.getAuditLogs({ limit: EXPORT_CAP, offset: 0 });
    const list = sinceMs ? rows.filter((r) => r.createdAt.getTime() >= sinceMs) : rows;
    files.push({
      name: `操作日志-${stamp}.csv`,
      content: rowsToCsv(
        ["时间", "用户ID", "用户名", "邮箱", "IP", "国家", "省份", "城市", "设备指纹", "会话指纹", "UA", "操作", "详情JSON"],
        list.map((r) => [r.createdAt, r.userId, r.userName, r.userEmail, r.ip, r.country, r.region, r.city, r.deviceFp, r.sessionFp, r.userAgent, r.action, r.detail ? JSON.stringify(r.detail) : ""]),
      ),
    });
  }
  if (s.includeLlm) {
    // LLM 日志分页拉全量（列表行含 200 字预览；邮送以预览为准，全文可回管理后台查详情）
    const all: Awaited<ReturnType<typeof db.getLlmUsageLogs>>["rows"] = [];
    for (let off = 0; off < EXPORT_CAP; off += 1000) {
      const d = await db.getLlmUsageLogs({ limit: 1000, offset: off, sinceMs });
      all.push(...d.rows);
      if (d.rows.length < 1000) break;
    }
    files.push({
      name: `LLM调用日志-${stamp}.csv`,
      content: rowsToCsv(
        ["时间", "用户ID", "用户名", "IP", "设备指纹", "会话指纹", "UA", "场景", "模型", "路由", "状态", "耗时ms", "prompt字数", "回复字数", "prompt预览", "回复预览", "错误"],
        all.map((r) => [r.createdAt, r.userId, r.userName, r.ip, r.deviceFp, r.sessionFp, r.userAgent, r.scene, r.model, r.route, r.status, r.durationMs, r.promptChars, r.replyChars, r.promptPreview, r.replyPreview, r.errorMessage]),
      ),
    });
  }
  if (s.includeComfy) {
    const { rows } = await db.getComfyUsageLogs({ limit: EXPORT_CAP, offset: 0, sinceMs });
    files.push({
      name: `ComfyUI日志-${stamp}.csv`,
      content: rowsToCsv(
        ["时间", "用户ID", "用户名", "邮箱", "IP", "设备指纹", "会话指纹", "UA", "操作", "服务器", "模型", "状态", "耗时ms", "结果数", "错误", "详情JSON"],
        rows.map((r) => [r.createdAt, r.userId, r.userName, r.userEmail, r.ip, r.deviceFp, r.sessionFp, r.userAgent, r.action, r.host, r.model, r.status, r.durationMs, r.resultCount, r.errorMessage, r.detail ? JSON.stringify(r.detail) : ""]),
      ),
    });
  }
  return files;
}

/** 打包（可选 AES-256 加密）成 zip Buffer。无密码时普通 zip（不建议，UI 已提示）。 */
export async function buildZipBuffer(files: { name: string; content: string }[], password: string | null): Promise<Buffer> {
  const archive = password
    ? (archiver.create as unknown as (fmt: string, opts: Record<string, unknown>) => archiver.Archiver)("zip-encrypted", { zlib: { level: 8 }, encryptionMethod: "aes256", password })
    : archiver("zip", { zlib: { level: 8 } });
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    out.on("end", () => resolve());
    archive.on("error", reject);
  });
  archive.pipe(out);
  for (const f of files) archive.append(f.content, { name: f.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

// ── 发送 ──────────────────────────────────────────────────────────────────────
export async function sendLogEmailNow(trigger: "schedule" | "manual"): Promise<{ ok: boolean; message: string }> {
  const s = await db.getLogEmailSettings();
  const recipients = parseRecipients(s.recipients);
  const finish = async (ok: boolean, message: string) => {
    await db.setLogEmailSettings({ lastSentAt: new Date(), lastResult: `${ok ? "✓" : "✗"} ${message}`.slice(0, 512) }).catch(() => { /* 记录失败不阻断 */ });
    return { ok, message };
  };
  if (recipients.length === 0) return finish(false, "未配置有效的收件邮箱");
  if (!s.includeAudit && !s.includeLlm && !s.includeComfy) return finish(false, "未勾选任何日志类型");
  const auth = await db.getAuthSettings().catch(() => null);
  if (!auth?.smtpHost?.trim()) return finish(false, "未配置 SMTP（管理后台 → 注册认证 页）");
  try {
    const files = await buildCsvFiles(s);
    const zip = await buildZipBuffer(files, s.zipPassword?.trim() || null);
    const transport = nodemailer.createTransport({
      host: auth.smtpHost.trim(),
      port: auth.smtpPort || 587,
      secure: auth.smtpSecure,
      auth: auth.smtpUser?.trim() ? { user: auth.smtpUser.trim(), pass: auth.smtpPass } : undefined,
    });
    const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
    const rangeLabel = s.rangeDays > 0 ? `最近 ${s.rangeDays} 天` : "全部历史";
    await transport.sendMail({
      from: auth.smtpFrom?.trim() || auth.smtpUser?.trim() || "noreply@localhost",
      to: recipients.join(", "),
      subject: `【AI 视频画布】日志备份 ${new Date().toISOString().slice(0, 10)}（${rangeLabel}）`,
      text: `附件为系统行为日志打包（${rangeLabel}；${files.map((f) => f.name).join("、")}）。\n` +
        (s.zipPassword?.trim() ? "zip 已用 AES-256 加密，请用 7-Zip / WinRAR 输入约定密码解压。\n" : "⚠ 未设置压缩密码，zip 未加密。\n") +
        `触发方式：${trigger === "manual" ? "手动发送" : "定时发送"} · ${stamp}`,
      attachments: [{ filename: `logs-${new Date().toISOString().slice(0, 10)}.zip`, content: zip }],
    });
    return finish(true, `已发送 ${files.length} 个日志文件（${(zip.length / 1024).toFixed(0)}KB）→ ${recipients.length} 个收件箱`);
  } catch (e) {
    return finish(false, `发送失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 480));
  }
}

// ── 调度器 ────────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
export function startLogEmailScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      try {
        const s = await db.getLogEmailSettings();
        if (shouldSendNow(s, new Date())) {
          const r = await sendLogEmailNow("schedule");
          console.log(`[LogEmailer] scheduled send: ${r.ok ? "OK" : "FAIL"} — ${r.message}`);
        }
      } catch (e) {
        console.warn("[LogEmailer] tick failed:", e instanceof Error ? e.message : e);
      }
    })();
  }, 5 * 60_000);
  console.log("[LogEmailer] scheduler started (5min tick)");
}
