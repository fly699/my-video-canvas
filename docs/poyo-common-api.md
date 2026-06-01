# PoYo AI Common API 参考（通用接口）

> 来源：PoYo AI 官方文档（`docs.poyo.ai`）
> 整理日期：2026-05-31
>
> **Common API** 指不依赖具体模型、所有生成类型（图像 / 视频 / 音乐 / 3D / TTS）共享的统一接口，
> 是支撑全部具体模型的公共底座。架构为「两端点提交+查询 + 回调 + 账户」。

---

## 一、通用规范

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://api.poyo.ai` |
| **认证** | 所有请求需 `Authorization: Bearer YOUR_API_KEY` |
| **架构** | 统一异步两端点：提交 → 取 `task_id` → 轮询 / 回调 → 取回 `files` |
| **API Key** | 在 https://poyo.ai/dashboard/api-key 生成；切勿暴露在前端 |
| **文件有效期** | 生成的图像 / 视频 / 音频 / 3D 文件仅保留 **24 小时**，需及时下载保存 |

---

## 二、统一生成端点（核心两端点）

### 1. 提交任务 Submit Task

```
POST https://api.poyo.ai/api/generate/submit
```

立即返回 `task_id`，初始状态 `not_started`。

**统一请求结构**：
```json
{
  "model": "<模型名>",
  "callback_url": "https://your-domain.com/callback",
  "input": { "...具体模型参数": "..." }
}
```

**Submit 响应**：
```json
{
  "code": 200,
  "data": {
    "task_id": "task-unified-1757165031-uyujaw3d",
    "status": "not_started",
    "created_time": "2025-11-12T10:30:00"
  }
}
```

### 2. 查询任务状态 Query Status

```
GET https://api.poyo.ai/api/generate/status/{task_id}
```

| 路径参数 | 类型 | 必填 | 说明 |
|---------|------|:---:|------|
| `task_id` | string | 是 | 提交端点返回的任务 ID |

> 适用于图像 / 视频 / 3D / 音频(TTS) / MiniMax 等。
> **例外**：音乐 Suno 系列结果改用 `GET /api/generate/detail/music?task_id=...` 查询。

**Status 响应**：
```json
{
  "code": 200,
  "data": {
    "task_id": "task-unified-1757165031-uyujaw3d",
    "status": "finished",
    "progress": 100,
    "files": [
      { "file_url": "https://storage.poyo.ai/generated/image-abc123.jpg", "file_type": "image" }
    ],
    "created_time": "2025-11-12T10:30:00",
    "error_message": null
  }
}
```

**响应字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | integer | HTTP 状态码（200 成功） |
| `data.task_id` | string | 任务唯一标识 |
| `data.status` | string | `not_started` / `running` / `finished` / `failed` |
| `data.progress` | integer | 完成百分比 0-100 |
| `data.files` | array | 生成文件（finished 时有值） |
| `data.files[].file_url` | string | 文件直链 |
| `data.files[].file_type` | string | `image` / `video` / `audio` / `3d` / `other` |
| `data.files[].label` | string | 可选标签，常见于 3D（如 `model_glb`、`thumbnail`） |
| `data.files[].format` | string | 可选格式：glb / fbx / obj / usdz / stl / png / mp4 … |
| `data.files[].content_type` | string | 可选 MIME 类型 |
| `data.files[].file_name` | string | 可选文件名 |
| `data.files[].file_size` | integer | 可选文件大小（字节） |
| `data.created_time` | string | ISO 8601 创建时间 |
| `data.error_message` | string | 失败时的错误描述 |

**任务状态值**：

| 状态 | 说明 |
|------|------|
| `not_started` | 已排队，等待处理 |
| `running` | 正在生成（带 `progress`） |
| `finished` | 完成，结果在 `files` |
| `failed` | 失败，详见 `error_message` |

> 📌 文档另有 **3D Status**（`3d-status`）专用版本，端点相同，`files` 含 glb 模型 + 预览图等。

**curl 示例**：
```bash
curl -X GET https://api.poyo.ai/api/generate/status/task-unified-1757165031-uyujaw3d \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 三、获取结果的两种方式

### 方式一：轮询 Polling（简单，适合开发 / 简单集成）

```python
import time, requests
while True:
    resp = requests.get(f"{BASE_URL}/api/generate/status/{task_id}", headers=headers)
    task = resp.json()["data"]
    if task["status"] in ["finished", "failed"]:
        break
    time.sleep(2)
