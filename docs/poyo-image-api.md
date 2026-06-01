# PoYo AI 图像生成 API 完整文档

> 来源：PoYo AI 官方文档（`docs.poyo.ai/api-manual/image-series`）
> 整理日期：2026-05-31
> 共 17 个图像模型页（含 Nano Banana、GPT Image、Flux、Seedream、Wan、Kling、Z-Image、Grok 等家族）。

---

## 一、通用约定

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://api.poyo.ai` |
| **提交端点** | `POST /api/generate/submit` |
| **查询端点** | `GET /api/generate/status/{task_id}` |
| **认证** | `Authorization: Bearer YOUR_API_KEY` |
| **请求结构** | `{ "model": "<模型名>", "callback_url": "...", "input": { ...参数 } }` |
| **异步流程** | 提交返回 `task_id` → 轮询 / 回调（`finished`/`failed` 时 POST 推送） |
| **文件有效期** | 生成图片 URL 通常 24 小时有效，需及时下载 |

**通用约定**：
- **文生图 vs 编辑模式**：多数模型「省略 `image_urls` = 文生图；提供 `image_urls` = 自动进入编辑模式」。部分模型用独立的 `-edit` 模型名。
- `n`：一次生成的图片数量（多数模型支持）。
- `size`：可为比例预设（1:1/16:9…）、分辨率预设（1K/2K/4K）、自定义 `WIDTHxHEIGHT` 字符串或 `{width,height}` 对象（视模型而定）。
- 计费多按**分辨率 × 数量 n**；部分预扣后按实际返回数量退款。

---

## 二、Nano Banana 系列（Google Gemini Flash）

### `nano-banana` — Nano Banana（Gemini 2.5 Flash）
- 模型：`nano-banana`（文生图 + 图生图）、`nano-banana-edit`（高级编辑）
- 快速高吞吐，适合快速迭代

### `nano-banana-2` / Nano Banana Pro
- 经典：`nano-banana-2`、`nano-banana-2-edit`
- Pro：`nano-banana-pro`、`nano-banana-pro-edit`（编辑支持最多 14 张参考图）
- **Pro 参数**：`size`（支持 `auto`，默认 auto）、`resolution`（1K/2K/4K）、`output_format`（png/jpg）、`enable_web_search`（true/false）

### `nano-banana-2-new`（Gemini 3.1 Flash Image Preview）
- 模型：`nano-banana-2-new`、`nano-banana-2-new-edit`、`nano-banana-2-official`、`nano-banana-2-official-edit`
- 原生 2K/4K，精准多语言文字渲染，物理关系链式理解，最多 14 张参考图
- official 版：`output_format`、`size=auto`、分辨率 0.5K/1K/2K/4K

---

## 三、OpenAI GPT Image 系列

### `gpt-4o-image` — GPT-4o 图像
- 模型：`gpt-4o-image`（文生图 + 图生图）、`gpt-4o-image-edit`（支持蒙版 mask 编辑）

### `gpt-image-1.5`
- 模型：`gpt-image-1.5`（文生图 + 图生图）、`gpt-image-1.5-edit`（支持蒙版）

### `gpt-image-2` — GPT Image 2
- 模型：`gpt-image-2`（文生图 + 可选参考图引导）、`gpt-image-2-edit`（基于一或多张参考图 + 文本指令编辑，`image_urls` 必填）
- **参数**：
  - `prompt`：最多 20000 字符
  - 每次请求返回**单张**图片
  - `quality`：low（默认）/ medium / high
  - `size`：auto / 1:1 / 2:3 / 3:2 / 4:3 / 3:4 / 4:5 / 5:4 / 16:9 / 9:16 / 21:9 或自定义 `WIDTHxHEIGHT`
  - `resolution`：1K（默认，1x）/ 2K（2x）/ 4K（4x）credits
- **分辨率规则**：
  - `size=auto` 或不传 size → 始终 1K（忽略 resolution）
  - 自定义 size 必须 resolution=2K 或 4K
  - 4K 仅在 16:9 / 9:16 / 21:9 或带 3840px 边的自定义尺寸时按 4x 计费，其余 4K 自动降为 2K 计费
- **自定义尺寸约束**：两边均能被 16 整除；最大边 3840px；宽高比 ≤3:1；总像素 655,360 ~ 8,294,400

**示例**：
```json
{
  "model": "gpt-image-2",
  "callback_url": "https://your-domain.com/callback",
  "input": { "prompt": "A premium product photo of a silver espresso machine on a clean white studio background", "quality": "low", "size": "1:1", "resolution": "1K" }
}
```

