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

  // 回归：downloads.config / checkAccess 的免控判定必须与本函数（服务端 gate 同款）一致，
  // 而非旧的粗粒度 role==="admin"。曾经运营(L2, role=admin) 在阈值=3 时被客户端误判免控、
  // 跳过「申请下载」弹窗，直连服务端拿到 403 JSON 存成文件。客户端与服务端同用这套判定后：
  it("回归：运营(L2) 在阈值 3 时应受控（客户端须弹「申请下载」，不能按 role=admin 放行）", () => {
    const bypassLevel = 3;
    const operations = { role: "admin", adminLevel: 2 }; // 运营 L2：role 是 admin 但级别不足
    // 旧逻辑（role==="admin"）会放行 → 错误跳过弹窗；正确逻辑应受控：
    expect(isLevelExemptFromDownloadGate(userAdminLevel(operations), bypassLevel)).toBe(false);
    // 管理员 L3 及以上（>=阈值）仍免控：
    expect(isLevelExemptFromDownloadGate(userAdminLevel({ role: "admin", adminLevel: 3 }), bypassLevel)).toBe(true);
    // 普通用户始终受控：
    expect(isLevelExemptFromDownloadGate(userAdminLevel({ role: "user" }), bypassLevel)).toBe(false);
  });
});
