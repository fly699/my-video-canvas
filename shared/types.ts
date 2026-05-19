// ── Shared Types ─────────────────────────────────────────────────────────────

export type NodeType =
  | "script"
  | "storyboard"
  | "prompt"
  | "asset"
  | "video_task"
  | "ai_chat"
  | "note";

export type VideoProvider = "runway" | "kling" | "mock";
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
  promptText?: string;
  negativePrompt?: string;
  duration?: number; // seconds
  cameraMovement?: string;
  lens?: string;
  colorTone?: string;
}

export interface PromptNodeData {
  positivePrompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  imageStorageKey?: string;
  style?: string;
  aspectRatio?: string;
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
  contextNodeIds?: string[]; // IDs of nodes whose content is injected as context
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface NoteNodeData {
  content: string;
  color?: string;
}

export type NodeData =
  | ScriptNodeData
  | StoryboardNodeData
  | PromptNodeData
  | AssetNodeData
  | VideoTaskNodeData
  | AIChatNodeData
  | NoteNodeData;

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
