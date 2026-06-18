import nodemailer from "nodemailer";
import type { TunnelEmailNotify } from "../db";

/** Send the freshly-obtained public tunnel URL to the configured address. Quick tunnels
 *  change URL on each restart, so this lets the operator always know the current address.
 *  Best-effort: returns {ok,error} but never throws into the tunnel manager. */
export async function sendTunnelUrlEmail(cfg: TunnelEmailNotify, url: string): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.to.trim() || !cfg.host.trim()) return { ok: false, error: "未配置收件人或 SMTP 主机" };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host.trim(),
      port: cfg.port || 587,
      secure: cfg.secure, // true=465(SSL)，false=587/25(STARTTLS)
      auth: cfg.user.trim() ? { user: cfg.user.trim(), pass: cfg.pass } : undefined,
    });
    await transport.sendMail({
      from: (cfg.from.trim() || cfg.user.trim() || "tunnel@localhost"),
      to: cfg.to.trim(),
      subject: `公网隧道地址已更新：${url}`,
      text: `你的应用公网隧道地址（本次）：\n\n${url}\n\n（快速隧道每次重启会变；本邮件由系统在获取到新地址时自动发送）`,
      html: `<p>你的应用公网隧道地址（本次）：</p><p><a href="${url}">${url}</a></p><p style="color:#888;font-size:12px">快速隧道每次重启会变；本邮件由系统在获取到新地址时自动发送。</p>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}
