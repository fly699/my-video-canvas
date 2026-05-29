// End-to-end encryption helpers for serverless chat mode.
// Uses the browser-native Web Crypto API (no external dependencies):
//   - ECDH P-256 for key agreement between users
//   - AES-GCM 256 for symmetric message/file encryption
// The server only ever relays the ciphertext + IV produced here.

const subtle = globalThis.crypto.subtle;

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export type IdentityKeyPair = { publicKeyJwk: JsonWebKey; privateKey: CryptoKey };

/** Generate a long-lived ECDH identity keypair. Private key is non-extractable
 *  for messages but we keep it as a CryptoKey instance to store in IndexedDB. */
export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const kp = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable so we can persist the private key as JWK in IndexedDB
    ["deriveKey", "deriveBits"],
  );
  const publicKeyJwk = await subtle.exportKey("jwk", kp.publicKey);
  return { publicKeyJwk, privateKey: kp.privateKey };
}

export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return subtle.exportKey("jwk", key);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
}

async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

/** Derive a shared AES-GCM key from my private key + their public key (DM path). */
export async function deriveSharedKey(myPrivate: CryptoKey, theirPublicJwk: JsonWebKey): Promise<CryptoKey> {
  const theirPublic = await importPublicKeyJwk(theirPublicJwk);
  return subtle.deriveKey(
    { name: "ECDH", public: theirPublic },
    myPrivate,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Generate a fresh symmetric room key (group serverless conversations). */
export async function generateRoomKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportRawKey(key: CryptoKey): Promise<ArrayBuffer> {
  return subtle.exportKey("raw", key);
}

export async function importRawKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export type Encrypted = { ciphertext: string; iv: string };

export async function encryptText(key: CryptoKey, plaintext: string): Promise<Encrypted> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: bufToB64(ct), iv: bufToB64(iv.buffer) };
}

export async function decryptText(key: CryptoKey, payload: Encrypted): Promise<string> {
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(b64ToBuf(payload.iv)) }, key, b64ToBuf(payload.ciphertext));
  return new TextDecoder().decode(pt);
}

export async function encryptBytes(key: CryptoKey, bytes: ArrayBuffer): Promise<Encrypted> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { ciphertext: bufToB64(ct), iv: bufToB64(iv.buffer) };
}

export async function decryptBytes(key: CryptoKey, payload: Encrypted): Promise<ArrayBuffer> {
  return subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(b64ToBuf(payload.iv)) }, key, b64ToBuf(payload.ciphertext));
}

/** Wrap a room key for a specific member using an ECDH-derived wrapping key.
 *  The member unwraps with deriveSharedKey(theirPrivate, myPublic). */
export async function wrapRoomKeyForMember(roomKey: CryptoKey, wrappingKey: CryptoKey): Promise<Encrypted> {
  const raw = await exportRawKey(roomKey);
  return encryptBytes(wrappingKey, raw);
}

export async function unwrapRoomKey(payload: Encrypted, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const raw = await decryptBytes(wrappingKey, payload);
  return importRawKey(raw);
}
