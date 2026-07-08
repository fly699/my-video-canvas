import nodemailer from "nodemailer";
import type { AuthSettings } from "../db";

/** Generate a 6-digit numeric verification code. */
export function generateVerifyCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Code validity window. */
export const VERIFY_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Send the registration verification code via the admin-configured SMTP account.
 * Best-effort: returns {ok,error} and never throws into the auth flow.
 */
export async function sendVerificationEmail(cfg: AuthSettings, to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.smtpHost.trim()) return { ok: false, error: "未配置 SMTP 服务器" };
  if (!to.trim()) return { ok: false, error: "收件邮箱为空" };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost.trim(),
      port: cfg.smtpPort || 587,
      secure: cfg.smtpSecure, // true=465(SSL)，false=587/25(STARTTLS)
      auth: cfg.smtpUser.trim() ? { user: cfg.smtpUser.trim(), pass: cfg.smtpPass } : undefined,
    });
    await transport.sendMail({
      from: cfg.smtpFrom.trim() || cfg.smtpUser.trim() || "noreply@localhost",
      to: to.trim(),
      subject: `【AI 视频画布】注册验证码：${code}`,
      text: `你的注册验证码是：${code}\n\n验证码 15 分钟内有效。如果这不是你本人的操作，请忽略此邮件。`,
      html: `<p>你的注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p style="color:#888;font-size:12px">验证码 15 分钟内有效。如果这不是你本人的操作，请忽略此邮件。</p>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/**
 * 发送一封「配置测试」邮件，验证 SMTP 是否可用（与存储连通性测试对齐，「配置即验证」）。
 * 复用与验证码邮件相同的 transport 配置。
 */
export async function sendTestEmail(cfg: AuthSettings, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.smtpHost.trim()) return { ok: false, error: "未配置 SMTP 服务器" };
  if (!to.trim()) return { ok: false, error: "收件邮箱为空" };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost.trim(),
      port: cfg.smtpPort || 587,
      secure: cfg.smtpSecure,
      auth: cfg.smtpUser.trim() ? { user: cfg.smtpUser.trim(), pass: cfg.smtpPass } : undefined,
    });
    await transport.sendMail({
      from: cfg.smtpFrom.trim() || cfg.smtpUser.trim() || "noreply@localhost",
      to: to.trim(),
      subject: "【AI 视频画布】SMTP 配置测试邮件",
      text: "这是一封来自 AI 视频画布管理后台的 SMTP 配置测试邮件。收到即表示邮件发送配置可用。",
      html: `<p>这是一封来自 <b>AI 视频画布</b> 管理后台的 <b>SMTP 配置测试邮件</b>。</p><p style="color:#16a34a">✓ 收到即表示邮件发送配置可用。</p>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}
