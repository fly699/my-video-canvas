# PoYo AI LLM（文本对话）API 完整文档

> 来源：PoYo AI 官方文档（`docs.poyo.ai/api-manual/chat-series`）
> 整理日期：2026-05-31
>
> 与图像/视频/音乐的异步任务不同，**LLM 接口为同步（或 SSE 流式）调用**，
> 兼容 OpenAI / Anthropic / Google 三大官方 API 格式，可直接复用现有 SDK。

---

## 一、通用约定

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://api.poyo.ai` |
| **认证** | `Authorization: Bearer YOUR_API_KEY` |
| **调用方式** | 同步返回完整 JSON，或 `stream: true` 走 SSE 流式（区别于生成任务的 submit/poll 异步模式） |
| **模型选择** | 通过 `model` 参数切换（GPT / Claude / Gemini 等） |

PoYo 提供 **4 套兼容接口**，可按你熟悉的 SDK 任选其一：

| 接口 | 端点 | 兼容格式 |
|------|------|---------|
| Chat Completions | `POST /v1/chat/completions` | OpenAI Chat |
| Responses | `POST /v1/responses` | OpenAI Responses（工具/多模态） |
| Claude Messages | `POST /v1/messages` | Anthropic Messages |
| Gemini Native | `POST /v1beta/models/{model}:{method}` | Google Gemini 原生 |

---

## 二、Chat Completions API（通用对话）

`POST /v1/chat/completions` — 统一对话接口，支持所有文本生成模型，兼容 OpenAI Chat Completions 格式。

**基础对话**：
```json
{
  "model": "gpt-5.2",
  "messages": [
    { "role": "user", "content": "Explain vector databases in one sentence." }
  ]
}
```

**系统提示词**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [
    { "role": "system", "content": "You are a technical editor. Improve clarity of product copy." },
    { "role": "user", "content": "Rewrite the button text 'Submission failed' to be friendly and actionable." }
  ]
}
```

**多轮对话**：
```json
{
  "model": "gemini-3-flash-preview",
  "messages": [
    { "role": "user", "content": "Give me 3 customer support bot names." },
    { "role": "assistant", "content": "1) HelpWave 2) CarePilot 3) SwiftSupport" },
    { "role": "user", "content": "Add one style tag for each name." }
  ]
}
```

**流式输出**（`stream: true` → SSE）：
```json
{
  "model": "gpt-5.2",
  "messages": [
    { "role": "user", "content": "Generate 5 short titles (max 6 words) about AI video generation." }
  ],
  "stream": true
}
```

**说明**：
- `stream: true` 返回 SSE 流式响应。
- 不同模型的上下文长度、输出上限、可选参数各异。
- 需要工具调用 / 多模态结构化输入的新 OpenAI 兼容工作流，建议改用 **Responses API**。

---

## 三、Responses API（工具 + 多模态）

`POST /v1/responses` — OpenAI 兼容的 Responses 格式，支持纯文本、结构化多模态输入、工具（web search / function calling）、完整 JSON 或 SSE 流式。

**基础文本**：
```json
{ "model": "gpt-5.2", "input": "Write a product tagline in one sentence.", "max_output_tokens": 120 }
```

**多模态输入**：
```json
{
  "model": "gpt-5",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Describe this image in one paragraph." },
        { "type": "input_image", "image_url": "https://example.com/image.jpg" }
      ]
    }
  ],
  "max_output_tokens": 300
}
```

**Web 搜索工具**：
```json
{
  "model": "gpt-5",
  "input": "Use web search to find the latest product update on poyo.ai. Reply with the title and URL only.",
  "tools": [ { "type": "web_search_preview" } ],
  "tool_choice": "auto",
  "max_output_tokens": 2000
}
```

**流式**（`stream: true`）：
```json
{ "model": "gpt-5.2", "input": "Write a 100-word product introduction.", "max_output_tokens": 200, "stream": true, "store": false }
```

**cURL**：
```bash
curl "https://api.poyo.ai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer PoYo_API_KEY" \
  -d '{ "model": "gpt-5.2", "input": "Write a product tagline in one sentence.", "max_output_tokens": 120 }'
