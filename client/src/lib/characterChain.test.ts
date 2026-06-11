// @角色 传递链路回归测试：
//  1) collectCharacterProfiles：连线 ∪ @提及（含全局角色库影子）合并、按名去重——
//     创作向导每一步（logline/梗概/节拍表/剧本）注入的角色档案来源。
//  2) unmentionText：音频（配音/音效/配乐）提交前把「@角色名」洗成纯名字——
//     @ 标记不得进入音频提示词。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { collectCharacterProfiles } from "../components/canvas/ScriptSidePanels";
import { unmentionText, setLibraryCharacters } from "./characterConditioning";

type AnyNode = { id: string; type: string; position: { x: number; y: number }; data: { nodeType: string; title: string; payload: Record<string, unknown>; projectId: number } };

const charNode = (id: string, name: string, extra: Record<string, unknown> = {}): AnyNode => ({
  id, type: "custom", position: { x: 0, y: 0 },
  data: { nodeType: "character", title: name, payload: { name, appearance: `${name}的外貌`, ...extra }, projectId: 1 },
});
const scriptNode = (id: string): AnyNode => ({
  id, type: "custom", position: { x: 0, y: 0 },
  data: { nodeType: "script", title: "脚本", payload: {}, projectId: 1 },
});

function seedStore(nodes: AnyNode[], edges: Array<{ id: string; source: string; target: string }>) {
  useCanvasStore.setState({ nodes: nodes as never, edges: edges as never });
}

beforeEach(() => { seedStore([], []); setLibraryCharacters([]); });
afterEach(() => { seedStore([], []); setLibraryCharacters([]); });

describe("collectCharacterProfiles — 连线 ∪ @提及 合并", () => {
  it("仅连线：收集相连角色档案", () => {
    seedStore([scriptNode("s1"), charNode("c1", "林晓")], [{ id: "e1", source: "c1", target: "s1" }]);
    const out = collectCharacterProfiles("s1");
    expect(out).toContain("林晓");
    expect(out).toContain("外貌");
  });
  it("仅 @提及（未连线）：mentionText 命中画布角色也入档案", () => {
    seedStore([scriptNode("s1"), charNode("c1", "林晓")], []);
    expect(collectCharacterProfiles("s1")).toBe(""); // 不提及不连线 → 无
    expect(collectCharacterProfiles("s1", "现代女白领@林晓 穿越")).toContain("林晓");
  });
  it("@提及命中全局角色库影子（未拖上画布）", () => {
    seedStore([scriptNode("s1")], []);
    setLibraryCharacters([{ id: "lib:1", data: { nodeType: "character", payload: { name: "孙朗", appearance: "少年将军" } } }] as never);
    const out = collectCharacterProfiles("s1", "她与@孙朗 相爱");
    expect(out).toContain("孙朗");
    expect(out).toContain("少年将军");
  });
  it("连线与提及同名只出一次（按名去重）", () => {
    seedStore([scriptNode("s1"), charNode("c1", "林晓")], [{ id: "e1", source: "c1", target: "s1" }]);
    const out = collectCharacterProfiles("s1", "@林晓 登场");
    expect(out.split("林晓").length - 1).toBeLessThanOrEqual(2); // 档案行内名字最多出现于「人物「林晓」」一行
    expect(out.split("\n").filter((l) => l.includes("人物「林晓」")).length).toBe(1);
  });
  it("无 @ 的 mentionText 不引入任何额外角色", () => {
    seedStore([scriptNode("s1"), charNode("c1", "林晓")], []);
    expect(collectCharacterProfiles("s1", "没有提及任何人")).toBe("");
  });
});

describe("unmentionText — 音频提示词 @ 清洗", () => {
  it("@林晓 → 林晓（保留名字朗读，不删句子）", () => {
    seedStore([charNode("c1", "林晓")], []);
    const nodes = useCanvasStore.getState().nodes;
    expect(unmentionText("@林晓 走过来说：你好", nodes as never)).toBe("林晓 走过来说：你好");
  });
  it("未命中角色的 @ 原样保留（不误伤邮箱等）", () => {
    seedStore([], []);
    expect(unmentionText("联系 a@b.com", useCanvasStore.getState().nodes as never)).toBe("联系 a@b.com");
  });
  it("库影子角色同样清洗", () => {
    setLibraryCharacters([{ id: "lib:1", data: { nodeType: "character", payload: { name: "孙朗" } } }] as never);
    expect(unmentionText("@孙朗 拔剑", [] as never)).toBe("孙朗 拔剑");
  });
});
