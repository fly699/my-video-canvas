import { describe, it, expect, beforeEach } from "vitest";
import { getComfyKnowledge, peekComfyKnowledge, searchComfyKnowledge, invalidateComfyKnowledge, getComfyModelList } from "./_core/comfyKnowledge";

const models = { ckpts: ["sd_xl.safetensors", "flux_dev.safetensors"], loras: ["detail.safetensors"], vaes: ["vae.safetensors"], samplers: ["euler"], schedulers: ["karras"] };
const objectInfo = { KSampler: {}, CLIPTextEncode: {}, FluxGuidance: {} };

function fetchers() {
  let modelCalls = 0, infoCalls = 0;
  return {
    fetchModels: async () => { modelCalls++; return models; },
    fetchObjectInfo: async () => { infoCalls++; return objectInfo; },
    get modelCalls() { return modelCalls; },
    get infoCalls() { return infoCalls; },
  };
}

describe("comfyKnowledge 记忆体", () => {
  beforeEach(() => invalidateComfyKnowledge());

  it("首次抓取真机并写入记忆；资源清单含节点类目录", async () => {
    const f = fetchers();
    const k = await getComfyKnowledge("http://s/", f);
    expect(k.resources.checkpoints).toContain("flux_dev.safetensors");
    expect(k.resources.nodeClasses).toEqual(["KSampler", "CLIPTextEncode", "FluxGuidance"]);
    expect(k.objectInfo).toEqual(objectInfo);
    expect(f.modelCalls).toBe(1);
    expect(f.infoCalls).toBe(1);
  });

  it("新鲜期内二次取用命中缓存，不再抓取（跨会话/跨节点复用）", async () => {
    const f = fetchers();
    await getComfyKnowledge("http://s", f);
    await getComfyKnowledge("http://s", f);       // 归一化后同一 key
    await getComfyKnowledge("http://s/", f);      // 尾斜杠不影响
    expect(f.modelCalls).toBe(1);                  // 只抓一次
  });

  it("force / 过期 → 重新抓取", async () => {
    const f = fetchers();
    await getComfyKnowledge("http://s", f);
    await getComfyKnowledge("http://s", { ...f, force: true });
    expect(f.modelCalls).toBe(2);
    await getComfyKnowledge("http://s", { ...f, maxAgeMs: -1 }); // 立刻算过期
    expect(f.modelCalls).toBe(3);
  });

  it("peek 只读缓存不抓取；invalidate 后为空", async () => {
    const f = fetchers();
    expect(peekComfyKnowledge("http://s")).toBeNull();
    await getComfyKnowledge("http://s", f);
    expect(peekComfyKnowledge("http://s")?.resources.loras).toEqual(["detail.safetensors"]);
    invalidateComfyKnowledge("http://s");
    expect(peekComfyKnowledge("http://s")).toBeNull();
  });

  it("searchComfyKnowledge：跨类关键词检索命中", async () => {
    const f = fetchers();
    const k = await getComfyKnowledge("http://s", f);
    const r = searchComfyKnowledge(k, "flux");
    expect(r.checkpoints).toEqual(["flux_dev.safetensors"]);
    expect(r.nodeClasses).toEqual(["FluxGuidance"]);
    expect(r.total).toBe(2);
    expect(searchComfyKnowledge(k, "nope").total).toBe(0);
  });

  it("抓取失败（objectInfo=null）不崩，nodeClasses 为空", async () => {
    const k = await getComfyKnowledge("http://s", { fetchModels: async () => models, fetchObjectInfo: async () => null });
    expect(k.objectInfo).toBeNull();
    expect(k.resources.nodeClasses).toEqual([]);
    expect(k.resources.checkpoints.length).toBe(2);
  });

  it("默认永不过期：多次取用始终命中缓存（无 TTL，只手动复位才重学）", async () => {
    const f = fetchers();
    await getComfyKnowledge("http://s", f);
    // 不传 maxAgeMs → 默认 Infinity，无论多久都命中缓存
    await getComfyKnowledge("http://s", f);
    await getComfyKnowledge("http://s", f);
    expect(f.modelCalls).toBe(1);
    // 只有 force / 手动 invalidate 才重学
    invalidateComfyKnowledge("http://s");
    await getComfyKnowledge("http://s", f);
    expect(f.modelCalls).toBe(2);
  });

  it("getComfyModelList：命中记忆里的全量模型清单（不重复抓取）", async () => {
    const f = fetchers();
    await getComfyKnowledge("http://s", f); // 学一次，modelList 从 models 落入记忆
    const list = await getComfyModelList("http://s");
    expect(list.ckpts).toEqual(["sd_xl.safetensors", "flux_dev.safetensors"]);
    expect(list.loras).toEqual(["detail.safetensors"]);
    expect(f.modelCalls).toBe(1); // 命中记忆，未再抓
  });
});
