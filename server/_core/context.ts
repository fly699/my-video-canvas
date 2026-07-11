import { createHash } from "node:crypto";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { getAuthSettings } from "../db";

// 注册审批统一 gate：approved=false 且开关开启 → 视为未登录（即使持有合法会话也拿不到 API）。
// 管理员/站长豁免，避免管理员把自己锁在门外。开关关闭后自动恢复（与冻结/邮箱验证同款语义）。
// 读设置失败时对「待审批」用户 fail-closed（拦截），避免异常放行。
async function passesApproval(user: User | null): Promise<User | null> {
  if (!user) return null;
  if (user.approved === false && user.role !== "admin") {
    try {
      const s = await getAuthSettings();
      if (s.registrationApprovalEnabled) return null;
    } catch { return null; }
  }
  return user;
}

/**
 * 鉴权统一 gate：把 sdk.authenticateRequest 拿到的原始 user 过一遍「冻结 + 待审批」拦截，
 * 返回放行的 user 或 null。HTTP(context/resolveRequestUser) 与 Socket.IO 两条鉴权路径都必须
 * 经此函数，避免任一路径漏检（此前 socket 直接采信原始 user，绕过冻结/审批 gate）。
 */
export async function applyAuthGates(user: User | null): Promise<User | null> {
  if (!user || user.disabled) return null;
  return passesApproval(user);
}

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  clientIp: string;
  /** 当前 tRPC 接口路径（如 "scripts.generate"），由 trpc.ts 的盖章中间件写入。
   *  用作 LLM 调用日志的场景标签——新增入口零改动自动覆盖。 */
  rpcPath?: string;
  /** 溯源指纹（行为日志用，见 extractTraceFingerprints）：设备指纹 / UA / 会话指纹。 */
  deviceFp?: string | null;
  userAgent?: string | null;
  sessionFp?: string | null;
};

// Dev-only: auto-login when neither OAuth nor DB is configured (local testing without external services)
const DEV_USER: User = {
  id: 1,
  openId: "dev_user_local",
  name: "Dev User",
  email: "dev@localhost",
  loginMethod: "dev",
  passwordHash: null,
  // dev bypass = 本地超级管理员，便于本地访问/测试管理后台（生产由真实 role/adminLevel 决定）。
  role: "admin",
  adminLevel: 4,
  disabled: false,
  emailVerified: true,
  approved: true,
  verifyCode: null,
  verifyCodeExpiresAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  lastSignedIn: new Date(),
};

const isDevBypass =
  process.env.NODE_ENV === "development" &&
  !ENV.oAuthServerUrl &&
  !process.env.DATABASE_URL;

/** Lightweight session check for raw Express routes (proxies, etc.). Returns true if authenticated. */
export async function isRequestAuthenticated(req: CreateExpressContextOptions["req"]): Promise<boolean> {
  if (isDevBypass) return true;
  return (await resolveRequestUser(req)) !== null;
}

/**
 * Resolve the full authenticated user (id + role) from a raw Express request —
 * used by the storage download gateway, which must enforce ownership/role and
 * cannot rely on the tRPC context. Returns null when unauthenticated.
 */
export async function resolveRequestUser(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  if (isDevBypass) return DEV_USER;
  try {
    const u = await sdk.authenticateRequest(req);
    return applyAuthGates(u); // 冻结/待审批用户视为未登录
  } catch {
    return null;
  }
}

/** Whether the server is running in dev-bypass mode (no OAuth + no DATABASE_URL). */
export function isDevBypassMode(): boolean {
  return isDevBypass;
}

/** 溯源指纹提取（行为日志用）：
 *  - deviceFp：客户端设备指纹（x-device-fp 请求头，前端 canvas/webgl/屏幕/时区等特征哈希，
 *    存 localStorage 跨会话稳定）——同一账号被多人使用时按设备区分。仅接受 16~64 位十六进制。
 *  - userAgent：浏览器/系统标识（截 255）。
 *  - sessionFp：会话指纹 = Cookie 全串 SHA-256 前 16 位（不落原始 cookie，防日志泄漏会话凭证）；
 *    同一设备的不同登录会话/不同浏览器可区分。 */
export function extractTraceFingerprints(req: CreateExpressContextOptions["req"]): { deviceFp: string | null; userAgent: string | null; sessionFp: string | null } {
  const h = req.headers ?? {};
  const rawFp = typeof h["x-device-fp"] === "string" ? h["x-device-fp"].trim() : "";
  const deviceFp = /^[a-f0-9]{16,64}$/i.test(rawFp) ? rawFp.toLowerCase() : null;
  const ua = typeof h["user-agent"] === "string" ? h["user-agent"].slice(0, 255) : null;
  const cookie = typeof h.cookie === "string" ? h.cookie : "";
  const sessionFp = cookie ? createHash("sha256").update(cookie).digest("hex").slice(0, 16) : null;
  return { deviceFp, userAgent: ua, sessionFp };
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // req.ip is set by Express respecting the "trust proxy" setting configured in index.ts.
  // It correctly handles X-Forwarded-For from trusted proxies and falls back to socket IP.
  const clientIp = opts.req.ip ?? opts.req.socket?.remoteAddress ?? "unknown";
  const trace = extractTraceFingerprints(opts.req);

  if (isDevBypass) {
    user = DEV_USER;
    return { req: opts.req, res: opts.res, user, clientIp: "127.0.0.1", ...trace };
  } else {
    try {
      user = await sdk.authenticateRequest(opts.req);
      user = await applyAuthGates(user); // 冻结/待审批用户视为未登录（管理员豁免、开关关闭即恢复）
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    clientIp,
    ...trace,
  };
}
