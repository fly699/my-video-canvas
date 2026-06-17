// Central URL-protocol allowlist for any user-controllable URL that gets bound to
// an <a href> / <img src> / window.open. Node payloads can be set wholesale via
// canvas/template JSON import or collaboration events (which do NOT validate URL
// protocol), so a value like `javascript:...` could otherwise reach an href and
// execute on click. Only http(s) and same-origin absolute paths are allowed;
// data:/blob:/vbscript:/javascript: and protocol-relative `//host` are rejected.
export function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const u = url.trim();
  if (u.startsWith("/") && !u.startsWith("//")) return true; // same-origin absolute path
  return /^https?:\/\//i.test(u);
}

/** Returns the URL if it passes isSafeUrl, else undefined — convenient for `href={safeHref(x)}`. */
export function safeHref(url: string | undefined | null): string | undefined {
  return isSafeUrl(url) ? (url as string) : undefined;
}
