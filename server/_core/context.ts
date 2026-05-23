import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";

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
  role: "user",
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
  try {
    await sdk.authenticateRequest(req);
    return true;
  } catch {
    return false;
  }
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
