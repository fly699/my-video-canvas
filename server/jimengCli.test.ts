// #328 即梦 CLI 适配器纯函数单测：provider 分类 + 防御式输出解析（待真机校准的行为契约）。
// 注：submit/query 的确切 JSON 字段名待真机校准；这里断言「防御式解析对多种可能字段名/
// 纯文本兜底都能抓到 submit_id/状态/URL」——真机拿到确切格式后，这些用例应仍全绿（防御式
// 是确切格式的超集），可作为回归护栏。
import { describe, it, expect } from "vitest";
import {
  isJimengVideoProvider,
  parseSubmitOutput,
  parseQueryOutput,
  JIMENG_VIDEO_SPECS,
} from "./_core/jimengCli";

describe("isJimengVideoProvider", () => {
  it("识别 jimeng_ 前缀的已注册 provider", () => {
    expect(isJimengVideoProvider("jimeng_text2video")).toBe(true);
    expect(isJimengVideoProvider("jimeng_frames2video")).toBe(true);
    expect(isJimengVideoProvider("poyo_seedance")).toBe(false);
    expect(isJimengVideoProvider("kie_seedance2")).toBe(false);
    expect(isJimengVideoProvider("jimeng_unknown")).toBe(false); // 未注册的 jimeng_ 也返回 false
  });
  it("五个视频子命令均注册", () => {
    expect(Object.keys(JIMENG_VIDEO_SPECS).sort()).toEqual([
      "jimeng_frames2video", "jimeng_image2video", "jimeng_multiframe2video",
      "jimeng_multimodal2video", "jimeng_text2video",
    ]);
  });
});

describe("parseSubmitOutput（待真机校准的防御式）", () => {
  it("纯 JSON：submit_id 字段", () => {
    expect(parseSubmitOutput('{"submit_id":"abc123def","status":"querying"}')).toBe("abc123def");
  });
  it("驼峰/别名字段：submitId / task_id / id 兜底", () => {
    expect(parseSubmitOutput('{"submitId":"XY_1234567"}')).toBe("XY_1234567");
    expect(parseSubmitOutput('{"data":{"task_id":"tk-9988776"}}')).toBe("tk-9988776");
    expect(parseSubmitOutput('{"result":{"id":"idvalue999"}}')).toBe("idvalue999");
  });
  it("混合输出（日志行 + JSON 块）能抠出 JSON", () => {
    const out = "INFO connecting...\n提交成功\n{\"submit_id\":\"mixed_888888\"}\nbye";
    expect(parseSubmitOutput(out)).toBe("mixed_888888");
  });
  it("纯文本兜底：submit_id=xxx / submit_id: xxx", () => {
    expect(parseSubmitOutput("submit_id=plainABC123")).toBe("plainABC123");
    expect(parseSubmitOutput("your submit_id: Tok_44556677 saved")).toBe("Tok_44556677");
  });
  it("无 id → undefined", () => {
    expect(parseSubmitOutput("error: not logged in")).toBeUndefined();
    expect(parseSubmitOutput("")).toBeUndefined();
  });
});

describe("parseQueryOutput（待真机校准的防御式）", () => {
  it("成功 + JSON 里带视频 URL", () => {
    const r = parseQueryOutput('{"gen_status":"success","video_url":"https://cdn.jimeng.com/v/abc.mp4"}');
    expect(r.status).toBe("finished");
    expect(r.resultVideoUrl).toBe("https://cdn.jimeng.com/v/abc.mp4");
  });
  it("status=done + 多个 URL 去重收集", () => {
    const out = '{"status":"done","results":[{"url":"https://a.com/1.mp4"},{"url":"https://a.com/2.mov"},{"url":"https://a.com/1.mp4"}]}';
    const r = parseQueryOutput(out);
    expect(r.status).toBe("finished");
    expect(r.resultVideoUrls).toEqual(["https://a.com/1.mp4", "https://a.com/2.mov"]);
  });
  it("失败状态 → failed + 错误信息", () => {
    const r = parseQueryOutput('{"gen_status":"failed","message":"内容审核未通过"}');
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toContain("审核");
  });
  it("在途状态（querying/running）→ running", () => {
    expect(parseQueryOutput('{"status":"querying"}').status).toBe("running");
    expect(parseQueryOutput('{"gen_status":"running"}').status).toBe("running");
  });
  it("无显式状态但已给 URL → 视作完成（防御）", () => {
    const r = parseQueryOutput("下载地址：https://cdn.jimeng.com/final.mp4");
    expect(r.status).toBe("finished");
    expect(r.resultVideoUrl).toBe("https://cdn.jimeng.com/final.mp4");
  });
  it("空/无信息 → running（下轮再查，不误判失败）", () => {
    expect(parseQueryOutput("").status).toBe("running");
    expect(parseQueryOutput("connecting...").status).toBe("running");
  });
  it("纯文本 success 关键字兜底", () => {
    const r = parseQueryOutput("gen success! url=https://x.com/out.webm");
    expect(r.status).toBe("finished");
    expect(r.resultVideoUrl).toBe("https://x.com/out.webm");
  });
});
