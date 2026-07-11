import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mock DB helpers ───────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted to the top of the file, so any const referenced
// inside the factory must be inlined.
vi.mock("./db", () => {
  const MOCK_PROJECT = {
    id: 1,
    userId: 1,
    name: "Test Project",
    description: null,
    thumbnail: null,
    viewportState: null,
    publicReadAccess: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };
  return ({
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  insertLlmUsageLog: vi.fn().mockResolvedValue(undefined), // LLM 调用日志统一埋点（fire-and-forget）
  getProjectsByUser: vi.fn().mockResolvedValue([MOCK_PROJECT]),
  getProjectsSharedWithUser: vi.fn().mockResolvedValue([]),
  getProjectById: vi.fn().mockResolvedValue(MOCK_PROJECT),
  getProjectByIdRaw: vi.fn().mockResolvedValue(MOCK_PROJECT),
  // Mock the access resolver — test user (id=1) is the owner of MOCK_PROJECT
  getProjectAccess: vi.fn().mockResolvedValue({
    project: MOCK_PROJECT,
    role: "owner",
    source: "owner",
  }),
  setProjectPublicAccess: vi.fn().mockResolvedValue(undefined),
  listCollaborators: vi.fn().mockResolvedValue([]),
  findCollaboratorByUserId: vi.fn().mockResolvedValue(undefined),
  findCollaboratorByEmail: vi.fn().mockResolvedValue(undefined),
  upsertCollaborator: vi.fn().mockResolvedValue({}),
  updateCollaboratorRole: vi.fn().mockResolvedValue(undefined),
  removeCollaborator: vi.fn().mockResolvedValue(undefined),
  claimPendingInvitations: vi.fn().mockResolvedValue(undefined),
  createShareLink: vi.fn().mockResolvedValue({}),
  listShareLinks: vi.fn().mockResolvedValue([]),
  getShareLinkByToken: vi.fn().mockResolvedValue(undefined),
  consumeShareLink: vi.fn().mockResolvedValue(true),
  revokeShareLink: vi.fn().mockResolvedValue(undefined),
  findUserByEmail: vi.fn().mockResolvedValue(undefined),
  createProject: vi.fn().mockResolvedValue({}),
  updateProject: vi.fn().mockResolvedValue({}),
  deleteProject: vi.fn().mockResolvedValue({}),
  getNodesByProject: vi.fn().mockResolvedValue([]),
  upsertNode: vi.fn().mockResolvedValue({}),
  deleteNode: vi.fn().mockResolvedValue({}),
  batchUpsertNodes: vi.fn().mockResolvedValue({}),
  getEdgesByProject: vi.fn().mockResolvedValue([]),
  upsertEdge: vi.fn().mockResolvedValue({}),
  deleteEdge: vi.fn().mockResolvedValue({}),
  getAssetsByUser: vi.fn().mockResolvedValue([]),
  createAsset: vi.fn().mockResolvedValue({}),
  recordGeneratedAsset: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue({}),
  getVideoTasksByProject: vi.fn().mockResolvedValue([]),
  findInFlightVideoTask: vi.fn().mockResolvedValue(undefined),
  createVideoTask: vi.fn().mockResolvedValue({}),
  getVideoTask: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    projectId: 1,
    nodeId: "test-node",
    status: "pending",
    provider: "mock",
    prompt: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  updateVideoTask: vi.fn().mockResolvedValue({}),
  claimVideoTaskForSubmit: vi.fn().mockResolvedValue(true),
  getPendingVideoTasks: vi.fn().mockResolvedValue([]),
  getChatMessages: vi.fn().mockResolvedValue([]),
  addChatMessage: vi.fn().mockResolvedValue({}),
  addChatMessagePair: vi.fn().mockResolvedValue(undefined),
  clearChatMessages: vi.fn().mockResolvedValue({}),
  getWhitelistSettings: vi.fn().mockResolvedValue({ id: 1, enabled: false, updatedAt: new Date() }),
  isWhitelisted: vi.fn().mockResolvedValue(false),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  });
});

// ── Mock LLM ──────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    id: "test",
    created: Date.now(),
    model: "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Test response" },
        finish_reason: "stop",
      },
    ],
  }),
  extractTextContent: vi.fn().mockReturnValue("Test response"),
}));

// ── Mock image generation ─────────────────────────────────────────────────────
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn().mockResolvedValue({ url: "/manus-storage/test-image.png" }),
}));

// ── Mock storage ──────────────────────────────────────────────────────────────
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
}));

