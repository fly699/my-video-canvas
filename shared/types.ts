// ── Shared Types ─────────────────────────────────────────────────────────────
import type { AppliedEmotion } from "./emotionGrid";

export type NodeType =
  | "script"
  | "storyboard"
  | "prompt"
  | "image_gen"
  | "asset"
  | "video_task"
  | "ai_chat"
  | "note"
  | "audio"
  | "post_process"
  | "group"
  | "character"
  | "clip"
  | "merge"
  | "subtitle"
  | "overlay"
  | "subtitle_motion"
  | "smart_cut"
  | "pose_control"
  | "voice_clone"
  | "lip_sync"
  | "avatar"
  | "comfyui_image"
  | "comfyui_video"
  | "comfyui_workflow"
  | "image_edit"
  | "director"
  | "agent"
  | "super_agent"
  | "compare";

export const VIDEO_PROVIDERS = [
  "mock",
  // ── existing (kept for back-compat; never remove a persisted value) ──
  "poyo_seedance",
  "poyo_veo",
  "poyo_kling26",
  "poyo_kling_o3_std",
  "poyo_kling_o3_pro",
  "poyo_kling_o3_4k",
  "poyo_wan25_t2v",   // legacy name → wire wan2.6-text-to-video
  "poyo_wan25_i2v",   // legacy name → wire wan2.6-image-to-video
  "poyo_runway45",
  "hf_dop_standard",
  "hf_dop_lite",
  "hf_dop_turbo",
  // ── new: full Poyo video catalog (docs/poyo-video-api.md) ──
  // Sora
  "poyo_sora2",
  "poyo_sora2_pro",
  "poyo_sora2_official",
  "poyo_sora2_pro_official",
  // Veo 3.1 tiers
  "poyo_veo_fast",
  "poyo_veo_lite",
  "poyo_veo_quality",
  "poyo_veo_fast_official",
  "poyo_veo_lite_official",
  "poyo_veo_quality_official",
  // Kling
  "poyo_kling21_std",
  "poyo_kling21_pro",
  "poyo_kling25_turbo",
  "poyo_kling30_std",
  "poyo_kling30_pro",
  "poyo_kling30_4k",
  "poyo_kling16_std",
  "poyo_kling16_pro",
  "poyo_kling30turbo_std",
  "poyo_kling30turbo_pro",
  // Wan
  "poyo_wan27_t2v",
  "poyo_wan27_i2v",
  "poyo_wan27_ref",
  "poyo_wan22_t2v_fast",
  "poyo_wan22_i2v_fast",
  // Seedance
  "poyo_seedance1_pro",
  "poyo_seedance15_pro",
  "poyo_seedance2_fast",
  // Hailuo
  "poyo_hailuo02",
  "poyo_hailuo02_pro",
  "poyo_hailuo23",
  // others
  "poyo_happy_horse",
  "poyo_happy_horse_11",
  "poyo_omni_flash",
  "poyo_grok_video",
  // ── #151 round2 新模型（poyo 视频）──
  "poyo_grok_video_15",
  "poyo_kling_avatar2_std", "poyo_kling_avatar2_pro",
  "poyo_seedance2_mini",
  "poyo_wan25_text", "poyo_wan25_image",
  "poyo_wan_animate_move", "poyo_wan_animate_replace",
  // ── kie.ai video (additive; routed via server/_core/kieVideo.ts, NOT Poyo) ──
  "kie_veo31_quality",
  "kie_veo31_fast",
  "kie_kling26_t2v",
  "kie_kling26_i2v",
  "kie_kling30",
  "kie_kling25turbo_t2v",
  "kie_kling25turbo_i2v",
  "kie_wan25_t2v",
  "kie_wan25_i2v",
  "kie_wan26_t2v",
  "kie_wan26_i2v",
  "kie_hailuo23_pro",
  "kie_hailuo23_std",
  "kie_seedance2",
  "kie_seedance2_fast",
  // ── kie 视频 第二批扩充 ──
  "kie_kling21_std", "kie_kling21_pro", "kie_kling21_master_t2v", "kie_kling21_master_i2v",
  "kie_wan22_t2v", "kie_wan22_i2v",
  "kie_wan27_t2v", "kie_wan27_i2v",
  "kie_hailuo02_std", "kie_hailuo02_pro_t2v", "kie_hailuo02_pro_i2v",
  "kie_grok_t2v", "kie_grok_i2v",
  "kie_happyhorse_t2v", "kie_happyhorse_i2v",
  "kie_seedance2_mini", "kie_kling_v3turbo_t2v", "kie_kling_v3turbo_i2v", "kie_happyhorse11_t2v", "kie_happyhorse11_r2v",
  "kie_happyhorse11_i2v", "kie_omnihuman15", "kie_volcengine_lipsync",
  // ── kie 视频 第三批：特殊输入（动作控制 / 数字人 / 替身）──
  "kie_kling26_motion", "kie_kling30_motion",
  "kie_kling_avatar_std", "kie_kling_avatar_pro",
  "kie_wan_animate_move", "kie_wan_animate_replace",
  "kie_runway45",
  "kie_topaz_upscale", "kie_runway_aleph",
  // ── #328 即梦（dreamina）CLI 本机桥接型视频 provider（routed via server/_core/jimengCli.ts）──
  // 本机 CLI、异步任务制；参数枚举取自官方文档示例值，解析层待真机校准。
  "jimeng_text2video", "jimeng_image2video", "jimeng_frames2video",
  "jimeng_multiframe2video", "jimeng_multimodal2video",
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export type VideoTaskStatus = "pending" | "processing" | "succeeded" | "failed";

// ── Node Data Payloads ────────────────────────────────────────────────────────

/** 节拍表单拍（beat sheet item）——行业开发管线的中间产物，介于梗概与剧本之间。 */
export interface ScriptBeat {
  index: number;
  title: string;       // 拍点名（如「开场画面」「催化剂」「钩子」）
  summary: string;     // 这一拍发生什么（1-3 句）
  duration?: number;   // 目标时长（秒，可选）
}

/** 短剧分集大纲单集。 */
export interface ScriptEpisode {
  episode: number;
  title: string;
  hook: string;        // 本集开场钩子（前 3 秒抓人点）
  summary: string;     // 本集剧情（2-4 句）
  cliffhanger: string; // 结尾悬念/卡点
}

/** 专业审查（Coverage）维度评分。 */
export interface CoverageDimension {
  key: "premise" | "structure" | "characters" | "dialogue" | "pacing" | "visual";
  score: number;       // 0-100
  comment: string;     // 一句话短评
}

/** 专业审查问题条目（带定位与可修复标志，支撑「审→修→复审」闭环）。 */
export interface CoverageIssue {
  dimension: CoverageDimension["key"];
  sceneRef: string;    // 定位（如「场景三」「第12行」「全局」）
  severity: "low" | "medium" | "high";
  description: string; // 问题描述
  suggestion: string;  // 修改建议
  autoFixable: boolean; // AI 可一键定向改写
}

/** 专业审查报告（对齐行业 Script Coverage：维度评分 + 裁决 + 结构化问题）。 */
export interface ScriptCoverageReport {
  verdict: "recommend" | "consider" | "pass"; // 推荐 / 修改后可用 / 不推荐
  overall: number;     // 0-100 综合分
  summary: string;     // 总评（2-4 句）
  dimensions: CoverageDimension[];
  strengths: string[]; // 亮点
  issues: CoverageIssue[];
  /** 短剧模式附加检查（钩子节奏/台词长度/反转密度等），非短剧为空。 */
  shortDramaChecks?: { name: string; pass: boolean; detail: string }[];
  reviewedAt?: number; // 时间戳，便于「修复后复审」对比
}

export interface ScriptNodeData {
  content: string;
  synopsis?: string;
  totalDuration?: number;
  // ── 开发阶段流产物（对齐行业管线：logline → 梗概 → 节拍表 → 剧本 → 分镜）──
  /** 一句话故事（logline，25-35 字，含主角/冲突/赌注）。 */
  logline?: string;
  /** 节拍表（beat sheet）：剧本生成时作为结构约束消费。 */
  beatSheet?: ScriptBeat[];
  /** 节拍表所用结构模板 id（three_act / save_the_cat / heros_journey / short_drama / documentary）。 */
  beatStructure?: string;
  /** 短剧分集大纲（多集模式产物）。 */
  episodeOutline?: ScriptEpisode[];
  /** 最近一次专业审查报告（持久化：留存 / 修复后对比 / 导出便签）。 */
  coverage?: ScriptCoverageReport;
  /** 角色音色 casting 表：角色名 → 配音模型+音色（镜头表批量配音按「角色名：台词」
   *  逐段套用；存在脚本节点上随画布持久化，同组分镜共享）。 */
  castVoices?: Record<string, { model: string; voice: string }>;
  /** 脚本正文版本历史：每次 AI 改写（润色/精简/风格迁移/整本生成/变体/定向修复）
   *  前自动快照旧正文，供「历史」面板逐行 diff 对比与一键还原。最多保留 20 条。 */
  scriptHistory?: { content: string; label: string; at: number }[];
  /** 上次「拆分镜」时的脚本正文 hash + 时间戳。脚本之后被改动则下游分镜视为「可能过期」，
   *  在节点上提示「重新拆分镜」（提示而非自动覆盖已编辑分镜）。 */
  lastStoryboardContentHash?: string;
  lastStoryboardAt?: number;
  // AI panel params — persisted so settings survive remount / project reload
  aiGenre?: string;
  aiStyle?: string;
  aiMood?: string;
  aiTargetModel?: string;
  aiAspectRatio?: string;
  aiSceneCount?: number;
  aiLlmModel?: string;
  /** id of the currently-applied template from scriptCreationTemplates.ts.
   *  Used both to render "已套用: XXX" in the UI and to look up the
   *  systemPromptAddon to send with the next generate call. */
  aiScriptTemplate?: string;
  /** What kind of downstream node to auto-create from generated scenes:
   *  "storyboard" (default) or "comfyui_image" (ComfyUI 本地生图节点). */
  aiStoryboardTarget?: "storyboard" | "comfyui_image";
  /** Language the generated scene promptText should be written in (sent
   *  downstream). "en" (default) or "zh". */
  aiPromptLang?: "zh" | "en";
}

export interface StoryboardNodeData {
  // Free-form scene label — historically populated as a number (1, 2, 3…)
  // by templates and AI generation, but the user can edit to any string
  // ("开场", "S1-A", "插曲#3") via the SceneNumberBadge inline editor.
  sceneNumber?: number | string;
  description: string;
  imageUrl?: string;
  imageStorageKey?: string;
  imageHistory?: string[];
  promptText?: string;
  negativePrompt?: string;
  duration?: number; // seconds
  cameraMovement?: string;
  lens?: string;
  colorTone?: string;
  // ── 行业 Shot List 标准字段（镜头表）──
  /** 景别：ECU/CU/MS/MLS/WS/establishing。 */
  shotType?: string;
  /** 灯光设置（如 "soft key + rim, golden hour"）。 */
  lighting?: string;
  /** 对白/旁白文本——可直接喂给下游音频节点作配音文案。 */
  dialogue?: string;
  /** 音效/BGM 意图（如「雨声渐强 + 低音弦乐」），供配乐参考。 */
  sfx?: string;
  /** 到下一镜的转场方式：cut/dissolve/fade/wipe/match-cut 等。 */
  transition?: string;
  /** 所属节拍表拍点（如「3」或「中点」），承接脚本节点的 beat sheet。 */
  beatRef?: string;
  imageModel?: ImageGenModel;
  /** true=分镜只作镜头表数据行：「运行全部」不为它兜底生关键帧图、估价也不计入。
   *  另外分镜若已有下游 image_gen 连线（专职出图工位），运行/估价会自动跳过它——
   *  两条规则都为了避免与 image_gen 重复出图、重复计费。 */
  skipAutoImage?: boolean;
  referenceImageUrl?: string;
  /** 真 3D（Tripo3D）已生成的模型——重开免费复用（与图像节点同款）。 */
  model3d?: Model3DResult;
  /** 手动多参考图管理（与 ImageGenNode 同款；[0].url 与 referenceImageUrl 镜像）。 */
  referenceImages?: ReferenceImage[];
  /** LibTV「标记」常驻元素引用 chips（与图像/视频节点同款，token 落在 promptText 里）。 */
  markRefs?: MarkRef[];
  /** kie 图像模型的通用比例（服务端按模型枚举夹取）。 */
  aspectRatio?: string;
  /** kie 分辨率档（如 GPT Image 2 的 1K/2K/4K，逐档计价；服务端按模型 resOptions 夹取）。 */
  imageResolution?: string;
  batchSize?: number;
  // ── Image-gen sizing/quality knobs (mirror ImageGenNodeData) ──
  // Stored here so each storyboard scene can override aspect ratio and
  // resolution independently. Field names match the imageGen.generate
  // tRPC input — the mutation accepts them as-is per model.
  widthAndHeight?: string;            // Soul Standard 13-value enum
  soulQuality?: "720p" | "1080p";     // Soul Standard only
  seed?: number;                      // Soul Standard：种子锁定（复现一致画面）
  enhancePrompt?: boolean;            // Soul Standard：AI 增强提示词
  reveAspectRatio?: string;           // Reve / Seedream / Flux Pro
  reveResolution?: "1K" | "2K" | "4K";// Reve / Seedream / Flux Pro
  fluxGuidanceScale?: number;         // Flux Pro Kontext：引导强度 1-20
  fluxSeed?: number;                  // Flux Pro Kontext：种子
  fluxNumImages?: number;             // Flux Pro Kontext：每次张数 1-4
  poyoAspectRatio?: string;           // Poyo image models
  poyoQuality?: "low" | "medium" | "high"; // Poyo image models
  // Original upstream AI-platform URL for the generated image (see ImageGenNodeData)
  imageUrlSource?: string;
  imageUrlSourceAt?: number;
}

export interface PromptNodeData {
  positivePrompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  // Input image used ONLY for analysis (image → prompt). The prompt node never
  // outputs an image downstream — it is a text-only producer.
  referenceImageUrl?: string;
  // LLM / vision model used by the analyze / expand / translate operations.
  llmModel?: string;
  // Whether each AI text op participates in a workflow run. When more than one is
  // on, they execute in this order: analyze → expand → translate. When all are
  // off, the text already in positivePrompt is used as-is.
  enableAnalyze?: boolean;
  enableExpand?: boolean;
  enableTranslate?: boolean;
  // Whether style / aspectRatio are passed to downstream consumers.
  passStyle?: boolean;
  passRatio?: boolean;
}

export interface AssetNodeData {
  assetId?: number;
  name: string;
  type: "image" | "video" | "audio" | "other";
  url: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
}

/**
 * One entry in a node's multi-reference-image list. `id` is a stable nanoid
 * used as the React key and for reorder/delete. `source` records how it was
 * added (for badges/debugging). The display number is just the 1-based index,
 * so deleting an entry auto-renumbers the rest. The first entry mirrors the
 * legacy `referenceImageUrl` field for backend / downstream compatibility.
 */
export interface ReferenceImage {
  id: string;
  url: string;
  source?: "upload" | "paste" | "drop" | "url" | "upstream";
  /** 可选标签（如 ComfyUI 工作流图像参数名），只读吸附窗用作角标 tooltip。 */
  label?: string;
}

/** LibTV「标记」常驻元素引用：记录源图、已插入提示词的 token、当前选中元素与该图
 *  全部候选元素——嵌入提示词后仍可通过 chip 下拉换选其它元素（同步改写提示词 token）。 */
export interface MarkRef {
  id: string;
  /** 被标记的源图 URL（对应参考图列表中的一张）。 */
  url: string;
  /** 当前选中的元素名。 */
  element: string;
  /** 实际插入提示词的完整 token（如「图片1 的树枝」），换选时按它精确替换提示词。 */
  token: string;
  /** AI 分析出的全部候选元素（下拉换选数据源）。 */
  elements: { name: string; desc?: string }[];
}

export interface VideoTaskNodeData {
  provider: VideoProvider;
  status: VideoTaskStatus;
  taskId?: number;
  externalTaskId?: string;
  prompt?: string;
  negativePrompt?: string;
  referenceImageUrl?: string;
  /** Multi-angle reference images (see ReferenceImage). [0].url mirrors referenceImageUrl. */
  referenceImages?: ReferenceImage[];
  /** LibTV「标记」常驻元素引用 chips（见 MarkRef）。 */
  markRefs?: MarkRef[];
  /** Final video URL. Named `resultVideoUrl` (not `outputUrl` like the post-processing
   *  nodes) for historical reasons: video_task results come from the async provider-task
   *  subsystem and are filled by server/videoTaskPoller into this field. The in-app
   *  composing nodes (clip/merge/subtitle/…) and comfyui_workflow use `outputUrl` instead;
   *  comfyui_video reuses this same `resultVideoUrl` name. Downstream readers bridge both
   *  via `resultVideoUrl ?? outputUrl ?? url` — see getNodeVideoUrl in useWorkflowRunner.ts
   *  for the full rationale. Do NOT rename without migrating the poller + persisted payloads. */
  resultVideoUrl?: string;
  /** OmniHuman 指定说话主体：选中的主体蒙版图 URL（来自 Subject Detection，≤5）。 */
  maskUrls?: string[];
  errorMessage?: string;
  progress?: number;
  params?: Record<string, unknown>;
}

export interface ChatAttachment {
  type: "image" | "file";
  url: string;
  mimeType: string;
  name: string;
  /** For text/markdown files only — the body inlined into the prompt. */
  textContent?: string;
}

// ── Account-based Chat (rewrite) ──────────────────────────────────────────────
// Shared shapes so client + server agree on socket payloads. Mirrors the DB
// rows but uses Date as ISO string for JSON-safe transport.

export type ChatConversationType = "lobby" | "group" | "dm";
export type ChatMode = "server" | "serverless";

export interface ChatFileRef {
  attachmentId?: number;     // server mode only
  name: string;
  mimeType: string;
  size: number;
  url: string;               // server mode: storage URL; serverless: local blob URL
  kind: "image" | "video" | "file";
}

/** A server-mode message broadcast over Socket.IO / returned by getMessages. */
export interface ChatWireMessage {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  content: string;
  attachments?: ChatFileRef[] | null;
  createdAt: string;         // ISO
}

export interface ChatPresenceUser {
  userId: number;
  name: string;
}

/** Serverless relay envelope — server forwards opaque ciphertext, never reads it. */
export interface ChatRelayPayload {
  conversationId: number;
  senderId: number;
  senderName: string;
  /** base64 AES-GCM ciphertext (empty for key-request markers) */
  ciphertext: string;
  /** base64 12-byte IV */
  iv: string;
  /** logical kind so clients can route key bundles vs chat messages */
  kind: "message" | "key-bundle" | "key-request";
  /** client-generated id for local dedup/ordering */
  clientMsgId: string;
  /** key-bundle only: the member this wrapped room key is addressed to */
  target?: number;
  /** optional attachment metadata for serverless messages (file delivered via chat:file-chunk) */
  fileMeta?: ChatFileRef | null;
}

export interface AIChatNodeData {
  systemPrompt?: string;
  contextNodeIds?: string[];
  messages?: Array<{ role: "user" | "assistant"; content: string; attachments?: ChatAttachment[] }>;
  model?: string;
}

export type ImageGenModel =
  // Manus (built-in)
  | "manus_forge"
  // Poyo · Nano Banana (Google)
  | "poyo_nano_banana" | "poyo_nano_banana_2" | "poyo_nano_banana_pro" | "poyo_nano_banana_2_new" | "poyo_nano_banana_2_official"
  // Poyo · GPT Image (OpenAI)
  | "poyo_gpt_4o_image" | "poyo_gpt_image_15" | "poyo_gpt_image"
  // Poyo · Flux (Black Forest Labs)
  | "poyo_flux" | "poyo_sdxl" | "poyo_flux_kontext_pro" | "poyo_flux_kontext_max"
  // Poyo · Seedream (ByteDance)
  | "poyo_seedream_4" | "poyo_seedream" | "poyo_seedream_5_lite"
  // Poyo · Wan (Alibaba)
  | "poyo_wan_image" | "poyo_wan_image_pro"
  // Poyo · Kling (Kuaishou)
  | "poyo_kling_o1_image" | "poyo_kling_o3_image"
  // Poyo · others
  | "poyo_z_image" | "poyo_grok_image"
  // Poyo · #151 round2 新模型
  | "poyo_seedream_5_pro" | "poyo_grok_image_quality" | "poyo_flux_dev" | "poyo_flux_schnell" | "poyo_nano_banana_2_lite"
  // Higgsfield
  | "hf_soul_standard" | "hf_reve" | "hf_seedream_v4" | "hf_flux_pro"
  // kie.ai (unified jobs API) — text-to-image
  | "kie_nano_banana" | "kie_nano_banana_pro" | "kie_seedream_v4" | "kie_seedream_45"
  | "kie_flux2_pro" | "kie_gpt_image_15" | "kie_imagen4" | "kie_imagen4_fast" | "kie_imagen4_ultra" | "kie_z_image" | "kie_grok_image"
  // kie.ai — image-to-image / edit (require reference image)
  | "kie_nano_banana_edit" | "kie_seedream_v4_edit" | "kie_flux2_pro_i2i" | "kie_gpt_image_15_edit"
  // kie.ai — 第二批扩充
  | "kie_nano_banana_2" | "kie_flux2_flex" | "kie_flux2_flex_i2i"
  | "kie_gpt_image_2" | "kie_gpt_image_2_i2i" | "kie_seedream_5lite" | "kie_seedream_5lite_i2i"
  | "kie_wan27_image" | "kie_wan27_image_pro" | "kie_ideogram_v3" | "kie_qwen_image"
  | "kie_qwen_image_i2i" | "kie_qwen_image_edit" | "kie_qwen2_image_edit"
  | "kie_flux_kontext_pro" | "kie_flux_kontext_max" | "kie_gpt_4o_image"
  // kie.ai — #151 round2 新模型
  | "kie_nano_banana_2_lite" | "kie_nano_banana_2_lite_i2i" | "kie_seedream_5pro_i2i"
  // #337 金泰（dreamina）CLI 本机桥接生图（text2image / image2image / image_upscale）
  | "jimeng_text2image" | "jimeng_image2image" | "jimeng_image_upscale";

/** UI value strings for every image model — single source for the Zod enum. */
export const IMAGE_GEN_MODELS = [
  "manus_forge",
  "poyo_nano_banana", "poyo_nano_banana_2", "poyo_nano_banana_pro", "poyo_nano_banana_2_new", "poyo_nano_banana_2_official",
  "poyo_gpt_4o_image", "poyo_gpt_image_15", "poyo_gpt_image",
  "poyo_flux", "poyo_sdxl", "poyo_flux_kontext_pro", "poyo_flux_kontext_max",
  "poyo_seedream_4", "poyo_seedream", "poyo_seedream_5_lite",
  "poyo_wan_image", "poyo_wan_image_pro",
  "poyo_kling_o1_image", "poyo_kling_o3_image",
  "poyo_z_image", "poyo_grok_image",
  "poyo_seedream_5_pro", "poyo_grok_image_quality", "poyo_flux_dev", "poyo_flux_schnell", "poyo_nano_banana_2_lite",
  "hf_soul_standard", "hf_reve", "hf_seedream_v4", "hf_flux_pro",
  "kie_nano_banana", "kie_nano_banana_pro", "kie_seedream_v4", "kie_seedream_45",
  "kie_flux2_pro", "kie_gpt_image_15", "kie_imagen4", "kie_imagen4_fast", "kie_imagen4_ultra", "kie_z_image", "kie_grok_image",
  "kie_nano_banana_edit", "kie_seedream_v4_edit", "kie_flux2_pro_i2i", "kie_gpt_image_15_edit",
  "kie_nano_banana_2", "kie_flux2_flex", "kie_flux2_flex_i2i",
  "kie_gpt_image_2", "kie_gpt_image_2_i2i", "kie_seedream_5lite", "kie_seedream_5lite_i2i",
  "kie_wan27_image", "kie_wan27_image_pro", "kie_ideogram_v3", "kie_qwen_image",
  "kie_qwen_image_i2i", "kie_qwen_image_edit", "kie_qwen2_image_edit",
  "kie_flux_kontext_pro", "kie_flux_kontext_max", "kie_gpt_4o_image",
  "kie_nano_banana_2_lite", "kie_nano_banana_2_lite_i2i", "kie_seedream_5pro_i2i",
  "jimeng_text2image", "jimeng_image2image", "jimeng_image_upscale",
] as const satisfies readonly ImageGenModel[];
/** 「真 3D」（Tripo3D 图生 .glb）结果：随节点持久化——生成一次约 30–60 credits，
 *  关闭查看器后凭此免费重开继续调整视角；sourceUrl 变了才需要重新生成。 */
export interface Model3DResult {
  sourceUrl: string;   // 生成该模型所用的源图（用于判断是否可复用）
  glbUrl: string;      // 已转存到自有存储的 .glb
  saved?: boolean;     // 已存入素材库（服务端按 storageKey 去重，重复保存无害）
}

export interface ImageGenNodeData {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  /** kie 分辨率档（如 GPT Image 2 的 1K/2K/4K，逐档计价；服务端按模型 resOptions 夹取）。 */
  imageResolution?: string;
  referenceImageUrl?: string;
  /** Multi-angle reference images (see ReferenceImage). [0].url mirrors referenceImageUrl. */
  referenceImages?: ReferenceImage[];
  /** LibTV「标记」常驻元素引用 chips（见 MarkRef）。 */
  markRefs?: MarkRef[];
  imageUrl?: string;
  imageStorageKey?: string;
  /** #336 批2 情绪调节：应用后的情绪档，供下游视频节点把表情词注入提示词（整图重生成时清空）。 */
  appliedEmotion?: AppliedEmotion;
  /** 真 3D（Tripo3D）已生成的模型——重开免费复用。 */
  model3d?: Model3DResult;
  model?: ImageGenModel;
  // Poyo image params
  poyoQuality?: "low" | "medium" | "high";
  // Soul Standard specific params
  widthAndHeight?: string;
  soulQuality?: "720p" | "1080p";
  batchSize?: number;
  seed?: number;
  enhancePrompt?: boolean;
  // Reve / Seedream v4 / Flux Pro aspect ratio
  reveAspectRatio?: string;
  reveResolution?: "1K" | "2K" | "4K";
  // Flux Pro Kontext specific params
  fluxGuidanceScale?: number;
  fluxSeed?: number;
  fluxNumImages?: number;
  // Batch generation results
  imageUrls?: string[]; // multiple generated images (Soul batchSize=4, etc.)
  /** A1 质检回环：画布助手创建的节点标记（agentApply 落地时盖章），自动质检只作用于它们。 */
  createdByAgent?: boolean;
  /** A1 质检回环：最近一次 AI 质检结果（checking=进行中）。 */
  qc?: { status: "checking" | "pass" | "fail"; score?: number; issues?: string[]; suggestion?: string; at?: number };
  /** A1 质检回环：本轮已按质检意见自动重试过一次（防循环重试；新一轮手动生成时复位）。 */
  qcRetried?: boolean;
  /** Collapsed hero preview mode for a multi-image batch: "grid" (default) shows
   *  the whole grid, "single" shows only the selected image. */
  heroView?: "grid" | "single";
  /** #125 极简显示(Alt+Q)下多产物平铺的收起状态：true=折成单张预览（与 heroView
   *  互不影响——极简默认强制平铺，此字段仅在极简形态下生效）。 */
  minimalCollapsed?: boolean;
  // Original upstream (AI-platform) URL(s) captured at generation time, kept so
  // that — when the re-hosted /manus-storage copy isn't reachable by upstream —
  // a downstream node can offer to switch the reference back to the still-valid
  // (short-lived) AI-platform URL. `imageUrlSource` tracks the selected image;
  // `imageUrlSources` is index-aligned with `imageUrls` for batch results.
  imageUrlSource?: string;
  imageUrlSources?: string[];
  imageUrlSourceAt?: number; // ms epoch when generated (for TTL heuristics)
  /** 生成版本历史（#5 一键回滚）：每产出一张新图追加一条快照，最新在前，最多 12 条。
   *  回滚 = 把某条快照的 url(s) 写回当前 imageUrl/imageUrls，可来回翻看历次重绘结果。 */
  resultHistory?: ResultSnapshot[];
}

/** 一次生成结果的快照（用于节点级「版本历史 + 回滚」）。 */
export interface ResultSnapshot {
  url: string;
  urls?: string[];      // 批量结果的全部图（回滚时一并恢复）
  prompt?: string;      // 产出时的提示词（hover 可看当时用的词）
  at: number;           // ms epoch
}

// ── 3D 导演台（Director's Desk）─────────────────────────────────────────────
// 可视化 3D 空间精准摆角色站位/机位，渲染截图作为生图/视频的构图参考图。场景以
// 纯数据形式持久化进节点 payload（无外部资源，人偶为参数化图元）。
export type Vec3 = [number, number, number];

/** 单个角色（参数化人偶）。pose 为各命名关节的角度(度)，P1 留空（默认姿势）。 */
export interface DirectorActor {
  id: string;
  name: string;
  model: string;        // 预置体型 key：male / female / tall / child …
  position: Vec3;
  rotation: Vec3;       // 欧拉角(度)
  scale: number;
  color: string;        // 十六进制；用于「彩色人偶替换」「黑底分离」等参考技法
  pose?: Record<string, number>; // P2：关节角度(度)
  groupId?: string;     // P4：所属群众群组 id；置位时 position 为「组内局部坐标」
  glbUrl?: string;      // 用 GLB 网格渲染（本地导入 / 内置真人模型）；置位时不再是参数化人偶
  tint?: boolean;       // GLB 材质染成 actor.color（纯色人偶，便于黑底分离/彩色替换）
  /** #71 多物体：几何体道具（方块/球体/圆柱/圆锥/平面板）；置位时渲染几何体而非人偶。 */
  prim?: "box" | "sphere" | "cylinder" | "cone" | "plane" | "table" | "chair" | "bed" | "doorframe" | "stairs" | "tree";
}

// P4：群众群组——一组人偶的统一变换父级（位置/旋转/缩放整体作用于成员）。
export interface DirectorGroup {
  id: string;
  name: string;         // 如「群众 (3x4)」
  rows: number;
  cols: number;
  position: Vec3;
  rotation: Vec3;       // 欧拉角(度)
  scale: number;        // 统一缩放
  color: string;        // 组配色（成员默认同色，便于黑底分离区分组）
  spacing?: number;     // 成员行列间距(米)，默认 0.85（LibTV 模块08「间距设置」）
  manual?: boolean;     // true=任意角色手动编组（成员保留各自局部坐标，非行列网格，无间距重排）
}

export interface DirectorCamera {
  position: Vec3;
  target: Vec3;         // 注视点
  fov: number;          // 视野角度(度)，默认 32
  id?: string;          // 多机位：机位 id（命名机位列表用；单机位 legacy 无此字段）
  name?: string;        // 机位名（如「机位1」）
  lookAtActorId?: string; // 注视目标 = 指定角色（置位时 target 跟随该角色位置）
  /** #110 机位动画路径：镜头终点位姿（起点=本机位当前 position/target）。
   *  用于预览飞行与推导中文运镜描述（推/拉/摇/移/升降），随截图输出给下游图生视频。 */
  moveTo?: { position: Vec3; target: Vec3 };
}

/** #78 导演台真 3D 灯光：可摆位光源（点光/聚光），实时照亮人偶与道具（LibTV 无此能力）。 */
export interface DirectorLight {
  id: string;
  kind: "point" | "spot";
  name: string;          // 如「主光」「轮廓光」
  position: Vec3;        // 世界坐标（不随场景缩放组）
  target?: Vec3;         // 聚光指向点（point 忽略）
  color: string;         // 光色 hex
  intensity: number;     // 强度 0.1..8（decay=0 线性手感）
  angle?: number;        // 聚光锥角(度)，默认 40
  castShadow?: boolean;  // 是否投影
}

export interface DirectorScene {
  actors: DirectorActor[];
  groups?: DirectorGroup[]; // P4：群众群组
  camera: DirectorCamera;   // 当前生效机位（始终镜像 cameras 里的激活项，供渲染/截图直接读）
  cameras?: DirectorCamera[]; // 模块3：命名机位列表（含 id/name）；空表示沿用单机位 camera
  activeCameraId?: string;
  aspectRatio: string;  // 画幅，如 "16:9"
  background: string;    // 背景色(十六进制)；"" 表示默认深灰；后续支持全景图 url
  panoramaUrl?: string;  // P5：720° 全景背景
  panoramaYaw?: number;   // 全景旋转(度)：转动背景朝向(绕Y/方位角)，默认 0
  panoramaPitch?: number; // 全景俯仰校正(度，绕X)：抬/压全景地平线，校正拍摄时镜头俯仰，使全景地面与网格地面平行，默认 0
  panoramaRoll?: number;  // 全景翻滚校正(度，绕Z)：左右扳平歪斜的全景地平线，校正镜头侧倾，默认 0
  panoramaY?: number;     // 已弃用（旧版全景球升降；改天空盒后不再移动球，保留字段以兼容旧场景）
  panoramaScale?: number; // 全景球半径(倍)：放大/缩小全景球，影响背景透视与距离感，默认 1
  sceneScale?: number;    // 场景缩放(倍)：整体缩放「人物场景」相对全景空间的大小，使人物与全景尺度匹配，默认 1（LibTV 模块16/23「场景缩放」，文档默认 300%）
  sceneOffsetY?: number;  // 场景升降(米)：整体上下移动「人物场景」，使人物脚底落到全景画面里的地面线，默认 0
  sceneOffsetX?: number;  // 场景平移X(米)：整体左右移动「人物场景」，在全景房间里左右挪位，默认 0
  sceneOffsetZ?: number;  // 场景平移Z(米)：整体前后移动「人物场景」，在全景房间里前后挪位，默认 0
  groundVisible: boolean;
  labelsVisible: boolean;
  /** #71 原点可位移：布景原点（新增人物/群众/模板的落点 + 地面网格中心 + 原点标记）。缺省 [0,0,0]。 */
  origin?: Vec3;
  /** #71 非全景背景图：整屏静态背景（不随机位转动；与全景/黑底分离互斥，全景优先）。 */
  backgroundImageUrl?: string;
  /** #78 真 3D 灯光列表（空/缺省=无布光，走默认环境光）。 */
  lights?: DirectorLight[];
  /** #78 压暗基础光：有布光时把环境光/方向光压到很低，突出灯光造型（缺省 true）。 */
  dimBase?: boolean;
  /** 截图输出格式（照片型产出：机位截图/入库/宫格）。缺省 "jpeg"（编码快、体积小）；"png" 无损更大。控制图始终 PNG，不受此项影响。 */
  captureFormat?: "jpeg" | "png";
  /** 截图输出质量档 → 分辨率：high=原生最清晰 / medium≤1280 / low≤720（长边）。缺省 "high"。JPEG 编码质量随档位 0.95/0.90/0.82。 */
  captureQuality?: "high" | "medium" | "low";
}

// ── 动画层（#327 导演台运动轨迹/时间线/回放/导出）──────────────────────────
// 纯数据模型，随 DirectorNodeData 持久化；由 client/src/lib/directorTimeline.ts
// 的纯函数负责插值/缓动/采样/运镜预设，UI 层只驱动这些函数。

/** 三次贝塞尔缓动控制点 [p1x,p1y,p2x,p2y]（CSS cubic-bezier 语义），线性=[0,0,1,1]。 */
export type Bezier = [number, number, number, number];

/** 一个关键帧：某通道在 time(秒) 处的标量值 + 到「下一帧」的缓动曲线。 */
export interface DirectorKeyframe {
  time: number;      // 秒（相对时间线起点）
  value: number;     // 标量值（位置/旋转分量、fov、缩放…）
  easing?: Bezier;   // 段缓动（本帧→下一帧）；缺省线性
}

/** 可 K 帧的属性通道：对象某个可动属性的一条关键帧序列（按 time 升序）。 */
export interface DirectorChannel {
  prop: "position" | "rotation" | "scale" | "uniformScale" | "focus" | "fov" | "opacity";
  axis?: "x" | "y" | "z";     // 向量属性(position/rotation/scale/focus)的分量；标量属性(fov/uniformScale/opacity)省略
  keyframes: DirectorKeyframe[];
}

/** 3D 样条运动路径：对象沿路径移动（替代/叠加 position 通道）。 */
export interface DirectorPath {
  points: Vec3[];                          // 控制点（≥2）
  kind: "catmullrom" | "bezier" | "linear"; // 插值方式
  orient: "free" | "lookAt" | "velocity";   // 朝向策略：不改朝向 / 看向目标 / 沿切线
  lookAtId?: string;                        // orient="lookAt" 时的注视目标对象 id
  closed?: boolean;                         // 闭合环路
}

/** 一个对象(相机/角色/道具)的动画轨道。 */
export interface DirectorTrack {
  targetId: string;                        // 对应 DirectorScene 里对象 id（camera 用其 id / actor.id / prop 复用 actor.id）
  targetKind: "camera" | "actor" | "prop";
  channels: DirectorChannel[];
  path?: DirectorPath;                      // 可选：沿样条运动
  clip?: { start: number; end: number };   // 该对象在时间线上的活动区间(秒)；缺省=整条时间线
}

/** #338 多机位镜头序列的一段：[start,end) 时间段用哪台机位（多机位剪辑/串联）。 */
export interface DirectorCut {
  cameraId: string;   // 该段生效机位 id（DirectorScene.cameras[].id / camera.id）
  start: number;      // 段起(秒)
  end: number;        // 段止(秒)
}

/** 导演台时间线：一组对象轨道 + 播放参数，随节点持久化。 */
export interface DirectorTimeline {
  duration: number;        // 总时长(秒)
  fps: number;             // 采样/导出帧率
  loop?: boolean;
  tracks: DirectorTrack[];
  /** #338 批7 多机位镜头序列：按时间段切换机位，导出时合成单相机「节目流」。空=单机位。 */
  shotSequence?: DirectorCut[];
}

/** 导出用结构化运镜数据（喂视频模型/存编排）。 */
export interface DirectorExportData {
  duration: number;
  fps: number;
  camera: {
    id?: string;
    keyframes: { t: number; position: Vec3; target: Vec3; fov: number }[];
  }[];
  actors: {
    id: string;
    keyframes: { t: number; position: Vec3; rotation: Vec3; scale: number }[];
  }[];
  /** #338 多机位「节目流」：按 shotSequence 逐帧切换机位合成的单相机轨（cut=该帧发生切机）。
   *  无 shotSequence 时缺省。喂视频模型时可用作确定的单条运镜 + 切点表。 */
  program?: {
    keyframes: { t: number; cameraId: string; position: Vec3; target: Vec3; fov: number; cut: boolean }[];
    cuts: { t: number; cameraId: string }[];
  };
}

export interface DirectorNodeData {
  scene?: DirectorScene;     // 3D 场景（编辑器读写、随节点持久化）
  timeline?: DirectorTimeline; // #327 动画层：运动轨迹/关键帧/回放（随节点持久化）
  imageUrl?: string;          // 渲染截图（本节点的图像产出，供下游作参考图）
  imageStorageKey?: string;
  prompt?: string;            // 可选：场景文字描述/备注
  aspectRatio?: string;       // 与 scene.aspectRatio 同步，便于卡片展示
  /** ③ 硬结构句柄：最近一次输出的控制图（深度/法线/骨架）+ 强度。持久化后连线即自动注入下游
   *  ComfyUI 图像节点的 ControlNet（openpose/depth/normal），把「软参考图」升级为「硬结构约束」。 */
  controlMap?: { url: string; kind: "depth" | "normal" | "pose"; strength: number };
  /** #78 截图时由 scene.lights 自动生成的中文光效描述（下游提示词可直接引用）。 */
  lightingDesc?: string;
  /** #110 截图时由激活机位的动画路径（moveTo）推导的中文运镜描述（推/拉/摇/移/升降），
   *  供下游图生视频的运镜提示词直接引用。无动画路径则为空。 */
  cameraMoveDesc?: string;
  /** #78 相机截图库（LibTV「摄像机截图」）：多张暂存，可全部清空 / 发送到画布落成分镜节点。 */
  shots?: { url: string; name: string }[];
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
  /** #332 批6：导出的结构化运镜数据（逐帧相机/对象 TRS+FOV），供图生视频运镜控制/编排引用。 */
  motionExport?: DirectorExportData;
}

export interface NoteNodeData {
  content: string;
  color?: string;
}

/** 图片对比（滑块）节点：两路上游图 A/B，中间可拖滑块左右揭示，验证主体结构一致性。纯前端、无生成。 */
export interface CompareNodeData {
  slider?: number;  // 分隔线位置 0..1（缺省 0.5）
  aUrl?: string;    // 显式覆盖左图（缺省取第 1 个上游图源）
  bUrl?: string;    // 显式覆盖右图（缺省取第 2 个上游图源）
}

export type AudioCategory = "upload" | "music" | "dubbing" | "sfx" | "tools";
export type AudioSource = "upload" | "tts"; // legacy compat
export interface AudioNodeData {
  audioCategory?: AudioCategory;
  /** 生成状态（BaseNode 常驻进度条/失败红条读取，节点收缩后仍可见）。 */
  status?: "processing" | "success" | "failed";
  /** status="failed" 时的错误摘要（BaseNode 红条展示）。 */
  errorMessage?: string;
  // Shared / upload
  name?: string;
  url?: string;
  storageKey?: string;
  duration?: number;
  mimeType?: string;
  size?: number;
  // AI model selection — per-category fields to avoid cross-tab pollution
  musicModel?: string;
  ttsModel?: string;
  sfxModel?: string;
  aiModel?: string; // legacy fallback
  // Music (配乐)
  musicPrompt?: string;
  musicDuration?: number;       // @deprecated 时长由模型版本决定，不再使用（旧节点兼容）
  musicStyle?: string;
  musicInstrumental?: boolean;  // false = generate with vocals
  musicNegativeTags?: string;   // comma-separated keywords to exclude (Suno only)
  musicLyrics?: string;         // MiniMax Music 2.6 lyrics (optional)
  // Dubbing / TTS (配音)
  ttsText?: string;
  ttsVoice?: string;
  ttsSpeed?: number;                              // OpenAI direct models only
  // ElevenLabs V3 TTS (Poyo) — per official OpenAPI
  ttsStability?: number;                          // 0–1
  ttsTimestamps?: boolean;                        // request word-level timestamps.json
  ttsLanguageCode?: string;                       // ISO 639-1
  ttsTextNormalization?: "auto" | "on" | "off";
  ttsTimestampsUrl?: string;                      // download URL when timestamps returned
  // 本地 / 自托管 Gradio TTS（VoxCPM2 等，model === "voxcpm-local"）
  ttsGradioBaseUrl?: string;                      // Gradio 服务地址（如 http://172.16.0.177:8808）
  ttsGradioServerUrls?: string[];                 // 节点级保存的地址列表
  ttsRefWavUrl?: string;                          // 参考音频（克隆音色）——上传所得 URL
  ttsRefWavName?: string;                          // 参考音频显示名
  ttsControlInstruction?: string;                 // 音色/风格控制指令（可选）
  ttsCfg?: number;                                // CFG，默认 2
  ttsDitSteps?: number;                           // 扩散步数，默认 10
  ttsDenoise?: boolean;                           // 参考音频降噪
  ttsDoNormalize?: boolean;                       // 文本规范化
  // #215 对齐官方 VoxCPM2 三种生成方式
  ttsUsePromptText?: boolean;                     // 极致克隆模式：参考音频文本引导（与控制指令互斥）
  ttsPromptText?: string;                         // 参考音频的文字内容（极致克隆用，手动填写）
  ttsSeed?: number;                               // Seed（留空=每次随机）
  ttsTranslateTarget?: string;                    // 配音文本翻译目标语言/方言
  ttsTranslateModel?: string;                     // 翻译所用 AI 模型（可选）
  // SFX (音效) — 对齐 kie elevenlabs/sound-effect-v2 官方 schema
  sfxPrompt?: string;
  /** 0.5–22 秒（步进 0.1）；undefined=模型按描述自动决定时长。 */
  sfxDuration?: number;
  /** 生成可无缝循环的氛围音效。 */
  sfxLoop?: boolean;
  // ── #152 音乐工具（audioCategory="tools"）──
  /** 选中的工具：sep_vocals(人声分离) / cover(翻唱) / extend(续写) / lyrics(写歌词)。 */
  toolModel?: "sep_vocals" | "cover" | "extend" | "lyrics";
  toolAudioUrl?: string;                 // 源音频（上传或从上游音频节点取）
  toolAudioName?: string;                // 源音频显示名
  toolPrompt?: string;                   // cover/extend 风格描述；lyrics 主题
  toolMv?: string;                       // cover/extend 的 Suno 版本（默认 V5）
  toolInstrumental?: boolean;            // cover/extend 纯器乐
  toolSepModel?: "base" | "enhanced" | "instrumental";  // 分离质量
  toolSepOutput?: "general" | "bass" | "drums" | "other" | "piano" | "guitar" | "vocals"; // 分离目标
  toolContinueAt?: number;               // extend 起始秒
  toolStems?: Record<string, string>;    // 分离产出各音轨 URL
  toolLyrics?: string;                   // 写歌词产出文本
  // ── #153 音乐工具第二批：本站生成的 Suno 曲目持久化 audio_id/task_id，供「原生续写」等
  //    依赖 audio_id 的工具使用（非上传路径）。仅当本节点由 Poyo Suno generate-music 产出时写入。
  poyoAudioId?: string;                  // Poyo 曲目唯一 id（原生续写/段落重写入参）
  poyoTaskId?: string;                   // Poyo 生成任务 id
  poyoMv?: string;                       // 产出所用 Suno 版本（V4/V4_5/…），原生续写沿用
  // Legacy compat
  source?: AudioSource;
}

export type CharacterKind = "person" | "scene";
export interface CharacterNodeData {
  characterKind?: CharacterKind;
  // Person (人物)
  name?: string;
  role?: string;
  gender?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  outfit?: string;             // 服装（如：黑色西装 + 红色领带）
  signature?: string;          // 标志性物件 / 特征（如：银怀表 / 左眼疤痕）
  /** #225 外观锚点短语：15-30 字压缩版视觉锚点（发型发色/显著标记/服装主色/体貌），
   *  由「AI 压缩」按钮从 appearance/outfit/signature 提炼或手填。非空且未被切到
   *  「全量注入」时，提示词注入用「名字，身份，锚点」替代全量字段模板——省 token、
   *  跨镜头措辞恒定更利一致性。全量字段原样保留，仅不参与注入；customPromptTemplate
   *  优先级更高（自定义模板存在时锚点不生效）。 */
  appearanceAnchor?: string;
  /** false = 恢复全量注入（角色卡小按钮切换）；undefined/true = 有锚点即压缩注入（默认压缩）。 */
  appearanceAnchorEnabled?: boolean;
  // Scene (场景)
  sceneName?: string;
  locationType?: string;
  sceneDescription?: string;
  atmosphere?: string;
  timeOfDay?: string;
  /** #271 定妆照/场景图生成运行态：生成中 "processing"（BaseNode 常驻进度条据此显示，
   *  节点收缩也可见）、失败 "failed"（常驻红条 + errorMessage）；成功后清除。属
   *  CLONE_RUNTIME_FIELDS——复制节点自动剥离、协作广播自动过滤，不会污染他人进度。 */
  status?: "processing" | "failed";
  progress?: number;
  errorMessage?: string;
  /** #272 入库来源项目 id（零迁移：写在角色库条目的 payload JSON 里，面板据此分项目
   *  检索）。库条目再实例化为节点时随 payload 带回，无任何运行时语义、纯溯源标记。 */
  librarySourceProjectId?: number;
  // Shared
  referenceImageUrl?: string;
  referenceStorageKey?: string;
  notes?: string;
  /**
   * Multi-angle reference images. Beyond the main referenceImageUrl, users
   * can attach up to 4 alternate views (side / back / close-up / outfit
   * detail) — Higgsfield Soul / IP-Adapter-style models can use the extra
   * views for better identity preservation. Downstream nodes only consume
   * referenceImageUrl today; the extras are passed through for forward
   * compatibility with multi-image conditioning.
   */
  additionalImageUrls?: string[];
  /**
   * 角色携带的音频 / 视频参考（@音频 / @视频 的「角色携带」来源）。供全能（omni）
   * 模型把角色的声音 / 动作视频一并作为参考输入（见 characterConditioning.ts 的
   * effectiveCharacterAudioRefs / effectiveCharacterVideoRefs）。镜像图片参考的结构：
   * referenceXxxUrl 为主项，additionalXxxUrls 为附加项。库 payload 存任意字段，无需迁移。
   */
  referenceAudioUrl?: string;
  additionalAudioUrls?: string[];
  referenceVideoUrl?: string;
  additionalVideoUrls?: string[];
  /**
   * Optional user-authored template that overrides the auto-generated
   * prompt injection. Supports the same `{name}`, `{outfit}` etc.
   * placeholders documented in lib/characterPrompt.ts.
   */
  customPromptTemplate?: string;
  /**
   * Identity conditioning for ComfyUI generation (consumed when a character is
   * connected upstream of a comfyui_image node — see lib/characterConditioning.ts).
   * Reference image(s) drive IPAdapter face-lock; an optional character LoRA is
   * added to the lora stack. All optional; absence = current text-only behavior.
   */
  /** 角色声音档案（casting）：镜头表「角色音色」分配后回写到同名角色节点，
   *  跨项目复用该角色时作为默认音色。 */
  voiceModel?: string;        // 配音模型 id（如 elevenlabs-v3-tts）
  voiceId?: string;           // 该模型下的音色 id
  loraName?: string;          // character-specific LoRA filename on the ComfyUI server
  loraStrength?: number;      // LoRA model strength (default 0.8)
  ipadapterWeight?: number;   // IPAdapter face-lock strength 0–2 (default 0.8)
  /** 一致性种子：设置后，「应用到连接的分镜 / 套用到本场景」会把同一 seed 钉到该角色的
   *  所有下游生成节点（image_gen 等），让同一角色跨镜头用相同随机种子，最大化一致性。
   *  未设置 = 各镜头自由随机（现状）。 */
  consistencySeed?: number;
}

export type PostProcessOp = "upscale2x" | "upscale4x" | "denoise" | "sharpen" | "fps2x";
export interface PostProcessNodeData {
  // New: rich effect selection
  selectedEffects?: string[];
  effectIntensities?: Record<string, number>;
  generatedPrompt?: string; // auto-generated English prompt from selected effects
  // Legacy: simple operation mode (keep for compat)
  operation?: PostProcessOp;
  inputImageUrl?: string;
  inputVideoUrl?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

// ── Image edit (cloud one-click 图像编辑：抠图/扩图/局部重绘/擦除/重打光/改比例) ──
// A real executor node: it sends the upstream image + an operation-derived edit
// instruction to an edit-capable image model (higgsfield / KIE / Poyo) through the
// SAME generateImage pipeline image_gen/pose_control use, so it works wherever those
// do. Distinct from comfyui_image (local ComfyUI inpaint) and post_process (a pure
// prompt helper that produces no image).
export type ImageEditOp = "remove_bg" | "outpaint" | "inpaint" | "erase" | "relight" | "reframe" | "upscale" | "reangle" | "emotion";
export interface ImageEditNodeData {
  operation?: ImageEditOp;
  /** cloud = Higgsfield/KIE/Poyo edit models; comfyui = local ComfyUI inpaint/img2img. */
  backend?: "cloud" | "comfyui";
  /** Edit-capable image model (subset of IMAGE_GEN_MODELS). Empty = server default. (cloud) */
  model?: string;
  /** ComfyUI server URL (empty → server-side COMFYUI_BASE_URL). (comfyui) */
  comfyBaseUrl?: string;
  /** ComfyUI checkpoint name (required for comfyui backend). */
  ckpt?: string;
  /** Source image — auto-detected from an upstream image node, or pasted manually. */
  sourceImageUrl?: string;
  /** Mask (inpaint/erase). cloud: extra context image; comfyui: true inpaint mask. */
  maskUrl?: string;
  /** User instruction (relight look / outpaint scene / inpaint fill / erase target). */
  prompt?: string;
  /** Target aspect ratio for outpaint/reframe (e.g. 16:9 / 9:16 / 1:1). */
  aspectRatio?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  progress?: number;
  errorMessage?: string;
}

export interface GroupNodeData {
  label?: string;
  color?: string;
  collapsed?: boolean;
  childIds?: string[];
  /** 折叠成小条前的容器高度，展开时恢复（见 toggleGroupCollapsed）。 */
  expandedHeight?: number;
}

export interface ClipNodeData {
  // Source (auto-detected from connected nodes)
  inputVideoUrl?: string;
  inputAudioUrl?: string;
  sourceDuration?: number;   // total duration of the source video (seconds)
  // Trim points
  startTime?: number;        // seconds, default 0
  endTime?: number;          // seconds, default = sourceDuration
  // Speed
  speed?: number;            // 0.1-10.0, default 1.0
  // Audio mix (external connected track)
  audioVolume?: number;      // 0.0-2.0, default 1.0
  // ── Picture/audio adjustments (all optional, default = neutral) ──
  reverse?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  brightness?: number;       // -1..1, neutral 0
  contrast?: number;         // 0..2, neutral 1
  saturation?: number;       // 0..3, neutral 1
  aspect?: "original" | "9:16" | "16:9" | "1:1";
  fadeIn?: number;           // seconds
  fadeOut?: number;          // seconds
  muteOriginal?: boolean;    // drop the source's own audio
  mixAudio?: boolean;        // mix external audio with original instead of replacing
  originalVolume?: number;   // 0..2 for source's own audio, default 1.0
  originalIsVoice?: boolean; // mark source audio as ducking voice key
  denoiseAudio?: boolean;    // afftdn on source audio
  // ── Multi-track audio (per source-node settings, keyed by audio node id) ──
  audioTracks?: Record<string, {
    volume?: number;         // 0..2, default 1
    delay?: number;          // seconds start offset
    muted?: boolean;
    solo?: boolean;
    fadeIn?: number;
    fadeOut?: number;
    isVoice?: boolean;       // ducking key
  }>;
  // ── Pro: loudness / ducking / color / output ──
  loudnorm?: boolean;        // EBU R128 normalize final mix
  ducking?: boolean;         // voice ducking when a source is marked voice
  colorPreset?: "none" | "cinematic" | "warm" | "cool" | "bw" | "vintage" | "vivid";
  output?: { resolution?: "source" | "720p" | "1080p" | "4k"; fps?: number; upscale?: 2 | 4 | 6; fpsInterpolate?: boolean; format?: "mp4" | "webm" };
  // Output
  outputUrl?: string;
  outputDuration?: number;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

// #244 批1 转场库精选扩充（自然向，均为 ffmpeg xfade 原生转场名）：
// none=直切（默认，现状不变）；fade/dissolve 为历史值；新增 fadeblack（经黑场，
// 换场景/换时间的电影感过渡）、fadewhite（经白场，回忆/梦境感）、smoothleft（平滑推移）。
export type MergeTransition = "none" | "fade" | "dissolve" | "fadeblack" | "fadewhite" | "smoothleft";
/** 逐接缝可选转场（含 wipe 装配端历史值）。 */
export type MergeSeamTransition = MergeTransition | "wipe";
/** UI 下拉共用选项（value 顺序即展示顺序）。 */
export const MERGE_TRANSITION_OPTIONS: { value: MergeTransition; label: string }[] = [
  { value: "none", label: "直切（默认）" },
  { value: "fade", label: "淡入淡出" },
  { value: "dissolve", label: "叠化" },
  { value: "fadeblack", label: "经黑场（电影感）" },
  { value: "fadewhite", label: "经白场" },
  { value: "smoothleft", label: "平滑推移" },
];
export interface MergeNodeData {
  inputVideoUrls?: string[];
  outputUrl?: string;
  transition?: MergeTransition;
  /** 逐切点转场（长度=段数-1，优先于全局 transition）。来源：「按镜头表装配」自动写入，
   *  或 #244 参数面板「逐接缝转场」手动编辑；两者都同时写 inputVideoUrls 快照，发送时经
   *  aligned 守卫（顺序变了即失配丢弃回全局）。 */
  segTransitions?: MergeSeamTransition[];
  /** 装配端：逐段配音轨（与 inputVideoUrls 对位；null=该段无配音）。 */
  voiceUrls?: (string | null)[];
  /** 装配端：逐段音效轨（与 inputVideoUrls 对位；混入权重低于配音）。 */
  sfxUrls?: (string | null)[];
  /** 装配端：逐镜对白快照（来自分镜 dialogue；下游字幕节点「从镜头表生成字幕」消费）。 */
  segDialogues?: (string | null)[];
  /** 装配端：逐镜配音时长（秒；字幕在配音结束处收口用）。 */
  segVoiceDurations?: (number | null)[];
  /** 合并完成后服务端回传的各段成片起点（xfade offset 精确值；字幕对位的时间轴真相源）。 */
  segStarts?: number[];
  /** 装配端：段↔分镜/视频节点绑定（sb=分镜 id，vid=视频节点 id；按镜定位/重生成入口）。 */
  sourceShots?: { sb: string | null; vid: string; num?: number | string }[];
  /** 装配端：合并完成后用镜头表对白 + segStarts 直接把字幕烧进成片（免下游字幕节点）。 */
  burnShotSubtitles?: boolean;
  /** 内嵌字幕字号（默认 22）。 */
  subFontSize?: number;
  transitionDuration?: number;  // 0.1–2.0 seconds, default 0.5
  bgMusicUrl?: string;
  bgMusicVolume?: number;       // 0.0–1.0, default 0.3
  originalVolume?: number;      // 原视频自带声音音量 0.0–2.0, default 1
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
  outputDuration?: number;
}

export interface SubtitleEntry {
  start: number;  // seconds
  end: number;    // seconds
  text: string;
}

export interface SubtitleNodeData {
  inputVideoUrl?: string;
  entries?: SubtitleEntry[];
  language?: string;
  transcribeModel?: string; // 转录模型（whisper-1 / gpt-4o-transcribe / gpt-4o-mini-transcribe）
  outputUrl?: string;
  srtContent?: string;
  status?: "idle" | "transcribing" | "burning" | "done" | "failed";
  errorMessage?: string;
  burnInEnabled?: boolean;
  fontSize?: number;             // 14–36, default 22
  fontColor?: string;            // CSS color, default "white"
  /** #334 已套用的字幕时间微调（秒，正=延后）。补偿 Whisper 段级时间戳提前偏差；
   *  entries 已烘焙此偏移，本字段仅记录当前值供 UI 增量调整。 */
  timingOffsetSec?: number;
}

export type OverlayMode = "watermark" | "pip" | "color_correction";
export interface OverlayNodeData {
  mode?: OverlayMode;
  // Watermark
  overlayImageUrl?: string;
  overlayPosition?: "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
  overlayScale?: number;     // 0.05–1.0
  overlayOpacity?: number;   // 0.0–1.0
  // PiP
  pipVideoUrl?: string;
  pipPosition?: "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
  pipScale?: number;         // 0.1–0.5
  // Color correction
  brightness?: number;       // -1.0–1.0
  contrast?: number;         // 0.0–2.0 (FFmpeg eq contrast range)
  saturation?: number;       // 0.0–3.0
  // Common
  inputVideoUrl?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export type SubtitleMotionStyle = "fade" | "roll" | "karaoke" | "bounce";

export interface SubtitleMotionNodeData {
  inputVideoUrl?: string;
  entries?: SubtitleEntry[];
  language?: string;
  transcribeModel?: string; // 转录模型（whisper-1 / gpt-4o-transcribe / gpt-4o-mini-transcribe），与字幕节点一致
  motionStyle?: SubtitleMotionStyle;
  fontSize?: number;
  fontColor?: string;
  outputUrl?: string;
  status?: "idle" | "transcribing" | "burning" | "done" | "failed";
  errorMessage?: string;
}

export interface SmartCutNodeData {
  /** 选段决策 LLM（转写文本 → 保留片段判定）。未设时用全局 AI 工具偏好，再兜底平台默认。 */
  llmModel?: string;
  /** #100 场景检测切点（秒，clip.detectScenes 产出）——剪辑边界吸附用。 */
  sceneBoundaries?: number[];
  inputVideoUrl?: string;
  aggressiveness?: "low" | "medium" | "high";
  targetDuration?: number;
  originalDuration?: number;
  outputDuration?: number;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export interface PoseControlNodeData {
  referenceImageUrl?: string;
  referenceStorageKey?: string;
  prompt?: string;
  guidanceScale?: number;
  outputImageUrl?: string;
  outputUrl?: string; // alias written alongside outputImageUrl so getNodeVideoUrl / downstream nodes can read it
  outputStorageKey?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export interface VoiceCloneNodeData {
  referenceAudioUrl?: string;
  text?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export interface LipSyncNodeData {
  inputVideoUrl?: string;
  inputAudioUrl?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export interface AvatarNodeData {
  avatarDescription?: string;
  script?: string;
  outputUrl?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

// ── ComfyUI ────────────────────────────────────────────────────────────────────
export interface ComfyuiLoraEntry {
  name: string;
  strengthModel: number;
  strengthClip?: number;
}

export interface ComfyuiControlNet {
  model: string;
  imageUrl: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  /** Optional aux preprocessor node class (canny/depth/openpose…). */
  preprocessor?: string;
}

export interface ComfyuiIPAdapter {
  model: string;
  imageUrl: string;                 // primary reference (back-compat; mirrors imageUrls[0])
  imageUrls?: string[];             // multi-image style/face conditioning (chained server-side)
  clipVision?: string;
  weight?: number;
}

/**
 * Optional separate CLIP loader, for checkpoints that don't embed a CLIP/text
 * encoder (Flux / SD3 / some UNet-only files → CheckpointLoaderSimple returns a
 * null CLIP and CLIPTextEncode fails with "clip input is invalid: None").
 * 1 name → CLIPLoader; 2 → DualCLIPLoader (Flux/SDXL); 3 → TripleCLIPLoader (SD3).
 * `clipType` is the CLIPLoader/DualCLIPLoader `type` (e.g. "flux", "sdxl", "sd3",
 * "qwen_image"); TripleCLIPLoader takes no type.
 */
export interface ComfyuiClipLoader {
  clipType: string;
  name1: string;
  name2?: string;
  name3?: string;
}

/** Diffusion model architecture — selects the ComfyUI graph shape. */
export type ComfyuiArch = "sd" | "flux" | "sd3" | "qwen";

export type ComfyuiImageTemplate = "txt2img" | "img2img" | "inpaint";
export interface ComfyuiImageNodeData {
  // Connection
  customBaseUrl?: string;       // empty = use server-side global default
  serverUrls?: string[];        // saved server addresses for quick selection (persisted on node)
  /** When created from a template-library entry, its label — shown as the node's
   *  corner annotation in preference to the model-derived name. */
  templateLabel?: string;
  workflowTemplate: ComfyuiImageTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  /** When on, a workflow run pushes this node's prompt(s) to downstream
   *  comfyui_video nodes before they run, so the video matches the image. */
  sendPromptToVideo?: boolean;
  /** After a successful run, unload models + free VRAM on the ComfyUI server when
   *  its queue is idle (no other task on that GPU). Local servers only. Default OFF. */
  freeVramAfterRun?: boolean;
  // Models
  ckpt?: string;
  lora?: string;
  loraStrength?: number;
  /**
   * Multi-LoRA stack. When present and non-empty it takes precedence over the
   * legacy single `lora`/`loraStrength`. Each entry chains a LoraLoader.
   */
  loras?: ComfyuiLoraEntry[];
  /** Optional ControlNet guidance for txt2img / img2img. */
  controlnet?: ComfyuiControlNet;
  /** Optional IPAdapter style/face reference. */
  ipadapter?: ComfyuiIPAdapter;
  /** Optional separate CLIP loader for checkpoints that don't embed CLIP. */
  clip?: ComfyuiClipLoader;
  /** Diffusion architecture (default "sd" = classic CheckpointLoaderSimple graph). */
  arch?: ComfyuiArch;
  /** Model loader: full checkpoint, or a standalone UNet/diffusion-model file. */
  modelSource?: "checkpoint" | "unet";
  /** UNETLoader weight dtype (e.g. "default", "fp8_e4m3fn"); modelSource="unet" only. */
  unetWeightDtype?: string;
  /** Flux guidance value (FluxGuidance node). */
  guidance?: number;
  /** ModelSampling shift for SD3 (ModelSamplingSD3) / Qwen (ModelSamplingAuraFlow). */
  shift?: number;
  /** Optional model-based upscale (UpscaleModelLoader name); empty = none. */
  upscaleModel?: string;
  // Sampling
  steps?: number;
  cfg?: number;
  seed?: number;
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  vae?: string;
  batchSize?: number;
  // I/O
  referenceImageUrl?: string;
  /** Multi-angle reference images (see ReferenceImage). [0].url mirrors referenceImageUrl. */
  referenceImages?: ReferenceImage[];
  /** Inpaint mask (white = regenerate). Drawn over the reference image. */
  maskUrl?: string;
  imageUrl?: string;
  imageStorageKey?: string;
  imageUrls?: string[];
  /** Collapsed hero preview mode when a batch produced multiple images:
   *  "grid" shows the whole grid (default), "single" shows only the selected image. */
  heroView?: "grid" | "single";
  /** 生成版本历史（#5 一键回滚）：每产出一张新图追加一条快照，最新在前，封顶 12。 */
  resultHistory?: ResultSnapshot[];
  progress?: number;
  queueRemaining?: number;  // ComfyUI server queue depth while waiting to start (transient)
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export type ComfyuiVideoTemplate = "animatediff" | "svd" | "wan_t2v" | "wan_i2v" | "ltxv";
export interface ComfyuiVideoNodeData {
  // Connection
  customBaseUrl?: string;
  serverUrls?: string[];        // saved server addresses for quick selection (persisted on node)
  /** Template-library label (preferred corner annotation when set). */
  templateLabel?: string;
  workflowTemplate: ComfyuiVideoTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  /** After a successful run, unload models + free VRAM on the ComfyUI server when
   *  its queue is idle (no other task on that GPU). Local servers only. Default OFF. */
  freeVramAfterRun?: boolean;
  // Models
  ckpt?: string;
  /** Character/style LoRAs — applied to checkpoint-based templates (AnimateDiff);
   *  auto-filled from a connected Character node's LoRA. */
  loras?: ComfyuiLoraEntry[];
  motionModule?: string;
  /** CLIP/T5 text encoder (Wan / LTX use a separate CLIPLoader). */
  clip?: string;
  /** CLIP Vision model (Wan I2V start-frame encoding). */
  clipVision?: string;
  // Sampling
  steps?: number;
  cfg?: number;
  seed?: number;
  frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  vae?: string;
  batchSize?: number;
  // I/O
  referenceImageUrl?: string;
  /** Multi-angle reference images (see ReferenceImage). [0].url mirrors referenceImageUrl. */
  referenceImages?: ReferenceImage[];
  /** Final video URL. comfyui_video deliberately reuses video_task's `resultVideoUrl`
   *  name (not the `outputUrl` used by clip/merge/comfyui_workflow). This split is
   *  historical, not a principled convention — see getNodeVideoUrl in useWorkflowRunner.ts.
   *  Downstream bridges both with `resultVideoUrl ?? outputUrl ?? url`. */
  resultVideoUrl?: string;
  resultStorageKey?: string;
  progress?: number;
  queueRemaining?: number;  // ComfyUI server queue depth while waiting to start (transient)
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

/** Semantic role of a param — drives precise auto-fill from upstream nodes
 *  (positive/negative prompt, reference/control image, inpaint mask). */
export type WorkflowParamRole = "positive" | "negative" | "reference" | "control" | "mask";

export interface WorkflowParamBinding {
  nodeId: string;
  fieldPath: string;
  label: string;
  type: "text" | "number" | "select" | "image" | "audio" | "boolean";
  role?: WorkflowParamRole;
  defaultValue?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** 该绑定的节点 class_type（分析时记录，供「id 被复用成别的节点」的守卫校验）。 */
  classType?: string;
  /** 主次优先级：1=主参数（提示词/尺寸/主模型/steps/cfg/seed），2=次要。缺省按 2 处理。
   *  由 AI 辅助分析或启发式赋值，前端据此把主参数排在前、次要参数折叠。 */
  priority?: number;
}

export interface ComfyuiWorkflowNodeData {
  customBaseUrl?: string;
  /** 真 3D（Tripo3D）已生成的模型——重开免费复用。 */
  model3d?: Model3DResult;
  /** 瞬态：由「工具栏一键导入 ComfyUI 工作流」创建时置 true，节点挂载即打开导入向导后清除。 */
  _openWizard?: boolean;
  serverUrls?: string[];        // saved server addresses for quick selection (persisted on node)
  // When true, run on the official ComfyUI cloud (cloud.comfy.org) instead of the
  // local/self-hosted server. The cloud endpoint + API key live server-side; only
  // admins / whitelisted users may enable this. Border tint indicates the mode.
  useCloudComfy?: boolean;
  workflowJson?: string;
  workflowName?: string;
  /** Template-library label (preferred corner annotation when set). */
  templateLabel?: string;
  /** Seed handling on run: when true (default), seed params are re-randomized
   *  each run; when false, the fixed value from the form is used as-is. */
  randomizeSeed?: boolean;
  /** 按项目比例覆盖工作流尺寸：开启后，提交前把所有空 latent 节点的 width/height 按
   *  `aspectRatio` 改写（保留原像素面积、/64 对齐）。比例由 `aspectRatio` 决定。 */
  overrideRatioSize?: boolean;
  aspectRatio?: string;
  /** #161 帧数跟随上游时长：开启后每次运行按「上游时长 × fps」自动覆盖帧数参数（上游无时长则保持当前值）。 */
  framesFollowUpstream?: boolean;
  /** Whether a connected upstream prompt/storyboard OVERRIDES this node's
   *  positive/negative prompt params even if the user typed a value. Defaults to
   *  ON (undefined ⇒ upstream-priority); set explicitly to false for "fill only
   *  when blank / at the workflow's default". */
  preferUpstreamPrompt?: boolean;
  /** Whether this workflow node re-emits its effective prompt to DOWNSTREAM nodes
   *  (acting as a transparent prompt forwarder). Defaults to ON (undefined ⇒
   *  forward); set false to stop the prompt at this node. */
  forwardPrompt?: boolean;
  /** After a successful run, unload models + free VRAM on the ComfyUI server — but
   *  only when that server's queue is idle (no other task on the GPU). Each GPU is
   *  its own ComfyUI process/baseUrl, so this targets exactly the node's server.
   *  Local servers only (cloud skipped). Defaults to OFF (undefined/false ⇒ keep). */
  freeVramAfterRun?: boolean;
  paramBindings?: WorkflowParamBinding[];
  paramValues?: Record<string, unknown>;
  /** Explicit per-image-param source: paramKey → upstream nodeId. Unmapped params
   *  auto-fill from connected upstream images in smart order. */
  imageSourceMap?: Record<string, string>;
  /** 同 imageSourceMap，但针对音频参数（VHS_LoadAudioUpload 等）：paramKey → 上游音频节点 id。 */
  audioSourceMap?: Record<string, string>;
  outputNodeIds?: string[];
  /** All detected output nodes (for the "输出选择" UI). */
  outputNodes?: { id: string; classType: string; isVideo: boolean }[];
  outputType?: "image" | "video" | "auto";
  outputUrl?: string;
  outputUrls?: string[];
  /** 生成版本历史（#5 一键回滚）：仅图像输出记录，每产出一张新图追加一条快照，封顶 12。 */
  resultHistory?: ResultSnapshot[];
  progress?: number;
  queueRemaining?: number;  // ComfyUI server queue depth while waiting to start (transient)
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
  /** #163 瞬态：隧道切断超长 HTTP 后，服务端经 socket(comfyui:result) 回灌的终局结果，
   *  节点据此兜底回填、结束「运行中」。消费后清空。 */
  pendingComfyResult?: { jobId: string; ok: boolean; urls?: string[]; outputType?: "image" | "video"; error?: string };
}

// ── Agent (Copilot) node ──────────────────────────────────────────────────────
/** One graph operation proposed by the agent. The client validates + applies it
 *  through the canvas store (create/connect/update/delete), so every change is
 *  undoable & persisted exactly like a manual edit. */
export interface AgentOperation {
  /** #260 新增 "library"：把用户附件图存入角色/场景库并命名（「将此图加入角色库，名称为李宁」）。
   *  该操作不落画布节点，由 CanvasAgentChat 应用层在 applyAgentOperations 之前抽走并调用
   *  characterLibrary.create 执行（agentApply 保持纯画布语义，不做网络请求）。 */
  /** #267 新增 "group"（把 targetRefs 指定的多个节点编成一个「群组」容器）与
   *  "duplicate"（复制 targetRef 节点为副本；副本剥离运行时/产物字段，可带 tempId
   *  供同批后续 connect/update 引用）。两者都是纯画布确定性操作，不发任何网络请求。 */
  /** #269 新增 "align"：把 targetRefs 指定的多个节点按 mode（横排/竖排/宫格）就地
   *  重新排列——与 #124 整理布局同一套按实际节点尺寸留间距的算法，但只作用于指定
   *  节点（整理布局是全画布自由节点）。纯画布确定性操作、一步可撤销。 */
  op: "create" | "update" | "connect" | "delete" | "canvas" | "library" | "group" | "duplicate" | "align";
  /** group / align: 要编组/排列的节点引用列表（≥2 个；可混用已存在节点 id 与本批 tempId）。 */
  targetRefs?: string[];
  /** align: 排列方式——row=横向一排、column=垂直一列、grid=宫格。sanitize 层对缺失/
   *  非法值统一回退 grid（与 video_task 参数「非法丢弃回退默认」同一容错哲学）。 */
  mode?: "row" | "column" | "grid";
  /** canvas: 画布级动作（不针对单个节点）——极简显示开/关、整理布局、适应视图、批量下载成品。
   *  #266 新增三个「口令直达」动作：
   *   - assemble：按镜头表装配合并节点（targetRef 可选：省略时自动定位画布上唯一的
   *     合并节点；复用 assembleFromStoryboards 确定性逻辑，与节点上的装配按钮同源）。
   *   - run_all：请求运行画布全部可运行节点。仅置 store.runRequest 信号——真正执行
   *     走 Canvas 既有的运行确认流程（费用可见、用户点确认才跑），助手绝不直接扣费。
   *   - run_node：请求运行 targetRef 指定的单个节点（同样走运行确认流程）。 */
  /** #268 批③：animatic=一键动态样片（分镜关键帧图+镜头表时长/转场直接渲染预览片，
   *  不花生成模型的钱；由 CanvasAgentChat 应用层执行 tRPC 渲染管线，apply 层不消费）；
   *  ungroup=解组（targetRef 可选：省略时自动定位唯一群组；仅删容器、成员保留）。 */
  /** #269 批④：focus_node=把视口聚焦到 targetRef 指定的节点（放大居中，与双击节点
   *  聚焦 #123 同一套视口逻辑；targetRef 必填——无目标的聚焦没有意义，sanitize 层
   *  与 run_node 同口径直接 drop）。纯视口操作，不改画布数据、不入撤销历史。 */
  /** #272 批⑤：save_library=把画布上的角色/场景节点保存进角色库（targetRef 可选：
   *  省略=画布全部有名字的 character 节点）。需要 tRPC（characterLibrary.create），
   *  由 CanvasAgentChat 应用层在画布操作落地后抽走执行——apply 层纯 store 不发网络
   *  （与 animatic/library 同一架构边界）。同名条目跳过不覆盖（保护既有库内容）。 */
  action?: "minimal_on" | "minimal_off" | "arrange_layout" | "fit_view" | "download_all" | "assemble" | "run_all" | "run_node" | "animatic" | "ungroup" | "focus_node" | "save_library" | "fetch_details" | "set_voice" | "dub_shots";
  /** #295 canvas set_voice：锁定角色音色——targetRef 指向角色（id/短号/tempId/角色名），
   *  两字段取值必须来自 shared/dubbingVoices 目录（sanitize 与 apply 双层校验，防幻觉
   *  音色 id）。落地写入角色节点声音档案 voiceModel/voiceId 并 fill-only 同步脚本
   *  castVoices——与「角色配音·Casting」面板同一套数据，批量配音按角色套用。 */
  voiceModel?: string;
  voiceId?: string;
  /** library: 入库类型——person=角色库、scene=场景库。 */
  libraryKind?: "person" | "scene";
  /** library: 库条目名称（用户指定原文，如「李宁」「足球场」），入库后可 @名称 引用。 */
  name?: string;
  /** create: agent-assigned temp id so later `connect` ops can reference the
   *  not-yet-created node. */
  tempId?: string;
  nodeType?: NodeType;          // create
  title?: string;               // create / update
  /** create / update: whitelisted payload fields for the target node type. */
  payload?: Record<string, unknown>;
  targetRef?: string;           // update / delete / connect target (tempId or real node id)
  sourceRef?: string;           // connect source (tempId or real node id)
  sourceHandle?: string;
  targetHandle?: string;
  /** create: scene grouping key (e.g. "s1"). Nodes sharing a sceneGroup are laid
   *  out together and wrapped in an auto-created `group` "场景" container by the
   *  apply layer. Used by duration-aware scene planning. */
  sceneGroup?: string;
  /** Short human-readable rationale shown in the proposal preview. */
  note?: string;
  status?: "proposed" | "applied" | "rejected" | "failed";
  error?: string;
}

/** 管线下一步引导（apply 后确定性推导：分镜→批量生产→装配→内嵌字幕）。 */
export interface PipelineStep {
  action: "open_shotlist" | "assemble" | "burn_subtitle";
  label: string;
  hint: string;
  /** 目标节点 id（open_shotlist→分镜，assemble/burn→合并）。 */
  targetId: string;
  /** 已完成（合并已装配 / 已开内嵌字幕）。 */
  done?: boolean;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  /** assistant only: the graph operations proposed in this turn. */
  operations?: AgentOperation[];
  /** assistant only: 管线下一步引导卡（与 operations 互斥，apply 后追加）。 */
  pipeline?: PipelineStep[];
  /** assistant only: 时长拆解摘要（目标秒数/每镜秒数/镜头数），供计划大纲展示。 */
  plan?: { targetSeconds: number; perShotSeconds: number; shots: number; templateLabel?: string };
  /** assistant only: LLM 提议但被服务端校验丢弃的操作原因（去重，≤6 条），供「N 项被忽略」提示。 */
  dropped?: string[];
}

export interface AgentNodeData {
  messages?: AgentMessage[];
  model?: string;
  /** 仅 ComfyUI 生成：开启后生成只走 comfyui_workflow 自定义工作流节点（从模板库选模板）。 */
  comfyOnlyMode?: boolean;
  /** 自动应用：智能体规划后直接把操作应用到画布，无需手动点「应用」。 */
  autoApply?: boolean;
  /** 自动执行：应用后自动发起工作流运行（仍经画布的运行确认弹窗）。「一句话成片」。 */
  autoRun?: boolean;
  /** 规划控制偏好：用户在「规划设置」对话框里的特殊要求，发送时拼成约束注入 Agent。 */
  planPrefs?: AgentPlanPrefs;
  /** 「模板选择」对话框里为生图/图生视频指定的 comfyui_workflow 模板（留空=自动选择）。
   *  `asked` 记录仅ComfyUI模式下是否已弹窗询问过模板，避免每次发送都打断。 */
  templatePrefs?: { imageTemplateId?: number; videoTemplateId?: number; asked?: boolean };
  status?: "idle" | "thinking" | "failed";
  errorMessage?: string;
}

/** 超级智能体（工程智能体）节点。Phase 1：ComfyUI 工作流自动编写/调试；Phase 2：代码任务。 */
export interface SuperAgentNodeData {
  /** 模式：comfy=ComfyUI 工作流工具环（默认）；code=无头 Claude Code 编码任务（需服务端开启）。 */
  mode?: "comfy" | "code";
  /** 自然语言任务（如「做一个 Flux + LoRA 的高清出图工作流并调通」）。 */
  task?: string;
  /** 目标 ComfyUI 服务器（留空用服务端 COMFYUI_BASE_URL）。字段名与其它 ComfyUI 节点一致
   *  （customBaseUrl），以便服务器状态/清理/删减等全画布工具统一覆盖本节点。 */
  customBaseUrl?: string;
  /** 已保存的 ComfyUI 服务器地址列表（与其它 ComfyUI 节点一致）。 */
  serverUrls?: string[];
  /** 规划用 LLM 模型。 */
  model?: string;
  /** 最大自驱轮次（每轮=一次 LLM 决策 + 工具调用）。留空用服务端默认（50）。上限 60。
   *  复杂工作流可调高换更强自愈，代价是更慢/更多 LLM 调用。 */
  maxIterations?: number;
  /** 「加载全部资源」：系统提示不截断，列出服务器全部已装模型/LoRA/节点（配合大上下文模型）。
   *  留空默认 true（默认勾选，不截断）；显式 false 才关闭。 */
  showAllResources?: boolean;
  /** 是否使用记忆体（资源记忆 + 工作流经验召回）。默认 true；false=本次忽略记忆、直接读真机。 */
  useMemory?: boolean;
  /** B1 产物验收：工作流跑通后用视觉模型质检首张产物图，未过喂回智能体自动再修一轮（仅一次）。默认关。 */
  verifyOutput?: boolean;
  /** 「自动运行」：节点建好后自动用 task 开跑一次（画布助手编排用）。触发后即清除，避免重复运行。 */
  autoRun?: boolean;
  /** 「编排模式」(B阶段)：把输入当复杂目标，自动拆成多个子任务逐个搭建，成功的各落一个 comfyui_workflow 节点。 */
  orchestrate?: boolean;
  /** B2 能力路由「自动路由」：运行前先轻量拆解任务，拆出多个独立子任务则自动改走编排、
   *  否则按单份工作流构建（续接对话不路由）。与 orchestrate 互斥（编排勾选时优先）。默认关。 */
  autoRoute?: boolean;
  status?: "idle" | "running" | "success" | "failed" | "exhausted" | "aborted";
  /** ComfyUI 模式连续对话记录（用户指令 + 智能体每轮结果摘要）。 */
  conversation?: { role: "user" | "agent"; text: string; workflowJson?: string; status?: string }[];
  /** 聊天输入框当前文本（持久化，防误删）。 */
  input?: string;
  /** 已写回/链接的 comfyui_workflow 节点 id：后续调参同步到它并可一键重新生成。 */
  appliedNodeId?: string;
  /** 「产物目标」下游节点 id（通常是 merge）：调通后把产出的 comfyui_workflow 节点自动连到它，
   *  打通「全自动成片」。super_agent 自身无出线桩，画布助手连 super_agent→下游时由 apply 层转记于此。 */
  wireToNodeId?: string;
  /** 设置区（服务器/模型）是否展开（有对话后默认收起，减少干扰）。 */
  settingsOpen?: boolean;
  /** 流式活动日志（socket 回灌，非持久）。 */
  log?: { type: string; iteration: number; message: string }[];
  /** 调通后的 workflow JSON（可一键写回 comfyui_workflow 节点）。 */
  resultWorkflowJson?: string;
  /** 调通后的结构分析（参数绑定/输出节点/输出类型）。 */
  resultAnalysis?: { paramBindings?: unknown[]; outputNodeIds?: string[]; outputType?: string };
  /** 隧道下 HTTP 长请求可能被切断（cloudflared ~100s/请求），服务端跑完后把最终结果经 socket 回灌到此
   *  瞬态字段，节点据此兜底回填（非持久，应用后即清空）。 */
  pendingBuildResult?: unknown;
  /** code 模式：任务最终文本结果。 */
  codeResult?: string;
  /** code 模式连续对话记录（用户任务 + 智能体每轮结果/失败摘要）。 */
  codeConversation?: { role: "user" | "agent"; text: string; status?: string }[];
  /** code 模式：claude 会话 id，下一轮据此 --resume 续接（claude 保留完整上下文与工作区文件）。 */
  codeSessionId?: string;
  /** code 模式：被 commandPolicy 拦截而中止的危险命令。 */
  blockedCommand?: string;
  errorMessage?: string;
  /** #173 code 模式：连接的 GitHub 仓库（owner/repo 或 https://github.com/...）；新会话时用 PAT 克隆进沙箱。
   *  PAT 不存节点/DB，仅前端 localStorage 保存并随请求透传。 */
  gitRepo?: string;
  /** #173 克隆分支（可选）。 */
  gitBranch?: string;
}

export interface AgentPlanPrefs {
  /** 先生图再图生视频（而非直接文生视频）。 */
  imageFirst?: boolean;
  /** 自动添加配乐（audio 节点并入 merge）。 */
  addMusic?: boolean;
  /** 自动添加字幕（subtitle 节点）。 */
  addSubtitle?: boolean;
  /** 画面比例，如 "9:16" / "16:9" / "1:1"。 */
  aspect?: string;
  /** 整体视觉风格（自由文本）。 */
  style?: string;
  /** 规划生成的 ComfyUI 节点运行后清显存（仅本地 ComfyUI）。 */
  freeVramAfterRun?: boolean;
  /** @角色 生成 character 节点时，从角色库代入多少数据（默认 conditioning=仅参考图/LoRA/语音）。 */
  characterImportMode?: "full" | "conditioning" | "fillEmpty";
  /** 让智能体「知道」角色库（系统提示列出已有角色名，要求按原名复用）。默认开启。 */
  tellAgentCharacters?: boolean;
}

export type NodeData =
  | ScriptNodeData
  | StoryboardNodeData
  | PromptNodeData
  | ImageGenNodeData
  | AssetNodeData
  | VideoTaskNodeData
  | AIChatNodeData
  | NoteNodeData
  | AudioNodeData
  | PostProcessNodeData
  | GroupNodeData
  | CharacterNodeData
  | ClipNodeData
  | MergeNodeData
  | SubtitleNodeData
  | OverlayNodeData
  | SubtitleMotionNodeData
  | SmartCutNodeData
  | PoseControlNodeData
  | VoiceCloneNodeData
  | LipSyncNodeData
  | AvatarNodeData
  | ComfyuiImageNodeData
  | ComfyuiVideoNodeData
  | ComfyuiWorkflowNodeData
  | ImageEditNodeData
  | DirectorNodeData
  | AgentNodeData
  | SuperAgentNodeData
  | CompareNodeData;

// ── Canvas Node ───────────────────────────────────────────────────────────────

export interface CanvasNodePayload {
  id: string;
  projectId: number;
  type: NodeType;
  title?: string | null;
  data: NodeData;
  posX: number;
  posY: number;
  width: number;
  height: number;
  zIndex: number;
}

// ── Canvas Edge ───────────────────────────────────────────────────────────────

export interface CanvasEdgePayload {
  id: string;
  projectId: number;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string | null;
  targetPort?: string | null;
  label?: string | null;
}

// ── Project ───────────────────────────────────────────────────────────────────

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface ProjectPayload {
  id: number;
  userId: number;
  name: string;
  description?: string | null;
  thumbnail?: string | null;
  viewportState?: ViewportState | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Collaboration ─────────────────────────────────────────────────────────────

export interface CollaboratorCursor {
  userId: number;
  userName: string;
  color: string;
  x: number;
  y: number;
}

export interface CollaborationEvent {
  type:
    | "node:move"
    | "node:update"
    | "node:add"
    | "node:delete"
    | "edge:add"
    | "edge:delete"
    | "cursor:move"
    | "user:join"
    | "user:leave";
  userId: number;
  userName: string;
  color: string;
  projectId: number;
  payload: unknown;
}
