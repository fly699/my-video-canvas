import { describe, it, expect } from "vitest";
import { stripRehostedUrls } from "./routers/chat";
import { extractHiggsfieldUrls } from "./routers/agent";

const HF = "https://d8j0ntlcm91z4.cloudfront.net/user_1/hf_20260711_cat.png";
const HF2 = "https://assets.higgsfield.ai/out/video_42.mp4";

describe("聊天助手 Higgsfield 产物外链隐藏（stripRehostedUrls）", () => {
  it("裸链替换为占位说明（隐藏外链地址）", () => {
    const out = stripRehostedUrls(`给你生成好了：${HF} 看看效果`, [{ url: HF, type: "image" }]);
    expect(out).not.toContain(HF);
    expect(out).toContain("〔图片已转存到素材库，见下方附件〕");
  });

  it("markdown 图片语法整体清理（不留坏图渲染）", () => {
    const out = stripRehostedUrls(`结果：![生成图](${HF})`, [{ url: HF, type: "image" }]);
    expect(out).not.toContain(HF);
    expect(out).not.toContain("![");
    expect(out).toContain("结果：〔图片已转存到素材库，见下方附件〕");
  });

  it("markdown 链接语法同样清理；多链接分类型替换", () => {
    const out = stripRehostedUrls(`[点这里](${HF}) 和视频 ${HF2}`, [
      { url: HF, type: "image" }, { url: HF2, type: "video" },
    ]);
    expect(out).not.toContain(HF);
    expect(out).not.toContain(HF2);
    expect(out).not.toContain("[点这里]");
    expect(out).toContain("〔视频已转存到素材库，见下方附件〕");
  });

  it("未转存成功（不在 replaced 里）的链接原样保留", () => {
    const out = stripRehostedUrls(`A ${HF} B ${HF2}`, [{ url: HF, type: "image" }]);
    expect(out).not.toContain(HF);
    expect(out).toContain(HF2);
  });

  it("extractHiggsfieldUrls：CloudFront hf_ 路径与 higgsfield 域名命中，普通域名不动", () => {
    const urls = extractHiggsfieldUrls(`${HF} https://example.com/a.png ${HF2}`);
    expect(urls).toEqual([HF, HF2]);
  });
});
