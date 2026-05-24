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
  | "comfyui_video";

export const VIDEO_PROVIDERS = [
  "mock",
  "poyo_seedance",
  "poyo_veo",
  "poyo_kling26",
  "poyo_kling_o3_std",
  "poyo_kling_o3_pro",
  "poyo_kling_o3_4k",
  "poyo_wan25_t2v",
  "poyo_wan25_i2v",
  "poyo_runway45",
  "hf_dop_standard",
  "hf_dop_preview",
  "hf_dop_lite",
  "hf_dop_turbo",
  "hf_kling_21_pro",
  "hf_kling_30",
  "hf_seedance_pro",
  "hf_seedance_20",
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
}

export interface StoryboardNodeData {
  sceneNumber?: number;
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

export interface VideoTaskNodeData {
  provider: VideoProvider;
  status: VideoTaskStatus;
  taskId?: number;
  externalTaskId?: string;
  prompt?: string;
  negativePrompt?: string;
  referenceImageUrl?: string;
  resultVideoUrl?: string;
  errorMessage?: string;
  progress?: number;
  params?: Record<string, unknown>;
}

export interface AIChatNodeData {
  systemPrompt?: string;
  contextNodeIds?: string[];
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
}

export type ImageGenModel = "manus_forge" | "poyo_flux" | "poyo_sdxl" | "poyo_gpt_image" | "poyo_seedream" | "poyo_grok_image" | "poyo_wan_image" | "hf_soul_standard" | "hf_reve" | "hf_seedream_v4" | "hf_flux_pro";
export interface ImageGenNodeData {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  referenceImageUrl?: string;
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
  reveResolution?: "720p" | "1080p";
  // Flux Pro Kontext specific params
  fluxGuidanceScale?: number;
  fluxSeed?: number;
  fluxNumImages?: number;
  // Batch generation results
  imageUrls?: string[]; // multiple generated images (Soul batchSize=4, etc.)
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
  musicDuration?: number;
  musicStyle?: string;
  musicInstrumental?: boolean;  // false = generate with vocals
  musicNegativeTags?: string;   // comma-separated keywords to exclude
  // Dubbing / TTS (配音)
  ttsText?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
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
export type ComfyuiImageTemplate = "txt2img" | "img2img";
export interface ComfyuiImageNodeData {
  // Connection
  customBaseUrl?: string;       // empty = use server-side global default
  workflowTemplate: ComfyuiImageTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  // Models
  ckpt?: string;
  lora?: string;
  // Sampling
  steps?: number;
  cfg?: number;
  seed?: number;
  width?: number;
  height?: number;
  // I/O
  referenceImageUrl?: string;
  imageUrl?: string;
  imageStorageKey?: string;
  status?: "idle" | "processing" | "done" | "failed";
  errorMessage?: string;
}

export type ComfyuiVideoTemplate = "animatediff" | "svd";
export interface ComfyuiVideoNodeData {
  // Connection
  customBaseUrl?: string;
  workflowTemplate: ComfyuiVideoTemplate;
  // Prompts
  prompt: string;
  negPrompt?: string;
  // Models
  ckpt?: string;
  motionModule?: string;
  // Sampling
  steps?: number;
  cfg?: number;
  seed?: number;
  frames?: number;
  fps?: number;
  // I/O
  referenceImageUrl?: string;
  resultVideoUrl?: string;
  resultStorageKey?: string;
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
  | ComfyuiVideoNodeData;

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
