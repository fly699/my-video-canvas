# 节点精修方案：图像 / 视频 / 脚本+AI 助手（模型对齐 + 扩充 + 分类选择器）

> 分支：`claude/trusting-galileo-arfB4`
> 实施顺序：① 图像节点 → ② 视频节点 → ③ 脚本 + AI 助手节点
> 交付方式：本文件审批后，连续实现，每步 `pnpm check` + `build` + puppeteer 点击测试 + 提交。
> **范围：所有候选模型全部接入（不再勾选筛选）**——下方候选表全部 `[x]`。
> 成本来源（双源）：
> - **Poyo 模型** → 以 `docs/poyo-credits-pricing.md`（官方文档，2026-05-31）为**唯一权威**。**1 credit = $0.005**，失败不扣费。
> - **Higgsfield 模型** → 以 Higgsfield MCP（`models_explore` / `show_plans_and_credits`）为准（见附录 A）。

---

## 0. 全局原则与请你确认的点

- **「高 + 次高两档」**：同一模型家族（同名多版本/多档次）默认只保留**最高 + 次高**两档，砍掉更低版本。下方候选表已按此原则**预勾推荐项 `[x]`**，你可增删。
- **候选表按 credits 成本升序排列**（便于按预算挑选）。成本未公开的标「模型页」。
- **向后兼容硬约束**：已落库的 `model` / `provider` 字符串值（如 `poyo_sdxl`、`poyo_veo`、`hf_dop_standard`）**只增不删**，被砍模型仅 UI 隐藏、枚举与映射保留为 alias，旧节点不损坏。
- **wire 名核对**：新增模型的上游 model string 以官方文档/价格表为准；标「待核」者实现时再确认确切字符串。

### 已确认（4 项，2026-05-31）

1. **视频枚举粒度**：✅ **族级 + 子参数下拉**（枚举稳定）。
2. **kling-o3 三档**：✅ **保留 std/pro/4k 全部 + 加 kling-3.0**（不删枚举）。
3. **claude 型号**：✅ **对齐官方 `claude-sonnet-4-5-20250929` + 保留旧 `claude-sonnet-4-6` 作 alias**。
4. **图像参数架构**：✅ **引入 ParamDef**（schema 驱动，抽共享 lib）。

---

## ① 图像节点（ImageGenNode + StoryboardNode，共用 `IMAGE_MODELS`）

### 候选清单（按 credits 升序，请勾选）

模式：T2I 文生图 / I2I 图生图·编辑 / Ref 参考图。`[已接]` = 当前代码已接入。

