import * as SecureStore from "expo-secure-store";
import { createContext, useContext } from "react";
import { getBaseUrlSync } from "./config";

// 会话令牌（与 Web 端同一个 JWT，只是移动端用 Authorization: Bearer 传，不用 Cookie）。
// 存 expo-secure-store（Android Keystore / iOS Keychain），并在内存里缓存一份供 tRPC 同步读取。
const TOKEN_KEY = "avc_session_token";
let inMemoryToken: string | null = null;

export function getToken(): string | null {
  return inMemoryToken;
}

export async function loadToken(): Promise<string | null> {
  try { inMemoryToken = await SecureStore.getItemAsync(TOKEN_KEY); } catch { inMemoryToken = null; }
  return inMemoryToken;
}

export async function saveToken(token: string): Promise<void> {
  inMemoryToken = token;
  try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* ignore */ }
}

export async function clearToken(): Promise<void> {
  inMemoryToken = null;
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* ignore */ }
}

/** 邮箱密码登录：走后端 /api/auth/login，带 X-Auth-Mode: token 让它把会话令牌放进响应体（M0 已支持）。
 *  返回令牌，由调用方 signIn 统一落盘（单一持久化入口）。 */
export async function login(email: string, password: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const base = getBaseUrlSync();
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Mode": "token" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string; error?: string; needVerification?: boolean };
    if (!res.ok || !data.token) {
      return { ok: false, error: data.error || (data.needVerification ? "邮箱尚未验证" : `登录失败 (${res.status})`) };
    }
    return { ok: true, token: data.token };
  } catch (e) {
    return { ok: false, error: "无法连接服务器：" + (e as Error).message };
  }
}

// ── React 上下文：全局登录态 ──
export type AuthState = { token: string | null; signIn: (t: string) => void; signOut: () => void };
export const AuthContext = createContext<AuthState>({ token: null, signIn: () => {}, signOut: () => {} });
export const useAuth = () => useContext(AuthContext);
