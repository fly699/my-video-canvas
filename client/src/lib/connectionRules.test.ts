import { describe, it, expect } from "vitest";
import { isConnectionValid, isHandleConnectionValid, getCompatibleTargets, getCompatibleSources, defaultTargetHandle } from "./connectionRules";
import { computeClipHandleState } from "../hooks/useConnectingStore";

describe("defaultTargetHandle", () => {
  it("剪辑(clip)无 input 桩：视频/素材源默认连 video-in", () => {
    expect(defaultTargetHandle("clip", "video_task")).toBe("video-in");
    expect(defaultTargetHandle("clip", "asset")).toBe("video-in");
    expect(defaultTargetHandle("clip", "comfyui_video")).toBe("video-in");
    expect(defaultTargetHandle("clip")).toBe("video-in"); // 源未知也走 video-in
  });
  it("剪辑(clip)：音频源连 audio-in", () => {
    expect(defaultTargetHandle("clip", "audio")).toBe("audio-in");
    // 音频 asset（sourceType==="asset" 但 sourceIsAudio=true）也应落到 audio-in
    expect(defaultTargetHandle("clip", "asset", true)).toBe("audio-in");
    // 图像/视频 asset（sourceIsAudio=false）仍落 video-in
    expect(defaultTargetHandle("clip", "asset", false)).toBe("video-in");
  });
  it("其它目标类型一律沿用 input", () => {
    expect(defaultTargetHandle("video_task", "image_gen")).toBe("input");
    expect(defaultTargetHandle("merge", "clip")).toBe("input");
    expect(defaultTargetHandle(undefined)).toBe("input");
  });
});

