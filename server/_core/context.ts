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

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  clientIp: string;
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
    return passesApproval(u?.disabled ? null : u); // 冻结/待审批用户视为未登录
  } catch {
    return null;
  }
}

/** Whether the server is running in dev-bypass mode (no OAuth + no DATABASE_URL). */
export function isDevBypassMode(): boolean {
  return isDevBypass;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // req.ip is set by Express respecting the "trust proxy" setting configured in index.ts.
  // It correctly handles X-Forwarded-For from trusted proxies and falls back to socket IP.
  const clientIp = opts.req.ip ?? opts.req.socket?.remoteAddress ?? "unknown";

  if (isDevBypass) {
    user = DEV_USER;
    return { req: opts.req, res: opts.res, user, clientIp: "127.0.0.1" };
  } else {
    try {
      user = await sdk.authenticateRequest(opts.req);
      if (user?.disabled) user = null; // 冻结用户视为未登录，立即失去 API 访问
      user = await passesApproval(user); // 待审批用户视为未登录（管理员豁免、开关关闭即恢复）
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
  };
}
