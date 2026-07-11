import { installDomTranslationGuard } from "@/lib/domTranslationGuard";
// 首要：在任何 React 渲染前装上「浏览器翻译」DOM 守卫，防止翻译插件改写 DOM 导致
// removeChild/insertBefore 报错、整页白屏（详见该模块注释）。
installDomTranslationGuard();

import { trpc } from "@/lib/trpc";
import { getDeviceFingerprint } from "@/lib/deviceFingerprint";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { handleWhitelistError } from "./hooks/useWhitelistBlocked";
import "./index.css";

// One-time cleanup: the browser-side media cache (IndexedDB) was removed in
// favor of relying on durable MinIO/S3 storage. Drop the old database once so
// previously-cached blobs don't linger and waste the user's disk quota.
if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  try {
    if (!localStorage.getItem("media-cache-purged-v1")) {
      indexedDB.deleteDatabase("ai-canvas-media-cache");
      localStorage.setItem("media-cache-purged-v1", "1");
    }
  } catch { /* ignore — best-effort cleanup */ }
}

const queryClient = new QueryClient();

const handleGlobalError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  // Whitelist FORBIDDEN — show detailed dialog instead of redirecting
  if (handleWhitelistError(error)) return;

  if (error.message === UNAUTHED_ERR_MSG) {
    window.location.href = getLoginUrl();
  }
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleGlobalError(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleGlobalError(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    // 流式链路（非普通 httpBatchLink）：用 chunked 传输、请求一到即刷出响应首字节，绕过公网
    // Cloudflare 隧道的「首字节 ~100s（524）」超时——长 LLM 生成（画布助手/脚本/聊天等所有
    // 同步 procedure）不再被网关掐断返回 HTML、导致前端 `Unexpected token '<'`。一处覆盖全站。
    httpBatchStreamLink({
      url: "/api/trpc",
      transformer: superjson,
      // 全局透传用户的 kie 临时 key（工具栏填写的，存 localStorage）。这样所有用到 kie 的
      // 后端入口（不只 AI 对话）都能用「临时 > 分配 > 公用」的优先级，无需每个接口单独传。
      // 同理透传「自定义模型」的自带 key 与底层模型名（custom_openai / custom_claude）：
      // 前端工具栏录入存 localStorage，经请求头到达 invokeLLMWithKie（前端 key 优先，否则回退后端 env）。
      headers() {
        const h: Record<string, string> = {};
        // 设备指纹（行为日志溯源）：canvas/WebGL/屏幕等特征哈希，随每个请求上报。
        const fp = getDeviceFingerprint();
        if (fp) h["x-device-fp"] = fp;
        try {
          const t = localStorage.getItem("kie:tempKey") || "";
          if (t) h["x-kie-temp-key"] = t;
          const ok = localStorage.getItem("custom:openaiKey") || "";
          if (ok) h["x-openai-key"] = ok;
          const om = localStorage.getItem("custom:openaiModel") || "";
          if (om) h["x-openai-model"] = om;
          const ck = localStorage.getItem("custom:anthropicKey") || "";
          if (ck) h["x-anthropic-key"] = ck;
          const cm = localStorage.getItem("custom:anthropicModel") || "";
          if (cm) h["x-anthropic-model"] = cm;
        } catch { /* SSR/无 localStorage */ }
        return h;
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// 版本更新后旧标签页里 SPA 跳转会去加载已被替换的旧 hash chunk → 404 → 白屏。
// Vite 会发 vite:preloadError 事件；自动整页刷新一次拉新版（sessionStorage 防无限刷新循环）。
window.addEventListener("vite:preloadError", (e) => {
  if (sessionStorage.getItem("avc:chunk-reloaded") === "1") return; // 已刷过仍失败 → 交给默认报错
  sessionStorage.setItem("avc:chunk-reloaded", "1");
  e.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => { try { sessionStorage.removeItem("avc:chunk-reloaded"); } catch { /* ignore */ } });

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// Register the PWA service worker so the chat can be installed as an app.
// Only in production (dev/Vite HMR conflicts with SWs) and secure contexts.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/chat-sw.js").catch(() => { /* non-fatal */ });
  });
}