| 勾选 | family | 官方 model（wire） | 模式 | 关键能力 | credits 成本 | 推荐理由 |
|---|---|---|---|---|---|---|
| `[x]` | Manus | (内置 Forge) | T2I | 内置·稳定·离线兜底 | **0**（不走外部） | 零成本默认，无 key 也可用 |
| `[x]` | Nano | `nano-banana` | T2I/I2I | 预算款·写实 | 5 cr ($0.025) | 同族砍（留 pro+2） |
| `[x]` | Seedream | `seedream-5.0-lite` | T2I/I2I | 视觉推理·指令编辑 | 5 cr ($0.025) | 次高档·性价比 |
| `[x]` | Z | `z-image` | T2I | 超快·风格化 | 模型页（低） | 批量草图可选 |
| `[x]` | GPT | `gpt-image-2` 1K | T2I/I2I | 文字渲染·编辑 | 起 2 cr ×(1K1x/2K2x/4K4x) | [已接] 见 GPT 裁定 |
| `[x]` | Seedream | `seedream-4.5` | T2I/I2I | 4K·精确控制 | 10 cr ($0.05) | [已接 poyo_seedream] 最高+次高之「次高」 |
| `[x]` | Nano | `nano-banana-2` | T2I/I2I | 快·4K·写实 | 模型页（中） | 次高档·性价比主力 |
| `[x]` | Nano | `nano-banana-pro` | T2I/I2I | 文字/图表·4K·多比例 | 模型页（中-高） | 顶级通用·最高档 |
| `[x]` | Flux | `flux-2-flex` | T2I | 快速·多风格 | 模型页（低-中） | [已接 poyo_sdxl] flux-2 两档全留 |
| `[x]` | Flux | `flux-2-pro` | T2I/I2I | 高质量·写实 | 模型页（中） | [已接 poyo_flux] flux-2 两档全留 |
| `[x]` | GPT | `gpt-image-2` | T2I/I2I | 4K·文字渲染 | 起 2 cr × 倍率 | [已接 poyo_gpt_image] GPT 系列最高档 |
| `[x]` | GPT | `gpt-image-1.5` | T2I/I2I | 最佳文字/logo/信息图 | 模型页（中） | GPT 次高档（可选） |
| `[x]` | Grok | `grok-imagine-image` | T2I/I2I | 高对比·表现力 | 模型页（中） | [已接 poyo_grok_image] 单款 |
| `[x]` | Wan | `wan-2.7-image` | T2I | 思考式生成 | 模型页（中） | [已接 poyo_wan_image] 单款 |
| `[x]` | Kling | `kling-o1-image` | T2I/I2I | 写实·21:9 超宽 | 分辨率×n（模型页） | Kling 图像次高（可选） |
| `[x]` | Kling | `kling-o3-image` | T2I/I2I | 分辨率×n·编辑 | 分辨率×n（模型页） | Kling 图像最高档 |
| `[x]` | Flux-Kontext | `flux-kontext-max` | I2I | 上下文编辑·排版 | 模型页（中-高） | [已接 hf_flux_pro] kontext 最高 |
| `[x]` | Flux-Kontext | `flux-kontext-pro` | I2I | 上下文编辑 | 模型页（中） | kontext 次高（可选） |
| `[x]` | Higgsfield | `higgsfield-ai/soul/standard` | T2I/Ref | UGC·角色一致·电影级 | (HF 计费) | [已接 hf_soul_standard] 保留 |
| `[x]` | Higgsfield | `bytedance/seedream/v4/...` | T2I/I2I | 4K | (HF 计费) | [已接 hf_seedream_v4] 保留 |
| `[x]` | Higgsfield | `reve/text-to-image` | T2I | 通用·快速 | (HF 计费) | [已接 hf_reve] 评估保留 |

#### 逐族「高+次高」裁定
- **Nano**：留 `nano-banana-pro` + `nano-banana-2`，砍 `nano-banana`。
- **GPT**：留 `gpt-image-2`（已接）+ `gpt-image-1.5`（次高，可选），砍 `gpt-4o-image`。
- **Flux-2**：`pro` + `flex` 两档全留（已接）。
- **Flux-Kontext**：留 `max`（已接 HF）+ `pro`（次高，可选）。
- **Seedream（Poyo）**：留 `seedream-5.0-lite` + `seedream-4.5`（已接），砍 `seedream-4`。
- **Kling 图像**：留 `kling-o3-image` + `kling-o1-image`（次高，可选）。
- 单款：`z-image` / `grok-imagine-image` / `wan-2.7-image` 直接收。

### 前后端改动点（图像）
- `shared/types.ts` L215 `ImageGenModel` union 增值。
- `client/src/lib/models.ts` `IMAGE_MODELS` 增条目 + 新增 `family`/`provider`/`caps`/`cost` 字段（`cost` 用于选择器成本标签）。
- `server/routers/canvas.ts` L746 `imageGen.generate` 的 Zod `model` enum 增值；新参数（`n`/`outputFormat`/`size`/`resolution`/`imageUrls`）加 optional。
- `server/_core/imageGeneration.ts` L196-245 Poyo 分支增 value→wire 映射 + 参数透传。
- `server/_core/higgsfield.ts` HF 图像维持现状（除非勾选新 HF 模型）。

### UI 分类选择器（图像）
- 统一改用共享 `ModelPicker`（见 ④），替换 ImageGenNode 原生 `<select>` 与 StoryboardNode 自定义下拉。
- 一级按 **provider**（Manus/Poyo/Higgsfield），组内按 family；每条目右侧显示**成本标签**（如 `≈10 cr`，低绿/高橙）。

### 参数控件（图像）
- **推荐**：抽 `client/src/lib/paramDefs.ts`（与视频共享 `ParamDef` + `renderParamControl`），图像改 schema 驱动渲染，停止 `isSoul/isReveLike/isPoyo` 条件爆炸。旧 payload key（`poyoQuality`/`widthAndHeight`/`reveAspectRatio`/`reveResolution` 等）保留为 ParamDef key，零数据迁移。

