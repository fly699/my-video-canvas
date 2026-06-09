import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "crypto";
import { ENV } from "./env";

// AES-256-GCM encryption for admin-distributed kie.ai keys at rest. The key is
// derived from KIE_KEY_SECRET via scrypt with a per-ciphertext random salt, so
// two encryptions of the same key produce different ciphertext. Format:
//   v1:<saltB64>:<ivB64>:<tagB64>:<ciphertextB64>
// The ENV fallback to process.env keeps this unit-testable (tests set the env
// var before import without depending on ENV's load-time snapshot).
function secret(): string {
  return ENV.kieKeySecret || process.env.KIE_KEY_SECRET || "";
}

/** Whether a KIE_KEY_SECRET is configured (required to store/use distributed keys). */
export function isKieCryptoConfigured(): boolean {
  return !!secret();
}

function deriveKey(salt: Buffer): Buffer {
  const s = secret();
  if (!s) throw new Error("KIE_KEY_SECRET 未配置，无法加密/解密 kie 密钥");
  return scryptSync(s, salt, 32);
}

export function encryptKieKey(plain: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptKieKey(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "v1") throw new Error("kie 密钥密文格式错误");
  const [, saltB64, ivB64, tagB64, ctB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Stable SHA-256 of the raw key (secret-independent) — for dedupe / lookup. */
export function kieKeyHash(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Last 4 chars for display ("…ab12"). */
export function kieKeyLast4(plain: string): string {
  return plain.length <= 4 ? plain : plain.slice(-4);
}
