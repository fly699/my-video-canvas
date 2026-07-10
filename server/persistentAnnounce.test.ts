import { describe, it, expect } from "vitest";
import { parsePersistentAnnouncement, type PersistentAnnouncement } from "./routers/chat";

const NOW = 1_700_000_000_000;

describe("parsePersistentAnnouncement（持续公告解析/惰性过期）", () => {
  it("null/空串/非法 JSON → null", () => {
    expect(parsePersistentAnnouncement(null, NOW)).toBeNull();
    expect(parsePersistentAnnouncement(undefined, NOW)).toBeNull();
    expect(parsePersistentAnnouncement("", NOW)).toBeNull();
    expect(parsePersistentAnnouncement("{not json", NOW)).toBeNull();
    expect(parsePersistentAnnouncement("42", NOW)).toBeNull();
  });

  it("缺 title/body 字段 → null（脏数据不崩）", () => {
    expect(parsePersistentAnnouncement(JSON.stringify({ body: "b" }), NOW)).toBeNull();
    expect(parsePersistentAnnouncement(JSON.stringify({ title: "t" }), NOW)).toBeNull();
    expect(parsePersistentAnnouncement(JSON.stringify({ title: 1, body: "b" }), NOW)).toBeNull();
  });

  it("未到期 → 原样返回；已到期/恰好到期 → null", () => {
    const ann: PersistentAnnouncement = { title: "维护", body: "今晚 22:00", createdAt: NOW - 1000, expiresAt: NOW + 60_000, createdBy: "admin" };
    expect(parsePersistentAnnouncement(JSON.stringify(ann), NOW)).toEqual(ann);
    expect(parsePersistentAnnouncement(JSON.stringify({ ...ann, expiresAt: NOW - 1 }), NOW)).toBeNull();
    expect(parsePersistentAnnouncement(JSON.stringify({ ...ann, expiresAt: NOW }), NOW)).toBeNull();
  });

  it("expiresAt=null（直至手动关闭）→ 永不过期", () => {
    const ann: PersistentAnnouncement = { title: "置顶", body: "常驻", createdAt: NOW, expiresAt: null };
    expect(parsePersistentAnnouncement(JSON.stringify(ann), NOW + 365 * 24 * 3600_000)).toEqual(ann);
  });
});