### 验证（图像）
- `pnpm check`（types/Zod/imageGeneration 三处枚举一致）+ `pnpm build`。
- puppeteer dev bypass：打开 ImageGenNode + StoryboardNode → ModelPicker 分组与成本标签渲染 → 切新模型断言参数控件正确 → 0 JS 错误。真实生成需 key，仅声明。

---

## ② 视频节点（VideoTaskNode）

### 候选清单（按 credits/秒 升序，请勾选）

模式：T2V / I2V / S·E 首尾帧 / Ref 多参考。

| 勾选 | family | 官方 model（wire） | 模式 | 关键能力 | credits 成本 | 推荐理由 |
|---|---|---|---|---|---|---|
| `[x]` | Kling | `kling-2.6-motion-control` | I2V | 运动迁移 | 720p 8 / 1080p 12 cr/s | 特殊用途（可选） |
| `[x]` | Kling | `kling-o3-standard` | I2V | 影院运动 | 10 / 13(音) cr/s | [已接 poyo_kling_o3_std] |
| `[x]` | Seedance | `seedance-2`(含视频输入) | I2V/Ref/S·E | 480p 身份一致 | 480p 10 / 720p 20 / 1080p 45 cr/s | [已接 poyo_seedance] 旗舰 |
| `[x]` | Sora | `sora-2`/`sora-2-official` | T2V/I2V | 音频·影院 | 12 cr/s ($0.06) | 次高档 |
| `[x]` | Wan | `wan-2.7-video` | I2V/S·E/Ref | 音频同步·角色一致 | 720p 12 / 1080p 18 cr/s | Wan 最高档 |
| `[x]` | Kling | `kling-o3-pro` | I2V | 影院运动·pro | 13 / 16(音) cr/s | [已接 poyo_kling_o3_pro] |
| `[x]` | Kling | `kling-2.6` | I2V | 物理·音频 | 无音 65/130 · 有音 120/240（5/10s，≈13-24 cr/s） | [已接 poyo_kling26] |
| `[x]` | Kling | `kling-3.0` | I2V/S·E | 音频同步·多镜头·运动迁移 | 模型页（4K 50 cr/s） | Kling 主线最高档 |
| `[x]` | Seedance | `seedance-2`(无视频输入) | I2V/Ref | 高质量 | 480p 20 / 720p 40 / 1080p 90 cr/s | [已接] 同模型不同档 |
| `[x]` | Veo | `veo-3.1`(quality) | I2V | 8s·音频·影院级 | 模型页（高） | [已接 poyo_veo] Veo 最高档 |
| `[x]` | Veo | `veo-3.1`(fast) | I2V/S·E | 720-1080p·预算批量 | 模型页（中，lite/fast 更低） | Veo 次高档 |
| `[x]` | Veo | `veo-3.1`(lite) | I2V | 预算 | 模型页（低） | 同族砍（留 quality+fast） |
| `[x]` | Hailuo | `hailuo-2.3` | I2V/S·E | 自然物理·面部情绪 | 模型页（中） | Hailuo 最高档 |
| `[x]` | Hailuo | `hailuo-02` | I2V | 物理 | 模型页 | Hailuo 次高（可选） |
| `[x]` | Wan | `wan-2.6`(t2v/i2v) | T2V/I2V | 风格化 | 模型页（中） | [已接 poyo_wan25_t2v/i2v] Wan 次高 |
| `[x]` | Grok | `grok-imagine`(video) | T2V/I2V | 文+图生视频 | 模型页（中） | 唯一纯 T2V，建议补 |
| `[x]` | Runway | `runway-gen-4.5` | I2V/T2V | 现有接入 | 模型页（中-高） | [已接 poyo_runway45] |
| `[x]` | Sora | `sora-2-pro` | T2V/I2V | ≤25s·1024p | 100 cr/次（定额，$0.50） | Sora 最高档 |
| `[x]` | Kling | `kling-o3-4k` | I2V | 4K | 50 cr/s ($0.25) | [已接 poyo_kling_o3_4k] |
| `[x]` | Higgsfield | `dop-preview`/`dop-turbo`/`dop-lite` | I2V(必填参考图) | HF 公共 API 唯一视频端点 | (HF 计费) | [已接 hf_dop_*] 保留 |
| `[x]` | Dev | `mock` | — | 测试 | 0 | [已接] 保留 |

