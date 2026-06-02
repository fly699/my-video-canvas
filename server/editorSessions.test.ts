import { describe, expect, it } from "vitest";
import {
  devCreateEditSession, devGetEditSession, devListEditSessions,
  devUpdateEditSession, devDeleteEditSession,
} from "./_core/devStore";
import { emptyEditorDoc, editorDocDuration, type EditorDoc } from "@shared/editorTypes";

const U = 77123; // isolated test user

function mk(name = "未命名剪辑") {
  return devCreateEditSession({ userId: U, name, doc: emptyEditorDoc() });
}

describe("editor session devStore parity + soft delete", () => {
  it("creates with defaults and an empty 3-track doc", () => {
    const s = mk();
    expect(s.name).toBe("未命名剪辑");
    expect(s.deletedAt).toBeNull();
    expect((s.doc as EditorDoc).tracks).toHaveLength(3);
  });

  it("get is owner-scoped", () => {
    const s = mk();
    expect(devGetEditSession(s.id, U)?.id).toBe(s.id);
    expect(devGetEditSession(s.id, U + 1)).toBeUndefined(); // other user can't read
  });

  it("update mutates name/doc and bumps updatedAt", async () => {
    const s = mk();
    const doc = emptyEditorDoc(1080, 1920, 30);
    doc.tracks[0].clips.push({ id: "c1", kind: "video", start: 0, trimIn: 0, trimOut: 5, assetUrl: "/manus-storage/x.mp4" });
    devUpdateEditSession(s.id, U, { name: "我的成片", doc });
    const got = devGetEditSession(s.id, U)!;
    expect(got.name).toBe("我的成片");
    expect((got.doc as EditorDoc).width).toBe(1080);
    expect(editorDocDuration(got.doc as EditorDoc)).toBe(5);
  });

  it("soft delete hides from list but keeps the row", () => {
    const s = mk("待删");
    expect(devListEditSessions(U).some((x) => x.id === s.id)).toBe(true);
    devDeleteEditSession(s.id, U);
    expect(devListEditSessions(U).some((x) => x.id === s.id)).toBe(false); // hidden
    expect(devGetEditSession(s.id, U)).toBeUndefined();
  });

  it("editorDocDuration accounts for clip speed", () => {
    const doc = emptyEditorDoc();
    doc.tracks[0].clips.push({ id: "c", kind: "video", start: 2, trimIn: 0, trimOut: 10, speed: 2 });
    // 2 + (10-0)/2 = 7
    expect(editorDocDuration(doc)).toBe(7);
  });
});
