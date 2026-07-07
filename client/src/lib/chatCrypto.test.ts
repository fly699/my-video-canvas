import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair, exportPrivateKeyJwk, deriveSharedKey, generateRoomKey,
  wrapRoomKeyForMember, unwrapRoomKey, roomKeyToB64, roomKeyFromB64, encryptText, decryptText,
} from "./chatCrypto";

// These back the serverless group room-key bundle path (fix for "[无法解密]").
describe("chatCrypto 房间密钥封装/解封 往返（群聊密钥收敛的基础）", () => {
  it("A 用 B 的公钥封装房间密钥 → B 用 A 的公钥解出同一把（ECDH 双向一致）", async () => {
    const a = await generateIdentityKeyPair();
    const b = await generateIdentityKeyPair();
    const aPubJwk = a.publicKeyJwk;
    const bPubJwk = b.publicKeyJwk;

    const room = await generateRoomKey();
    // A wraps for B: wrapping = ECDH(aPriv, bPub)
    const aWrapForB = await deriveSharedKey(a.privateKey, bPubJwk);
    const wrapped = await wrapRoomKeyForMember(room, aWrapForB);
    // B unwraps: wrapping = ECDH(bPriv, aPub) — must be the SAME shared key
    const bUnwrap = await deriveSharedKey(b.privateKey, aPubJwk);
    const roomOnB = await unwrapRoomKey(wrapped, bUnwrap);

    // Prove they're the same key: encrypt with A's room key, decrypt with B's.
    const enc = await encryptText(room, "你好，端到端");
    expect(await decryptText(roomOnB, enc)).toBe("你好，端到端");
    // exportPrivateKeyJwk sanity (used when persisting identity)
    expect((await exportPrivateKeyJwk(a.privateKey)).d).toBeTruthy();
  });

  it("房间密钥 base64 往返（IndexedDB 持久化）后仍能解密", async () => {
    const room = await generateRoomKey();
    const enc = await encryptText(room, "刷新不丢");
    const restored = await roomKeyFromB64(await roomKeyToB64(room));
    expect(await decryptText(restored, enc)).toBe("刷新不丢");
  });
});