#### 逐族「高+次高」裁定
- **Sora**：留 `sora-2-pro` + `sora-2`，砍 `sora-2-official`（同代变体）。
- **Veo3.1**：留 `quality`（已接）+ `fast`，砍 `lite`/`official`。
- **Kling 主线**：留 `kling-3.0` + `kling-2.6`（已接），砍 2.1/2.5；**o3 三档（std/pro/4k）见确认项 2**。
- **Wan**：留 `wan-2.7` + `wan-2.6`（已接），砍 2.5/2.2-fast/animate。
- **Seedance**：留 `seedance-2`（已接，含/不含视频输入两档计费），可选补 `seedance-1.5` 次高，砍 1.0。
- **Hailuo**：留 `hailuo-2.3` + 可选 `hailuo-02`。
- 单款：`grok-imagine` / `runway-gen-4.5` / `mock` / HF DoP 直接收。

### 前后端改动点（视频）
- `shared/types.ts` L30-44 `VIDEO_PROVIDERS` 增值（只增不删）。
- `server/routers/canvas.ts` L311 Zod 用 `z.enum([...VIDEO_PROVIDERS])`，随枚举自动扩展，无需手改。
- `server/_core/poyoVideo.ts` `PoyoVideoModel` union + `POYO_PROVIDER_MAP` + `submitPoyoVideo` 各模型 input 构造分支（sora 的 sound/duration、kling-3.0 的 sound/4k、wan-2.7 的 resolution、hailuo 的 duration/resolution）。
- `server/_core/higgsfield.ts` DoP 维持不动。
- `VideoTaskNode.tsx`：`PROVIDERS` 增条目（含 family/cost）；`PROVIDER_PARAMS` 加新模型 ParamDef；按需更新 `REQUIRES_REFERENCE_IMAGE` / `SUPPORTS_NEGATIVE_PROMPT`。

### UI 分类选择器（视频）
- 主选择器换共享 `ModelPicker`，**按 family 分组**（Sora/Veo/Kling/Wan/Seedance/Hailuo/Grok/Runway/Higgsfield/Dev），显示 provider 徽章 + 成本标签。
- **并行多 provider** 能力保留：主选择器换组件，并行多选维持现有 chips UI（控制改动面）。

### 参数控件（视频）
- 已有成熟 ParamDef，新模型按其范式加 `PROVIDER_PARAMS` 即可，无架构改动。Cinematography 运镜 / 预设系统不动。

### 验证（视频）
- `pnpm check`（`VIDEO_PROVIDERS` 与 `POYO_PROVIDER_MAP` key 一致）+ `pnpm build`。
- puppeteer：ModelPicker 按 family 分组 + 成本标签 → 切 sora-2-pro/kling-3.0/wan-2.7 断言参数控件 → 并行多选可用 → 0 JS 错误。

---

## ③ 脚本节点 ScriptNode + AI 助手 AIChatNode（LLM）

### 候选清单（LLM 按 token 计费，成本用相对档）

| 勾选 | family | id | 用途 | 成本档 |
|---|---|---|---|---|
| `[x]` | Gemini | `gemini-3-flash-preview` | 默认/快·最高 | 低 |
| `[x]` | Gemini | `gemini-2.5-flash` | 次高（保留兼容，现默认值） | 低 |
| `[x]` | Claude | `claude-sonnet-4-5-20250929` | 智能/脚本（对齐官方） | 中 |
| `[x]` | Claude | `claude-haiku-4-5-20251001` | 快速 | 低 |
| `[x]` | GPT | `gpt-5.2` | Poyo 路由 | 中 |
| `[~]` | Claude | `claude-sonnet-4-6` | 旧值 alias（仅兜底，见确认项 3） | — |

#### 裁定
- **Gemini**：留 `gemini-3-flash-preview`（最高）+ `gemini-2.5-flash`（次高，现默认值保留）。
- **Claude**：对齐官方 `claude-sonnet-4-5-20250929`；`claude-haiku-4-5` 保留为快速档；旧 `claude-sonnet-4-6` 至少留作 fallback id（防 ScriptNode 默认值失效）。
- **GPT**：留 `gpt-5.2`（走 Poyo）。

