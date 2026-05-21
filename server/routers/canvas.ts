import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  deleteVideoTask,
  getNodesByProject,
  upsertNode,
  deleteNode,
  batchUpsertNodes,
  getEdgesByProject,
  upsertEdge,
  deleteEdge,
  getAssetsByUser,
  createAsset,
  deleteAsset,
  getVideoTasksByProject,
  createVideoTask,
  updateVideoTask,
  getVideoTask,
  getChatMessages,
  addChatMessage,
  clearChatMessages,
} from "../db";
import { storagePut } from "../storage";
import { invokeLLM } from "../_core/llm";
import { generateImage } from "../_core/imageGeneration";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "../_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "../_core/higgsfield";

// ── Projects ──────────────────────────────────────────────────────────────────

export const projectsRouter = router({
  list: protectedProcedure.query(({ ctx }) => getProjectsByUser(ctx.user.id)),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(255), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await createProject({ userId: ctx.user.id, name: input.name, description: input.description });
      const projects = await getProjectsByUser(ctx.user.id);
      return projects[0];
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        thumbnail: z.string().optional(),
        viewportState: z
          .object({ x: z.number(), y: z.number(), zoom: z.number() })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateProject(id, ctx.user.id, data as Parameters<typeof updateProject>[2]);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteProject(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ── Nodes ─────────────────────────────────────────────────────────────────────

const nodeDataSchema = z.record(z.string(), z.unknown());

export const nodesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => getNodesByProject(input.projectId)),

  upsert: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.number(),
        type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note"]),
        title: z.string().optional(),
        data: nodeDataSchema,
        posX: z.number(),
        posY: z.number(),
        width: z.number().default(320),
        height: z.number().default(200),
        zIndex: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const id = input.id ?? nanoid();
      const { id: _id, ...rest } = { ...input, id };
      await upsertNode({ ...rest, id, data: input.data as Record<string, unknown> });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNode(input.id, input.projectId);
      return { success: true };
    }),

  batchUpsert: protectedProcedure
    .input(
      z.array(
        z.object({
          id: z.string(),
          projectId: z.number(),
          type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note"]),
          title: z.string().optional().nullable(),
          data: nodeDataSchema,
          posX: z.number(),
          posY: z.number(),
          width: z.number(),
          height: z.number(),
          zIndex: z.number(),
        })
      )
    )
    .mutation(async ({ input }) => {
      await batchUpsertNodes(input.map((n) => ({ ...n, data: n.data as Record<string, unknown> })));
      return { success: true };
    }),
});

// ── Edges ─────────────────────────────────────────────────────────────────────

export const edgesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => getEdgesByProject(input.projectId)),

  upsert: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.number(),
        sourceNodeId: z.string(),
        targetNodeId: z.string(),
        sourcePort: z.string().optional(),
        targetPort: z.string().optional(),
        label: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = input.id ?? nanoid();
      await upsertEdge({ ...input, id });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteEdge(input.id, input.projectId);
      return { success: true };
    }),
});

// ── Assets ────────────────────────────────────────────────────────────────────

