# PoYo AI 各模型点数（Credits）消耗参考

> 来源：PoYo AI 官方文档（`docs.poyo.ai`）
> 整理日期：2026-05-31
>
> ⚠️ **重要说明**：本文档点数数据来自两个来源：
> ① **API 文档**（docs.poyo.ai）——仅少数模型给出具体数字；
> ② **官网模型页 / 搜索抓取**（poyo.ai，2026-05）——补全了主力模型的具体单价与 USD 价格。
> 实际扣费请以**控制台账单**（https://poyo.ai/dashboard/history）为准，单价可能随上游调整。
>
> 💱 **点数与美元换算（多模型交叉验证一致）**：
> **1 credit = $0.005 USD**，即 **$1 = 200 credits**。
> 官网说明：credits 永不过期、无订阅制、按量付费。

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

## 二、🌐 官网抓取补全的具体单价（2026-05）

> 以下数据来自 poyo.ai 官网模型页/对比页与搜索结果，**1 credit = $0.005**。
> 这些是 API 文档里**未列出**、但官网公开的具体单价，供估算参考。

### 视频生成

| 模型 | 点数 | 美元 | 备注 |
|------|------|------|------|
| `sora-2-official` | 12 credits/秒 | $0.06/秒 | 4/8/12/16/20s = 48/96/144/192/240 credits |
| `sora-2-pro`（官方） | 100 credits/次（定额） | $0.50/视频 | ≤25s、1024p，与时长/分辨率无关 |
| `wan-2.7-video` | 720p 12 / 1080p 18 credits/秒 | $0.06 / $0.09 /秒 | |
| `seedance-2` 480p | 含视频输入 10 / 无 20 credits/秒 | $0.05 / $0.10 | |
| `seedance-2` 720p | 含视频输入 20 / 无 40 credits/秒 | $0.10 / $0.20 | |
| `seedance-2` 1080p | 含视频输入 45 / 无 90 credits/秒 | $0.225 / $0.45 | |
| `kling-2.6` | 5s 无音频 65 / 10s 无音频 130 | $0.325 / $0.65 | ≈13 credits/秒 |
| `kling-2.6` 含音频 | 5s 120 / 10s 240 | $0.60 / $1.20 | ≈24 credits/秒 |
| `kling-2.6-motion-control` | 720p 8 / 1080p 12 credits/秒 | $0.04 / $0.06 /秒 | |
| `kling-o3/standard` | 10（无音频）/ 13（含音频）credits/秒 | $0.05 / $0.065 /秒 | 文档亦确认 |
| `kling-o3/pro` | 13 / 16 credits/秒 | $0.065 / $0.08 /秒 | 文档亦确认 |
| `kling-o3/4K`、`kling-3.0/4K` | 50 credits/秒 | $0.25/秒 | 文档亦确认 |

### 图像生成（每张/每次）

| 模型 | 点数 | 美元 |
|------|------|------|
| `nano-banana` | 5 credits | $0.025 |
| `seedream-5.0-lite` | 5 credits | $0.025 |
| `seedream-4.5` | 10 credits | $0.05 |
| `gpt-image-2` | 起 2 credits/次 | 起 $0.01（再乘 1K/2K/4K = 1x/2x/4x 倍率） |

### 音乐 / 语音（每次生成）

| 模型 | 点数 | 美元 |
|------|------|------|
| `generate-music`（Suno） | 20 credits | $0.10 |
| `add-vocals` | 20 credits | $0.10 |
| `add-instrumental` | 20 credits | $0.10 |
| `upload-and-cover-audio` | 20 credits | $0.10 |
| `extend-music` | 20 credits | $0.10 |
| `generate-music-cover` | 1 credit | $0.005 |
| `generate-lyrics` | 1 credit | $0.005 |
| `elevenlabs-v3-tts` | 16 credits / 1000 字符 | $0.08 / 1000 字符 |

---

