// ── Shared Types ─────────────────────────────────────────────────────────────

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
  | "agent";

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
  referenceImageUrl?: string;
  /** 手动多参考图管理（与 ImageGenNode 同款；[0].url 与 referenceImageUrl 镜像）。 */
  referenceImages?: ReferenceImage[];
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
  | "poyo_nano_banana" | "poyo_nano_banana_2" | "poyo_nano_banana_pro"
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
  | "kie_flux_kontext_pro" | "kie_flux_kontext_max" | "kie_gpt_4o_image";

/** UI value strings for every image model — single source for the Zod enum. */
export const IMAGE_GEN_MODELS = [
  "manus_forge",
  "poyo_nano_banana", "poyo_nano_banana_2", "poyo_nano_banana_pro",
  "poyo_gpt_4o_image", "poyo_gpt_image_15", "poyo_gpt_image",
  "poyo_flux", "poyo_sdxl", "poyo_flux_kontext_pro", "poyo_flux_kontext_max",
  "poyo_seedream_4", "poyo_seedream", "poyo_seedream_5_lite",
  "poyo_wan_image", "poyo_wan_image_pro",
  "poyo_kling_o1_image", "poyo_kling_o3_image",
  "poyo_z_image", "poyo_grok_image",
  "hf_soul_standard", "hf_reve", "hf_seedream_v4", "hf_flux_pro",
  "kie_nano_banana", "kie_nano_banana_pro", "kie_seedream_v4", "kie_seedream_45",
  "kie_flux2_pro", "kie_gpt_image_15", "kie_imagen4", "kie_imagen4_fast", "kie_imagen4_ultra", "kie_z_image", "kie_grok_image",
  "kie_nano_banana_edit", "kie_seedream_v4_edit", "kie_flux2_pro_i2i", "kie_gpt_image_15_edit",
  "kie_nano_banana_2", "kie_flux2_flex", "kie_flux2_flex_i2i",
  "kie_gpt_image_2", "kie_gpt_image_2_i2i", "kie_seedream_5lite", "kie_seedream_5lite_i2i",
  "kie_wan27_image", "kie_wan27_image_pro", "kie_ideogram_v3", "kie_qwen_image",
  "kie_qwen_image_i2i", "kie_qwen_image_edit", "kie_qwen2_image_edit",
  "kie_flux_kontext_pro", "kie_flux_kontext_max", "kie_gpt_4o_image",
] as const satisfies readonly ImageGenModel[];
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
  imageUrl?: string;
  imageStorageKey?: string;
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
  /** Collapsed hero preview mode for a multi-image batch: "grid" (default) shows
   *  the whole grid, "single" shows only the selected image. */
  heroView?: "grid" | "single";
  // Original upstream (AI-platform) URL(s) captured at generation time, kept so
  // that — when the re-hosted /manus-storage copy isn't reachable by upstream —
  // a downstream node can offer to switch the reference back to the still-valid
  // (short-lived) AI-platform URL. `imageUrlSource` tracks the selected image;
  // `imageUrlSources` is index-aligned with `imageUrls` for batch results.
  imageUrlSource?: string;
  imageUrlSources?: string[];
  imageUrlSourceAt?: number; // ms epoch when generated (for TTL heuristics)
}

export interface NoteNodeData {
  content: string;
  color?: string;
}

export type AudioCategory = "upload" | "music" | "dubbing" | "sfx";
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
  ttsTranslateTarget?: string;                    // 配音文本翻译目标语言/方言
  ttsTranslateModel?: string;                     // 翻译所用 AI 模型（可选）
  // SFX (音效) — 对齐 kie elevenlabs/sound-effect-v2 官方 schema
  sfxPrompt?: string;
  /** 0.5–22 秒（步进 0.1）；undefined=模型按描述自动决定时长。 */
  sfxDuration?: number;
  /** 生成可无缝循环的氛围音效。 */
  sfxLoop?: boolean;
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
  // Scene (场景)
  sceneName?: string;
  locationType?: string;
  sceneDescription?: string;
  atmosphere?: string;
  timeOfDay?: string;
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
export type ImageEditOp = "remove_bg" | "outpaint" | "inpaint" | "erase" | "relight" | "reframe";
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

export type MergeTransition = "none" | "fade" | "dissolve";
export interface MergeNodeData {
  inputVideoUrls?: string[];
  outputUrl?: string;
  transition?: MergeTransition;
  /** 装配端：逐切点转场（来自「按镜头表装配」；长度=段数-1，优先于全局 transition）。 */
  segTransitions?: ("none" | "fade" | "dissolve" | "wipe")[];
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
}

export type OverlayMode = "watermark" | "pip" | "color_correction";
export interface OverlayNodeData {
  mode?: OverlayMode;
  // Watermark
  overlayImageUrl?: string;
  overlayPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  overlayScale?: number;     // 0.05–1.0
  overlayOpacity?: number;   // 0.0–1.0
  // PiP
  pipVideoUrl?: string;
  pipPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
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
  motionStyle?: SubtitleMotionStyle;
  fontSize?: number;
  fontColor?: string;
  outputUrl?: string;
  status?: "idle" | "transcribing" | "burning" | "done" | "failed";
  errorMessage?: string;
}

export interface SmartCutNodeData {
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
}

export interface ComfyuiWorkflowNodeData {
  customBaseUrl?: string;
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
  progress?: number;
  queueRemaining?: number;  // ComfyUI server queue depth while waiting to start (transient)
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

// ── Agent (Copilot) node ──────────────────────────────────────────────────────
/** One graph operation proposed by the agent. The client validates + applies it
 *  through the canvas store (create/connect/update/delete), so every change is
 *  undoable & persisted exactly like a manual edit. */
export interface AgentOperation {
  op: "create" | "update" | "connect" | "delete";
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
  | AgentNodeData;

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