---

## 四、Black Forest Labs Flux 系列

### `flux-2` — Flux.2（32B）
- 模型：`flux-2-pro`、`flux-2-pro-edit`（多参考编辑，最多 8 张）、`flux-2-flex`、`flux-2-flex-edit`
- 文生图 + 多图编辑统一架构，最高 2K，写实图像 + 清晰排版，最多同时引用 8 张图，角色/产品/风格一致性强

### `flux-kontext` — Flux Kontext
- 模型：`flux-kontext-pro`、`flux-kontext-pro-edit`、`flux-kontext-max`、`flux-kontext-max-edit`（edit 模型 `image_urls` 必填）
- **参数**：`size`（1:1/4:3/3:4/16:9/9:16/21:9/9:21）、`output_format`（png/jpg）
- 编辑模型仅用 `image_urls[0]` 作输入图；其余下游字段用系统默认；按模型价直接计费

---

## 五、字节 Seedream 系列

### `seedream-4`
- 模型：`seedream-4`（文生图 + 可选参考图）、`seedream-4-edit`（编辑，`image_urls` 必填）
- `size`（比例）：1:1/3:4/4:3/16:9/9:16/3:2/2:3/21:9；`resolution`：1K/2K/4K（默认 2K）；`n`：1-15
- `image_urls` + `n` 总和 ≤15；按 `base × n` 预扣，返回不足自动退款

### `seedream-4-5` — Seedream 4.5
- 模型：`seedream-4.5`（文生图 + 图生图）、`seedream-4.5-edit`（多参考编辑，最多 10 张）
- **size 多形态**：
  - 分辨率预设：2K / 4K
  - 比例预设：1:1/4:3/3:4/16:9/9:16/3:2/2:3/21:9
  - 自定义字符串：`WIDTHxHEIGHT`（如 1920x4096）
  - 自定义对象：`{ "width": 2304, "height": 3072 }`
- 文生图与 edit 模式均支持自定义尺寸

### `seedream-5-0-lite` — Seedream 5.0 Lite
- 模型：`seedream-5.0-lite`、`seedream-5.0-lite-edit`（多参考，最多 10 张）
- **size**：分辨率预设 2K/3K；比例预设同上；自定义字符串/对象（如 2304x1728）

**Seedream 通用调用示例**：
```bash
curl -X POST https://api.poyo.ai/api/generate/submit \
  -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' \
  -d '{ "model": "seedream-4.5", "callback_url": "...", "input": { "prompt": "A serene Japanese garden with cherry blossoms", "size": "16:9", "n": 1 } }'
```

---

## 六、阿里 Wan 图像系列

### `wan-2-7-image` — Wan-2.7-Image（统一文生图/编辑）
- 模型：`wan-2.7-image`（省略 image_urls=文生图；提供=自动编辑）
- **size 预设**：512x512 / 1024x1024 / 768x1024 / 1024x768 / 576x1024 / 1024x576（默认 1024x1024），或自定义 `{width,height}` 对象
- **参数**：`prompt`(必填)、`size`、`n`(1-4)、`seed`、`image_urls`（编辑用，1-4 张，prompt 中按序称 image 1/2/3/4）

### `wan-2-7-image-pro` — Wan-2.7-Image-Pro
- 模型：`wan-2.7-image-pro`，参数与 size 同 wan-2.7-image，高质量版

---

## 七、快手 Kling 图像系列

### `kling-o1` — Kling-o1（高一致性编辑）
- 模型：`kling-o1-image-edit`（带参考图与可选元素引导的编辑）
- 专为精准参考对齐与细节控制优化，适合角色/产品场景
- **参数**：
  - `prompt`（必填编辑提示）
  - `image_urls`（必填，1-10 张）
  - `elements`（可选，元素描述符数组，prompt 中用 `@Element1`/`@Element2` 引用；推荐结构 `frontal_image_url` + 可选 `reference_image_urls`）
  - `resolution`：1K / 2K
  - `size`：auto/16:9/9:16/1:1/4:3/3:4/3:2/2:3/21:9
  - `output_format`：jpeg/png/webp
  - `n`：1-9
- **计费**：按分辨率 × n