### 前后端改动点（LLM）
- **单一真源**：合并 `LLMModelPicker.tsx` 的 `LLM_MODELS`、`models.ts` 的 `CHAT_MODELS`、`server/_core/llm.ts` 的 `AVAILABLE_MODELS`（前端以 `models.ts` 为准；后端常量手工对齐，check 阶段核）。每项加 `family`/`provider`/`short`/`color`/`tag`。
- `llm.ts resolveApiUrl` L215-224 路由规则对新模型仍成立（GPT→Poyo，其余→Forge），无需改逻辑。
- `ScriptNode.tsx` `_validLlmModel` fallback 处理旧 `claude-sonnet-4-6`（映射到 4-5 或保留）。
- `AIChatNode.tsx` 内联 CHAT_MODELS 下拉换共享 `ModelPicker`。

### 流式 / thinking —— 分层（明确风险）
- **本轮纳入（低风险）**：模型清单对齐 + 三处单一真源 + 分类 ModelPicker。**不触碰 `llm.ts` 请求通道**。
- **本轮不纳入（较大改动，列后续立项）**：
  - **流式输出（SSE）**：当前仅一条非流式 `chat/completions`，10+ 调用方依赖完整 JSON；引入需新 SSE 通道 + 兼容工具调用/JSON Schema。架构级，风险高。
  - **Claude thinking / 原生接口（Responses / Messages / Gemini-Native）**：依赖上游透传能力未确认，后续立项。

### 验证（LLM）
- `pnpm check`（三处模型表一致 + `LLMModelId` 类型）+ `pnpm build`。
- puppeteer：ScriptNode + AIChatNode → ModelPicker 分组（Gemini/Claude/GPT）→ 切模型 payload 持久化 → 旧 `claude-sonnet-4-6` 节点仍正常 → 0 JS 错误。

---

## ④ 共享组件 `ModelPicker`（三步共用）

新建 `client/src/components/canvas/ModelPicker.tsx`，泛化现有 `LLMModelPicker` 的 createPortal + backdrop + 定位骨架。

```ts
interface ModelOption {
  value: string; label: string; desc?: string;
  group: string;          // 一级分组：provider 或 family
  family?: string;        // Sora/Veo/Kling/Flux/Nano/Gemini/Claude…
  provider?: "Poyo" | "Higgsfield" | "Manus" | "Forge";
  cost?: number;          // 代表性 credits（默认档），用于成本标签
  costLabel?: string;     // "≈10 cr" | "≈12 cr/s@1080p"
  caps?: string[];        // ["编辑","4K","参考图","音频"]
  short?: string; color?: string; tag?: string; // LLM 徽章
  hidden?: boolean;       // 被砍旧模型：不列出但能回显当前值
}
interface ModelPickerProps {
  kind: "image" | "video" | "llm";
  value: string; onChange: (v: string) => void;
  options: ModelOption[];
  groupBy?: "provider" | "family";   // image→provider, video/llm→family
  searchable?: boolean;              // image/video 开
  showCost?: boolean;                // 默认 true
  disabled?: boolean;
}
```

- **分组渲染**：按 `groupBy`，组内沿用数组静态顺序（**运行时不排序**——成本排序只用于本规划表的呈现）。
- **成本标签**：每条右侧显示 `costLabel`，低成本绿、高成本橙红（同余额仪表盘色系）。
- **当前值回显**：option `hidden` 或极旧值仍在触发器显示原值，防空白（继承现有 inert-option 行为）。
- **三步喂入**：`IMAGE_MODELS` / 视频 `PROVIDERS` / `CHAT_MODELS` 各自 join `cost` 后传入。`LLMModelPicker` 改薄封装或直接替换（保留导出名减少改动面）。

---

## ⑤ 实施节奏

1. 本文件勾选 + 4 项确认后冻结「最终清单」。
2. **第一步 图像**：抽 `paramDefs.ts` + 新建 `ModelPicker` → 扩 `IMAGE_MODELS`/类型/Zod/后端映射 → check+build+puppeteer+commit。
3. **第二步 视频**：扩 `VIDEO_PROVIDERS`/`POYO_PROVIDER_MAP`/`PROVIDER_PARAMS` + 换 ModelPicker → check+build+puppeteer+commit。
4. **第三步 LLM**：模型对齐 + 单一真源 + 换 ModelPicker（流式/thinking 不做）→ check+build+puppeteer+commit。