```

### 方式二：Webhook 回调（推荐，适合生产）

提交时带 `callback_url`，任务 `finished` / `failed` 时自动 POST 推送结果（结构同 status 响应）。

| 对比 | Webhook | Polling |
|------|---------|---------|
| 适用 | 生产系统 | 开发 / 简单集成 |
| 优点 | 实时、无轮询开销 | 实现简单、无需服务器 |
| 缺点 | 需公网端点、调试难 | 延迟高、消耗资源多 |

**回调端点要求**：
- HTTPS（不支持 HTTP）
- URL ≤ 2048 字符
- 10 秒内响应
- 返回 HTTP 2xx
- 禁用私网 / 内网 IP（如 192.168.x.x、10.x.x.x）
- 公网可达

**重试策略**：失败重试 3 次（间隔 1s / 2s / 4s）；全部失败仍可轮询 status 兜底。

**安全最佳实践**：签名验签、幂等处理、异步处理后快速返回 200、记录日志。

**回调处理示例（Node.js / Express）**：
```js
app.post('/webhook/generation-complete', (req, res) => {
  const { data } = req.body;
  const { task_id, status, files, error_message } = data;
  if (status === 'finished') {
    files.forEach(f => console.log(`Generated: ${f.file_url}`));
  } else if (status === 'failed') {
    console.log(`Task ${task_id} failed: ${error_message}`);
  }
  res.status(200).json({ received: true }); // 快速确认
});
```

> 本地测试可用 ngrok 暴露本地服务：`ngrok http 3000`，用其 HTTPS URL 作 `callback_url`。
> 文档另有 **3D Webhook**（`3d-webhooks`）专用版本，结构同 3D status。

---

## 四、账户管理 Account Management

### 查询用户余额 Query User Balance

```
GET https://api.poyo.ai/api/user/balance
```

实时查询账户 credit 余额。

**响应**：
```json
{
  "code": 200,
  "data": {
    "email": "user@example.com",
    "credits_amount": 17276
  }
}
```

**要点**：
- **实时余额**：返回请求时刻的当前余额。
- **扣费规则**：仅当生成任务**成功完成**才扣费，**失败不扣费**。
- **限流**：避免频繁轮询，建议缓存余额、仅在必要时（如任务完成后）刷新。
- **用途**：仪表盘展示、余额预警、充值提醒、用量追踪。

---

## 五、错误码 Error Codes

### 响应格式

**成功**（`code: 200`）：见上文 Submit / Status 响应。

**错误**：
```json
{
  "code": 400,
  "error": { "message": "task_id is required", "type": "validation_error" }
}
```

**任务失败**（HTTP 200 但 `status: failed`）：
```json
{
  "code": 200,
  "data": {
    "task_id": "8FDN1I7M7Q68DDG8",
    "status": "failed",
    "files": [],
    "created_time": "2025-11-25T08:50:13",
    "error_message": "The prompt violates our content policy"
  }
}
```

### HTTP 状态码与错误类型

| Code | 含义 | error.type |
|------|------|-----------|
| 200 | 成功 | — |
| 400 | 参数错误 | `validation_error` / `content_moderation_error` / `content_too_long_error` / `file_format_error` |
| 401 | 认证失败（API Key 无效或缺失） | — |
| 402 | 余额不足 | `insufficient_credits_error` |
| 403 | 权限不足 | `permission_denied_error` |
| 404 | 资源不存在 | `resource_not_found_error` |
| 408 | 请求超时 | `timeout_error` |
| 429 | 触发限流 | `rate_limit_error` |
| 500 | 服务端错误 | `internal_error` |
| 502 | 上游服务错误 | `upstream_error` |
| 503 | 服务暂不可用 | `service_error` |

### 错误处理最佳实践

- **重试逻辑**：对 500 / 502 / 503，使用指数退避重试。
- **限流处理**：收到 429 时先等待再重试，可实现请求队列。
- **输入校验**：发送前校验参数，避免 400。
- **余额监控**：跟踪 credit 余额，避免关键操作时遇 402。

---

## 六、Common API 速览

| 分类 | 功能 | 端点 / 方法 |
|------|------|------------|
| 生成 | 提交任务 | `POST /api/generate/submit` |
| 生成 | 查询状态（通用） | `GET /api/generate/status/{task_id}` |
| 生成 | 查询状态（3D 专用版） | `GET /api/generate/status/{task_id}` |
| 生成 | 查询音乐详情（Suno 系列） | `GET /api/generate/detail/music` |
| 回调 | Webhook（通用 / 3D） | 提交时传 `callback_url` |
| 账户 | 查询余额 | `GET /api/user/balance` |

**一句话总结**：Common API = 统一提交（submit）+ 统一查询（status）+ 回调（webhooks）+ 余额（balance）+ 统一错误码，
所有具体生成模型都复用这套公共接口与响应结构。

---

## 七、相关链接

- API 概览：https://docs.poyo.ai/api-manual/overview
- API Key 管理：https://poyo.ai/dashboard/api-key
- 模型列表：https://poyo.ai/models
- 价格：https://poyo.ai/pricing
