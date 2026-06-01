# 参考图/视频来源：优先顺序与解析逻辑

> 本文档记录节点之间「参考图 / 参考视频」从产出 → 传播 → 消费 → 提交上游 AI 的全链路优先级与判定逻辑。
> 整理日期：2026-05-31。纯现状描述，不含改动。

## 总原则

**用户在本节点的显式值，永远覆盖上游连线传入的值。** 上游传入分两种实现：
- **推送式**：上游节点生成完成后，主动把 URL 写入下游节点的 `referenceImageUrl`。
- **拉取式**：下游节点运行时，回溯入边、按类型找到第一个有效上游源。

后端再把最终选定的 URL 统一过 `resolveToAbsoluteUrl`，转成上游 AI 平台可拉取的绝对地址。

---

## 一、前端取值优先级链

消费节点取参考图时（VideoTaskNode / StoryboardNode / PoseControlNode 同款）：

```
① payload.referenceImageUrl?.trim()    ← 手动上传 / 手填 URL / 被推送写入（最高优先）
② 上游 Character 连线的 referenceImageUrl（仅当 ① 为空时兜底）
③ undefined（无上游则待用户操作）
```

代码位置：
- `VideoTaskNode.tsx:599` `composeSubmissionContext`：`payload.referenceImageUrl?.trim() || charRefFallback`
- `StoryboardNode.tsx:93`：`payload.referenceImageUrl?.trim() || connectedCharRefUrl`（UI :869-876 明确提示本节点图覆盖角色节点图）
- `PoseControlNode.tsx:64`：`payload.referenceImageUrl || sourceImageUrl`

**多个上游同类源 → 取「第一个非空」，按 `edges` 数组顺序**（无距离/时间优先算法，一找到即返回）。

---

## 二、两种上游传播机制

### 推送式 `propagateImageUrl`
`ComfyuiImageNode.tsx:67`（ImageGenNode 有镜像版；`useWorkflowRunner.ts:359` 跑图成功后亦调用）：
- 沿**出边**筛 `targetHandle === "ref-image-in"`；
- 目标节点类型 ∈ `{video_task, comfyui_video, comfyui_image}`；
- 写入其 `referenceImageUrl`。
- 触发时机：生成成功、批量结果中选图、手动覆盖。

