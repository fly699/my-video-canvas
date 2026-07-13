// #141 模型清单按需注入：快速设置锁定图/视频模型时，对应类别只注入所锁模型的完整
// 条目（含参数表），其余压成「仅名字目录」（明确禁止生成选用，防对被裁模型编造参数）；
// 图/视频独立裁剪；无效锁定值回退全量；不锁 = 与旧版逐字一致（零回归）。
import { describe, it, expect } from "vitest";
import { modelKnowledgeText, imageModelDigestText, videoModelDigestText } from "./_core/agentCatalog";
import { IMAGE_MODELS, VIDEO_MODELS } from "../shared/modelCatalog";

const IMG = IMAGE_MODELS[0].value;
const IMG2 = IMAGE_MODELS[1].value;
const VID = VIDEO_MODELS.find((m) => m.value !== "mock")!.value;

describe("#141 modelKnowledgeText 按需注入", () => {
  it("不锁 = 全量，与旧版逐字一致", () => {
    expect(modelKnowledgeText()).toBe(
      `## 图像模型（image_gen.model / storyboard.imageModel 的合法取值）\n${imageModelDigestText()}\n## 视频模型（video_task.provider 的合法取值；params 键与取值严格按各自参数表，*=默认）\n${videoModelDigestText()}`,
    );
    expect(modelKnowledgeText({})).toBe(modelKnowledgeText());
  });

  it("锁图像：图像段只剩所锁模型完整条目 + 其余名字目录（禁止选用）；视频段仍全量", () => {
    const t = modelKnowledgeText({ pinnedImageModel: IMG });
    // 只有所锁模型保留「- id「名称」」完整条目
    expect(t).toContain(`- ${IMG}「`);
    expect(t).not.toContain(`- ${IMG2}「`);
    // 其余模型进名字目录且带禁止选用说明
    expect(t).toContain("仅供答疑提及");
    expect(t).toContain("【禁止】选用");
    expect(t).toContain(IMG2);
    // 视频段不受影响：全量条目仍在
    expect(t).toContain(videoModelDigestText());
  });

  it("锁视频：视频段只剩所锁模型 params 条目；图像段仍全量", () => {
    const t = modelKnowledgeText({ pinnedVideoModel: VID });
    expect(t).toContain(imageModelDigestText());
    const vid2 = VIDEO_MODELS.find((m) => m.value !== "mock" && m.value !== VID)!.value;
    expect(t).toContain(`- ${VID}「`);
    expect(t).not.toContain(`- ${vid2}「`);
    expect(t).toContain(vid2); // 名字目录里仍可见（答疑用）
  });

  it("双锁体积大幅缩身（< 全量的一半）", () => {
    const full = modelKnowledgeText().length;
    const pinned = modelKnowledgeText({ pinnedImageModel: IMG, pinnedVideoModel: VID }).length;
    expect(pinned).toBeLessThan(full * 0.5);
  });

  it("无效锁定值（拼错/已下架/mock）回退该类别全量，绝不让助手失明", () => {
    expect(modelKnowledgeText({ pinnedImageModel: "no_such_model" })).toBe(modelKnowledgeText());
    expect(modelKnowledgeText({ pinnedVideoModel: "mock" })).toBe(modelKnowledgeText());
  });
});
