import crypto from "crypto";
import { ENV } from "./env";

// Short-lived HMAC token authorizing one streamed upload to the storage proxy.
// Issued by the authenticated chat.createUploadUrl mutation (which already
// checked membership) and verified by the raw PUT route, so that route needs no
// session of its own. The exact storage key is bound in, so the client can't
// redirect the write to another key.
export interface UploadTokenPayload {
  key: string;
  conversationId: number;
  userId: number;
  maxBytes: number;
  contentType: string;
  exp: number; // epoch ms
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

export function signUploadToken(p: UploadTokenPayload): string {
  const body = b64url(JSON.stringify(p));
  const mac = crypto.createHmac("sha256", ENV.cookieSecret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", ENV.cookieSecret).update(body).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadTokenPayload;
    if (typeof p.exp !== "number" || Date.now() > p.exp) return null;
    if (typeof p.key !== "string" || typeof p.maxBytes !== "number") return null;
    return p;
  } catch {
    return null;
  }
}
