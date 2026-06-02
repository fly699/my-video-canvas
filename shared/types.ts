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
  | "comfyui_workflow";

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
  // Kling
  "poyo_kling21_std",
  "poyo_kling21_pro",
  "poyo_kling25_turbo",
  "poyo_kling30_std",
  "poyo_kling30_pro",
  "poyo_kling30_4k",
  // Wan
  "poyo_wan27_t2v",
  "poyo_wan27_i2v",
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
  "poyo_grok_video",
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export type VideoTaskStatus = "pending" | "processing" | "succeeded" | "failed";

// ── Node Data Payloads ────────────────────────────────────────────────────────

export interface ScriptNodeData {
  content: string;
  synopsis?: string;
  totalDuration?: number;
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
  imageModel?: ImageGenModel;
  referenceImageUrl?: string;
  batchSize?: number;
  // ── Image-gen sizing/quality knobs (mirror ImageGenNodeData) ──
  // Stored here so each storyboard scene can override aspect ratio and
  // resolution independently. Field names match the imageGen.generate
  // tRPC input — the mutation accepts them as-is per model.
  widthAndHeight?: string;            // Soul Standard 13-value enum
  soulQuality?: "720p" | "1080p";     // Soul Standard only
  reveAspectRatio?: string;           // Reve / Seedream / Flux Pro
  reveResolution?: "1K" | "2K" | "4K";// Reve / Seedream / Flux Pro
  poyoAspectRatio?: string;           // Poyo image models
  poyoQuality?: "low" | "medium" | "high"; // Poyo image models
  // Original upstream AI-platform URL for the generated image (see ImageGenNodeData)
  imageUrlSource?: string;
  imageUrlSourceAt?: number;
}

export interface PromptNodeData {
  positivePrompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  imageStorageKey?: string;
  style?: string;
  aspectRatio?: string;
  imageModel?: ImageGenModel;
  referenceImageUrl?: string;
  imageUrls?: string[];
  selectedImageIndex?: number;
  // Original upstream AI-platform URL(s) (see ImageGenNodeData)
  imageUrlSource?: string;
  imageUrlSources?: string[];
  imageUrlSourceAt?: number;
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
  resultVideoUrl?: string;
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
  | "hf_soul_standard" | "hf_reve" | "hf_seedream_v4" | "hf_flux_pro";

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
] as const satisfies readonly ImageGenModel[];
export interface ImageGenNodeData {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
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
  // SFX (音效)
  sfxPrompt?: string;
  sfxDuration?: number;
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
   * Optional user-authored template that overrides the auto-generated
   * prompt injection. Supports the same `{name}`, `{outfit}` etc.
   * placeholders documented in lib/characterPrompt.ts.
   */
  customPromptTemplate?: string;
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

export interface GroupNodeData {
  label?: string;
  color?: string;
  collapsed?: boolean;
  childIds?: string[];
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
  speed?: number;            // 0.25-4.0, default 1.0
  // Audio mix
  audioVolume?: number;      // 0.0-2.0, default 1.0
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
  workflowTemplate: ComfyuiImageTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  /** When on, a workflow run pushes this node's prompt(s) to downstream
   *  comfyui_video nodes before they run, so the video matches the image. */
  sendPromptToVideo?: boolean;
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
  progress?: number;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export type ComfyuiVideoTemplate = "animatediff" | "svd" | "wan_t2v" | "wan_i2v" | "ltxv";
export interface ComfyuiVideoNodeData {
  // Connection
  customBaseUrl?: string;
  serverUrls?: string[];        // saved server addresses for quick selection (persisted on node)
  workflowTemplate: ComfyuiVideoTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  // Models
  ckpt?: string;
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
  resultVideoUrl?: string;
  resultStorageKey?: string;
  progress?: number;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export interface WorkflowParamBinding {
  nodeId: string;
  fieldPath: string;
  label: string;
  type: "text" | "number" | "select" | "image" | "boolean";
  defaultValue?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ComfyuiWorkflowNodeData {
  customBaseUrl?: string;
  serverUrls?: string[];        // saved server addresses for quick selection (persisted on node)
  workflowJson?: string;
  workflowName?: string;
  paramBindings?: WorkflowParamBinding[];
  paramValues?: Record<string, unknown>;
  outputNodeIds?: string[];
  outputType?: "image" | "video" | "auto";
  outputUrl?: string;
  outputUrls?: string[];
  progress?: number;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
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
  | ComfyuiWorkflowNodeData;

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
