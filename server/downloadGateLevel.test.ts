import { describe, it, expect } from "vitest";
import { userAdminLevel, isLevelExemptFromDownloadGate } from "./_core/downloadAuth";

// 下载门控分级：adminLevel >= 免受阈值(bypassLevel) → 放行，低于 → 受控。
// 阈值默认 1（普通成员 adminLevel=0 受控、所有管理员 adminLevel≥1 放行），可后台调高。
describe("下载门控分级 isLevelExemptFromDownloadGate", () => {
  it("默认阈值 1：普通成员受控，各级管理员放行", () => {
    expect(isLevelExemptFromDownloadGate(0, 1)).toBe(false); // 普通成员 → 受控
    expect(isLevelExemptFromDownloadGate(1, 1)).toBe(true);  // L1
    expect(isLevelExemptFromDownloadGate(4, 1)).toBe(true);  // L4
  });

  it("阈值 3：L1/L2 也受控，L3/L4 放行", () => {
    expect(isLevelExemptFromDownloadGate(0, 3)).toBe(false);
    expect(isLevelExemptFromDownloadGate(1, 3)).toBe(false);
    expect(isLevelExemptFromDownloadGate(2, 3)).toBe(false);
    expect(isLevelExemptFromDownloadGate(3, 3)).toBe(true);
    expect(isLevelExemptFromDownloadGate(4, 3)).toBe(true);
  });

  it("阈值 5：所有人（含最高管理员 L4）都受控", () => {
    for (let lvl = 0; lvl <= 4; lvl++) expect(isLevelExemptFromDownloadGate(lvl, 5)).toBe(false);
  });

  it("userAdminLevel：以 adminLevel 为准，缺失时按 role 兜底", () => {
    expect(userAdminLevel({ adminLevel: 3 })).toBe(3);
    expect(userAdminLevel({ adminLevel: 0 })).toBe(0);
    expect(userAdminLevel({ role: "admin" })).toBe(1);       // 无 adminLevel → admin 视为 1
    expect(userAdminLevel({ role: "user" })).toBe(0);
    expect(userAdminLevel({ adminLevel: null, role: "admin" })).toBe(1);
  });
});
