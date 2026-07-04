import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createComfyTools } from "./_core/superAgent/comfyAdapters";

// 集成测试：用真实 HTTP 起一个假 ComfyUI /object_info 服务器，验证适配器的 describeNodes /
// listResources 走真 fetch + JSON 解析 + 缓存这条链路（单测里是拿现成对象 mock 的，这里补真链路）。

const OBJECT_INFO = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [["sd_xl_base_1.0.safetensors"]] } },
    output: ["MODEL", "CLIP", "VAE"],
    output_name: ["MODEL", "CLIP", "VAE"],
  },
  KSampler: {
    input: {
      required: {
        model: ["MODEL"],
        seed: ["INT", { default: 0 }],
        sampler_name: [["euler", "dpmpp_2m"]],
        scheduler: [["normal", "karras"]],
      },
      optional: { denoise: ["FLOAT", { default: 1 }] },
    },
    output: ["LATENT"],
    output_name: ["LATENT"],
  },
};

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

/** 起假 ComfyUI，返回 { baseUrl, hits() }（hits=/object_info 被请求的次数，用于验证缓存）。 */
async function startFakeComfy(): Promise<{ baseUrl: string; objectInfoHits: () => number }> {
  let hits = 0;
  server = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/object_info")) {
      hits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(OBJECT_INFO));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, objectInfoHits: () => hits };
}

describe("comfy adapter × 真实 /object_info（集成）", () => {
  it("listResources 走真 HTTP：节点类名 + 模型清单都从 /object_info 解析出来", async () => {
    const { baseUrl } = await startFakeComfy();
    const tools = createComfyTools({ baseUrl });
    const res = await tools.listResources();
    expect(res.nodeClasses).toContain("KSampler");
    expect(res.nodeClasses).toContain("CheckpointLoaderSimple");
    expect(res.checkpoints).toContain("sd_xl_base_1.0.safetensors");
    expect(res.samplers).toEqual(expect.arrayContaining(["euler", "dpmpp_2m"]));
    expect(res.schedulers).toEqual(expect.arrayContaining(["normal", "karras"]));
  });

  it("describeNodes 走真 HTTP：抽出精确输入/输出 schema", async () => {
    const { baseUrl } = await startFakeComfy();
    const tools = createComfyTools({ baseUrl });
    const desc = await tools.describeNodes!(["KSampler"]);
    expect(desc).toContain("【KSampler】");
    expect(desc).toContain("输出: LATENT");
    expect(desc).toContain("model: <MODEL>(连线)");
    expect(desc).toContain("seed: INT=0");
    expect(desc).toContain("sampler_name: 枚举{euler,dpmpp_2m}");
    expect(desc).toContain("denoise: FLOAT=1");
  });

  it("object_info 缓存：listResources 后 describeNodes 不再重复抓（describeNodes 加 0 次请求）", async () => {
    const { baseUrl, objectInfoHits } = await startFakeComfy();
    const tools = createComfyTools({ baseUrl });
    await tools.listResources();
    const afterList = objectInfoHits();
    await tools.describeNodes!(["KSampler"]);
    // describeNodes 复用缓存的 objectInfo()，不应再打 /object_info。
    expect(objectInfoHits()).toBe(afterList);
  });

  it("不存在的节点类 → 明确标注未安装（真链路）", async () => {
    const { baseUrl } = await startFakeComfy();
    const tools = createComfyTools({ baseUrl });
    const desc = await tools.describeNodes!(["NoSuchNode"]);
    expect(desc).toContain("未安装/不存在");
  });
});
