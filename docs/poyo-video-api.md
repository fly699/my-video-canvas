# PoYo AI 视频生成 API 完整文档

> 来源：PoYo AI 官方文档（`docs.poyo.ai/api-manual/video-series`）
> 整理日期：2026-05-31
> 共 31 个视频模型，涵盖 OpenAI Sora、Google VEO、Kling、阿里 Wan、字节 Seedance、Hailuo、Grok、Runway 等家族。

---

## 一、通用约定

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://api.poyo.ai` |
| **提交端点** | `POST /api/generate/submit` |
| **查询端点** | `GET /api/generate/status/{task_id}`（视频统一走标准任务状态接口） |
| **认证** | `Authorization: Bearer YOUR_API_KEY` |
| **请求结构** | `{ "model": "<模型名>", "callback_url": "...", "input": { ...参数 } }` |
| **异步流程** | 提交返回 `task_id` → 轮询 / 回调（`callback_url`，`finished`/`failed` 时 POST 推送） |
| **文件有效期** | 生成视频 URL 通常 **24 小时**有效，需及时下载保存 |
| **计费** | 多数模型按**时长 × 分辨率**（部分含音频）计算 credit；详见各模型 |

> 所有视频模型共用同一套提交 / 查询 / 回调机制（参见 Common API）。下文仅列各模型差异化参数。

---

## 二、OpenAI Sora 系列

### `sora-2` — Sora 2 标准画质
- 模型：`sora-2`、`sora-2-private`（私有部署）
- 模式：文生视频、图生视频
- **时长**：10s / 15s
- **风格 Style**：`thanksgiving` / `comic` / `news` / `selfie` / `nostalgic` / `anime`
- **Storyboard**：`true`/`false`，开启故事板模式精细控制

### `sora-2-pro` — Sora 2 Pro 高清画质
- 模型：`sora-2-pro`、`sora-2-pro-private`（私有部署）
- 模式：文生视频、图生视频
- **时长**：15s / 25s（扩展 HD）
- **风格 / Storyboard**：同 sora-2

### `sora-2-official` — Sora 2 官方版
- 模型：`sora-2-official`，文生视频 + 可选单图引导
- **必填**：`prompt`
- **可选**：
  - `duration`：4 / 8 / 12 / 16 / 20（默认 4）
  - `aspect_ratio`：16:9 / 9:16（默认 16:9）
  - `image_urls`：可选参考图数组，**最多 1 张**

### `sora-2-pro-official` — Sora 2 Pro 官方版
- 模型：`sora-2-pro-official`，文生视频 + 图生视频
- **必填**：`prompt`
- **可选**：
  - `image_urls`：可选参考图（最多 1 张，提供即进入图生视频模式，作首帧）
  - `aspect_ratio`：文生 16:9/9:16；图生 auto/16:9/9:16（`auto` 仅图生有效）
  - `duration`：4 / 8 / 12 / 16 / 20（默认 4）
  - `resolution`：720p / 1024p / 1080p（默认 1024p）
- **计费**：按输出分辨率 × 时长（秒）

---

## 三、Google VEO 系列

### `veo-3-1` — VEO 3.1（Lite/Fast/Quality）
- 模型：`veo3.1-fast`、`veo3.1-lite`、`veo3.1-quality`（均 8 秒）
- 全部支持文生视频；`veo3.1-fast` / `veo3.1-quality` 还支持图生视频
- **分辨率**：720p（默认）/ 1080p / 4k
- **generation_type**：
  - `frame`（两图，首帧+尾帧）/ `reference`（三图）
  - 省略时按 `image_urls` 数量推断（2 图=frame，3 图=reference）
  - `veo3.1-quality` 不支持 reference；`veo3.1-lite` 不支持本参数及 `image_urls`
- **image_urls**：最多 3 张，单张 ≤10MB，格式 .jpeg/.jpg/.png/.webp
- 视频 URL 24 小时有效