### `kling-o3` — Kling-o3（高表现力）
- 模型：`kling-o3-image`（纯 prompt 生成）、`kling-o3-image-edit`（带参考图编辑）
- 强语义理解与场景构图，适合创意叙事
- **参数**：
  - `prompt`（必填）
  - `image_urls`（可选，1-10 张，编辑模式用）
  - `elements`（可选，同 o1，用于人脸/物体一致性控制）
  - `resolution`：1K / 2K / 4K
  - `size`：image 版无 auto；edit 版含 auto，其余 16:9/9:16/1:1/4:3/3:4/3:2/2:3/21:9
  - `output_format`：jpeg/png/webp；`n`：1-9
- **计费**：按分辨率 × n

---

## 八、其他模型

### `z-image` — Z-Image（统一文生图/编辑）
- 模型：`z-image`（省略 image_urls=文生图；提供=自动编辑）
- **参数**：
  - `prompt`：必填，最多 1000 字符
  - `size`：文生图必填、编辑可选；支持 1:1/4:3/3:4/16:9/9:16
  - `image_urls`：编辑用，**恰 1 张**（用 `image_urls[0]`）
  - `enable_safety_checker`：可选布尔，默认 true

### `grok-imagine-image` — Grok Imagine 图像
- 模型：`grok-imagine-image`（文生图 + 图生图）
- 图生图：`image_urls` 必填，数组含**单个** URL；图片类型 image/jpeg、image/png、image/webp，≤10MB
- `size`（两种模式均可选）：2:3 / 3:2 / 1:1 / 16:9 / 9:16

---

## 九、模型速查表

| 家族 | 模型 ID | 模式 | 多图参考 | 最高分辨率 | n |
|------|---------|------|:---:|:---:|:---:|
| Nano Banana | nano-banana / -edit | T2I, I2I, 编辑 | — | — | — |
| Nano Banana | nano-banana-2 / -edit | T2I, I2I, 编辑 | — | — | — |
| Nano Banana | nano-banana-pro / -edit | T2I, 编辑 | 14 张 | 4K | — |
| Nano Banana | nano-banana-2-new(+official/edit) | T2I, I2I, 编辑 | 14 张 | 4K | — |
| GPT Image | gpt-4o-image / -edit | T2I, I2I, 蒙版编辑 | — | — | — |
| GPT Image | gpt-image-1.5 / -edit | T2I, I2I, 蒙版编辑 | — | — | — |
| GPT Image | gpt-image-2 / -edit | T2I, 多图编辑 | ✅ | 4K | 1 |
| Flux | flux-2-pro/flex(+edit) | T2I, 多图编辑 | 8 张 | 2K | — |
| Flux | flux-kontext-pro/max(+edit) | T2I, 编辑 | 1 张 | — | — |
| Seedream | seedream-4 / -edit | T2I, 编辑 | ✅ | 4K | 1-15 |
| Seedream | seedream-4.5 / -edit | T2I, I2I, 编辑 | 10 张 | 4K | — |
| Seedream | seedream-5.0-lite / -edit | T2I, I2I, 编辑 | 10 张 | 3K | — |
| Wan | wan-2.7-image | T2I + 自动编辑 | 4 张 | 自定义 | 1-4 |
| Wan | wan-2.7-image-pro | T2I + 自动编辑 | 4 张 | 自定义 | 1-4 |
| Kling | kling-o1-image-edit | 编辑 | 10 张 | 2K | 1-9 |
| Kling | kling-o3-image / -edit | T2I, 编辑 | 10 张 | 4K | 1-9 |
| 其他 | z-image | T2I + 自动编辑 | 1 张 | — | — |
| 其他 | grok-imagine-image | T2I, I2I | 1 张 | — | — |

> T2I=文生图，I2I=图生图。

---

## 十、通用请求 / 查询示例

```bash
# 提交文生图
curl -X POST https://api.poyo.ai/api/generate/submit \
  -H "Authorization: Bearer $POYO_API_KEY" -H "Content-Type: application/json" \
  -d '{ "model": "nano-banana-pro", "callback_url": "https://your-domain.com/callback",
        "input": { "prompt": "A cozy reading nook with warm light", "resolution": "2K", "output_format": "png" } }'

# 查询结果
curl -X GET https://api.poyo.ai/api/generate/status/{task_id} \
  -H "Authorization: Bearer $POYO_API_KEY"
```

`finished` 后从 `data.files[].file_url`（`file_type: image`）获取图片地址。

---

## 十一、相关链接

- API 概览：https://docs.poyo.ai/api-manual/overview
- 模型列表 / Playground：https://poyo.ai/models
- 价格：https://poyo.ai/pricing