> 真实生成需 Poyo/Higgsfield API key，无 key 仅能验证 UI（选择器分类/成本标签/参数控件/0 JS 错误），端到端生成无法在本环境完成。

### 关键文件
- `client/src/lib/models.ts`、`client/src/lib/paramDefs.ts`(新)、`client/src/components/canvas/ModelPicker.tsx`(新)
- `shared/types.ts`、`server/routers/canvas.ts`
- `server/_core/imageGeneration.ts`、`server/_core/poyoVideo.ts`、`server/_core/higgsfield.ts`、`server/_core/llm.ts`
- `client/src/components/canvas/nodes/{ImageGenNode,StoryboardNode,VideoTaskNode,ScriptNode,AIChatNode}.tsx`、`LLMModelPicker.tsx`

---

## 附录 A：Higgsfield MCP 真实目录与参数 schema（`models_explore`，2026-05-31）

> 这是 Higgsfield 平台经 MCP 实拉的**权威模型 ID + 参数枚举**，用于实现期对齐参数控件与变体子参数。注意本应用线上同时走 **Poyo**（`poyoVideo.ts`/`imageGeneration.ts`，wire 名形如 `flux-2-pro`/`kling-2.6`）与 **Higgsfield**（`higgsfield.ts`），下列为 Higgsfield 侧口径；Poyo 侧 wire 名以 Poyo 文档为准，但**参数形态高度一致可复用**。

### A.1 图像目录（22 条）

| Higgsfield ID | 名称 | provider | 关键参数（实测） | aspect_ratios |
|---|---|---|---|---|
| `nano_banana_pro` | Nano Banana Pro | Google | resolution: 1k/2k/4k | 含 21:9 全比例 |
| `nano_banana_2` | Nano Banana 2 | Google | resolution: 1k/2k/4k | 含 21:9 |
| `nano_banana` | Nano Banana | Google | （无） | 含 21:9 |
| `seedream_v5_lite` | Seedream 5.0 lite | Bytedance | quality: basic/high | 1:1/16:9/9:16/4:3/3:4 |
| `seedream_v4_5` | Seedream 4.5 | Bytedance | quality: basic/high | 含 21:9 |
| `flux_2` | Flux 2.0 | Black Forest | **model: pro/flex/max** + resolution: 1k/2k | 5 档 |
| `flux_kontext` | Flux Kontext Max | Black Forest | （无，编辑） | 5 档 |
| `gpt_image_2` | GPT Image 2 | OpenAI | resolution: 1k/2k/4k + quality: low/medium/high | 7 档 |
| `gpt_image` | GPT Image 1.5 | OpenAI | quality: low/medium/high | 1:1/3:2/2:3/auto |
| `kling_omni_image` | Kling O1 Image | Kling | resolution: 1k/2k | 含 auto/21:9 |
| `grok_image` | Grok Imagine | xAI | mode: std/quality | 5 档 |
| `z_image` | Z Image | Tongyi-MAI | （无） | 5 档 |
| `soul_v2`/`soul_2` | Higgsfield Soul 2.0 | Higgsfield | quality: 1.5k/2k + soul_id | 7 档 |
| `soul_cinematic` | Soul Cinema | Higgsfield | quality: 1.5k/2k + soul_id | 含 21:9 |
| `cinematic_studio_2_5` | Cinema Studio Image 2.5 | Higgsfield | resolution: 1k/2k/4k | 5 档 |
| `soul_cast` | Soul Cast | Higgsfield | budget(默认50) | 16:9 |
| `soul_location` | Soul Location | Higgsfield | （无） | 含 21:9/9:21 |
| `marketing_studio_image` | Marketing Studio Image | Higgsfield | resolution: 1k/2k/4k | 全比例 |
| `ms_image` | DTC Ads | Higgsfield | style_id(必填)/brand_kit_id/resolution/quality/batch_size 1-20 | 多档 |
| `image_auto` | Auto | Higgsfield | （自动路由） | 5 档 |