### `veo-3-1-official` — VEO 3.1 官方版
- 模型：`veo3.1-fast-official`（4/6/8s）、`veo3.1-lite-official`（低单价）、`veo3.1-quality-official`（支持 4K）
- 模式：无图=文生；1 图=图生；2 图=首尾帧；3 图=`reference`（固定 8s）
  - `veo3.1-lite-official` 最多 2 图，不支持 reference
- **参数**：
  - `prompt`：必填，≤1000 字符
  - `image_urls`：可选
  - `generation_type`：`frame` / `reference`（省略则自动推断）
  - `duration`：4/6/8；reference(3 图) 仅 8；lite-official + 1080p 仅 8
  - `aspect_ratio`：16:9 / 9:16（图生与首尾帧支持 auto）
  - `resolution`：720p / 1080p / 4k（lite-official 不支持 4k）
  - `sound`：默认 true，设 false 静音输出
- **计费**：按生成秒数，随模型/分辨率/是否含音频而变

---

## 四、Kling 系列

### `kling-2-1` — Kling 2.1
- 模型：`kling-2.1/standard`、`kling-2.1/pro`（图生视频）
- **必填**：`prompt`、`start_image_url`（首帧）
- **可选**：`duration` 5/10（默认 5）、`end_image_url`（仅 pro）、`negative_prompt`
- standard 不支持 end_image_url

### `kling-2-5-turbo-pro` — Kling 2.5 Turbo Pro
- 模型：`kling-2.5-turbo-pro`，文生视频 + 可选首尾帧
- **必填**：`prompt`
- **可选**：`duration` 5/10、`start_image_url`、`end_image_url`、`aspect_ratio`、`negative_prompt`

### `kling-2-6` — Kling 2.6（原生音频）
- 模型：`kling-2.6`，文生 + 图生
- **原生音频**：同步语音、歌唱、音效、环境声
- **时长**：5/10s；**画幅**：1:1 / 16:9 / 9:16

### `kling-2.6-motion-control` — Kling 2.6 动作控制
- 模型：`kling-2.6-motion-control`，从参考视频迁移动作到角色图
- **必填**：`image_urls`（单张角色图，含头肩躯干）、`video_urls`（单个参考视频 3-30s）、`character_orientation`（`image` 最长 10s 输出 / `video` 最长 30s 输出）、`resolution`（720p/1080p）
- **可选**：`prompt`（≤2500 字符）

### `kling-3-0` — Kling 3.0
- 模型：`kling-3.0/standard`（~720p/1K）、`kling-3.0/pro`（1080p/2K）
- **原生音频**：`input.sound`，multi_shots=true 时 sound 必须 true
- **时长**：3-15s；**画幅**：1:1 / 16:9 / 9:16；文生 + 图生（首尾帧）
- **多镜头 Multi-Shot**：每镜头独立 prompt/时长
- **元素引用**：用 `@element_name` 在 prompt 引用可复用元素（用元素引用时 image_urls 必填）

### `kling-3-0-4k` — Kling 3.0 4K
- 模型：`kling-3.0/4K`，原生 4K 输出
- 原生音频/时长 3-15s/多镜头/元素引用（`kling_elements`）同上
- **计费**：50 credits/秒

### `kling-3-0-motion-control` — Kling 3.0 动作控制
- 模型：`kling-3.0-motion-control`，1 参考图 + 1 参考视频迁移动作
- **必填**：`image_urls`（恰 1 张）、`video_urls`（恰 1 个）、`character_orientation`（image/video）
- **可选**：`prompt`、`resolution`（720p 默认/1080p）、`kling_elements`（面部一致性，仅 orientation=video）
- 图 .jpg/.jpeg/.png ≤10MB；视频 .mp4/.mov ≤100MB，≥3s；orientation=image 视频≤10s，=video≤30s；prompt 引用元素用 `@Element1`

