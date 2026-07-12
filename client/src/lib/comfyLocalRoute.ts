// #77 图像 AI 管线的「本地 ComfyUI（自建算力）」路由共享件。
// 打光/多角度编辑器、工具箱宫格管线、角色三视图等此前只有云端模型——
// 加一个哨兵模型值，选中即改走 comfyui.generateImage（img2img，服务端
// assertComfyuiAllowed 门控 + comfyui_image_gen 审计），免云端积分。
// checkpoint 选择全局共享（localStorage），与各入口解耦。

export const COMFY_LOCAL_MODEL = "__comfyui_local__";

export const COMFY_LOCAL_OPTION = {
  value: COMFY_LOCAL_MODEL,
  label: "本地 ComfyUI（自建算力）",
  group: "自建 / 桥接",
  family: "自建",
  costLabel: "自建 · 免云端积分",
};

const CKPT_KEY = "canvas.comfyEditCkpt";
export const loadComfyCkpt = (): string => { try { return localStorage.getItem(CKPT_KEY) ?? ""; } catch { return ""; } };
export const saveComfyCkpt = (v: string) => { try { localStorage.setItem(CKPT_KEY, v); } catch { /* ignore */ } };
