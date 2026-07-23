import { describe, it, expect } from "vitest";
import { SEED_ORCHESTRATIONS } from "../shared/seedOrchestrations";
import { extractReplayableOps, orchestrationSummary, canSaveOrchestration } from "../shared/orchestration";

// 官方种子编排：每套必须是「自洽可重放」的——connect 两端都指向本批 create 的 tempId，
// 且经 extractReplayableOps 后一个操作都不丢（否则落地会缺连线/缺节点）。
describe("SEED_ORCHESTRATIONS", () => {
  it("每套 id 唯一、字段齐全", () => {
    const ids = SEED_ORCHESTRATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEED_ORCHESTRATIONS) {
      expect(s.name).toBeTruthy();
      expect(s.desc).toBeTruthy();
      expect(s.icon).toBeTruthy();
      expect(s.ops.length).toBeGreaterThan(0);
    }
  });

  it("每套都是自洽可重放（extractReplayableOps 不丢任何操作）", () => {
    for (const s of SEED_ORCHESTRATIONS) {
      const replay = extractReplayableOps(s.ops);
      expect(replay.length).toBe(s.ops.length); // 无操作被剔除 = 所有 connect 都指向本批 create
      expect(canSaveOrchestration(s.ops)).toBe(true);
    }
  });

  it("每套至少含 2 个 create 且有连线；不含 storyboard（会被 noStoryboard 剔除）", () => {
    for (const s of SEED_ORCHESTRATIONS) {
      const { creates, connects } = orchestrationSummary(s.ops);
      expect(creates).toBeGreaterThanOrEqual(2);
      expect(connects).toBeGreaterThan(0);
      expect(s.ops.some((o) => o.op === "create" && o.nodeType === "storyboard")).toBe(false);
    }
  });

  it("每套都以 merge 收尾且被视频镜接入", () => {
    for (const s of SEED_ORCHESTRATIONS) {
      const merge = s.ops.find((o) => o.op === "create" && o.nodeType === "merge");
      expect(merge).toBeTruthy();
      const mergeId = (merge as { tempId: string }).tempId;
      const intoMerge = s.ops.filter((o) => o.op === "connect" && o.targetRef === mergeId);
      expect(intoMerge.length).toBeGreaterThan(0);
    }
  });
});
