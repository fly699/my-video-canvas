import { describe, it, expect } from "vitest";
import { buildEpisodeNodes, episodeSynopsis, EPISODE_NODE_DX, EPISODE_NODE_DY } from "./episodeSplit";
import type { ScriptEpisode } from "../../../shared/types";

const eps: ScriptEpisode[] = [
  { episode: 1, title: "重逢", hook: "电梯故障", summary: "男女主被困电梯。", cliffhanger: "灯灭了" },
  { episode: 2, title: "误会", hook: "短信曝光", summary: "误会加深。", cliffhanger: "她转身离开" },
];

describe("episodeSynopsis", () => {
  it("拼接标题/钩子/剧情/卡点", () => {
    expect(episodeSynopsis(eps[0])).toBe("第1集 重逢\n钩子：电梯故障\n男女主被困电梯。\n卡点：灯灭了");
  });
  it("缺项跳过", () => {
    expect(episodeSynopsis({ episode: 3, title: "终", hook: "", summary: "结局。", cliffhanger: "" }))
      .toBe("第3集 终\n结局。");
  });
});

describe("buildEpisodeNodes", () => {
  it("每集一个节点，纵向错开、右偏父节点", () => {
    const plan = buildEpisodeNodes(eps, { x: 100, y: 200 });
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].position).toEqual({ x: 100 + EPISODE_NODE_DX, y: 200 });
    expect(plan.items[1].position).toEqual({ x: 100 + EPISODE_NODE_DX, y: 200 + EPISODE_NODE_DY });
    expect(plan.items[0].synopsis).toContain("第1集 重逢");
    expect(plan.items[1].synopsis).toContain("第2集 误会");
  });

  it("分组框包裹所有子节点", () => {
    const plan = buildEpisodeNodes(eps, { x: 0, y: 0 });
    const lastY = plan.items[plan.items.length - 1].position.y;
    // group 顶部不低于首个节点，底部覆盖最后一个节点
    expect(plan.group.y).toBeLessThanOrEqual(plan.items[0].position.y);
    expect(plan.group.y + plan.group.height).toBeGreaterThan(lastY);
    expect(plan.group.x).toBeLessThan(plan.items[0].position.x);
  });

  it("空数组不崩（group 仍有最小高度）", () => {
    const plan = buildEpisodeNodes([], { x: 0, y: 0 });
    expect(plan.items).toHaveLength(0);
    expect(plan.group.height).toBeGreaterThan(0);
  });
});
