import AsyncStorage from "@react-native-async-storage/async-storage";

// 服务器基址。默认指向命名隧道的公网域名；也可在「设置」里改成局域网地址（如 http://192.168.1.10:3000）。
// 存 AsyncStorage，改一次持久生效。
const KEY = "avc_base_url";
const DEFAULT_BASE_URL = "https://avc.fordhev.store";

let cached: string | null = null;

export async function loadBaseUrl(): Promise<string> {
  if (cached) return cached;
  try { cached = (await AsyncStorage.getItem(KEY)) || DEFAULT_BASE_URL; } catch { cached = DEFAULT_BASE_URL; }
  return cached;
}

export function getBaseUrlSync(): string {
  return cached || DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  cached = url.replace(/\/+$/, ""); // 去掉尾部斜杠
  try { await AsyncStorage.setItem(KEY, cached); } catch { /* ignore */ }
}
