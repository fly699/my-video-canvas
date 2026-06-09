import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";

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

// ── 登录记忆（仅本机 localStorage；密码仅 base64 混淆，非加密，自部署/局域网场景）──
const ACCTS_KEY = "avc:login:accounts:v1";
const PREFS_KEY = "avc:login:prefs:v1";
type SavedAccounts = Record<string, { p?: string }>; // key=email, p=base64(password)
interface LoginPrefs { lastEmail?: string; rememberUser?: boolean; rememberPass?: boolean; autoLogin?: boolean; startWithSystem?: boolean }
function loadAccounts(): SavedAccounts { try { return JSON.parse(localStorage.getItem(ACCTS_KEY) || "{}"); } catch { return {}; } }
function saveAccounts(a: SavedAccounts) { try { localStorage.setItem(ACCTS_KEY, JSON.stringify(a)); } catch { /* quota */ } }
function loadPrefs(): LoginPrefs { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; } }
function savePrefs(p: LoginPrefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* quota */ } }
const encPw = (s: string) => { try { return btoa(unescape(encodeURIComponent(s))); } catch { return s; } };
const decPw = (s: string) => { try { return decodeURIComponent(escape(atob(s))); } catch { return s; } };

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Whether the server has Google OAuth configured (runtime probe — no rebuild needed).
  const [googleAvailable, setGoogleAvailable] = useState(false);

  // 登录记忆选项
  const [rememberUser, setRememberUser] = useState(true);
  const [rememberPass, setRememberPass] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const [startWithSystem, setStartWithSystem] = useState(false);
  const [accounts, setAccounts] = useState<SavedAccounts>({});
  const autoTried = useRef(false);

  // 载入记忆的账号/选项并预填
  useEffect(() => {
    const prefs = loadPrefs();
    const accts = loadAccounts();
    setAccounts(accts);
    setRememberUser(prefs.rememberUser ?? true);
    setRememberPass(prefs.rememberPass ?? false);
    setAutoLogin(prefs.autoLogin ?? false);
    setStartWithSystem(prefs.startWithSystem ?? false);
    const last = prefs.lastEmail;
    if ((prefs.rememberUser ?? true) && last) {
      setEmail(last);
      const p = accts[last]?.p;
      if (prefs.rememberPass && p) setPassword(decPw(p));
    }
  }, []);

  function setEmailWithFill(v: string) {
    setEmail(v);
    const p = accounts[v]?.p;
    if (p) setPassword(decPw(p)); // 选择历史用户时自动填充其密码
  }

  function persistOnSuccess() {
    const accts = loadAccounts();
    if (rememberUser || rememberPass || autoLogin) {
      const entry = accts[email] ?? {};
      if (rememberPass || autoLogin) entry.p = encPw(password); else delete entry.p;
      accts[email] = entry;
    } else if (accts[email]) {
      delete accts[email]; // 全不勾 → 移除该账号记忆
    }
    saveAccounts(accts);
    savePrefs({
      lastEmail: (rememberUser || rememberPass || autoLogin) ? email : undefined,
      rememberUser, rememberPass: rememberPass || autoLogin, autoLogin, startWithSystem,
    });
  }

  async function performAuth() {
    setError(null);
    setLoading(true);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { email, password };
      if (mode === "register" && name.trim()) body.name = name.trim();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) { setError(data.error ?? "操作失败，请稍后重试"); return; }
      persistOnSuccess();
      const nextParam = new URLSearchParams(window.location.search).get("next");
      const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
      window.location.href = safeNext;
    } catch {
      setError("网络错误，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  }

  // 下次自动登录：预填完成且开启时，自动提交一次。
  // 但「主动退出登录」后本次跳过（消费一次性标记），以便切换账号。
  useEffect(() => {
    if (autoTried.current) return;
    let justLoggedOut = false;
    try {
      justLoggedOut = sessionStorage.getItem("avc:login:skipAuto") === "1";
      if (justLoggedOut) sessionStorage.removeItem("avc:login:skipAuto");
    } catch { /* ignore */ }
    if (justLoggedOut) {
      autoTried.current = true; // 本次会话不再自动登录，允许手动换号
      return;
    }
    const prefs = loadPrefs();
    if (prefs.autoLogin && mode === "login" && email && password) {
      autoTried.current = true;
      void performAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, mode]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void performAuth();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--c-canvas, #0d0d10)",
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
              overflow: "hidden",
              marginBottom: "12px",
            }}
          >
            <img src="/chat-icon.svg" alt="KingTai" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            background: "var(--c-input, rgba(255,255,255,0.04))",
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
                background: mode === m ? "var(--c-elevated, rgba(255,255,255,0.08))" : "transparent",
                boxShadow: mode === m ? "0 1px 3px oklch(0 0 0 / 0.12)" : "none",
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
              onChange={(e) => setEmailWithFill(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              list={Object.keys(accounts).length ? "avc-login-emails" : undefined}
              style={inputStyle}
            />
            {Object.keys(accounts).length > 0 && (
              <datalist id="avc-login-emails">
                {Object.keys(accounts).map((e) => <option key={e} value={e} />)}
              </datalist>
            )}
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

          {/* 登录记忆选项（仅登录模式） */}
          {mode === "login" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "2px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px" }}>
                <Check label="记住用户名" checked={rememberUser} onChange={(v) => {
                  setRememberUser(v);
                  if (!v) { setRememberPass(false); setAutoLogin(false); }
                }} />
                <Check label="记住密码" checked={rememberPass} onChange={(v) => {
                  setRememberPass(v);
                  if (v) setRememberUser(true); else setAutoLogin(false);
                }} />
                <Check label="下次自动登录" checked={autoLogin} onChange={(v) => {
                  setAutoLogin(v);
                  if (v) { setRememberPass(true); setRememberUser(true); }
                }} />
                <Check label="随系统启动" checked={startWithSystem} onChange={setStartWithSystem} />
              </div>
              {startWithSystem && (
                <div style={{ fontSize: "11px", color: "var(--c-t3, rgba(255,255,255,0.4))", lineHeight: 1.5 }}>
                  「随系统启动」需在桌面端配合：把本应用加入 Windows 启动项（运行 deploy\add-to-startup.bat 一键添加）。配合「下次自动登录」即可开机自动进入。
                </div>
              )}
              {rememberPass && (
                <div style={{ fontSize: "11px", color: "oklch(0.62 0.15 70)", lineHeight: 1.5 }}>
                  ⚠️ 记住密码会把密码保存在本机浏览器（仅混淆、非加密）。请仅在私人电脑上使用。
                </div>
              )}
            </div>
          )}

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
                ? "var(--c-input, rgba(255,255,255,0.06))"
                : "oklch(0.58 0.22 285 / 0.85)",
              color: loading ? "var(--c-t3, rgba(255,255,255,0.4))" : "#fff",
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
              <div style={{ flex: 1, height: "1px", background: "var(--c-bd1, rgba(255,255,255,0.07))" }} />
              <span style={{ fontSize: "12px", color: "var(--c-t2, rgba(255,255,255,0.3))" }}>或</span>
              <div style={{ flex: 1, height: "1px", background: "var(--c-bd1, rgba(255,255,255,0.07))" }} />
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
                  border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
                  borderRadius: "8px",
                  background: "var(--c-input, rgba(255,255,255,0.04))",
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
          <span style={{ fontSize: "11px", lineHeight: 1.6, color: "oklch(0.52 0.13 150)" }}>
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

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--c-t2, rgba(255,255,255,0.6))", cursor: "pointer", userSelect: "none" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "oklch(0.62 0.19 285)", width: 15, height: 15, cursor: "pointer" }} />
      {label}
    </label>
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
  background: "var(--c-input, rgba(255,255,255,0.04))",
  color: "var(--c-t1, #f0f0f4)",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};
