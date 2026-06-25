import { describe, it, expect } from "vitest";
import { parseCurlLlm } from "./parseCurlLlm";

describe("parseCurlLlm", () => {
  it("解析用户的原始 curl（vLLM Qwen，无鉴权）", () => {
    const curl = `curl http://172.16.0.10:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen3.6-35B-A3B-FP8",
    "messages": [
      {"role": "user", "content": "你好，请自我介绍一下。"}
    ],
    "temperature": 0.7
  }'`;
    expect(parseCurlLlm(curl)).toEqual({ url: "http://172.16.0.10:8000", model: "Qwen3.6-35B-A3B-FP8" });
  });

  it("带 Authorization Bearer 时提取 key", () => {
    const curl = `curl https://llm.example.com:9000/v1/chat/completions -H 'Authorization: Bearer sk-abc123' -d '{"model":"llama3"}'`;
    expect(parseCurlLlm(curl)).toEqual({ url: "https://llm.example.com:9000", model: "llama3", apiKey: "sk-abc123" });
  });

  it("URL 末尾无 chat/completions 也能提取 base", () => {
    expect(parseCurlLlm("curl http://h:8000/").url).toBe("http://h:8000");
    expect(parseCurlLlm("curl http://h:8000/v1/").url).toBe("http://h:8000/v1");
  });

  it("忽略 shell 占位 key（$VAR / {{TOKEN}}）", () => {
    expect(parseCurlLlm(`curl http://h/v1/chat/completions -H "Authorization: Bearer $API_KEY" -d '{"model":"m"}'`).apiKey).toBeUndefined();
  });

  it("Open WebUI 的 /api/chat/completions 端点：保留完整路径（不退化成 base）", () => {
    const curl = `curl http://172.16.0.20:3000/api/chat/completions -H 'Authorization: Bearer sk-owui-xyz' -d '{"model":"qwen2.5:72b"}'`;
    expect(parseCurlLlm(curl)).toEqual({ url: "http://172.16.0.20:3000/api/chat/completions", model: "qwen2.5:72b", apiKey: "sk-owui-xyz" });
  });

  it("空输入 → 空结果", () => {
    expect(parseCurlLlm("")).toEqual({});
  });
});
