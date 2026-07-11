import { describe, it, expect } from "vitest";
import {
  ANGLE_PRESETS, shotLabelForZoom, yawLabel, pitchLabel, buildAnglePrompt,
  RELIGHT_PRESETS, LIGHT_DIRECTIONS, lightDirLabel, buildRelightPrompt, RELIGHT_DEFAULTS,
} from "./angleRelight";

describe("angleRelight 多角度", () => {
  it("预设表含 LibTV 全部 7 档且参数在合法范围", () => {
    expect(ANGLE_PRESETS.map((p) => p.label)).toEqual([
      "自定义", "鱼眼视角", "倾斜视角", "正面俯拍", "正面仰拍", "全景俯拍", "背面视角",
    ]);
    for (const p of ANGLE_PRESETS) {
      expect(p.params.yaw).toBeGreaterThanOrEqual(0);
      expect(p.params.yaw).toBeLessThan(360);
      expect(Math.abs(p.params.pitch)).toBeLessThanOrEqual(90);
      expect(p.params.zoom).toBeGreaterThanOrEqual(0);
      expect(p.params.zoom).toBeLessThanOrEqual(100);
    }
  });

  it("景别档位覆盖 全景→中景→近景→特写→极度特写", () => {
    expect(shotLabelForZoom(0)).toBe("全景");
    expect(shotLabelForZoom(30)).toBe("中景");
    expect(shotLabelForZoom(50)).toBe("近景");
    expect(shotLabelForZoom(80)).toBe("特写");
    expect(shotLabelForZoom(100)).toBe("极度特写");
  });

  it("方位描述按 45° 扇区正确（含负角与超 360 归一）", () => {
    expect(yawLabel(0)).toBe("正面");
    expect(yawLabel(90)).toBe("右侧");
    expect(yawLabel(180)).toBe("背面");
    expect(yawLabel(270)).toBe("左侧");
    expect(yawLabel(-90)).toBe("左侧");
    expect(yawLabel(450)).toBe("右侧");
  });

  it("俯仰描述区分俯拍/仰拍/水平", () => {
    expect(pitchLabel(0)).toBe("水平视线拍摄");
    expect(pitchLabel(45)).toContain("俯拍");
    expect(pitchLabel(-40)).toContain("仰拍");
    expect(pitchLabel(70)).toContain("高空俯拍");
  });

  it("鱼眼预设提示词含畸变描述（对齐 LibTV 示例）", () => {
    const fe = ANGLE_PRESETS.find((p) => p.key === "fisheye")!;
    const s = buildAnglePrompt(fe.params, "fisheye");
    expect(s).toContain("特写");
    expect(s).toContain("鱼眼畸变");
  });

  it("自定义参数生成完整机位句", () => {
    const s = buildAnglePrompt({ yaw: 45, pitch: 30, zoom: 30 });
    expect(s).toContain("中景镜头");
    expect(s).toContain("右前侧");
    expect(s).toContain("45°");
    expect(s).toContain("俯角 30°");
  });
});

describe("angleRelight 打光", () => {
  it("预设 8 款齐全（LibTV 名单）", () => {
    expect(RELIGHT_PRESETS.map((p) => p.label)).toEqual([
      "过曝胶片", "蓝色逆光", "伦勃朗光", "赛博朋克", "落日迷幻", "神秘暗调", "黄金时刻", "诺兰冷灰",
    ]);
    for (const p of RELIGHT_PRESETS) {
      expect(p.prompt.length).toBeGreaterThan(10);
      expect(p.swatch).toContain("gradient");
    }
  });

  it("主光源六方位齐全", () => {
    expect(LIGHT_DIRECTIONS.map((d) => d.label)).toEqual(["左侧", "顶部", "右侧", "前方", "底部", "后方"]);
  });

  it("光源方位描述：逆光/底光/顶光", () => {
    expect(lightDirLabel(180, 25)).toContain("逆光");
    expect(lightDirLabel(0, -60)).toContain("底光");
    expect(lightDirLabel(0, 80)).toContain("近顶光");
    expect(lightDirLabel(90, 0)).toBe("右侧");
  });

  it("自定义参数构建完整打光句（亮度/颜色/轮廓光/智能文字）", () => {
    const s = buildRelightPrompt({ azimuth: 270, elevation: 15, brightness: 130, color: "#ff8800", rimLight: true, smartText: "黄昏咖啡馆的慵懒氛围" });
    expect(s).toContain("左侧");
    expect(s).toContain("130%");
    expect(s).toContain("#ff8800");
    expect(s).toContain("轮廓光");
    expect(s).toContain("黄昏咖啡馆");
  });

  it("默认参数只描述方位（不啰嗦亮度100%）", () => {
    const s = buildRelightPrompt(RELIGHT_DEFAULTS);
    expect(s).toContain("主光源来自");
    expect(s).not.toContain("100%");
    expect(s).not.toContain("轮廓光");
  });

  it("预设 + 非默认全局参数叠加", () => {
    const s = buildRelightPrompt({ ...RELIGHT_DEFAULTS, brightness: 80, rimLight: true }, "rembrandt");
    expect(s).toContain("伦勃朗");
    expect(s).toContain("80%");
    expect(s).toContain("轮廓光");
  });
});