// ── Test context ──────────────────────────────────────────────────────────────
function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "manus",
      passwordHash: null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
    clientIp: "127.0.0.1",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("projects router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("lists projects for authenticated user", async () => {
    const result = await caller.projects.list();
    // New shape: { owned: Project[], shared: Project[] } — split because
    // a project the user collaborates on is rendered separately from their own.
    expect(Array.isArray(result.owned)).toBe(true);
    expect(Array.isArray(result.shared)).toBe(true);
    expect(result.owned[0].name).toBe("Test Project");
  });

  it("gets a specific project by id", async () => {
    const result = await caller.projects.get({ id: 1 });
    expect(result).toBeDefined();
    expect(result?.id).toBe(1);
  });

  it("creates a project and returns it", async () => {
    const result = await caller.projects.create({ name: "New Project" });
    expect(result).toBeDefined();
  });

  it("updates a project", async () => {
    const result = await caller.projects.update({ id: 1, name: "Updated" });
    expect(result.success).toBe(true);
  });

  it("deletes a project", async () => {
    const result = await caller.projects.delete({ id: 1 });
    expect(result.success).toBe(true);
  });
});

describe("nodes router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("lists nodes for a project", async () => {
    const result = await caller.nodes.list({ projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("upserts a node and returns its id", async () => {
    const result = await caller.nodes.upsert({
      projectId: 1,
      type: "script",
      data: { content: "Test script" },
      posX: 100,
      posY: 200,
    });
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
  });

  it("deletes a node", async () => {
    const result = await caller.nodes.delete({ id: "test-node-id", projectId: 1 });
    expect(result.success).toBe(true);
  });

  it("batch upserts nodes", async () => {
    const result = await caller.nodes.batchUpsert([
      {
        id: "node-1",
        projectId: 1,
        type: "script",
        data: { content: "Script 1" },
        posX: 0,
        posY: 0,
        width: 320,
        height: 200,
        zIndex: 0,
      },
      {
        id: "node-2",
        projectId: 1,
        type: "storyboard",
        data: { description: "Scene 1" },
        posX: 400,
        posY: 0,
        width: 320,
        height: 280,
        zIndex: 0,
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe("edges router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("lists edges for a project", async () => {
    const result = await caller.edges.list({ projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("upserts an edge", async () => {
    const result = await caller.edges.upsert({
      projectId: 1,
      sourceNodeId: "node-1",
      targetNodeId: "node-2",
    });
    expect(result.id).toBeDefined();
  });

  it("deletes an edge", async () => {
    const result = await caller.edges.delete({ id: "edge-1", projectId: 1 });
    expect(result.success).toBe(true);
  });
});

describe("video tasks router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("lists video tasks for a project", async () => {
    const result = await caller.videoTasks.list({ projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("creates a video task (returns first task or undefined from mocked list)", async () => {
    // createVideoTask mock returns {}, getVideoTasksByProject returns []
    // so result may be undefined — just verify no exception is thrown
    let threw = false;
    try {
      await caller.videoTasks.create({
        projectId: 1,
        nodeId: "node-1",
        provider: "mock",
        prompt: "A cinematic scene",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("polls a video task status", async () => {
    const result = await caller.videoTasks.poll({ id: 1 });
    expect(result).toBeDefined();
    expect(result?.status).toBe("pending");
  });

  it("updates video task status", async () => {
    const result = await caller.videoTasks.updateStatus({
      id: 1,
      status: "processing",
    });
    expect(result.success).toBe(true);
  });
});

describe("ai chat router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("gets chat messages for a node", async () => {
    const result = await caller.aiChat.getMessages({ nodeId: "node-1", projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("sends a message and gets AI response", async () => {
    const result = await caller.aiChat.sendMessage({
      nodeId: "node-1",
      projectId: 1,
      message: "Help me write a script",
    });
    expect(result.content).toBe("Test response");
  });

  it("clears chat messages", async () => {
    const result = await caller.aiChat.clearMessages({ nodeId: "node-1", projectId: 1 });
    expect(result.success).toBe(true);
  });
});

describe("image generation router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller(createAuthContext());
  });

  it("generates an image from a prompt", async () => {
    const result = await caller.imageGen.generate({
      prompt: "A cinematic storyboard frame, sunset over mountains",
    });
    expect(result.url).toBeDefined();
    expect(result.url).toContain("/manus-storage/");
  });

  it("generates an image with style and negative prompt", async () => {
    const result = await caller.imageGen.generate({
      prompt: "Epic battle scene",
      negativePrompt: "blurry, low quality",
      style: "cinematic",
    });
    expect(result.url).toBeDefined();
  });
});

describe("auth router", () => {
  it("returns current user when authenticated", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const user = await caller.auth.me();
    expect(user).toBeDefined();
    expect(user?.id).toBe(1);
  });

  it("returns null when not authenticated", async () => {
    const unauthCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(unauthCtx);
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });
});
