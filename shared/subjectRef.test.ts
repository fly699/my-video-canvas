import { describe, it, expect } from "vitest";
import { usedSubjectIndices, subjectOverflow, appendSubjectMapping } from "./subjectRef";

describe("subjectRef 多主体参考语法", () => {
  it("usedSubjectIndices：抽取去重升序的主体编号（含全半角空格间隔）", () => {
    expect(usedSubjectIndices("主体2 和 主体1 拥抱，主体2 转身")).toEqual([1, 2]);
    expect(usedSubjectIndices("把主体 3 放到桌上")).toEqual([3]);
    expect(usedSubjectIndices("没有主体引用")).toEqual([]);
    // 「主体」后无数字不算 token
    expect(usedSubjectIndices("画面主体是一只猫")).toEqual([]);
  });

  it("usedSubjectIndices：只认 1-9（主体0 / 主体10 不产生 10 号）", () => {
    expect(usedSubjectIndices("主体0 主体10")).toEqual([1]); // 主体10 → 匹配「主体1」
  });

  it("subjectOverflow：引用超出实际参考图张数的编号", () => {
    expect(subjectOverflow("主体1 和 主体3", 2)).toEqual([3]);
    expect(subjectOverflow("主体1 和 主体2", 2)).toEqual([]);
    expect(subjectOverflow("主体1", 0)).toEqual([1]);
  });

  it("appendSubjectMapping：合法引用时追加映射行（只列用到的编号）", () => {
    const out = appendSubjectMapping("主体1 站在 主体2 左侧", 3);
    expect(out).toContain("主体1 站在 主体2 左侧");
    expect(out).toContain("主体编号与参考图顺序对应");
    expect(out).toContain("主体1=第1张参考图、主体2=第2张参考图");
    expect(out).not.toContain("主体3=");
  });

  it("appendSubjectMapping：未用主体语法 / 无参考图时原样返回", () => {
    expect(appendSubjectMapping("一只猫在跑", 3)).toBe("一只猫在跑");
    expect(appendSubjectMapping("主体1 在跑", 0)).toBe("主体1 在跑");
  });

  it("appendSubjectMapping：幂等——已含映射行不重复追加", () => {
    const once = appendSubjectMapping("主体1 在跑", 2);
    expect(appendSubjectMapping(once, 2)).toBe(once);
  });

  it("appendSubjectMapping：越界编号不进映射行（拦截由调用方负责）", () => {
    const out = appendSubjectMapping("主体1 和 主体5", 2);
    expect(out).toContain("主体1=第1张参考图");
    expect(out).not.toContain("主体5=");
  });
});
