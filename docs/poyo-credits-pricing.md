# PoYo AI 各模型点数（Credits）消耗参考

> 来源：PoYo AI 官方文档（`docs.poyo.ai`）
> 整理日期：2026-05-31
>
> ⚠️ **重要说明**：PoYo 官方文档中**仅少数模型给出了具体点数数字**，
> 多数模型页只说明"计费维度"（按时长/分辨率/数量等），具体单价指向
> 模型详情页或定价页（https://poyo.ai/pricing）。本文档**如实区分**：
> ① 文档中已明确的具体点数；② 仅说明计费规则但无数字的模型；③ 通用计费机制。
> 实际扣费请以**控制台账单**（https://poyo.ai/dashboard/history）为准。

---

## 一、通用计费机制

| 规则 | 说明 |
|------|------|
| **扣费时机** | 仅当任务 `status` 变为 **`finished`** 才扣费；**`failed` 不消耗点数** |
| **余额查询** | `GET /api/user/balance`，返回 `credits_amount` |
| **账单核对** | https://poyo.ai/dashboard/history （含每任务点数消耗，权威来源） |
| **文件上传** | 文件服务（file-series）不在生成扣费范围内（详见上传文档） |
| **LLM 对话** | 按 token 计费（响应含 `usage.prompt_tokens` / `completion_tokens` / `total_tokens`）；具体单价依模型，见 pricing 页 |
| **整体价位** | 官方称通常比上游官方 API 低 **30%-50%**，部分模型最高低 **80%** |

---

## 二、✅ 已明确具体点数的模型

### 3D 生成

#### `tripo3d-h3.1`（Tripo3D H3.1）
| 模式 | 无纹理 | 标准纹理 | 精细纹理 |
|------|:---:|:---:|:---:|
| 文生 3D / 多视图生 3D | 15 | 30 | 45 |
| 图生 3D | 30 | 45 | 60 |

**附加项**：精细几何（detailed geometry）**+30**；四边面网格（quad mesh）**+7.5**
（单位：credits）

#### `tripo3d-p1`（Tripo3D P1，低多边形）
| 配置 | 点数 |
|------|:---:|
| 无纹理 | 56 |
| 含纹理 | 70 |

### 视频生成（Kling 系列，按秒计费）

| 模型 | 无音频 | 含音频 |
|------|:---:|:---:|
| `kling-o3/standard` | 10 credits/秒 | 13 credits/秒 |
| `kling-o3/pro` | 13 credits/秒 | 16 credits/秒 |
| `kling-o3/4K` | 50 credits/秒 | 50 credits/秒 |
| `kling-3.0/4K` | 50 credits/秒 | 50 credits/秒 |

### 音乐 / 语音

| 模型 | 计费 |
|------|------|
| `elevenlabs-v3-tts`（文本转语音） | **16 credits / 1000 字符** |

### 图像生成（倍率/规则）

| 模型 | 计费规则 |
|------|---------|
| `gpt-image-2` | 按分辨率倍率：**1K = 1x（基础）、2K = 2x、4K = 4x**。`size=auto` 或不传 size 始终按 1K；自定义 size 须 2K/4K；4K 仅在 16:9/9:16/21:9 或带 3840px 边的自定义尺寸按 4x，其余 4K 自动降为 2K（2x）计费 |
| `seedream-4` | 按 **基础点数 × n** 预扣；实际返回图片少于请求数时，未用部分自动退款 |

---

## 三、⚠️ 仅说明计费维度、文档未给具体数字的模型

> 以下模型文档明确了「按什么计费」，但**未列出具体点数单价**，需查模型页 / 定价页。

### 视频生成

