import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { applyAuthGates } from "./context";
import { writeAuditLog } from "./auditLog";
import { sendVerificationEmail, generateVerifyCode, VERIFY_CODE_TTL_MS } from "./verificationEmail";

const scryptAsync = promisify(scrypt);

/** 客户端是否显式要求把会话令牌放进响应体（原生/移动端用 `X-Auth-Mode: token` 或 body `tokenInBody:true`）。
 *  Web 不传 → 令牌只走 HttpOnly Cookie、不落入可被 JS 读取的响应体，保持 XSS 防护。纯函数、便于单测。 */
export function clientWantsToken(authModeHeader: unknown, bodyFlag: unknown): boolean {
  const h = Array.isArray(authModeHeader) ? authModeHeader[0] : authModeHeader;
  return (typeof h === "string" && h.trim().toLowerCase() === "token") || bodyFlag === true;
}

// Simple in-memory rate limiter: max attempts per window per IP
const _rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;        // max attempts
const RATE_LIMIT_WINDOW_MS = 60_000; // per 60 seconds

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = _rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    _rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  // When the limit is exhausted, extend the window from now — prevents the classic
  // fixed-window boundary burst where an attacker consumes 2× the limit across a reset.
  if (bucket.count >= RATE_LIMIT_MAX) {
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  return true;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, "hex");
  if (buf.length !== storedBuf.length) return false;
  return timingSafeEqual(buf, storedBuf);
}