describe("isConnectionValid", () => {
  it("allows img-producing comfy nodes to self-chain, but NOT comfyui_video", () => {
    expect(isConnectionValid("comfyui_image", "comfyui_image")).toBe(true); // img2img 再生
    expect(isConnectionValid("comfyui_workflow", "comfyui_workflow")).toBe(true); // 图串联
    // comfyui_video 产出视频，下游 comfy 只吃图/无视频输入槽 → 视频自链无处落地（死边，已删）。
    expect(isConnectionValid("comfyui_video", "comfyui_video")).toBe(false);
  });

  it("allows IMG-source comfy nodes to feed other comfy types, but rejects VIDEO→comfy (dead)", () => {
    // 图源 → i2v / 工作流：数据能被 detectUpstreamImages / 工作流图像参数消费。
    expect(isConnectionValid("comfyui_image", "comfyui_video")).toBe(true);
    expect(isConnectionValid("comfyui_image", "comfyui_workflow")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "comfyui_image")).toBe(true);
    // comfyui_video 产视频，comfy 节点无法消费（IMAGE_SOURCE_TYPES 不含它、工作流无 video 槽）→ 全为死边。
    expect(isConnectionValid("comfyui_video", "comfyui_image")).toBe(false);
    expect(isConnectionValid("comfyui_video", "comfyui_workflow")).toBe(false);
  });

  it("still blocks same-type pairs the matrix does not list (e.g. prompt→prompt)", () => {
    expect(isConnectionValid("prompt", "prompt")).toBe(false);
    expect(isConnectionValid("storyboard", "storyboard")).toBe(false);
    expect(isConnectionValid("image_gen", "image_gen")).toBe(true); // 出图→出图（img2img 再生）本就允许
  });

  it("允许 video_task → video_task（V2V/上采样/Aleph/对口型：生成视频作另一视频任务的源视频参考）", () => {
    // 运行时 collectVideoRefMedia/listUpstreamVideoSources 认 video_task 为视频源；不支持 ref-video
    // 的 provider 会忽略该连接（无害）。这是有意保留的同类自链。
    expect(isConnectionValid("video_task", "video_task")).toBe(true);
    expect(getCompatibleTargets("video_task")).toContain("video_task");
  });

  it("音频可连入视频任务（数字人/对口型的驱动音频，OmniHuman/Volcengine/Kling Avatar）", () => {
    expect(isConnectionValid("audio", "video_task")).toBe(true);
  });

  it("图像源不能连剪辑(clip)：clip 只裁切视频", () => {
    // 纯图像产出节点 → clip 无效（运行时取不到视频）。
    expect(isConnectionValid("image_gen", "clip")).toBe(false);
    expect(isConnectionValid("image_edit", "clip")).toBe(false);
    expect(isConnectionValid("comfyui_image", "clip")).toBe(false);
    // 能产出视频的源 → clip 仍有效。
    expect(isConnectionValid("video_task", "clip")).toBe(true);
    expect(isConnectionValid("asset", "clip")).toBe(true);
    expect(isConnectionValid("comfyui_video", "clip")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "clip")).toBe(true);
  });

  it("分镜关键帧可作图源连入角色与构图控制（与其它图源一视同仁）", () => {
    // storyboard.imageUrl 是合法图源：character 经 detectUpstreamImagesExpanded、pose_control 经
    // getNodeImageOutput 都能取其图。此前被矩阵单独拒收，属不对称缺口，已放开。
    expect(isConnectionValid("storyboard", "character")).toBe(true);
    expect(isConnectionValid("storyboard", "pose_control")).toBe(true);
    expect(getCompatibleSources("character")).toContain("storyboard");
    expect(getCompatibleSources("pose_control")).toContain("storyboard");
  });

  it("删除的死边：脚本/提示词/角色/AI对话 之间无效消费的连线一律拒绝", () => {
    // ScriptNode 不读上游 → prompt/ai_chat → script 无效。
    expect(isConnectionValid("prompt", "script")).toBe(false);
    expect(isConnectionValid("ai_chat", "script")).toBe(false);
    // CharacterNode 只吃图源 → script → character 无效（脚本是文本）。
    expect(isConnectionValid("script", "character")).toBe(false);
    // PromptNode 只读 detectUpstreamPrompt（不含 character）→ character → prompt 无效（用 @角色）。
    expect(isConnectionValid("character", "prompt")).toBe(false);
    // 反查：script 无可接收源；prompt 只接收 脚本/分镜/AI对话。
    expect(getCompatibleSources("script")).toEqual([]);
    expect(getCompatibleSources("prompt").sort()).toEqual(["ai_chat", "script", "storyboard"]);
  });

  it("保留的有效文本流：脚本→分镜/提示词/AI对话仍有效", () => {
    expect(isConnectionValid("script", "storyboard")).toBe(true);
    expect(isConnectionValid("script", "prompt")).toBe(true);
    expect(isConnectionValid("script", "ai_chat")).toBe(true);
    expect(isConnectionValid("prompt", "storyboard")).toBe(true);
  });

  it("respects matrix direction (rejects unlisted target)", () => {
    expect(isConnectionValid("clip", "comfyui_image")).toBe(false);
    expect(isConnectionValid("audio", "image_gen")).toBe(false);
  });

  it("treats null endpoints and note as always valid", () => {
    expect(isConnectionValid(null, "comfyui_image")).toBe(true);
    expect(isConnectionValid("note", "note")).toBe(true);
  });

  it("audio → merge（整片配乐）双向推导跟随矩阵：弹出菜单候选包含彼此", () => {
    expect(isConnectionValid("audio", "merge")).toBe(true);
    // 拖线落空白弹出的建节点菜单直接读这两个推导函数——矩阵更新即菜单更新
    expect(getCompatibleTargets("audio")).toContain("merge");
    expect(getCompatibleSources("merge")).toContain("audio");
  });

  it("subtitle / subtitle_motion → merge（已挂字幕视频入成片）跟随矩阵：配方 视频→字幕→合并 不再判失败", () => {
    expect(isConnectionValid("subtitle", "merge")).toBe(true);
    expect(isConnectionValid("subtitle_motion", "merge")).toBe(true);
    expect(getCompatibleTargets("subtitle")).toContain("merge");
    expect(getCompatibleSources("merge")).toContain("subtitle");
  });

  it("lets a merge (合并) video feed a clip (剪辑) node", () => {
    expect(isConnectionValid("merge", "clip")).toBe(true);
    expect(isConnectionValid("merge", "asset")).toBe(true); // still allowed
  });

  it("合并节点的「可连入」矩阵必须覆盖 MergeNode 实际消费的全部视频源类型（防再次漂移）", () => {
    // 与 MergeNode.tsx 的 VIDEO_SOURCE_TYPES 保持一致——任一类型缺失都会让该视频源
    // 无法拖线/被智能体建线连入合并节点（曾缺 overlay→merge、merge→merge）。
    const MERGE_VIDEO_SOURCES = [
      "video_task", "clip", "merge", "overlay", "asset",
      "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow",
    ] as const;
    for (const src of MERGE_VIDEO_SOURCES) {
      expect(isConnectionValid(src, "merge"), `${src}→merge 应允许`).toBe(true);
      expect(getCompatibleSources("merge"), `merge 可连入来源应含 ${src}`).toContain(src);
    }
    // 音频作整片配乐也必须能连入
    expect(isConnectionValid("audio", "merge")).toBe(true);
  });

  it("lets image producers feed a character (角色) node as a reference image", () => {
    expect(isConnectionValid("asset", "character")).toBe(true);
    expect(isConnectionValid("image_gen", "character")).toBe(true);
    expect(isConnectionValid("comfyui_image", "character")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "character")).toBe(true);
    // video producers must NOT feed a character image reference
    expect(isConnectionValid("video_task", "character")).toBe(false);
    expect(isConnectionValid("comfyui_video", "character")).toBe(false);
  });

  it("视频任务「可连入」矩阵须覆盖全部视频源类型（V2V/上采样/Aleph/对口型的源视频参考，防漂移）", () => {
    // 与 useWorkflowRunner/videoRefMedia 的 VIDEO_SOURCE_TYPES 对齐——任一缺失都会让该视频源
    // 无法拖线连入视频任务作源视频（此前只允许 asset/comfyui_workflow → video_task）。
    const VIDEO_SOURCES = [
      "video_task", "clip", "merge", "overlay", "asset",
      "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow",
    ] as const;
    for (const src of VIDEO_SOURCES) {
      expect(isConnectionValid(src, "video_task"), `${src}→video_task 应允许`).toBe(true);
      expect(getCompatibleSources("video_task"), `video_task 可连入来源应含 ${src}`).toContain(src);
    }
  });

  it("图像产出节点 → ComfyUI 图像（img2img/参考图）：image_gen/image_edit/director/pose_control 均可", () => {
    for (const src of ["image_gen", "image_edit", "director", "pose_control"] as const) {
      expect(isConnectionValid(src, "comfyui_image"), `${src}→comfyui_image 应允许`).toBe(true);
      expect(getCompatibleSources("comfyui_image")).toContain(src);
    }
  });

  it("构图控制(pose_control)可作 ControlNet/参考图源连入 ComfyUI 与视频节点", () => {
    // propagateControlMap 明确把姿态图推给下游 comfyui_image 的 ControlNet；运行时也认它为图源。
    for (const tgt of ["comfyui_image", "comfyui_video", "comfyui_workflow", "video_task"] as const) {
      expect(isConnectionValid("pose_control", tgt), `pose_control→${tgt} 应允许`).toBe(true);
    }
  });

  it("视频后处理节点互为源/消费者：任一后处理输出可再喂给其它后处理（不自链）", () => {
    const PROCS = ["clip", "overlay", "subtitle", "subtitle_motion", "smart_cut", "merge"] as const;
    for (const a of PROCS) {
      for (const b of PROCS) {
        // merge 允许自链（合并链）；其余同类不自链。
        const expected = a === b ? a === "merge" : true;
        expect(isConnectionValid(a, b), `${a}→${b} 期望 ${expected}`).toBe(expected);
      }
    }
    // 典型此前失败的真实链路
    expect(isConnectionValid("overlay", "subtitle")).toBe(true);
    expect(isConnectionValid("merge", "subtitle")).toBe(true);
    expect(isConnectionValid("smart_cut", "merge")).toBe(true);
  });

  it("分镜关键帧可进图像编辑；素材(视频)可连叠加", () => {
    expect(isConnectionValid("storyboard", "image_edit")).toBe(true);
    expect(isConnectionValid("asset", "overlay")).toBe(true);
  });
});