### `kling-o3` — Kling O3
- 模型：`kling-o3/standard`、`kling-o3/pro`
- **三模式**：文生 / 图生 / 参考生视频
- `reference_image_urls`（最多 4 张，进入参考模式）；`image_urls`（最多 2 张，图生模式映射主图+尾帧，参考模式作起止锚点）
- **画幅**：1:1/16:9/9:16（图生忽略 aspect_ratio）
- **多镜头**：multi_shots=true 时 multi_prompt 必填且 sound 必须 true
- `kling_elements` 仅参考模式可用
- **计费**：standard 10 c/s（无音频）/13 c/s（含音频）；pro 13 c/s / 16 c/s

### `kling-o3-4k` — Kling O3 4K
- 模型：`kling-o3/4K`，原生 4K
- 三模式/参考图/锚点/画幅/多镜头/元素同 kling-o3
- **计费**：50 credits/秒

### `kling-avatar-2-0` — Kling Avatar 2.0（音频驱动数字人）
- 模型：`kling-avatar-2.0/standard`、`kling-avatar-2.0/pro`
- 由 1 张参考图 + 1 段驱动音频生成数字人视频
- **必填**：`image_urls`（恰 1 张，作 avatar）、`audio_url`（2-60s，HTTP/HTTPS，≤5MB）
- **可选**：`prompt`
- **计费**：按检测到的音频时长向上取整到秒，随模型与时长变化

---

## 五、阿里 Wan 系列

### `wan-2-6` — Wan 2.6（多镜头 1080p）
- 模型：`wan2.6-text-to-video`、`wan2.6-image-to-video`、`wan2.6-video-to-video`
- **时长**：5/10/15s（视频生视频 ≤10s）；**分辨率**：720p/1080p
- **多镜头**切换；prompt ≤5000 字符

### `wan-2-7-video` — Wan 2.7（四模式）
- 模型：`wan2.7-text-to-video` / `-image-to-video` / `-reference-to-video` / `-edit-video`
- **共享**：`resolution` 720p(默认)/1080p、`seed`(0~2147483647)、`enable_safety_checker`
- **文生**：`prompt` 必填；可选 `audio_url`、`aspect_ratio`(16:9/9:16/1:1/4:3/3:4)、`duration` 5/10/15
- **图生**：`image_urls`（1-2 张，[0]起始 [1]结束）；可选 prompt/video_url/audio_url/`duration` 2-15/multi_shots
- **参考生**：`prompt` 必填 + `reference_image_urls` 或 `reference_video_urls` 至少一种；`duration` 2-10
- **视频编辑**：`prompt`+`video_url` 必填；可选 `reference_image_url`；`duration`=0 或省略则自动探测(2-10s)
- **计费**：按时长 × 分辨率

### `wan-animate` — Wan Animate（角色动画/替换）
- 基于 Wan2.2-Animate（14B）
- 模型：`wan-animate-replace`（替换视频中角色）、`wan-animate-move`（用参考视频动作驱动角色图）
- **分辨率**：480p(默认)/580p/720p

### `wan2.2-image-to-video-fast` — Wan 2.2 图生视频(快)
- 模型：`wan2.2-image-to-video-fast`
- `image_urls`：1 张必填，最多 2 张（第二张作尾帧）；**分辨率** 480p/720p；可选 `seed`

### `wan2.2-text-to-video-fast` — Wan 2.2 文生视频(快)
- 模型：`wan2.2-text-to-video-fast`
- **画幅** 16:9/9:16；**分辨率** 480p/720p；可选 `seed`

### `wan2.5-image-to-video` — Wan 2.5 图生视频
- 模型：`wan2.5-image-to-video`
- `image_urls`：恰 1 张；**分辨率** 480p/720p/1080p；**时长** 5/10s；可选 `audio`/`negative_prompt`/`seed`

### `wan2.5-text-to-video` — Wan 2.5 文生视频
- 模型：`wan2.5-text-to-video`
- **尺寸预设**：832*480 / 480*832 / 1280*720 / 720*1280 / 1920*1080 / 1080*1920
- **时长** 5/10s；可选 `audio`(字符串，**勿传布尔**)/`negative_prompt`/`seed`

---

## 六、字节 Seedance 系列

