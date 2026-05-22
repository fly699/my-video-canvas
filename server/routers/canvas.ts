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
import { submitAndPollPoyoTTS, type PoyoTTSModel } from "../_core/poyoAudio";
import { trimVideo, getVideoDuration, mergeVideos, burnSubtitles, generateSRT, overlayVideo } from "../_core/videoEditor";
import { transcribeAudio } from "../_core/voiceTranscription";
import { VIDEO_PROVIDERS } from "../../shared/types";
import type { SubtitleEntry } from "../../shared/types";

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
      const project = projects[0];
      if (!project) throw new Error("Failed to create project");
      return project;
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
        type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay"]),
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
          type: z.enum(["script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat", "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle", "overlay"]),
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
      const asset = assets[0];
      if (!asset) throw new Error("Failed to save asset record");
      return asset;
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
      const task = tasks[0];
      if (!task) throw new Error("Failed to create video task");
      return task;
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

      let assistantContent: string;
      try {
        const response = await invokeLLM({ messages, model: input.model });
        assistantContent = extractTextContent(response) || "（模型返回内容为空）";
      } catch (err) {
        assistantContent = `⚠️ 调用失败：${err instanceof Error ? err.message : String(err)}`;
      }

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
      const isHfModel = input.model?.startsWith("hf_");

      // For Higgsfield models, keep prompt clean and pass negativePrompt separately.
      // For other models, embed negative prompt as "Avoid: ..." suffix.
      const fullPrompt = isHfModel
        ? [input.style ? `Style: ${input.style}.` : "", input.prompt].filter(Boolean).join(" ")
        : [
            input.style ? `Style: ${input.style}.` : "",
            input.prompt,
            input.negativePrompt ? `Avoid: ${input.negativePrompt}` : "",
          ]
            .filter(Boolean)
            .join(" ");

      const result = await generateImage({
        prompt: fullPrompt,
        model: input.model,
        ...(isHfModel && input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
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
        model: z.string().optional(),
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
        model: input.model ?? "gemini-2.5-flash",
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

  generateFullScript: protectedProcedure
    .input(
      z.object({
        synopsis: z.string().min(1).max(2000),
        genre: z.string().optional(),
        style: z.string().optional(),
        mood: z.string().optional(),
        sceneCount: z.number().int().min(2).max(12).default(5),
        totalDuration: z.number().int().min(10).max(600).default(60),
        targetVideoModel: z.string().optional(),
        aspectRatio: z.string().default("16:9"),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const MODEL_PROMPT_GUIDES: Record<string, string> = {
        kling: "Kling (Kuaishou): Excellent precise camera control. Use detailed camera moves: push-in, dolly, orbital pan, crane shot. Rich motion expression with emotional narrative. Describe subject actions precisely.",
        veo: "Veo 3.1 (Google): Natural language understanding. Use flowing natural English. Emphasize realistic physics, human emotions, complex interactions. Write like a film scene description. No keyword lists.",
        runway: "Runway Gen-4.5: Concise style-focused prompts under 60 words. Lead with aesthetic style, then subject and action. Format: [cinematography style], [subject] [action], [environment], [lighting].",
        wan: "Wan 2.5 (Alibaba): Structured keyword prompts. Format: subject, action description, environment/background, visual style, lighting condition, camera angle. Good for stylized artistic content.",
        seedance: "Seedance 2 (ByteDance): Photorealistic output. Include: shot type (ECU/CU/MS/LS), lens focal length, lighting setup, color grade style, specific camera movement. Professional cinematography terminology.",
        dop: "DoP/Higgsfield: Professional director's language. Specify: focal length, aperture suggestion, lighting type and color temperature, film stock style, composition rule, emotional subtext. Cinematic excellence.",
      };

      const modelGuide = input.targetVideoModel
        ? (MODEL_PROMPT_GUIDES[input.targetVideoModel] ?? "General cinematic: descriptive English prompts with visual details, lighting, and camera information.")
        : "General cinematic: descriptive English prompts with visual details, lighting, camera information, and mood.";

      const avgDuration = Math.round(input.totalDuration / input.sceneCount);

      const systemPrompt = `You are a professional screenwriter and AI video director creating multi-modal storyboard scripts optimized for AI video generation.

Target Video Model Prompt Style Guide:
${modelGuide}

Production Brief:
- Genre: ${input.genre ?? "general"}
- Visual Style: ${input.style ?? "cinematic"}
- Emotional Tone: ${input.mood ?? "neutral"}
- Aspect Ratio: ${input.aspectRatio}
- Total Duration: ~${input.totalDuration} seconds across ${input.sceneCount} scenes (avg ${avgDuration}s/scene)

Your task: Generate a complete storyboard script. Output ONLY a valid JSON object with NO markdown fences, NO extra text:
{
  "scriptText": "A polished Chinese narrative script with proper scene headings (场景一、二...), vivid action lines, and atmospheric descriptions. Professional screenplay style. Minimum 200 characters.",
  "scenes": [
    {
      "description": "Chinese visual description: what the viewer sees, atmosphere, character actions. 2-3 sentences.",
      "promptText": "English AI generation prompt optimized for the target model. Follow the prompt style guide above strictly.",
      "cameraMovement": "one of: static|pan-left|pan-right|zoom-in|zoom-out|tilt-up|tilt-down|tracking",
      "duration": ${avgDuration}
    }
  ]
}

Rules:
1. Generate exactly ${input.sceneCount} scene objects
2. scriptText must be cohesive Chinese narrative covering all scenes
3. Each promptText MUST follow the target model's style guide
4. Duration values should total approximately ${input.totalDuration} seconds
5. Create compelling visual storytelling appropriate for the genre and mood`;

      const response = await invokeLLM({
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `Story Synopsis:\n${input.synopsis}` },
        ],
        model: input.model ?? "claude-sonnet-4-6",
        maxTokens: 8000,
      });

      const text = extractTextContent(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回有效 JSON" });

      let parsed: {
        scriptText?: string;
        scenes?: Array<{ description?: string; promptText?: string; cameraMovement?: string; duration?: number }>;
      };
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON 解析失败，请重试" });
      }

      return {
        scriptText: parsed.scriptText ?? "",
        scenes: (parsed.scenes ?? []).slice(0, input.sceneCount),
      };
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

  generateDubbing: protectedProcedure
    .input(
      z.object({
        model: z.enum(["openai_tts_hd", "openai_tts", "elevenlabs_v3", "cosyvoice_2"]),
        text: z.string().min(1).max(5000),
        voice: z.string().optional(),
        speed: z.number().min(0.5).max(2.0).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await submitAndPollPoyoTTS({
        model: input.model as PoyoTTSModel,
        text: input.text,
        voice: input.voice,
        speed: input.speed,
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

// ── Video Merge ───────────────────────────────────────────────────────────────
export const mergeRouter = router({
  mergeVideos: protectedProcedure
    .input(
      z.object({
        inputUrls: z.array(z.string().url()).min(2).max(10),
        transition: z.enum(["none", "fade", "dissolve"]).optional(),
        transitionDuration: z.number().min(0.1).max(2.0).optional(),
        bgMusicUrl: z.string().optional(),
        bgMusicVolume: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await mergeVideos(input);
      return { url: result.url, duration: result.duration };
    }),
});

// ── Subtitles ─────────────────────────────────────────────────────────────────
export const subtitleRouter = router({
  transcribe: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await transcribeAudio({ audioUrl: input.audioUrl, language: input.language });
      if ("error" in result) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
      }
      const entries: SubtitleEntry[] = result.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      }));
      return { entries, fullText: result.text, language: result.language };
    }),

  burnIn: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        entries: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
        fontSize: z.number().int().min(8).max(48).optional(),
        fontColor: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await burnSubtitles(input.videoUrl, input.entries as SubtitleEntry[], {
        fontSize: input.fontSize,
        fontColor: input.fontColor,
      });
      return { url: result.url };
    }),

  exportSRT: protectedProcedure
    .input(
      z.object({
        entries: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
      })
    )
    .mutation(({ input }) => {
      return { srt: generateSRT(input.entries as SubtitleEntry[]) };
    }),
});

// ── Video Overlay ─────────────────────────────────────────────────────────────
export const overlayRouter = router({
  process: protectedProcedure
    .input(
      z.object({
        inputUrl: z.string().url(),
        mode: z.enum(["watermark", "pip", "color_correction"]),
        // Watermark
        overlayImageUrl: z.string().url().optional(),
        overlayPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional(),
        overlayScale: z.number().min(0.05).max(1.0).optional(),
        overlayOpacity: z.number().min(0).max(1).optional(),
        // PiP
        pipVideoUrl: z.string().url().optional(),
        pipPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
        pipScale: z.number().min(0.1).max(0.5).optional(),
        // Color correction
        brightness: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(0).max(2).optional(),
        saturation: z.number().min(0).max(3).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await overlayVideo(input);
      return { url: result.url };
    }),
});

// ── AI Prompt Enhancement ─────────────────────────────────────────────────────
export const aiEnhanceRouter = router({
  enhance: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(8000),
        mode: z.enum(["expand", "translate_en", "polish", "storyboard_prompt", "translate_zh"]),
        model: z.string().optional(),
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
        model: input.model ?? "gemini-2.5-flash",
      });
      return { result: extractTextContent(response).trim() };
    }),
});
