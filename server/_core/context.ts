import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// Dev-only: auto-login when neither OAuth nor DB is configured (local testing without external services)
const DEV_USER: User = {
  id: 1,
  openId: "dev_user_local",
  name: "Dev User",
  email: "dev@localhost",
  loginMethod: "dev",
  role: "user",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  lastSignedIn: new Date(),
};

const isDevBypass =
  process.env.NODE_ENV === "development" &&
  !ENV.oAuthServerUrl &&
  !process.env.DATABASE_URL;

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  if (isDevBypass) {
    user = DEV_USER;
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
  };
}
