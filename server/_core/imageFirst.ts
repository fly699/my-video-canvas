import type { AgentOperation, NodeType } from "../../shared/types";

// Nodes that produce an image the downstream video node can use as its first frame.
const IMAGE_PRODUCER_TYPES = new Set<NodeType>(["image_gen", "comfyui_image", "asset", "character"]);
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
      if (!sourceIsImage) {
        let imgRef = imgForVideo.get(o.targetRef);
        if (!imgRef) {
          imgRef = `imgfirst_${++counter}`;
          imgForVideo.set(o.targetRef, imgRef);
          const vPayload = (createByTemp.get(o.targetRef)?.payload ?? {}) as Record<string, unknown>;
          const imgPayload: Record<string, unknown> = {};
          if (typeof vPayload.prompt === "string" && vPayload.prompt) imgPayload.prompt = vPayload.prompt;
          if (typeof vPayload.aspectRatio === "string" && vPayload.aspectRatio) imgPayload.aspectRatio = vPayload.aspectRatio;
          result.push({ op: "create", nodeType: "image_gen", tempId: imgRef, title: "静帧", payload: imgPayload, note: "生图→生视频：自动插入图像节点作为视频首帧" });
        }
        result.push({ ...o, targetRef: imgRef });          // text source → image_gen
        result.push({ op: "connect", sourceRef: imgRef, targetRef: o.targetRef, note: "生图→生视频" }); // image_gen → video
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
  for (const o of ops) {
    if (o.op === "create" && o.tempId && o.nodeType === "comfyui_workflow") {
      const tid = Number((o.payload as Record<string, unknown> | undefined)?.templateId);
      if (Number.isFinite(tid)) tplByTemp.set(o.tempId, tid);
      createByTemp.set(o.tempId, o);
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
    }
  }

  const result: AgentOperation[] = [];
  const imgForVideo = new Map<string, string>();
  let counter = 0;
  for (const o of ops) {
    if (o.op === "connect" && o.sourceRef && o.targetRef && videoTemps.has(o.targetRef) && !videoHasImage.has(o.targetRef)) {
      const st = tplByTemp.get(o.sourceRef);
      const sourceIsImage = st != null && imageTplIds.has(st);
      if (!sourceIsImage) {
        let imgRef = imgForVideo.get(o.targetRef);
        if (!imgRef) {
          imgRef = `imgfirst_cw_${++counter}`;
          imgForVideo.set(o.targetRef, imgRef);
          const vPayload = (createByTemp.get(o.targetRef)?.payload ?? {}) as Record<string, unknown>;
          const imgPayload: Record<string, unknown> = { templateId: defaultImageTplId };
          if (typeof vPayload.prompt === "string" && vPayload.prompt) imgPayload.prompt = vPayload.prompt;
          if (typeof vPayload.negPrompt === "string" && vPayload.negPrompt) imgPayload.negPrompt = vPayload.negPrompt;
          result.push({ op: "create", nodeType: "comfyui_workflow", tempId: imgRef, title: "出图", payload: imgPayload, note: "生图→生视频：自动插入出图工作流作为视频首帧" });
        }
        result.push({ ...o, targetRef: imgRef });
        result.push({ op: "connect", sourceRef: imgRef, targetRef: o.targetRef, note: "生图→生视频" });
        continue;
      }
    }
    result.push(o);
  }
  return result;
}
