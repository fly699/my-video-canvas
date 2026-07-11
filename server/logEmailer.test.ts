import { describe, it, expect } from "vitest";
import { shouldSendNow, parseRecipients, rowsToCsv, buildZipBuffer } from "./_core/logEmailer";

const base = { enabled: true, scheduleMode: "daily", intervalHours: 24, sendHour: 3, sendWeekday: 1, sendMonthday: 1, lastSentAt: null as Date | null };
const at = (iso: string) => new Date(iso);

describe("日志邮送调度判定 shouldSendNow", () => {
  it("未启用永不发送", () => {
    expect(shouldSendNow({ ...base, enabled: false }, at("2026-07-11T10:00:00"))).toBe(false);
  });
  it("hours：距上次 ≥ 间隔才发", () => {
    const s = { ...base, scheduleMode: "hours", intervalHours: 6 };
    expect(shouldSendNow({ ...s, lastSentAt: null }, at("2026-07-11T10:00:00"))).toBe(true);
    expect(shouldSendNow({ ...s, lastSentAt: at("2026-07-11T05:00:00") }, at("2026-07-11T10:00:00"))).toBe(false);
    expect(shouldSendNow({ ...s, lastSentAt: at("2026-07-11T03:59:00") }, at("2026-07-11T10:00:00"))).toBe(true);
  });
  it("daily：到点（sendHour 后）且当天没发过", () => {
    expect(shouldSendNow(base, at("2026-07-11T02:59:00"))).toBe(false);              // 未到 3 点
    expect(shouldSendNow(base, at("2026-07-11T03:05:00"))).toBe(true);               // 到点、从未发过
    expect(shouldSendNow({ ...base, lastSentAt: at("2026-07-11T03:06:00") }, at("2026-07-11T10:00:00"))).toBe(false); // 当天已发
    expect(shouldSendNow({ ...base, lastSentAt: at("2026-07-10T03:06:00") }, at("2026-07-11T03:05:00"))).toBe(true);  // 昨天发的
  });
  it("weekly：仅设定星期 + 到点 + 本周期未发", () => {
    const s = { ...base, scheduleMode: "weekly", sendWeekday: 6 }; // 周六；2026-07-11 是周六
    expect(shouldSendNow(s, at("2026-07-11T04:00:00"))).toBe(true);
    expect(shouldSendNow(s, at("2026-07-10T04:00:00"))).toBe(false);                 // 周五
    expect(shouldSendNow({ ...s, lastSentAt: at("2026-07-11T03:30:00") }, at("2026-07-11T09:00:00"))).toBe(false);
  });
  it("monthly：仅设定日 + 到点", () => {
    const s = { ...base, scheduleMode: "monthly", sendMonthday: 11 };
    expect(shouldSendNow(s, at("2026-07-11T03:30:00"))).toBe(true);
    expect(shouldSendNow(s, at("2026-07-12T03:30:00"))).toBe(false);
  });
});

describe("收件人解析 / CSV / 加密打包", () => {
  it("parseRecipients：逗号/分号/换行分隔、去重、剔除非法", () => {
    expect(parseRecipients("a@x.com, b@y.com;\na@x.com\nnot-an-email, c@")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseRecipients(null)).toEqual([]);
  });
  it("rowsToCsv：BOM + 引号转义 + 公式注入防护", () => {
    const csv = rowsToCsv(["列A", "列B"], [["=cmd()", 'he said "hi"'], [null, 42]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('"he said ""hi"""');
  });
  it("buildZipBuffer：带密码生成合法 zip（PK 魔数），无密码同样合法", async () => {
    const files = [{ name: "测试.csv", content: "a,b\n1,2\n" }];
    const enc = await buildZipBuffer(files, "secret123");
    expect(enc.length).toBeGreaterThan(100);
    expect(enc.subarray(0, 2).toString("latin1")).toBe("PK");
    const plain = await buildZipBuffer(files, null);
    expect(plain.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(enc.equals(plain)).toBe(false); // 加密产物与明文不同
  });
});