| 模型 | 计费维度 |
|------|---------|
| `sora-2-pro-official` | 按**输出分辨率 × 时长（秒）** |
| `veo-3-1-official`（fast/lite/quality） | 按**生成秒数**，随模型、分辨率、是否含音频变化（lite 单价更低） |
| `veo-3-1` | 随**模型与分辨率**变化 |
| `kling-avatar-2.0`（standard/pro） | 按**检测到的音频时长**（向上取整到秒）× 模型档位 |
| `seedance-2` / `seedance-2-fast` | 按**时长 × 分辨率**；含 `reference_video_urls` 时成本可能不同（fast 版更低） |
| `wan-2-7-video` | 按**时长 × 分辨率** |
| 其余视频模型（sora-2、kling-2.x、wan、hailuo、grok、runway 等） | 文档未单列，按时长/分辨率，见模型页 |

### 图像生成

| 模型 | 计费维度 |
|------|---------|
| `flux-kontext`（pro/max） | 按**所配置的模型价**直接扣费 |
| `kling-o1-image-edit` | 按**分辨率 × 输出数量 n** |
| `kling-o3-image` / `-edit` | 按**分辨率 × 输出数量 n** |
| 其余图像模型（nano-banana、flux-2、seedream-4.5/5.0、wan-2.7-image、z-image、grok-image 等） | 文档未单列，按分辨率/数量，见模型页 |

### 3D 生成

| 模型 | 计费维度 |
|------|---------|
| `meshy-6`（text/image/multi-image） | 文档未列具体点数，见模型页 |

---

## 四、点数消耗速查总表

| 类别 | 模型 | 点数 / 规则 | 来源 |
|------|------|------------|:---:|
| 3D | tripo3d-h3.1 文生/多视图 | 15 / 30 / 45（无/标准/精细纹理） | 文档 |
| 3D | tripo3d-h3.1 图生 | 30 / 45 / 60 | 文档 |
| 3D | tripo3d-h3.1 附加 | 精细几何 +30；四边面 +7.5 | 文档 |
| 3D | tripo3d-p1 | 无纹理 56 / 含纹理 70 | 文档 |
| 3D | meshy-6 | 未公开数字 | 模型页 |
| 视频 | kling-o3/standard | 10（无音频）/ 13（含音频）credits/s | 文档 |
| 视频 | kling-o3/pro | 13 / 16 credits/s | 文档 |
| 视频 | kling-o3/4K | 50 credits/s | 文档 |
| 视频 | kling-3.0/4K | 50 credits/s | 文档 |
| 视频 | sora/veo/kling-avatar/seedance/wan 等 | 按时长×分辨率(±音频)，无数字 | 模型页 |
| 图像 | gpt-image-2 | 1K=1x / 2K=2x / 4K=4x | 文档 |
| 图像 | seedream-4 | 基础 × n（不足退款） | 文档 |
| 图像 | kling-o1 / kling-o3 图像 | 分辨率 × n，无数字 | 文档 |
| 图像 | flux-kontext 等 | 按模型配置价，无数字 | 模型页 |
| 音乐 | elevenlabs-v3-tts | 16 credits / 1000 字符 | 文档 |
| 音乐 | generate-music 等 Suno 系列 | 未公开数字 | 模型页 |
| LLM | GPT/Claude/Gemini | 按 token（usage 字段），无单价 | 模型页 |

---

## 五、计费要点提醒

1. **失败不扣费**：任务 `failed` 不消耗点数；只为 `finished` 付费。
2. **退款机制**：如 `seedream-4` 等按 `base × n` 预扣，少出图自动退还差额。
3. **音频加价**：Kling O3 等含原生音频会提高每秒单价（约 +3 credits/s）。
4. **4K 加价**：图像/视频 4K 通常是基础的数倍（如 gpt-image-2 的 4x、Kling 4K 的 50 c/s）。
5. **以账单为准**：文档单价可能随上游调整；如疑似计费异常，以
   https://poyo.ai/dashboard/history 的实际记录为准。

---

## 六、相关链接

- 定价页（权威单价）：https://poyo.ai/pricing
- 模型列表 / Playground：https://poyo.ai/models
- 任务历史 / 账单：https://poyo.ai/dashboard/history
- 余额接口：`GET https://api.poyo.ai/api/user/balance`
