import { describe, it, expect } from "vitest";
import { redactSearchEmail } from "./db";

// chat.searchUsers must not let any logged-in user harvest全站邮箱 by typing partial
// queries. Email is only echoed back when the query is the user's EXACT full email.
describe("redactSearchEmail — 人员搜索邮箱脱敏（PII 枚举回归）", () => {
  const rows = [
    { id: 1, name: "Alice", email: "alice@gmail.com" as string | null },
    { id: 2, name: "Bob", email: "bob@x.com" as string | null },
  ];

  it("子串/域名枚举：邮箱一律置空（堵收割）", () => {
    expect(redactSearchEmail(rows, "ali").every((u) => u.email === null)).toBe(true);
    expect(redactSearchEmail(rows, "@gmail.com").every((u) => u.email === null)).toBe(true);
    expect(redactSearchEmail(rows, "a").every((u) => u.email === null)).toBe(true);
  });

  it("按名字搜索：保留 name、邮箱仍置空", () => {
    const out = redactSearchEmail(rows, "Alice");
    expect(out[0].name).toBe("Alice");
    expect(out[0].email).toBeNull();
  });

  it("精确完整邮箱（含大小写/空白）：回显该用户邮箱（搜索者已知）", () => {
    expect(redactSearchEmail(rows, "alice@gmail.com")[0].email).toBe("alice@gmail.com");
    expect(redactSearchEmail(rows, "  ALICE@GMAIL.COM ")[0].email).toBe("alice@gmail.com");
    expect(redactSearchEmail(rows, "alice@gmail.com")[1].email).toBeNull(); // 其他人不受影响
  });
});