> 要点：**Flux 2.0 在 Higgsfield 是单模型 + `model:pro/flex/max` 变体参数**（印证「族级+子参数」）；Poyo 侧则是 `flux-2-pro`/`flux-2-flex` 分立 wire。GPT Image 2 实测支持 1k/2k/4k×low/medium/high。Seedream 用 `quality:basic/high`（非 1K/2K/4K 字面）。

### A.2 视频目录（18 条）

| Higgsfield ID | 名称 | provider | 关键参数（实测） | 时长 | 参考图角色 |
|---|---|---|---|---|---|
| `seedance_2_0` / `video_standard` | Seedance 2.0 | Bytedance | resolution: 480/720/1080p + mode: std/fast + genre(7种) | 4-15s | image/start/end/video/audio |
| `seedance_1_5` | Seedance 1.5 Pro | Bytedance | resolution: 480/720/1080p | 4/8/12s | start/end |
| `kling3_0` | Kling 3.0 | Kling | **mode: std/pro/4k** + sound: on/off | 3-15s | start/end |
| `kling2_6` | Kling 2.6 | Kling | sound: bool(默认true) | 5/10s | start (max1) |
| `veo3_1` | Veo 3.1 | Google | **quality: basic/high/ultra** + model: preview/fast | 4/6/8s | start (max1) |
| `veo3_1_lite` | Veo 3.1 Lite | Google | resolution: 720/1080p + generate_audio | 4/6/8s | start/end |
| `veo3` | Veo 3 | Google | model: preview/fast | — | start(必填) |
| `minimax_hailuo` | Minimax Hailuo | Hailuo | **model: minimax/minimax-fast/minimax-2.3/minimax-2.3-fast** + resolution: 512/768/1080 | 6/10s | start/end(max2，2.3 仅 start) |
| `wan2_7` | Wan 2.7 | Wan | resolution: 720/1080p | 2-15s | start/end/audio |
| `wan2_6` | Wan 2.6 | Wan | quality: 720/1080p | 5/10/15s | image(必填) |
| `grok_video` | Grok Imagine | xAI | （无） | 1-15s | start |
| `cinematic_studio_3_0` | Cinema Studio Video 3.0 | Higgsfield | （无） | 4-15s | image/start/end |
| `cinematic_studio_video` | Cinema Studio Video | Higgsfield | slow_motion + sound | 5/10s | image/start/end |
| `cinematic_studio_video_v2` | Cinema Studio Video v2 | Higgsfield | genre(8种) + mode: pro/std | 3-12s | image/start/end |
| `marketing_studio_video` | Marketing Studio | Higgsfield | resolution: 480/720/1080p + generate_audio + hook/setting/ad_reference | 4-15s | avatars + image/start/end |
| `higgsfield_preset` | Higgsfield Preset | Higgsfield | preset_id(必填，见 presets_show) | — | image(必填) |

> 要点（强化「族级+子参数」决策）：
> - **Veo 3.1** = 单模型 + `quality: basic/high/ultra` + `model: preview/fast` 变体 → 对应「quality 档 + fast 档」无需分立 provider。
> - **Kling 3.0** = `mode: std/pro/4k` 子参数 → 一个 provider 覆盖三档，**与现有 kling-o3 三档分立形成对比**；实现时新 kling-3.0 走子参数，老 o3 三档保留兼容。
> - **Hailuo** = `model: minimax-2.3 / 2.3-fast / minimax / minimax-fast` 子参数 → hailuo-02 与 2.3 是同模型变体。
> - **Seedance 2.0** 参考图角色最全（image/start/end/video/audio），且有 `genre` 七档与 `mode: std/fast`。

### A.3 成本锚点（来自 `show_plans_and_credits`，Higgsfield ULTRA 3000cr/月）

- 3000 cr ≈ **12000 图 / 500 视频 / 100 角色生成** → 图均≈0.25cr、视频均≈6cr、角色≈30cr（混合均值）。
- **Nano Banana Pro ≈ 2 cr/张**；**Kling 3.0 ≈ 6 cr/条**（官方促销换算）。
- `modelCosts.ts` 落地时按上游分别标注 `source`；**成本仅 UI 展示，不参与计费**（实际扣费以账户余额为准，tooltip 标「≈」）。
