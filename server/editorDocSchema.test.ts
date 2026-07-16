// 批3 守卫：EditorDoc 顶层新字段必须进 docSchema，否则保存时被 zod 静默剥离
// （keyframes 曾踩过同坑）。此测试锁死 markers 的保存往返。
import { describe, it, expect } from "vitest";
import { docSchema } from "./routers/editor";
import { emptyEditorDoc } from "../shared/editorTypes";

describe("editor.docSchema · markers 保存往返（防静默剥离）", () => {
  it("markers 经 parse 后完整保留", () => {
    const doc = { ...emptyEditorDoc(), markers: [{ t: 1.5 }, { t: 3, label: "高潮点", color: "#fc0" }] };
    const parsed = docSchema.parse(doc);
    expect(parsed.markers).toEqual(doc.markers);
  });
  it("非法 markers 被拒（负时间 / 超长 label）", () => {
    expect(() => docSchema.parse({ ...emptyEditorDoc(), markers: [{ t: -1 }] })).toThrow();
    expect(() => docSchema.parse({ ...emptyEditorDoc(), markers: [{ t: 1, label: "x".repeat(81) }] })).toThrow();
  });
});
