# PoYo AI 音乐生成 API 完整文档

> 来源：PoYo AI 官方文档（`docs.poyo.ai/api-manual/music-series`）
> 整理日期：2026-05-31

---

## 一、通用约定

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://api.poyo.ai` |
| **提交端点** | `POST /api/generate/submit`（几乎所有音乐接口共用） |
| **结果查询** | `GET /api/generate/detail/music`（Suno 系列）<br>`GET /api/generate/status/{task_id}`（minimax / elevenlabs 等"标准任务"系列） |
| **认证头** | `Authorization: Bearer <YOUR_API_KEY>` |
| **请求结构** | `{ "model": "<模型名>", "callback_url": "...", "input": { ...参数 } }` |
| **异步流程** | 提交返回 `task_id` → 轮询查询 或 配置 `callback_url` 回调 |
| **任务状态** | `not_started`（排队）→ `running`（生成中）→ `finished`（完成，结果在 `files`）/ `failed`（失败，详见 `error_message`） |

> ⚠️ 安全提示：API Key 切勿暴露在前端 / 移动端 / 公开仓库。支持每密钥限流（小时 / 天 / 总量）和 IP 白名单。

---

## 二、接口清单（20 个）

### 🎵 1. 核心音乐生成

#### `generate-music` — 生成音乐

- 根据文本提示生成音乐，每次返回**多个变体**。
- **Custom 模式**（`custom_mode: true`）：
  - `instrumental: true` → 必填 `style`、`title`
  - `instrumental: false` → 必填 `style`、`prompt`、`title`
- **简单模式**（`custom_mode: false`，**新用户推荐**）：仅 `prompt`（≤500 字符），其余留空。
- **字符限制（按模型 `mv`）**：

  | 模型 | prompt | style |
  |------|--------|-------|
  | V4 | 3000 | 200 |
  | V4_5 / V4_5PLUS / V4_5ALL / V5 / V5_5 | 5000 | 1000 |

- **可选参数**：`vocal_gender`（`m`/`f`，仅 custom 模式生效，仅提升概率不保证）、`style_weight`（0-1）、`weirdness_constraint`（0-1，创意偏离度）、`audio_weight`（0-1）、`persona_id`（仅 custom 模式）。

**请求示例（custom 模式）**：

```json
{
  "model": "generate-music",
  "callback_url": "https://your-domain.com/callback",
  "input": {
    "prompt": "A calm and relaxing piano track with soft melodies",
    "style": "Classical",
    "title": "Peaceful Piano Meditation",
    "custom_mode": true,
    "instrumental": true,
    "mv": "V5_5",
    "negative_tags": "Heavy Metal, Upbeat Drums",
    "style_weight": 0.65
  }
}
```

**请求示例（简单模式）**：

```json
{
  "model": "generate-music",
  "callback_url": "https://your-domain.com/callback",
  "input": {
    "prompt": "Write a song about summer love and beach sunsets",
    "custom_mode": false,
    "instrumental": false,
    "mv": "V4"
  }
}
```

**curl 调用示例**：

```bash
curl -X POST https://api.poyo.ai/api/generate/submit \
  -H "Authorization: Bearer $POYO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "generate-music",
    "input": {
      "prompt": "Epic orchestral soundtrack for a fantasy adventure",
      "style": "Cinematic, Orchestral",
      "title": "Dragon'\''s Journey",
      "custom_mode": true,
      "instrumental": true,
      "mv": "V4_5PLUS"
    }
  }'
```

#### `minimax-music-2.6` — MiniMax Music 2.6

- 从风格提示生成完整曲目（含演唱、伴奏、编曲）。结果通过 **标准任务状态接口**查询（非 music detail）。
- `prompt`（必填，10-2000 字符）；`lyrics`（≤3500 字符）；`lyrics_optimizer`（true 时自动生成歌词）；`is_instrumental`（纯器乐）；`audio_setting`（`sample_rate`/`bitrate`/`format` 三键）。
  - `sample_rate`：16000 / 24000 / 32000 / 44100
  - `bitrate`：32000 / 64000 / 128000 / 256000
  - `format`：mp3 / wav / pcm
- ⚠️ 三者（`lyrics` / `lyrics_optimizer` / `is_instrumental`）需至少满足一种，否则校验报错。若上游拒绝优化歌词请求，则改用显式 `lyrics` 重试。

---

### 📝 2. 歌词相关

| 接口 | 功能 | 关键参数 | 返回 |
|------|------|---------|------|
| `generate-lyrics` | AI 生成歌词 | `prompt`（必填，≤200 词，描述主题/情绪/风格） | `title` + `text` |
| `get-timestamped-lyrics` | 获取带时间戳的同步歌词（卡拉OK / 字幕） | `task_id` + `audio_id`（必填）。**仅适用于含人声的曲目** | `aligned_words`(word/start_s/end_s/success/palign)、`waveform_data`、`hoot_cer`（字符错误率，越低越准）、`is_streamed` |
| `boost-music-style` | AI 增强 / 扩写风格描述 | `content`（必填，逗号分隔关键词：流派+情绪+乐器） | 增强后的 `style` |