### 拉取式回溯（下游运行时按类型找上游第一个有效源）
- **图**：`detectUpstreamImageUrl`（`comfyWorkflowParams.ts:29`），源类型 ∈ `{image_gen, comfyui_image, storyboard, comfyui_workflow, asset}`。`getNodeImageUrl` 内部小优先级：asset 须 image/* mime；comfyui_workflow outputType=video 则跳过；否则 `imageUrl ?? outputUrl`。
- **视频**：`autoDetectInputVideo`（`useWorkflowRunner.ts:55`），源类型 ∈ `{video_task, clip, merge, overlay, asset, subtitle, subtitle_motion, smart_cut, comfyui_video, comfyui_workflow}`（排除 audio mime）。
- **音频(bgMusic)**：`detectBgMusicUrl`（`useWorkflowRunner.ts:73`）。
- **只填用户留空的参数，不覆盖已填值**（`resolveWorkflowImageParams:57` `if (cur == null || cur === "")`）。

### 连线创建时预填充
`useCanvasStore.ts onConnect (164-212)`：拖线连接瞬间，若源已有 `imageUrl` 且 handle 配对（`image-out`/`output` → `ref-image-in`），直接预填目标 `referenceImageUrl`。

### 连接规则
`connectionRules.ts` 的连接矩阵约束哪些输出可连哪些输入（图→图/视频、character→多种）；上面的 `IMAGE_SOURCE_TYPES` / `VIDEO_SOURCE_TYPES` 是运行时取值的二次过滤。

---

## 三、后端 URL 解析链

`resolveToAbsoluteUrl`（`server/storage.ts:222`）：

```
① http(s):// 绝对 URL           → 原样返回（AI 平台 CDN / 用户公网 URL，最优、零成本）
② 非 /manus-storage/ 相对路径    → 抛错
③ /manus-storage/{key}:
     ├─ [Poyo 流式暂存开关开 + MinIO/S3 未公网 + 有 POYO_API_KEY]
     │     → storageFetchStream 读出 → uploadStreamToPoyo → Poyo 公网 URL
     │       （失败则 console.warn 回退到下一步，不影响主流程）
     └─ 默认 → storagePresignGet(key)
              （MinIO 未配 S3_PUBLIC_ENDPOINT 时，签出的 URL 仍指向内网、上游不可达）
```

**可达性判定** `canBrowserReachStorageDirectly()`（`storage.ts:21`）：
- Forge 后端 → 可达；
- S3/MinIO → 仅当配置 `S3_PUBLIC_ENDPOINT` 才可达；
- 无存储 → 不可达。

**前端警告判定** `shouldWarnRefImage`（`mediaReachability.tsx`）：
当 `模型是 poyo/hf_*` 且 `参考图非外部公网 URL` 且 `存储不可达` 三者同时成立 → 提示用户参考图可能无法被上游读取。
`mediaReachability` query 失败时乐观假设可达。

**chat 场景并行降级**：`chat.ts:377` 当存储不可直达时回退 `{mode:"base64"}`，把文件 base64 内联，绕开 URL 不可达。

---

## 四、各上游 API 接入点（均先过 resolveToAbsoluteUrl）

| 上游 | 文件:行 | 字段 | 备注 |
|---|---|---|---|
| Poyo 图像 | `imageGeneration.ts:64` | `reference_image_url` | 可选 |
| Poyo 视频 | `poyoVideo.ts` | `reference_image_url` | 可选 |
| Higgsfield Soul/图像 | `higgsfield.ts:137` | `image_reference` | 可选 |
| Higgsfield DoP 视频 | `higgsfield.ts:369` | `input_images` | **强制要求参考图** |
| ComfyUI | `comfyui.ts:366` `uploadImageToComfy` | 上传后替换文件名 | http(s) 做 SSRF 检查；manus-storage 先 resolve，再流式传给 ComfyUI |

---

## 五、强制 vs 可选参考图

- **强制**（缺参考图后端直接 `BAD_REQUEST`）：
  - Higgsfield DoP（image-to-video）— `canvas.ts:329`
  - ComfyUI img2img / inpaint / SVD / Wan-I2V — `canvas.ts:1845/1927`
- **可选**：Poyo / Higgsfield 文生图 — 有则 resolve 传下去，无则跳过参考图字段。

---

## 六、速记

- **前端取值**：`本节点显式值（上传/填URL/被推送）` ▶ `上游第一个有效同类源（按 edges 顺序）`；自动填充只补空、不覆盖。
- **后端解析**：`绝对 http(s) 原样` ▶ `/manus-storage →〔开关开+无公网+有key〕Poyo 公网URL` ▶ `预签名URL（无公网时可能不可达）` ▶ `(chat 场景) base64 兜底`。

## 关键文件索引

| 主题 | 文件 |
|---|---|
| 推送传播 | `client/src/components/canvas/nodes/ComfyuiImageNode.tsx` `propagateImageUrl` |
| 图像拉取 | `client/src/lib/comfyWorkflowParams.ts` `detectUpstreamImageUrl` / `getNodeImageUrl` |
| 视频/音频拉取 | `client/src/hooks/useWorkflowRunner.ts` `autoDetectInputVideo` / `detectBgMusicUrl` |
| 连线预填充 | `client/src/hooks/useCanvasStore.ts` onConnect |
| 连接规则 | `client/src/lib/connectionRules.ts` |
| 消费取值优先级 | `VideoTaskNode.tsx:599` / `StoryboardNode.tsx:93` / `PoseControlNode.tsx:64` |
| 后端 URL 解析 | `server/storage.ts:222` `resolveToAbsoluteUrl` / `:21` `canBrowserReachStorageDirectly` |
| 可达性警告 | `client/src/components/canvas/mediaReachability.tsx` |
