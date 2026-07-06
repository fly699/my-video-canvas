# 画布助手全链路对抗性核查报告（2026-07-06）

范围：画布助手（CanvasAgentChat）→ 规划（server/routers/agent.ts）→ 净化（server/_core/agentCatalog.ts）
→ 落地（client/src/lib/agentApply.ts）→ 节点输入输出传输 → 运行（useWorkflowRunner / 各 Node）
→ ComfyUI 特殊节点与模板。方法：4 路只读探查 + 人工代码级对抗复核。

更新（2026-07-06 二轮）：按要求通读 kie / Poyo 官方文档，将「负向提示词传输」(S3) 逐模型对照
官方 input schema 落实为**具体矩阵**（见下），并区分「API 支持却被丢弃」与「API 不支持却仍显示反向框」。

图例：🔴 已确认（代码级复核）｜🟠 强证据未逐行复核｜🔵 by-design / 可争议｜✅ 防御到位。

---

## 已修复（本轮已上线）

| PR | 问题 | 摘要 |
|---|---|---|
| #723 | 🔴 撤销误删既有节点（高危·数据丢失） | 撤销按钮据 `touchedIds`（含被 update/connect 的既有节点）无差别 deleteNode，会物理删除用户原有节点。改为只删本轮新建的 `createdIds` + 回归测试。 |
| #724 | 🔴 模板选单被面板裁切 | MiniSelect 菜单固定向上展开、被面板 overflow:hidden 裁。改为 portal 到 body + 按空间自动上/下展开。 |

---

## 待定夺（既有问题，用户已选「先出报告暂不改」）

### 提示词传输（已逐模型对照官方文档，2026-07-06 深化）

> 依据：`docs/poyo-image-api.md`（17 图像模型全文）、`docs/poyo-video-api.md`（31 视频模型全文）、
> `docs/kie-api.md`（逐 operationId 的 input schema）、`docs/incremental-models/…with-params.json`。

**🔴 S3 — 图像负向提示词处理错误：一部分 kie 模型「API 支持却被代码丢弃」，其余「API 不支持却仍显示反向框」**

图像负向提示词（negative_prompt）逐后端 / 逐模型核查结果：

| 后端 · 模型（应用 id） | 官方 API 是否支持 negative | 代码是否发送 | UI 是否显示反向框 | 结论 |
|---|:---:|:---:|:---:|---|
| Higgsfield：hf_soul_standard / hf_reve / hf_seedream_v4 / hf_flux_pro | ✅ 支持 | ✅ 发送（`imageGeneration.ts:312`） | 显示 | **正确** |
| kie：kie_imagen4 / kie_imagen4_fast / kie_imagen4_ultra | ✅ 支持（`kie-api.md` `google/imagen4[-fast/-ultra]` 的 `input.negative_prompt`，maxLength 5000） | ❌ **不发**（`kieImage.ts` 无 negative） | 显示 | **🔴 真丢参**——API 支持却没传 |
| kie：kie_ideogram_v3 | ✅ 支持（`ideogram/v3-text-to-image`） | ❌ 不发 | 显示 | **🔴 真丢参** |
| kie：kie_qwen_image / kie_qwen_image_i2i / kie_qwen_image_edit | ✅ 支持（`qwen/text-to-image`·`image-to-image`·`image-edit`） | ❌ 不发 | 显示 | **🔴 真丢参** |
| kie：nano-banana(±pro/2) / seedream(v4·4.5·5lite) / flux-2(pro·flex) / gpt-image(1.5·2) / z-image / grok / wan-2.7-image | ❌ 不支持（schema 未列 negative_prompt） | ❌ 不发 | 显示 | 🟠 UI 误导（框无效） |
| Poyo：全部 17 个图像模型（nano-banana / gpt-image / flux / seedream / wan / kling / z-image / grok 家族） | ❌ 不支持（`poyo-image-api.md` 全文无 negative_prompt） | ❌ 不发（`buildPoyoImageInput` 不含该字段） | 显示 | 🟠 UI 误导 |
| Forge：manus_forge | ❌ 不支持（私有 API，仅 `prompt`+`original_images`） | ❌ 不发 | 显示 | 🟠 UI 误导 |

