import { describe, it, expect } from "vitest";
import { isDupEntryError } from "./db";

// drizzle wraps driver errors in DrizzleQueryError with the real mysql2 error under
// `.cause`, so isDupEntryError must walk the cause chain — otherwise the unique-index
// race in createVideoTask/upsertCollaborator would rethrow (500) instead of collapsing
// to get-or-create. Verified against live MariaDB (cause.code = ER_DUP_ENTRY).
describe("isDupEntryError — 唯一冲突识别（含 drizzle 包裹）", () => {
  it("识别裸 mysql2 错误（code / errno）", () => {
    expect(isDupEntryError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(true);
    expect(isDupEntryError({ errno: 1062 })).toBe(true);
    expect(isDupEntryError({ code: "ER_DUP_ENTRY" })).toBe(true);
  });
  it("识别 DrizzleQueryError 包裹（.cause 链）", () => {
    const wrapped = { name: "DrizzleQueryError", query: "insert ...", cause: { code: "ER_DUP_ENTRY", errno: 1062 } };
    expect(isDupEntryError(wrapped)).toBe(true);
    expect(isDupEntryError({ cause: { cause: { errno: 1062 } } })).toBe(true); // 多层
  });
  it("非唯一冲突 / 空值 → false", () => {
    expect(isDupEntryError({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(false);
    expect(isDupEntryError(new Error("boom"))).toBe(false);
    expect(isDupEntryError(null)).toBe(false);
    expect(isDupEntryError(undefined)).toBe(false);
  });
});
