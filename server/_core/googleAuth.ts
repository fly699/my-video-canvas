import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import axios from "axios";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { writeAuditLog } from "./auditLog";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const NONCE_COOKIE = "__google_oauth_nonce";
const NONCE_PATH = "/api/auth/google";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** Only allow same-origin relative paths for the post-login redirect. */
function sanitizeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

/** Resolve the OAuth callback URL: explicit env override, else derived from request origin. */
function resolveRedirectUri(req: Request): string {
  if (ENV.googleRedirectUri) return ENV.googleRedirectUri;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim()
    || req.protocol
    || "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}${NONCE_PATH}/callback`;
}

export function registerGoogleAuthRoutes(app: Express) {
  // Step 1 — redirect the browser to Google's consent screen.
  app.get(NONCE_PATH, (req: Request, res: Response) => {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(503).json({ error: "Google 登录未配置" });
      return;
    }

    const next = sanitizeNext(getQueryParam(req, "next"));
    const nonce = crypto.randomUUID();
    // Pack nonce + next into state (base64 JSON) so the callback can validate
    // CSRF and restore the post-login destination.
    const state = Buffer.from(JSON.stringify({ nonce, next })).toString("base64");

    const secure = getSessionCookieOptions(req).secure ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${NONCE_COOKIE}=${nonce}; HttpOnly; SameSite=Lax; Path=${NONCE_PATH}; Max-Age=600${secure}`,
    );

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", resolveRedirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");

    res.redirect(302, url.toString());
  });

  // Step 2 — Google redirects back here with ?code & ?state.
  app.get(`${NONCE_PATH}/callback`, async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // Validate the CSRF nonce embedded in state against the cookie set at step 1.
    let stateNonce: string | null = null;
    let next = "/";
    try {
      const parsed = JSON.parse(Buffer.from(state, "base64").toString("utf8")) as {
        nonce?: string;
        next?: string;
      };
      stateNonce = parsed.nonce ?? null;
      next = sanitizeNext(parsed.next);
    } catch { /* malformed state */ }

    const nonceCookie = (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${NONCE_COOKIE}=`))
      ?.slice(`${NONCE_COOKIE}=`.length);

    if (!stateNonce || !nonceCookie || stateNonce !== nonceCookie) {
      res.status(400).json({ error: "Invalid OAuth state — possible CSRF attempt" });
      return;
    }

    // Consume the nonce cookie so it cannot be replayed.
    const secureClear = getSessionCookieOptions(req).secure ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${NONCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=${NONCE_PATH}; Max-Age=0${secureClear}`,
    );

    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(503).json({ error: "Google 登录未配置" });
      return;
    }

    try {
      // Exchange the authorization code for tokens.
      const tokenResp = await axios.post<{ access_token?: string }>(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: resolveRedirectUri(req),
          grant_type: "authorization_code",
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      const accessToken = tokenResp.data.access_token;
      if (!accessToken) {
        res.status(502).json({ error: "Google 未返回 access token" });
        return;
      }

      // Fetch the verified profile.
      const profileResp = await axios.get<{
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      }>(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const { sub, email: rawEmail, name, email_verified } = profileResp.data;
      if (!sub) {
        res.status(502).json({ error: "Google 用户信息缺少 sub" });
        return;
      }
      // Only trust the email for identity when Google asserts it's verified. An
      // unverified Google email could be attacker-set; trusting it would let them
      // claim invitations addressed to that email and (with owner-by-email
      // promotion) escalate. Unverified → treat as no email.
      const email = email_verified === true ? rawEmail : null;

      const openId = `google:${sub}`;
      const existed = await db.getUserByOpenId(openId).catch(() => undefined);
      await db.upsertUser({
        openId,
        name: name || (email ? email.split("@")[0] : null),
        email: email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // Best-effort fetch of the numeric id for invite-claiming + audit logging.
      let dbUser: Awaited<ReturnType<typeof db.getUserByOpenId>> = undefined;
      try { dbUser = await db.getUserByOpenId(openId); } catch { /* non-fatal */ }

      if (email && dbUser?.id) {
        try { await db.claimPendingInvitations(email.toLowerCase(), dbUser.id); } catch { /* non-fatal */ }
      }

      const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";

      // 注册审批：新建的 Google 用户 + 开关开启 + 非管理员 → 待审批，不签发 session。
      const authSettings = await db.getAuthSettings().catch(() => null);
      const pendingApproval = !existed && !!authSettings?.registrationApprovalEnabled && dbUser?.role !== "admin";
      if (pendingApproval && dbUser) {
        await db.setUserApproved(dbUser.id, false).catch(() => { /* non-fatal */ });
        writeAuditLog({
          ip: clientIp, userId: dbUser.id, userEmail: email ?? null, userName: name ?? null,
          action: "login_oauth", detail: { method: "google", pendingApproval: true },
        });
        res.redirect(302, "/login?approval=pending");
        return;
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      writeAuditLog({
        ip: clientIp,
        userId: dbUser?.id ?? null,
        userEmail: email ?? null,
        userName: name ?? null,
        action: "login_oauth",
        detail: { method: "google" },
      });

      res.redirect(302, next);
    } catch (error) {
      console.error("[GoogleAuth] Callback failed", error);
      res.status(500).json({ error: "Google 登录失败，请稍后重试" });
    }
  });
}