- 根因一（真丢参）：`generateImageKie`（`kieImage.ts:173-194`）构造 `input` 时无 negative 分支；`GenerateImageOptions.negativePrompt` 仅在 `imageGeneration.ts:312` 的 Higgsfield 分支被消费。
- 根因二（UI 误导）：`ImageGenNode.tsx:829` **无条件**渲染「反向提示词」框、无 per-model 门控（对比视频节点做了门控，见下）。
- 建议修法（两步，待批）：
  1. 给 `KieImageSpec` 加 `negPrompt?: boolean`（仿 `kieVideo.ts` 的 `spec.negPrompt`），对 Imagen4 家族 / Ideogram V3 / Qwen 三系置 true，`generateImageKie` 里 `if (spec.negPrompt && options.negativePrompt?.trim()) input.negative_prompt = …` —— 恢复被丢的、API 明确支持的负向能力。
  2. image_gen 反向框按模型支持度显隐（仿 `VideoTaskNode` 的 `SUPPORTS_NEGATIVE_PROMPT`），对 Poyo / Forge / 无支持的 kie 模型不显示死框。

**✅ 对照：视频负向提示词——实现正确（应作为图像侧的范本）**
- 官方支持 negative 的视频模型：Poyo `kling-2.1` / `kling-2.5-turbo-pro` / `wan2.5-text-to-video` / `wan2.5-image-to-video`（`poyo-video-api.md:95/101/185/190`）；kie `kling-1.6`、`kling-v2-1-master`、`kling-v2-5-turbo`、`wan-2.5/2.7` 等（`kie-api.md`）。
- 代码正确：`poyoVideo.ts:301`、`kieVideo.ts:579` 均按 `spec.negPrompt` 发送 `negative_prompt`；`VideoTaskNode` 用 `SUPPORTS_NEGATIVE_PROMPT` 白名单**仅对支持的模型显示反向框**（`:1904`）、切换到不支持的模型时清空（`:224`）、发送时再门控（`:1199`）。图像侧应照此办理。

**🔴 D1 — comfyui 模板无 negative 绑定时 negPrompt 静默丢弃**（与 S3 独立的另一机制）
- 位置：`client/src/lib/agentApply.ts:18-22`（materializeTemplate 只写有绑定的 role）。
- 场景：Flux/CFG=1 类工作流（`analyzeWorkflow` 正胜负，`comfyui.ts:1636`）常无 negative 绑定 → 用户/AI 设的负向词消失、无兜底、无提示。positive 缺绑定同理。
- 判断：可争议（工作流本无 negative 槽时确实无处可放），但至少应给提示而非静默。

**🟠 S7 — 提示词多上游取值顺序与图像链不一致**
- 位置：`comfyWorkflowParams.ts:315` detectUpstreamPrompt 按原始 edges 顺序取首个非空；图像/视频/合并链用 `compareUpstreamNodes`（title 尾号→Y→连线序）。
- 场景：两个 prompt/storyboard 同时连入时，正向可能来自 A、负向来自 B（各自 `??=`），与用户按编号/位置的直觉不符。

### 「运行全部」runner 与逐节点路径分歧（🟠 强证据，未逐行复核）

**S1 — runner 对 video_task 丢负向词 + 不套参数默认**：`useWorkflowRunner.ts:494-507` 无 negativePrompt、`params:(p.params)||{}` 未过 `withParamDefaults` → 视频模型缺 resolution/aspect/duration 被上游拒但仍扣费，负向词被吞。逐节点路径两者都做（`VideoTaskNode.tsx:1199/1207`）。

**S2 — runner 对 image_gen/storyboard 静默换默认模型 + 丢比例/效果**：`useWorkflowRunner.ts:423-439` 用 9 模型白名单，其余置 undefined 走服务端默认模型；不发任何比例字段、不发效果注入/@图像/手动多参考。→ 同一节点「点按钮 vs 运行全部」出图模型与画幅都不同。

