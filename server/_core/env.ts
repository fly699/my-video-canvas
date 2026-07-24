// 仅本地开发（NODE_ENV==="development"）才允许回落到公开的 dev 密钥。此前只在精确的
// "production" 才强制，于是 NODE_ENV=staging/prod/未设 时会静默用源码里的固定密钥签发/校验
// 会话 JWT——任何人知道该常量即可伪造任意用户(含 admin)会话。改为「非 development 一律要求
// JWT_SECRET」，堵住这一会话伪造面（P0）。
if (process.env.NODE_ENV !== "development" && !process.env.JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET must be set unless NODE_ENV=development. Refusing to start with the insecure public dev fallback (session-forgery risk).");
  process.exit(1);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  // Use a deterministic dev-only secret when JWT_SECRET is unset — prevents "zero-length key" crash
  // in local development. Production deployments must set JWT_SECRET explicitly.
  cookieSecret: process.env.JWT_SECRET || "dev-only-secret-do-not-use-in-production-32c",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // OWNER_EMAIL must be set explicitly in production. The hardcoded fallback is intentional
  // for single-tenant deployments owned by this project's author; third-party deployers
  // MUST set OWNER_EMAIL to their own address to control who receives admin role.
  ownerEmail: process.env.OWNER_EMAIL ?? "fly699@gmail.com",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // 转写端点覆盖（可选）：任意 OpenAI 兼容的 /v1/audio/transcriptions 服务（自建 whisper 等）。
  // 未设则按 Forge → OpenAI 官方(OPENAI_API_KEY) 回退，见 voiceTranscription.resolveTranscribeEndpoint。
  transcribeApiUrl: process.env.TRANSCRIBE_API_URL ?? "",
  transcribeApiKey: process.env.TRANSCRIBE_API_KEY ?? "",
  // 转写模型 id 覆盖（可选）：非 OpenAI 端点的模型名常不同（Groq=whisper-large-v3、
  // 自建=各异）。设了就用它（含词级时间戳时也用它，须为支持 word 粒度的 whisper 系）；
  // 未设则默认 whisper-1（OpenAI 官方）。
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? "",
  // Groq 云端 whisper 的独立密钥（provider=groq 的转写模型专用，与自建端点解耦，
  // 不再和 TRANSCRIBE_API_URL 抢同一个变量）。base 固定 https://api.groq.com/openai。
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  // 本地 VoxCPM（Gradio TTS）全局默认地址（可选）：音频节点选「本地 VoxCPM2」但未在节点里填
  // 「Gradio 服务地址」时的兜底。也可在【管理后台 › 模型管理 › 本地 VoxCPM 端点】可视化配置
  // （DB 优先 + env 兜底）。例：VOXCPM_BASE_URL=http://172.16.0.177:8808（后端可达该地址）。
  voxcpmBaseUrl: process.env.VOXCPM_BASE_URL ?? "",
  // Self-hosted OpenAI-compatible LLM endpoint (vLLM / Ollama / LM Studio / TGI …).
  // Routes ONLY the model ids in SELF_HOSTED_LLM_MODELS (comma list; defaults to the
  // built-in self-hosted entries) to `${URL}/v1/chat/completions`, so it coexists with
  // Forge/Poyo/kie without redirecting their models. KEY may be empty for no-auth
  // servers. Internal addresses are fine (server-configured, trusted).
  // e.g. SELF_HOSTED_LLM_URL=http://172.16.0.10:8000
  selfHostedLlmUrl: process.env.SELF_HOSTED_LLM_URL ?? "",
  selfHostedLlmKey: process.env.SELF_HOSTED_LLM_KEY ?? "",
  selfHostedLlmModels: (process.env.SELF_HOSTED_LLM_MODELS ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
  // Self-hosted S3-compatible storage (MinIO / Cloudflare R2 / AWS S3).
  // When S3_ENDPOINT + S3_BUCKET + keys are set, this takes precedence over Forge.
  // For MinIO set S3_ENDPOINT=http://127.0.0.1:9000 and S3_FORCE_PATH_STYLE=true.
  // NOTE: this address is used by the SERVER only. Browser downloads are proxied
  // through the app server, so a 127.0.0.1 endpoint works for remote users too.
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  // PUBLIC endpoint reachable by end-user browsers (e.g. https://files.example.com).
  // S3_ENDPOINT is often a server-local address (127.0.0.1:9000) that remote
  // browsers cannot reach — when this is empty, downloads/uploads are streamed
  // THROUGH the app server instead of redirecting to the storage host. Set this
  // only when MinIO/S3 is exposed publicly (e.g. behind a reverse proxy) to let
  // browsers transfer directly and save app-server bandwidth.
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  poyoApiKey: process.env.POYO_API_KEY ?? "",
  // kie.ai shared "house" API key (Bearer). Balance shown in the canvas toolbar.
  // Usable by non-admins only when the whitelist kie switch is on (+ whitelisted).
  kieApiKey: process.env.KIE_API_KEY ?? "",
  // Secret used to AES-256-GCM encrypt admin-distributed kie keys at rest (these
  // are stored in the DB, never in env). Required to add/use distributed keys.
  kieKeySecret: process.env.KIE_KEY_SECRET ?? "",
  // Secret used to AES-256-GCM encrypt ComfyUI ops-center SSH credentials at rest
  // (DB, never env). Required to add/use SSH servers in the ops center. Kept
  // separate from KIE_KEY_SECRET so the two credential domains are isolated.
  sshKeySecret: process.env.SSH_KEY_SECRET ?? "",
  higgsfieldApiKey: process.env.HIGGSFIELD_API_KEY ?? "",
  higgsfieldApiSecret: process.env.HIGGSFIELD_API_SECRET ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // 「自定义模型」后端密钥（可选）：用户也可在前端录入自己的 key（请求头 x-openai-key /
  // x-anthropic-key），前端优先；都没有则该自定义模型不可用。可选地用 *_MODEL 覆盖默认底层模型名。
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  customOpenaiModel: process.env.OPENAI_MODEL ?? "",
  customAnthropicModel: process.env.ANTHROPIC_MODEL ?? "",
  comfyuiBaseUrl: process.env.COMFYUI_BASE_URL ?? "",
  // Official ComfyUI cloud (cloud.comfy.org). Opt-in per node via the node's
  // 本地/云端 toggle, and only usable by admins / whitelisted users. The base URL
  // and API key are server-side secrets (never exposed to the canvas doc). When
  // either is unset the cloud toggle reports "未配置" and falls back to nothing.
  comfyuiCloudBaseUrl: process.env.COMFYUI_CLOUD_BASE_URL ?? "https://cloud.comfy.org",
  comfyuiCloudApiKey: process.env.COMFYUI_CLOUD_API_KEY ?? "",
  // #328 即梦（dreamina）CLI 本机桥接的 env 兜底（JIMENG_CLI_ENABLED/BIN/SESSION）由
  // server/_core/jimengConfig.ts 直接读取 process.env（DB 优先、env 兜底），此处不再镜像，
  // 避免与后台 DB 配置双源不一致。
  // Google OAuth (standalone OpenID Connect). Both must be set to enable the
  // "使用 Google 登录" button. GOOGLE_REDIRECT_URI is optional — when unset the
  // callback URL is derived from the incoming request origin.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  // HTTPS (self-signed for LAN / to enable end-to-end encryption which needs a
  // secure context). When both files exist the server serves HTTPS.
  httpsCertFile: process.env.HTTPS_CERT_FILE ?? "certs/cert.pem",
  httpsKeyFile: process.env.HTTPS_KEY_FILE ?? "certs/key.pem",
};
