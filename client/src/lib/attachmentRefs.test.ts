// #260 attachmentRefs 守卫：占位符确定性替换 / library 抽取 / 越界与恢复路径的容错语义。
import { describe, it, expect } from "vitest";
import { resolveAttachmentRefs } from "./attachmentRefs";
import type { AgentOperation } from "../../../shared/types";

const MAP = { ref1: "https://cdn.example/a.png", ref2: "data:image/png;base64,xxx" };

describe("resolveAttachmentRefs", () => {
  it("create 的 referenceImageUrl 占位符替换为真实地址（不改动原 op 对象）", () => {
    const op: AgentOperation = { op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "p", referenceImageUrl: "{{ref1}}" } };
    const r = resolveAttachmentRefs([op], MAP);
    expect(r.nodeOps).toHaveLength(1);
    expect(r.nodeOps[0].payload!.referenceImageUrl).toBe(MAP.ref1);
    expect(op.payload!.referenceImageUrl).toBe("{{ref1}}"); // 纯函数：入参不被改写
    expect(r.warnings).toEqual([]);
  });

  it("多节点引用同一占位符各自替换；ref2（data URL，dev 场景）同样可用", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "p", referenceImageUrl: "{{ref1}}" } },
      { op: "create", nodeType: "character", tempId: "c1", payload: { name: "李宁", referenceImageUrl: "{{ref1}}" } },
      { op: "create", nodeType: "storyboard", tempId: "s1", payload: { description: "d", referenceImageUrl: "{{ref2}}" } },
    ];
    const r = resolveAttachmentRefs(ops, MAP);
    expect(r.nodeOps.map((o) => o.payload!.referenceImageUrl)).toEqual([MAP.ref1, MAP.ref1, MAP.ref2]);
  });

  it("编号越界：剥掉该字段保住整个操作（节点仍创建）+ 记告警", () => {
    const r = resolveAttachmentRefs(
      [{ op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "p", referenceImageUrl: "{{ref9}}" } }],
      MAP,
    );
    expect(r.nodeOps).toHaveLength(1);
    expect(r.nodeOps[0].payload!.prompt).toBe("p");
    expect("referenceImageUrl" in r.nodeOps[0].payload!).toBe(false);
    expect(r.warnings).toHaveLength(1);
  });

  it("会话恢复路径（空映射）：引用剥除、library 整条跳过，各记告警", () => {
    const r = resolveAttachmentRefs(
      [
        { op: "create", nodeType: "image_gen", tempId: "g1", payload: { referenceImageUrl: "{{ref1}}" } },
        { op: "library", libraryKind: "person", name: "李宁", sourceRef: "{{ref1}}" },
      ],
      {},
    );
    expect(r.nodeOps).toHaveLength(1);
    expect(r.libraryOps).toHaveLength(0);
    expect(r.warnings).toHaveLength(2);
  });

  it("library 操作从节点流中抽走并解析 URL（person/scene 两类）", () => {
    const r = resolveAttachmentRefs(
      [
        { op: "library", libraryKind: "person", name: "李宁", sourceRef: "{{ref1}}" },
        { op: "library", libraryKind: "scene", name: "足球场", sourceRef: "{{ref2}}" },
        { op: "create", nodeType: "script", tempId: "sc" },
      ],
      MAP,
    );
    expect(r.nodeOps.map((o) => o.op)).toEqual(["create"]); // library 不进画布操作流
    expect(r.libraryOps).toEqual([
      { kind: "person", name: "李宁", url: MAP.ref1 },
      { kind: "scene", name: "足球场", url: MAP.ref2 },
    ]);
  });

  it("非占位符值不做子串替换（sanitize 已剥除；此处防御性原样透传）", () => {
    const r = resolveAttachmentRefs(
      [{ op: "create", nodeType: "image_gen", tempId: "g1", payload: { prompt: "看 {{ref1}} 的风格", referenceImageUrl: "https://x/own.png" } }],
      MAP,
    );
    expect(r.nodeOps[0].payload!.prompt).toBe("看 {{ref1}} 的风格");   // prompt 里的占位符不动
    expect(r.nodeOps[0].payload!.referenceImageUrl).toBe("https://x/own.png"); // 非恰好占位符 → 不替换
  });
});
