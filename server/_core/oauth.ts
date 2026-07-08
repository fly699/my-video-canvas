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

    // Extract nonce from state and validate against the cookie set at OAuth initiation (CSRF prevention).
    // State is base64(JSON { redirectUri, nonce }) so sdk.decodeState() can still extract redirectUri.
    let stateNonce: string | null = null;
    try {
      const parsed = JSON.parse(atob(state)) as { nonce?: string };
      stateNonce = parsed.nonce ?? null;
    } catch { /* malformed state */ }

    const cookieHeader = req.headers.cookie ?? "";
    const nonceCookie = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("__oauth_nonce="))
      ?.slice("__oauth_nonce=".length);

    if (!stateNonce || !nonceCookie || stateNonce !== nonceCookie) {
      res.status(400).json({ error: "Invalid OAuth state — possible CSRF attempt" });
      return;
    }

    // Consume the nonce cookie so it cannot be replayed.
    // Include Secure when the request arrived over HTTPS so Chrome doesn't ignore the deletion.
    const secureClear = req.secure ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `__oauth_nonce=; SameSite=Lax; Path=/api/oauth; max-age=0${secureClear}`,
    );

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // 是否首登建号（决定审批制是否适用于本次 OAuth 登录）。
      const existed = await db.getUserByOpenId(userInfo.openId).catch(() => undefined);

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

      const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";

      // 注册审批：新建的 OAuth 用户 + 开关开启 + 非管理员/站长 → 置 approved=false、不签发 session，
      // 跳到待审批提示。已存在的老用户不受影响（登录照常）。
      let pendingApproval = false;
      try {
        const s = await db.getAuthSettings();
        pendingApproval = !existed && s.registrationApprovalEnabled && dbUser?.role !== "admin";
      } catch {
        // 读设置失败：对新建用户 fail-closed（当作待审批，不签发 session），与 context gate 同向，
        // 避免 DB 抖动时新用户被永久放行（approved 保持默认 true 再也拦不住）。
        pendingApproval = !existed && dbUser?.role !== "admin";
      }
      if (pendingApproval && dbUser) {
        await db.setUserApproved(dbUser.id, false).catch(() => { /* non-fatal */ });
        writeAuditLog({
          ip: clientIp, userId: dbUser.id, userEmail: userInfo.email ?? null, userName: userInfo.name ?? null,
          action: "login_oauth", detail: { method: userInfo.loginMethod ?? userInfo.platform ?? "oauth", pendingApproval: true },
        });
        res.redirect(302, "/login?approval=pending");
        return;
      }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

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
