import type { AgentOperation, NodeType } from "../../shared/types";

// Nodes that produce an image the downstream video node can use as its first frame.
// storyboard 也算：分镜本身就是生图工位（镜头表批量生图把关键帧生成在分镜上，
// 批量生视频按「分镜→视频直连」找工位并把关键帧作 referenceImageUrl 喂给视频）。
// 在分镜→视频之间再插 image_gen 会一镜两次生图，且直连断裂导致批量生视频
// 找不到既有工位再建一个新的。
const IMAGE_PRODUCER_TYPES = new Set<NodeType>(["image_gen", "comfyui_image", "asset", "character", "storyboard"]);
// Video-generating nodes that should be fed by an image when 生图→生视频 is on.
const VIDEO_TARGET_TYPES = new Set<NodeType>(["video_task", "comfyui_video"]);

/**
 * Deterministically enforce the "先生图再图生视频" preference on an agent plan:
 * for every newly-created video node whose incoming connection comes from a
 * non-image source (storyboard / prompt / script …), splice an `image_gen` node
 * in between — text → image_gen → video — carrying the video's prompt/aspect as
 * the image prompt. Video nodes already fed by an image producer are left as-is.
 *
 * Pure / deterministic. Only operates on nodes created within this same plan
 * (tempIds), where node types are known; connections to pre-existing canvas nodes
 * are left untouched. Caller should skip this in 仅ComfyUI mode (image_gen is
 * disallowed there).
 */
export function enforceImageFirst(ops: AgentOperation[]): AgentOperation[] {
  const typeByTemp = new Map<string, NodeType>();
  const createByTemp = new Map<string, AgentOperation>();
  for (const o of ops) {
    if (o.op === "create" && o.tempId && o.nodeType) {
      typeByTemp.set(o.tempId, o.nodeType);
      createByTemp.set(o.tempId, o);
    }
  }
  const videoTemps = new Set<string>();
  typeByTemp.forEach((ty, t) => { if (VIDEO_TARGET_TYPES.has(ty)) videoTemps.add(t); });
  if (videoTemps.size === 0) return ops;

  // Video nodes already fed by an image producer → already image-first, leave alone.
  const videoHasImage = new Set<string>();
  for (const o of ops) {
    if (o.op === "connect" && o.targetRef && videoTemps.has(o.targetRef) && o.sourceRef) {
      const st = typeByTemp.get(o.sourceRef);
      if (st && IMAGE_PRODUCER_TYPES.has(st)) videoHasImage.add(o.targetRef);
      // 源是画布【已存在节点】（typeByTemp 无记录、类型未知）→ 保守把整段视频标记为「可能已有图源」，
      // 不再对它的其它源强插。否则「已存在图 E + 新建文本 P 同时接入新视频 V」时，E→V 只是被上面
      // 的守卫跳过、V 却没进 videoHasImage，导致 P→V 仍被强插一个 image_gen：V 出现双首帧且多烧一次
      // 生图钱。用户显式接了 E，应尊重其接线、不擅自改画面。
      else if (!typeByTemp.has(o.sourceRef)) videoHasImage.add(o.targetRef);
    }
  }

  const result: AgentOperation[] = [];
  const imgForVideo = new Map<string, string>();
  let counter = 0;
  for (const o of ops) {
    if (
      o.op === "connect" && o.sourceRef && o.targetRef &&
      videoTemps.has(o.targetRef) && !videoHasImage.has(o.targetRef)
    ) {
      const st = typeByTemp.get(o.sourceRef);
      const sourceIsImage = !!st && IMAGE_PRODUCER_TYPES.has(st);
      // 源必须是本批新建节点才知道其类型；源是画布【已存在节点】（typeByTemp 无记录）时保守跳过、
      // 绝不强插——它可能本就是图片节点，强插会把「现有图直接当首帧」改成「现有图→重新生图→视频」，
      // 既改画面又多烧一次生图钱。这才真正兑现函数注释承诺的「pre-existing canvas nodes left untouched」。
      if (typeByTemp.has(o.sourceRef) && !sourceIsImage) {
        let imgRef = imgForVideo.get(o.targetRef);
        if (!imgRef) {
          imgRef = `imgfirst_${++counter}`;
          imgForVideo.set(o.targetRef, imgRef);
          const vCreate = createByTemp.get(o.targetRef);
          const vPayload = (vCreate?.payload ?? {}) as Record<string, unknown>;
          const imgPayload: Record<string, unknown> = {};
          if (typeof vPayload.prompt === "string" && vPayload.prompt) imgPayload.prompt = vPayload.prompt;
          // 反向词同样要带到中间图像节点（否则生成的首帧不避开这些负面，再喂给视频就晚了）。
          if (typeof vPayload.negativePrompt === "string" && vPayload.negativePrompt) imgPayload.negativePrompt = vPayload.negativePrompt;
          if (typeof vPayload.aspectRatio === "string" && vPayload.aspectRatio) imgPayload.aspectRatio = vPayload.aspectRatio;
          result.push({ op: "create", nodeType: "image_gen", tempId: imgRef, title: "静帧", payload: imgPayload, sceneGroup: vCreate?.sceneGroup, note: "生图→生视频：自动插入图像节点作为视频首帧" });
          // image_gen → video ONCE (only when the image node is first created),
          // otherwise multiple non-image sources on one video would duplicate it.
          result.push({ op: "connect", sourceRef: imgRef, targetRef: o.targetRef, note: "生图→生视频" });
        }
        result.push({ ...o, targetRef: imgRef }); // each text source → image_gen
        continue;
      }
    }
    result.push(o);
  }
  return result;
}