describe("isHandleConnectionValid — 剪辑 video-in / audio-in 句柄级校验", () => {
  it("音频源只对 audio-in 合法，不得落 video-in", () => {
    expect(isHandleConnectionValid("audio", "clip", "audio-in")).toBe(true);
    expect(isHandleConnectionValid("audio", "clip", "video-in")).toBe(false);
  });
  it("视频源只对 video-in 合法，不得落 audio-in", () => {
    expect(isHandleConnectionValid("video_task", "clip", "video-in")).toBe(true);
    expect(isHandleConnectionValid("video_task", "clip", "audio-in")).toBe(false);
  });
  it("音频素材(sourceIsAudio) 对齐 audio-in", () => {
    expect(isHandleConnectionValid("asset", "clip", "audio-in", true)).toBe(true);
    expect(isHandleConnectionValid("asset", "clip", "video-in", true)).toBe(false);
    // 视频素材(默认非音频)反过来
    expect(isHandleConnectionValid("asset", "clip", "video-in", false)).toBe(true);
    expect(isHandleConnectionValid("asset", "clip", "audio-in", false)).toBe(false);
  });
  it("非剪辑目标不受句柄细分影响（沿用类型校验）", () => {
    expect(isHandleConnectionValid("prompt", "image_gen", "input")).toBe(true);
    expect(isHandleConnectionValid("audio", "image_gen", "input")).toBe(false); // 类型本就不合法
  });
});

describe("computeClipHandleState — 拖拽时剪辑两桩分辨高亮", () => {
  const drag = (fromType: Parameters<typeof computeClipHandleState>[0]["fromType"], fromIsAudio = false) =>
    ({ fromType, fromId: "src", fromHandleType: "source" as const, fromIsAudio });
  it("拖音频源：audio-in=valid、video-in=muted", () => {
    expect(computeClipHandleState(drag("audio"), "clip1", "audio-in")).toBe("valid");
    expect(computeClipHandleState(drag("audio"), "clip1", "video-in")).toBe("muted");
  });
  it("拖视频源：video-in=valid、audio-in=muted", () => {
    expect(computeClipHandleState(drag("video_task"), "clip1", "video-in")).toBe("valid");
    expect(computeClipHandleState(drag("video_task"), "clip1", "audio-in")).toBe("muted");
  });
  it("拖不兼容源：invalid", () => {
    expect(computeClipHandleState(drag("script"), "clip1", "video-in")).toBe("invalid");
  });
});
