import { describe, expect, it } from "vitest";
import { signUploadToken, verifyUploadToken } from "./_core/uploadToken";

const base = { key: "chat/1/2026-06-01/abc-file_1234.zip", conversationId: 1, userId: 7, maxBytes: 1024, contentType: "application/zip" };

describe("uploadToken", () => {
  it("round-trips a valid token", () => {
    const t = signUploadToken({ ...base, exp: Date.now() + 60_000 });
    const p = verifyUploadToken(t);
    expect(p?.key).toBe(base.key);
    expect(p?.userId).toBe(7);
  });
  it("rejects an expired token", () => {
    const t = signUploadToken({ ...base, exp: Date.now() - 1 });
    expect(verifyUploadToken(t)).toBeNull();
  });
  it("rejects a tampered payload", () => {
    const t = signUploadToken({ ...base, exp: Date.now() + 60_000 });
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, maxBytes: 9_999_999_999, exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyUploadToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyUploadToken(`${body}.deadbeef`)).toBeNull();
  });
  it("rejects malformed tokens", () => {
    expect(verifyUploadToken("")).toBeNull();
    expect(verifyUploadToken("nodot")).toBeNull();
  });
});
