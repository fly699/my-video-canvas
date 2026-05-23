import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { writeAuditLog } from "./auditLog";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // Validate the state against the nonce cookie set at OAuth initiation to prevent CSRF.
    const cookieHeader = req.headers.cookie ?? "";
    const nonceCookie = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("__oauth_nonce="))
      ?.slice("__oauth_nonce=".length);

    if (!nonceCookie || state !== nonceCookie) {
      res.status(400).json({ error: "Invalid OAuth state — possible CSRF attempt" });
      return;
    }

    // Consume the nonce cookie so it cannot be replayed
    res.setHeader(
      "Set-Cookie",
      "__oauth_nonce=; SameSite=Lax; Path=/api/oauth; max-age=0; HttpOnly",
    );

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      // Fetch the DB record so we have the numeric userId for audit logging.
      // This is best-effort — don't let a transient DB error break the login flow.
      let dbUser: Awaited<ReturnType<typeof db.getUserByOpenId>> = undefined;
      try { dbUser = await db.getUserByOpenId(userInfo.openId); } catch { /* non-fatal */ }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      writeAuditLog({
        ip: clientIp,
        userId: dbUser?.id ?? null,
        userEmail: userInfo.email ?? null,
        userName: userInfo.name ?? null,
        action: "login_oauth",
        detail: { method: userInfo.loginMethod ?? userInfo.platform ?? "oauth" },
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
