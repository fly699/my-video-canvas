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
import { invokeLLM, extractTextContent } from "../_core/llm";
import { generateImage } from "../_core/imageGeneration";
import { isPoyoVideoProvider, submitPoyoVideo, checkPoyoVideoStatus } from "../_core/poyoVideo";
import { isHiggsfieldVideoProvider, submitHiggsfieldVideo, checkHiggsfieldVideoStatus } from "../_core/higgsfield";
import { submitAndPollPoyoMusic, type PoyoMusicModel } from "../_core/poyoAudio";
import { trimVideo, getVideoDuration } from "../_core/videoEditor";
import { VIDEO_PROVIDERS } from "../../shared/types";

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
        type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip"]),
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
          type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip"]),
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

const pollLastCheck = new Map<string, number>();
const POLL_THROTTLE_MS = 4_000;

export const videoTasksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => getVideoTasksByProject(input.projectId)),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        nodeId: z.string(),
        provider: z.enum([...VIDEO_PROVIDERS] as [string, ...string[]]),
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

      // For poyo.ai tasks still processing, sync status from upstream (throttled)
      if (task.status === "processing" && task.externalTaskId && isPoyoVideoProvider(task.provider)) {
        const now = Date.now();
        const lastCheck = pollLastCheck.get(task.externalTaskId) ?? 0;
        if (now - lastCheck >= POLL_THROTTLE_MS) {
          pollLastCheck.set(task.externalTaskId, now);
          try {
            const upstream = await checkPoyoVideoStatus(task.externalTaskId);
            if (upstream.status === "finished") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "succeeded" as const, resultVideoUrl: upstream.resultVideoUrl };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
          } catch (err) {
            console.error(`[poll] Poyo status check failed for task ${task.id} (${task.externalTaskId}):`, err instanceof Error ? err.message : String(err));
          }
        }
      }

      // For Higgsfield tasks still processing, sync status from upstream (throttled)
      if (task.status === "processing" && task.externalTaskId && isHiggsfieldVideoProvider(task.provider)) {
        const now = Date.now();
        const lastCheck = pollLastCheck.get(task.externalTaskId) ?? 0;
        if (now - lastCheck >= POLL_THROTTLE_MS) {
          pollLastCheck.set(task.externalTaskId, now);
          try {
            const upstream = await checkHiggsfieldVideoStatus(task.externalTaskId);
            if (upstream.status === "succeeded" && upstream.resultVideoUrl) {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "succeeded" as const, resultVideoUrl: upstream.resultVideoUrl };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
            if (upstream.status === "failed") {
              pollLastCheck.delete(task.externalTaskId);
              const update = { status: "failed" as const, errorMessage: upstream.errorMessage ?? "生成失败" };
              await updateVideoTask(task.id, update);
              return { ...task, ...update };
            }
          } catch (err) {
            console.error(`[poll] Higgsfield status check failed for task ${task.id} (${task.externalTaskId}):`, err instanceof Error ? err.message : String(err));
          }
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
      const assistantContent = extractTextContent(response) || "Sorry, I could not generate a response.";

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
        model: z.enum(["manus_forge", "poyo_flux", "poyo_sdxl", "poyo_gpt_image", "poyo_seedream", "poyo_grok_image", "poyo_wan_image", "hf_soul_standard", "hf_reve", "hf_seedream_v4", "hf_flux_pro"]).optional(),
        poyoAspectRatio: z.string().optional(),
        poyoQuality: z.enum(["low", "medium", "high"]).optional(),
        widthAndHeight: z.string().optional(),
        quality: z.enum(["720p", "1080p"]).optional(),
        batchSize: z.number().int().min(1).max(4).optional(),
        seed: z.number().int().optional(),
        enhancePrompt: z.boolean().optional(),
        // Reve specific params
        reveAspectRatio: z.string().optional(),
        reveResolution: z.enum(["720p", "1080p"]).optional(),
        // Flux Pro Kontext extra params
        fluxGuidanceScale: z.number().min(1).max(20).optional(),
        fluxSeed: z.number().int().optional(),
        fluxNumImages: z.number().int().min(1).max(4).optional(),
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
        ...((input.model === "poyo_flux" || input.model === "poyo_sdxl" || input.model === "poyo_gpt_image" ||
             input.model === "poyo_seedream" || input.model === "poyo_grok_image" || input.model === "poyo_wan_image") ? {
          size: input.poyoAspectRatio,
          quality: input.poyoQuality,
        } : {}),
        ...(input.model === "hf_soul_standard" ? {
          widthAndHeight: input.widthAndHeight,
          quality: input.quality,
          batchSize: input.batchSize,
          seed: input.seed,
          enhancePrompt: input.enhancePrompt,
        } : {}),
        // Reve/Seedream v4/Flux Pro aspect ratio
        ...(input.model === "hf_reve" || input.model === "hf_seedream_v4" || input.model === "hf_flux_pro" ? {
          reveAspectRatio: input.reveAspectRatio,
          ...(input.model === "hf_reve" ? { reveResolution: input.reveResolution } : {}),
        } : {}),
        // Flux Pro Kontext extra params
        ...(input.model === "hf_flux_pro" ? {
          fluxGuidanceScale: input.fluxGuidanceScale,
          fluxSeed: input.fluxSeed,
          fluxNumImages: input.fluxNumImages,
        } : {}),
      });

      return { url: result.url, urls: result.urls };
    }),
});

