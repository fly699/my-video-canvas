import { useState } from "react";
import { Film } from "lucide-react";

type Mode = "login" | "register";

// OAuth is available only when both env vars are set
const oauthAvailable = !!(import.meta.env.VITE_OAUTH_PORTAL_URL && import.meta.env.VITE_APP_ID);

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

      window.location.href = "/";
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

        {/* OAuth divider + button */}
        {oauthAvailable && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "20px 0 0" }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
              <span style={{ fontSize: "12px", color: "var(--c-t2, rgba(255,255,255,0.3))" }}>或</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
            </div>
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
              第三方登录（Google / OAuth）
            </button>
          </>
        )}
      </div>
      <div style={{
        position: "absolute", bottom: "20px", left: 0, right: 0,
        textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: "12px", lineHeight: 1.6,
        pointerEvents: "none", userSelect: "none",
      }}>
        © {new Date().getFullYear()} 金泰智算 · KingTai Smart
      </div>
    </div>
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
