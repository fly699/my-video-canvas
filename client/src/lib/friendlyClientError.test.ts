import { describe, it, expect } from "vitest";
import { friendlyClientLLMError } from "./friendlyClientError";

// 关键回归（内网误报公网超时）：服务端结构化错误（TRPCClientError 带 data.code）必须原样
// 显示后端中文消息——即使消息里引用了 "502"/"<!DOCTYPE" 片段；只有传输层错误才映射网关文案。

const trpcServerErr = (message: string) =>
  Object.assign(new Error(message), { data: { code: "INTERNAL_SERVER_ERROR" } });

describe("friendlyClientLLMError", () => {
  it("服务端错误消息含 HTML 片段/状态码时原样透传，不误判成网关中断", () => {
    const msg = "LLM 端点返回了非 JSON 响应（HTTP 200…）。响应开头：‹!DOCTYPE html 502";
    expect(friendlyClientLLMError(trpcServerErr(msg))).toBe(msg);
    const msg2 = "本机模型生成超时（300s）。可调高 LLM_SELF_HOSTED_TIMEOUT_MS 后重试。";
    expect(friendlyClientLLMError(trpcServerErr(msg2))).toBe(msg2);
  });

  it("传输层拿到 HTML 页 → 网关文案（不再武断说公网 100 秒）", () => {
    const r = friendlyClientLLMError(new Error(`Unexpected token '<', "<!DOCTYPE"... is not valid JSON`));
    expect(r).toContain("连接被中断或返回了非 JSON 响应");
    expect(r).toContain("内网/本机");
  });

  it("传输层 5xx 状态码 → 网关文案", () => {
    expect(friendlyClientLLMError(new Error("HTTP 504 Gateway Timeout"))).toContain("连接被中断");
  });

  it("网络失败与超时分支不变", () => {
    expect(friendlyClientLLMError(new Error("Failed to fetch"))).toContain("网络请求失败");
    expect(friendlyClientLLMError(new Error("The operation timed out"))).toContain("请求超时");
  });

  it("普通错误原样返回", () => {
    expect(friendlyClientLLMError(new Error("余额不足"))).toBe("余额不足");
  });
});