// ── Scripts ───────────────────────────────────────────────────────────────────

export const scriptsRouter = router({
  generateStoryboards: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
        synopsis: z.string().optional(),
        count: z.number().int().min(2).max(8).default(4),
      })
    )
    .mutation(async ({ input }) => {
      const systemPrompt = `You are a professional film director and storyboard artist.
Given a script, break it into exactly ${input.count} visual storyboard scenes.
Output ONLY a valid JSON array with no markdown fences, no explanation.
Each element must have these fields:
- "description": string (2-3 sentences, what the viewer sees)
- "promptText": string (English, detailed cinematic prompt for image generation)
- "cameraMovement": string (one of: static, pan-left, pan-right, zoom-in, zoom-out, tilt-up, tilt-down, tracking)
- "duration": number (scene duration in seconds, integer 2-10)`;

      const userContent = [
        input.synopsis ? `Synopsis: ${input.synopsis}\n\n` : "",
        `Script:\n${input.content}`,
      ].join("");

      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent },
        ],
        model: "gemini-2.5-flash",
      });

      const text = extractTextContent(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });

      let scenes: Array<{ description: string; promptText: string; cameraMovement?: string; duration?: number }>;
      try {
        scenes = JSON.parse(jsonMatch[0]);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败" });
      }
      return { scenes: scenes.slice(0, input.count) };
    }),
});

// ── Audio Generation ──────────────────────────────────────────────────────────

export const audioGenRouter = router({
  generateMusic: protectedProcedure
    .input(
      z.object({
        model: z.enum(["suno-v4.5", "suno-v5", "mureka", "minimax-music-02"]),
        prompt: z.string().min(1),
        style: z.string().optional(),
        durationSeconds: z.number().int().min(10).max(480).optional(),
        instrumental: z.boolean().optional(),
        negativePrompt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await submitAndPollPoyoMusic({
        model: input.model as PoyoMusicModel,
        prompt: input.prompt,
        style: input.style,
        durationSeconds: input.durationSeconds,
        instrumental: input.instrumental,
        negativePrompt: input.negativePrompt,
      });
      return { url: result.url, duration: result.duration };
    }),
});

// ── Video Clip Editor ─────────────────────────────────────────────────────────
export const clipRouter = router({
  trimVideo: protectedProcedure
    .input(
      z.object({
        inputUrl: z.string().url(),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
        speed: z.number().min(0.25).max(4.0).optional(),
        audioUrl: z.string().optional(),
        audioVolume: z.number().min(0).max(2.0).optional(),
      }).refine(d => d.endTime > d.startTime, { message: "出点必须大于入点", path: ["endTime"] })
    )
    .mutation(async ({ input }) => {
      const result = await trimVideo(input);
      return { url: result.url, duration: result.duration };
    }),

  getVideoDuration: protectedProcedure
    .input(z.object({ url: z.string() }))
    .query(async ({ input }) => {
      const duration = await getVideoDuration(input.url);
      return { duration };
    }),
});

// ── AI Prompt Enhancement ─────────────────────────────────────────────────────
export const aiEnhanceRouter = router({
  enhance: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(8000),
        mode: z.enum(["expand", "translate_en", "polish", "storyboard_prompt", "translate_zh"]),
      })
    )
    .mutation(async ({ input }) => {
      const systemPrompts: Record<string, string> = {
        expand: `You are a creative writing assistant specializing in AI video generation prompts.
Expand the given text into a rich, detailed description with sensory details, atmosphere, lighting, composition, and cinematic qualities.
Keep the expanded text concise (2-4 sentences). Respond in the same language as the input. Output ONLY the expanded text.`,
        translate_en: `You are a professional translator specializing in AI image/video generation prompts.
Translate the given text to English, optimizing it for AI generation models.
Use vivid, descriptive, cinematic language. Output ONLY the English translation, nothing else.`,
        translate_zh: `You are a professional translator.
Translate the given text to Simplified Chinese.
Output ONLY the Chinese translation, nothing else.`,
        polish: `You are a professional screenwriter and script editor.
Polish the given script text to improve clarity, pacing, narrative flow, and dramatic tension.
Maintain the original story intent while enhancing the writing quality.
Respond in the same language as the input. Output ONLY the polished text.`,
        storyboard_prompt: `You are a cinematographer and storyboard artist.
Convert the given scene description into a detailed visual prompt for AI video/image generation.
Include: camera angle, lens type, lighting setup, composition, color palette, atmosphere, action.
Output an optimized English prompt under 80 words. Output ONLY the prompt text.`,
      };
      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompts[input.mode] },
          { role: "user" as const, content: input.text },
        ],
        model: "gemini-2.5-flash",
      });
      return { result: extractTextContent(response).trim() };
    }),
});