### `seedance-1.0-pro` — Seedance 1.0 Pro
- 模型：`seedance-1.0-pro`，文生 + 图生
- **分辨率** 720p/1080p；**时长** 5/10s；渲染速度 3 倍于标准 Pro

### `seedance-1-5-pro` — Seedance 1.5 Pro
- 模型：`seedance-1.5-pro`，文生 + 图生
- **分辨率**：480p(标准)/720p(高)/1080p(超清)
- 灵活画幅；自定义时长；**定镜 Fixed Lens**；可选音频生成

### `seedance-2` — Seedance 2 / Seedance 2 Fast
- 模型：`seedance-2`（标准，480p/720p/1080p）、`seedance-2-fast`（低延迟低成本，仅 480p/720p）
- **模式**：文生 / 首尾帧（`image_urls` ≤2 张，[0]首 [1]尾）/ 多模态参考
- **多模态参考**（与 image_urls 互斥）：
  - `reference_image_urls`：≤9 张（JPG/JPEG/PNG/WebP，单张 ≤30MB）
  - `reference_video_urls`：≤3 个（MP4/MOV，合计 2-15s，总 <50MB，480-720p）
  - `reference_audio_urls`：≤3 个（MP3/WAV，合计 ≤15s，单个 ≤30… 实为 ≤15MB），需至少 1 个参考图或视频
  - 参考模式下三类文件合计 ≤12；prompt 中按序引用 `@Image1`/`@Video1`/`@Audio1`
- `aspect_ratio`：21:9/16:9/4:3/1:1/3:4/9:16；`duration`：4-15；`seed` 可选
- **计费**：按时长 × 分辨率；带 reference_video_urls 时成本可能不同

---

## 七、其他模型

### `hailuo-02` — Hailuo 02
- 模型：`hailuo-02`（768P/512P，≤10s）、`hailuo-02-pro`（1080P，6s）
- 文生 + 图生；可选 Prompt Optimizer；图生可指定尾帧

### `hailuo-2-3` — Hailuo 2.3
- 模型：`hailuo-2.3`，文生 + 可选首帧引导
- **必填**：`prompt`
- **可选**：`duration` 6/10（默认 6）、`resolution` 768p/1080p（默认 768p，1080p 仅 duration=6）、`start_image_url`、`prompt_optimizer`
- 不支持 end_image_url

### `happy-horse` — 阿里 Happy Horse 1.0
- 模型：`happy-horse`（单 ID 支持四工作流）
- **文生**：仅 prompt + aspect_ratio/resolution/duration
- **图生**：`image_urls` 单张作首帧，prompt 可选
- **参考生**：`reference_image_urls`（1-9 张）+ prompt 必填，prompt 中按序引用 `character1`/`character2`…（勿与 image_urls 同用）
- **视频编辑**：`video_url` + 编辑 prompt 必填；可选 `reference_image_urls`（引用 `@Image1`）；`audio_setting`(auto/origin)；源视频 3-60s，计费按探测时长封顶 15s
- 通用可选：`resolution` 720p/1080p(默认)、`duration` 3-15(编辑模式忽略)、`seed`、`enable_safety_checker`

### `grok-imagine` — Grok Imagine
- 模型：`grok-imagine`，文生 + 图生
- **风格**：fun / normal / spicy
- **画幅**：1:1 / 2:3 / 3:2 / 16:9 / 9:16
- **时长**：6s / 10s

### `runway-gen-4-5` — Runway Gen-4.5
- 模型：`runway-gen-4.5`，文生 + 可选单图引导
- **必填**：`prompt`
- **可选**：`duration` 5/10（默认 5）、`aspect_ratio` 16:9/9:16/4:3/3:4/1:1/21:9、`image_urls`（≤1 张）、`seed`

---

## 八、模型速查表

