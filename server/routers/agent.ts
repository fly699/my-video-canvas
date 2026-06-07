import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { assertProjectAccess } from "../_core/permissions";
import { assertLLMAllowed } from "../_core/whitelist";
import { invokeLLM, extractTextContent } from "../_core/llm";
import { catalogText, sanitizeOperation, templateKnowledgeText } from "../_core/agentCatalog";
import { enforceImageFirst, enforceImageFirstComfy } from "../_core/imageFirst";
import { runLibraryAnalysis } from "../_core/templateAnalysis";
import * as db from "../db";
import type { AgentOperation } from "../../shared/types";

// ── Agent (Copilot) router ────────────────────────────────────────────────────
// `chat` is the agent's "planning brain": it turns a natural-language request +
// the current graph into a set of canvas operations (create/connect/update/
// delete). It NEVER mutates the canvas server-side — the client applies the
// returned operations through the canvas store, so every change is undoable,
// persisted and broadcast exactly like a manual edit. LLM-gated (respects the
// admin "open LLM" toggle); editor access required.
export const agentRouter = router({
  chat: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        message: z.string().min(1).max(4000),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .max(20)
          .optional(),
        graphSummary: z.string().max(20000).optional(),
        model: z.string().optional(),
        comfyOnly: z.boolean().optional(),
        /** Pre-rendered 用户偏好/约束 block from the agent node's 规划设置 dialog. */
        prefs: z.string().max(2000).optional(),
        /** 生图→生视频偏好：开启后服务端确定性地把 文本→视频 改写为 文本→图像→视频。 */
        imageFirst: z.boolean().optional(),
        /** 用户在「模板选择」里指定的 comfyui_workflow 模板（留空=自动选择）。 */
        imageTemplateId: z.number().optional(),
        videoTemplateId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertLLMAllowed(ctx);

      const model = input.model ?? "claude-sonnet-4-5-20250929";

      // Before planning, refresh template knowledge: incrementally analyze any
      // newly-added / changed templates (capped so a turn isn't blocked on a big
      // backlog), then read the latest analyses to feed the model. Best-effort.
      // Refresh template knowledge before planning. comfyOnly REQUIRES the full
      // library be analyzed (otherwise the agent only "knows" a partial subset and
      // picks the wrong templates), so analyze many per turn there; results are
      // cached so only new/changed templates re-run on later turns.
      try { await runLibraryAnalysis(model, { max: input.comfyOnly ? 40 : 6 }); } catch { /* non-fatal */ }
      let templateSection = "";
      const validTemplateIds = new Set<number>();
      let hasImageTemplate = false;
      let hasVideoTemplate = false;
      let imageTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      let videoTpls: { id: number; label: string; shotSeconds?: number | null; caps?: string[] }[] = [];
      try {
        const [templates, analyses] = await Promise.all([db.listComfyNodeTemplates(), db.listComfyTemplateAnalysis()]);
        // Only comfyui_workflow templates carry a workflowJson + paramBindings, and
        // only the comfyui_workflow node references templates by payload.templateId
        // (comfyui_image / comfyui_video templates have NO templateId field in the
        // catalog). Referencing a non-workflow template id from a comfyui_workflow
        // node materializes to an EMPTY node (no workflow, no params/model), so the
        // agent's template set MUST be restricted to comfyui_workflow templates.
        const labelById = new Map(templates.filter((t) => t.nodeType === "comfyui_workflow").map((t) => [t.id, t.label]));
        const rows = analyses
          .filter((a) => labelById.has(a.templateId))
          .sort((a, b) => (b.hasVideoOutput ? 1 : 0) - (a.hasVideoOutput ? 1 : 0))
          .map((a) => ({ id: a.templateId, label: labelById.get(a.templateId)!, functionSummary: a.functionSummary ?? "", capabilities: (a.capabilities as string[] | null) ?? [], outputType: a.outputType ?? undefined, hasVideoOutput: a.hasVideoOutput ?? undefined, shotSeconds: a.maxFrames && a.fps ? Math.round((a.maxFrames / a.fps) * 10) / 10 : null }));
        for (const r of rows) validTemplateIds.add(r.id);
        imageTpls = rows.filter((r) => r.outputType === "image" || r.outputType === "mixed").map((r) => ({ id: r.id, label: r.label, shotSeconds: r.shotSeconds, caps: r.capabilities }));
        videoTpls = rows.filter((r) => r.hasVideoOutput || r.outputType === "video" || r.outputType === "mixed").map((r) => ({ id: r.id, label: r.label, shotSeconds: r.shotSeconds, caps: r.capabilities }));
        hasImageTemplate = imageTpls.length > 0;
        hasVideoTemplate = videoTpls.length > 0;
        if (rows.length > 0) {
          templateSection = `\n\n# 已分析的 ComfyUI 自定义工作流模板（comfyui_workflow 可用 payload.templateId 引用其 id）\n${templateKnowledgeText(rows)}`;
        }
      } catch (e) {
        // Surface (don't silently swallow) — most likely the analysis table is
        // missing (migration 0037 not applied), which otherwise looks like an
        // "empty library" to the agent.
        console.warn("[agent] template analysis unavailable:", e instanceof Error ? e.message : e);
      }

      // 仅 ComfyUI 模式但没有任何「已分析模板」可用：拒绝并明确指引，避免 LLM 编造模板生成空壳节点。
      if (input.comfyOnly && validTemplateIds.size === 0) {
        return {
          reply: "已开启「仅 ComfyUI 生成」，但模板知识库为空——我没有任何可引用的已分析工作流模板。请先点工具栏的「新增节点模板库分析」分析你的模板库；若分析后仍为空，多半是数据库尚未应用模板分析表迁移（管理后台「系统更新」跑一次即可）。完成后再让我编排。",
          operations: [],
        };
      }

      // 仅 ComfyUI + 生图→生视频，但缺出图或缺图生视频模板：无法串联，明确指引而非硬凑。
      if (input.comfyOnly && input.imageFirst && (!hasImageTemplate || !hasVideoTemplate)) {
        const missing = !hasImageTemplate ? "「出图（文生图）」" : "「图生视频 / 出视频」";
        return {
          reply: `已开启「仅 ComfyUI 生成」+「生图→生视频」，但模板库里缺少${missing}的工作流模板，无法把"先生图再图生视频"串起来。请在模板库添加并分析一个对应的工作流，或在「规划设置」里关闭「生图→生视频」。（当前已识别：出图模板 ${imageTpls.length} 个、视频模板 ${videoTpls.length} 个。）`,
          operations: [],
        };
      }

      // Prefer the user's explicitly-chosen templates (「模板选择」对话框); else auto-pick.
      const chosenVid = videoTpls.find((t) => t.id === input.videoTemplateId) ?? videoTpls[0];
      // Image template must differ from the video one (a "mixed" template appears in
      // both lists — using the same for both defeats 出图→图生视频).
      const chosenImg = imageTpls.find((t) => t.id === input.imageTemplateId && t.id !== chosenVid?.id)
        ?? imageTpls.find((t) => t.id !== chosenVid?.id)
        ?? imageTpls[0];
      // 按所选模板的特性参数（每镜时长、能力标签）指导分镜规划。
      const capsOf = (t?: { caps?: string[] }) => (t?.caps?.length ? `[${t.caps.join("/")}]` : "");
      const durPlanHint = (t?: { shotSeconds?: number | null }) =>
        t?.shotSeconds && t.shotSeconds > 0 ? `请按该视频模板每镜≈${t.shotSeconds}s 规划镜头数（镜头数≈ceil(目标总时长/${t.shotSeconds})）。` : "";
      const imgVidHint = input.comfyOnly && input.imageFirst && chosenImg && chosenVid
        ? `\n- 本次出图请用模板 id=${chosenImg.id}「${chosenImg.label}」${capsOf(chosenImg)}；图生视频请用模板 id=${chosenVid.id}「${chosenVid.label}」${capsOf(chosenVid)}${chosenVid.shotSeconds ? `（每镜≈${chosenVid.shotSeconds}s）` : ""}。每个镜头各建这两个 comfyui_workflow 并串联（出图 → 图生视频）。${durPlanHint(chosenVid)} 请结合上述模板的能力标签与时长特性来设计分镜（数量、节奏、每镜内容）。`
        : "";

      const comfyConstraint = input.comfyOnly
        ? `\n\n# 仅 ComfyUI 生成（当前已开启）\n- 所有图像/视频/音频生成只能使用 comfyui_workflow 自定义工作流节点；禁止使用 image_gen / video_task / audio / comfyui_image / comfyui_video / storyboard。\n- create comfyui_workflow 时必须用 payload.templateId 引用上面「已分析模板」中真实存在的某个 id（禁止编造 id 或只写名字），并把正向提示词放入 payload.prompt、反向放 payload.negPrompt。${
            input.imageFirst
              ? `\n- 【生图→生视频，已开启】每个镜头必须分两步、串联两个 comfyui_workflow 节点：先用一个「出图模板」(上面 outputType=image 的模板) 的 comfyui_workflow 生成静帧，再用一个「图生视频模板」(outputType=video / hasVideoOutput 的模板) 的 comfyui_workflow 把静帧转成视频；并连接 出图节点 → 图生视频节点（链路：script → prompt → 出图comfyui_workflow → 图生视频comfyui_workflow → merge）。出图与图生视频必须各用对应 outputType 的模板，不能用同一个；两个节点的 payload.prompt 都写该镜头提示词。${imgVidHint}`
              : `\n- 每个镜头用一个「prompt 提示词」节点承载该镜头的提示词，再连接到对应的 comfyui_workflow 节点（script → prompt → comfyui_workflow）。${chosenVid ? `\n- 本次生成请优先使用模板 id=${chosenVid.id}「${chosenVid.label}」${capsOf(chosenVid)}${chosenVid.shotSeconds ? `（每镜≈${chosenVid.shotSeconds}s）` : ""}。${durPlanHint(chosenVid)} 请结合该模板的能力与时长特性设计分镜。` : ""}`
          }`
        : "";

      const system = `你是「AI 视频画布」的智能体副驾（Copilot）。用户用自然语言描述想做的视频，你负责把它拆解为画布上的节点工作流。

# 可用节点目录（只能使用下面列出的节点类型与字段，禁止编造任何不存在的节点或字段）
${catalogText({ comfyOnly: input.comfyOnly })}${templateSection}${comfyConstraint}

# 当前画布
${input.graphSummary?.trim() || "（空画布）"}${input.prefs?.trim() ? `\n\n# 用户偏好/约束（必须遵守）\n${input.prefs.trim()}` : ""}

# 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构如下：
{
  "reply": "给用户的简短中文说明（你打算怎么做 / 或直接回答）",
  "operations": [
    { "op": "create", "tempId": "n1", "nodeType": "prompt", "title": "可选标题", "payload": { "positivePrompt": "..." }, "note": "为什么这么做" },
    { "op": "connect", "sourceRef": "n1", "targetRef": "n2", "note": "..." },
    { "op": "update", "targetRef": "已存在节点的id", "payload": { } },
    { "op": "delete", "targetRef": "节点id" }
  ]
}

规则：
- 新建节点用 "create" 并赋唯一 tempId；之后的 "connect" 用 tempId 或画布中已存在的节点 id 互相连接（sourceRef→targetRef）。
- 每个节点的 payload 只能使用目录中该节点类型列出的字段名。
- 按创作链路合理编排：脚本/分镜 → 提示词/图像/视频 → 合并/字幕/配乐。
- 模板智能匹配：选用 comfyui_workflow 模板时，按需求匹配 outputType（生图选 image、生视频选 video），并参考 capabilities 标签挑最贴合的模板；视频优先 hasVideoOutput 的模板。
- 时长感知拆镜（重要）：视频模板/模型每镜有最长时长（上面括号里的「每镜≈Ns」就是单个镜头能生成的秒数上限）。当用户的目标总时长 T 大于所选模板的每镜上限 d 时，绝不能只做几个镜头，必须按 镜头数 = ceil(T / d) 规划足够多的镜头，使 镜头数 × d ≈ T（例：目标 60s、每镜 5s → 需 12 个镜头）。把这些镜头组织成若干「场景」（叙事段落），每个场景包含一个或多个镜头。
- 场景分组：为每个生成节点加 sceneGroup 字段标注它属于哪个场景（如 "s1"/"s2"…，同一场景的镜头用同一个值），画布会据此把同场景的镜头框进一个「场景」分组容器。所有镜头仍各自连入 merge 合并成片。
- 角色一致性：当故事有反复出现的人物/主角时，为每个主要角色创建一个 character 节点（填 name/role/appearance/outfit/signature），并把该 character 连接到它出现的每一个分镜/生成节点（character → storyboard/comfyui_image/image_gen/video_task）。这样跨镜的脸/服装/特征会保持一致（连到 ComfyUI 图像节点会自动用作 IPAdapter 人脸参考）。同一角色只建一个节点、复用连接到多个镜头，不要每镜各建一个。
- 规划摘要：当涉及视频时长拆分时，在返回 JSON 顶层additionally给出 plan 对象：{"targetSeconds":目标总秒数,"perShotSeconds":每镜秒数,"templateLabel":"所选模板名","shots":镜头总数}，供前端做时长校验与提示。
- 运行自愈：当画布摘要里某节点 status=failed（或缺少必要参数/连接）时，可主动用 update/connect 修复（补全提示词、参考图、连线或换更合适的模板），并在 reply 说明修了什么。
- 若用户只是提问、或当前无需改动画布，operations 给空数组 []，把回答写进 reply。
- 你只负责把工作流搭好并填好参数；是否触发生成由用户在画布上确认。`;

      const messages = [
        { role: "system" as const, content: system },
        ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: input.message },
      ];

      // A full multi-shot plan (script + N storyboards + connects + merge) is a
      // large JSON object. 4000 tokens truncated it → JSON.parse failed → the raw
      // (truncated) JSON leaked into the chat as "乱码". Give it plenty of room
      // (capped per-model by resolveMaxTokens). NB: we deliberately do NOT force
      // response_format json_object — the default model is Claude (proxied), where
      // the OpenAI-style flag isn't reliably supported; the robust parse below
      // handles fences/prose instead.
      const response = await invokeLLM({ messages, model, maxTokens: 16000 });
      const text = extractTextContent(response);

      let reply = text.trim();
      let operations: AgentOperation[] = [];
      let plan: { targetSeconds: number; perShotSeconds: number; templateLabel?: string; shots: number } | undefined;
      // Strip an accidental ```json fence (belt-and-suspenders; json_object mode
      // shouldn't add one) before matching the outermost { … } object.
      const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      let parsedOk = false;
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { reply?: unknown; operations?: unknown; plan?: unknown };
          parsedOk = true;
          reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "已规划完成。";
          if (Array.isArray(parsed.operations)) {
            operations = parsed.operations
              .map((o) => sanitizeOperation(o, { comfyOnly: input.comfyOnly, validTemplateIds }))
              .filter((o): o is AgentOperation => o !== null);
            // 生图→生视频：确定性强制——即使 LLM 没照做也保证生效。
            // 非 ComfyUI：插 image_gen（文本→image_gen→视频）。
            // 仅 ComfyUI：插出图 comfyui_workflow（prompt→出图→图生视频），用识别到的出图/视频模板。
            if (input.imageFirst) {
              if (input.comfyOnly && chosenImg && chosenVid) {
                operations = enforceImageFirstComfy(operations, new Set(imageTpls.map((t) => t.id)), new Set(videoTpls.map((t) => t.id)), chosenImg.id);
              } else if (!input.comfyOnly) {
                operations = enforceImageFirst(operations);
              }
            }
          }
          // Optional planning summary (duration-aware shot split) for the client's
          // capacity dialog. Only accept well-formed numeric fields.
          const p = parsed.plan as Record<string, unknown> | undefined;
          if (p && typeof p.targetSeconds === "number" && typeof p.perShotSeconds === "number" && typeof p.shots === "number") {
            plan = {
              targetSeconds: p.targetSeconds,
              perShotSeconds: p.perShotSeconds,
              shots: p.shots,
              templateLabel: typeof p.templateLabel === "string" ? p.templateLabel : undefined,
            };
          }
        } catch {
          /* malformed/truncated JSON — handled below */
        }
      }
      // Graceful fallback: never dump a raw/truncated JSON blob into the chat.
      // If the model clearly attempted a plan (has "operations") but it didn't
      // parse, it was almost certainly truncated → ask the user to retry smaller.
      // Otherwise the model answered in plain prose (a question/explanation) → keep it.
      if (!parsedOk) {
        if (/"operations"\s*:/.test(cleaned) || /^\s*[`{]/.test(text)) {
          reply = "规划结果过长，未能完整返回（可能被截断）。请重试，或减少镜头数 / 缩短目标时长后再试。";
          operations = [];
        } else {
          reply = text.trim();
        }
      }
      return { reply, operations, plan };
    }),

  // Generate per-shot descriptions for a 成片配方 from a topic, so the recipe's
  // shots get topic-specific content instead of fixed placeholder beats. Returns
  // a plain string[]; the client builds the node chain deterministically.
  recipeShots: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        recipeName: z.string().min(1).max(100),
        topic: z.string().max(2000).optional(),
        shots: z.number().int().min(1).max(20),
        style: z.string().max(200).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertLLMAllowed(ctx);
      const model = input.model ?? "claude-sonnet-4-5-20250929";
      const system = `你是短视频分镜编剧。根据给定的视频类型与主题，输出恰好 ${input.shots} 个镜头的中文画面描述。要求：每条 15-40 字，具体可拍（画面主体 / 动作 / 环境 / 镜头语言），按叙事顺序连贯推进，不要编号前缀。严格只输出一个 JSON 字符串数组，例如 ["镜头1描述","镜头2描述"]，不要 markdown、不要任何多余文字。`;
      const user = `视频类型：${input.recipeName}\n主题：${input.topic?.trim() || "（未指定，请自拟一个吸引人的主题）"}${input.style?.trim() ? `\n风格：${input.style.trim()}` : ""}\n镜头数：${input.shots}`;
      const response = await invokeLLM({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        model, maxTokens: 1500,
      });
      const text = extractTextContent(response);
      let shots: string[] = [];
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const arr = JSON.parse(m[0]) as unknown;
          if (Array.isArray(arr)) shots = arr.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
        } catch { /* fall through — empty shots → client uses default beats */ }
      }
      return { shots };
    }),
});
