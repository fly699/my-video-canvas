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
  | "character";

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
  // Soul Standard specific params
  widthAndHeight?: string;
  soulQuality?: "720p" | "1080p";
  batchSize?: number;
  seed?: number;
  enhancePrompt?: boolean;
  // Reve specific params
  reveAspectRatio?: string;
  reveResolution?: "720p" | "1080p";
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
  // AI model selection (per category)
  aiModel?: string;
  // Music (配乐)
  musicPrompt?: string;
  musicDuration?: number;
  musicStyle?: string;
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
  operation: PostProcessOp;
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
  | CharacterNodeData;

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