// comfyOnly variant: image_gen is disallowed, so the image step must also be a
// comfyui_workflow node (using an image-output template). For each created video
// comfyui_workflow (templateId ∈ videoTplIds) not already fed by an image
// comfyui_workflow (templateId ∈ imageTplIds), splice an image comfyui_workflow
// (templateId = defaultImageTplId, carrying the video's prompt) before it:
// prompt → image-cw → video-cw. Deterministic; doesn't rely on the LLM obeying.
export function enforceImageFirstComfy(
  ops: AgentOperation[],
  imageTplIds: Set<number>,
  videoTplIds: Set<number>,
  defaultImageTplId: number,
): AgentOperation[] {
  const tplByTemp = new Map<string, number>();
  const createByTemp = new Map<string, AgentOperation>();
  const createdTemps = new Set<string>(); // 本批新建的所有 tempId（含 prompt 等非工作流文本源）
  for (const o of ops) {
    if (o.op === "create" && o.tempId) {
      createdTemps.add(o.tempId);
      if (o.nodeType === "comfyui_workflow") {
        const tid = Number((o.payload as Record<string, unknown> | undefined)?.templateId);
        if (Number.isFinite(tid)) tplByTemp.set(o.tempId, tid);
        createByTemp.set(o.tempId, o);
      }
    }
  }
  const videoTemps = new Set<string>();
  tplByTemp.forEach((tid, temp) => { if (videoTplIds.has(tid)) videoTemps.add(temp); });
  if (videoTemps.size === 0) return ops;

  const videoHasImage = new Set<string>();
  for (const o of ops) {
    if (o.op === "connect" && o.targetRef && videoTemps.has(o.targetRef) && o.sourceRef) {
      const st = tplByTemp.get(o.sourceRef);
      if (st != null && imageTplIds.has(st)) videoHasImage.add(o.targetRef);
      // 同 enforceImageFirst：源是画布【已存在节点】（createdTemps 无记录）→ 保守标记整段视频，
      // 不对其它源强插（避免「已存在出图工作流 + 新建文本」双首帧、多烧一次生图钱）。
      else if (!createdTemps.has(o.sourceRef)) videoHasImage.add(o.targetRef);
    }
  }

  const result: AgentOperation[] = [];
  const imgForVideo = new Map<string, string>();
  let counter = 0;
  for (const o of ops) {
    if (o.op === "connect" && o.sourceRef && o.targetRef && videoTemps.has(o.targetRef) && !videoHasImage.has(o.targetRef)) {
      const st = tplByTemp.get(o.sourceRef);
      const sourceIsImage = st != null && imageTplIds.has(st);
      // 同 enforceImageFirst：源须是本批新建节点（prompt 文本源或工作流）；源是画布【已存在节点】
      // 时保守跳过、绝不强插（它可能本就是出图工作流，强插会改画面 + 多烧一次生图钱）。
      if (createdTemps.has(o.sourceRef) && !sourceIsImage) {
        let imgRef = imgForVideo.get(o.targetRef);
        if (!imgRef) {
          imgRef = `imgfirst_cw_${++counter}`;
          imgForVideo.set(o.targetRef, imgRef);
          const vCreate = createByTemp.get(o.targetRef);
          const vPayload = (vCreate?.payload ?? {}) as Record<string, unknown>;
          const imgPayload: Record<string, unknown> = { templateId: defaultImageTplId };
          if (typeof vPayload.prompt === "string" && vPayload.prompt) imgPayload.prompt = vPayload.prompt;
          if (typeof vPayload.negPrompt === "string" && vPayload.negPrompt) imgPayload.negPrompt = vPayload.negPrompt;
          // 比例也带过去（与普通变体对齐）：否则首帧按出图模板默认尺寸生成，喂给 9:16 视频就变形。
          // aspectRatio 需配合 overrideRatioSize 才生效，故两者一并搬运。
          if (typeof vPayload.aspectRatio === "string" && vPayload.aspectRatio) imgPayload.aspectRatio = vPayload.aspectRatio;
          if (vPayload.overrideRatioSize != null) imgPayload.overrideRatioSize = vPayload.overrideRatioSize;
          result.push({ op: "create", nodeType: "comfyui_workflow", tempId: imgRef, title: "出图", payload: imgPayload, sceneGroup: vCreate?.sceneGroup, note: "生图→生视频：自动插入出图工作流作为视频首帧" });
          result.push({ op: "connect", sourceRef: imgRef, targetRef: o.targetRef, note: "生图→生视频" }); // 出图→视频 仅一次
        }
        result.push({ ...o, targetRef: imgRef });
        continue;
      }
    }
    result.push(o);
  }
  return result;
}
