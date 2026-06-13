import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { ENV } from "../env";

// AES-256-GCM encryption for ComfyUI ops-center SSH credentials at rest (DB).
// Derived from SSH_KEY_SECRET via scrypt with a per-ciphertext random salt, so
// two encryptions of the same secret produce different ciphertext. Format:
//   v1:<saltB64>:<ivB64>:<tagB64>:<ciphertextB64>
// Mirrors server/_core/kieCrypto.ts but uses an isolated secret so the SSH and
// kie credential domains never share a key. The ENV→process.env fallback keeps
// this unit-testable (set the env var before import).
function secret(): string {
  return ENV.sshKeySecret || process.env.SSH_KEY_SECRET || "";
}

/** Whether an SSH_KEY_SECRET is configured (required to store/use SSH servers). */
export function isSshCryptoConfigured(): boolean {
  return !!secret();
}

function deriveKey(salt: Buffer): Buffer {
  const s = secret();
  if (!s) throw new Error("SSH_KEY_SECRET 未配置，无法加密/解密 SSH 凭据");
  return scryptSync(s, salt, 32);
}

export function encryptSshSecret(plain: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSshSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "v1") throw new Error("SSH 凭据密文格式错误");
  const [, saltB64, ivB64, tagB64, ctB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Last 4 chars for display ("…ab12"). Empty for short secrets. */
export function sshSecretLast4(plain: string): string {
  return plain.length <= 4 ? "" : plain.slice(-4);
}
