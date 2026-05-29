import { useEffect, useState } from "react";
import { Film, ShieldCheck } from "lucide-react";

type Mode = "login" | "register";

// Manus OAuth portal is available only when both build-time env vars are set
const oauthAvailable = !!(import.meta.env.VITE_OAUTH_PORTAL_URL && import.meta.env.VITE_APP_ID);

// Google login destination — preserves any ?next= for share-link / invite flows.
function startGoogle(): void {
  const nextParam = new URLSearchParams(window.location.search).get("next");
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  window.location.href = "/api/auth/google" + (safeNext ? `?next=${encodeURIComponent(safeNext)}` : "");
}

function startOAuth(): void {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthPortalUrl || !appId) return;
  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    // Embed a random nonce in the state so the server-side callback can validate CSRF.
    // State must remain valid base64 because sdk.ts decodes it with atob() to recover redirectUri.
    const nonce = crypto.randomUUID();
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `__oauth_nonce=${nonce}; SameSite=Lax; Path=/api/oauth; max-age=600${secure}`;
    // Pack redirectUri + nonce together, base64-encoded so sdk.decodeState() can still extract redirectUri
    const state = btoa(JSON.stringify({ redirectUri, nonce }));
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    window.location.href = url.toString();
  } catch { /* ignore */ }
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Whether the server has Google OAuth configured (runtime probe — no rebuild needed).
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { google?: boolean } | null) => {
        if (alive && data?.google) setGoogleAvailable(true);
      })
      .catch(() => { /* providers probe is best-effort */ });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { email, password };
      if (mode === "register" && name.trim()) {
        body.name = name.trim();
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        setError(data.error ?? "操作失败，请稍后重试");
        return;
      }

      // Honor ?next=… for share-link / invite flows
      const nextParam = new URLSearchParams(window.location.search).get("next");
      const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
      window.location.href = safeNext;
    } catch {
      setError("网络错误，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-background, #0d0d10)",
        padding: "24px",
      }}
    >
      {/* Subtle background gradient */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.68 0.22 285 / 0.07) 0%, transparent 70%)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "400px",
          background: "var(--c-surface, #1a1a22)",
          border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
          borderRadius: "16px",
          padding: "40px 36px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        }}
      >
        {/* Logo / Title */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "52px",
              height: "52px",
              borderRadius: "14px",
              background: "oklch(0.58 0.22 285 / 0.15)",
              marginBottom: "12px",
            }}
          >
            <Film
              style={{
                width: "26px",
                height: "26px",
                color: "oklch(0.72 0.2 285)",
              }}
            />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 700,
              color: "var(--c-t1, #f0f0f4)",
              letterSpacing: "-0.3px",
            }}
          >
            AI 视频画布
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: "13px",
              color: "var(--c-t2, rgba(255,255,255,0.45))",
            }}
          >
            {mode === "login" ? "登录你的账号" : "创建新账号"}
          </p>
        </div>

        {/* Toggle */}
        <div
          style={{
            display: "flex",
            gap: "2px",
            background: "rgba(255,255,255,0.04)",
            borderRadius: "8px",
            padding: "3px",
            marginBottom: "24px",
          }}
        >
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              style={{
                flex: 1,
                padding: "7px 0",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                transition: "all 0.15s",
                background: mode === m ? "rgba(255,255,255,0.08)" : "transparent",
                color: mode === m ? "var(--c-t1, #f0f0f4)" : "var(--c-t2, rgba(255,255,255,0.45))",
              }}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Name field (register only) */}
          {mode === "register" && (
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--c-t2, rgba(255,255,255,0.45))",
                  marginBottom: "6px",
                }}
              >
                昵称（可选）
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的名字"
                style={inputStyle}
              />
            </div>
          )}

          {/* Email */}
          <div>
            <label style={labelStyle}>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>密码{mode === "register" ? "（至少 8 位）" : ""}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              style={inputStyle}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#f87171",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "4px",
              padding: "11px 0",
              border: "none",
              borderRadius: "8px",
              background: loading
                ? "rgba(255,255,255,0.06)"
                : "oklch(0.58 0.22 285 / 0.85)",
              color: loading ? "rgba(255,255,255,0.4)" : "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              letterSpacing: "0.2px",
            }}
          >
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        {/* OAuth divider + buttons */}
        {(oauthAvailable || googleAvailable) && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "20px 0 0" }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
              <span style={{ fontSize: "12px", color: "var(--c-t2, rgba(255,255,255,0.3))" }}>或</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
            </div>

            {/* Google sign-in */}
            {googleAvailable && (
              <button
                type="button"
                onClick={startGoogle}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  marginTop: "12px",
                  padding: "11px 0",
                  width: "100%",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "8px",
                  background: "#ffffff",
                  color: "#1f1f1f",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <GoogleIcon />
                使用 Google 登录
              </button>
            )}

            {/* Manus OAuth portal */}
            {oauthAvailable && (
              <button
                type="button"
                onClick={startOAuth}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  marginTop: "12px",
                  padding: "11px 0",
                  width: "100%",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--c-t1, #f0f0f4)",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                第三方登录（OAuth 门户）
              </button>
            )}
          </>
        )}

        {/* 版权信息 */}
        <div style={{
          marginTop: "22px", padding: "10px 12px", borderRadius: "10px",
          border: "1px solid rgba(34,197,94,0.28)", background: "rgba(34,197,94,0.06)",
          display: "flex", gap: "8px", alignItems: "flex-start",
        }}>
          <ShieldCheck style={{ width: 15, height: 15, color: "#22c55e", flexShrink: 0, marginTop: "2px" }} />
          <span style={{ fontSize: "11px", lineHeight: 1.6, color: "rgba(180,225,190,0.78)" }}>
            © {new Date().getFullYear()} 金泰智算（KingTai Smart）版权所有。本工具由金泰智算自主研发，所有模板、预设库与界面设计均受版权保护。未经授权，禁止复制或商业使用。
          </span>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--c-t2, rgba(255,255,255,0.45))",
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.04)",
  color: "var(--c-t1, #f0f0f4)",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};