export const assetsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(({ ctx, input }) => getAssetsByUser(ctx.user.id, input.projectId)),

  upload: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(["image", "video", "audio", "other"]),
        mimeType: z.string(),
        size: z.number(),
        base64: z.string(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.base64, "base64");
      const key = `assets/${ctx.user.id}/${nanoid()}-${input.name}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await createAsset({
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
        name: input.name,
        type: input.type,
        mimeType: input.mimeType,
        size: input.size,
        storageKey: key,
        url,
      });
      const assets = await getAssetsByUser(ctx.user.id, input.projectId);
      return assets[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteAsset(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ── Video Tasks ───────────────────────────────────────────────────────────────

export const videoTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => getVideoTasksByProject(input.projectId)),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        nodeId: z.string(),
        provider: z.enum(["mock", "poyo_seedance", "poyo_veo", "hf_dop_standard", "hf_dop_preview", "hf_dop_lite", "hf_dop_turbo", "hf_kling_21_pro", "hf_seedance_pro"]),
        prompt: z.string(),
        negativePrompt: z.string().optional(),
        referenceImageUrl: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let externalTaskId: string | undefined;
      let initialStatus: "pending" | "processing" = "pending";

      if (isPoyoVideoProvider(input.provider)) {
        const result = await submitPoyoVideo({
          provider: input.provider,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          referenceImageUrl: input.referenceImageUrl,
          params: input.params as Record<string, unknown>,
        });
        externalTaskId = result.externalTaskId;
        initialStatus = "processing";
      } else if (isHiggsfieldVideoProvider(input.provider)) {
        const result = await submitHiggsfieldVideo({
          provider: input.provider,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          referenceImageUrl: input.referenceImageUrl,
          params: input.params as Record<string, unknown>,
        });
        externalTaskId = result.externalTaskId;
        initialStatus = "processing";
      }

      await createVideoTask({
        userId: ctx.user.id,
        projectId: input.projectId,
        nodeId: input.nodeId,
        provider: input.provider,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        referenceImageUrl: input.referenceImageUrl,
        params: input.params as Record<string, unknown>,
        externalTaskId,
        status: initialStatus,
      });
      const tasks = await getVideoTasksByProject(input.projectId);
      return tasks[0];
    }),

  poll: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const task = await getVideoTask(input.id);
      if (!task) return null;

      // For poyo.ai tasks still processing, sync status from upstream
      if (task.status === "processing" && task.externalTaskId && isPoyoVideoProvider(task.provider)) {
        try {
          const upstream = await checkPoyoVideoStatus(task.externalTaskId);
          if (upstream.status === "finished") {
            const update = { status: "succeeded" as const, resultVideoUrl: upstream.resultVideoUrl };
            await updateVideoTask(task.id, update);
            return { ...task, ...update };
          }
          if (upstream.status === "failed") {
            const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
            await updateVideoTask(task.id, update);
            return { ...task, ...update };
          }
        } catch {
          // Ignore sync errors; return DB state so polling continues
        }
      }

      // For Higgsfield tasks still processing, sync status from upstream
      if (task.status === "processing" && task.externalTaskId && isHiggsfieldVideoProvider(task.provider)) {
        try {
          const upstream = await checkHiggsfieldVideoStatus(task.externalTaskId);
          if (upstream.status === "succeeded" && upstream.resultVideoUrl) {
            const update = { status: "succeeded" as const, resultVideoUrl: upstream.resultVideoUrl };
            await updateVideoTask(task.id, update);
            return { ...task, ...update };
          }
          if (upstream.status === "failed") {
            const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
            await updateVideoTask(task.id, update);
            return { ...task, ...update };
          }
        } catch {
          // Ignore sync errors; return DB state so polling continues
        }
      }

      return task;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "processing", "succeeded", "failed"]),
        resultVideoUrl: z.string().optional(),
        errorMessage: z.string().optional(),
        externalTaskId: z.string().optional(),
        progress: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateVideoTask(id, data);
      return { success: true };
    }),

  // Delete a task record so the node can be re-submitted
  reset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteVideoTask(input.id);
      return { success: true };
    }),
});

// ── AI Chat ───────────────────────────────────────────────────────────────────

export const aiChatRouter = router({
  getMessages: protectedProcedure
    .input(z.object({ nodeId: z.string(), projectId: z.number() }))
    .query(({ input }) => getChatMessages(input.nodeId, input.projectId)),

  sendMessage: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        projectId: z.number(),
        message: z.string().min(1),
        systemPrompt: z.string().optional(),
        contextContent: z.string().optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Save user message
      await addChatMessage({
        nodeId: input.nodeId,
        projectId: input.projectId,
        role: "user",
        content: input.message,
      });

      // Build messages for LLM
      const history = await getChatMessages(input.nodeId, input.projectId);
      const systemContent = [
        input.systemPrompt ?? "You are a professional film and content creation assistant. Help with scripts, storyboards, prompts, and creative direction.",
        input.contextContent ? `\n\nContext from canvas:\n${input.contextContent}` : "",
      ]
        .filter(Boolean)
        .join("");

      const messages = [
        { role: "system" as const, content: systemContent },
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const response = await invokeLLM({ messages, model: input.model });
      const rawContent = response.choices?.[0]?.message?.content;
      const assistantContent: string =
        typeof rawContent === "string"
          ? rawContent
          : Array.isArray(rawContent)
          ? rawContent.map((p) => (p.type === "text" ? p.text : "")).join("")
          : "Sorry, I could not generate a response.";

      // Save assistant message
      await addChatMessage({
        nodeId: input.nodeId,
        projectId: input.projectId,
        role: "assistant",
        content: assistantContent,
      });

      return { content: assistantContent };
    }),

  clearMessages: protectedProcedure
    .input(z.object({ nodeId: z.string(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      await clearChatMessages(input.nodeId, input.projectId);
      return { success: true };
    }),
});

// ── Image Generation ──────────────────────────────────────────────────────────

export const imageGenRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        referenceImageUrl: z.string().optional(),
        style: z.string().optional(),
        model: z.enum(["manus_forge", "poyo_flux", "poyo_sdxl", "hf_soul_standard", "hf_reve"]).optional(),
        // Soul Standard specific params
        widthAndHeight: z.string().optional(),
        quality: z.enum(["720p", "1080p"]).optional(),
        batchSize: z.number().int().min(1).max(4).optional(),
        seed: z.number().int().optional(),
        enhancePrompt: z.boolean().optional(),
        // Reve specific params
        reveAspectRatio: z.string().optional(),
        reveResolution: z.enum(["720p", "1080p"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const fullPrompt = [
        input.style ? `Style: ${input.style}.` : "",
        input.prompt,
        input.negativePrompt ? `Avoid: ${input.negativePrompt}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const result = await generateImage({
        prompt: fullPrompt,
        model: input.model,
        ...(input.referenceImageUrl
          ? { originalImages: [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }] }
          : {}),
        // Soul Standard specific params passed through
        ...(input.model === "hf_soul_standard" ? {
          widthAndHeight: input.widthAndHeight,
          quality: input.quality,
          batchSize: input.batchSize,
          seed: input.seed,
          enhancePrompt: input.enhancePrompt,
        } : {}),
        // Reve specific params passed through
        ...(input.model === "hf_reve" ? {
          reveAspectRatio: input.reveAspectRatio,
          reveResolution: input.reveResolution,
        } : {}),
      });

      return { url: result.url };
    }),
});
