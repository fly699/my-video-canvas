import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { writeAuditLog } from "./auditLog";

const scryptAsync = promisify(scrypt);

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

async function hashPassword(password: string): Promise<string> {
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
      // Block registration with the owner email — that account must log in via OAuth only
      if (ENV.ownerEmail && email.toLowerCase() === ENV.ownerEmail.toLowerCase()) {
        res.status(403).json({ error: "该邮箱不允许通过密码注册，请使用第三方登录" }); return;
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

      res.json({ success: true });
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

      res.json({ success: true });
    } catch (err) {
      console.error("[EmailAuth] Login error", err);
      res.status(500).json({ error: "登录失败，请稍后重试" });
    }
  });
}