**S10 — runner 丢后处理效果词**：`injectCharacters` 不含 connectedEffectPrompts。

> 修法：让 runner 复用逐节点的 `composeSubmissionContext`/`buildStoryboardGenInput`/`withParamDefaults`，而非重实现。属较大重构，需充分真机验证。

### 参考图传输（🟠 强证据）

**D7/S5 — 参考图静默忽略**：`comfyui.ts:1026` IPAdapter 分支被 `arch==="sd"` 守卫，Flux/SD3/Qwen 选参考图既不建节点也不报错；`characterConditioning.ts:330` 不发 IPAdapter 模型，而服务端要求模型非空才应用（`comfyui.ts:1026`）→ 用户连了角色但锁脸没跑。ControlNet 同样受 `arch==="sd"` 守卫。

**🔴 S4 — 种子传播到 video_task 写错字段**：`ImageGenNode.tsx:275` 写 `payload.seed`，但 video_task 读 `payload.params.seed`（ParamDef）→ 传播 toast 成功、实际失效。仅 hf_soul→video 触发、价值低。

### 比例 / 分辨率

**🔵 S6 — 比例字段三套并存 + 无跨节点传播（by-design）**：image_gen 用 aspectRatio/poyoAspectRatio/reveAspectRatio 分族读，video_task 用 params.aspect_ratio；运行时不做上游→下游比例透传（下游各用自己的字段）。改分镜比例不影响其下游视频节点。属现设计，非崩溃。

**🔵 D6 — 无 8 倍数/偶数尺寸校验**：`canvas.ts:3277` width/height 仅 min64/max2048，手填 513 原样下发（SD3/视频 latent 可能报错）。比例换算的 /64 对齐只覆盖 aspect 覆盖路径。

### 规划净化 / 解析