```

**流式事件类型**（SSE，`data:` 行，以 `data: [DONE]` 结束）：
`response.created`、`response.output_item.added`、`response.output_text.delta`、`response.output_text.done`、`response.completed`、`response.failed`。

**说明**：
- 工具可用性取决于所选模型；模型不支持请求的工具时可能报错。
- 图片输入：公网 URL 须可被模型服务访问；Base64 须带完整 Data URI 前缀（如 `data:image/png;base64,`）。
- 内容块顺序影响理解：**文本指令尽量放在图片之前**。

---

## 四、Claude Messages API

`POST /v1/messages` — 完全兼容 Anthropic Messages 格式，支持多轮对话、单次查询、文本+图片多模态。参数详见 Anthropic 官方文档。

**基础对话**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 256,
  "messages": [ { "role": "user", "content": "Explain the meaning of 'rate limiting' in three sentences." } ]
}
```

**流式 + 思考（thinking）**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 256,
  "thinking": { "type": "enabled", "budget_tokens": 2048, "display": "summarized" },
  "stream": true,
  "messages": [ { "role": "user", "content": "Write a product update announcement under 80 words, professional yet friendly." } ]
}
```

**工具调用（Tool Use）**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 256,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather by city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": "auto",
  "messages": [ { "role": "user", "content": "Check the weather in Tokyo and provide a one-sentence travel suggestion." } ]
}
```

**结构化输出 + 缓存（cache_control）**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 256,
  "cache_control": { "type": "ephemeral", "ttl": "1h" },
  "output_config": {
    "effort": "high",
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { "summary": { "type": "string" }, "tone": { "type": "string" } },
        "required": ["summary", "tone"]
      }
    }
  },
  "messages": [ { "role": "user", "content": "Summarize this release note and label its tone." } ]
}
```

**视觉理解（Base64 图片）**：
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 256,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe the main subject and scene in the image, and provide an alt text for it." },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "BASE64_IMAGE_DATA" } }
      ]
    }
  ]
}
```

**说明**：
- 用 `max_tokens` 控制输出长度；**思考 tokens 计入 max_tokens**。
- 图片输入可用支持的 base64 媒体载荷。

---

## 五、Gemini Native Format

用 Google 原生 API 格式调用 Gemini 模型，支持同步与流式，参数极简。

**生成内容（同步）**：
```
POST /v1beta/models/gemini-3-flash-preview:generateContent
```
```json
{
  "contents": [
    { "role": "user", "parts": [ { "text": "Summarize the goals of the new night mode in one sentence." } ] }
  ],
  "generationConfig": { "maxOutputTokens": 256, "temperature": 0.7 }
}
```

**流式生成**：
```
POST /v1beta/models/gemini-3-flash-preview:streamGenerateContent
```
```json
{
  "contents": [
    { "role": "user", "parts": [ { "text": "Generate 5 short feature names for an AI writing assistant." } ] }
  ],
  "generationConfig": { "maxOutputTokens": 256 }
}
```

**多模态输入**：
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Describe the image and write concise alt text." },
        { "inlineData": { "mimeType": "image/png", "data": "BASE64_IMAGE_DATA" } }
      ]
    }
  ]
}
```

**说明**：
- `generateContent` 返回完整 JSON；`streamGenerateContent` 流式生成。
- 文本指令尽量放在多模态部分之前。

---

## 六、功能特性速览

| 接口 | 端点 | 流式 | 工具调用 | 多模态(图) | 思考 | 结构化输出 | 缓存 |
|------|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Chat Completions | `/v1/chat/completions` | ✅ | — | — | — | — | — |
| Responses | `/v1/responses` | ✅ | ✅(web/function) | ✅ | — | — | — |
| Claude Messages | `/v1/messages` | ✅ | ✅ | ✅ | ✅ | ✅(json_schema) | ✅(ephemeral) |
| Gemini Native | `/v1beta/models/{model}:{method}` | ✅ | — | ✅ | — | — | — |

**示例模型名**（随官网更新，以 https://poyo.ai/models 为准）：
- OpenAI：`gpt-5.2`、`gpt-5`
- Anthropic：`claude-sonnet-4-5-20250929`
- Google：`gemini-3-flash-preview`

---

## 七、相关链接

- API 概览：https://docs.poyo.ai/api-manual/overview
- 模型列表 / Playground：https://poyo.ai/models
- 价格：https://poyo.ai/pricing
- Anthropic Messages 参数文档：https://platform.claude.com/docs/en/api/messages/create