---

### ✂️ 3. 编辑与扩展

| 接口 | 功能 | 关键参数 |
|------|------|---------|
| `extend-music` | 从指定时间点续写已生成曲目 | Custom(`default_param_flag: true`)：`prompt`/`style`/`title`/`continue_at` 必填；Simple(`false`)：仅 `audio_id` + `mv` |
| `replace-section` | 替换曲目指定时间段 | `task_id`/`audio_id`/`prompt`/`tags`/`title`/`infill_start_s`/`infill_end_s` 必填（end 须 > start）。可选 `full_lyrics` 保持整体歌词一致 |
| `upload-and-cover-audio` | 翻唱：保留原旋律换新风格 | `upload_url`（≤8 分钟，V4_5ALL ≤1 分钟）。Custom 必填 `style`/`title`，instrumental=false 时加 `prompt` |
| `upload-and-extend-audio` | 扩展上传的音频，保留原风格 | `upload_url`（≤8 分钟）。`default_param_flag: false`（推荐）仅需 `upload_url`，自动生成歌词 |
| `add-instrumental` | 为上传音频生成伴奏 | `upload_url`/`title`/`tags`/`negative_tags`。模型：V5_5 / V5 / V4_5PLUS(默认) |
| `add-vocals` | 为器乐叠加 AI 人声 | `upload_url`/`prompt`(兼作歌词)/`title`/`style`/`negative_tags`。模型同上 |

**字符限制（编辑类接口，按模型）**：

| 模型 | prompt | style | title |
|------|--------|-------|-------|
| V4 | 3000 | 200 | 80 |
| V4_5 / V4_5PLUS | 5000 | 1000 | 100 |
| V4_5ALL | 5000 | 1000 | 80 |
| V5 / V5_5 | 5000 | 1000 | 100 |

> 通用可选参数（多数编辑接口共有）：`negative_tags`、`vocal_gender`、`style_weight`、`weirdness_constraint`、`audio_weight`、`persona_id`。

---

### 🎤 4. 人声 / 乐器分离（Vocal Remover）

| 接口 | 是否支持上传 | 分轨数 | 说明 |
|------|:---:|:---:|------|
| `separate-vocals` | ❌ | 2 轨 | 基于 Suno，输出 `vocal_url` + `instrumental_url` |
| `stem-split` | ❌ | 12 轨 | 基于 Suno，输出 backing_vocals / bass / brass / drums / fx / guitar / keyboard / percussion / strings / synth / vocal / woodwinds |
| `upload-and-separate-vocals` | ✅ | 7 轨 | 输出 bass / drums / piano / guitar / vocals / other |

- `separate-vocals` / `stem-split`：需 `task_id` + `audio_id`，每条音轨仅能分离一次。
- `upload-and-separate-vocals` 参数：
  - `audio_url`（必填）
  - `title`（可选）
  - `model_name`（可选，默认 `base`）：`base` 标准 / `enhanced` 高精度 / `instrumental` 器乐优化
  - `output_type`（可选，默认 `general`）：`general` 全部 / `bass` / `drums` / `other` / `piano` / `guitar` / `vocals`
- 分离得到的 `task_id` 可用于 **Generate MIDI**。

---

### 🛠️ 5. 衍生工具

| 接口 | 功能 | 关键参数 | 备注 |
|------|------|---------|------|
| `generate-persona` | 从音轨提取可复用"音乐人格" | `task_id`/`audio_id`/`name`/`description` 必填 | 返回 `persona_id`，可用于 generate / extend / upload-cover / upload-extend。每轨限一次（重复返回 409） |
| `generate-music-cover` | 生成封面图 | `task_id` 必填 | 每个原任务限一次 |
| `create-music-video` | 从音轨生成可视化 MP4 | `task_id`/`audio_id` 必填，可选 `author`/`domain_name`（水印，≤50 字符） | 每轨限一个视频（重复返回 409） |
| `convert-to-wav` | 转无损 WAV | `task_id`/`audio_id` 必填 | 每轨仅能转一次；WAV 体积大，注意存储 |
| `generate-midi` | 从已分离的音轨生成 MIDI | `input.task_id`（来自 vocal separation 任务） | model 名 `generate-midi` |
| `elevenlabs-v3-tts` | 文本转语音（TTS） | `text`(1-5000 字符) 必填；可选 `voice` / `stability` / `timestamps` / `language_code` / `apply_text_normalization` | **走标准任务状态接口**；计费 16 credits / 1000 字符 |

**`elevenlabs-v3-tts` 可用 voice**：Aria, Roger, Sarah, Laura, Charlie, George, Callum, River, Liam, Charlotte, Alice, Matilda, Will, Jessica, Eric, Chris, Brian, Daniel, Lily, Bill, Rachel

