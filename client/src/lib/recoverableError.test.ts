// #315 RECOVERABLE 标记解析（结果找回按钮的门票）。
import { describe, it, expect } from "vitest";
import { parseRecoverableTask, stripRecoverableMarker } from "./recoverableError";

const MSG = "自动生成失败：[CHARGED?] Poyo 图像生成超时（等待已超 5 分钟）：……或换用其他模型 [RECOVERABLE:poyo:task_abc-123]";

describe("#315 parseRecoverableTask / stripRecoverableMarker", () => {
  it("含标记 → 解析出 provider 与 taskId；展示文本剥掉标记", () => {
    expect(parseRecoverableTask(MSG)).toEqual({ provider: "poyo", taskId: "task_abc-123" });
    const shown = stripRecoverableMarker(MSG);
    expect(shown).not.toContain("RECOVERABLE");
    expect(shown).toContain("Poyo 图像生成超时");
  });

  it("无标记 / 空值 → null；strip 原样返回", () => {
    expect(parseRecoverableTask("普通失败：额度不足")).toBeNull();
    expect(parseRecoverableTask(undefined)).toBeNull();
    expect(stripRecoverableMarker("普通失败")).toBe("普通失败");
  });

  it("非法 taskId（怪字符/过短）不解析——防把用户可编辑文本当指令", () => {
    expect(parseRecoverableTask("x [RECOVERABLE:poyo:a b c]")).toBeNull();
    expect(parseRecoverableTask("x [RECOVERABLE:poyo:ab]")).toBeNull();
    expect(parseRecoverableTask("x [RECOVERABLE:kie:task123]")).toBeNull(); // 批1 仅 poyo
  });
});
