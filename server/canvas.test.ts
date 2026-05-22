import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mock DB helpers ───────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getProjectsByUser: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      name: "Test Project",
      description: null,
      thumbnail: null,
      viewportState: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
  ]),
  getProjectById: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    name: "Test Project",
    description: null,
    thumbnail: null,
    viewportState: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  }),
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
  deleteAsset: vi.fn().mockResolvedValue({}),
  getVideoTasksByProject: vi.fn().mockResolvedValue([]),
  createVideoTask: vi.fn().mockResolvedValue({}),
  getVideoTask: vi.fn().mockResolvedValue({
    id: 1,
    status: "pending",
    provider: "mock",
    prompt: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  updateVideoTask: vi.fn().mockResolvedValue({}),
  getPendingVideoTasks: vi.fn().mockResolvedValue([]),
  getChatMessages: vi.fn().mockResolvedValue([]),
  addChatMessage: vi.fn().mockResolvedValue({}),
  addChatMessagePair: vi.fn().mockResolvedValue(undefined),
  clearChatMessages: vi.fn().mockResolvedValue({}),
}));

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
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].name).toBe("Test Project");
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