| 家族 | 模型 ID | 模式 | 时长 | 最高分辨率 | 音频 |
|------|---------|------|------|-----------|:---:|
| Sora | sora-2 / -private | T2V, I2V | 10/15s | HD | - |
| Sora | sora-2-pro / -private | T2V, I2V | 15/25s | HD | - |
| Sora | sora-2-official | T2V(+1图) | 4-20s | - | - |
| Sora | sora-2-pro-official | T2V, I2V | 4-20s | 1080p | - |
| VEO | veo3.1-fast/lite/quality | T2V(+I2V) | 8s | 4k | - |
| VEO | veo3.1-*-official | T2V/I2V/首尾/参考 | 4-8s | 4k | ✅(sound) |
| Kling | kling-2.1/standard/pro | I2V | 5/10s | - | - |
| Kling | kling-2.5-turbo-pro | T2V(+首尾) | 5/10s | - | - |
| Kling | kling-2.6 | T2V, I2V | 5/10s | - | ✅原生 |
| Kling | kling-2.6-motion-control | 动作迁移 | ≤10/30s | 1080p | - |
| Kling | kling-3.0/standard/pro | T2V, I2V | 3-15s | 1080p/2K | ✅ |
| Kling | kling-3.0/4K | T2V, I2V | 3-15s | 4K | ✅ |
| Kling | kling-3.0-motion-control | 动作迁移 | ≤10/30s | 1080p | - |
| Kling | kling-o3/standard/pro | T2V/I2V/参考 | - | - | ✅ |
| Kling | kling-o3/4K | T2V/I2V/参考 | - | 4K | ✅ |
| Kling | kling-avatar-2.0/standard/pro | 音频驱动数字人 | 2-60s(音频) | - | 驱动音频 |
| Wan | wan2.6-t2v/i2v/v2v | T2V/I2V/V2V | 5-15s | 1080p | - |
| Wan | wan2.7-t2v/i2v/ref/edit | 四模式 | 2-15s | 1080p | ✅(audio_url) |
| Wan | wan-animate-replace/move | 角色动画/替换 | - | 720p | - |
| Wan | wan2.2-i2v-fast | I2V | - | 720p | - |
| Wan | wan2.2-t2v-fast | T2V | - | 720p | - |
| Wan | wan2.5-image-to-video | I2V | 5/10s | 1080p | ✅ |
| Wan | wan2.5-text-to-video | T2V | 5/10s | 1080p | ✅ |
| Seedance | seedance-1.0-pro | T2V, I2V | 5/10s | 1080p | - |
| Seedance | seedance-1.5-pro | T2V, I2V | 自定义 | 1080p | ✅ |
| Seedance | seedance-2 / -fast | T2V/首尾/参考 | 4-15s | 1080p / 720p | ✅ |
| Hailuo | hailuo-02 / -pro | T2V, I2V | 6/10s / 6s | 768P / 1080P | - |
| Hailuo | hailuo-2.3 | T2V(+首帧) | 6/10s | 1080p | - |
| 其他 | happy-horse | 四工作流 | 3-15s | 1080p | ✅(edit) |
| 其他 | grok-imagine | T2V, I2V | 6/10s | - | - |
| 其他 | runway-gen-4.5 | T2V(+1图) | 5/10s | - | - |

> T2V=文生视频，I2V=图生视频，V2V=视频生视频。

---

## 九、通用请求示例

```bash
curl -X POST https://api.poyo.ai/api/generate/submit \
  -H "Authorization: Bearer $POYO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kling-2.6",
    "callback_url": "https://your-domain.com/callback",
    "input": {
      "prompt": "A cinematic shot of a city at night, neon lights",
      "duration": 10,
      "aspect_ratio": "16:9"
    }
  }'
```

查询结果：

```bash
curl -X GET https://api.poyo.ai/api/generate/status/{task_id} \
  -H "Authorization: Bearer $POYO_API_KEY"
```

`finished` 后从 `data.files[].file_url`（`file_type: video`）获取视频地址。

---

## 十、相关链接

- 视频模型概览：https://docs.poyo.ai/api-manual/overview
- 模型列表 / Playground：https://poyo.ai/models
- 价格：https://poyo.ai/pricing
