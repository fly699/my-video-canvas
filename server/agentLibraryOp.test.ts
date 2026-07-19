// #260 sanitize 守卫：library 入库操作三字段严格校验 + referenceImageUrl 占位符锁死。
// 防线定位：这是服务端的第一道闸——LLM 编造 URL / 越权字段在此剥除，客户端
// resolveAttachmentRefs 只需处理「合法占位符 → 真实地址」的映射与失效容错。
import { describe, it, expect } from "vitest";
import { sanitizeOperationDetailed } from "./_core/agentCatalog";

describe("sanitize: library 入库操作（#260）", () => {
  it("合法 person/scene 入库操作通过，字段收敛为 op/libraryKind/name/sourceRef/note", () => {
    const r = sanitizeOperationDetailed({ op: "library", libraryKind: "person", name: "李宁", sourceRef: "{{ref1}}", note: "用户点名入库", extra: "剥掉" });
    expect("op" in r).toBe(true);
    if ("op" in r) {
      expect(r.op).toEqual({ op: "library", libraryKind: "person", name: "李宁", sourceRef: "{{ref1}}", note: "用户点名入库" });
    }
    const s = sanitizeOperationDetailed({ op: "library", libraryKind: "scene", name: "足球场", sourceRef: "{{ref2}}" });
    expect("op" in s && s.op.libraryKind).toBe("scene");
  });

  it("非法 kind / 缺名 / 超长名 → drop", () => {
    expect("drop" in sanitizeOperationDetailed({ op: "library", libraryKind: "prop", name: "x", sourceRef: "{{ref1}}" })).toBe(true);
    expect("drop" in sanitizeOperationDetailed({ op: "library", libraryKind: "person", name: "  ", sourceRef: "{{ref1}}" })).toBe(true);
    expect("drop" in sanitizeOperationDetailed({ op: "library", libraryKind: "person", name: "长".repeat(121), sourceRef: "{{ref1}}" })).toBe(true);
  });

  it("sourceRef 只接受 {{refN}} 占位符——真实 URL / 编造串一律 drop（防 LLM 绕过附件机制塞任意地址入库）", () => {
    for (const bad of ["https://evil.example/x.png", "data:image/png;base64,xx", "ref1", "{{ref}}", "{{refA}}", ""]) {
      expect("drop" in sanitizeOperationDetailed({ op: "library", libraryKind: "person", name: "李宁", sourceRef: bad })).toBe(true);
    }
  });
});

describe("sanitize: referenceImageUrl 占位符锁死（#260）", () => {
  it("create：占位符保留，http/data/编造值静默剥除但节点保住", () => {
    const ok = sanitizeOperationDetailed({ op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "p", referenceImageUrl: "{{ref1}}" } });
    expect("op" in ok && ok.op.payload!.referenceImageUrl).toBe("{{ref1}}");
    const stripped = sanitizeOperationDetailed({ op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "p", referenceImageUrl: "https://made-up.example/a.png" } });
    expect("op" in stripped).toBe(true);
    if ("op" in stripped) {
      expect(stripped.op.payload!.prompt).toBe("p");                         // 节点照常创建
      expect("referenceImageUrl" in stripped.op.payload!).toBe(false);        // 编造 URL 被剥除
    }
  });

  it("update：同口径剥除非占位符值（防增量编辑回写编造 URL）", () => {
    const r = sanitizeOperationDetailed({ op: "update", targetRef: "n1", payload: { prompt: "新词", referenceImageUrl: "http://x/y.png" } });
    expect("op" in r).toBe(true);
    if ("op" in r) {
      expect(r.op.payload!.prompt).toBe("新词");
      expect("referenceImageUrl" in r.op.payload!).toBe(false);
    }
    const ok = sanitizeOperationDetailed({ op: "update", targetRef: "n1", payload: { referenceImageUrl: "{{ref3}}" } });
    expect("op" in ok && ok.op.payload!.referenceImageUrl).toBe("{{ref3}}");
  });

  it("character / storyboard 目录也开放了该字段（占位符可通过白名单）", () => {
    const c = sanitizeOperationDetailed({ op: "create", nodeType: "character", tempId: "c1", payload: { name: "李宁", referenceImageUrl: "{{ref1}}" } });
    expect("op" in c && c.op.payload!.referenceImageUrl).toBe("{{ref1}}");
    const s = sanitizeOperationDetailed({ op: "create", nodeType: "storyboard", tempId: "s1", payload: { description: "d", referenceImageUrl: "{{ref1}}" } });
    expect("op" in s && s.op.payload!.referenceImageUrl).toBe("{{ref1}}");
  });
});