## 三、✅ API 文档中已明确具体点数的模型

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

## 四、⚠️ 仅说明计费维度、暂无公开数字的模型

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

## 五、点数消耗速查总表

| 类别 | 模型 | 点数 / 规则 | 来源 |
|------|------|------------|:---:|
| 3D | tripo3d-h3.1 文生/多视图 | 15 / 30 / 45（无/标准/精细纹理） | 文档 |
| 3D | tripo3d-h3.1 图生 | 30 / 45 / 60 | 文档 |
| 3D | tripo3d-h3.1 附加 | 精细几何 +30；四边面 +7.5 | 文档 |
| 3D | tripo3d-p1 | 无纹理 56 / 含纹理 70 | 文档 |
| 3D | meshy-6 | 未公开数字 | 模型页 |
| 视频 | sora-2-official | 12 credits/s（$0.06） | 官网 |
| 视频 | sora-2-pro | 100 credits/次（$0.50，定额≤25s） | 官网 |
| 视频 | wan-2.7-video | 720p 12 / 1080p 18 credits/s | 官网 |
| 视频 | seedance-2 | 480p 10-20 / 720p 20-40 / 1080p 45-90 credits/s | 官网 |
| 视频 | kling-2.6 | 无音频 65/130；含音频 120/240（5/10s） | 官网 |
| 视频 | kling-2.6-motion-control | 720p 8 / 1080p 12 credits/s | 官网 |
| 视频 | kling-o3/standard | 10（无音频）/ 13（含音频）credits/s | 文档+官网 |
| 视频 | kling-o3/pro | 13 / 16 credits/s | 文档+官网 |
| 视频 | kling-o3/4K · kling-3.0/4K | 50 credits/s（$0.25） | 文档+官网 |
| 视频 | veo/kling-avatar/hailuo 等 | 按时长×分辨率(±音频)，暂无数字 | 模型页 |
| 图像 | nano-banana | 5 credits（$0.025） | 官网 |
| 图像 | seedream-5.0-lite | 5 credits（$0.025） | 官网 |
| 图像 | seedream-4.5 | 10 credits（$0.05） | 官网 |
| 图像 | gpt-image-2 | 起 2 credits/次 × (1K=1x/2K=2x/4K=4x) | 文档+官网 |
| 图像 | seedream-4 | 基础 × n（不足退款） | 文档 |
| 图像 | kling-o1 / kling-o3 图像 | 分辨率 × n | 文档 |
| 图像 | flux-kontext 等 | 按模型配置价，暂无数字 | 模型页 |
| 音乐 | generate-music / add-vocals / add-instrumental / cover / extend | 20 credits（$0.10）/次 | 官网 |
| 音乐 | generate-music-cover / generate-lyrics | 1 credit（$0.005） | 官网 |
| 音乐 | elevenlabs-v3-tts | 16 credits / 1000 字符（$0.08） | 文档+官网 |
| LLM | GPT/Claude/Gemini | 按 token（usage 字段），见模型页 | 模型页 |

---

## 六、计费要点提醒

1. **失败不扣费**：任务 `failed` 不消耗点数；只为 `finished` 付费。
2. **退款机制**：如 `seedream-4` 等按 `base × n` 预扣，少出图自动退还差额。
3. **音频加价**：Kling O3 等含原生音频会提高每秒单价（约 +3 credits/s）。
4. **4K 加价**：图像/视频 4K 通常是基础的数倍（如 gpt-image-2 的 4x、Kling 4K 的 50 c/s）。
5. **以账单为准**：文档单价可能随上游调整；如疑似计费异常，以
   https://poyo.ai/dashboard/history 的实际记录为准。

---

## 七、相关链接

- 定价页（权威单价）：https://poyo.ai/pricing
- 模型列表 / Playground：https://poyo.ai/models
- 任务历史 / 账单：https://poyo.ai/dashboard/history
- 余额接口：`GET https://api.poyo.ai/api/user/balance`