- `stability`：0-1 之间的声音稳定度
- `timestamps`：true 时额外返回 `timestamps.json`（`file_type: other`）
- `apply_text_normalization`：`auto` / `on` / `off`
- 成功响应中语音文件 `file_type: audio`

**`generate-midi` 请求示例**：

```json
{
  "model": "generate-midi",
  "callback_url": "https://your-domain.com/callback",
  "input": {
    "task_id": "5c79xxxxbe8e"
  }
}
```

---

## 三、结果查询与回调

### Query Music Detail（`GET /api/generate/detail/music`）

- 参数：`task_id`。轮询直到 `status: finished`，`files` 才有内容。
- **不同模型返回字段不同**：

| 模型 | 字段 | 类型 | 说明 |
|------|------|------|------|
| generate-music / extend-music / upload-and-cover-audio / upload-and-extend-audio / add-instrumental / add-vocals / replace-section | `audio_id` | string | 音频唯一标识 |
| 同上 | `audio_url` | string | 音频下载 URL |
| 同上 | `image_url` | string | 封面图 URL |
| 同上 | `title` | string | 曲目标题 |
| 同上 | `tags` | string | 风格标签 |
| 同上 | `duration` | number | 时长（秒） |
| 同上 | `prompt` | string | 使用的生成提示 |
| minimax-music-2.6 | `audio_id` / `audio_url` / `title` / `duration` / `prompt` | - | 同上含义 |
| get-timestamped-lyrics | `timestampe_lyrics` | string | 带时间戳歌词 |
| generate-lyrics | `title` / `text` | string | 歌词标题 / 内容 |
| boost-music-style | `style` | string | 增强后的风格 |
| convert-to-wav | `wav_url` | string | WAV 文件 URL |
| separate-vocals | `separate_vocals` | string(JSON) | 含 `vocal_url` / `instrumental_url` |
| upload-and-separate-vocals | `vocal_removal` | string(JSON) | 含 bass/drums/piano/guitar/vocals/other |
| stem-split | `stem_split` | string(JSON) | 含 12 类乐器 URL |
| generate-music-cover | `generate_cover` | string(JSON 数组) | 封面图对象（file_url / file_type） |
| generate-persona | `persona_id` | string | 生成的人格 ID |
| create-music-video | `video_url` | string | 生成的视频 URL |

**成功回调 / 查询示例**：

```json
{
  "task_id": "8FDN1I7M7Q68DDG8",
  "status": "finished",
  "files": [
    {
      "audio_id": "62e4542a-73be-44e1-b397-7716ee7505c6",
      "audio_url": "https://storage.poyo.ai/audio/8FDN1I7M7Q68DDG8/audio_62e4542a.mp3",
      "image_url": "https://storage.poyo.ai/audio/8FDN1I7M7Q68DDG8/cover_62e4542a.jpeg",
      "title": "Peaceful Piano Meditation",
      "tags": "Classical",
      "duration": 240.0,
      "prompt": ""
    }
  ],
  "created_time": "2025-11-25T08:50:13",
  "error_message": null
}
```

**失败示例**：

```json
{
  "task_id": "8FDN1I7M7Q68DDG8",
  "status": "failed",
  "files": [],
  "created_time": "2025-11-25T08:50:13",
  "error_message": "The prompt violates our content policy"
}
```

### Music Webhook（回调）

- 提交时带 `callback_url`，任务 `finished` / `failed` 时 POST 推送（结构同 detail，但无外层 `code` / `data` 包裹）。
- **回调端点要求**：
  - HTTPS（不支持 HTTP）
  - URL ≤ 2048 字符
  - 10 秒内响应
  - 返回 HTTP 2xx
  - 禁用私网 / 内网 IP（如 192.168.x.x、10.x.x.x）
  - 需公网可达
- **重试策略**：失败重试 3 次（间隔 1s / 2s / 4s）；全部失败仍可轮询 detail 兜底。
- **最佳实践**：签名验签、幂等处理、异步处理后快速返回 200、记录日志。

---

## 四、要点速记

1. **两套查询体系**：Suno 系列用 `GET /api/generate/detail/music`；MiniMax / ElevenLabs 用 `GET /api/generate/status/{task_id}`。
2. **新手起步**：`generate-music` 用 `custom_mode: false` 最简单。
3. **模型版本**：V4 / V4_5 / V4_5PLUS / V4_5ALL / V5 / V5_5（V4_5ALL 上传音频限 1 分钟，其余 8 分钟）。
4. **一次性操作**：封面、音乐视频、WAV、Persona、分离 —— 每条音轨 / 任务通常只能执行一次（重复多返回 409）。
5. `vocal_gender` 只提升概率，**不保证**性别。
6. **价格**：通常比官方 API 低 30%-50%，部分高达 80%，以官网 pricing 页为准。

---

## 五、相关链接

- 模型列表：https://poyo.ai/models
- 价格：https://poyo.ai/pricing
- API Key 管理：https://poyo.ai/dashboard/api-key
- 任务历史：https://poyo.ai/dashboard/history
- 文档：https://docs.poyo.ai/api-manual/overview