export function registerEmailAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "请求过于频繁，请稍后再试" }); return;
    }
    try {
      const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
      if (!email?.trim() || !password) {
        res.status(400).json({ error: "邮箱和密码不能为空" }); return;
      }
      if (typeof password !== "string") {
        res.status(400).json({ error: "密码格式不正确" }); return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "邮箱格式不正确" }); return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: "密码至少需要 8 位" }); return;
      }
      if (password.length > 72) {
        res.status(400).json({ error: "密码不能超过 72 位" }); return;
      }
      const openId = `email:${email.toLowerCase()}`;
      const existing = await db.getUserByOpenId(openId);
      if (existing) {
        res.status(409).json({ error: "该邮箱已注册" }); return;
      }
      const passwordHash = await hashPassword(password);
      await db.upsertUser({
        openId,
        name: name?.trim() || email.split("@")[0],
        email: email.toLowerCase(),
        loginMethod: "email",
        passwordHash,
        lastSignedIn: new Date(),
      });

      // Fetch back the new user's numeric ID for the audit log
      let newUserId: number | null = null;
      try {
        const newUser = await db.getUserByOpenId(openId);
        newUserId = newUser?.id ?? null;
      } catch { /* non-fatal */ }

      // Claim any pending collaboration invites addressed to this email.
      // Best-effort: registration must succeed even if the claim query fails.
      if (newUserId) {
        try { await db.claimPendingInvitations(email.toLowerCase(), newUserId); } catch { /* non-fatal */ }
      }

      // When the admin has enabled registration email-verification, the account is
      // created UNVERIFIED and NO session is issued — the user must POST the emailed
      // code to /api/auth/verify-email first. When the feature is off, behaviour is
      // unchanged (immediate login below). Non-breaking by default.
      const authSettings = await db.getAuthSettings();
      // 注册审批：开启且新注册者非管理员/站长 → 置 approved=false，须管理员批准后方可登录。
      // （即便同时开启邮箱验证，也先把 approved 置 false；验证通过后 verify-email 仍会拦审批。）
      const isAdminUser = (await db.getUserByOpenId(openId))?.role === "admin";
      const pendingApproval = authSettings.registrationApprovalEnabled && !isAdminUser;
      if (pendingApproval) {
        // 按 openId 置位，不依赖二次读回的 newUserId（读失败也不会漏标 → 不会绕过审批）。
        await db.setUserApprovedByOpenId(openId, false);
      }
      if (authSettings.emailVerificationEnabled) {
        const code = generateVerifyCode();
        await db.setUserVerification(openId, {
          emailVerified: false,
          verifyCode: code,
          verifyCodeExpiresAt: new Date(Date.now() + VERIFY_CODE_TTL_MS),
        });
        const sent = await sendVerificationEmail(authSettings, email.toLowerCase(), code);
        writeAuditLog({
          ip, userId: newUserId, userEmail: email.toLowerCase(),
          userName: name?.trim() || email.split("@")[0],
          action: "login_email", detail: { method: "email_register_pending" },
        });
        res.json({ success: true, needVerification: true, needApproval: pendingApproval, emailSent: sent.ok, ...(sent.ok ? {} : { warning: "验证码邮件发送失败：" + (sent.error ?? "") }) });
        return;
      }
      // 仅开启审批（未开邮箱验证）：不签发 session，返回待审批。
      if (pendingApproval) {
        writeAuditLog({
          ip, userId: newUserId, userEmail: email.toLowerCase(),
          userName: name?.trim() || email.split("@")[0],
          action: "login_email", detail: { method: "email_register_pending_approval" },
        });
        res.json({ success: true, needApproval: true });
        return;
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name?.trim() || email.split("@")[0],
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      writeAuditLog({
        ip: clientIp,
        userId: newUserId,
        userEmail: email.toLowerCase(),
        userName: name?.trim() || email.split("@")[0],
        action: "login_email",
        detail: { method: "email_register" },
      });

      const tok = clientWantsToken(req.headers["x-auth-mode"], (req.body as { tokenInBody?: unknown })?.tokenInBody) ? { token: sessionToken } : {};
      res.json({ success: true, ...tok });
    } catch (err) {
      console.error("[EmailAuth] Register error", err);
      res.status(500).json({ error: "注册失败，请稍后重试" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "请求过于频繁，请稍后再试" }); return;
    }
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email?.trim() || !password) {
        res.status(401).json({ error: "邮箱或密码错误" }); return;
      }
      if (typeof password !== "string") {
        res.status(401).json({ error: "邮箱或密码错误" }); return;
      }
      const openId = `email:${email.toLowerCase()}`;
      const user = await db.getUserByOpenId(openId);
      if (!user?.passwordHash) {
        res.status(401).json({ error: "邮箱或密码错误" }); return;
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "邮箱或密码错误" }); return;
      }
      if (user.disabled) {
        res.status(403).json({ error: "账号已被冻结，请联系管理员" }); return;
      }
      // Block unverified accounts only while the feature is enabled — so toggling it
      // off restores normal login, and accounts created before it was on (emailVerified
      // defaults true) are unaffected.
      if (user.emailVerified === false) {
        const authSettings = await db.getAuthSettings();
        if (authSettings.emailVerificationEnabled) {
          res.status(403).json({ error: "邮箱尚未验证，请先完成验证", needVerification: true }); return;
        }
      }
      // 审批 gate：approved=false 且开关开启 → 拒绝登录（管理员/站长豁免）。
      if (user.approved === false && user.role !== "admin") {
        const s = await db.getAuthSettings();
        if (s.registrationApprovalEnabled) {
          res.status(403).json({ error: "账号正在等待管理员审批，通过后即可登录", needApproval: true }); return;
        }
      }
      await db.upsertUser({ openId, lastSignedIn: new Date() });
      const sessionToken = await sdk.createSessionToken(openId, {
        name: user.name || email.split("@")[0],
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      writeAuditLog({
        ip: clientIp,
        userId: user.id,
        userEmail: user.email ?? null,
        userName: user.name ?? null,
        action: "login_email",
        detail: { method: "email_login" },
      });

      const tok = clientWantsToken(req.headers["x-auth-mode"], (req.body as { tokenInBody?: unknown })?.tokenInBody) ? { token: sessionToken } : {};
      res.json({ success: true, ...tok });
    } catch (err) {
      console.error("[EmailAuth] Login error", err);
      res.status(500).json({ error: "登录失败，请稍后重试" });
    }
  });

  // Verify the emailed code → mark verified and issue a session (completes a
  // pending registration / unblocks login). Idempotent: an already-verified
  // account just logs in.
  app.post("/api/auth/verify-email", async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) { res.status(429).json({ error: "请求过于频繁，请稍后再试" }); return; }
    try {
      const { email, code } = req.body as { email?: string; code?: string };
      if (!email?.trim() || !code?.trim()) { res.status(400).json({ error: "邮箱和验证码不能为空" }); return; }
      const openId = `email:${email.toLowerCase()}`;
      const user = await db.getUserByOpenId(openId);
      if (!user) { res.status(400).json({ error: "验证失败，请重新注册" }); return; }
      // 严禁把「已验证账号」当幂等登录处理——否则本接口等于一个不需要口令的登录端点：任何人 POST
      // { email: 受害者邮箱, code: 任意值 } 都能拿到有效会话（含管理员）→ 账号接管。会话仅在「本次
      // 确实校验通过了有效且未过期的验证码」时才签发；已验证账号一律引导走正常密码登录、绝不发会话。
      if (user.emailVerified !== false) {
        res.status(400).json({ error: "邮箱已验证，请直接使用密码登录", alreadyVerified: true });
        return;
      }
      if (!user.verifyCode || !user.verifyCodeExpiresAt) { res.status(400).json({ error: "请先获取验证码" }); return; }
      if (new Date(user.verifyCodeExpiresAt).getTime() < Date.now()) { res.status(400).json({ error: "验证码已过期，请重新获取" }); return; }
      if (String(code).trim() !== user.verifyCode) { res.status(400).json({ error: "验证码错误" }); return; }
      await db.setUserVerification(openId, { emailVerified: true, verifyCode: null, verifyCodeExpiresAt: null });
      if (user.disabled) { res.status(403).json({ error: "账号已被冻结，请联系管理员" }); return; }
      // 邮箱已验证，但审批未通过仍不放行（管理员/站长豁免）。
      if (user.approved === false && user.role !== "admin") {
        const s = await db.getAuthSettings();
        if (s.registrationApprovalEnabled) { res.status(403).json({ error: "邮箱已验证，账号正在等待管理员审批", needApproval: true }); return; }
      }
      await db.upsertUser({ openId, lastSignedIn: new Date() });
      const sessionToken = await sdk.createSessionToken(openId, { name: user.name || email.split("@")[0], expiresInMs: ONE_YEAR_MS });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      writeAuditLog({ ip, userId: user.id, userEmail: user.email ?? null, userName: user.name ?? null, action: "login_email", detail: { method: "email_verify" } });
      const tok = clientWantsToken(req.headers["x-auth-mode"], (req.body as { tokenInBody?: unknown })?.tokenInBody) ? { token: sessionToken } : {};
      res.json({ success: true, ...tok });
    } catch (err) {
      console.error("[EmailAuth] Verify error", err);
      res.status(500).json({ error: "验证失败，请稍后重试" });
    }
  });

  // Resend a fresh verification code (only meaningful while the feature is on and
  // the account is unverified). Always returns success to avoid email enumeration.
  app.post("/api/auth/resend-code", async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) { res.status(429).json({ error: "请求过于频繁，请稍后再试" }); return; }
    try {
      const { email } = req.body as { email?: string };
      if (!email?.trim()) { res.status(400).json({ error: "邮箱不能为空" }); return; }
      const authSettings = await db.getAuthSettings();
      if (!authSettings.emailVerificationEnabled) { res.json({ success: true, emailSent: false }); return; }
      const openId = `email:${email.toLowerCase()}`;
      const user = await db.getUserByOpenId(openId);
      if (user && user.emailVerified === false) {
        const code = generateVerifyCode();
        await db.setUserVerification(openId, { verifyCode: code, verifyCodeExpiresAt: new Date(Date.now() + VERIFY_CODE_TTL_MS) });
        const sent = await sendVerificationEmail(authSettings, email.toLowerCase(), code);
        res.json({ success: true, emailSent: sent.ok, ...(sent.ok ? {} : { warning: "验证码邮件发送失败：" + (sent.error ?? "") }) });
        return;
      }
      res.json({ success: true, emailSent: false });
    } catch (err) {
      console.error("[EmailAuth] Resend error", err);
      res.status(500).json({ error: "发送失败，请稍后重试" });
    }
  });

  // 修改自己的密码（需登录，校验当前密码）。仅邮箱密码账号可用。
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    // Rate-limit like register/login — currentPassword is verified here, so an
    // unthrottled endpoint allows online brute-force of the current password.
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) { res.status(429).json({ error: "请求过于频繁，请稍后再试" }); return; }
    try {
      // 经统一 gate（冻结 + 待审批），与其它入口一致——被驳回/冻结但持会话者不能改密。
      let user;
      try { user = await applyAuthGates(await sdk.authenticateRequest(req)); } catch { user = null; }
      if (!user) { res.status(401).json({ error: "未登录或账号不可用" }); return; }
      const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
      if (!user.passwordHash) { res.status(400).json({ error: "当前账号非邮箱密码登录，无法修改密码" }); return; }
      // Match the register policy (8) — was 6, weaker than account creation.
      if (typeof newPassword !== "string" || newPassword.length < 8) { res.status(400).json({ error: "新密码至少 8 位" }); return; }
      const ok = await verifyPassword(typeof currentPassword === "string" ? currentPassword : "", user.passwordHash);
      if (!ok) { res.status(401).json({ error: "当前密码错误" }); return; }
      await db.upsertUser({ openId: user.openId, passwordHash: await hashPassword(newPassword) });
      writeAuditLog({
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        userId: user.id, userEmail: user.email ?? null, userName: user.name ?? null,
        action: "user_change_password", detail: {},
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[EmailAuth] change-password error", err);
      res.status(500).json({ error: "修改密码失败，请稍后重试" });
    }
  });
}