**🟠 H1 — reply 泄漏截断 JSON**：`agent.ts` 兜底判据是 cleaned 含 `"operations":` 或 text 以 `` ` ``/`{` 开头才吞；若 LLM 输出散文前缀 + 在 `"operations"` 前被截断，半截 JSON 原样进聊天。

**🟠 H2 — 贪婪 JSON 匹配误杀**：`/\{[\s\S]*\}/` 匹配到最后一个 `}`；合法 JSON 后跟含 `}` 的散文会致整体 parse 失败 → 整批合法计划被丢、误报「结果过长」。

**🔵 M1/M2 — update 无字段类型/长度校验、customBaseUrl 放行**：sanitize 对 update 用全目录字段并集 + 显式放行 customBaseUrl，值零校验透传。经官方客户端有 agentApply 兜底；直连 tRPC 无兜底。

**🔵 M3 — 成环 / tempId 重复未拦**：仅拦 self-loop，不拦多节点环；重复 tempId 后者覆盖前者致前者成孤儿。

**🟠 D4 — 模板误分析误导选型**：`templateAnalysis.ts:67` outputType 结构判定依赖输出节点 class_type 白名单；自定义视频保存节点或解析失败回退 nodeType → 视频模板被判 image（反之亦然），AI 按 outputType 选错工位；frames/fps 误判致 shotSeconds/镜头数错。

### 安全面（🔵 多为 by-design，供知悉）

**D2 — customBaseUrl 内网请求面**：任意登录用户/AI 填 customBaseUrl，服务端即向该 http(s) 发 /prompt、/object_info、/system_stats、/upload/image；`normalizeBaseUrl`（`comfyui.ts:56-80`）仅拒 IMDS 云元数据，**内网地址按设计放行**；门控靠白名单 / 管理员 comfyuiBypass。serverStatus/fetchModels 回显可做内网探测。

**D3 — ComfyUI traceback 泄进 graphSummary/UI**：`formatExecError`/`comfyErrorHint` 把服务器 Python 帧「文件:行」与文件名拼进 errorMessage，经 `agentApply.ts:398` 进发给 LLM 的图摘要与前端（非跨租户，但主机路径外泄）。

**M4 — attachments 透传网关**：`agent.ts:174` isImageAtt 认 mimeType 前缀或 data:image；http(s) url 原样转发给 LLM 网关（不由本服务 fetch），无 scheme/host 白名单 → 撒谎 mimeType 的内网 url 被作为 image_url 转发，网关侧可能抓取。

**M5 — history 可伪造**：`agent.ts:229` history 直接进 messages，客户端可伪造 assistant 轮做越狱/操纵规划（有 sanitize 兜底，实害有限）。

**L2 — plan 数值无合理性校验**：`agent.ts` 仅判 typeof number，`{targetSeconds:-100,perShotSeconds:0,shots:1e6}` 全通过 → 前端容量对话框除零/荒谬镜头数。

---

## ✅ 防御到位（对抗验证确认安全，非疑点）

- ComfyUI 模板注入是**结构化赋值 + JSON 序列化**（`comfyui.ts:2027-2075` / `:249-301`）——用户提示词含引号/反斜杠/换行/超长**无法**破坏 workflow JSON 或溢出到相邻字段。
- 幻觉 templateId **双侧硬拦截**（服务端 `agentCatalog.ts:250-287` + 客户端 `agentApply.ts:168-181` 明确 fail）。
- `buildGraphSummary` 走白名单字段，**不泄露** customBaseUrl / key / token。
- connect 强制走与手动 UI 同一套 `isConnectionValid` 规则 + liveIds 存在性校验，拦悬空边/非法配对/self-loop。
- 缓存恢复按**图深度完全相等**比对（`comfyui.ts:2180`），防共享服务器上把别人产物（输出节点 id 常撞 "9"）当本次输出。
- 下载/上传均有字节上限 + 流式熔断（输出 200MB / 参考图 30MB）；产物永久锁 MinIO/S3；云端 /view 302 不转发 X-API-Key；IMDS 端点显式拒。
- 整批 apply 包在单步 `runBatch`，全局 Ctrl+Z 可正确回退（含 update 的改动）。

---

## 建议处理优先级（按「确定性 × 收益 ÷ 成本」排序）

1. **S3 第一步：kie Imagen4 家族 / Ideogram V3 / Qwen 三系补发 negative_prompt** — 文档已坐实这 7 个图像模型 API 支持负向、代码却丢弃；改动小（`KieImageSpec` 加一个 `negPrompt` 标志 + 一行发送），纯功能增益、零回归风险。**最优先。**
2. **S3 第二步 + D1：反向框按模型能力显隐 / comfyui 无 negative 绑定给提示** — 消除 Poyo/Forge/无支持 kie 模型的「死框」误导；中等改动，需逐模型标注支持度（可直接复用本报告矩阵）。
3. **S1/S2**（运行全部 vs 单节点分歧）— 影响「所见即所得」最大，但需较大重构（让 runner 复用逐节点组装器）+ 真机验证。
4. **D7/S5**（参考图静默忽略）— 需先逐行复核 `arch==="sd"` 守卫与 IPAdapter 模型缺省的真实影响面。
5. 其余安全面多为 by-design，建议知悉；如需收紧 customBaseUrl（D2）可加「仅允许已注册 globalServers / 可选内网黑名单」开关。

---

## 附录：本轮文档核查覆盖（2026-07-06）

已通读并逐条对照代码：`docs/poyo-image-api.md`（17 图像模型，确认**全族无 negative_prompt**）、
`docs/poyo-video-api.md`（31 视频模型，确认仅 Kling 2.1/2.5-turbo-pro、Wan 2.5 t2v/i2v 支持 negative_prompt）、
`docs/poyo-common-api.md`（统一 submit/status/callback/balance/错误码，与 `imageGeneration.ts`/`poyoVideo.ts` 轮询口径一致）、
`docs/kie-api.md`（逐 operationId 的 input schema：图像侧仅 Imagen4×3 / Ideogram-v3(+remix/character) / Qwen(t2i·i2i·edit) 带 negative_prompt；nano-banana/seedream/flux-2/gpt-image-2/z-image/grok/wan-image 均无）、
`docs/incremental-models/2026-06-…with-params.json`（26 个新模型，唯一带 negative_prompt 者为视频模型 kling-1.6；无新图像模型带 negative）。
